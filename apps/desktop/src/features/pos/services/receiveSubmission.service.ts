// Receiving recovery: every delivery save is a submission with its own id, recorded in a
// per-tenant ledger around the local writes. The ledger answers "was this delivery already
// received?" after a crash or a retry, so a save is never applied twice and an interrupted
// one is never silently resent or discarded.
//
//   started   - the writes began; if no `committed` follows, the outcome is UNKNOWN (some of
//               products, lots, purchase order and payment may be written). A manager decides.
//   committed - the writes finished; `results` say which rows were received, by row id.
//   resolved  - an unknown outcome a person has reconciled (received / not received).
//
// Drafts (the delivery being typed) live here too, keyed by the same immutable tenant id:
// switching stores wipes store data but not these keys, so a draft from store A is never
// shown in, or received into, store B. With no tenant id (local-only device) the key is
// "unbound", which is only ever restored to an equally unbound session.
import { getCurrentTenantId } from "./sync.service"
import { applyReceiveResults, createRow, type ReceiveDraft } from "../lib/receiveRows"

export const RECEIVE_LEDGER_KEY = "lebanonpos.receive-submissions.v1"
export const RECEIVE_DRAFTS_KEY = "lebanonpos.receive-drafts.v2"
const LEDGER_KEEP = 50

export type ReceiveRowResult = { rowId: string; status: "accepted" | "rejected"; reason?: string }
export type ReceiveOutcomeSummary = {
  acceptedCount: number
  rejectedCount: number
  productsCreated: number
  productsUpdated: number
  batchesCreated: number
  poNumber?: string
  paymentRecorded: boolean
  totalValue: number
  units: number
}
export type ReceiveSubmission = {
  id: string
  tenantKey: string
  rowIds: string[]
  startedAt: string
  status: "started" | "committed" | "resolved"
  committedAt?: string
  results?: ReceiveRowResult[]
  summary?: ReceiveOutcomeSummary
  /** Why a started submission did not commit (the thrown error), when known. */
  failure?: string
  resolution?: "received" | "not_received"
  resolvedAt?: string
}

/** The save was interrupted after it began writing: what reached stock is unknown. */
export class ReceiveOutcomeUnknownError extends Error {
  submissionId: string
  constructor(submissionId: string, cause?: unknown) {
    super(`Delivery ${submissionId}: the save was interrupted; check lots before saving again.`)
    this.name = "ReceiveOutcomeUnknownError"
    this.submissionId = submissionId
    this.cause = cause
  }
}

export function currentTenantKey(): string {
  let tenantId: string | null
  try { tenantId = getCurrentTenantId() } catch { tenantId = null }
  return tenantId ? `tenant:${tenantId}` : "unbound"
}

type Ledger = Record<string, Record<string, ReceiveSubmission>>
function readLedger(): Ledger {
  try {
    const v = JSON.parse(localStorage.getItem(RECEIVE_LEDGER_KEY) ?? "{}")
    return v && typeof v === "object" && !Array.isArray(v) ? v : {}
  } catch { return {} }
}
function writeSubmission(sub: ReceiveSubmission) {
  const ledger = readLedger()
  const mine = { ...(ledger[sub.tenantKey] ?? {}), [sub.id]: sub }
  // Keep the newest entries, but never drop an unresolved (started) one.
  const all = Object.values(mine).sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  const keep = all.filter((s, i) => i < LEDGER_KEEP || s.status === "started")
  ledger[sub.tenantKey] = Object.fromEntries(keep.map((s) => [s.id, s]))
  // Synchronous on purpose: this must be on disk before (started) and after (committed) the writes.
  localStorage.setItem(RECEIVE_LEDGER_KEY, JSON.stringify(ledger))
}

/** A submission of the current tenant (never another tenant's). */
export function getReceiveSubmission(id: string): ReceiveSubmission | undefined {
  return readLedger()[currentTenantKey()]?.[id]
}

/** Interrupted saves of the current tenant still waiting for a person to reconcile them. */
export function getUnresolvedReceiveSubmissions(): ReceiveSubmission[] {
  return Object.values(readLedger()[currentTenantKey()] ?? {}).filter((s) => s.status === "started")
}

