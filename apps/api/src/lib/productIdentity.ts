import type prismaClient from "./prisma.js"

type Db = typeof prismaClient

/**
 * Release batch — product identity across servers.
 *
 * A register names a product by the numeric id it pulled from the server it talks to (its first server). Another
 * server's numbers come from an independent sequence and collide, so they never identify anything there. The first
 * server resolves each product reference of an operation within its store and records the product's stable id
 * (syncId) with the operation; it forwards the command unchanged (its digest, approvals and duplicate checks stay
 * those of the register's command) with those stable ids beside it. The receiving server translates stable ids only:
 * an operation whose product it cannot establish is held, never matched by another server's number or a barcode.
 */

export type ProductRef = { path: Array<string | number>; key: "productSyncId" | "syncId"; syncId: string }

type Site = { path: Array<string | number>; obj: Record<string, unknown>; key: "productSyncId" | "syncId"; self: boolean }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

/** Where an operation names products (the object holding the reference and the field its stable id goes in). */
export function productRefSites(entity: string, action: string, payload: unknown): Site[] {
  const sites: Site[] = []
  const each = (list: unknown, base: Array<string | number>, key: Site["key"], self = false, skip?: (o: Record<string, unknown>) => boolean) => {
    if (!Array.isArray(list)) return
    list.forEach((o, i) => { if (isObj(o) && !skip?.(o)) sites.push({ path: [...base, i], obj: o, key, self }) })
  }
  const top = (key: Site["key"], self = false) => {
    if (Array.isArray(payload)) each(payload, [], key, self)
    else if (isObj(payload)) sites.push({ path: [], obj: payload, key, self })
  }
  if (!payload) return sites
  const p = payload as Record<string, unknown>
  if (entity === "product") top("syncId", true)
  else if (entity === "sale" && (action === "create" || action === "update")) each(p.items, ["items"], "productSyncId")
  // a refund line named by its sale line is that line's product on every server (no product reference to resolve)
  else if (entity === "refund" && action === "create") each(p.items, ["items"], "productSyncId", false, (o) => typeof o.saleLineId === "string" && o.saleLineId.length > 0)
  else if (entity === "delivery-order" && action === "create") each(p.items, ["items"], "productSyncId")
  else if (entity === "inventory" && action === "receive") top("productSyncId")
  else if (entity === "inventory" && (action === "adjust" || action === "waste")) top("productSyncId")
  else if (entity === "inventory" && action === "count") each(p.lines, ["lines"], "productSyncId")
  return sites
}

const givenSyncId = (s: Site): string | null => {
  const v = s.self ? s.obj.syncId : s.obj.productSyncId
  return typeof v === "string" && v ? v : null
}
const numberOf = (s: Site): number => {
  const n = Number(s.self ? s.obj.id : s.obj.productId ?? s.obj.id)
  return Number.isInteger(n) && n > 0 ? n : 0
}
const textOf = (v: unknown) => (typeof v === "string" ? v.trim() : "")

/** An operation's product cannot be established safely (held for review, never applied to a guess). */
export class IdentityHeldError extends Error {
  constructor(message: string) { super(`IDENTITY_HELD: ${message}`); this.name = "IdentityHeldError" }
}
/** A forwarded operation names a product this server has not received yet (retried once it arrives). */
export class ProductPendingError extends Error {
  constructor(what: string) { super(`PRODUCT_PENDING: ${what} has not reached this server yet; the operation is kept and applied once it does.`); this.name = "ProductPendingError" }
}

/**
 * The first server: resolve every product reference by this store's own numbers (the register's view) and record the
 * stable ids. A numeric reference is refused (held) when it cannot be trusted:
 *  - the line's own barcode belongs to another product than the number names;
 *  - the same device created a product under that number which became a different product here (its offline numbering
 *    collided with this server's), so the number is ambiguous for that device.
 * Stable ids the register sent are kept as sent. References without a resolvable stable id are left out (the receiving
 * server then holds the operation).
 */
