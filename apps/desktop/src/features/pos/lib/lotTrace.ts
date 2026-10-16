// Lot traceability: everything that moved one lot, in order, from the records
// the app already keeps. Read-only; nothing here writes.
//
// Sources:
//  - the lot itself (received or opening: quantity, cost, supplier, PO);
//  - sale lines whose batchAllocations name the lot (out), and their voids (back in);
//  - refund lines whose batchAllocations name the lot (back in);
//  - stock movements whose reference is the lot id (manual adjustments / write-offs on that lot).
// Anything the records cannot tie to this lot (e.g. an adjustment made without choosing a lot)
// shows as one "unattributed" line, so the trace always ends at the lot's real remaining quantity.
import type { InventoryBatch, StockMovement } from "../services/inventoryBatch.service"

type TraceSale = { id: string; saleNumber: string; status?: string; createdAt: string; items?: Array<{ batchAllocations?: Array<{ batchId: string | null; quantity: number }> }> }
type TraceRefund = { id: string; refundNumber: string; saleNumber?: string; createdAt: string; items?: Array<{ batchAllocations?: Array<{ batchId: string | null; quantity: number }> | null }> }

export type LotTraceKind = "received" | "opening" | "sale" | "void" | "refund" | "adjustment" | "unattributed"
export type LotTraceEntry = {
  kind: LotTraceKind
  at: string | null          // null: the time was not recorded (voids made before movements carried it)
  quantity: number           // + into the lot, − out of it
  reference: string          // receipt / sale / refund number, PO, or note
  balance: number            // the lot's quantity after this entry
  note?: string
}

export function lotTrace(
  batch: InventoryBatch,
  data: { sales: TraceSale[]; refunds: TraceRefund[]; movements: StockMovement[] },
): { entries: LotTraceEntry[]; unattributed: number } {
  const raw: Array<Omit<LotTraceEntry, "balance">> = []
  const openingMove = data.movements.find((m) => m.productId === batch.productId && m.reference === batch.batchNumber && (m.type === "Opening" || m.type === "Receive"))
  raw.push({
    kind: openingMove?.type === "Opening" ? "opening" : "received",
    at: batch.receivedAt,
    quantity: batch.initialQuantity,
    reference: batch.purchaseOrderNumber || batch.batchNumber,
    note: batch.supplierName || undefined,
  })
  const qtyIn = (allocs?: Array<{ batchId: string | null; quantity: number }> | null) =>
    (allocs ?? []).filter((a) => a.batchId === batch.id).reduce((s, a) => s + a.quantity, 0)

  for (const sale of data.sales) {
    const q = (sale.items ?? []).reduce((s, i) => s + qtyIn(i.batchAllocations), 0)
    if (!q) continue
    raw.push({ kind: "sale", at: sale.createdAt, quantity: -q, reference: sale.saleNumber })
    if (sale.status === "Voided") {
      const restore = data.movements.find((m) => m.productId === batch.productId && m.type === "Refund" && m.reference === "refund-restore" && m.createdAt >= sale.createdAt)
      raw.push({ kind: "void", at: restore?.createdAt ?? null, quantity: q, reference: sale.saleNumber })
    }
  }
  for (const refund of data.refunds) {
    const q = (refund.items ?? []).reduce((s, i) => s + qtyIn(i.batchAllocations), 0)
    if (q) raw.push({ kind: "refund", at: refund.createdAt, quantity: q, reference: refund.refundNumber, note: refund.saleNumber })
  }
  for (const m of data.movements) {
    if (m.productId !== batch.productId || m.reference !== batch.id) continue
    raw.push({ kind: "adjustment", at: m.createdAt, quantity: m.quantity, reference: m.note || m.type })
  }

  raw.sort((a, b) => (a.kind === "received" || a.kind === "opening" ? -1 : b.kind === "received" || b.kind === "opening" ? 1 : (a.at ?? "9999").localeCompare(b.at ?? "9999")))
  let balance = 0
  const entries: LotTraceEntry[] = raw.map((e) => { balance += e.quantity; return { ...e, balance } })
  const unattributed = Math.round((batch.quantityRemaining - balance) * 1000) / 1000
  if (unattributed !== 0) {
    entries.push({ kind: "unattributed", at: null, quantity: unattributed, reference: "", balance: batch.quantityRemaining })
  }
  return { entries, unattributed }
}

/** Days until expiry (negative once expired), or null when the lot has no expiry. */
export function daysToExpiry(expiryDate: string | undefined, now = new Date()): number | null {
  if (!expiryDate) return null
  const end = new Date(`${expiryDate}T23:59:59`)
  if (Number.isNaN(end.getTime())) return null
  return Math.ceil((end.getTime() - now.getTime()) / 86_400_000) - 1
}

/** DESIGN-SYSTEM §8 Lots: ok above 30 days, warn at 30 or less, err at 7 or less or once expired. */
export function expiryTone(days: number | null): "ok" | "warn" | "err" | "none" {
  if (days === null) return "none"
  if (days <= 7) return "err"
  if (days <= 30) return "warn"
  return "ok"
}
