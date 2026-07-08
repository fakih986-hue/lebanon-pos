import { enqueueSyncOperation, assertCanWrite } from "./sync.service"
import { writeLocalWithIndexedDB } from "./storage.service"
import { canUseStorage, createId } from "../lib/storage"

const BATCHES_KEY  = "lebanonpos.inventory-batches.v1"
const BATCHES_EVENT = "lebanonpos-inventory-batches-changed"
const MOVEMENTS_KEY = "lebanonpos.stock-movements.v1"
const PRODUCTS_KEY  = "lebanonpos.products.v1"
const PRODUCTS_EVENT = "lebanonpos-products-changed"

export type MovementType = "Receive" | "Sale" | "Refund" | "Adjustment" | "WriteOff"

export interface StockMovement {
  id: string
  productId: number
  productName: string
  type: MovementType
  quantity: number      // positive = increase, negative = decrease
  balance: number       // running balance after movement
  reference: string     // sale ID, batch ID, adjustment ID, etc.
  note: string
  createdAt: string
  userId?: string
  userName?: string
}

function writeMovements(movements: StockMovement[]) {
  writeLocalWithIndexedDB(MOVEMENTS_KEY, movements)
}

function getMovements(): StockMovement[] {
  if (!canUseStorage()) return []
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(MOVEMENTS_KEY) : null
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function recordStockMovement(params: {
  productId: number; productName: string; type: MovementType;
  quantity: number; reference: string; note?: string; userId?: string; userName?: string;
}) {
  if (!canUseStorage()) return
  const existing = getMovements()
  // Calculate running balance for this product
  const prevBalance = existing
    .filter(m => m.productId === params.productId)
    .reduce((sum, m) => sum + m.quantity, 0)
  const balance = prevBalance + params.quantity

  const movement: StockMovement = {
    id: createId("stkmv"),
    productId: params.productId,
    productName: params.productName,
    type: params.type,
    quantity: params.quantity,
    balance,
    reference: params.reference,
    note: params.note ?? "",
    createdAt: new Date().toISOString(),
    userId: params.userId,
    userName: params.userName,
  }
  writeMovements([movement, ...existing])
}

function updateBatchStatus(batch: InventoryBatch) {
  if (batch.quantityRemaining <= 0) {
    batch.status = "Consumed"
  }
  // Auto-mark as expired if expiry date has passed
  if (batch.status === "Open" && batch.expiryDate) {
    const now = new Date()
    const expiry = new Date(batch.expiryDate)
    if (now > expiry) {
      batch.status = "Expired"
    }
  }
}

export type BatchAllocation = {
  batchId: string
  batchNumber: string
  quantity: number
  unitCost: number
  expiryDate?: string
}

export type InventoryBatch = {
  id: string
  batchNumber: string
  productId: number
  productName: string
  barcode: string
  initialQuantity: number
  quantityRemaining: number
  unitCost: number
  unitPrice: number
  expiryDate?: string
  supplierId?: string
  supplierName?: string
  purchaseOrderNumber?: string
  receivedAt: string
  status: "Open" | "Consumed" | "Expired"
}

export type ReceiveBatchInput = {
  productId: number
  productName: string
  barcode: string
  quantity: number
  unitCost: number
  unitPrice: number
  expiryDate?: string
  supplierId?: string
  supplierName?: string
  purchaseOrderNumber?: string
}

export type ConsumeBatchInput = {
  productId: number
  productName: string
  barcode: string
  quantity: number
  fallbackUnitCost: number
}

export type InventoryBatchAdjustmentInput = {
  productId: number
  productName: string
  barcode: string
  quantityDelta: number
  unitCost: number
  unitPrice: number
  batchId?: string
  reason?: string
}

function createBatchNumber() {
  return `LOT-${Date.now().toString().slice(-7)}-${Math.floor(
    Math.random() * 90 + 10
  )}`
}

function readBatches() {
  if (!canUseStorage()) {
    return []
  }

  const storedValue = window.localStorage.getItem(BATCHES_KEY)

  if (!storedValue) {
    return []
  }

  try {
    const parsedValue = JSON.parse(storedValue)

    return Array.isArray(parsedValue) ? (parsedValue as InventoryBatch[]) : []
  } catch {
    console.warn(`[inventoryBatch.service] Failed to parse storage key`)
    return []
  }
}

function writeBatches(batches: InventoryBatch[]) {
  if (!canUseStorage()) {
    return
  }

  writeLocalWithIndexedDB(BATCHES_KEY, batches)
  window.dispatchEvent(new Event(BATCHES_EVENT))
}

function sortBatchesForConsumption(a: InventoryBatch, b: InventoryBatch) {
  // Expired batches go last (should not be consumed)
  const aExpired = a.status === "Expired" ? 1 : 0
  const bExpired = b.status === "Expired" ? 1 : 0
  if (aExpired !== bExpired) return aExpired - bExpired

  const aExpiry = a.expiryDate || "9999-12-31"
  const bExpiry = b.expiryDate || "9999-12-31"

  return aExpiry.localeCompare(bExpiry) || a.receivedAt.localeCompare(b.receivedAt)
}

export function getInventoryBatches() {
  return readBatches()
}

export function getOpenBatchesForProduct(productId: number) {
  return getInventoryBatches()
    .filter(
      (batch) => batch.productId === productId && batch.quantityRemaining > 0
    )
    .sort(sortBatchesForConsumption)
}

export function receiveInventoryBatches(entries: ReceiveBatchInput[]) {
  assertCanWrite("receive inventory batches")
  const now = new Date().toISOString()
  const batches = entries
    .filter((entry) => entry.quantity > 0)
    .map<InventoryBatch>((entry) => ({
      id: createId("batch"),
      batchNumber: entry.purchaseOrderNumber || createBatchNumber(),
      productId: entry.productId,
      productName: entry.productName,
      barcode: entry.barcode,
      initialQuantity: entry.quantity,
      quantityRemaining: entry.quantity,
      unitCost: entry.unitCost,
      unitPrice: entry.unitPrice,
      expiryDate: entry.expiryDate || undefined,
      supplierId: entry.supplierId,
      supplierName: entry.supplierName,
      purchaseOrderNumber: entry.purchaseOrderNumber,
      receivedAt: now,
      status: "Open",
    }))

  if (batches.length === 0) {
    return []
  }

  writeBatches([...batches, ...getInventoryBatches()])

  // Record stock movements for each received batch
  for (const b of batches) {
    recordStockMovement({
      productId: b.productId, productName: b.productName,
      type: "Receive", quantity: b.initialQuantity,
      reference: b.batchNumber,
      note: `Received batch ${b.batchNumber}${b.supplierName ? ` from ${b.supplierName}` : ""}`,
    })
  }

  enqueueSyncOperation({
    entity: "inventory",
    action: "receive",
    summary: `${batches.length} inventory batch${
      batches.length === 1 ? "" : "es"
    } queued for sync.`,
    payload: batches,
  })

  return batches
}

export function consumeInventoryBatches(items: ConsumeBatchInput[]) {
  const batches = getInventoryBatches()
  const allocationsByProduct = new Map<number, BatchAllocation[]>()

  items.forEach((item) => {
    let remaining = item.quantity
    const productBatches = batches
      .filter(
        (batch) =>
          batch.productId === item.productId && batch.quantityRemaining > 0
      )
      .sort(sortBatchesForConsumption)

    productBatches.forEach((batch) => {
      if (remaining <= 0) {
        return
      }

      const quantity = Math.min(remaining, batch.quantityRemaining)
      batch.quantityRemaining -= quantity
      updateBatchStatus(batch)
      remaining -= quantity

      const allocations = allocationsByProduct.get(item.productId) ?? []
      allocations.push({
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        quantity,
        unitCost: batch.unitCost,
        expiryDate: batch.expiryDate,
      })
      allocationsByProduct.set(item.productId, allocations)
    })

    if (remaining > 0) {
      const allocations = allocationsByProduct.get(item.productId) ?? []
      allocations.push({
        batchId: "legacy-stock",
        batchNumber: "Legacy stock",
        quantity: remaining,
        unitCost: item.fallbackUnitCost,
      })
      allocationsByProduct.set(item.productId, allocations)
    }
  })

  writeBatches(batches)

  const changedBatches = batches.filter((batch) =>
    [...allocationsByProduct.values()].some((allocations) =>
      allocations.some((allocation) => allocation.batchId === batch.id)
    )
  )
  if (changedBatches.length > 0) {
    enqueueSyncOperation({
      entity: "inventory",
      action: "update",
      summary: `${changedBatches.length} consumed inventory batch${changedBatches.length === 1 ? "" : "es"} queued for sync.`,
      payload: changedBatches,
    })
  }

  // Record stock movement for each consumed item
  for (const item of items) {
    const allocs = allocationsByProduct.get(item.productId)
    if (allocs) {
      const batchRefs = allocs.map(a => a.batchNumber).join(", ")
      recordStockMovement({
        productId: item.productId, productName: item.productName,
        type: "Sale", quantity: -item.quantity,
        reference: batchRefs,
        note: `Consumed from: ${batchRefs}`,
      })
    }
  }

  return allocationsByProduct
}

export function adjustInventoryBatches(input: InventoryBatchAdjustmentInput) {
  assertCanWrite("adjust inventory")
  const batches = getInventoryBatches()
  const quantityDelta = input.quantityDelta
  const allocations: BatchAllocation[] = []

  if (quantityDelta === 0) {
    return allocations
  }

  if (quantityDelta > 0) {
    const selectedBatch = input.batchId
      ? batches.find((batch) => batch.id === input.batchId)
      : undefined

    if (selectedBatch) {
      selectedBatch.initialQuantity += quantityDelta
      selectedBatch.quantityRemaining += quantityDelta
      selectedBatch.unitCost = input.unitCost
      selectedBatch.unitPrice = input.unitPrice
      updateBatchStatus(selectedBatch)
      allocations.push({
        batchId: selectedBatch.id,
        batchNumber: selectedBatch.batchNumber,
        quantity: quantityDelta,
        unitCost: selectedBatch.unitCost,
        expiryDate: selectedBatch.expiryDate,
      })
    } else {
      const batch: InventoryBatch = {
        id: createId("batch-adjustment"),
        batchNumber: `ADJ-${Date.now().toString().slice(-7)}`,
        productId: input.productId,
        productName: input.productName,
        barcode: input.barcode,
        initialQuantity: quantityDelta,
        quantityRemaining: quantityDelta,
        unitCost: input.unitCost,
        unitPrice: input.unitPrice,
        receivedAt: new Date().toISOString(),
        status: "Open",
      }

      batches.unshift(batch)
      allocations.push({
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        quantity: quantityDelta,
        unitCost: batch.unitCost,
      })
    }

    writeBatches(batches)
    return allocations
  }

  let remaining = Math.abs(quantityDelta)
  const selectedBatch = input.batchId
    ? batches.find(
        (batch) =>
          batch.id === input.batchId &&
          batch.productId === input.productId &&
          batch.quantityRemaining > 0
      )
    : undefined
  const productBatches = [
    ...(selectedBatch ? [selectedBatch] : []),
    ...batches
      .filter(
        (batch) =>
          batch.productId === input.productId &&
          batch.quantityRemaining > 0 &&
          batch.id !== selectedBatch?.id
      )
      .sort(sortBatchesForConsumption),
  ]

  productBatches.forEach((batch) => {
    if (remaining <= 0) {
      return
    }

    const quantity = Math.min(remaining, batch.quantityRemaining)

    batch.quantityRemaining -= quantity
    updateBatchStatus(batch)
    remaining -= quantity
    allocations.push({
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      quantity,
      unitCost: batch.unitCost,
      expiryDate: batch.expiryDate,
    })
  })

  if (remaining > 0) {
    allocations.push({
      batchId: "legacy-stock",
      batchNumber: "Legacy stock",
      quantity: remaining,
      unitCost: input.unitCost,
    })
  }

  writeBatches(batches)

  // Record stock movement for adjustment
  recordStockMovement({
    productId: input.productId, productName: input.productName ?? `Product #${input.productId}`,
    type: quantityDelta > 0 ? "Receive" : "Adjustment",
    quantity: quantityDelta,
    reference: input.batchId ?? "manual",
    note: input.reason ?? "Manual adjustment",
  })

  return allocations
}

export function restoreInventoryBatches(items: ConsumeBatchInput[]) {
  const batches = getInventoryBatches()

  items.forEach((item) => {
    let remaining = item.quantity
    const productBatches = batches
      .filter((batch) => batch.productId === item.productId)
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))

    productBatches.forEach((batch) => {
      if (remaining <= 0) {
        return
      }

      const room = Math.max(0, batch.initialQuantity - batch.quantityRemaining)
      const quantity = Math.min(remaining, room)

      if (quantity <= 0) {
        return
      }

      batch.quantityRemaining += quantity
      batch.status = "Open"
      remaining -= quantity
    })

    if (remaining > 0) {
      batches.unshift({
        id: createId("batch-return"),
        batchNumber: `RETURN-${Date.now().toString().slice(-6)}`,
        productId: item.productId,
        productName: item.productName,
        barcode: item.barcode,
        initialQuantity: remaining,
        quantityRemaining: remaining,
        unitCost: item.fallbackUnitCost,
        unitPrice: 0,
        receivedAt: new Date().toISOString(),
        status: "Open",
      })
    }
  })

  writeBatches(batches)
  enqueueSyncOperation({
    entity: "inventory",
    action: "update",
    summary: "Returned inventory batches queued for sync.",
    payload: batches,
  })

  // Record stock movement for refund/restore
  for (const item of items) {
    recordStockMovement({
      productId: item.productId, productName: item.productName,
      type: "Refund", quantity: item.quantity,
      reference: "refund-restore",
      note: `Stock restored from refund`,
    })
  }
}

export function subscribeInventoryBatches(callback: () => void) {
  if (!canUseStorage()) {
    return () => undefined
  }

  window.addEventListener(BATCHES_EVENT, callback)
  window.addEventListener("storage", callback)

  return () => {
    window.removeEventListener(BATCHES_EVENT, callback)
    window.removeEventListener("storage", callback)
  }
}
