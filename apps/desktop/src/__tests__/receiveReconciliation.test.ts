// Receiving reconciliation: separate purchase-order/payment outcomes with an idempotent retry, and
// interrupted saves settled from the effects actually found (complete / undo / close by hand).
// Restarts are simulated with vi.resetModules(): services are re-imported, only storage survives.
import { beforeEach, describe, expect, it, vi } from "vitest"

const KEYS = {
  products: "lebanonpos.products.v1",
  batches: "lebanonpos.inventory-batches.v1",
  movements: "lebanonpos.stock-movements.v1",
  orders: "lebanonpos.purchase-orders.v1",
  payments: "lebanonpos.supplier-payments.v1",
  adjustments: "lebanonpos.inventory-adjustments.v1",
  queue: "lebanonpos.sync-queue.v1",
}
const read = <T = Record<string, unknown>>(k: string): T[] => { try { return JSON.parse(localStorage.getItem(k) ?? "[]") } catch { return [] } }
/** Everything a duplicate would change: stock, lots, movements, orders, liability, payments, adjustments, ops. */
function books() {
  const orders = read<{ id: string; total: number; status: string; paymentStatus: string }>(KEYS.orders)
  const payments = read<{ id: string; amount: number }>(KEYS.payments)
  return {
    stock: Object.fromEntries(read<{ barcode: string; stock: number }>(KEYS.products).map((p) => [p.barcode, p.stock])),
    lots: read<{ id: string; initialQuantity: number; quantityRemaining: number }>(KEYS.batches).map((b) => `${b.id}:${b.initialQuantity}/${b.quantityRemaining}`).sort(),
    movements: read<{ id: string }>(KEYS.movements).map((m) => m.id).sort(),
    orders: orders.map((o) => `${o.id}:${o.total}:${o.status}:${o.paymentStatus}`),
    liability: orders.reduce((s, o) => s + o.total, 0) - payments.reduce((s, p) => s + p.amount, 0),
    payments: payments.map((p) => `${p.id}:${p.amount}`),
    adjustments: read<{ id: string }>(KEYS.adjustments).map((a) => a.id),
    ops: read<{ id: string }>(KEYS.queue).map((o) => o.id).sort(),
  }
}
function failWrites(key: string) {
  const setItem = Storage.prototype.setItem
  return vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
    if (k === key) throw new DOMException("quota", "QuotaExceededError")
    return setItem.call(this, k, v)
  })
}
function token(tenantId: string) {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, "")
  return `${b64({ alg: "none" })}.${b64({ tenantId })}.sig`
}
async function load() {
  return {
    ...(await import("../features/pos/services/receiveSubmission.service")),
    ...(await import("../features/pos/services/supplier.service")),
    ...(await import("../features/pos/services/receiveRecovery.service")),
  }
}
const USERS = [
  { id: "u-1", name: "Test Admin", mobile: "0", pin: "x", role: "Admin", active: true, createdAt: new Date().toISOString(), pinChanged: false },
  { id: "u-2", name: "Test Cashier", mobile: "1", pin: "y", role: "Cashier", active: true, createdAt: new Date().toISOString(), pinChanged: false },
]
const asUser = (id: string) => localStorage.setItem("lebanonpos.current-user.v1", id)
let CONTEXT: { supplierId: string; supplierName: string; invoiceNumber: string; paymentMethod: "Cash" }
// An existing product (stock 10) and a new one, as the Receive page sends them.
const ENTRIES = [
  { rowId: "row-a", name: "Kept Widget", barcode: "RCN-0001", category: "Test", quantity: 4, cost: 2, price: 4 },
  { rowId: "row-b", name: "New Widget", barcode: "RCN-0002", category: "Test", quantity: 6, cost: 1, price: 3 },
]

beforeEach(async () => {
  vi.restoreAllMocks()
  vi.resetModules()
  localStorage.clear()
  localStorage.setItem("lebanonpos.users.v1", JSON.stringify(USERS))
  asUser("u-1")
  localStorage.setItem(KEYS.products, JSON.stringify([{ id: 1, syncId: "p-kept", name: "Kept Widget", barcode: "RCN-0001", category: "Test", price: 4, cost: 2, stock: 10 }]))
  const { createSupplier } = await import("../features/pos/services/supplier.service")
  const s = createSupplier({ name: "Malia Group", mobile: "01 000 000", contact: "Karim", address: "Dora", notes: "" })
  CONTEXT = { supplierId: s.id, supplierName: s.name, invoiceNumber: "INV-31", paymentMethod: "Cash" }
})

