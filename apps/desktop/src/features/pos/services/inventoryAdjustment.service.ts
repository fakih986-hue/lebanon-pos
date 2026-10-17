import {
  adjustInventoryBatches,
  getInventoryBatches,
  getStockMovements,
  recordStockMovement,
  restoreLotsFromSnapshot,
  type BatchAllocation,
  type InventoryBatch,
} from "./inventoryBatch.service"
import {
  blockJournalEntry, check, closeJournalEntry, markDone, openJournalEntry, registerJournalCloser, registerJournalRecoverer,
  type Check, type JournalEffect, type JournalEntry,
} from "./businessJournal.service"
import {
  decreaseProductStock,
  getProductsSync,
  increaseProductStock,
} from "./product.service"
import { recordAuditEvent } from "./security.service"
import { canUseStorage, createId } from "../lib/storage"
import { assertCanWrite, commitStagedSyncOperation, discardStagedSyncOperation, getDeviceTag, stageSyncOperation, SyncStorageError } from "./sync.service"
import { writeLocalWithIndexedDB } from "./storage.service"

const ADJUSTMENTS_KEY = "lebanonpos.inventory-adjustments.v1"
const ADJUSTMENTS_EVENT = "lebanonpos-inventory-adjustments-changed"

export type StockAdjustmentReason =
  | "Damage"
  | "Expired"
  | "Theft"
  | "Count Correction"
  | "Supplier Return"
  | "Internal Use"
  | "Manual Correction"

export type StockAdjustment = {
  id: string
  adjustmentNumber: string
  productId: number
  productName: string
  barcode: string
  quantityBefore: number
  quantityChange: number
  quantityAfter: number
  reason: StockAdjustmentReason
  note?: string
  batchId?: string
  batchAllocations: BatchAllocation[]
  valueImpact: number
  createdAt: string
}

export type RecordStockAdjustmentInput = {
  productId: number
  quantityChange: number
  reason: StockAdjustmentReason
  note?: string
  batchId?: string
  /** Fixed id (receiving recovery): the server applies an adjustment once per id. */
  id?: string
}

function createAdjustmentNumber(count: number) {
  return `ADJ-${getDeviceTag()}-${String(count + 1).padStart(5, "0")}`
}

function readAdjustments() {
  if (!canUseStorage()) {
    return []
  }

  const storedValue = window.localStorage.getItem(ADJUSTMENTS_KEY)

  if (!storedValue) {
    return []
  }

  try {
    const parsedValue = JSON.parse(storedValue)

    return Array.isArray(parsedValue) ? (parsedValue as StockAdjustment[]) : []
  } catch {
    console.warn(`[inventoryAdjustment.service] Failed to parse storage key`)
    return []
  }
}

function writeAdjustments(adjustments: StockAdjustment[]) {
  if (!canUseStorage()) {
    return
  }

  writeLocalWithIndexedDB(ADJUSTMENTS_KEY, adjustments)
  window.dispatchEvent(new Event(ADJUSTMENTS_EVENT))
}

export function getStockAdjustments() {
  return readAdjustments()
}

export function recordStockAdjustment(input: RecordStockAdjustmentInput) {
  assertCanWrite("record stock adjustment")
  const product = getProductsSync().find((item) => item.id === input.productId)

  if (!product || input.quantityChange === 0) {
    return null
  }

  const quantityBefore = product.stock
  const quantityChange =
    input.quantityChange < 0
      ? -Math.min(quantityBefore, Math.abs(input.quantityChange))
      : input.quantityChange

  if (quantityChange === 0) {
    return null
  }

  // Durable boundary (businessJournal): the entry (with the product's stock and full lots) and the
  // operation are saved before any change; the commit point is the adjustment record, written
  // last. SyncStorageError -> nothing written. Interrupted before the record -> lots and stock are
  // put back exactly; after it -> the missing stock change is applied. Otherwise blocked, shown.
  const adjustmentId = input.id ?? createId("stock-adjustment")
  const opId = `op-${adjustmentId}`
  const productLots = getInventoryBatches().filter((b) => b.productId === product.id)
  let entry: JournalEntry
  try {
    entry = openJournalEntry("adjustment", {
      adjustmentId, productId: product.id, quantityChange, reason: input.reason, batchId: input.batchId ?? null,
      lotRecords: productLots, allocations: null,
    }, { stock: { [String(product.id)]: quantityBefore }, lots: Object.fromEntries(productLots.map((b) => [b.id, b.quantityRemaining])) }, [opId])
  } catch (error) { throw new SyncStorageError(opId, error) }
  try {
    stageSyncOperation({
      id: opId,
      entity: "inventory",
      action: "adjust",
      summary: `${product.name} stock adjustment queued for sync.`,
      payload: { id: adjustmentId, productId: product.id, quantityChange, reason: input.reason, batchId: input.batchId },
    })
  } catch (error) { closeJournalEntry(entry); throw error }
  try {
    const adjustment = applyStockAdjustment(input, product, adjustmentId, quantityBefore, quantityChange, entry)
    commitStagedSyncOperation(opId, adjustment)
    closeJournalEntry(entry)
    return adjustment
  } catch (error) {
    // If settling fails too (storage still full) the entry stays open: restart recovery finishes it.
    try { recoverAdjustment(entry) } catch (settleError) { console.error("[adjustment] settle failed; restart will finish it:", settleError) }
    if (!entry.committed) throw error
    return getStockAdjustments().find((a) => a.id === adjustmentId) ?? null
  }
}

