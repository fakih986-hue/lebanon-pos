import { assertCanWrite, commitStagedSyncOperation, enqueueSyncOperation, registerStagedCompleter, settleStagedSyncOperation, stageSyncOperation } from "./sync.service"
import { writeLocalWithIndexedDB } from "./storage.service"
import { canUseStorage, createId } from "../lib/storage"

const BATCHES_KEY  = "lebanonpos.inventory-batches.v1"
const BATCHES_EVENT = "lebanonpos-inventory-batches-changed"
const MOVEMENTS_KEY = "lebanonpos.stock-movements.v1"
const PRODUCTS_KEY  = "lebanonpos.products.v1"
const PRODUCTS_EVENT = "lebanonpos-products-changed"

export type MovementType = "Receive" | "Sale" | "Refund" | "Adjustment" | "WriteOff" | "Opening"

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

/** Read-only access to the stock-movement ledger (reporting/audit only). */
export function getStockMovements(): StockMovement[] {
  return getMovements()
}

export function recordStockMovement(params: {
  productId: number; productName: string; type: MovementType;
  quantity: number; reference: string; note?: string; userId?: string; userName?: string;
  /** A fixed id makes the record idempotent: a movement with this id is never written twice. */
  id?: string;
}) {
  if (!canUseStorage()) return
  const existing = getMovements()
  if (params.id && existing.some((m) => m.id === params.id)) return
  // Calculate running balance for this product
  const prevBalance = existing
    .filter(m => m.productId === params.productId)
    .reduce((sum, m) => sum + m.quantity, 0)
  const balance = prevBalance + params.quantity

  const movement: StockMovement = {
    id: params.id ?? createId("stkmv"),
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
  /** Cross-system product identity carried in the sync payload (stripped
   *  server-side; not persisted as an InventoryBatch column). */
  productSyncId?: string
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
  /** Stable cross-system product identity, so the batch links to the right
   *  product on cloud even when the numeric productId differs there. */
  productSyncId?: string
  productName: string
  barcode: string
  quantity: number
  unitCost: number
  unitPrice: number
  expiryDate?: string
  supplierId?: string
  supplierName?: string
  purchaseOrderNumber?: string
  /** Fixed lot and movement ids (receiving submissions): a lot with this id is never written twice. */
  id?: string
  movementId?: string
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
  /** A fixed movement id (journaled adjustments): the movement is written once, for either sign. */
  movementId?: string
}

function createBatchNumber() {
  return `LOT-${Date.now().toString().slice(-7)}-${Math.floor(
    Math.random() * 90 + 10
  )}`
}

// POS-FIRST-SETUP-CATALOG-1A: opening (first-setup) batches are numbered so they
// read clearly as opening inventory rather than a received purchase.
function createOpeningBatchNumber() {
  return `OPENING-${Date.now().toString().slice(-7)}-${Math.floor(
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

/** POS-FIRST-SETUP-CATALOG-1A: opening inventory = a first-setup starting count.
 *  Same batch + single-increment mechanics as receiving, but the ledger movement
 *  is recorded as "Opening" (not "Receive") and the batch reads as OPENING-*, so
 *  it never looks like a supplier purchase. No PO / no supplier payment (those
 *  live in receiveAndRecord, which opening never calls). */
export function openingInventoryBatches(entries: ReceiveBatchInput[]) {
  return receiveInventoryBatches(entries, { opening: true })
}

export function receiveInventoryBatches(entries: ReceiveBatchInput[], opts?: { opening?: boolean; syncOpId?: string }) {
  assertCanWrite("receive inventory batches")
  const opening = opts?.opening === true
  const now = new Date().toISOString()
  const known = new Set(getInventoryBatches().map((b) => b.id))
  // Lots with fixed ids that already exist are not written again; their movements and the
  // receive operation are still completed below (each is idempotent by its own id).
  const existing = entries.filter((entry) => entry.id && known.has(entry.id))
  const batches = entries
    .filter((entry) => entry.quantity > 0 && !(entry.id && known.has(entry.id)))
    .map<InventoryBatch>((entry) => ({
      id: entry.id ?? createId("batch"),
      batchNumber: entry.purchaseOrderNumber || (opening ? createOpeningBatchNumber() : createBatchNumber()),
      productId: entry.productId,
      productSyncId: entry.productSyncId,
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

  const movementIdOf = new Map(entries.filter((e) => e.id && e.movementId).map((e) => [e.id as string, e.movementId as string]))
  const all = [...batches, ...getInventoryBatches().filter((b) => existing.some((e) => e.id === b.id))]
  if (all.length === 0) {
    return []
  }
  // Durability: the receive operation is saved before the lots (SyncStorageError -> nothing written).
  // The server adds stock only through it, once per lot id. With a fixed id it is never queued
  // again once queued or acknowledged.
  const staged = stageSyncOperation({
    id: opts?.syncOpId,
    entity: "inventory",
    action: "receive",
    summary: `${all.length} ${opening ? "opening" : "inventory"} batch${
      all.length === 1 ? "" : "es"
    } queued for sync.`,
    // The `opening` flag rides the sync payload only (not the stored batch row);
    // the server strips it and tags the movement Opening vs Receive.
    // A lot written earlier (a resumed receive) has never reached the server yet: it is sent as
    // received, so the server adds the received quantity; sales already queued then take theirs.
    payload: all.map((b) => {
      const first = batches.includes(b) ? b : { ...b, quantityRemaining: b.initialQuantity, status: "Open" as const }
      return opening ? { ...first, opening: true } : first
    }),
  })
  try {
    if (batches.length > 0) writeBatches([...batches, ...getInventoryBatches()])
  } catch (error) {
    settleStagedSyncOperation(staged.id)
    throw error
  }
  commitStagedSyncOperation(staged.id)

  // Record stock movements for each batch — Opening for first-setup, else Receive.
  for (const b of all) {
    // Without a fixed id a movement is only recorded for a lot written now.
    if (!movementIdOf.has(b.id) && !batches.includes(b)) continue
    recordStockMovement({
      id: movementIdOf.get(b.id) ?? `${b.id}-mv`,
      productId: b.productId, productName: b.productName,
      type: opening ? "Opening" : "Receive", quantity: b.initialQuantity,
      reference: b.batchNumber,
      note: opening
        ? `Opening stock ${b.batchNumber}`
        : `Received batch ${b.batchNumber}${b.supplierName ? ` from ${b.supplierName}` : ""}`,
    })
  }

  return batches
}

export function consumeInventoryBatches(
  items: ConsumeBatchInput[],
  /** movementIdPrefix: each item's Sale movement gets the id <prefix>-<index> (written once). */
  opts?: { dryRun?: boolean; skipSync?: boolean; movementIdPrefix?: string },
) {
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

  // Dry run: compute the allocation plan only (used by the write-through
  // path to build the sale payload BEFORE the hub commits). The in-memory
  // quantityRemaining mutations above are on a throwaway snapshot from
  // getInventoryBatches() and are never persisted — no write, no enqueue,
  // no movement ledger entry.
  if (opts?.dryRun) {
    return allocationsByProduct
  }

  writeBatches(batches)

  const changedBatches = batches.filter((batch) =>
    [...allocationsByProduct.values()].some((allocations) =>
      allocations.some((allocation) => allocation.batchId === batch.id)
    )
  )
  // skipSync: local batch state is updated for immediate display, but no sync
  // op is enqueued — the hub already committed the authoritative batch
  // decrement during the write-through sale commit.
  if (changedBatches.length > 0 && !opts?.skipSync) {
    enqueueSyncOperation({
      entity: "inventory",
      action: "update",
      summary: `${changedBatches.length} consumed inventory batch${changedBatches.length === 1 ? "" : "es"} queued for sync.`,
      payload: changedBatches,
    })
  }

  // Record stock movement for each consumed item
  items.forEach((item, index) => {
    const allocs = allocationsByProduct.get(item.productId)
    if (allocs) {
      const batchRefs = allocs.map(a => a.batchNumber).join(", ")
      recordStockMovement({
        id: opts?.movementIdPrefix ? `${opts.movementIdPrefix}-${index}` : undefined,
        productId: item.productId, productName: item.productName,
        type: "Sale", quantity: -item.quantity,
        reference: batchRefs,
        note: `Consumed from: ${batchRefs}`,
      })
    }
  })

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
    // An increase used to leave no movement (the ledger then disagreed with stock): with a fixed id
    // it is recorded like a decrease.
    if (input.movementId) {
      recordStockMovement({
        id: input.movementId,
        productId: input.productId, productName: input.productName ?? `Product #${input.productId}`,
        type: "Adjustment", quantity: quantityDelta,
        reference: input.batchId ?? allocations[0]?.batchNumber ?? "manual",
        note: input.reason ?? "Manual adjustment",
      })
    }
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
    id: input.movementId,
    productId: input.productId, productName: input.productName ?? `Product #${input.productId}`,
    type: quantityDelta > 0 ? "Receive" : "Adjustment",
    quantity: quantityDelta,
    reference: input.batchId ?? "manual",
    note: input.reason ?? "Manual adjustment",
  })

  return allocations
}