describe("purchase order and payment outcomes", () => {
  it("payment failure after the PO was created: PO kept and returned, visibly unpaid, retried once without duplicates", async () => {
    let m = await load()
    const spy = failWrites(KEYS.payments)
    const summary = await m.receiveAndRecord(ENTRIES, CONTEXT, { submissionId: "rcv-pay" })
    spy.mockRestore()

    // Three separate outcomes: stock received, PO recorded (id + number returned), payment failed.
    expect(summary.results.map((r) => r.status)).toEqual(["accepted", "accepted"])
    expect(summary.purchaseOrder).toMatchObject({ status: "recorded", id: "rcv-pay-po", total: 14 })
    expect(summary.purchaseOrder.number).toMatch(/^PO-/)
    expect(summary.payment).toMatchObject({ status: "failed", amount: 14, method: "Cash" })
    const after = books()
    expect(after.stock).toEqual({ "RCN-0001": 14, "RCN-0002": 6 })
    expect(after.orders).toEqual(["rcv-pay-po:14:Received:Unpaid"]) // not "Paid" without a payment
    expect(after.liability).toBe(14) // owed once
    expect(after.payments).toEqual([])
    expect(after.ops).toEqual(expect.arrayContaining(["rcv-pay-op-po", "rcv-pay-op-po-received"]))
    expect(m.getReceiveFinanceIssues().map((s) => s.id)).toEqual(["rcv-pay"])

    // Retry needs suppliers.manage.
    asUser("u-2")
    await expect(m.retryReceiveFinance("rcv-pay")).rejects.toThrow(/permission/i)
    asUser("u-1")

    // Restart, retry: the payment is recorded once, the PO becomes paid; nothing else moves.
    vi.resetModules(); m = await load()
    const finance = await m.retryReceiveFinance("rcv-pay")
    expect(finance.payment).toMatchObject({ status: "recorded", id: "rcv-pay-pay", amount: 14 })
    const paid = books()
    expect(paid.payments).toEqual(["rcv-pay-pay:14"])
    expect(paid.orders).toEqual(["rcv-pay-po:14:Closed:Paid"])
    expect(paid.liability).toBe(0)
    expect({ ...paid, orders: after.orders, payments: [], liability: 14, ops: [] }).toEqual({ ...after, ops: [] }) // stock, lots, movements unchanged
    expect(m.getReceiveFinanceIssues()).toEqual([])

    // A second retry and a replayed save write nothing.
    await m.retryReceiveFinance("rcv-pay")
    const replay = await m.receiveAndRecord(ENTRIES, CONTEXT, { submissionId: "rcv-pay" })
    expect(replay.replayed).toBe(true)
    expect(replay.payment.status).toBe("recorded")
    expect(books()).toEqual(paid)
  })
})

