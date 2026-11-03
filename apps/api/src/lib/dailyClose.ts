/**
 * Which daily close a close is (DailyClose: scope, revision, revisionOf, supersededById).
 *
 * A date is not one close: a café may close several registers and shifts on one date. A close belongs to
 * its SCOPE — the register that made it (its device id: every register defaults to the register label
 * REG-001, so the label alone cannot tell two registers apart) and the shift it was made in ("store" when
 * the register sends neither: closes recorded before scopes). For one scope:
 *   - the same close again (same id: a retry, a hub's re-forward) is the same record: nothing changes;
 *   - another close of the same scope and date is a CORRECTION: a new revision linked to the close it
 *     corrects, which is kept unchanged and marked superseded. A register that names the close it corrects
 *     (`correctsId`) must name the current one, or the correction is refused and kept for a manager's
 *     review (it was based on figures someone else has since corrected); an older register that cannot
 *     name it ("re-close") corrects the current one;
 *   - a close of another scope is a separate close: it never replaces anything.
 * Reports use the current revision of each scope (supersededById null). Nothing is deleted.
 * Corrections of one scope are serialized (a transaction-scoped advisory lock) and the revision number
 * is unique per scope, so two concurrent corrections cannot both become the current one.
 */
import { createHash } from "node:crypto"
import type prisma from "./prisma.js"

type Db = Pick<typeof prisma, "dailyClose" | "auditEvent" | "$executeRaw">

/** The register label a shared drawer's close is recorded under (desktop dailyClose.service SHARED_DRAWER_REGISTER). */
export const SHARED_DRAWER_REGISTER = "SHARED-DRAWER"

/**
 * Batch 83: a shared drawer's close must count every sale and refund this server has recorded for its date (the
 * register's local day: dateKey and its UTC offset), or it would lose them from the day. A register that has not
 * received them yet is refused (kept for review) and closes again after it syncs.
 */
export async function assertSharedCloseComplete(db: Pick<typeof prisma, "sale" | "saleRefund">, tenantId: string, dateKey: string, tzOffsetMinutes: unknown, saleIds: unknown, refundIds: unknown): Promise<void> {
  const offset = Number(tzOffsetMinutes)
  const day = /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? Date.parse(`${dateKey}T00:00:00.000Z`) : NaN
  if (!Number.isInteger(offset) || Math.abs(offset) > 14 * 60 || !Number.isFinite(day)) throw new CloseConflictError(`this shared-drawer close of ${dateKey || "a date"} does not say which local day it covers (update the register). Kept for a manager's review.`)
  // getTimezoneOffset(): minutes to ADD to local time to get UTC
  const from = new Date(day + offset * 60_000), to = new Date(day + offset * 60_000 + 86_400_000)
  const has = new Set([...(Array.isArray(saleIds) ? saleIds : []), ...(Array.isArray(refundIds) ? refundIds : [])].map(String))
  const [sales, refunds] = await Promise.all([
    db.sale.findMany({ where: { tenantId, createdAt: { gte: from, lt: to } }, select: { id: true } }),
    db.saleRefund.findMany({ where: { tenantId, createdAt: { gte: from, lt: to } }, select: { id: true } }),
  ])
  const missing = [...sales, ...refunds].filter((r) => !has.has(r.id)).length
  if (missing > 0) throw new CloseConflictError(`this shared-drawer close of ${dateKey} leaves out ${missing} sale(s) or refund(s) already recorded for that day (this register had not received them yet). Sync it and close again. Kept for a manager's review; nothing was recorded.`)
}

export class CloseConflictError extends Error {
  constructor(message: string) { super(`CLOSE_CONFLICT: ${message}`); this.name = "CloseConflictError" }
}

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)

/** The scope of a close as the register sent it (its device, else its register label; and its shift). */
export function closeScope(submitted: Record<string, unknown> | null | undefined): { scope: string; registerId: string | null; shiftId: string | null } {
  const deviceId = text(submitted?.deviceId)
  const registerId = text(submitted?.registerId)
  const shiftId = text(submitted?.shiftId)
  // the shared drawer is one scope for the store, whichever register (or shift) sends its close
  if (registerId === SHARED_DRAWER_REGISTER) return { scope: `register:${SHARED_DRAWER_REGISTER}`, registerId, shiftId: null }
  const who = deviceId ? `device:${deviceId}` : registerId ? `register:${registerId}` : null
  return { scope: who ? `${who}${shiftId ? `|shift:${shiftId}` : ""}` : "store", registerId, shiftId }
}

