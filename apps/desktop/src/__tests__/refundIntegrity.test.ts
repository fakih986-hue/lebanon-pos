import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

// REFUND-INTEGRITY-1 — desktop refund/void behaviour against the REAL sales,
// batch, product, sync-queue and conflict services (only network is blocked).
// Business invariants under test:
//  - repeated partial refunds restore the exact lots, per sale line
//  - a refund beyond what remains refundable changes nothing
//  - a refund interrupted before its commit point rolls back completely;
//    one interrupted after it is completed on restart, effects applied once
//  - legacy sales (no line ids) restore product stock only
//  - a refunded sale cannot be voided; a void restores recorded lots without
//    pushing an absolute lot table
//  - a server-rejected refund is never silently removed, and is settled only
//    by a manager with a note

const USERS_KEY = "lebanonpos.users.v1"
const CURRENT_USER_KEY = "lebanonpos.current-user.v1"
const SALES_KEY = "lebanonpos.sales.v1"
const REFUNDS_KEY = "lebanonpos.refunds.v1"
const PRODUCTS_KEY = "lebanonpos.products.v1"
const BATCHES_KEY = "lebanonpos.inventory-batches.v1"
const QUEUE_KEY = "lebanonpos.sync-queue.v1"
const JOURNAL_KEY = "lebanonpos.refund-journal.v1"

const read = (key: string) => JSON.parse(window.localStorage.getItem(key) ?? "[]")
const queue = () => read(QUEUE_KEY) as Array<{ id: string; entity: string; action: string; status: string; payload: any; error?: string }>
/** Queue minus the shift/open op every test makes during setup. */
const businessOps = () => queue().filter((op) => op.entity !== "shift")
const stockOf = (id: number) => read(PRODUCTS_KEY).find((p: any) => p.id === id).stock
const lotOf = (id: string) => read(BATCHES_KEY).find((b: any) => b.id === id).quantityRemaining

function seed({ role = "Admin" }: { role?: string } = {}) {
  window.localStorage.setItem(USERS_KEY, JSON.stringify([{ id: "u1", name: "Owner", role, pin: "HASH", code: "OWN", active: true, permissions: [] }]))
  window.localStorage.setItem(CURRENT_USER_KEY, "u1")
  window.localStorage.setItem(PRODUCTS_KEY, JSON.stringify([
    { id: 1, name: "Cola", barcode: "111", price: 5, cost: 2, stock: 0, category: "Drinks" },
    { id: 2, name: "Chips", barcode: "222", price: 3, cost: 1, stock: 0, category: "Snacks" },
  ]))
  window.localStorage.setItem(BATCHES_KEY, JSON.stringify([
    { id: "lot-a", batchNumber: "A", productId: 1, productName: "Cola", barcode: "111", initialQuantity: 6, quantityRemaining: 0, unitCost: 2, unitPrice: 5, receivedAt: "2026-01-01T00:00:00.000Z", status: "Consumed" },
    { id: "lot-b", batchNumber: "B", productId: 1, productName: "Cola", barcode: "111", initialQuantity: 4, quantityRemaining: 0, unitCost: 3, unitPrice: 5, receivedAt: "2026-02-01T00:00:00.000Z", status: "Consumed" },
  ]))
}

function trackedSale(over: Record<string, unknown> = {}) {
  return {
    id: "sale-1", saleNumber: "S-1", paymentMethod: "Cash", subtotal: 50, tax: 0, total: 50, cost: 24, profit: 26,
    cashier: "Owner", status: "Completed", createdAt: "2026-10-01T10:00:00.000Z",
    tender: { currency: "USD", exchangeRate: 89500, paidUsd: 50, paidLbp: 0, paidTotalUsd: 50, paidTotalLbp: 4475000, changeUsd: 0, changeLbp: 0, changeCurrency: "USD" },
    items: [{
      id: 1, lineId: "L1", name: "Cola", barcode: "111", cost: 2.4, quantity: 10, unitPrice: 5, total: 50,
      batchAllocations: [
        { batchId: "lot-a", batchNumber: "A", quantity: 6, unitCost: 2 },
        { batchId: "lot-b", batchNumber: "B", quantity: 4, unitCost: 3 },
      ],
    }],
    ...over,
  }
}

