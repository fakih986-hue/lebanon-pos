// Receiving recovery: what an interrupted delivery save actually wrote, and the audited,
// permission-controlled ways to settle it.
//
// Every effect of a submission has an id derived from it (receiveSubmission.service), so it can
// be found again: new products (syncId <sub>-p<n>), lots (<sub>-lot-<n>), movements (<sub>-mv-<n>),
// sync operations (<sub>-op-…), the purchase order (<sub>-po) and payment (<sub>-pay). Product
// stock has no id of its own: the journal's "products" step says it was written, and before it
// the stock read just before the save tells whether it moved.
//
//   complete   - run the missing steps (idempotent; each step skips what exists)  inventory.receive
//   undo       - reverse what was applied (stock adjustments against untouched lots,
//                local revert of stock whose lot never existed)                    inventory.adjust
//   close      - by hand, with a note, when neither is safe                        inventory.adjust
//   retry finance - purchase order / payment of a received delivery               suppliers.manage
//                                                                                 (PO only: inventory.receive)
// When an action is not safe the submission stays blocked and the reasons say what to check.
import { getCurrentUser, PermissionError, recordAuditEvent, userCan, type Permission } from "./security.service"
import { enqueueSyncOperation, getSyncQueue, type SyncOperation } from "./sync.service"
import { getInventoryBatches, getStockMovements } from "./inventoryBatch.service"
import { recordStockAdjustment } from "./inventoryAdjustment.service"
import {
  appendReceiveAudit, getReceiveSubmission, markReceiveStep, noteReceiveFailure, patchReceiveSubmission,
  ReceiveOutcomeUnknownError, type ReceiveSubmission,
} from "./receiveSubmission.service"

export type EffectState = "applied" | "missing" | "unknown" | "n/a"
export type RecoveryReason = { code: string; params?: Record<string, string | number> }
export type RowEffects = {
  index: number
  rowId: string
  name: string
  barcode: string
  quantity: number
  /** null: the products step was never journaled, so acceptance is not known. */
  accepted: boolean | null
  reason?: string
  productId?: number
  newProduct: boolean
  stock: { state: EffectState; before?: number; now?: number; expected?: number }
  lot: { state: EffectState; id: string; number?: string; remaining?: number; initial?: number; touched?: boolean }
  movement: { state: EffectState; id: string }
}
export type OperationEffect = { id: string; label: string; state: "queued" | "sent" | "failed" | "rejected" | "not_in_queue"; error?: string }
export type SubmissionEffects = {
  submission: ReceiveSubmission
  rows: RowEffects[]
  purchaseOrder: { state: EffectState; id: string; number?: string; status?: string; paymentStatus?: string; total?: number }
  payment: { state: EffectState; id: string; amount?: number; method?: string }
  operations: OperationEffect[]
  complete: { safe: boolean; reasons: RecoveryReason[] }
  undo: { safe: boolean; reasons: RecoveryReason[] }
  can: { complete: boolean; undo: boolean; close: boolean; retryFinance: boolean }
}

/** Recovery refused because it is not safe: the submission stays blocked; `reasons` say why. */
export class ReceiveRecoveryBlockedError extends Error {
  reasons: RecoveryReason[]
  constructor(reasons: RecoveryReason[]) {
    super(`Recovery is not safe: ${reasons.map((r) => r.code).join(", ")}`)
    this.name = "ReceiveRecoveryBlockedError"
    this.reasons = reasons
  }
}

const lotId = (sub: string, i: number) => `${sub}-lot-${i}`
const mvId = (sub: string, i: number) => `${sub}-mv-${i}`