/**
 * Records a close received by this server (a register's push, or a hub's forward). Returns how it was
 * recorded. `close` holds only DailyClose columns; `correctsId` is what the register says it corrects.
 */
export async function recordClose(db: Db, tenantId: string, close: Record<string, any> & { id: string; dateKey: string }, scope: ReturnType<typeof closeScope>, correctsId: string | null, by: string): Promise<"created" | "same" | "revised"> {
  // one scope of one date at a time (the lock ends with the transaction)
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`close:${tenantId}:${close.dateKey}:${scope.scope}`}))`
  const same = await db.dailyClose.findUnique({ where: { id: close.id } })
  if (same) {
    if (same.tenantId !== tenantId) throw new Error(`TENANT_SCOPE: daily close ${close.id} belongs to another store`)
    return "same" // a retry or re-forward of a recorded close: its recorded figures and revision stand
  }
  const current = await db.dailyClose.findFirst({ where: { tenantId, dateKey: close.dateKey, scope: scope.scope, supersededById: null }, orderBy: { revision: "desc" } })
  const base = { ...close, tenantId, scope: scope.scope, registerId: scope.registerId, shiftId: scope.shiftId }
  if (!current) {
    // a correction of a close this server never saw cannot be placed: kept for review rather than guessed
    if (correctsId) throw new CloseConflictError(`this close corrects ${correctsId}, which this server has not recorded for ${close.dateKey}. Kept for a manager's review.`)
    await db.dailyClose.create({ data: { ...base, revision: 1 } as any })
    return "created"
  }
  // batch 83: the shared drawer's close is one close for the whole store: a close that does not name the current one
  // (another register's, or one made before this register saw it) never replaces it silently
  if (!correctsId && scope.registerId === SHARED_DRAWER_REGISTER && by !== "hub") {
    throw new CloseConflictError(`${close.dateKey} was already closed for the shared drawer (close ${current.id}, revision ${current.revision}, by ${String(current.closedBy ?? "someone")}). A new close must correct that one: sync this register and close again. Kept for a manager's review; nothing was replaced.`)
  }
  if (correctsId && correctsId !== current.id) {
    throw new CloseConflictError(`this correction of ${close.dateKey} was based on close ${correctsId}, but the current close of this register and shift is ${current.id} (revision ${current.revision}). Kept for a manager's review; nothing was replaced.`)
  }
  const correction = correctsId ? "correction" : "re-close"
  await db.dailyClose.create({ data: { ...base, revision: current.revision + 1, revisionOf: current.id, correction } as any })
  await db.dailyClose.update({ where: { id: current.id }, data: { supersededById: close.id, supersededAt: new Date() } })
  await db.auditEvent.create({ data: {
    tenantId, action: "day.close.revised", entity: "accounting",
    summary: `${close.dateKey} close of ${scope.scope === "store" ? "the store" : scope.scope} corrected by ${String(close.closedBy ?? "someone")} (revision ${current.revision + 1}, ${correction}); revision ${current.revision} by ${String(current.closedBy ?? "someone")} is kept.`,
    metadata: { closeId: close.id, revision: current.revision + 1, revisionOf: current.id, correction, scope: scope.scope, via: by },
    userId: "__system__", userName: "Sync", userRole: "Admin",
  } as any })
  return "revised"
}

/**
 * A close pulled from the cloud by a hub: the cloud's record of it (scope, revision and links included)
 * is copied as it is. A close already here keeps its figures; only its link to a later revision is
 * brought up to date.
 */
