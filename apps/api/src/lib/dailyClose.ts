/**
 * A store has one daily close per date (DailyClose @@unique([tenantId, dateKey])). A register may close
 * a date again ("This day was already closed."), which creates a new close id for the same date. The
 * newer close replaces the earlier one; the earlier close's figures are kept in an audit event, so a
 * closed report is never lost. Without this the second close failed on the unique index forever and
 * never reached the server, while the register showed it.
 */
import type prisma from "./prisma.js"

type Db = Pick<typeof prisma, "dailyClose" | "auditEvent">

/**
 * Before writing `close`: if another close of the same date exists, decide which one is the record.
 * `newerWins(existing)` says whether `close` replaces it (push: the close received now replaces;
 * a hub's pull: only a close created later). Returns false when `close` must not be written.
 */
export async function settleCloseOfDate(db: Db, tenantId: string, close: { id: string; dateKey: string; closedBy?: unknown }, newerWins: (existing: { createdAt: Date }) => boolean, by: string): Promise<boolean> {
  const existing = await db.dailyClose.findFirst({ where: { tenantId, dateKey: close.dateKey, NOT: { id: close.id } } })
  if (!existing) return true
  if (!newerWins(existing)) return false
  const { tenantId: _t, ...previous } = existing as Record<string, unknown>
  await db.auditEvent.create({ data: {
    tenantId, action: "day.close.superseded", entity: "accounting",
    summary: `${close.dateKey} was closed again by ${String(close.closedBy ?? "someone")}; the earlier close (by ${String((existing as any).closedBy ?? "someone")}) is kept here.`,
    metadata: JSON.parse(JSON.stringify({ previous, replacedBy: close.id, via: by })),
    userId: "__system__", userName: "Sync", userRole: "Admin",
  } as any })
  await db.dailyClose.delete({ where: { id: existing.id } })
  return true
}