function requireSubmission(id: string): ReceiveSubmission {
  const s = getReceiveSubmission(id)
  // Tenant-scoped: another store's submission is simply not found here.
  if (!s) throw new Error(`Delivery ${id} is not on this device for this store.`)
  return s
}
function requirePermission(permission: Permission, what: string) {
  if (!userCan(permission)) throw new PermissionError(`You do not have permission to ${what}.`)
}
function opState(op: SyncOperation | undefined): OperationEffect["state"] {
  if (!op) return "not_in_queue"
  return op.status === "Synced" ? "sent" : op.status === "Failed" ? "failed" : op.status === "Rejected" ? "rejected" : "queued"
}

async function loadProducts() { return import("./product.service") }

/** The effects actually found on this device for a submission, and whether each action is safe. */
export async function inspectReceiveSubmission(id: string): Promise<SubmissionEffects> {
  const products = await loadProducts()
  const sub = requireSubmission(id)
  const all = products.getProductsSync()
  const lots = getInventoryBatches()
  const movements = getStockMovements()
  const queue = getSyncQueue()
  const plan = sub.plan
  const productsDone = !!sub.steps?.products
  const entries = sub.entries ?? []

  const asWritten = (id: number | undefined, syncId: string | undefined) =>
    id == null ? undefined : all.find((p) => p.id === id && (!syncId || p.syncId === syncId))
  const rows: RowEffects[] = entries.map((e, i) => {
    const res = plan?.results[i]
    const accepted = productsDone ? res?.accepted !== false : null
    const created = all.find((p) => p.syncId === `${sub.id}-p${i}`)
    const lotInput = plan?.lots.find((l) => l.id === lotId(sub.id, i))
    const existing = e.attachAliasToProductId != null ? all.find((p) => p.id === e.attachAliasToProductId) : products.findProductByBarcode(e.barcode) ?? undefined
    const productId = lotInput?.productId ?? created?.id ?? existing?.id
    // The product as this delivery wrote it: same numeric id AND same syncId. After a store switch
    // or a pull, numeric ids can belong to other products (the demo catalogue starts at 1).
    const product = asWritten(productId, lotInput?.productSyncId)
    const newProduct = !!created || (productsDone && !!productId && (plan?.createdProductIds ?? []).includes(productId))
    // A product this delivery created had no stock before it.
    const before = productId != null ? sub.stockBefore?.[String(productId)] ?? (newProduct ? 0 : undefined) : undefined
    let stock: RowEffects["stock"]
    if (accepted === false) stock = { state: "n/a" }
    else if (productsDone) stock = { state: "applied", before, now: product?.stock, expected: before != null ? before + e.quantity : undefined }
    else if (created) stock = { state: "applied", before: 0, now: created.stock, expected: e.quantity }
    else if (existing && before != null) stock = existing.stock === before ? { state: "missing", before, now: existing.stock, expected: before + e.quantity } : { state: "unknown", before, now: existing.stock, expected: before + e.quantity }
    else stock = { state: existing ? "unknown" : "missing", now: existing?.stock }
    const lot = lots.find((b) => b.id === lotId(sub.id, i))
    const mv = movements.find((m) => m.id === mvId(sub.id, i))
    return {
      index: i, rowId: e.rowId ?? String(i), name: e.name || product?.name || e.barcode, barcode: e.barcode, quantity: e.quantity,
      accepted, reason: res?.accepted === false ? res.error : undefined, productId, newProduct,
      stock,
      lot: accepted === false ? { state: "n/a", id: lotId(sub.id, i) } : lot
        ? { state: "applied", id: lot.id, number: lot.batchNumber, remaining: lot.quantityRemaining, initial: lot.initialQuantity, touched: lot.quantityRemaining < lot.initialQuantity }
        : { state: "missing", id: lotId(sub.id, i) },
      movement: accepted === false ? { state: "n/a", id: mvId(sub.id, i) } : { state: mv ? "applied" : "missing", id: mvId(sub.id, i) },
    }
  })

  const po = (await import("./supplier.service")).getPurchaseOrders().find((o) => o.id === `${sub.id}-po`)
  const pay = (await import("./supplier.service")).getSupplierPayments().find((p) => p.id === `${sub.id}-pay`)
  const needsFinance = !!sub.context?.supplierId
  const purchaseOrder = { state: (po ? "applied" : needsFinance ? "missing" : "n/a") as EffectState, id: `${sub.id}-po`, number: po?.poNumber, status: po?.status, paymentStatus: po?.paymentStatus, total: po?.total }
  const payNeeded = needsFinance && sub.context?.paymentMethod && sub.context.paymentMethod !== "On Account"
  const payment = { state: (pay ? "applied" : payNeeded ? "missing" : "n/a") as EffectState, id: `${sub.id}-pay`, amount: pay?.amount, method: pay?.method ?? sub.context?.paymentMethod }

  const opIds: Array<[string, string]> = []
  if ((plan?.createdProductIds.length ?? 0) > 0 || rows.some((r) => r.newProduct)) opIds.push([`${sub.id}-op-products`, "products"])
  for (const pid of plan?.modifiedProductIds ?? []) opIds.push([`${sub.id}-op-product-${pid}`, `product:${all.find((p) => p.id === pid)?.name ?? pid}`])
  if (rows.some((r) => r.accepted !== false)) opIds.push([`${sub.id}-op-receive`, "receive"])
  if (needsFinance) opIds.push([`${sub.id}-op-po`, "po"], [`${sub.id}-op-po-received`, "po_received"])
  if (payNeeded) opIds.push([`${sub.id}-op-pay`, "payment"])
  const operations: OperationEffect[] = opIds.map(([oid, label]) => {
    const op = queue.find((o) => o.id === oid)
    return { id: oid, label, state: opState(op), error: op?.error }
  })

  // ── safety ──
  const completeReasons: RecoveryReason[] = []
  const undoReasons: RecoveryReason[] = []
  if (!productsDone) {
    for (const r of rows) {
      if (r.stock.state === "applied") completeReasons.push({ code: "products_unrecorded", params: { name: r.name } })
      if (r.stock.state === "unknown") completeReasons.push({ code: "stock_changed", params: { name: r.name, before: r.stock.before ?? "?", now: r.stock.now ?? "?" } })
    }
    undoReasons.push(...completeReasons)
  } else {
    for (const r of rows) {
      if (r.accepted === false) continue
      const lotInput = plan?.lots.find((l) => l.id === r.lot.id)
      if (!asWritten(r.productId, lotInput?.productSyncId)) {
        completeReasons.push({ code: "product_missing", params: { name: r.name } })
        undoReasons.push({ code: "product_missing", params: { name: r.name } })
      }
    }
    const receiveOp = operations.find((o) => o.label === "receive")
    if (!sub.steps?.followUps && receiveOp?.state === "not_in_queue") {
      for (const r of rows) if (r.lot.touched) completeReasons.push({ code: "lot_sold_unsent", params: { name: r.name, lot: r.lot.number ?? r.lot.id, sold: (r.lot.initial ?? 0) - (r.lot.remaining ?? 0) } })
    }
    for (const r of rows) {
      if (r.accepted === false) continue
      if (r.lot.touched) undoReasons.push({ code: "lot_sold", params: { name: r.name, lot: r.lot.number ?? r.lot.id, sold: (r.lot.initial ?? 0) - (r.lot.remaining ?? 0) } })
      const product = asWritten(r.productId, plan?.lots.find((l) => l.id === r.lot.id)?.productSyncId)
      if (product && r.lot.state === "missing" && product.stock < r.quantity) undoReasons.push({ code: "stock_low", params: { name: r.name, now: product.stock, qty: r.quantity } })
      if (sub.steps?.[`undo:${r.index}:start`] && !sub.steps?.[`undo:${r.index}:done`]) undoReasons.push({ code: "undo_interrupted", params: { name: r.name } })
    }
  }
  if (po) undoReasons.push({ code: "po_exists", params: { number: po.poNumber, total: po.total } })
  if (pay) undoReasons.push({ code: "payment_exists", params: { amount: pay.amount } })
  const started = sub.status === "started"
  return {
    submission: sub, rows, purchaseOrder, payment, operations,
    complete: { safe: started && completeReasons.length === 0, reasons: completeReasons },
    undo: { safe: started && undoReasons.length === 0, reasons: undoReasons },
    can: {
      complete: userCan("inventory.receive"), undo: userCan("inventory.adjust"), close: userCan("inventory.adjust"),
      retryFinance: sub.finance?.payment.status === "failed" || sub.finance?.payment.status === "waiting" ? userCan("suppliers.manage") : userCan("inventory.receive"),
    },
  }
}

