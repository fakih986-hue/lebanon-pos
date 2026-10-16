import { describe, it, expect, beforeEach, vi } from "vitest"

// A product the books reference (sales, refunds, lots, ledger, purchase orders) is archived,
// never deleted; and archive / restore / delete need inventory.manage in the service itself.
const { enqueueMock } = vi.hoisted(() => ({ enqueueMock: vi.fn() }))
vi.mock("../features/pos/services/sync.service", () => ({
  enqueueSyncOperation: (op: unknown) => enqueueMock(op),
  // Money/stock writers stage their operation before the record and commit it after it: a staged
  // operation is the same operation the plain enqueue used to receive.
  stageSyncOperation: (op: { id?: string }) => { enqueueMock(op); return { ...op, id: op.id ?? "staged-op" } },
  commitStagedSyncOperation: () => "pending",
  settleStagedSyncOperation: () => "unknown",
  discardStagedSyncOperation: () => {},
  isSyncOperationRecorded: () => true,
  isRecordAcknowledged: () => false,
  assertCanWrite: () => {},
  getDeviceId: () => "DEV-TEST",
  getApiUrl: () => "",
  isSuspensionGracePeriodExpired: () => false,
  nextDocumentReference: (prefix: string, digits: number) => `${prefix}-TEST-${"1".padStart(digits, "0")}`,
  getDeviceTag: () => "TEST",
  getCurrentTenantId: () => null,
  getSyncQueue: () => [],
}))

const P = "lebanonpos.products.v1"
function seed(role: "Admin" | "Cashier" = "Admin") {
  window.localStorage.setItem("lebanonpos.users.v1", JSON.stringify([{ id: "u1", name: "U", role, pin: "HASH", code: "U", permissions: [], active: true }]))
  window.localStorage.setItem("lebanonpos.current-user.v1", "u1")
  window.localStorage.setItem(P, JSON.stringify([
    { id: 1, name: "Pepsi Can", barcode: "111", category: "Drinks", price: 1, cost: 0.5, stock: 5, accent: "cyan" },
    { id: 2, name: "Never sold", barcode: "222", category: "Drinks", price: 1, cost: 0.5, stock: 0, accent: "cyan" },
    { id: 3, name: "Pepsi 1L", barcode: "333", category: "Drinks", price: 2, cost: 1, stock: 0, accent: "cyan", parentId: 2 },
  ]))
}

describe("product delete / archive guard", () => {
  beforeEach(() => { window.localStorage.clear(); enqueueMock.mockClear(); vi.resetModules() })

  for (const [what, key, value] of [
    ["a sale", "lebanonpos.sales.v1", [{ id: "s1", items: [{ id: 1, quantity: 1 }] }]],
    ["a refund", "lebanonpos.refunds.v1", [{ id: "r1", items: [{ id: 1, quantity: 1 }] }]],
    ["a lot", "lebanonpos.inventory-batches.v1", [{ id: "b1", productId: 1 }]],
    ["a stock movement", "lebanonpos.stock-movements.v1", [{ id: "m1", productId: 1 }]],
    ["a purchase-order line", "lebanonpos.purchase-orders.v1", [{ id: "o1", items: [{ barcode: "111" }] }]],
  ] as const) {
    it(`refuses to delete a product with ${what}; it stays and nothing is queued`, async () => {
      seed(); window.localStorage.setItem(key, JSON.stringify(value))
      const ps = await import("../features/pos/services/product.service")
      expect(() => ps.deleteProduct(1)).toThrow(ps.ProductInUseError)
      expect(JSON.parse(window.localStorage.getItem(P)!).some((p: { id: number }) => p.id === 1)).toBe(true)
      expect(enqueueMock).not.toHaveBeenCalled()
    })
  }

  it("refuses to delete a parent whose variant has history", async () => {
    seed(); window.localStorage.setItem("lebanonpos.inventory-batches.v1", JSON.stringify([{ id: "b3", productId: 3 }]))
    const ps = await import("../features/pos/services/product.service")
    expect(() => ps.deleteProduct(2)).toThrow(/Pepsi 1L/)
  })

  it("still deletes a product (and its variants) with no history at all", async () => {
    seed()
    const ps = await import("../features/pos/services/product.service")
    ps.deleteProduct(2)
    expect(JSON.parse(window.localStorage.getItem(P)!).map((p: { id: number }) => p.id)).toEqual([1])
    expect(enqueueMock.mock.calls.map((c) => (c[0] as { action: string }).action)).toEqual(["delete", "delete"])
  })

  it("archive, restore and delete need inventory.manage in the service", async () => {
    seed("Cashier")
    const ps = await import("../features/pos/services/product.service")
    const { PermissionError } = await import("../features/pos/services/security.service")
    expect(() => ps.archiveProduct(1)).toThrow(PermissionError)
    expect(() => ps.restoreProduct(1)).toThrow(PermissionError)
    expect(() => ps.deleteProduct(2)).toThrow(PermissionError)
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it("an Admin can archive and restore a product with history", async () => {
    seed(); window.localStorage.setItem("lebanonpos.sales.v1", JSON.stringify([{ id: "s1", items: [{ id: 1 }] }]))
    const ps = await import("../features/pos/services/product.service")
    ps.archiveProduct(1)
    expect(JSON.parse(window.localStorage.getItem(P)!).find((p: { id: number }) => p.id === 1).archived).toBe(true)
    ps.restoreProduct(1)
    expect(JSON.parse(window.localStorage.getItem(P)!).find((p: { id: number }) => p.id === 1).archived).toBe(false)
  })
})
