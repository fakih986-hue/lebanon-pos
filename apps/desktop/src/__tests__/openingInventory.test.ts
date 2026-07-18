import { describe, it, expect, vi, beforeEach } from "vitest"
import type { ReceiveBatchInput } from "../features/pos/services/inventoryBatch.service"

// POS-FIRST-SETUP-CATALOG-1A — client opening-inventory path.
const { enqueueMock } = vi.hoisted(() => ({ enqueueMock: vi.fn() }))
vi.mock("../features/pos/services/sync.service", () => ({
  enqueueSyncOperation: (op: unknown) => enqueueMock(op),
  assertCanWrite: () => {},
}))

const MOVEMENTS_KEY = "lebanonpos.stock-movements.v1"
const entry = (): ReceiveBatchInput => ({ productId: 1, productName: "Cola", barcode: "B", quantity: 5, unitCost: 1, unitPrice: 2 })
const receiveOp = () => enqueueMock.mock.calls.map((c) => c[0] as any).find((o) => o.entity === "inventory" && o.action === "receive")
const movements = (): any[] => { try { return JSON.parse(window.localStorage.getItem(MOVEMENTS_KEY) ?? "[]") } catch { return [] } }

describe("POS-FIRST-SETUP-CATALOG-1A — openingInventoryBatches", () => {
  beforeEach(() => {
    enqueueMock.mockClear()
    try { window.localStorage.clear() } catch { /* jsdom */ }
  })

  it("flags the sync payload as opening, numbers the batch OPENING-*, and logs an Opening movement", async () => {
    const { openingInventoryBatches } = await import("../features/pos/services/inventoryBatch.service")
    const batches = openingInventoryBatches([entry()])
    expect(batches[0].batchNumber).toMatch(/^OPENING-/)

    const op = receiveOp()
    expect(op).toBeDefined()
    expect(op.payload[0].opening).toBe(true)

    const mv = movements().find((m) => m.quantity === 5)
    expect(mv.type).toBe("Opening")
  })

  it("normal receiveInventoryBatches is unchanged — Receive movement, no opening flag, LOT-* batch", async () => {
    const { receiveInventoryBatches } = await import("../features/pos/services/inventoryBatch.service")
    const batches = receiveInventoryBatches([entry()])
    expect(batches[0].batchNumber).toMatch(/^LOT-/)

    const op = receiveOp()
    expect(op.payload[0]).not.toHaveProperty("opening")

    const mv = movements().find((m) => m.quantity === 5)
    expect(mv.type).toBe("Receive")
  })
})