function audit(sub: ReceiveSubmission, action: string, detail: string, metadata?: Record<string, string | number | boolean | null | undefined>) {
  const by = getCurrentUser()?.name ?? "unknown"
  appendReceiveAudit(sub.id, { by, action, detail })
  recordAuditEvent({ action: `inventory.receive.${action}`, entity: "inventory", summary: `Delivery ${sub.id}: ${detail}`, metadata: { submissionId: sub.id, ...metadata } })
}

/**
 * Complete an interrupted save: run the steps that are missing, exactly as the save asked for
 * them. Idempotent: a second call (or one after a restart mid-recovery) finds the submission
 * committed, or resumes from the last journaled step.
 */
export async function completeReceiveSubmission(id: string) {
  requirePermission("inventory.receive", "complete an interrupted delivery")
  const sub = requireSubmission(id)
  const supplier = await import("./supplier.service")
  if (sub.status === "committed") return supplier.receiveAndRecord([], undefined, { submissionId: id }) // replay, writes nothing
  if (sub.status !== "started") throw new Error(`Delivery ${id} was already closed (${sub.resolution}).`)
  const effects = await inspectReceiveSubmission(id)
  if (!effects.complete.safe) throw new ReceiveRecoveryBlockedError(effects.complete.reasons)
  audit(sub, "recovery_complete_started", "completing the missing steps", { productsStep: !!sub.steps?.products, followUpsStep: !!sub.steps?.followUps })
  try {
    const summary = supplier.runReceiveSteps(
      (sub.entries ?? []).map((e) => ({ ...e })),
      sub.context as Parameters<typeof supplier.runReceiveSteps>[1],
      id, await loadProducts(), { recovered: true },
    )
    audit(requireSubmission(id), "recovery_completed", `completed: ${summary.units} units, PO ${summary.purchaseOrder.status}, payment ${summary.payment.status}`, { units: summary.units })
    return summary
  } catch (err) {
    // Still started: the journal says how far it got; the next attempt resumes from there.
    try { noteReceiveFailure(id, String((err as Error)?.message ?? err)) } catch { /* keep the entry */ }
    throw new ReceiveOutcomeUnknownError(id, err)
  }
}