type AdjustmentPlan = {
  adjustmentId: string; productId: number; quantityChange: number; reason: string; batchId: string | null
  lotRecords: InventoryBatch[]; allocations: BatchAllocation[] | null
}
function recoverAdjustment(entry: JournalEntry): "closed" | "blocked" {
  const p = entry.plan as unknown as AdjustmentPlan
  const opId = entry.opIds[0]
  const key = String(p.productId)
  const now = getProductsSync().find((x) => x.id === p.productId)?.stock
  const stock = check(now, entry.before.stock[key], p.quantityChange)
  // Lots: with the recorded allocations each lot is checked; without them (the write that would
  // record them failed) the product's lots must be untouched, or it is ambiguous.
  const lotsNow = getInventoryBatches().filter((b) => b.productId === p.productId)
  const sign = p.quantityChange > 0 ? 1 : -1
  let lots: Check
  let createdIds: string[] = []
  if (p.allocations) {
    const real = p.allocations.filter((a) => a.batchId && a.batchId !== "legacy-stock")
    createdIds = real.map((a) => a.batchId!).filter((id) => entry.before.lots[id] === undefined)
    const states = real.map((a) => check(lotsNow.find((b) => b.id === a.batchId)?.quantityRemaining ?? (createdIds.includes(a.batchId!) ? 0 : undefined), entry.before.lots[a.batchId!] ?? 0, sign * a.quantity))
    lots = states.every((s) => s === "expected") ? "expected" : states.every((s) => s === "before") ? "before" : "ambiguous"
  } else {
    const unchanged = lotsNow.length === Object.keys(entry.before.lots).length && lotsNow.every((b) => entry.before.lots[b.id] === b.quantityRemaining)
    lots = unchanged ? "before" : "ambiguous"
  }
  const detail = `product #${p.productId}: stock ${now} (before ${entry.before.stock[key]}, expected ${(entry.before.stock[key] ?? 0) + p.quantityChange}); lots ${lots}`
  const record = getStockAdjustments().find((a) => a.id === p.adjustmentId)
  const movementId = `mv-${p.adjustmentId}`
  const movementWritten = getStockMovements().some((mv) => mv.id === movementId)
  const productName = lotsNow[0]?.productName ?? getProductsSync().find((x) => x.id === p.productId)?.name ?? `Product #${p.productId}`
  if (record) {
    // Committed: the record is written last, so lots and stock should both be applied.
    entry.committed = true
    // Its movement (fixed id) is completed if it was never written.
    if (!movementWritten) recordStockMovement({ id: movementId, productId: p.productId, productName, type: "Adjustment", quantity: p.quantityChange, reference: p.adjustmentId, note: `${p.reason} (completed after an interruption)` })
    if (lots !== "expected" && p.allocations !== null) { blockJournalEntry(entry, "lots", detail); return "blocked" }
    if (stock === "ambiguous") { blockJournalEntry(entry, "stock", detail); return "blocked" }
    if (stock === "before") (p.quantityChange > 0 ? increaseProductStock : decreaseProductStock)([{ productId: p.productId, quantity: Math.abs(p.quantityChange) }])
    commitStagedSyncOperation(opId, record)
    closeJournalEntry(entry)
    return "closed"
  }
  // Not committed: put back exactly what was applied; never sent.
  if (lots === "ambiguous" || stock === "ambiguous") { blockJournalEntry(entry, lots === "ambiguous" ? "lots" : "stock", detail); return "blocked" }
  if (lots === "expected") restoreLotsFromSnapshot(p.lotRecords, createdIds)
  // Its movement is reversed only if it was written (fixed ids: never twice).
  if (movementWritten) recordStockMovement({ id: `${movementId}-rev`, productId: p.productId, productName, type: "Adjustment", quantity: -p.quantityChange, reference: p.adjustmentId, note: "Interrupted adjustment reversed (no adjustment recorded)" })
  if (stock === "expected") (p.quantityChange > 0 ? decreaseProductStock : increaseProductStock)([{ productId: p.productId, quantity: Math.abs(p.quantityChange) }])
  discardStagedSyncOperation(opId)
  closeJournalEntry(entry)
  return "closed"
}
registerJournalRecoverer("adjustment", recoverAdjustment)