export function beginReceiveSubmission(id: string, rowIds: string[]): ReceiveSubmission {
  const sub: ReceiveSubmission = { id, tenantKey: currentTenantKey(), rowIds, startedAt: new Date().toISOString(), status: "started" }
  writeSubmission(sub)
  return sub
}

export function commitReceiveSubmission(sub: ReceiveSubmission, results: ReceiveRowResult[], summary: ReceiveOutcomeSummary): ReceiveSubmission {
  const next: ReceiveSubmission = { ...sub, status: "committed", committedAt: new Date().toISOString(), results, summary }
  writeSubmission(next)
  return next
}

export function noteReceiveFailure(sub: ReceiveSubmission, failure: string) {
  writeSubmission({ ...sub, failure })
}

/** A person reconciled an interrupted save after checking lots and stock. */
export function resolveReceiveSubmission(id: string, resolution: "received" | "not_received"): ReceiveSubmission | undefined {
  const sub = getReceiveSubmission(id)
  if (!sub || sub.status !== "started") return sub
  const next: ReceiveSubmission = { ...sub, status: "resolved", resolution, resolvedAt: new Date().toISOString() }
  writeSubmission(next)
  return next
}

// ── Drafts, per tenant ────────────────────────────────────────────────────────
function readDrafts(): Record<string, unknown> {
  try {
    const v = JSON.parse(localStorage.getItem(RECEIVE_DRAFTS_KEY) ?? "{}")
    return v && typeof v === "object" && !Array.isArray(v) ? v : {}
  } catch { return {} }
}

/** The raw draft JSON of the current tenant (parse with parseDraft). Other tenants' drafts are invisible. */
export function readReceiveDraftRaw(): string | null {
  const d = readDrafts()[currentTenantKey()]
  return d ? JSON.stringify(d) : null
}

export function writeReceiveDraft(serialized: string) {
  const drafts = readDrafts()
  const value = JSON.parse(serialized) as ReceiveDraft
  drafts[currentTenantKey()] = { ...value, tenantKey: currentTenantKey() }
  localStorage.setItem(RECEIVE_DRAFTS_KEY, JSON.stringify(drafts))
}

export function clearReceiveDraft() {
  const drafts = readDrafts()
  delete drafts[currentTenantKey()]
  localStorage.setItem(RECEIVE_DRAFTS_KEY, JSON.stringify(drafts))
}

// ── Reopening a draft that had a save in flight ──────────────────────────────
export type DraftRecovery =
  | { kind: "none" }
  /** The save finished before the app closed: its accepted rows are removed now. */
  | { kind: "committed"; submissionId: string; accepted: number; rejected: number; units: number }
  /** The save began writing and never finished: rows stay, locked, until a person reconciles. */
  | { kind: "unknown"; submissionId: string }

/**
 * What a reopened draft should show, decided only by its pending submission's ledger entry:
 * committed -> drop the accepted rows (retrying would receive them twice); started -> unknown;
 * resolved -> apply the person's decision; no entry -> the save never began, nothing was written.
 */
export function recoverReceiveDraft(draft: ReceiveDraft): { draft: ReceiveDraft; recovery: DraftRecovery } {
  const pending = draft.pending
  if (!pending) return { draft, recovery: { kind: "none" } }
  const sub = getReceiveSubmission(pending.submissionId)
  if (!sub) return { draft: { ...draft, pending: undefined }, recovery: { kind: "none" } }
  if (sub.status === "started") return { draft, recovery: { kind: "unknown", submissionId: sub.id } }
  if (sub.status === "resolved") {
    const sent = new Set(sub.rowIds)
    const rows = sub.resolution === "received" ? draft.rows.filter((r) => !sent.has(r.id)) : draft.rows
    return { draft: { ...draft, rows: rows.length ? rows : [createRow()], pending: undefined }, recovery: { kind: "none" } }
  }
  const results = sub.results ?? []
  return {
    draft: { ...draft, rows: applyReceiveResults(draft.rows, results), pending: undefined },
    recovery: {
      kind: "committed", submissionId: sub.id,
      accepted: results.filter((r) => r.status === "accepted").length,
      rejected: results.filter((r) => r.status === "rejected").length,
      units: sub.summary?.units ?? 0,
    },
  }
}