/**
 * Undo an interrupted save: reverse what it applied, without touching what it did not. Only when
 * no purchase order or payment exists and no lot of it was sold from. Each reversal is journaled
 * (start/done); one that started and did not finish blocks further automatic undo.
 */
export async function undoReceiveSubmission(id: string) {
  requirePermission("inventory.adjust", "undo an interrupted delivery")
  const sub = requireSubmission(id)
  if (sub.status === "resolved" && sub.resolution === "undone") return sub
  if (sub.status !== "started") throw new Error(`Delivery ${id} is ${sub.status}; only an interrupted delivery can be undone.`)
  const effects = await inspectReceiveSubmission(id)
  if (!effects.undo.safe) throw new ReceiveRecoveryBlockedError(effects.undo.reasons)
  const products = await loadProducts()
  audit(sub, "recovery_undo_started", "reversing the applied steps")
  if (sub.steps?.products) {
    const present = getInventoryBatches().filter((b) => effects.rows.some((r) => r.lot.state === "applied" && r.lot.id === b.id))
    if (present.length > 0) {
      // The lots' receive must reach the server before the adjustments that take them back.
      enqueueSyncOperation({
        id: `${id}-op-receive`, entity: "inventory", action: "receive",
        summary: `${present.length} inventory batch${present.length === 1 ? "" : "es"} queued for sync.`,
        payload: present.map((b) => ({ ...b, quantityRemaining: b.initialQuantity, status: "Open" as const })),
      })
    }
    for (const r of effects.rows) {
      if (r.accepted === false || r.productId == null) continue
      if (sub.steps?.[`undo:${r.index}:done`]) continue
      markReceiveStep(id, `undo:${r.index}:start`)
      if (r.lot.state === "applied") {
        recordStockAdjustment({
          id: `${id}-undo-${r.index}`, productId: r.productId, quantityChange: -r.quantity,
          reason: "Manual Correction", batchId: r.lot.id, note: `Undo interrupted delivery ${id}`,
        })
      } else if (r.stock.state === "applied") {
        products.revertUnsentReceiveStock(r.productId, r.quantity)
      }
      markReceiveStep(id, `undo:${r.index}:done`)
    }
  }
  const done = patchReceiveSubmission(id, (s) => ({ ...s, status: "resolved", resolution: "undone", resolvedAt: new Date().toISOString() }))
  audit(done, "recovery_undone", "applied steps reversed; new products stay in the catalog at their current stock")
  return requireSubmission(id)
}

