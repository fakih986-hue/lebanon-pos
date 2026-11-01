/**
 * Operational readiness: the business record says who did it — authoritatively in a store that enforces staff
 * identity, and with how it is known in every store.
 *
 * The server writes the actor (stable staff id + the name at the time, a snapshot) and `attribution` on the
 * record itself when it applies the operation, in the same transaction. Whatever the register put in those
 * fields is overwritten: a missing or substituted actor in the payload can neither erase nor replace the
 * authenticated person. Three people stay apart: the ACTOR (who did it), the APPROVER (a manager's online
 * approval) and the REVIEWER (who applied held work). A void records its voider separately: the seller stays.
 *
 * basis:
 *  - verified         the person of a server-checked staff session on an enrolled register (or a hub's signed
 *                     record of one): the authenticated actor
 *  - offline-claimed  the person the register names on work it says it did offline (enforce: routine sale only)
 *  - claimed          the person the register names (observe: not proven)
 *  - reviewed         held work a reviewer applied: the actor is who the register named / whose session it was
 *                     when it was held (as checked then); the reviewer is recorded apart
 *  - system           made by the server itself, no person acted (e.g. the store credit a refund creates)
 *  - unattributed     the register named nobody and no session was checked (observe)
 * Records made before this existed keep null: they are never upgraded after the fact.
 */
import prisma from "./prisma.js"

export type Person = { id: string; name: string }
export type AttributionBasis = "verified" | "offline-claimed" | "claimed" | "reviewed" | "system" | "unattributed"
export type Attribution = { basis: AttributionBasis; actor: Person | null; approver?: Person | null; reviewer?: Person | null; opId?: string; derivedFrom?: { entity: string; id: string } }

type Db = typeof prisma
const str = (v: unknown) => (typeof v === "string" && v ? v : null)
const meta = (a: Attribution) => ({ basis: a.basis, ...(a.approver ? { approver: a.approver } : {}), ...(a.reviewer ? { reviewer: a.reviewer } : {}), ...(a.opId ? { opId: a.opId } : {}), ...(a.derivedFrom ? { derivedFrom: a.derivedFrom } : {}) })

/** The staff member's name now (a snapshot at the time the server applies the operation). */
export async function personOf(tenantId: string, id: string | null | undefined, fallbackName?: string | null): Promise<Person | null> {
  if (!id) return null
  const s = await prisma.staffUser.findFirst({ where: { id, tenantId }, select: { id: true, name: true } })
  return s ? { id: s.id, name: s.name } : fallbackName ? { id, name: fallbackName } : null
}

/**
 * Writes the actor and attribution on the record(s) this operation made or changed. Called inside the
 * transaction that applied it, after the handler: it always runs, so payload-supplied attribution never stays.
 */
export async function stampAttribution(db: Db, tenantId: string, op: { id: string; entity: string; action: string; payload?: unknown }, a: Attribution): Promise<void> {
  const p = (op.payload ?? {}) as Record<string, unknown>
  const id = str(p.id)
  const actorId = a.actor?.id ?? null, actorName = a.actor?.name ?? null
  const attribution = meta({ ...a, opId: op.id }) as any
  const one = async (model: string, data: Record<string, unknown>, recordId: string | null = id) => {
    if (recordId) await (db as any)[model].updateMany({ where: { tenantId, id: recordId }, data })
  }
  // the actor fields are written with the known person; with nobody known they are left as they were
  const named = (fields: Record<string, unknown>) => (a.actor ? fields : {})
  switch (`${op.entity}/${op.action}`) {
    case "sale/create": await one("sale", { ...named({ cashierId: actorId, cashier: actorName ?? "" }), attribution, voidedById: null, voidedByName: null, voidedAt: null, voidAttribution: null }); break
    case "sale/void": await one("sale", { voidedById: actorId, voidedByName: actorName, voidedAt: new Date(), voidAttribution: attribution }); break
    case "refund/create": {
      await one("saleRefund", { ...named({ cashierId: actorId, cashier: actorName ?? "" }), attribution })
      // the store credit a refund creates: made by the server from the refund, no person acted on it
      if (id) await (db as any).debtPayment.updateMany({ where: { tenantId, id: `refund-credit:${id}` }, data: { recordedById: null, recordedByName: null, attribution: { basis: "system", derivedFrom: { entity: "refund", id }, opId: op.id } } })
      break
    }
    case "expense/create": await one("expense", { ...named({ recordedById: actorId, recordedBy: actorName ?? "" }), attribution }); break
    case "cash-movement/create": await one("cashMovement", { ...named({ recordedById: actorId, recordedByName: actorName ?? "" }), attribution }); break
    case "inventory/receive": {
      const ids = (Array.isArray(op.payload) ? op.payload : [op.payload]).map((b: any) => str(b?.id)).filter(Boolean) as string[]
      if (ids.length) await (db as any).inventoryBatch.updateMany({ where: { tenantId, id: { in: ids } }, data: { receivedById: actorId, receivedByName: actorName, attribution } })
      break
    }
    case "inventory/adjust": await one("stockAdjustment", { createdById: actorId, createdByName: actorName, attribution }); break
    case "inventory/count": await one("stockCountSession", { completedById: actorId, completedByName: actorName, attribution }); break
    case "supplier-payment/payment": case "supplier-payment/create": await one("supplierPayment", { ...named({ recordedById: actorId, recordedBy: actorName ?? "" }), attribution }); break
    case "purchase-order/create": await one("purchaseOrder", { ...named({ createdById: actorId, createdBy: actorName ?? "" }), attribution }); break
    case "debt/create": await one("debtSale", { recordedById: actorId, recordedByName: actorName, attribution }); break
    case "debt/payment": await one("debtPayment", { recordedById: actorId, recordedByName: actorName, attribution }); break
    // a shift's opener is a required staff reference: replaced only by a known person
    case "shift/open": await one("shift", { ...(a.actor ? { openedById: actorId, openedByName: actorName } : {}), openAttribution: attribution }); break
    case "shift/close": await one("shift", { ...named({ closedById: actorId, closedByName: actorName }), closeAttribution: attribution }); break
    case "daily-close/close": await one("dailyClose", { ...named({ closedById: actorId, closedBy: actorName ?? "" }), attribution }); break
    default: break
  }
}

