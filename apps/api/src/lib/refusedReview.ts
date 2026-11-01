/**
 * Refused-work review (containment): what a manager needs to decide about an operation the server
 * refused — the original command (secrets hidden), what the till already did locally (CLAIMED),
 * what applying it here would do now, and what is and is not known about who did it.
 * Self-contained so the same file serves the hotfix line and master.
 */
import prisma from "./prisma.js"

const SECRET_KEY = /pin|password|token|credential|secret|session|api_?key/i

/** Copies a value with every secret-looking field replaced (PINs, tokens, credentials, sessions). */
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets)
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEY.test(k) ? "[hidden]" : redactSecrets(v)]))
  }
  return value
}

/** The staff member the payload names as acting — written by the till, so a CLAIM. */
export function claimedActorOf(entity: string, action: string, payload: unknown): { id: string | null; name: string | null } {
  const p = (payload ?? {}) as Record<string, unknown>
  const str = (k: string) => (typeof p[k] === "string" && p[k] ? (p[k] as string) : null)
  switch (entity) {
    case "sale":
    case "refund": return { id: str("cashierId"), name: str("cashier") }
    case "shift": return action === "close" ? { id: str("closedById"), name: str("closedByName") } : { id: str("openedById"), name: str("openedByName") }
    case "cash-movement": return { id: str("recordedById"), name: str("recordedByName") }
    case "expense":
    case "supplier-payment": return { id: str("recordedById"), name: str("recordedBy") }
    case "daily-close": return { id: str("closedById"), name: str("closedBy") }
    case "purchase-order": return { id: str("createdById"), name: str("createdBy") }
    default: return { id: null, name: null }
  }
}

export type Effect =
  | { kind: "stock-change"; product: string; change: number; reason: string | null; tillBefore: number | null; tillAfter: number | null; serverNow: number | null; serverAfter: number | null }
  | { kind: "lots-received"; product: string; quantity: number; serverNow: number | null; serverAfter: number | null }
  | { kind: "stock-count"; lines: number }
  | { kind: "customer"; action: string; name: string }
  | { kind: "debt-payment"; customer: string; amount: number }
  | { kind: "debt"; action: string; amount: number | null }
  | { kind: "sale"; saleNumber: string | null; total: number | null; lines: Array<{ name: string; quantity: number; unitPrice: number; catalogue: number | null }> }
  | { kind: "money"; what: "expense" | "cash-in" | "cash-out" | "supplier-payment" | "refund"; amount: number | null; party: string | null }
  | { kind: "other" }

const num = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v))

async function productOf(tenantId: string, ref: Record<string, unknown>) {
  const syncId = typeof ref.productSyncId === "string" && ref.productSyncId ? ref.productSyncId : null
  const id = Number(ref.productId ?? ref.id)
  const p = syncId
    ? await prisma.product.findFirst({ where: { tenantId, syncId }, select: { name: true, stock: true, price: true } })
    : Number.isInteger(id) && id > 0 ? await prisma.product.findFirst({ where: { tenantId, id }, select: { name: true, stock: true, price: true } }) : null
  return { name: p?.name ?? (typeof ref.productName === "string" ? ref.productName : "?"), stock: p ? Number(p.stock) : null, price: p ? Number(p.price) : null }
}