/**
 * REFUND-INTEGRITY-1 — apply a refund/void lot plan to this device's lots
 * (sign 1), or undo it (sign -1) when a refund is rolled back.
 *
 * Local only: the server restores lots itself from the sale's recorded
 * allocations, so nothing is enqueued here (the old path pushed this device's
 * whole lot table as absolute quantities, clobbering other devices' changes).
 * Untracked slices (batchId null) and lots this device doesn't know are
 * skipped; the next pull brings the server's lot balances.
 */
export function applyLotRestoration(slices: Array<{ batchId: string | null; quantity: number }>, sign: 1 | -1 = 1) {
  const batches = getInventoryBatches()
  let changed = false
  for (const slice of slices) {
    if (!slice.batchId || !(slice.quantity > 0)) continue
    const batch = batches.find((candidate) => candidate.id === slice.batchId)
    if (!batch) continue
    batch.quantityRemaining = Math.max(0, Math.round((batch.quantityRemaining + sign * slice.quantity) * 1e6) / 1e6)
    if (batch.quantityRemaining > 0) batch.status = "Open"
    updateBatchStatus(batch)
    changed = true
  }
  if (changed) writeBatches(batches)
  return changed
}

/**
 * Compensation (businessJournal): put the given lots back exactly as they were (full records,
 * received and remaining quantities) and remove lots the interrupted workflow created. Only lots
 * passed in are touched.
 */