// Close by hand: the product's stock and the lots it moved (known allocations; a lot it created
// counts from 0). Without its recorded allocations the lots cannot be targeted: the close refuses.
registerJournalCloser("adjustment", (entry) => {
  const p = entry.plan as unknown as AdjustmentPlan
  const product = getProductsSync().find((x) => x.id === p.productId)
  const lotsNow = getInventoryBatches()
  const sign = p.quantityChange > 0 ? 1 : -1
  const lotEffects: JournalEffect[] = p.allocations
    ? p.allocations.filter((a) => a.batchId && a.batchId !== "legacy-stock").map((a) => ({
        kind: "lot" as const, key: a.batchId!, label: `lot ${a.batchNumber ?? a.batchId}`,
        before: entry.before.lots[a.batchId!] ?? 0, delta: sign * a.quantity,
        now: lotsNow.find((b) => b.id === a.batchId)?.quantityRemaining,
      }))
    : [{ kind: "lot" as const, key: `lots-of-${p.productId}`, label: `lots of ${product?.name ?? p.productId} (allocation not recorded)`, before: undefined, delta: 0, now: undefined }]
  return {
    money: "none",
    recordHere: getStockAdjustments().some((a) => a.id === p.adjustmentId),
    effects: [
      { kind: "stock", key: String(p.productId), label: `${product?.name ?? `product #${p.productId}`} stock`, before: entry.before.stock[String(p.productId)], delta: p.quantityChange, now: product?.stock },
      ...lotEffects,
    ],
  }
}, (entry, keep) => {
  const p = entry.plan as unknown as AdjustmentPlan
  const movementId = `mv-${p.adjustmentId}`
  const written = getStockMovements().some((mv) => mv.id === movementId)
  const productName = getProductsSync().find((x) => x.id === p.productId)?.name ?? `Product #${p.productId}`
  if (keep && !written) recordStockMovement({ id: movementId, productId: p.productId, productName, type: "Adjustment", quantity: p.quantityChange, reference: p.adjustmentId, note: `${p.reason} (closed by hand)` })
  if (!keep && written) recordStockMovement({ id: `${movementId}-rev`, productId: p.productId, productName, type: "Adjustment", quantity: -p.quantityChange, reference: p.adjustmentId, note: "Interrupted adjustment cancelled by hand" })
  if (keep) {
    const record = getStockAdjustments().find((a) => a.id === p.adjustmentId)
    if (record) commitStagedSyncOperation(entry.opIds[0], record) // the operation carries the record
  }
})

function applyStockAdjustment(
  input: RecordStockAdjustmentInput,
  product: NonNullable<ReturnType<typeof getProductsSync>[number]>,
  adjustmentId: string,
  quantityBefore: number,
  quantityChange: number,
  entry: JournalEntry,
) {
  const batchAllocations = adjustInventoryBatches({
    productId: product.id,
    productName: product.name,
    barcode: product.barcode,
    quantityDelta: quantityChange,
    unitCost: product.cost,
    unitPrice: product.price,
    batchId: input.batchId,
    reason: input.reason,
    movementId: `mv-${adjustmentId}`,
  })
  markDone(entry, "lots", { plan: { ...entry.plan, allocations: batchAllocations } })

  if (quantityChange > 0) {
    increaseProductStock([
      {
        productId: product.id,
        quantity: quantityChange,
      },
    ])
  } else {
    decreaseProductStock([
      {
        productId: product.id,
        quantity: Math.abs(quantityChange),
      },
    ])
  }

  markDone(entry, "stock")

  const existingAdjustments = getStockAdjustments()
  const adjustment: StockAdjustment = {
    id: adjustmentId,
    adjustmentNumber: createAdjustmentNumber(existingAdjustments.length),
    productId: product.id,
    productName: product.name,
    barcode: product.barcode,
    quantityBefore,
    quantityChange,
    quantityAfter: quantityBefore + quantityChange,
    reason: input.reason,
    note: input.note?.trim() || undefined,
    batchId: input.batchId,
    batchAllocations,
    valueImpact: quantityChange * product.cost,
    createdAt: new Date().toISOString(),
  }

  writeAdjustments([adjustment, ...existingAdjustments].slice(0, 500))
  markDone(entry, "record", { committed: true })
  // Written: a failed audit write must not undo the commit of the operation.
  try { recordAuditEvent({
    action: "inventory.adjust",
    entity: "inventory",
    summary: `${adjustment.adjustmentNumber}: ${product.name} ${
      quantityChange > 0 ? "+" : ""
    }${quantityChange} units for ${input.reason}.`,
    metadata: {
      productId: product.id,
      quantityBefore,
      quantityChange,
      quantityAfter: adjustment.quantityAfter,
      reason: input.reason,
    },
  }) } catch (error) { console.error("[adjustment] audit write failed:", error) }

  return adjustment
}

export function subscribeStockAdjustments(callback: () => void) {
  if (!canUseStorage()) {
    return () => undefined
  }

  window.addEventListener(ADJUSTMENTS_EVENT, callback)
  window.addEventListener("storage", callback)

  return () => {
    window.removeEventListener(ADJUSTMENTS_EVENT, callback)
    window.removeEventListener("storage", callback)
  }
}
