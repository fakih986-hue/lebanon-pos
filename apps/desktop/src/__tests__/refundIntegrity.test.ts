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

  it("lot-less returned stock is sold at checkout: the register's own sequence allocates it as untracked, stock reaches 0, no lot goes negative", async () => {
    seed()
    // A legacy sale (no line ids, no recorded lots) refunded: 5 units come back with no lot.
    window.localStorage.setItem(SALES_KEY, JSON.stringify([trackedSale({
      items: [{ id: 1, name: "Cola", barcode: "111", cost: 2, quantity: 5, unitPrice: 5, total: 25 }],
      subtotal: 25, total: 25, tender: undefined,
    })]))
    const { sales } = await services()
    sales.processRefund({ saleId: "sale-1", quantities: { "legacy-product:1": 5 }, reason: "" })
    expect(stockOf(1)).toBe(5)
    expect(read(BATCHES_KEY).reduce((sum: number, b: any) => sum + b.quantityRemaining, 0)).toBe(0)

    // Exactly what POSPage.completeSale does (offline / direct mode).
    const batches = await import("../features/pos/services/inventoryBatch.service")
    const cartInputs = [{ productId: 1, productName: "Cola", barcode: "111", quantity: 5, fallbackUnitCost: 2 }]
    const dry = batches.consumeInventoryBatches(cartInputs, { dryRun: true })
    expect(dry.get(1)).toEqual([{ batchId: "legacy-stock", batchNumber: "Legacy stock", quantity: 5, unitCost: 2 }])
    const saleInput = {
      saleNumber: "S-2", paymentMethod: "Cash" as const, subtotal: 25, discountTotal: 0, tax: 0, total: 25,
      items: [{ id: 1, name: "Cola", barcode: "111", cost: 2, quantity: 5, unitPrice: 5, total: 25, batchAllocations: dry.get(1)! }],
    }
    sales.buildSale(saleInput as any, "sale-2") // the register's gate (open shift etc.)
    batches.consumeInventoryBatches(cartInputs)
    sales.recordSale(saleInput as any, { id: "sale-2" })
    const products = await import("../features/pos/services/product.service")
    products.decreaseProductStock([{ productId: 1, quantity: 5 }])

    expect(stockOf(1)).toBe(0)
    expect(read(BATCHES_KEY).every((b: any) => b.quantityRemaining >= 0)).toBe(true)
    const saleOp = queue().find((op) => op.entity === "sale" && op.payload?.id === "sale-2")
    expect(saleOp?.payload.items[0].batchAllocations).toEqual([expect.objectContaining({ batchId: "legacy-stock", quantity: 5 })])
    // A sixth unit is refused by the register's stock gate (product stock is 0).
    expect(read(PRODUCTS_KEY).find((p: any) => p.id === 1).stock <= 0).toBe(true)
  })

  it("the refund sync payload only carries fields a hub on the previous release accepts", async () => {
    seed()
    window.localStorage.setItem(SALES_KEY, JSON.stringify([trackedSale()]))
    const { sales } = await services()
    const refund = sales.processRefund({ saleId: "sale-1", quantities: { L1: 1 }, reason: "" })
    // The local record keeps the original rate…
    expect(sales.getAllRefunds().find((r) => r.id === refund.id)).toMatchObject({ exchangeRate: 89500, rateSource: "sale_tender" })
    // …the wire payload carries only SaleRefund columns of origin/master (43230e3), plus the
    // registerId/deviceId attribution that server strips, plus items (mapped field by field).
    const OLD_COLUMNS = ["id", "refundNumber", "saleId", "saleNumber", "customerId", "customerName", "method", "reason", "total", "cashier", "cashierId", "shiftId", "shiftNumber", "createdAt", "registerId", "deviceId", "items"]
    const op = queue().find((o) => o.entity === "refund" && o.payload.id === refund.id)!
    expect(Object.keys(op.payload).filter((k) => !OLD_COLUMNS.includes(k))).toEqual([])
  })

  it("the sale sync payload only carries fields a hub on the previous release accepts", async () => {
    seed()
    const { sales } = await services()
    sales.recordSale({ saleNumber: "S-9", paymentMethod: "Cash", subtotal: 5, discountTotal: 0, tax: 0, total: 5,
      items: [{ id: 2, name: "Chips", barcode: "222", cost: 1, quantity: 1, unitPrice: 5, total: 5, batchAllocations: [] }] } as any, { id: "sale-9" })
    const OLD_COLUMNS = ["id", "saleNumber", "paymentMethod", "customerId", "customerName", "subtotal", "discountTotal", "tax", "total", "cost", "profit", "soldAtCost", "cashier", "cashierId", "shiftId", "shiftNumber", "payableLbp", "status", "createdAt", "registerId", "deviceId", "items", "tender"]
    const op = queue().find((o) => o.entity === "sale" && o.payload.id === "sale-9")!
    expect(Object.keys(op.payload).filter((k) => !OLD_COLUMNS.includes(k))).toEqual([])
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

  /** Issue a $10 refund (2 × $5) offline, then have the server reject it. */
  async function issueThenReject(sale = trackedSale()) {
    window.localStorage.setItem(SALES_KEY, JSON.stringify([sale]))
    const s = await services()
    const shift = await import("../features/pos/services/shift.service")
    const customers = await import("../features/pos/services/customer.service")
    const refund = s.sales.processRefund({ saleId: sale.id, quantities: { L1: 2 }, reason: "" })
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(queue().map((op) => (op.entity === "refund" ? {
      ...op, status: "Rejected", attempts: 5, lastAttemptAt: "2026-10-02T00:00:00.000Z",
      error: "REFUND_EXCEEDS_REFUNDABLE: Line L1: requested 2, only 0 still refundable",
    } : op))))
    const opId = s.conflicts.getMoneyConflicts()[0].opId
    const drawer = () => shift.computeExpectedCash(s.security.getActiveShift()!)
    const counted = () => s.sales.getRefunds().reduce((sum, r) => sum + r.total, 0)
    const expenses = () => read("lebanonpos.expenses.v1") as any[]
    const movements = () => read("lebanonpos.cash-movements.v1") as any[]
    const credits = () => customers.getDebtPayments().filter((p) => p.method === "Refund Credit")
    return { ...s, refund, opId, drawer, counted, expenses, movements, credits }
  }
  const pushedEntries = () => businessOps().filter((op) => op.entity !== "refund").map((op) => `${op.entity}:${op.payload?.id}`)

  it("stays visible and survives 'clear stuck', remove, clear-all, a full pull and a restart", async () => {
    seed()
    let s = await issueThenReject()
    expect(s.conflicts.getMoneyConflicts()[0]).toMatchObject({ kind: "refund", refundId: s.refund.id, amount: 10, code: "REFUND_EXCEEDS_REFUNDABLE" })
    s.sync.clearSyncQueue()
    s.sync.removeRejectedOperation(s.opId)
    s.sync.clearAllSyncOperations()
    expect(s.sync.preserveLocalOnlyRecords(REFUNDS_KEY, []).map((r: any) => r.id)).toEqual([s.refund.id])
    vi.resetModules()
    const conflicts = await import("../features/pos/services/refundConflict.service")
    expect(conflicts.getMoneyConflicts().map((c) => c.opId)).toEqual([s.opId])
  })

  /** A server-issued token as the device stores it (only the tenant claim matters here). */
  const tokenFor = (tenantId: string) => `h.${btoa(JSON.stringify({ userId: "u1", tenantId, role: "Admin" })).replace(/=+$/, "")}.sig`
  const TENANT_A = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  const TENANT_B = "22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

  it("is stashed on store switch by tenant identity: the same subdomain on another tenant restores nothing", async () => {
    seed()
    window.localStorage.setItem("lebanonpos.settings.v1", JSON.stringify({ subdomain: "fakih" }))
    window.localStorage.setItem("lebanonpos.auth-token", tokenFor(TENANT_A))
    const s = await issueThenReject()
    await s.sync.clearStoreData()
    expect(s.conflicts.getMoneyConflicts()).toEqual([])
    expect(s.sync.getStashedMoneyConflictSummary()).toEqual([expect.objectContaining({ key: `tenant:${TENANT_A}`, tenantId: TENANT_A, conflicts: 1 })])
    // A different tenant that reuses the subdomain "fakih" (another server, or a reassigned name).
    s.sync.setAuthToken(tokenFor(TENANT_B))
    window.localStorage.setItem("lebanonpos.settings.v1", JSON.stringify({ subdomain: "fakih" }))
    expect(s.sync.restoreStashedMoneyConflicts()).toBe(0)
    expect(s.conflicts.getMoneyConflicts()).toEqual([])
    expect(s.sales.getAllRefunds()).toEqual([])
    // Back to tenant A (even under a renamed subdomain): the conflict and its refund return.
    s.sync.setAuthToken(tokenFor(TENANT_A))
    window.localStorage.setItem("lebanonpos.settings.v1", JSON.stringify({ subdomain: "fakih-renamed" }))
    expect(s.sync.restoreStashedMoneyConflicts()).toBe(1)
    expect(s.conflicts.getMoneyConflicts().map((c) => c.opId)).toEqual([s.opId])
    expect(s.sales.getAllRefunds().map((r) => r.id)).toContain(s.refund.id)
    s.sync.clearAuthToken()
  })

  it("an interrupted refund is resolved in its own store before a switch and never replayed into the next tenant's stock", async () => {
    seed()
    window.localStorage.setItem("lebanonpos.auth-token", tokenFor(TENANT_A))
    window.localStorage.setItem(SALES_KEY, JSON.stringify([trackedSale()]))
    const { sales, sync } = await services()
    // Crash after stock was restored but before the commit point.
    sales.refundFaults.afterStep = (step) => { if (step === "stock") throw new Error("power cut") }
    // processRefund rolls back in-process; simulate a real crash by keeping the half-applied journal.
    const journalBefore = { refundId: "half", startedAt: "2026-10-01T00:00:00.000Z", tenantId: TENANT_A,
      refund: { id: "half", refundNumber: "R-HALF", saleId: "sale-1", saleNumber: "S-1", total: 5, items: [] },
      plan: [{ productId: 1, productName: "Cola", barcode: "111", quantity: 1, allocations: [{ batchId: "lot-b", quantity: 1 }] }],
      steps: { lots: true, stock: true, committed: false, debt: false, ledger: false } }
    sales.refundFaults.afterStep = undefined
    window.localStorage.setItem(PRODUCTS_KEY, JSON.stringify(read(PRODUCTS_KEY).map((p: any) => (p.id === 1 ? { ...p, stock: 1 } : p))))
    window.localStorage.setItem(BATCHES_KEY, JSON.stringify(read(BATCHES_KEY).map((b: any) => (b.id === "lot-b" ? { ...b, quantityRemaining: 1, status: "Open" } : b))))
    window.localStorage.setItem(JOURNAL_KEY, JSON.stringify([journalBefore]))

    await sync.clearStoreData()
    // Resolved against tenant A's data before the wipe; nothing is left to replay.
    expect(read(JOURNAL_KEY)).toEqual([])

    // Tenant B: its own product id 1 and lot-b exist with stock. Startup recovery must not touch them.
    sync.setAuthToken(tokenFor(TENANT_B))
    window.localStorage.setItem(PRODUCTS_KEY, JSON.stringify([{ id: 1, name: "B's product", barcode: "B1", price: 9, cost: 4, stock: 7, category: "B" }]))
    window.localStorage.setItem(BATCHES_KEY, JSON.stringify([{ id: "lot-b", batchNumber: "B", productId: 1, productName: "B's product", barcode: "B1", initialQuantity: 7, quantityRemaining: 7, unitCost: 4, unitPrice: 9, receivedAt: "2026-02-01T00:00:00.000Z", status: "Open" }]))
    expect(sync.restoreStashedMoneyConflicts()).toBe(0)
    expect(sales.recoverRefundJournal()).toEqual({ rolledBack: 0, completed: 0 })
    expect(stockOf(1)).toBe(7)
    expect(lotOf("lot-b")).toBe(7)

    // Defence in depth: a journal entry stamped with another tenant is skipped, not applied.
    window.localStorage.setItem(JOURNAL_KEY, JSON.stringify([journalBefore]))
    expect(sales.recoverRefundJournal()).toEqual({ rolledBack: 0, completed: 0 })
    expect(stockOf(1)).toBe(7)
    expect(lotOf("lot-b")).toBe(7)
    sync.clearAuthToken()
  })

  it("with no known tenant identity, stashed conflicts are kept but never restored automatically", async () => {
    seed()
    window.localStorage.setItem("lebanonpos.settings.v1", JSON.stringify({ subdomain: "fakih" }))
    const s = await issueThenReject()
    await s.sync.clearStoreData()
    const [entry] = s.sync.getStashedMoneyConflictSummary()
    expect(entry).toMatchObject({ tenantId: null, conflicts: 1 })
    expect(entry.key.startsWith("unbound:")).toBe(true)
    s.sync.setAuthToken(tokenFor(TENANT_A))
    expect(s.sync.restoreStashedMoneyConflicts()).toBe(0)
    expect(s.sync.getStashedMoneyConflictSummary()).toHaveLength(1)
    s.sync.clearAuthToken()
  })

  it("pending work that never reached the server survives a store switch and returns only to its tenant", async () => {
    seed()
    window.localStorage.setItem("lebanonpos.auth-token", tokenFor(TENANT_A))
    window.localStorage.setItem(SALES_KEY, JSON.stringify([trackedSale()]))
    const { sales, sync } = await services()
    const refund = sales.processRefund({ saleId: "sale-1", quantities: { L1: 1 }, reason: "" })
    const pendingIds = queue().filter((op) => op.status !== "Synced").map((op) => op.id)
    expect(queue().some((op) => op.entity === "refund" && op.payload.id === refund.id && op.status === "Pending")).toBe(true)
    await sync.clearStoreData()
    expect(queue()).toEqual([])
    sync.setAuthToken(tokenFor(TENANT_B))
    expect(sync.restoreStashedMoneyConflicts()).toBe(0)
    expect(queue()).toEqual([])
    sync.setAuthToken(tokenFor(TENANT_A))
    sync.restoreStashedMoneyConflicts()
    expect(queue().map((op) => op.id).sort()).toEqual([...pendingIds].sort())
    sync.clearAuthToken()
  })

  it("only a manager can settle; a note is required; 'recovered' requires how and a reference", async () => {
    seed({ role: "Cashier" })
    let s = await issueThenReject()
    expect(() => s.conflicts.settleMoneyConflict({ opId: s.opId, resolution: "loss", note: "lost" })).toThrow(/manager/i)
    window.localStorage.setItem(USERS_KEY, JSON.stringify([{ id: "u1", name: "Owner", role: "Admin", pin: "HASH", code: "OWN", active: true, permissions: [] }]))
    vi.resetModules()
    const conflicts = await import("../features/pos/services/refundConflict.service")
    expect(() => conflicts.settleMoneyConflict({ opId: s.opId, resolution: "loss", note: " " })).toThrow(/note/i)
    expect(() => conflicts.settleMoneyConflict({ opId: s.opId, resolution: "recovered", note: "came back" })).toThrow(/how the money/i)
    expect(() => conflicts.settleMoneyConflict({ opId: s.opId, resolution: "recovered", note: "came back", recovery: { method: "Cash", reference: "" } })).toThrow(/reference/i)
    expect(read("lebanonpos.expenses.v1")).toEqual([])
    expect(conflicts.getMoneyConflicts()).toHaveLength(1)
  })

  // Cash refund of $10, server rejected. Drawer before settlement = float 100 − 10 = 90.
  const cashCases: Array<{ name: string; resolution: "loss" | "recovered" | "not_paid"; recovery?: { method: "Cash" | "Bank Transfer"; reference: string }; drawer: number; expenses: number; entries: string[] }> = [
    { name: "loss: one expense replaces the refund", resolution: "loss", drawer: 90, expenses: 10, entries: ["expense:settle-loss-OP"] },
    { name: "recovered in cash: payout + recovery, net zero", resolution: "recovered", recovery: { method: "Cash", reference: "RCPT-17" }, drawer: 100, expenses: 0, entries: ["cash-movement:settle-out-OP", "cash-movement:settle-in-OP"] },
    { name: "recovered by bank transfer: drawer keeps the payout", resolution: "recovered", recovery: { method: "Bank Transfer", reference: "TRX-889" }, drawer: 90, expenses: 0, entries: ["cash-movement:settle-out-OP"] },
    { name: "never paid out: no money entry, drawer restored", resolution: "not_paid", drawer: 100, expenses: 0, entries: [] },
  ]
  for (const c of cashCases) {
    it(`cash refund settled — ${c.name}; counted exactly once`, async () => {
      seed()
      const s = await issueThenReject()
      expect(s.drawer()).toBe(90)
      expect(s.counted()).toBe(10)
      const settlement = s.conflicts.settleMoneyConflict({ opId: s.opId, resolution: c.resolution, note: "Settled by manager", recovery: c.recovery })
      expect(s.drawer()).toBe(c.drawer)
      expect(s.counted()).toBe(0) // the refund no longer counts...
      expect(s.expenses().reduce((sum, e) => sum + e.amount, 0)).toBe(c.expenses) // ...only the settlement entry does
      // What the cloud will receive (the refund op itself is gone).
      expect(pushedEntries().sort()).toEqual(c.entries.map((e) => e.replace("OP", s.opId)).sort())
      expect(businessOps().some((op) => op.entity === "refund")).toBe(false)
      expect(s.sales.getAllRefunds()[0].conflict?.resolution).toBe(c.resolution)
      const audit = read("lebanonpos.audit.v1").find((a: any) => a.action === "sale.refund.conflict_settled")
      expect(audit?.metadata).toMatchObject({ resolution: c.resolution, amount: 10, recoveryReference: c.recovery?.reference ?? null })
      expect(settlement.status).toBe("settled")
    })
  }

  it("debt refund: its credit is never pushed on its own; 'keep' makes it real once, 'reverse' removes it", async () => {
    seed()
    const debtSale = trackedSale({ paymentMethod: "Debt", status: "Debt", customerId: "c1", customerName: "Rami", tender: undefined })
    let s = await issueThenReject(debtSale)
    expect(s.credits()).toEqual([expect.objectContaining({ id: `refund-credit:${s.refund.id}`, amount: 10, localOnly: true })])
    expect(businessOps().some((op) => op.entity === "debt")).toBe(false) // the server owns the refund credit
    expect(s.conflicts.allowedResolutions(s.conflicts.getMoneyConflicts()[0])).toEqual(["loss", "not_paid"])
    s.conflicts.settleMoneyConflict({ opId: s.opId, resolution: "loss", note: "Customer keeps the credit" })
    expect(s.credits().map((p) => [p.id, p.amount])).toEqual([[`settle-credit-${s.opId}`, 10]]) // once, not twice
    expect(pushedEntries()).toEqual([`debt:settle-credit-${s.opId}`])
    expect(s.expenses()).toEqual([]) // a credit is not also an expense

    vi.resetModules(); window.localStorage.clear(); seed()
    s = await issueThenReject(debtSale)
    s.conflicts.settleMoneyConflict({ opId: s.opId, resolution: "not_paid", note: "Credit reversed, customer informed" })
    expect(s.credits()).toEqual([])
    expect(pushedEntries()).toEqual([])
  })

  it("is idempotent across double clicks, an interrupted settlement, a restart and a rejected entry", async () => {
    seed()
    let s = await issueThenReject()
    const first = s.conflicts.settleMoneyConflict({ opId: s.opId, resolution: "loss", note: "Lost" })
    const again = s.conflicts.settleMoneyConflict({ opId: s.opId, resolution: "loss", note: "Lost" })
    expect(again.settledAt).toBe(first.settledAt)
    expect(s.expenses()).toHaveLength(1)

    // Interrupted: the expense was written, then the app died before the rest.
    vi.resetModules(); window.localStorage.clear(); seed()
    s = await issueThenReject()
    const settlements = await import("../features/pos/services/refundConflict.service")
    const conflict = settlements.getMoneyConflicts()[0]
    const expenseService = await import("../features/pos/services/expense.service")
    expenseService.createExpense({ id: `settle-loss-${s.opId}`, vendor: "x", category: "Other", amount: 10, paymentMethod: "Cash", invoiceNumber: "", note: "" })
    window.localStorage.setItem("lebanonpos.money-conflict-settlements.v1", JSON.stringify([{
      opId: s.opId, conflict, resolution: "loss", note: "Lost", status: "settling", startedAt: "2026-10-03T00:00:00.000Z", settledBy: "Owner",
      entries: { expenseId: `settle-loss-${s.opId}` }, steps: { money: false, refund: false, audit: false, op: false },
    }]))
    expect(settlements.getMoneyConflicts()).toEqual([]) // shown as "finishing", not as a fresh conflict
    vi.resetModules() // restart
    const resumed = await import("../features/pos/services/refundConflict.service")
    expect(resumed.resumeMoneyConflictSettlements()).toBe(1)
    expect(s.expenses()).toHaveLength(1)
    expect(resumed.getSettledMoneyConflicts()).toHaveLength(1)
    expect(businessOps().some((op) => op.entity === "refund")).toBe(false)

    // The server rejects the settlement expense: it becomes a protected conflict, retried — never re-created.
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(queue().map((op) => (op.entity === "expense" ? { ...op, status: "Rejected", attempts: 5, error: "Forbidden: accounting.manage" } : op))))
    const sync = await import("../features/pos/services/sync.service")
    sync.clearSyncQueue()
    const entry = resumed.getMoneyConflicts()
    expect(entry).toEqual([expect.objectContaining({ kind: "settlement_entry", amount: 10 })])
    resumed.retrySettlementEntry(entry[0].opId)
    expect(queue().filter((op) => op.entity === "expense").map((op) => op.status)).toEqual(["Pending"])
    expect(s.expenses()).toHaveLength(1)
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