export function restoreLotsFromSnapshot(before: InventoryBatch[], createdIds: string[] = []) {
  const byId = new Map(before.map((b) => [b.id, b]))
  const created = new Set(createdIds)
  const next = getInventoryBatches()
    .filter((b) => !created.has(b.id))
    .map((b) => (byId.has(b.id) ? { ...byId.get(b.id)! } : b))
  writeBatches(next)
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

// A lot receive released by recovery: its lots are written (the record); make sure each has its
// Receive/Opening movement (fixed id: never recorded twice).
registerStagedCompleter("inventory/receive", (op) => {
  const lots = Array.isArray(op.payload) ? (op.payload as Array<InventoryBatch & { opening?: boolean }>) : []
  const stored = new Map(getInventoryBatches().map((b) => [b.id, b]))
  for (const lot of lots) {
    const b = stored.get(lot.id)
    if (!b) continue
    recordStockMovement({
      id: `${b.id}-mv`,
      productId: b.productId, productName: b.productName,
      type: lot.opening ? "Opening" : "Receive", quantity: b.initialQuantity,
      reference: b.batchNumber,
      note: lot.opening ? `Opening stock ${b.batchNumber}` : `Received batch ${b.batchNumber}${b.supplierName ? ` from ${b.supplierName}` : ""}`,
    })
  }
})