async function services() {
  const sales = await import("../features/pos/services/sales.service")
  const security = await import("../features/pos/services/security.service")
  const sync = await import("../features/pos/services/sync.service")
  const conflicts = await import("../features/pos/services/refundConflict.service")
  security.openShift(100)
  return { sales, security, sync, conflicts }
}

describe("REFUND-INTEGRITY-1 — desktop refunds", () => {
  beforeEach(() => {
    vi.resetModules()
    window.localStorage.clear()
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network disabled in tests"))))
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it("new sales get a stable line id on every line", async () => {
    seed()
    const { sales } = await services()
    const sale = sales.recordSale({
      saleNumber: "S-NEW", paymentMethod: "Cash", subtotal: 8, tax: 0, total: 8,
      items: [
        { id: 1, name: "Cola", barcode: "111", cost: 2, quantity: 1, unitPrice: 5, total: 5 },
        { id: 1, name: "Cola", barcode: "111", cost: 2, quantity: 1, unitPrice: 3, total: 3 },
      ],
    })
    const ids = sale.items.map((item) => item.lineId)
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(true)
    expect(new Set(ids).size).toBe(2)
  })

  it("repeated partial refunds restore the exact lots and record the original rate", async () => {
    seed()
    window.localStorage.setItem(SALES_KEY, JSON.stringify([trackedSale()]))
    const { sales } = await services()

    const first = sales.processRefund({ saleId: "sale-1", quantities: { L1: 6 }, reason: "" })
    expect(lotOf("lot-a")).toBe(6)
    expect(lotOf("lot-b")).toBe(0)
    expect(first.exchangeRate).toBe(89500)
    expect(first.rateSource).toBe("sale_tender")
    expect(first.items[0]).toMatchObject({ saleLineId: "L1", quantity: 6, batchAllocations: [{ batchId: "lot-a", quantity: 6, unitCost: 2 }] })
    expect(first.total).toBe(30)

    sales.processRefund({ saleId: "sale-1", quantities: { L1: 4 }, reason: "" })
    expect(lotOf("lot-a")).toBe(6)
    expect(lotOf("lot-b")).toBe(4)
    expect(stockOf(1)).toBe(10)

    // Only refund ops are queued — never an absolute lot-table write.
    expect(businessOps().map((op) => `${op.entity}/${op.action}`)).toEqual(["refund/create", "refund/create"])
    expect(sales.getPendingRefundJournal()).toEqual([])
  })

  it("refuses a refund beyond what remains refundable and changes nothing", async () => {
    seed()
    window.localStorage.setItem(SALES_KEY, JSON.stringify([trackedSale()]))
    const { sales } = await services()
    sales.processRefund({ saleId: "sale-1", quantities: { L1: 8 }, reason: "" })
    const before = { stock: stockOf(1), a: lotOf("lot-a"), b: lotOf("lot-b"), refunds: read(REFUNDS_KEY).length, ops: businessOps().length }

    expect(() => sales.processRefund({ saleId: "sale-1", quantities: { L1: 3 }, reason: "" })).toThrow(/^REFUND_EXCEEDS_REFUNDABLE/)
    expect({ stock: stockOf(1), a: lotOf("lot-a"), b: lotOf("lot-b"), refunds: read(REFUNDS_KEY).length, ops: businessOps().length }).toEqual(before)
    expect(sales.previewRefund({ saleId: "sale-1", quantities: { L1: 2 }, reason: "" }).total).toBe(10)
  })

  it("a refund interrupted before its commit point rolls back completely", async () => {
    seed()
    window.localStorage.setItem(SALES_KEY, JSON.stringify([trackedSale()]))
    const { sales } = await services()
    sales.refundFaults.afterStep = (step) => { if (step === "stock") throw new Error("simulated crash") }

    expect(() => sales.processRefund({ saleId: "sale-1", quantities: { L1: 7 }, reason: "" })).toThrow("simulated crash")
    expect(stockOf(1)).toBe(0)
    expect(lotOf("lot-a")).toBe(0)
    expect(lotOf("lot-b")).toBe(0)
    expect(read(REFUNDS_KEY)).toEqual([])
    expect(businessOps()).toEqual([])
    expect(sales.getPendingRefundJournal()).toEqual([])
    sales.refundFaults.afterStep = undefined
  })

  it("on restart, an uncommitted journal entry is rolled back and a committed one is completed once", async () => {
    seed()
    window.localStorage.setItem(SALES_KEY, JSON.stringify([trackedSale({ paymentMethod: "Debt", status: "Debt", customerId: "c1", customerName: "Rami" })]))
    let { sales } = await services()

    // Crash right after the commit point (refund + sync op written, debt credit not yet).
    sales.refundFaults.afterStep = (step) => { if (step === "commit") throw new Error("power cut") }
    expect(() => sales.processRefund({ saleId: "sale-1", quantities: { L1: 2 }, reason: "" })).toThrow("power cut")
    expect(read(REFUNDS_KEY)).toHaveLength(1)
    expect(sales.getPendingRefundJournal()).toHaveLength(1)
    expect(read("lebanonpos.debt-payments.v1")).toEqual([])

    // A second, half-applied refund that never reached its commit point (stock restored, no record).
    const journal = read(JOURNAL_KEY)
    journal.push({
      refundId: "ghost", startedAt: "2026-10-01T00:00:00.000Z",
      refund: { id: "ghost", refundNumber: "R-GHOST", saleId: "sale-1", saleNumber: "S-1", total: 5, items: [] },
      plan: [{ productId: 1, productName: "Cola", barcode: "111", quantity: 1, allocations: [{ batchId: "lot-b", quantity: 1 }] }],
      steps: { lots: true, stock: true, committed: false, debt: false, ledger: false },
    })
    window.localStorage.setItem(JOURNAL_KEY, JSON.stringify(journal))
    const products = read(PRODUCTS_KEY); products[0].stock += 1; window.localStorage.setItem(PRODUCTS_KEY, JSON.stringify(products))
    const lots = read(BATCHES_KEY); lots[1].quantityRemaining += 1; window.localStorage.setItem(BATCHES_KEY, JSON.stringify(lots))

    // "Restart": fresh modules, then startup recovery.
    vi.resetModules()
    ;({ sales } = await services())
    expect(sales.recoverRefundJournal()).toEqual({ rolledBack: 1, completed: 1 })
    expect(sales.getPendingRefundJournal()).toEqual([])
    expect(stockOf(1)).toBe(2)                 // ghost undone, real refund kept
    expect(lotOf("lot-b")).toBe(0)
    expect(read("lebanonpos.debt-payments.v1")).toHaveLength(1)
    expect(queue().filter((op) => op.entity === "refund")).toHaveLength(1)

    // Running recovery again changes nothing.
    expect(sales.recoverRefundJournal()).toEqual({ rolledBack: 0, completed: 0 })
    expect(read("lebanonpos.debt-payments.v1")).toHaveLength(1)
  })

  it("legacy sales (no line ids) pool per product and restore product stock only", async () => {
    seed()
    window.localStorage.setItem(SALES_KEY, JSON.stringify([trackedSale({
      items: [
        { id: 1, name: "Cola", barcode: "111", cost: 2, quantity: 3, unitPrice: 5, total: 15, batchAllocations: [{ batchId: "lot-a", batchNumber: "A", quantity: 3, unitCost: 2 }] },
        { id: 1, name: "Cola", barcode: "111", cost: 2, quantity: 2, unitPrice: 5, total: 10 },
      ],
      subtotal: 25, total: 25, tender: undefined,
    })]))
    const { sales } = await services()
    const refund = sales.processRefund({ saleId: "sale-1", quantities: { "legacy-product:1": 5 }, reason: "" })
    expect(stockOf(1)).toBe(5)
    expect(lotOf("lot-a")).toBe(0)            // no lot guessed for a legacy line
    expect(refund.items[0].batchAllocations).toBeUndefined()
    expect(refund.rateSource).toBe("unavailable")
    expect(refund.exchangeRate).toBeNull()
  })

  it("normalizes sales pulled from the server so refunds use the product id", async () => {
    seed()
    window.localStorage.setItem(SALES_KEY, JSON.stringify([{
      ...trackedSale(), total: "50.0000", subtotal: "50.0000",
      items: [{ id: "6b7d-uuid", saleId: "sale-1", productId: 1, productName: "Cola", barcode: "111", quantity: 10, unitPrice: "5.0000", total: "50.0000", cost: "2.4000", lineId: "L1", lineIndex: 0, batchAllocations: [{ batchId: "lot-a", quantity: 6, unitCost: 2 }, { batchId: "lot-b", quantity: 4, unitCost: 3 }] }],
      tender: { exchangeRate: "89500.0000", currency: "USD", paidUsd: "50", paidLbp: "0", paidTotalUsd: "50", paidTotalLbp: "4475000", changeUsd: "0", changeLbp: "0", changeCurrency: "USD" },
    }]))
    const { sales } = await services()
    const sale = sales.getSales()[0]
    expect(sale.total).toBe(50)
    expect(sale.items[0]).toMatchObject({ id: 1, name: "Cola", unitPrice: 5, lineId: "L1" })
    const refund = sales.processRefund({ saleId: "sale-1", quantities: { L1: 1 }, reason: "" })
    expect(stockOf(1)).toBe(1)
    expect(refund.items[0].id).toBe(1)
    expect(refund.exchangeRate).toBe(89500)
  })

  it("a refunded sale cannot be voided; a clean void restores lots without an absolute lot push", async () => {
    seed()
    window.localStorage.setItem(SALES_KEY, JSON.stringify([trackedSale(), trackedSale({ id: "sale-2", saleNumber: "S-2" })]))
    const { sales } = await services()
    sales.processRefund({ saleId: "sale-1", quantities: { L1: 1 }, reason: "" })
    expect(() => sales.voidSale("sale-1")).toThrow(/^VOID_HAS_REFUNDS/)
    expect(sales.getSales().find((s) => s.id === "sale-1")?.status).toBe("Completed")

    window.localStorage.setItem(BATCHES_KEY, JSON.stringify(read(BATCHES_KEY).map((b: any) => ({ ...b, quantityRemaining: 0, status: "Consumed" }))))
    const stock0 = stockOf(1)
    sales.voidSale("sale-2")
    expect(stockOf(1)).toBe(stock0 + 10)
    expect(lotOf("lot-a")).toBe(6)
    expect(lotOf("lot-b")).toBe(4)
    expect(queue().some((op) => op.entity === "inventory")).toBe(false)
    expect(queue().filter((op) => op.entity === "sale" && op.action === "void")).toHaveLength(1)
  })
})

describe("REFUND-INTEGRITY-1 — server-rejected refunds", () => {
  beforeEach(() => {
    vi.resetModules()
    window.localStorage.clear()
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network disabled in tests"))))
  })
  afterEach(() => { vi.unstubAllGlobals() })

  async function issueThenReject() {
    window.localStorage.setItem(SALES_KEY, JSON.stringify([trackedSale()]))
    const s = await services()
    const refund = s.sales.processRefund({ saleId: "sale-1", quantities: { L1: 2 }, reason: "" })
    // The server later rejects it (another device already refunded these items).
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(queue().map((op) => ({
      ...op, status: "Rejected", attempts: 5, lastAttemptAt: "2026-10-02T00:00:00.000Z",
      error: "REFUND_EXCEEDS_REFUNDABLE: Line L1: requested 2, only 0 still refundable",
    }))))
    return { ...s, refund }
  }

  it("stays visible and survives 'clear stuck', remove, clear-all and a full pull", async () => {
    seed()
    const { sales, sync, conflicts, refund } = await issueThenReject()
    const [conflict] = conflicts.getMoneyConflicts()
    expect(conflict).toMatchObject({ kind: "refund", refundId: refund.id, amount: 10, code: "REFUND_EXCEEDS_REFUNDABLE" })

    sync.clearSyncQueue()
    sync.removeRejectedOperation(conflict.opId)
    sync.clearAllSyncOperations()
    expect(conflicts.getMoneyConflicts()).toHaveLength(1)

    // A full pull of refunds from the server (which never accepted it) must not erase it.
    expect(sync.preserveLocalOnlyRecords(REFUNDS_KEY, []).map((r: any) => r.id)).toEqual([refund.id])
    // Until settled it still counts on this device (the cash really left).
    expect(sales.getRefunds().map((r) => r.id)).toEqual([refund.id])
  })

  it("only a manager can settle it, a note is required, and 'loss' records the money", async () => {
    seed({ role: "Cashier" })
    let s = await issueThenReject()
    const opId = s.conflicts.getMoneyConflicts()[0].opId
    expect(() => s.conflicts.settleMoneyConflict({ opId, resolution: "loss", note: "lost" })).toThrow(/manager/i)

    window.localStorage.setItem(USERS_KEY, JSON.stringify([{ id: "u1", name: "Owner", role: "Admin", pin: "HASH", code: "OWN", active: true, permissions: [] }]))
    vi.resetModules()
    s = { ...s, ...(await services()) }
    expect(() => s.conflicts.settleMoneyConflict({ opId, resolution: "loss", note: " " })).toThrow(/note/i)

    const settlement = s.conflicts.settleMoneyConflict({ opId, resolution: "loss", note: "Customer kept the cash" })
    expect(settlement.expenseId).toBeTruthy()
    const expenses = read("lebanonpos.expenses.v1")
    expect(expenses).toHaveLength(1)
    expect(expenses[0]).toMatchObject({ amount: 10, category: "Other", paymentMethod: "Cash" })

    // Settled: no longer open, no longer counted, still in history, still preserved on pull.
    expect(s.conflicts.getMoneyConflicts()).toEqual([])
    expect(s.sales.getRefunds()).toEqual([])
    expect(s.sales.getAllRefunds()[0].conflict).toMatchObject({ resolution: "loss", note: "Customer kept the cash", code: "REFUND_EXCEEDS_REFUNDABLE" })
    expect(s.sync.preserveLocalOnlyRecords(REFUNDS_KEY, []).map((r: any) => r.id)).toEqual([s.refund.id])
  })

  it("'recovered' settles without any money entry", async () => {
    seed()
    const { conflicts, sales } = await issueThenReject()
    const opId = conflicts.getMoneyConflicts()[0].opId
    const settlement = conflicts.settleMoneyConflict({ opId, resolution: "recovered", note: "Customer returned $10" })
    expect(settlement.expenseId).toBeUndefined()
    expect(read("lebanonpos.expenses.v1")).toEqual([])
    expect(sales.getAllRefunds()[0].conflict?.resolution).toBe("recovered")
  })
})

describe("i18n", () => {
  it("English and Arabic dictionaries have exactly the same keys", async () => {
    const root = resolve(__dirname, "../../../../packages/shared/src/i18n")
    const keys = (file: string) => [...readFileSync(resolve(root, file), "utf8").matchAll(/^ {2}"([^"]+)":/gm)].map((m) => m[1]).sort()
    const en = keys("en.ts")
    const ar = keys("ar.ts")
    expect(en.filter((k) => !ar.includes(k))).toEqual([])
    expect(ar.filter((k) => !en.includes(k))).toEqual([])
    expect(en.length).toBeGreaterThan(1000)
  })
})