/** Close an interrupted save by hand (neither completing nor undoing it is safe). Needs a note. */
export async function closeReceiveSubmissionByHand(id: string, note: string) {
  requirePermission("inventory.adjust", "close an interrupted delivery by hand")
  const sub = requireSubmission(id)
  if (sub.status !== "started") return sub
  if (!note.trim()) throw new Error("Say what you checked and did (counts, adjustments) before closing it.")
  const effects = await inspectReceiveSubmission(id)
  const snapshot = effects.rows.map((r) => `${r.name}: stock ${r.stock.state}, lot ${r.lot.state}`).join("; ")
  const done = patchReceiveSubmission(id, (s) => ({ ...s, status: "resolved", resolution: "manual", resolutionNote: note.trim(), resolvedAt: new Date().toISOString() }))
  audit(done, "recovery_closed_by_hand", `${note.trim()} [${snapshot}; PO ${effects.purchaseOrder.state}; payment ${effects.payment.state}]`)
  return requireSubmission(id)
}

/** Retry the purchase order and/or payment of a received delivery. Idempotent (fixed ids). */
export async function retryReceiveFinance(id: string) {
  const sub = requireSubmission(id)
  if (sub.status !== "committed" || !sub.finance) throw new Error(`Delivery ${id} has no purchase order or payment to retry.`)
  const paymentOpen = sub.finance.payment.status === "failed" || sub.finance.payment.status === "waiting"
  requirePermission(paymentOpen ? "suppliers.manage" : "inventory.receive", paymentOpen ? "record a supplier payment" : "record a purchase order")
  const supplier = await import("./supplier.service")
  const received = (sub.entries ?? []).filter((e, i) => (sub.results ?? [])[i]?.status === "accepted")
  const finance = supplier.recordReceiveFinance(id, sub.context as Parameters<typeof supplier.recordReceiveFinance>[1], received)
  const next = patchReceiveSubmission(id, (s) => ({
    ...s, finance,
    summary: s.summary ? { ...s.summary, poNumber: finance.purchaseOrder.number, paymentRecorded: finance.payment.status === "recorded" } : s.summary,
  }))
  audit(next, "finance_retried", `PO ${finance.purchaseOrder.status}${finance.purchaseOrder.number ? ` (${finance.purchaseOrder.number})` : ""}, payment ${finance.payment.status}`)
  return finance
}
