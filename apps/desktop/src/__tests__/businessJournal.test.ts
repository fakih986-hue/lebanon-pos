// DURABILITY-2 — the business journal: checkout, void and stock adjustment interrupted before and
// after their commit point, restarts, and an ambiguous state blocked and closed by hand. Real services; storage failures are injected; a
// restart is vi.resetModules() (storage survives). Assertions are on stock, lots, records,
// balances and the sync queue.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const K = {
  users: "lebanonpos.users.v1", current: "lebanonpos.current-user.v1", products: "lebanonpos.products.v1",
  batches: "lebanonpos.inventory-batches.v1", sales: "lebanonpos.sales.v1", queue: "lebanonpos.sync-queue.v1",
  adjustments: "lebanonpos.inventory-adjustments.v1", movements: "lebanonpos.stock-movements.v1",
  journal: "lebanonpos.business-journal.v1", customers: "lebanonpos.customers.v1", debtSales: "lebanonpos.debt-sales.v1",
  debtPayments: "lebanonpos.debt-payments.v1", audit: "lebanonpos.audit.v1",
}
type Lot = { id: string; productId: number; quantityRemaining: number; initialQuantity: number; status: string }
const read = <T = Record<string, unknown>>(k: string): T[] => { try { const v = JSON.parse(localStorage.getItem(k) ?? "[]"); return Array.isArray(v) ? v : [] } catch { return [] } }
const stockOf = (id: number) => read<{ id: number; stock: number }>(K.products).find((p) => p.id === id)?.stock
const lots = () => read<Lot>(K.batches)
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
    journal: await import("../features/pos/services/businessJournal.service"),
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
/** A cart of `qty` Cola, as the POS page builds it (dry-run allocations on the sale lines). */
async function cart(m: Awaited<ReturnType<typeof svc>>, qty: number, debt = false) {
  const lotsIn = [{ productId: 1, productName: "Cola", barcode: "111", quantity: qty, fallbackUnitCost: 2 }]
  const alloc = m.batches.consumeInventoryBatches(lotsIn, { dryRun: true }).get(1) ?? []
  const sale = m.sales.buildSale({
    saleNumber: `S-J${qty}`, paymentMethod: debt ? "Debt" : "Cash", subtotal: qty * 5, tax: 0, total: qty * 5, customerId: debt ? "cust-1" : undefined, customerName: debt ? "Nour" : undefined,
    items: [{ id: 1, name: "Cola", barcode: "111", cost: 2, quantity: qty, unitPrice: 5, total: qty * 5, batchAllocations: alloc }],
  }, `sale-j${qty}${debt ? "d" : ""}`)
  return {
    sale, lots: lotsIn, stock: [{ productId: 1, quantity: qty }],
    debt: debt ? { customerId: "cust-1", saleNumber: sale.saleNumber, subtotal: qty * 5, discountTotal: 0, tax: 0, total: qty * 5, items: [] } : undefined,
  }
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

describe("checkout", () => {
  it("interrupted before the sale is written: lots are put back exactly, nothing is sent, the error is thrown", async () => {
    const m = await svc()
    const before = { lots: lots(), stock: stockOf(1) }
    const c = await cart(m, 7)
    const spy = failKey(K.sales)
    expect(() => m.sales.checkoutLocalSale(c)).toThrow()
    spy.mockRestore()
    expect(lots()).toEqual(before.lots)            // exactly, both lots
    expect(stockOf(1)).toBe(before.stock)
    expect(read(K.sales)).toEqual([])
    expect(ops().filter((o) => o.entity === "sale")).toEqual([])
    expect(read(K.journal)).toEqual([])
    const mv = read<{ type: string; quantity: number }>(K.movements).filter((x) => x.type === "Sale" || x.type === "Refund")
    expect(mv.reduce((s, x) => s + x.quantity, 0)).toBe(0) // the ledger nets to zero
  })

  it("interrupted after the sale is written: the sale stands; stock and debt are completed once after restart", async () => {
    let m = await svc()
    const c = await cart(m, 3, true)
    const spy = failKey(K.products) // stock cannot be written (and settling it in-session fails too)
    const r = m.sales.checkoutLocalSale(c)
    spy.mockRestore()
    expect(r.status).toBe("blocked") // shown: completes on restart
    expect(read(K.sales).map((s) => s.id)).toEqual([c.sale.id])
    expect(stockOf(1)).toBe(10) // not yet
    expect(ops().find((o) => o.entity === "sale")?.staged).toBe(true) // held until the journal settles it

    m = await restart()
    m.sync.recoverStagedSyncOperations() // again: nothing more happens
    expect(stockOf(1)).toBe(7)  // decreased exactly once
    expect(read(K.debtSales)).toHaveLength(1)
    expect(await balance(m)).toBe(15)
    const saleOp = ops().find((o) => o.entity === "sale")!
    expect(saleOp.staged).toBeUndefined()
    expect(ops().filter((o) => o.entity === "debt" && o.action === "create")).toHaveLength(1)
    expect(read(K.journal)).toEqual([])
  })

  it("an ambiguous interruption is blocked and shown, holds its operation, and is closed by hand (audited)", async () => {
    let m = await svc()
    const c = await cart(m, 7)
    const spy = failKeys({ [K.sales]: 0, [K.batches]: 1 }) // consume works, giving the lots back fails
    expect(() => m.sales.checkoutLocalSale(c)).toThrow()
    spy.mockRestore()
    // Something else changed lot A before restart: neither "before" nor "after" the checkout.
    localStorage.setItem(K.batches, JSON.stringify(lots().map((b) => (b.id === "lot-a" ? { ...b, quantityRemaining: 2 } : b))))
    m = await restart()
    const blocked = m.journal.getBlockedJournalEntries()
    expect(blocked).toHaveLength(1)
    expect(blocked[0].blocked?.detail).toContain("lot lot-a: 2 left")
    expect(ops().find((o) => o.entity === "sale")?.staged).toBe(true) // never sent while blocked
    expect(m.sync.getSyncStatus().staged).toBe(1)

    expect(() => m.journal.closeBlockedJournalEntry(blocked[0].id, "")).toThrow(/Say what you checked/)
    expect(m.journal.closeBlockedJournalEntry(blocked[0].id, "Counted Cola: 3. Posted a count.")).toBe(true)
    expect(m.journal.getBlockedJournalEntries()).toEqual([])
    expect(ops().filter((o) => o.entity === "sale")).toEqual([]) // not committed -> removed, never sent
    expect(read<{ action: string }>(K.audit).some((a) => a.action === "journal.closed_by_hand")).toBe(true)
  })
})

describe("void", () => {
  it("interrupted after the sale is marked Voided: stock, lots and debt are completed once after restart", async () => {
    let m = await svc()
    const c = await cart(m, 4, true)
    expect(m.sales.checkoutLocalSale(c).status).toBe("completed")
    expect(stockOf(1)).toBe(6)
    expect(await balance(m)).toBe(20)
    const afterSale = lots()

    const spy = failKey(K.products)
    m.sales.voidSale(c.sale.id)
    spy.mockRestore()
    expect(read<{ status: string }>(K.sales)[0].status).toBe("Voided")

    m = await restart()
    m.sync.recoverStagedSyncOperations()
    expect(stockOf(1)).toBe(10) // restored once
    expect(lots().reduce((s, b) => s + b.quantityRemaining, 0)).toBe(afterSale.reduce((s, b) => s + b.quantityRemaining, 0) + 4)
    expect(await balance(m)).toBe(0)
    expect(ops().filter((o) => o.entity === "sale" && o.action === "void" && !o.staged)).toHaveLength(1)
    expect(read(K.journal)).toEqual([])
  })
})

describe("stock adjustment", () => {
  it("interrupted before its record: lots and stock are put back exactly, nothing is sent", async () => {
    const m = await svc()
    const before = { lots: lots(), stock: stockOf(1) }
    const spy = failKey(K.adjustments)
    expect(() => m.adj.recordStockAdjustment({ productId: 1, quantityChange: -5, reason: "Damage" })).toThrow()
    spy.mockRestore()
    expect(lots()).toEqual(before.lots)
    expect(stockOf(1)).toBe(before.stock)
    expect(ops().filter((o) => o.action === "adjust")).toEqual([])
    expect(read(K.journal)).toEqual([])
  })

  it("an increase into a new lot, interrupted before its record: the created lot is removed", async () => {
    const m = await svc()
    const before = { lots: lots(), stock: stockOf(1) }
    const spy = failKey(K.adjustments)
    expect(() => m.adj.recordStockAdjustment({ productId: 1, quantityChange: 9, reason: "Count Correction" })).toThrow()
    spy.mockRestore()
    expect(lots()).toEqual(before.lots)
    expect(stockOf(1)).toBe(before.stock)
  })
})

describe("store switching", () => {
  const token = (tenantId: string) => {
    const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, "")
    return `${b64({ alg: "none" })}.${b64({ tenantId })}.sig`
  }

  it("an entry left open is never settled against another store's data, nor against this store's wiped data", async () => {
    localStorage.setItem("lebanonpos.auth-token", token("tenant-A"))
    // A product with no lots: nothing for the lot check to catch.
    localStorage.setItem(K.products, JSON.stringify([...read(K.products), { id: 2, syncId: "p-gum", name: "Gum", barcode: "222", price: 1, cost: 0.5, stock: 20, category: "Snacks" }]))
    let m = await svc()
    const sale = m.sales.buildSale({ saleNumber: "S-SW1", paymentMethod: "Cash", subtotal: 3, tax: 0, total: 3, items: [{ id: 2, name: "Gum", barcode: "222", cost: 0.5, quantity: 3, unitPrice: 1, total: 3, batchAllocations: [] }] }, "sale-sw1")
    // Stock cannot be written, through the switch too: the committed sale's entry stays open.
    const spy = failKey(K.products)
    expect(m.sales.checkoutLocalSale({ sale, lots: [], stock: [{ productId: 2, quantity: 3 }] }).status).toBe("blocked")
    await m.sync.clearStoreData()
    spy.mockRestore()
    m.sync.setAuthToken(token("tenant-B"))
    m = await restart()
    // Store B: A's entry is invisible and untouched.
    expect(m.journal.getOpenJournalEntries()).toEqual([])
    expect(JSON.parse(localStorage.getItem(K.journal) ?? "[]")).toHaveLength(1)

    await m.sync.clearStoreData()
    m.sync.setAuthToken(token("tenant-A"))
    m = await restart()
    m.sync.restoreStashedMoneyConflicts()
    m.sync.recoverStagedSyncOperations()
    // Back in A: its records were replaced by the switch. The sale really happened, so its
    // operation must still be there (held), and the entry must wait for a person.
    const saleOp = ops().find((o) => o.entity === "sale" && o.payload?.id === "sale-sw1")
    expect(saleOp).toBeTruthy()
    expect(saleOp?.staged).toBe(true)
    const blocked = m.journal.getBlockedJournalEntries()
    expect(blocked).toHaveLength(1)
    expect(blocked[0].blocked?.reason).toBe("store_switch")
  })
})