export async function firstServerRefs(db: Db, tenantId: string, op: { id: string; entity: string; action: string; payload?: unknown }, device: { deviceId?: string | null; accountId?: string | null } = {}, opts: { reviewed?: boolean; legacyClient?: boolean } = {}): Promise<ProductRef[]> {
  const refs: ProductRef[] = []
  for (const s of productRefSites(op.entity, op.action, op.payload)) {
    const given = givenSyncId(s)
    if (given) { refs.push({ path: s.path, key: s.key, syncId: given }); continue }
    // a new product created here without a stable id has none to give yet (the cloud assigns it)
    if (s.self && op.action === "create") continue
    const n = numberOf(s)
    const barcode = textOf(s.obj.barcode)
    let product: { id: number; syncId: string | null; barcode: string | null; barcodeAliases: string[] } | null = null
    if (n) {
      product = await db.product.findFirst({ where: { tenantId, id: n }, select: { id: true, syncId: true, barcode: true, barcodeAliases: true } })
      // a manager applying held work has decided which product it is (the review shows the product the number names)
      if (product && !opts.reviewed) {
        // the line's own barcode is another product's here (a barcode no product has, e.g. a changed or scale code, says nothing)
        if (barcode && product.barcode !== barcode && !(product.barcodeAliases ?? []).includes(barcode)) {
          const other = await db.product.findFirst({ where: { tenantId, id: { not: n }, OR: [{ barcode }, { barcodeAliases: { has: barcode } }] }, select: { id: true, name: true } })
          if (other && other.id !== n) throw new IdentityHeldError(`the line names product #${n} here, but its barcode ${barcode} is "${other.name}". Which product was meant cannot be established.`)
        }
        // only a register that names products by number (1.0.50/1.0.51): its queued work kept its own offline numbers.
        // (A register of this version sends stable ids; after a pull its numbers are this server's again.)
        if (opts.legacyClient && await collidedLocalNumber(db, tenantId, n, product.syncId, device, op.id)) {
          throw new IdentityHeldError(`this register numbered a product it created itself #${n}, which is another product here. Which product was meant cannot be established.`)
        }
      }
    } else if (barcode) {
      const rows = await db.product.findMany({ where: { tenantId, OR: [{ barcode }, { barcodeAliases: { has: barcode } }] }, select: { id: true, syncId: true, barcode: true, barcodeAliases: true }, take: 2 })
      product = rows.length === 1 ? rows[0] : null
    }
    if (product?.syncId) refs.push({ path: s.path, key: s.key, syncId: product.syncId })
  }
  return refs
}

/**
 * The same device created a product whose local number was n, and that product is not this server's #n: the device's
 * numbering collided with this server's, so a bare #n from it may mean either.
 */
async function collidedLocalNumber(db: Db, tenantId: string, n: number, syncIdHere: string | null, device: { deviceId?: string | null; accountId?: string | null }, opId: string): Promise<boolean> {
  const deviceId = device.deviceId ?? null, accountId = device.accountId ?? null
  if ((!deviceId && !accountId) || typeof (db as any).$queryRaw !== "function") return false
  const rows = await (db as any).$queryRaw`
    SELECT e->>'syncId' AS "syncId"
    FROM "SyncOperation" so
    JOIN "OperationEvidence" ev ON ev."opId" = so."id"
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(so."payload") = 'array' THEN so."payload" ELSE jsonb_build_array(so."payload") END) e
    WHERE so."tenantId" = ${tenantId} AND so."entity" = 'product' AND so."action" = 'create' AND so."appliedAt" IS NOT NULL
      AND so."id" <> ${opId}
      AND (e->>'id') = ${String(n)} AND e ? 'syncId' AND (e->>'syncId') IS NOT NULL
      AND (${deviceId}::text IS NOT NULL AND ev."deviceIdClaimed" = ${deviceId} OR ${deviceId}::text IS NULL AND ev."connectionAccountId" = ${accountId})
    LIMIT 5` as Array<{ syncId: string }>
  return rows.some((r) => r.syncId !== syncIdHere)
}

/** Stable ids a forwarding server sent with an operation (well-formed entries only). */
export function parseRefs(value: unknown): ProductRef[] {
  if (!Array.isArray(value)) return []
  return value.filter((r): r is ProductRef => isObj(r) && Array.isArray(r.path) && r.path.every((x) => typeof x === "string" || typeof x === "number")
    && (r.key === "productSyncId" || r.key === "syncId") && typeof r.syncId === "string" && r.syncId.length > 0 && r.syncId.length <= 200)
}

/** The command with the stable ids filled in where it named a product only by number (a copy; the command is kept). */
export function withRefs<T>(payload: T, refs: ProductRef[] | null | undefined): T {
  if (!refs?.length || !payload || typeof payload !== "object") return payload
  const copy = JSON.parse(JSON.stringify(payload))
  for (const r of refs) {
    let at: any = copy
    for (const k of r.path) at = at?.[k as any]
    if (isObj(at) && !(typeof at[r.key] === "string" && at[r.key])) at[r.key] = r.syncId
  }
  return copy
}

/** Removes what withRefs filled in (a server valuation written into the working copy is kept on the command). */
export function withoutRefs<T>(payload: T, refs: ProductRef[] | null | undefined, original: unknown): T {
  if (!refs?.length || !payload || typeof payload !== "object") return payload
  for (const r of refs) {
    let at: any = payload, was: any = original
    for (const k of r.path) { at = at?.[k as any]; was = was?.[k as any] }
    if (isObj(at) && !(isObj(was) && typeof was[r.key] === "string" && was[r.key])) delete at[r.key]
  }
  return payload
}
