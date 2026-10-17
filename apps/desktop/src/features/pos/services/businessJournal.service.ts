// Business journal (DURABILITY-2): a durable commit/recovery boundary for workflows that change
// several things on this device — checkout (lots, sale, debt, stock), void (sale status, stock,
// lots, debt) and stock adjustment (lots, stock, record).
//
// An entry is written BEFORE any effect, with the plan and a snapshot of the stock and lots the
// workflow will touch. Each workflow has one commit point (the record that makes it real: the
// sale, the Voided status, the adjustment). Its sync operations are staged and owned by the entry:
// generic staged recovery leaves them alone and only the entry settles them.
//
// On interruption (an exception in this session, or found open at startup):
//   committed     -> complete the missing effects, then release the operations;
//   not committed -> compensate what was applied, then remove the operations (never sent);
// every effect is checked against its snapshot: before -> not applied, expected -> applied,
// anything else -> the entry is BLOCKED and shown, with the figures, until a person closes it.
// Nothing is silently abandoned.
import { commitStagedSyncOperation, discardStagedSyncOperation, getCurrentTenantId, registerPreRecoveryHook, registerStagedOwner, registerStoreSwitchHook } from "./sync.service"
import { getCurrentUser, PermissionError, recordAuditEvent, userCan } from "./security.service"
import { createId } from "../lib/storage"

export const BUSINESS_JOURNAL_KEY = "lebanonpos.business-journal.v1"

export type JournalKind = "checkout" | "void" | "adjustment"
export type JournalEntry = {
  id: string
  kind: JournalKind
  tenantKey: string
  createdAt: string
  /** Sync operations staged for this workflow (settled only by this entry). */
  opIds: string[]
  /** What the workflow will do (kind-specific). */
  plan: Record<string, unknown>
  /** Stock (by product id) and lot quantities (by lot id) read before any effect. */
  before: { stock: Record<string, number>; lots: Record<string, number> }
  /** Steps whose effect is known to be applied. */
  done: Record<string, string>
  committed: boolean
  status: "open" | "blocked"
  blocked?: { reason: string; detail: string; at: string }
  closedByHand?: { by: string; note: string; at: string }
}

function tenantKey() {
  let t: string | null
  try { t = getCurrentTenantId() } catch { t = null }
  return t ? `tenant:${t}` : "unbound"
}
function readAll(): JournalEntry[] {
  try {
    const v = JSON.parse(localStorage.getItem(BUSINESS_JOURNAL_KEY) ?? "[]")
    return Array.isArray(v) ? v : []
  } catch { return [] }
}
function writeAll(list: JournalEntry[]) {
  localStorage.setItem(BUSINESS_JOURNAL_KEY, JSON.stringify(list))
}

/** Open entries of the current tenant (blocked ones included). */
export function getOpenJournalEntries(): JournalEntry[] {
  return readAll().filter((e) => e.tenantKey === tenantKey())
}
export function getBlockedJournalEntries(): JournalEntry[] {
  return getOpenJournalEntries().filter((e) => e.status === "blocked")
}

/** Write the entry first; throws (nothing done yet) when it cannot be saved. */
export function openJournalEntry(kind: JournalKind, plan: Record<string, unknown>, before: JournalEntry["before"], opIds: string[]): JournalEntry {
  const entry: JournalEntry = { id: createId("tx"), kind, tenantKey: tenantKey(), createdAt: new Date().toISOString(), opIds, plan, before, done: {}, committed: false, status: "open" }
  writeAll([...readAll(), entry])
  return entry
}

/** Best-effort progress update: if it cannot be saved, recovery re-derives it from the snapshots. */
export function saveJournalEntry(entry: JournalEntry): boolean {
  try {
    writeAll(readAll().map((e) => (e.id === entry.id ? entry : e)))
    return true
  } catch {
    return false
  }
}
export function markDone(entry: JournalEntry, step: string, extra?: Partial<JournalEntry>) {
  entry.done[step] = new Date().toISOString()
  if (extra) Object.assign(entry, extra)
  saveJournalEntry(entry)
}
export function closeJournalEntry(entry: JournalEntry): boolean {
  try {
    writeAll(readAll().filter((e) => e.id !== entry.id))
    return true
  } catch {
    return false
  }
}
export function blockJournalEntry(entry: JournalEntry, reason: string, detail: string) {
  entry.status = "blocked"
  entry.blocked = { reason, detail, at: new Date().toISOString() }
  saveJournalEntry(entry)
}