describe("store switching: every journaled workflow, both directions", () => {
  const token = (tenantId: string) => {
    const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, "")
    return `${b64({ alg: "none" })}.${b64({ tenantId })}.sig`
  }

  it("checkout, void and adjustment entries left open stay with their tenant, blocked, with their operations held", async () => {
    localStorage.setItem("lebanonpos.auth-token", token("tenant-A"))
    let m = await svc()
    const done = await cart(m, 2)
    expect(m.sales.checkoutLocalSale(done).status).toBe("completed") // a sale to void
    // Products cannot be written from here on (through the switch), nor lots after two more writes
    // (the checkout consumes, the adjustment changes; giving the adjustment's lots back fails):
    // three entries stay open.
    let spy = failKeys({ [K.products]: 0, [K.adjustments]: 0, [K.batches]: 2 })
    const c = await cart(m, 1)
    m.sales.checkoutLocalSale(c)
    m.sales.voidSale(done.sale.id)
    expect(() => m.adj.recordStockAdjustment({ productId: 1, quantityChange: -1, reason: "Damage" })).toThrow()
    await m.sync.clearStoreData()
    spy.mockRestore()
    const aEntries = JSON.parse(localStorage.getItem(K.journal) ?? "[]") as Array<{ kind: string; status: string; blocked?: { reason: string }; opIds: string[] }>
    expect(aEntries.map((e) => e.kind).sort()).toEqual(["adjustment", "checkout", "void"])
    // All blocked, none settled: the ones whose figures moved (all three touch lot A) block on
    // their lots before the switch; the rest are blocked by the switch itself.
    expect(aEntries.every((e) => e.status === "blocked" && ["store_switch", "lots", "stock"].includes(e.blocked?.reason ?? ""))).toBe(true)
    expect(aEntries.some((e) => e.blocked?.reason === "store_switch")).toBe(true)

    // Store B: none of A's entries are visible or settled; B gets an unfinished entry of its own.
    m.sync.setAuthToken(token("tenant-B"))
    m = await restart()
    expect(m.journal.getOpenJournalEntries()).toEqual([])
    localStorage.setItem(K.products, JSON.stringify([{ id: 1, syncId: "p-cola", name: "Cola", barcode: "111", price: 5, cost: 2, stock: 10, category: "Drinks" }]))
    localStorage.setItem(K.users, JSON.stringify([{ id: "u1", name: "Owner", role: "Admin", pin: "HASH", code: "OWN", active: true, permissions: [] }]))
    localStorage.setItem(K.current, "u1") // the switch signs the user out
    m.security.openShift(100)
    spy = failKeys({ [K.products]: 0 })
    const b = m.sales.buildSale({ saleNumber: "S-B1", paymentMethod: "Cash", subtotal: 5, tax: 0, total: 5, items: [{ id: 1, name: "Cola", barcode: "111", cost: 2, quantity: 1, unitPrice: 5, total: 5, batchAllocations: [] }] }, "sale-b1")
    m.sales.checkoutLocalSale({ sale: b, lots: [], stock: [{ productId: 1, quantity: 1 }] })
    await m.sync.clearStoreData()
    spy.mockRestore()

    // Back in A: A's three entries are back (blocked), their operations held; B's is not here.
    m.sync.setAuthToken(token("tenant-A"))
    m = await restart()
    m.sync.restoreStashedMoneyConflicts()
    m.sync.recoverStagedSyncOperations()
    const back = m.journal.getBlockedJournalEntries()
    expect(back.map((e) => e.kind).sort()).toEqual(["adjustment", "checkout", "void"])
    const held = ops().filter((o) => back.some((e) => e.opIds.includes(o.id)))
    expect(held.length).toBeGreaterThanOrEqual(2) // the checkout's and the void's (the adjustment's was never staged past its failure)
    expect(held.every((o) => o.staged)).toBe(true)
    expect(ops().some((o) => o.payload?.id === "sale-b1")).toBe(false)
    expect(JSON.parse(localStorage.getItem(K.journal) ?? "[]").some((e: { plan: { saleId?: string } }) => e.plan.saleId === "sale-b1")).toBe(true) // B's kept for B
  })
})
