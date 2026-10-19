// ACCOUNTS-2 — supplier editing and the service boundary for money actions.
//  - updateSupplier keeps the supplier's id, so orders, payments and the balance stay attached;
//    the change is queued once per attempt (a retry or second press adds nothing), a queue that
//    cannot be written leaves the supplier unchanged, and an interrupted edit is settled on restart;
//  - suppliers.manage, sales.refund and sales.void are enforced by the services themselves,
//    not only by hidden or disabled buttons.
// Real services (jsdom localStorage); no network.
import { beforeEach, describe, expect, it, vi } from "vitest"

const K = {
  users: "lebanonpos.users.v1", current: "lebanonpos.current-user.v1", suppliers: "lebanonpos.suppliers.v1",
  pos: "lebanonpos.purchase-orders.v1", payments: "lebanonpos.supplier-payments.v1", queue: "lebanonpos.sync-queue.v1",
  sales: "lebanonpos.sales.v1", refunds: "lebanonpos.refunds.v1", products: "lebanonpos.products.v1", batches: "lebanonpos.inventory-batches.v1",
}
const read = <T = Record<string, unknown>>(k: string): T[] => { try { const v = JSON.parse(localStorage.getItem(k) ?? "[]"); return Array.isArray(v) ? v : [] } catch { return [] } }
const supplierOps = () => read<{ id: string; entity: string; action: string; staged?: boolean; payload: Record<string, unknown> }>(K.queue).filter((o) => o.entity === "supplier")
const supplier = () => read<Record<string, unknown>>(K.suppliers).find((s) => s.id === "sup-1")!
const EDIT = { name: "Malia Group SAL", mobile: "01 555 999", contact: "Hadi Nasr", address: "Dora, Beirut", notes: "Delivers Tuesdays" }

function seed(role: string, permissions: string[] = []) {
  localStorage.setItem(K.users, JSON.stringify([{ id: "u1", name: "Owner", role, pin: "HASH", code: "OWN", active: true, permissions }]))
  localStorage.setItem(K.current, "u1")
  localStorage.setItem(K.suppliers, JSON.stringify([{ id: "sup-1", name: "Malia Group", mobile: "01555123", contact: "", address: "", notes: "", createdAt: "2026-01-01T00:00:00.000Z" }]))
  localStorage.setItem(K.pos, JSON.stringify([
    { id: "po-1", poNumber: "PO-1", supplierId: "sup-1", supplierName: "Malia Group", status: "Received", paymentStatus: "Partial", invoiceNumber: "F-1", note: "", total: 100, paidTotal: 40, items: [], createdBy: "Owner", createdAt: "2026-10-01T10:00:00.000Z" },
  ]))
  localStorage.setItem(K.payments, JSON.stringify([
    { id: "sp-1", supplierId: "sup-1", supplierName: "Malia Group", purchaseOrderId: "po-1", purchaseOrderNumber: "PO-1", amount: 40, method: "Cash", reference: "", recordedBy: "Owner", createdAt: "2026-10-02T10:00:00.000Z" },
  ]))
  localStorage.setItem(K.products, JSON.stringify([{ id: 1, name: "Cola", barcode: "111", price: 5, cost: 2, stock: 0, category: "Drinks" }]))
  localStorage.setItem(K.batches, JSON.stringify([{ id: "lot-a", batchNumber: "A", productId: 1, productName: "Cola", barcode: "111", initialQuantity: 10, quantityRemaining: 0, unitCost: 2, unitPrice: 5, receivedAt: "2026-01-01T00:00:00.000Z", status: "Consumed" }]))
  localStorage.setItem(K.sales, JSON.stringify([{
    id: "sale-1", saleNumber: "S-1", paymentMethod: "Cash", subtotal: 50, tax: 0, total: 50, cost: 20, profit: 30, cashier: "Owner", status: "Completed", createdAt: "2026-10-01T10:00:00.000Z",
    items: [{ id: 1, lineId: "L1", name: "Cola", barcode: "111", cost: 2, quantity: 10, unitPrice: 5, total: 50, batchAllocations: [{ batchId: "lot-a", batchNumber: "A", quantity: 10, unitCost: 2 }] }],
  }]))
}
async function svc() {
  return {
    supplier: await import("../features/pos/services/supplier.service"),
    sales: await import("../features/pos/services/sales.service"),
    security: await import("../features/pos/services/security.service"),
    sync: await import("../features/pos/services/sync.service"),
  }
}
beforeEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
  localStorage.clear()
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline in this test"))))
})