export async function mirrorClose(db: Pick<typeof prisma, "dailyClose">, tenantId: string, dc: Record<string, any>): Promise<void> {
  const existing = await db.dailyClose.findUnique({ where: { id: String(dc.id) }, select: { tenantId: true, supersededById: true } })
  if (existing) {
    if (existing.tenantId !== tenantId) return
    if (!existing.supersededById && dc.supersededById) await db.dailyClose.update({ where: { id: String(dc.id) }, data: { supersededById: String(dc.supersededById), supersededAt: dc.supersededAt ? new Date(dc.supersededAt) : new Date() } })
    return
  }
  // an older cloud sends no scope: its one close per date is the store's
  await db.dailyClose.create({ data: { ...dc, tenantId, scope: typeof dc.scope === "string" && dc.scope ? dc.scope : "store", revision: Number.isInteger(dc.revision) ? dc.revision : 1 } as any })
  // a pull since a time carries the new revision, not the corrected close's new link: set it here
  if (typeof dc.revisionOf === "string" && dc.revisionOf) {
    await db.dailyClose.updateMany({ where: { id: dc.revisionOf, tenantId, supersededById: null }, data: { supersededById: String(dc.id), supersededAt: dc.createdAt ? new Date(dc.createdAt) : new Date() } })
  }
}

/** Only the closes reports use: the current revision of each scope. */
export const CURRENT_CLOSE = { supersededById: null } as const

const DAY_FIGURES = ["grossSales", "refunds", "netSales", "expenses", "cashIn", "cashOut"] as const
const NULLABLE_FIGURES = ["costOfGoods", "returnedCost", "grossMargin", "supplierPayments", "netProfit"] as const

/**
 * What a client that keeps ONE close per date (an older register or hub) is sent for a date. A date with a
 * single current close: that close, as it is. A date several registers or shifts closed: one COMBINED close —
 * the sum of the current revision of each (corrections included, the closes they corrected left out) under a
 * stable id, saying so in its note and in closedBy — so no register's close is silently dropped. A figure
 * any of them does not know (a null cost) is unknown in the sum; costStatus is "server" only when every one
 * is. Returns the rows to send, in place of the current revisions of those dates.
 */
export async function legacyClosesFor(db: Pick<typeof prisma, "dailyClose">, tenantId: string, dateKeys: string[]): Promise<Record<string, any>[]> {
  if (!dateKeys.length) return []
  const rows = await db.dailyClose.findMany({ where: { tenantId, dateKey: { in: [...new Set(dateKeys)] }, supersededById: null }, orderBy: { createdAt: "asc" } })
  const byDate = new Map<string, typeof rows>()
  for (const r of rows) byDate.set(r.dateKey, [...(byDate.get(r.dateKey) ?? []), r])
  const out: Record<string, any>[] = []
  for (const [dateKey, closes] of byDate) {
    if (closes.length === 1) { out.push(closes[0] as any); continue }
    const n = (v: unknown) => Number(v ?? 0)
    const combined: Record<string, any> = {
      id: combinedCloseId(tenantId, dateKey), tenantId, dateKey,
      closedBy: `${closes.length} closes combined`,
      note: `Combined total of ${closes.length} closes of this date (${closes.map((c) => `${c.closedBy}${c.revision > 1 ? ` rev ${c.revision}` : ""}`).join(", ")}). This version shows one close per date; upgrade to see each register's and shift's close.`,
      createdAt: closes[closes.length - 1].createdAt,
      unsyncedCountAtClose: closes.reduce((sum, c) => sum + (c.unsyncedCountAtClose ?? 0), 0),
      costStatus: closes.every((c) => c.costStatus === "server") ? "server" : closes.some((c) => !c.costStatus || c.costStatus === "incomplete") ? "incomplete" : "complete",
    }
    for (const k of DAY_FIGURES) combined[k] = closes.reduce((sum, c) => sum + n((c as any)[k]), 0)
    for (const k of NULLABLE_FIGURES) combined[k] = closes.some((c) => (c as any)[k] === null || (c as any)[k] === undefined) ? null : closes.reduce((sum, c) => sum + n((c as any)[k]), 0)
    out.push(combined)
  }
  return out
}

/** A stable id for a date's combined close (a uuid-shaped hash: an older hub stores it as a close id). */
export function combinedCloseId(tenantId: string, dateKey: string): string {
  const h = createHash("sha256").update(`combined-close:${tenantId}:${dateKey}`).digest("hex")
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}