/** The person a payload names as acting (or null). */
export function namedActor(entity: string, action: string, payload: unknown): { id: string | null; name: string | null } {
  const p = (payload ?? {}) as Record<string, unknown>
  switch (entity) {
    case "sale": return action === "create" ? { id: str(p.cashierId), name: str(p.cashier) } : { id: null, name: null }
    case "refund": return { id: str(p.cashierId), name: str(p.cashier) }
    case "shift": return action === "close" ? { id: str(p.closedById), name: str(p.closedByName) } : { id: str(p.openedById), name: str(p.openedByName) }
    case "cash-movement": return { id: str(p.recordedById), name: str(p.recordedByName) }
    case "expense": return { id: str(p.recordedById), name: str(p.recordedBy) }
    case "daily-close": return { id: str(p.closedById), name: str(p.closedBy) }
    case "supplier-payment": return { id: str(p.recordedById), name: str(p.recordedBy) }
    case "purchase-order": return { id: str(p.createdById), name: str(p.createdBy) }
    default: return { id: null, name: null }
  }
}

/**
 * Who did it, as this server knows it when it applies the operation:
 *  - an enforced actor (the verified session's person, or a routine offline sale's named person) is authoritative;
 *  - otherwise (observe) a valid, current session of the same person the payload names (or names nobody) is
 *    verified; a name the register gives is a claim; nobody named and no session: unattributed.
 */
export async function attributionFor(tenantId: string, op: { entity: string; action: string; payload?: unknown }, ctx: {
  enforced?: { actor: Person; basis: "session" | "stale-session" | "offline-claimed" } | null
  session?: { check: string; staffId: string | null; expired?: boolean; ended?: boolean } | null
  approver?: Person | null
}): Promise<Attribution> {
  const approver = ctx.approver ?? null
  if (ctx.enforced) return { basis: ctx.enforced.basis === "offline-claimed" ? "offline-claimed" : "verified", actor: ctx.enforced.actor, approver }
  const named = namedActor(op.entity, op.action, op.payload)
  const s = ctx.session
  if (s && s.check === "valid" && s.staffId && !s.expired && !s.ended && (!named.id || named.id === s.staffId)) {
    const actor = await personOf(tenantId, s.staffId)
    if (actor) return { basis: "verified", actor, approver }
  }
  if (named.id) return { basis: "claimed", actor: (await personOf(tenantId, named.id, named.name)) ? { id: named.id, name: named.name ?? (await personOf(tenantId, named.id))!.name } : { id: named.id, name: named.name ?? "" }, approver }
  return { basis: "unattributed", actor: null, approver }
}

/** What a hub signed about the record it wrote: taken as it vouched, never upgraded (a claim stays a claim). */
export function attestedAttribution(srv: Record<string, unknown> | null | undefined): Attribution | null {
  const a = srv?.attribution as Record<string, any> | undefined
  if (!a || typeof a !== "object" || typeof a.basis !== "string") return null
  const p = (x: any): Person | null => (x && typeof x.id === "string" && typeof x.name === "string" ? { id: x.id, name: x.name } : null)
  const basis = (["verified", "offline-claimed", "claimed", "reviewed", "system", "unattributed"] as const).find((b) => b === a.basis)
  return basis ? { basis, actor: p(a.actor), approver: p(a.approver), reviewer: p(a.reviewer) } : null
}

/** Fields of a business record that only the server writes; a client's copy of them is dropped before applying. */
export const SERVER_ATTRIBUTION_FIELDS = ["attribution", "voidedById", "voidedByName", "voidedAt", "voidAttribution", "openAttribution", "closeAttribution", "receivedById", "receivedByName", "completedById", "completedByName", "createdByName"] as const
export function withoutServerAttribution(payload: unknown): unknown {
  const strip = (o: unknown) => {
    if (!o || typeof o !== "object" || Array.isArray(o)) return o
    const out = { ...(o as Record<string, unknown>) }
    for (const k of SERVER_ATTRIBUTION_FIELDS) delete out[k]
    return out
  }
  return Array.isArray(payload) ? payload.map(strip) : strip(payload)
}
/** The same, in place: the handlers write the server's own figures back into the payload (it is forwarded as applied). */
export function stripServerAttribution(payload: unknown): void {
  for (const o of Array.isArray(payload) ? payload : [payload]) {
    if (o && typeof o === "object" && !Array.isArray(o)) for (const k of SERVER_ATTRIBUTION_FIELDS) delete (o as Record<string, unknown>)[k]
  }
}