/** What the till did (claimed) and what applying the operation on this server would do now. */
export async function describeEffects(tenantId: string, entity: string, action: string, payload: unknown): Promise<Effect[]> {
  const p = (payload ?? {}) as Record<string, unknown>
  if (entity === "inventory" && action === "adjust") {
    const prod = await productOf(tenantId, p)
    const change = num(p.quantityChange) ?? 0
    return [{ kind: "stock-change", product: prod.name, change, reason: typeof p.reason === "string" ? p.reason : null, tillBefore: num(p.quantityBefore), tillAfter: num(p.quantityAfter), serverNow: prod.stock, serverAfter: prod.stock === null ? null : prod.stock + change }]
  }
  if (entity === "inventory" && action === "receive") {
    const lots = Array.isArray(payload) ? (payload as Array<Record<string, unknown>>) : [p]
    const out: Effect[] = []
    for (const lot of lots) {
      const prod = await productOf(tenantId, lot)
      const q = num(lot.initialQuantity) ?? num(lot.quantity) ?? 0
      out.push({ kind: "lots-received", product: prod.name, quantity: q, serverNow: prod.stock, serverAfter: prod.stock === null ? null : prod.stock + q })
    }
    return out
  }
  if (entity === "inventory" && action === "count") return [{ kind: "stock-count", lines: Array.isArray(p.items) ? p.items.length : 0 }]
  if (entity === "customer") return [{ kind: "customer", action, name: typeof p.name === "string" ? p.name : "?" }]
  if (entity === "debt" && action === "payment") {
    const c = typeof p.customerId === "string" ? await prisma.customer.findFirst({ where: { tenantId, id: p.customerId }, select: { name: true } }) : null
    return [{ kind: "debt-payment", customer: c?.name ?? "?", amount: num(p.amount) ?? 0 }]
  }
  if (entity === "debt") return [{ kind: "debt", action, amount: num(p.amount) }]
  if (entity === "sale" && action === "create") {
    const items = Array.isArray(p.items) ? (p.items as Array<Record<string, unknown>>) : []
    const lines = []
    for (const it of items) {
      const prod = await productOf(tenantId, { ...it, productId: it.id })
      const quantity = num(it.quantity) ?? 0
      // stock: what the server holds now and after applying this line (SPRINT-2 F)
      lines.push({ name: typeof it.name === "string" ? it.name : prod.name, quantity, unitPrice: num(it.unitPrice) ?? 0, catalogue: prod.price, serverStockNow: prod.stock, serverStockAfter: prod.stock === null ? null : prod.stock - quantity })
    }
    return [{ kind: "sale", saleNumber: typeof p.saleNumber === "string" ? p.saleNumber : null, total: num(p.total), lines }]
  }
  // Money the register already moved locally (a decline on the server does not move it back).
  if (entity === "expense") return [{ kind: "money", what: "expense", amount: num(p.amount), party: typeof p.vendor === "string" ? p.vendor : null }]
  if (entity === "cash-movement") return [{ kind: "money", what: String(p.type ?? p.direction ?? "").toLowerCase().includes("in") ? "cash-in" : "cash-out", amount: num(p.amountUsd ?? p.amount), party: typeof p.reason === "string" ? p.reason : null }]
  if (entity === "supplier-payment") return [{ kind: "money", what: "supplier-payment", amount: num(p.amount), party: typeof p.supplierName === "string" ? p.supplierName : null }]
  if (entity === "refund") return [{ kind: "money", what: "refund", amount: num(p.total ?? p.amount), party: typeof p.saleNumber === "string" ? p.saleNumber : null }]
  return [{ kind: "other" }]
}

/**
 * What is NOT known about who did this. The pushing account is authenticated; everything the
 * payload says about the actor, the device and the time was written by the till.
 */
export function actorLimitations(pushedBy: string | null, claimed: { id: string | null; name: string | null }, deviceId: string | null, payload: unknown): string[] {
  const out: string[] = []
  if (pushedBy) out.push("connection-account-not-proven-actor")
  if (claimed.id && pushedBy && claimed.id !== pushedBy) out.push("actor-differs-from-connection-account")
  if (!claimed.id) out.push(claimed.name ? "actor-named-without-id" : "no-actor-recorded")
  if (deviceId) out.push("device-id-claimed")
  if (payload && typeof payload === "object" && ("quantityBefore" in payload || "quantityAfter" in payload)) out.push("local-effects-claimed-by-till")
  if (payload && typeof payload === "object" && "createdAt" in payload) out.push("client-time-claimed")
  return out
}