describe("interrupted saves", () => {
  async function interruptAfterStock() {
    const m = await load()
    const spy = failWrites(KEYS.batches)
    await expect(m.receiveAndRecord(ENTRIES, CONTEXT, { submissionId: "rcv-x" })).rejects.toBeInstanceOf(m.ReceiveOutcomeUnknownError)
    spy.mockRestore()
  }

  it("stock written but lots missing: the effects are shown as found, and completing adds only what is missing", async () => {
    await interruptAfterStock()
    const m = await load()
    expect(books().stock).toEqual({ "RCN-0001": 14, "RCN-0002": 6 })
    expect(books().lots).toEqual([])

    const fx = await m.inspectReceiveSubmission("rcv-x")
    expect(fx.rows.map((r) => [r.name, r.stock.state, r.stock.before, r.stock.now, r.lot.state, r.movement.state])).toEqual([
      ["Kept Widget", "applied", 10, 14, "missing", "missing"],
      ["New Widget", "applied", 0, 6, "missing", "missing"], // a new product had no stock before
    ])
    expect(fx.purchaseOrder.state).toBe("missing")
    expect(fx.payment.state).toBe("missing")
    const op = (label: string) => fx.operations.find((o) => o.label === label)?.state
    expect(op("products")).toBe("queued") // the new product's create
    expect(op("receive")).toBe("not_in_queue")
    expect(fx.complete).toEqual({ safe: true, reasons: [] })
    expect(fx.undo.safe).toBe(true)

    // Permission: a cashier can neither complete nor undo.
    asUser("u-2")
    await expect(m.completeReceiveSubmission("rcv-x")).rejects.toThrow(/permission/i)
    await expect(m.undoReceiveSubmission("rcv-x")).rejects.toThrow(/permission/i)
    asUser("u-1")

    const summary = await m.completeReceiveSubmission("rcv-x")
    expect(summary.purchaseOrder.status).toBe("recorded")
    expect(summary.payment.status).toBe("recorded")
    const done = books()
    expect(done.stock).toEqual({ "RCN-0001": 14, "RCN-0002": 6 }) // stock not added a second time
    expect(done.lots).toEqual(["rcv-x-lot-0:4/4", "rcv-x-lot-1:6/6"])
    expect(done.movements).toEqual(["rcv-x-mv-0", "rcv-x-mv-1"])
    expect(done.orders).toEqual(["rcv-x-po:14:Closed:Paid"])
    expect(done.payments).toEqual(["rcv-x-pay:14"])
    const receiveOp = read<{ id: string; payload: Array<{ id: string; quantityRemaining: number }> }>(KEYS.queue).find((o) => o.id === "rcv-x-op-receive")
    expect(receiveOp?.payload.map((b) => `${b.id}:${b.quantityRemaining}`)).toEqual(["rcv-x-lot-0:4", "rcv-x-lot-1:6"])
    const sub = m.getReceiveSubmission("rcv-x")!
    expect(sub).toMatchObject({ status: "committed", recovered: true })
    expect(sub.audit?.map((a) => a.action)).toEqual(["recovery_complete_started", "recovery_completed"])
    const audit = read<{ action: string }>("lebanonpos.audit.v1").map((a) => a.action)
    expect(audit).toEqual(expect.arrayContaining(["inventory.receive.recovery_completed"]))
  })

  it("stock written but lots missing: undo takes back only the stock that was written, once", async () => {
    await interruptAfterStock()
    const m = await load()
    const undone = await m.undoReceiveSubmission("rcv-x")
    expect(undone).toMatchObject({ status: "resolved", resolution: "undone" })
    const after = books()
    expect(after.stock).toEqual({ "RCN-0001": 10, "RCN-0002": 0 }) // the new product stays, at 0
    expect(after.lots).toEqual([])
    expect(after.orders).toEqual([])
    expect(after.adjustments).toEqual([]) // nothing reached the server, so nothing to sync back
    await m.undoReceiveSubmission("rcv-x") // again: no-op
    expect(books()).toEqual(after)
    await expect(m.completeReceiveSubmission("rcv-x")).rejects.toThrow(/closed/)
  })

  it("restart during recovery: a recovery interrupted mid-way resumes from its journal without duplicates", async () => {
    await interruptAfterStock()
    let m = await load()
    // Recovery writes the lots, then fails on the movements (storage full again).
    const spy = failWrites(KEYS.movements)
    await expect(m.completeReceiveSubmission("rcv-x")).rejects.toBeInstanceOf(m.ReceiveOutcomeUnknownError)
    spy.mockRestore()
    expect(books().lots).toEqual(["rcv-x-lot-0:4/4", "rcv-x-lot-1:6/6"])
    expect(books().movements).toEqual([])

    // Restart; the effects now show the lots, and completing again finishes the rest.
    vi.resetModules(); m = await load()
    const fx = await m.inspectReceiveSubmission("rcv-x")
    expect(fx.rows.map((r) => [r.lot.state, r.movement.state])).toEqual([["applied", "missing"], ["applied", "missing"]])
    expect(fx.complete.safe).toBe(true)
    await m.completeReceiveSubmission("rcv-x")
    const done = books()
    expect(done.stock).toEqual({ "RCN-0001": 14, "RCN-0002": 6 })
    expect(done.lots).toEqual(["rcv-x-lot-0:4/4", "rcv-x-lot-1:6/6"])
    expect(done.movements).toEqual(["rcv-x-mv-0", "rcv-x-mv-1"])
    expect(done.orders).toHaveLength(1)
    expect(done.payments).toHaveLength(1)
  })

  it("recovery retried twice: the second completion writes nothing", async () => {
    await interruptAfterStock()
    const m = await load()
    await m.completeReceiveSubmission("rcv-x")
    const once = books()
    const again = await m.completeReceiveSubmission("rcv-x")
    expect(again.replayed).toBe(true)
    expect(books()).toEqual(once)
  })

  it("a lot sold from before its receive was ever sent blocks automatic repair, with the reason", async () => {
    await interruptAfterStock()
    const m = await load()
    // With the queue full, completing no longer writes the lots without their receive operation:
    // the operation is staged first, so nothing is written and the submission stays as it was.
    const spy = failWrites(KEYS.queue)
    await expect(m.completeReceiveSubmission("rcv-x")).rejects.toBeInstanceOf(m.ReceiveOutcomeUnknownError)
    spy.mockRestore()
    expect(books().lots).toEqual([])
    // A submission interrupted before that change can still hold lots whose receive was never
    // queued: build that state directly (lots written, no receive operation), then sell 3.
    const sub = m.getReceiveSubmission("rcv-x")!
    localStorage.setItem(KEYS.batches, JSON.stringify(sub.plan!.lots.map((l, i) => ({
      id: l.id, batchNumber: `LOT-OLD-${i}`, productId: l.productId, productSyncId: l.productSyncId, productName: l.productName, barcode: l.barcode,
      initialQuantity: l.quantity, quantityRemaining: i === 0 ? l.quantity - 3 : l.quantity, unitCost: l.unitCost, unitPrice: l.unitPrice,
      receivedAt: new Date().toISOString(), status: "Open",
    }))))
    const fx = await m.inspectReceiveSubmission("rcv-x")
    expect(fx.complete.safe).toBe(false)
    expect(fx.complete.reasons.map((r) => r.code)).toContain("lot_sold_unsent")
    expect(fx.undo.reasons.map((r) => r.code)).toContain("lot_sold")
    const before = books()
    await expect(m.completeReceiveSubmission("rcv-x")).rejects.toBeInstanceOf(m.ReceiveRecoveryBlockedError)
    expect(books()).toEqual(before)
    expect(m.getReceiveSubmission("rcv-x")?.status).toBe("started") // preserved, still blocked
    await expect(m.closeReceiveSubmissionByHand("rcv-x", "")).rejects.toThrow(/Say what you checked/)
    const closed = await m.closeReceiveSubmissionByHand("rcv-x", "Counted Kept Widget: 11. Posted a count.")
    expect(closed).toMatchObject({ status: "resolved", resolution: "manual" })
    expect(closed.audit?.at(-1)?.detail).toContain("Counted Kept Widget")
  })

  it("store switch and back: another store cannot see or settle it; back home it is still blocked, with details", async () => {
    localStorage.setItem("lebanonpos.auth-token", token("tenant-A"))
    await interruptAfterStock()
    let m = await load()
    expect(m.getUnresolvedReceiveSubmissions().map((s) => s.id)).toEqual(["rcv-x"])

    const sync = await import("../features/pos/services/sync.service")
    await sync.clearStoreData()
    sync.setAuthToken(token("tenant-B"))
    vi.resetModules(); m = await load()
    localStorage.setItem("lebanonpos.users.v1", JSON.stringify(USERS)); asUser("u-1")
    expect(m.getUnresolvedReceiveSubmissions()).toEqual([])
    await expect(m.inspectReceiveSubmission("rcv-x")).rejects.toThrow(/not on this device for this store/)
    await expect(m.completeReceiveSubmission("rcv-x")).rejects.toThrow(/not on this device for this store/)
    await expect(m.undoReceiveSubmission("rcv-x")).rejects.toThrow(/not on this device for this store/)

    // Back to A. Its local data was wiped by the switch (it returns with the next pull), so the
    // products this delivery wrote are not here: neither completing nor undoing is safe yet.
    sync.setAuthToken(token("tenant-A"))
    expect(m.getUnresolvedReceiveSubmissions().map((s) => s.id)).toEqual(["rcv-x"])
    const fx = await m.inspectReceiveSubmission("rcv-x")
    expect(fx.complete.safe).toBe(false)
    expect(fx.complete.reasons.map((r) => r.code)).toContain("product_missing")
    await expect(m.completeReceiveSubmission("rcv-x")).rejects.toBeInstanceOf(m.ReceiveRecoveryBlockedError)
    expect(m.getReceiveSubmission("rcv-x")?.status).toBe("started")
  })
})
