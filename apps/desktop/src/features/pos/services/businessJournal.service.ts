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
import { getCurrentUser, PermissionError, recordAuditEvent, userCan, type Permission } from "./security.service"
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

// ── Close by hand ──────────────────────────────────────────────────────────────
// A blocked entry is closed only after a person has seen exactly what it touched and what closing
// will do, with the permissions its money and stock need. Closing first RESOLVES every effect on
// this device to the shown target (recorded change: as planned; unrecorded: as before), then
// finishes the workflow (debt, movements) and only then releases or removes its operation — an
// operation is never sent with its local effects left unresolved.

export type JournalEffect = {
  kind: "stock" | "lot"
  /** Product id or lot id. */
  key: string
  label: string
  /** Recorded before the change, the planned change, and the value now (undefined: not on this device). */
  before: number | undefined
  delta: number
  now: number | undefined
}
export type JournalDescription = {
  effects: JournalEffect[]
  /** Settling this change decides money (a sale or void) and, for a debt sale, a customer balance. */
  money: "none" | "sale" | "debt"
  /** The change's own record is on this device (the sale, the Voided status, the adjustment). */
  recordHere: boolean
}
type Describer = (entry: JournalEntry) => JournalDescription
/** Finishes a workflow after its quantities were resolved: committed -> keep and send; else cancel. */
type Finisher = (entry: JournalEntry, keep: boolean) => void
const describers = new Map<JournalKind, Describer>()
const finishers = new Map<JournalKind, Finisher>()
export function registerJournalCloser(kind: JournalKind, describe: Describer, finish: Finisher) {
  describers.set(kind, describe)
  finishers.set(kind, finish)
}

export type ClosePreview = {
  entry: JournalEntry
  /** Recorded (the sale/void/adjustment stands and is sent) or not (cancelled, nothing sent). */
  outcome: "keep_and_send" | "cancel"
  effects: Array<JournalEffect & { target: number | undefined }>
  /** Effects this device cannot set (the product or lot is not here, e.g. after a store switch). */
  unresolvable: JournalEffect[]
  requiredPermissions: Permission[]
  missingPermissions: Permission[]
}

/** What closing this blocked entry would do: shown to the person before they confirm. */
export function previewBlockedJournalEntry(entryId: string): ClosePreview | null {
  const entry = getBlockedJournalEntries().find((e) => e.id === entryId)
  const describe = entry ? describers.get(entry.kind) : undefined
  if (!entry || !describe) return null
  const d = describe(entry)
  const keep = entry.committed || d.recordHere
  const effects = d.effects.map((e) => ({ ...e, target: e.before === undefined ? undefined : keep ? e.before + e.delta : e.before }))
  const required: Permission[] = d.money === "none" ? ["inventory.adjust"] : d.money === "debt" ? ["sales.void", "inventory.adjust", "customers.manage"] : ["sales.void", "inventory.adjust"]
  return {
    entry,
    outcome: keep ? "keep_and_send" : "cancel",
    effects,
    unresolvable: effects.filter((e) => e.now === undefined || e.target === undefined),
    requiredPermissions: required,
    missingPermissions: required.filter((p) => !userCan(p)),
  }
}

/**
 * Close a blocked entry by hand. Requires the permissions its money and stock need, a note, and
 * the person's acknowledgement of the preview they saw (same outcome and targets). Effects that
 * cannot be resolved on this device block the close.
 */
export function closeBlockedJournalEntry(entryId: string, note: string, acknowledged: Pick<ClosePreview, "outcome" | "effects">) {
  const preview = previewBlockedJournalEntry(entryId)
  if (!preview) return false
  if (preview.missingPermissions.length > 0) {
    throw new PermissionError(`Closing this ${preview.entry.kind} needs: ${preview.missingPermissions.join(", ")}.`)
  }
  if (!note.trim()) throw new Error("Say what you checked and did before closing it.")
  const sameTargets = acknowledged.outcome === preview.outcome
    && acknowledged.effects.length === preview.effects.length
    && acknowledged.effects.every((e, i) => e.key === preview.effects[i].key && e.target === preview.effects[i].target)
  if (!sameTargets) throw new Error("The figures changed since you reviewed them: review the change again before closing it.")
  if (preview.unresolvable.length > 0) {
    throw new Error(`These effects cannot be resolved on this device: ${preview.unresolvable.map((e) => e.label).join(", ")}. Refresh this store's data first.`)
  }
  const entry = preview.entry
  const keep = preview.outcome === "keep_and_send"
  const by = getCurrentUser()?.name ?? "unknown"
  // 1. Resolve every effect to its shown target (local only: the server's effects come from the
  //    operation itself, or never happen).
  setLocalQuantities(
    Object.fromEntries(preview.effects.filter((e) => e.kind === "stock").map((e) => [e.key, e.target!])),
    Object.fromEntries(preview.effects.filter((e) => e.kind === "lot").map((e) => [e.key, e.target!])),
  )
  // 2. Finish the workflow (debt, movements), 3. then release or remove its operations.
  finishers.get(entry.kind)!(entry, keep)
  for (const id of entry.opIds) {
    if (keep) commitStagedSyncOperation(id)
    else discardStagedSyncOperation(id)
  }
  entry.closedByHand = { by, note: note.trim(), at: new Date().toISOString() }
  const closed = closeJournalEntry(entry)
  try {
    recordAuditEvent({
      action: "journal.closed_by_hand", entity: "sync",
      summary: `Interrupted ${entry.kind} ${keep ? "kept and sent" : "cancelled"} by ${by}: ${note.trim()} [${preview.effects.map((e) => `${e.label} ${e.now}→${e.target}`).join("; ")}]`,
      metadata: { entryId, kind: entry.kind, outcome: preview.outcome, step: entry.blocked?.reason ?? null },
    })
  } catch (error) { console.error("[journal] audit write failed:", error) }
  return closed
}

// Local quantity setters live with their data; the journal receives them at startup (no cycle).
let setLocalQuantities: (stock: Record<string, number>, lots: Record<string, number>) => void = () => {
  throw new Error("Quantity setters are not registered.")
}
export function registerLocalQuantitySetter(fn: typeof setLocalQuantities) {
  setLocalQuantities = fn
}
