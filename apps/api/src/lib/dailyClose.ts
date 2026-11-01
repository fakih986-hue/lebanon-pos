/**
 * Which daily close a close is (DailyClose: scope, revision, revisionOf, supersededById).
 *
 * A date is not one close: a café may close several registers and shifts on one date. A close belongs to
 * its SCOPE — the register that made it and the shift it was made in ("store" when the register sends
 * neither: older registers, and closes recorded before scopes). For one scope:
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
import type prisma from "./prisma.js"

type Db = Pick<typeof prisma, "dailyClose" | "auditEvent" | "$executeRaw">

export class CloseConflictError extends Error {
  constructor(message: string) { super(`CLOSE_CONFLICT: ${message}`); this.name = "CloseConflictError" }
}

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)

/** The scope of a close as the register sent it (registerId, else deviceId; and its shift). */
export function closeScope(submitted: Record<string, unknown> | null | undefined): { scope: string; registerId: string | null; shiftId: string | null } {
  const registerId = text(submitted?.registerId) ?? text(submitted?.deviceId)
  const shiftId = text(submitted?.shiftId)
  return { scope: registerId ? `register:${registerId}${shiftId ? `|shift:${shiftId}` : ""}` : "store", registerId, shiftId }
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
