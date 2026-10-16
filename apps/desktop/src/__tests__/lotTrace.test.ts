import { describe, it, expect } from "vitest"
import { daysToExpiry, expiryTone, lotTrace } from "../features/pos/lib/lotTrace"
import type { InventoryBatch, StockMovement } from "../features/pos/services/inventoryBatch.service"

const lot = (over: Partial<InventoryBatch> = {}): InventoryBatch => ({
  id: "b1", batchNumber: "B-0001", productId: 7, productName: "Labneh", barcode: "x", initialQuantity: 10, quantityRemaining: 10,
  unitCost: 1.6, unitPrice: 2.4, receivedAt: "2026-10-01T08:00:00.000Z", status: "Open", supplierName: "Malia", purchaseOrderNumber: "PO-1", ...over,
})
const mv = (over: Partial<StockMovement>): StockMovement => ({ id: "m", productId: 7, productName: "Labneh", type: "Receive", quantity: 0, balance: 0, reference: "", note: "", createdAt: "2026-10-01T08:00:00.000Z", ...over })

describe("lot trace", () => {
  it("received, sold, refunded, voided and adjusted entries end at the lot's remaining quantity", () => {
    const b = lot({ quantityRemaining: 7 })
    const { entries, unattributed } = lotTrace(b, {
      sales: [
        { id: "s1", saleNumber: "S-1", createdAt: "2026-10-02T09:00:00.000Z", items: [{ batchAllocations: [{ batchId: "b1", quantity: 3 }, { batchId: "b2", quantity: 9 }] }] },
        { id: "s2", saleNumber: "S-2", status: "Voided", createdAt: "2026-10-03T09:00:00.000Z", items: [{ batchAllocations: [{ batchId: "b1", quantity: 2 }] }] },
      ],
      refunds: [{ id: "r1", refundNumber: "R-1", saleNumber: "S-1", createdAt: "2026-10-04T09:00:00.000Z", items: [{ batchAllocations: [{ batchId: "b1", quantity: 1 }] }] }],
      movements: [
        mv({ reference: "B-0001", type: "Receive", quantity: 10 }),
        mv({ reference: "refund-restore", type: "Refund", quantity: 2, createdAt: "2026-10-03T10:00:00.000Z" }),
        mv({ reference: "b1", type: "Adjustment", quantity: -1, note: "Damage", createdAt: "2026-10-05T09:00:00.000Z" }),
      ],
    })
    expect(entries.map((e) => [e.kind, e.quantity, e.balance])).toEqual([
      ["received", 10, 10], ["sale", -3, 7], ["sale", -2, 5], ["void", 2, 7], ["refund", 1, 8], ["adjustment", -1, 7],
    ])
    expect(entries.find((e) => e.kind === "void")?.at).toBe("2026-10-03T10:00:00.000Z")
    expect(unattributed).toBe(0)
    expect(entries[0]).toMatchObject({ reference: "PO-1", note: "Malia" })
  })

  it("shows what the records cannot tie to the lot as one unattributed line", () => {
    const { entries, unattributed } = lotTrace(lot({ quantityRemaining: 6 }), { sales: [], refunds: [], movements: [] })
    expect(unattributed).toBe(-4)
    expect(entries.at(-1)).toMatchObject({ kind: "unattributed", quantity: -4, balance: 6 })
  })

  it("labels an opening-inventory lot as opening", () => {
    const { entries } = lotTrace(lot(), { sales: [], refunds: [], movements: [mv({ reference: "B-0001", type: "Opening", quantity: 10 })] })
    expect(entries[0].kind).toBe("opening")
  })

  it("expiry tone: ok > 30 days, warn ≤ 30, err ≤ 7 or expired, none without a date", () => {
    const now = new Date("2026-10-16T12:00:00")
    expect(daysToExpiry("2026-10-16", now)).toBe(0)
    expect(daysToExpiry("2026-10-14", now)).toBe(-2)
    expect(expiryTone(daysToExpiry("2026-12-31", now))).toBe("ok")
    expect(expiryTone(daysToExpiry("2026-11-10", now))).toBe("warn")
    expect(expiryTone(daysToExpiry("2026-10-21", now))).toBe("err")
    expect(expiryTone(daysToExpiry("2026-10-14", now))).toBe("err")
    expect(expiryTone(daysToExpiry(undefined, now))).toBe("none")
  })
})
