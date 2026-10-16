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
import type { ReceiveBatchInput } from "./inventoryBatch.service"

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

/** The purchase order of a delivery, reported apart from the stock it received. */
export type PurchaseOrderOutcome = { status: "recorded" | "failed" | "not_needed"; id?: string; number?: string; total?: number; error?: string }
/** The supplier payment of a delivery, reported apart from its purchase order. "waiting": the PO is not recorded yet. */
export type PaymentOutcome = { status: "recorded" | "failed" | "on_account" | "not_needed" | "waiting"; id?: string; amount: number; method?: string; error?: string }
export type ReceiveFinance = { purchaseOrder: PurchaseOrderOutcome; payment: PaymentOutcome }

/** What the products write decided, recorded right after it (see product.service receiveProducts). */
export type ReceivePlan = {
  results: Array<{ accepted: boolean; error?: string }>
  lots: ReceiveBatchInput[]
  createdProductIds: number[]
  modifiedProductIds: number[]
}
export type ReceiveAuditEntry = { at: string; by: string; action: string; detail?: string }
export type ReceiveEntryRecord = {
  rowId?: string; name: string; barcode: string; category: string; quantity: number; cost: number; price: number
  reorderPoint?: number; reorderQuantity?: number; expiryDate?: string
  attachAliasToProductId?: number; parentId?: number; variantName?: string
}

/**
 * Journal steps: "products" (catalog + stock, one storage write), "followUps" (product sync, lots,
 * movements, receive operation), "finance" (purchase order + payment), and for an undo
 * "undo:<n>:start" / "undo:<n>:done" around each reversal.
 */
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
  /** What was sent, so an interrupted save can be completed exactly as it was asked (images dropped). */
  entries?: ReceiveEntryRecord[]
  context?: { supplierId?: string; supplierName?: string; invoiceNumber?: string; paymentMethod?: string; note?: string }
  /** Stock of the existing products the entries touch, read just before writing. */
  stockBefore?: Record<string, number>
  steps?: Record<string, string>
  plan?: ReceivePlan
  finance?: ReceiveFinance
  /** A started submission closed without completing it: undone (effects reversed) or by hand. */
  resolution?: "undone" | "manual"
  resolutionNote?: string
  resolvedAt?: string
  recovered?: boolean
  audit?: ReceiveAuditEntry[]
}

/** The save was interrupted after it began writing: what reached stock is unknown. */
export class ReceiveOutcomeUnknownError extends Error {
  submissionId: string
  constructor(submissionId: string, cause?: unknown) {
    super(`Delivery ${submissionId}: the save was interrupted; review its effects before saving again.`)
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
const financeOpen = (s: ReceiveSubmission) =>
  s.finance?.purchaseOrder.status === "failed" || s.finance?.payment.status === "failed" || s.finance?.payment.status === "waiting"
const needsAttention = (s: ReceiveSubmission) => s.status === "started" || (s.status === "committed" && financeOpen(s))
function writeSubmission(sub: ReceiveSubmission) {
  const ledger = readLedger()
  const mine = { ...(ledger[sub.tenantKey] ?? {}), [sub.id]: sub }
  // Keep the newest entries, but never drop one that still needs attention.
  const all = Object.values(mine).sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  const keep = all.filter((s, i) => i < LEDGER_KEEP || needsAttention(s))
  ledger[sub.tenantKey] = Object.fromEntries(keep.map((s) => [s.id, s]))
  // Synchronous on purpose: every journal entry is on disk before the next write begins.
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

/** Received deliveries whose purchase order or payment did not go through (retry is idempotent). */
export function getReceiveFinanceIssues(): ReceiveSubmission[] {
  return Object.values(readLedger()[currentTenantKey()] ?? {}).filter((s) => s.status === "committed" && financeOpen(s))
}

export function beginReceiveSubmission(id: string, rowIds: string[], extra?: Pick<ReceiveSubmission, "entries" | "context" | "stockBefore">): ReceiveSubmission {
  const sub: ReceiveSubmission = { id, tenantKey: currentTenantKey(), rowIds, startedAt: new Date().toISOString(), status: "started", steps: {}, ...extra }
  writeSubmission(sub)
  return sub
}

/** Read-modify-write of one submission of the current tenant. */
export function patchReceiveSubmission(id: string, patch: (s: ReceiveSubmission) => ReceiveSubmission): ReceiveSubmission {
  const cur = getReceiveSubmission(id)
  if (!cur) throw new Error(`Delivery ${id} is not on this device for this store.`)
  const next = patch(cur)
  writeSubmission(next)
  return next
}

export function markReceiveStep(id: string, step: string, extra?: Partial<ReceiveSubmission>): ReceiveSubmission {
  return patchReceiveSubmission(id, (s) => ({ ...s, ...extra, steps: { ...(s.steps ?? {}), [step]: new Date().toISOString() } }))
}

export function commitReceiveSubmission(id: string, results: ReceiveRowResult[], summary: ReceiveOutcomeSummary, finance: ReceiveFinance, extra?: Partial<ReceiveSubmission>): ReceiveSubmission {
  return patchReceiveSubmission(id, (s) => ({ ...s, ...extra, status: "committed", committedAt: new Date().toISOString(), results, summary, finance }))
}

export function noteReceiveFailure(id: string, failure: string) {
  patchReceiveSubmission(id, (s) => ({ ...s, failure }))
}

export function appendReceiveAudit(id: string, entry: Omit<ReceiveAuditEntry, "at">) {
  return patchReceiveSubmission(id, (s) => ({ ...s, audit: [...(s.audit ?? []), { ...entry, at: new Date().toISOString() }] }))
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
    // Undone: nothing of it remains, the rows are editable again. Closed by hand: the rows stay,
    // marked, because only the person who closed it knows what was received.
    const sent = new Set(sub.rowIds)
    const rows = sub.resolution === "manual"
      ? draft.rows.map((r) => (sent.has(r.id) ? { ...r, saveError: "closed by hand: save again only if it was not received" } : r))
      : draft.rows
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