// A staged operation owned by an open entry is settled by that entry, not by generic recovery.
registerStagedOwner((opId) => readAll().some((e) => e.opIds.includes(opId)))

// ── snapshot checks ─────────────────────────────────────────────────────────
export type Check = "before" | "expected" | "ambiguous"
/** Where a quantity stands relative to a planned change (before -> before + delta). */
export function check(now: number | undefined, before: number | undefined, delta: number): Check {
  if (now === undefined || before === undefined) return "ambiguous"
  if (delta === 0) return "expected"
  if (Math.abs(now - before) < 1e-9) return "before"
  if (Math.abs(now - (before + delta)) < 1e-9) return "expected"
  return "ambiguous"
}

registerPreRecoveryHook(() => { recoverBusinessJournal() })
// A store switch replaces this store's data on the device: an entry still unfinished then can
// no longer be checked against it (on return its records are gone or pulled from the server).
registerStoreSwitchHook(() => {
  for (const entry of getOpenJournalEntries()) {
    if (entry.status === "blocked") continue
    blockJournalEntry(entry, "store_switch", `This store's data on this device was replaced by a store switch while this ${entry.kind} was unfinished (${entry.committed ? "recorded" : "not recorded"}); check it by hand.`)
  }
})

// ── recovery registry (each workflow's service registers how to settle its entries) ──
type Recoverer = (entry: JournalEntry) => "closed" | "blocked"
const recoverers = new Map<JournalKind, Recoverer>()
export function registerJournalRecoverer(kind: JournalKind, fn: Recoverer) {
  recoverers.set(kind, fn)
}

/**
 * Settle open entries of the current tenant (startup, before a flush or pull, before a store
 * switch). Blocked entries stay blocked until a person closes them.
 */
export function recoverBusinessJournal(): { closed: number; blocked: number } {
  const result = { closed: 0, blocked: 0 }
  for (const entry of getOpenJournalEntries()) {
    if (entry.status === "blocked") { result.blocked++; continue }
    const fn = recoverers.get(entry.kind)
    if (!fn) { result.blocked++; continue }
    try {
      const r = fn(entry)
      result[r === "closed" ? "closed" : "blocked"]++
    } catch (error) {
      console.error("[journal] recovery failed for", entry.id, error)
      result.blocked++
    }
  }
  return result
}

/**
 * A person checked a blocked entry (counted stock, looked at the lots) and closes it with a note.
 * Its staged operations are released if the commit point was reached, removed otherwise — the
 * caller passes the settle function so this module does not decide money or stock by itself.
 */
export function closeBlockedEntryByHand(entryId: string, by: string, note: string, settleOps: (entry: JournalEntry) => void) {
  const entry = readAll().find((e) => e.id === entryId && e.tenantKey === tenantKey())
  if (!entry || entry.status !== "blocked") return false
  if (!note.trim()) throw new Error("Say what you checked and did before closing it.")
  entry.closedByHand = { by, note: note.trim(), at: new Date().toISOString() }
  settleOps(entry)
  return closeJournalEntry(entry)
}

/**
 * Close a blocked entry after checking it by hand (inventory.adjust, audited). Its operations are
 * released when the commit point was reached (the sale/void/adjustment stands and the server must
 * learn of it), removed otherwise (it never happened on the server either).
 */
export function closeBlockedJournalEntry(entryId: string, note: string) {
  if (!userCan("inventory.adjust")) throw new PermissionError("You do not have permission to close an interrupted change.")
  const entry = getBlockedJournalEntries().find((e) => e.id === entryId)
  if (!entry) return false
  const by = getCurrentUser()?.name ?? "unknown"
  const ok = closeBlockedEntryByHand(entryId, by, note, (e) => {
    for (const id of e.opIds) {
      if (e.committed) commitStagedSyncOperation(id)
      else discardStagedSyncOperation(id)
    }
  })
  try {
    recordAuditEvent({
      action: "journal.closed_by_hand", entity: "sync",
      summary: `Interrupted ${entry.kind} closed by ${by}: ${note.trim()} [${entry.blocked?.detail ?? ""}]`,
      metadata: { entryId, kind: entry.kind, committed: entry.committed, step: entry.blocked?.reason ?? null },
    })
  } catch (error) { console.error("[journal] audit write failed:", error) }
  return ok
}
