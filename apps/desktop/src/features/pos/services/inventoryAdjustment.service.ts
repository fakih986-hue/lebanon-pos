import {
  adjustInventoryBatches,
  type BatchAllocation,
} from "./inventoryBatch.service"
import {
  decreaseProductStock,
  getProductsSync,
  increaseProductStock,
} from "./product.service"
import { recordAuditEvent } from "./security.service"
import { canUseStorage, createId } from "../lib/storage"
import { assertCanWrite, commitStagedSyncOperation, getDeviceTag, settleStagedSyncOperation, stageSyncOperation } from "./sync.service"
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

  // Durability: the operation is saved before any stock or lot changes (SyncStorageError -> nothing
  // written). Its payload is completed on commit; if that cannot be saved, recovery takes it from
  // the stored adjustment (written last, so its presence means the adjustment happened).
  const adjustmentId = input.id ?? createId("stock-adjustment")
  const staged = stageSyncOperation({
    entity: "inventory",
    action: "adjust",
    summary: `${product.name} stock adjustment queued for sync.`,
    payload: { id: adjustmentId, productId: product.id, quantityChange, reason: input.reason, batchId: input.batchId },
  })
  try {
    const adjustment = applyStockAdjustment(input, product, adjustmentId, quantityBefore, quantityChange)
    commitStagedSyncOperation(staged.id, adjustment)
    return adjustment
  } catch (error) {
    settleStagedSyncOperation(staged.id)
    throw error
  }
}

function applyStockAdjustment(
  input: RecordStockAdjustmentInput,
  product: NonNullable<ReturnType<typeof getProductsSync>[number]>,
  adjustmentId: string,
  quantityBefore: number,
  quantityChange: number,
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
  })

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
