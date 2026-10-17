// DURABILITY-2 — customer debt (debt sale, payment) staged with stable ids: a payment that
// cannot be queued is not recorded; one whose commit fails is released exactly once after a
// restart; a retry with the same id records nothing more. Real services; restart = resetModules.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const K = {
  users: "lebanonpos.users.v1", current: "lebanonpos.current-user.v1", products: "lebanonpos.products.v1",
  batches: "lebanonpos.inventory-batches.v1", sales: "lebanonpos.sales.v1", queue: "lebanonpos.sync-queue.v1",
  adjustments: "lebanonpos.inventory-adjustments.v1", movements: "lebanonpos.stock-movements.v1",
  journal: "lebanonpos.business-journal.v1", customers: "lebanonpos.customers.v1", debtSales: "lebanonpos.debt-sales.v1",
  debtPayments: "lebanonpos.debt-payments.v1", audit: "lebanonpos.audit.v1",
}
const read = <T = Record<string, unknown>>(k: string): T[] => { try { const v = JSON.parse(localStorage.getItem(k) ?? "[]"); return Array.isArray(v) ? v : [] } catch { return [] } }
const ops = () => read<{ id: string; entity: string; action: string; staged?: boolean; payload: { id?: string } }>(K.queue).filter((o) => o.entity !== "shift")

/** Make writes to some keys fail (each after N successful writes). One spy: a second spyOn would replace the first. */
function failKeys(rules: Record<string, number>) {
  const setItem = Storage.prototype.setItem
  const seen: Record<string, number> = {}
  return vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
    if (k in rules && (seen[k] = (seen[k] ?? 0) + 1) > rules[k]) throw new DOMException("quota", "QuotaExceededError")
    return setItem.call(this, k, v)
  })
}
const failKey = (key: string, afterWrites = 0) => failKeys({ [key]: afterWrites })
function seed() {
  localStorage.setItem(K.users, JSON.stringify([{ id: "u1", name: "Owner", role: "Admin", pin: "HASH", code: "OWN", active: true, permissions: [] }]))
  localStorage.setItem(K.current, "u1")
  localStorage.setItem(K.products, JSON.stringify([{ id: 1, syncId: "p-cola", name: "Cola", barcode: "111", price: 5, cost: 2, stock: 10, category: "Drinks" }]))
  localStorage.setItem(K.batches, JSON.stringify([
    { id: "lot-a", batchNumber: "A", productId: 1, productName: "Cola", barcode: "111", initialQuantity: 6, quantityRemaining: 6, unitCost: 2, unitPrice: 5, receivedAt: "2026-01-01T00:00:00.000Z", status: "Open" },
    { id: "lot-b", batchNumber: "B", productId: 1, productName: "Cola", barcode: "111", initialQuantity: 4, quantityRemaining: 4, unitCost: 3, unitPrice: 5, receivedAt: "2026-02-01T00:00:00.000Z", status: "Open" },
  ]))
  localStorage.setItem(K.customers, JSON.stringify([{ id: "cust-1", name: "Nour", mobile: "1", creditLimit: 500, createdAt: "2026-01-01T00:00:00.000Z" }]))
}
async function svc() {
  return {
    sync: await import("../features/pos/services/sync.service"),
    sales: await import("../features/pos/services/sales.service"),
    security: await import("../features/pos/services/security.service"),
    batches: await import("../features/pos/services/inventoryBatch.service"),
    adj: await import("../features/pos/services/inventoryAdjustment.service"),
    customer: await import("../features/pos/services/customer.service"),
  }
}
const balance = async (m: Awaited<ReturnType<typeof svc>>) => m.customer.getCustomerLedger().find((c) => c.id === "cust-1")?.balance
async function restart() {
  vi.restoreAllMocks()
  vi.resetModules()
  const m = await svc()
  m.sync.recoverStagedSyncOperations() // runs the journal first (as at startup / before a flush)
  return m
}
beforeEach(async () => {
  vi.restoreAllMocks()
  vi.resetModules()
  localStorage.clear()
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline in this test"))))
  seed()
  const m = await svc()
  m.security.openShift(100)
})
afterEach(() => { vi.unstubAllGlobals() })

describe("customer debt", () => {
  it("a debt payment that cannot be queued is not recorded; one whose commit fails is released once after restart", async () => {
    let m = await svc()
    let spy = failKey(K.queue)
    expect(() => m.customer.recordDebtPayment({ customerId: "cust-1", amount: 5, method: "Cash", reference: "P1" })).toThrow(m.sync.SyncStorageError)
    spy.mockRestore()
    expect(read(K.debtPayments)).toEqual([])

    // Owing 30 first.
    m.customer.recordDebtSale({ customerId: "cust-1", saleNumber: "S-D1", saleId: "sale-d1", subtotal: 30, tax: 0, total: 30, items: [] })
    expect(m.customer.recordDebtSale({ customerId: "cust-1", saleNumber: "S-D1", saleId: "sale-d1", subtotal: 30, tax: 0, total: 30, items: [] }).id).toBe("debt-sale-d1") // same id: once
    spy = failKey(K.queue, 1) // staged, then the commit cannot be saved
    const pay = m.customer.recordDebtPayment({ customerId: "cust-1", amount: 12, method: "Cash", reference: "P2", id: "pay-2" })
    spy.mockRestore()
    expect(pay.id).toBe("pay-2")
    expect(ops().find((o) => o.id === "op-pay-2")?.staged).toBe(true)
    // A retry with the same id records nothing more.
    m.customer.recordDebtPayment({ customerId: "cust-1", amount: 12, method: "Cash", reference: "P2", id: "pay-2" })

    m = await restart()
    m.sync.recoverStagedSyncOperations()
    expect(read(K.debtPayments)).toHaveLength(1)
    expect(await balance(m)).toBe(18)
    expect(ops().find((o) => o.id === "op-pay-2")?.staged).toBeUndefined()
    expect(ops().filter((o) => o.entity === "debt")).toHaveLength(2) // the debt sale and one payment
  })
})
