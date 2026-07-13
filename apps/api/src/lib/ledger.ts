/**
 * POS-SYNC-AUTHORITY-2A — shared stock-movement ledger writer (RECORD-ONLY).
 *
 * `StockMovement` is the append-only audit ledger of every stock change. In 2A
 * it RECORDS MORE TRUTH but is NOT the source of truth — `Product.stock` (+ batch
 * consumption) still drives stock exactly as before. Nothing here changes any
 * stock outcome; it only writes an extra audit row alongside the real change.
 *
 * `reference` reuses the existing source-event ids (saleId / refundId / batchId /
 * adjustmentId / `void:<id>` / `opening:<x>` / `delivery:<orderId>`) — no new
 * idempotency scheme. `balance` is an ADVISORY running total (can be stale under
 * concurrent same-product writes); truth is always `sum(quantity)`.
 */

type Db = any

export interface MovementInput {
  productId: number
  type: string // Receive | Sale | Refund | Adjustment | WriteOff | Opening
  quantity: number // signed delta (− out, + in)
  reference: string
  note?: string
  batchId?: string | null
  deviceId?: string | null
  userId?: string | null
  userName?: string | null
}

/** Append one movement row, computing the advisory running balance. */
export async function recordStockMovement(db: Db, tenantId: string, m: MovementInput): Promise<void> {
  if (!m.productId || m.productId <= 0) return
  const sm = db.stockMovement
  if (!sm) return
  const last = await sm.findFirst({
    where: { tenantId, productId: m.productId },
    orderBy: { createdAt: "desc" },
    select: { balance: true },
  })
  const balance = (last?.balance ?? 0) + m.quantity
  await sm.create({
    data: {
      tenantId,
      productId: m.productId,
      type: m.type,
      quantity: m.quantity,
      balance,
      reference: m.reference,
      note: m.note ?? "",
      batchId: m.batchId ?? null,
      deviceId: m.deviceId ?? null,
      userId: m.userId ?? null,
      userName: m.userName ?? null,
    },
  })
}

/**
 * Idempotent write: skip if a movement with the same identity key
 * (tenantId, reference, type, productId) already exists. Backed by a NON-unique
 * index (the unique constraint is deliberately deferred to a later, data-verified
 * step). Used for opening balances so a repeated bootstrap/import can't double-log.
 */
export async function recordStockMovementOnce(db: Db, tenantId: string, m: MovementInput): Promise<void> {
  const sm = db.stockMovement
  if (!sm) return
  const existing = await sm.findFirst({
    where: { tenantId, reference: m.reference, type: m.type, productId: m.productId },
    select: { id: true },
  })
  if (existing) return
  await recordStockMovement(db, tenantId, m)
}