describe("editing a supplier", () => {
  it("keeps the identity: orders, payments and the balance stay attached; one sync operation", async () => {
    seed("Admin")
    const m = await svc()
    const before = m.supplier.getSupplierLedger().find((s) => s.id === "sup-1")!
    m.supplier.updateSupplier("sup-1", EDIT, { opId: "op-sup-edit-1" })
    const after = m.supplier.getSupplierLedger().find((s) => s.id === "sup-1")!
    expect({ name: after.name, mobile: after.mobile, contact: after.contact, address: after.address, notes: after.notes }).toEqual({ ...EDIT, mobile: "01 555 999" })
    expect({ purchases: after.purchaseTotal, paid: after.paidTotal, balance: after.balance }).toEqual({ purchases: before.purchaseTotal, paid: before.paidTotal, balance: 60 })
    expect(read(K.pos)).toHaveLength(1)
    expect(read(K.payments)).toHaveLength(1)
    expect(m.supplier.getSupplierActivity("sup-1")).toHaveLength(2)
    const ops = supplierOps()
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ id: "op-sup-edit-1", action: "update", payload: { id: "sup-1", ...EDIT } })
    expect(ops[0].staged).toBeFalsy()
    expect(Object.keys(ops[0].payload).sort()).toEqual(["address", "contact", "id", "mobile", "name", "notes"])
  })

  it("survives a restart; a retry or second press with the same attempt records nothing more", async () => {
    seed("Admin")
    let m = await svc()
    m.supplier.updateSupplier("sup-1", EDIT, { opId: "op-sup-edit-1" })
    vi.resetModules()
    m = await svc()
    expect(supplier().name).toBe("Malia Group SAL")
    m.supplier.updateSupplier("sup-1", EDIT, { opId: "op-sup-edit-1" })
    m.supplier.updateSupplier("sup-1", EDIT, { opId: "op-sup-edit-1" })
    expect(supplierOps()).toHaveLength(1)
  })

  it("a queue that cannot be written leaves the supplier unchanged; the retry then records once", async () => {
    seed("Admin")
    const m = await svc()
    const setItem = Storage.prototype.setItem
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
      if (k === K.queue) throw new DOMException("quota", "QuotaExceededError")
      return setItem.call(this, k, v)
    })
    expect(() => m.supplier.updateSupplier("sup-1", EDIT, { opId: "op-sup-edit-1" })).toThrow(m.sync.SyncStorageError)
    spy.mockRestore()
    expect(supplier().name).toBe("Malia Group")
    expect(supplierOps()).toHaveLength(0)
    m.supplier.updateSupplier("sup-1", EDIT, { opId: "op-sup-edit-1" })
    expect(supplier().name).toBe("Malia Group SAL")
    expect(supplierOps()).toHaveLength(1)
  })

  it("an edit interrupted after its operation was saved is settled on restart: written -> sent, not written -> dropped", async () => {
    seed("Admin")
    let m = await svc()
    // The supplier write fails after the operation was staged.
    const setItem = Storage.prototype.setItem
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
      if (k === K.suppliers) throw new DOMException("quota", "QuotaExceededError")
      return setItem.call(this, k, v)
    })
    expect(() => m.supplier.updateSupplier("sup-1", EDIT, { opId: "op-sup-edit-1" })).toThrow()
    spy.mockRestore()
    vi.resetModules()
    m = await svc()
    m.sync.recoverStagedSyncOperations()
    expect(supplier().name).toBe("Malia Group")
    expect(supplierOps()).toHaveLength(0)
    // Written, but the commit was lost: released once.
    const stage = vi.spyOn(m.sync, "commitStagedSyncOperation")
    m.supplier.updateSupplier("sup-1", EDIT, { opId: "op-sup-edit-2" })
    stage.mockRestore()
    const q = read<{ id: string; staged?: boolean }>(K.queue).map((o) => (o.id === "op-sup-edit-2" ? { ...o, staged: true } : o))
    localStorage.setItem(K.queue, JSON.stringify(q))
    vi.resetModules()
    m = await svc()
    m.sync.recoverStagedSyncOperations()
    expect(supplierOps().filter((o) => o.id === "op-sup-edit-2" && !o.staged)).toHaveLength(1)
  })

  it("needs suppliers.manage: refused in the service, nothing written or queued", async () => {
    seed("Cashier", ["sales.checkout", "inventory.view", "inventory.receive"])
    const m = await svc()
    expect(() => m.supplier.updateSupplier("sup-1", EDIT, { opId: "op-x" })).toThrow(m.security.PermissionError)
    expect(() => m.supplier.archiveSupplier("sup-1")).toThrow(m.security.PermissionError)
    expect(() => m.supplier.deleteSupplier("sup-1")).toThrow(m.security.PermissionError)
    expect(supplier().name).toBe("Malia Group")
    expect(supplier().archived).toBeFalsy()
    expect(supplierOps()).toHaveLength(0)
  })
})

describe("refund and void are refused by the service without the permission", () => {
  it("a cashier cannot refund or void (no button needed); nothing changes", async () => {
    seed("Cashier", ["sales.checkout", "sales.reprint"])
    const m = await svc()
    m.security.openShift(100)
    expect(() => m.sales.processRefund({ saleId: "sale-1", quantities: { L1: 1 }, reason: "test" })).toThrow(m.security.PermissionError)
    expect(() => m.sales.voidSale("sale-1")).toThrow(m.security.PermissionError)
    expect(read(K.refunds)).toHaveLength(0)
    expect(read<{ status: string }>(K.sales)[0].status).toBe("Completed")
    expect(read<{ entity: string }>(K.queue).filter((o) => o.entity === "refund" || o.entity === "sale")).toHaveLength(0)
  })

  it("refund without void (and the reverse) is allowed exactly as granted", async () => {
    seed("Manager", ["sales.checkout", "sales.refund"])
    let m = await svc()
    m.security.openShift(100)
    expect(m.sales.processRefund({ saleId: "sale-1", quantities: { L1: 1 }, reason: "test" }).total).toBe(5)
    expect(() => m.sales.voidSale("sale-1")).toThrow(m.security.PermissionError)
    localStorage.clear(); vi.resetModules()
    seed("Manager", ["sales.checkout", "sales.void"])
    m = await svc()
    expect(() => m.sales.processRefund({ saleId: "sale-1", quantities: { L1: 1 }, reason: "test" })).toThrow(m.security.PermissionError)
    m.sales.voidSale("sale-1")
    expect(read<{ status: string }>(K.sales)[0].status).toBe("Voided")
  })
})
