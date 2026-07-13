import { describe, it, expect, vi } from "vitest"
import { recordStockMovement, recordStockMovementOnce } from "../src/lib/ledger"

function fakeDb(lastBalance: number | null = null, existing = false) {
  const create = vi.fn().mockResolvedValue({})
  const findFirst = vi.fn().mockImplementation(({ select }: any) => {
    // balance lookup vs idempotency lookup distinguished by the select shape
    if (select?.balance) return Promise.resolve(lastBalance === null ? null : { balance: lastBalance })
    return Promise.resolve(existing ? { id: "existing" } : null)
  })
  return { stockMovement: { create, findFirst } }
}

describe("ledger — recordStockMovement (POS-SYNC-AUTHORITY-2A)", () => {
  it("writes a signed movement with running balance and source attribution", async () => {
    const db = fakeDb(8)
    await recordStockMovement(db as any, "t1", {
      productId: 5, type: "Sale", quantity: -2, reference: "sale-9",
      deviceId: "DEV-A", userId: "u1", userName: "John",
    })
    expect(db.stockMovement.create).toHaveBeenCalledTimes(1)
    const data = db.stockMovement.create.mock.calls[0][0].data
    expect(data).toMatchObject({
      tenantId: "t1", productId: 5, type: "Sale", quantity: -2,
      balance: 6, reference: "sale-9", deviceId: "DEV-A", userId: "u1", userName: "John",
    })
  })

  it("treats missing prior balance as 0", async () => {
    const db = fakeDb(null)
    await recordStockMovement(db as any, "t1", { productId: 5, type: "Receive", quantity: 10, reference: "b1" })
    expect(db.stockMovement.create.mock.calls[0][0].data.balance).toBe(10)
  })

  it("is a no-op for an invalid productId (record-only safety)", async () => {
    const db = fakeDb(0)
    await recordStockMovement(db as any, "t1", { productId: 0, type: "Sale", quantity: -1, reference: "x" })
    expect(db.stockMovement.create).not.toHaveBeenCalled()
  })
})

describe("ledger — recordStockMovementOnce (idempotency)", () => {
  it("writes when no movement with the same identity key exists", async () => {
    const db = fakeDb(0, false)
    await recordStockMovementOnce(db as any, "t1", { productId: 5, type: "Opening", quantity: 20, reference: "opening:s1" })
    expect(db.stockMovement.create).toHaveBeenCalledTimes(1)
  })

  it("does NOT double-log when a matching movement already exists", async () => {
    const db = fakeDb(0, true)
    await recordStockMovementOnce(db as any, "t1", { productId: 5, type: "Opening", quantity: 20, reference: "opening:s1" })
    expect(db.stockMovement.create).not.toHaveBeenCalled()
  })
})
