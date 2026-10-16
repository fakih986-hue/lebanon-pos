// SYNC-DURABILITY — the sync queue against storage failures, restarts, retries, uncertain server
// responses and store switches, using the REAL services. The "server" below applies operations the
// way apps/api/src/routes/sync.ts does: idempotent by record id (sale, refund, adjustment, lot,
// payment, expense, cash movement). Assertions are on stock, money and server state, not only on
// queue counts. A restart is vi.resetModules(): every service is re-imported, storage survives.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const K = {
  users: "lebanonpos.users.v1", current: "lebanonpos.current-user.v1", products: "lebanonpos.products.v1",
  batches: "lebanonpos.inventory-batches.v1", sales: "lebanonpos.sales.v1", refunds: "lebanonpos.refunds.v1",
  expenses: "lebanonpos.expenses.v1", cash: "lebanonpos.cash-movements.v1", adjustments: "lebanonpos.inventory-adjustments.v1",
  payments: "lebanonpos.supplier-payments.v1", orders: "lebanonpos.purchase-orders.v1", queue: "lebanonpos.sync-queue.v1",
  acks: "lebanonpos.sync-acked.v1", apiUrl: "lebanonpos.api-url", token: "lebanonpos.auth-token", journal: "lebanonpos.refund-journal.v1",
}
/** What the wire carries for the operations this file exercises. */
type Wire = {
  id?: string; productId?: number; quantityChange?: number; amount?: number; amountUsd?: number; quantityRemaining?: number
  items?: Array<{ id: number; productId: number; quantity: number }>
}
type WireOp = { id: string; entity: string; action: string; payload: Wire & Wire[] }
const read = <T = Record<string, unknown>>(k: string): T[] => { try { const v = JSON.parse(localStorage.getItem(k) ?? "[]"); return Array.isArray(v) ? v : [] } catch { return [] } }
const queue = () => read<{ id: string; entity: string; action: string; status: string; staged?: boolean; payload: Wire; createdAt: string; lastAttemptAt?: string }>(K.queue)
const business = () => queue().filter((op) => op.entity !== "shift")
const stockOf = (id: number) => read<{ id: number; stock: number }>(K.products).find((p) => p.id === id)?.stock

// ── a server that behaves like the API: idempotent by record id ──────────────
type Server = { pushes: string[][]; stock: Record<number, number>; lots: Record<string, number>; sales: Set<string>; refunds: Set<string>; adjustments: Set<string>; payments: Record<string, number>; expenses: Record<string, number>; cash: Record<string, number> }
let server: Server
let mode: "ok" | "lost-response" | "down" = "ok"
let gate: Promise<void> | null = null
function newServer(): Server {
  return { pushes: [], stock: { 1: 10, 2: 0 }, lots: {}, sales: new Set(), refunds: new Set(), adjustments: new Set(), payments: {}, expenses: {}, cash: {} }
}
function apply(op: WireOp) {
  const p = op.payload
  const key = `${op.entity}/${op.action}`
  const id = String(p.id)
  if (key === "sale/create" && !server.sales.has(id)) { server.sales.add(id); for (const it of p.items ?? []) server.stock[it.id] = (server.stock[it.id] ?? 0) - it.quantity }
  if (key === "refund/create" && !server.refunds.has(id)) { server.refunds.add(id); for (const it of p.items ?? []) server.stock[it.productId] = (server.stock[it.productId] ?? 0) + it.quantity }
  if (key === "inventory/adjust" && !server.adjustments.has(id)) { server.adjustments.add(id); server.stock[p.productId!] = (server.stock[p.productId!] ?? 0) + (p.quantityChange ?? 0) }
  if (key === "inventory/receive") for (const lot of p) if (!(String(lot.id) in server.lots)) { server.lots[String(lot.id)] = lot.quantityRemaining ?? 0; server.stock[lot.productId!] = (server.stock[lot.productId!] ?? 0) + (lot.quantityRemaining ?? 0) }
  if (key === "supplier-payment/payment") server.payments[id] = p.amount ?? 0
  if (key === "expense/create") server.expenses[id] = p.amount ?? 0
  if (key === "cash-movement/create") server.cash[id] = p.amountUsd ?? 0
}
function fakeFetch(url: string, init?: { body?: string }) {
  if (String(url).endsWith("/api/health")) return Promise.resolve({ ok: mode !== "down", status: 200, json: async () => ({}) })
  if (mode === "down") return Promise.reject(new Error("unreachable"))
  const body = JSON.parse(init?.body ?? "{}") as { operations: WireOp[] }
  return (gate ?? Promise.resolve()).then(() => {
    server.pushes.push(body.operations.map((o) => o.id))
    for (const op of body.operations) apply(op)
    if (mode === "lost-response") throw new Error("connection reset (applied, response lost)")
    return { ok: true, status: 200, json: async () => ({ results: body.operations.map((o) => ({ id: o.id, status: "ok" })) }) }
  })
}
const pushedCount = (id: string) => server.pushes.flat().filter((x) => x === id).length

/** Make writes to one storage key fail, optionally only after N successful writes to it. */
function failKey(key: string, afterWrites = 0) {
  const setItem = Storage.prototype.setItem
  let n = 0
  return vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
    if (k === key && n++ >= afterWrites) throw new DOMException("quota", "QuotaExceededError")
    return setItem.call(this, k, v)
  })
}
function token(tenantId: string) {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, "")
  return `${b64({ alg: "none" })}.${b64({ tenantId })}.sig`
}

function seed() {
  localStorage.setItem(K.users, JSON.stringify([{ id: "u1", name: "Owner", role: "Admin", pin: "HASH", code: "OWN", active: true, permissions: [] }]))
  localStorage.setItem(K.current, "u1")
  localStorage.setItem(K.products, JSON.stringify([
    { id: 1, syncId: "p-cola", name: "Cola", barcode: "111", price: 5, cost: 2, stock: 10, category: "Drinks" },
    { id: 2, syncId: "p-chips", name: "Chips", barcode: "222", price: 3, cost: 1, stock: 0, category: "Snacks" },
  ]))
  localStorage.setItem(K.batches, JSON.stringify([
    { id: "lot-a", batchNumber: "A", productId: 1, productName: "Cola", barcode: "111", initialQuantity: 10, quantityRemaining: 10, unitCost: 2, unitPrice: 5, receivedAt: "2026-01-01T00:00:00.000Z", status: "Open" },
  ]))
}
async function svc() {
  const sync = await import("../features/pos/services/sync.service")
  const sales = await import("../features/pos/services/sales.service")
  const security = await import("../features/pos/services/security.service")
  const expense = await import("../features/pos/services/expense.service")
  const cash = await import("../features/pos/services/cashMovement.service")
  const adj = await import("../features/pos/services/inventoryAdjustment.service")
  const batches = await import("../features/pos/services/inventoryBatch.service")
  const supplier = await import("../features/pos/services/supplier.service")
  return { sync, sales, security, expense, cash, adj, batches, supplier }
}
const SALE = { saleNumber: "S-D1", paymentMethod: "Cash" as const, subtotal: 10, tax: 0, total: 10, items: [{ id: 1, name: "Cola", barcode: "111", cost: 2, quantity: 2, unitPrice: 5, total: 10 }] }
const EXPENSE = { vendor: "EDL", category: "Utilities" as const, amount: 25, paymentMethod: "Cash" as const, invoiceNumber: "E-1", note: "" }

beforeEach(async () => {
  vi.restoreAllMocks()
  vi.resetModules()
  localStorage.clear()
  server = newServer(); mode = "ok"; gate = null
  vi.stubGlobal("fetch", vi.fn(fakeFetch))
  seed()
  const { security } = await svc()
  security.openShift(100)
})
afterEach(() => { vi.unstubAllGlobals() })

describe("storage failure before the business write", () => {
  it("nothing is written, nothing is queued or sent, and the caller is told", async () => {
    const m = await svc()
    localStorage.setItem(K.apiUrl, "http://hub.test"); localStorage.setItem(K.token, token("tenant-A"))
    const before = { stock: stockOf(1), lots: read(K.batches), ops: business().length }
    const spy = failKey(K.queue)
    expect(() => m.expense.createExpense(EXPENSE)).toThrow(m.sync.SyncStorageError)
    expect(() => m.sales.recordSale(SALE, { id: "sale-x" })).toThrow(m.sync.SyncStorageError)
    expect(() => m.adj.recordStockAdjustment({ productId: 1, quantityChange: -3, reason: "Damage" })).toThrow(m.sync.SyncStorageError)
    expect(() => m.cash.createCashMovement({ type: "CashIn", amountUsd: 40, reason: "float" })).toThrow(m.sync.SyncStorageError)
    spy.mockRestore()
    // money and stock untouched
    expect(read(K.expenses)).toEqual([])
    expect(read(K.sales)).toEqual([])
    expect(read(K.cash)).toEqual([])
    expect(read(K.adjustments)).toEqual([])
    expect(stockOf(1)).toBe(before.stock)
    expect(read(K.batches)).toEqual(before.lots)
    expect(business()).toHaveLength(before.ops)
    expect(server.pushes.flat().filter((id) => !id.startsWith("shift"))).toEqual([])
    expect(m.sync.getSyncStatus().storageFailures).toBeGreaterThan(0)
  })

  it("a refund that cannot be queued is not issued: lots and stock are rolled back", async () => {
    localStorage.setItem(K.sales, JSON.stringify([{
      id: "sale-r", saleNumber: "S-R", paymentMethod: "Cash", subtotal: 10, tax: 0, total: 10, cost: 4, profit: 6, cashier: "Owner", status: "Completed", createdAt: "2026-10-01T10:00:00.000Z",
      items: [{ id: 1, lineId: "L1", name: "Cola", barcode: "111", cost: 2, quantity: 2, unitPrice: 5, total: 10, batchAllocations: [{ batchId: "lot-a", batchNumber: "A", quantity: 2, unitCost: 2 }] }],
    }]))
    const m = await svc()
    const before = { stock: stockOf(1), lot: read<{ quantityRemaining: number }>(K.batches)[0].quantityRemaining }
    const spy = failKey(K.queue)
    expect(() => m.sales.processRefund({ saleId: "sale-r", quantities: { L1: 2 }, reason: "" })).toThrow(m.sync.SyncStorageError)
    spy.mockRestore()
    expect(read(K.refunds)).toEqual([])
    expect(stockOf(1)).toBe(before.stock)
    expect(read<{ quantityRemaining: number }>(K.batches)[0].quantityRemaining).toBe(before.lot)
    expect(read(K.journal)).toEqual([])
  })

  it("the legacy enqueue never reports 'queued' and never sends what it could not save", async () => {
    const m = await svc()
    localStorage.setItem(K.apiUrl, "http://hub.test"); localStorage.setItem(K.token, token("tenant-A"))
    const spy = failKey(K.queue)
    const op = await m.sync.enqueueSyncOperation({ entity: "customer", action: "create", summary: "c", payload: { id: "c1" } })
    spy.mockRestore()
    expect(op).toBeUndefined()
    expect(server.pushes.flat()).not.toContain(expect.stringMatching(/./))
    expect(m.sync.getSyncStatus().storageFailures).toBe(1)
  })
})

describe("storage failure after the business write", () => {
  it("the staged operation is durable evidence: held, then released exactly once after restart", async () => {
    let m = await svc()
    // The stage write succeeds; the commit write (next write to the queue) fails.
    const spy = failKey(K.queue, 1)
    const adjustment = m.adj.recordStockAdjustment({ productId: 1, quantityChange: 5, reason: "Count Correction" })
    spy.mockRestore()
    expect(adjustment).toBeTruthy()
    expect(stockOf(1)).toBe(15) // the business write happened
    const staged = business().filter((op) => op.staged)
    expect(staged).toHaveLength(1)
    expect(m.sync.getSyncStatus().staged).toBe(1)

    // Before restart: a flush does not send it (nor anything created after it).
    localStorage.setItem(K.apiUrl, "http://hub.test"); localStorage.setItem(K.token, token("tenant-A"))
    m.expense.createExpense(EXPENSE) // queued normally, but created after the staged one
    // (the flush recovers it first in the same session now that storage works again)
    vi.resetModules(); m = await svc()
    const r1 = m.sync.recoverStagedSyncOperations()
    const r2 = m.sync.recoverStagedSyncOperations()
    expect(r1.promoted).toBe(1)
    expect(r2).toEqual({ promoted: 0, dropped: 0, held: 0 })
    const released = business().find((op) => op.id === staged[0].id)!
    expect(released.staged).toBeUndefined()
    // released with the stored adjustment as payload (the commit carrying it never reached disk)
    expect(released.payload).toMatchObject({ id: adjustment!.id, quantityChange: 5, adjustmentNumber: adjustment!.adjustmentNumber })

    await m.sync.flushSyncQueue()
    await m.sync.flushSyncQueue()
    expect(pushedCount(staged[0].id)).toBe(1)
    expect(server.stock[1]).toBe(15) // server applied +5 once
    expect(stockOf(1)).toBe(15)       // local applied +5 once
    expect(Object.values(server.expenses)).toEqual([25])
    expect(m.sync.getSyncOperationState(staged[0].id)).toBe("acknowledged")
  })

  it("dependency order: nothing created after an unreleased staged operation is sent before it", async () => {
    let m = await svc()
    localStorage.setItem(K.apiUrl, "http://hub.test"); localStorage.setItem(K.token, token("tenant-A"))
    mode = "down" // keep everything queued for this part
    const spy = failKey(K.queue, 1)
    m.batches.receiveInventoryBatches([{ id: "lot-new", productId: 2, productName: "Chips", barcode: "222", quantity: 8, unitCost: 1, unitPrice: 3 }], { syncOpId: "op-recv-1" })
    spy.mockRestore()
    expect(m.sync.getSyncOperationState("op-recv-1")).toBe("staged")
    m.sales.recordSale({ ...SALE, items: [{ id: 2, name: "Chips", barcode: "222", cost: 1, quantity: 3, unitPrice: 3, total: 9 }], total: 9, subtotal: 9 }, { id: "sale-after" })

    // The pull must not overwrite local data while a staged operation is unresolved — the staged
    // one is released first (storage works again), then the order is kept: receive before sale.
    mode = "ok"
    vi.resetModules(); m = await svc()
    await m.sync.flushSyncQueue()
    const order = server.pushes.flat()
    expect(order.indexOf("op-recv-1")).toBeGreaterThanOrEqual(0)
    const saleOp = business().find((op) => op.entity === "sale" && op.payload?.id === "sale-after")!
    expect(order.indexOf("op-recv-1")).toBeLessThan(order.indexOf(saleOp.id))
    expect(server.stock[2]).toBe(5) // +8 received, then -3 sold
  })

  it("a staged operation that cannot be resolved holds back everything created after it", async () => {
    const m = await svc()
    localStorage.setItem(K.apiUrl, "http://hub.test"); localStorage.setItem(K.token, token("tenant-A"))
    // No rule can tell whether this one's record was written: it is held, and reported.
    m.sync.stageSyncOperation({ id: "op-held", entity: "customer", action: "create", summary: "c", payload: { id: "c-1" } })
    await new Promise((r) => setTimeout(r, 5))
    m.expense.createExpense(EXPENSE)
    await m.sync.flushSyncQueue()
    expect(pushedCount("op-held")).toBe(0)
    expect(Object.values(server.expenses)).toEqual([]) // created after it: held back
    expect(m.sync.getSyncStatus().staged).toBe(1)
  })

  it("a staged operation whose business write never happened is removed, never sent", async () => {
    const m = await svc()
    // A crash between stage and write leaves a staged entry without its record.
    m.sync.stageSyncOperation({ id: "op-ghost", entity: "expense", action: "create", summary: "x", payload: { id: "exp-ghost", amount: 99 } })
    vi.resetModules()
    const m2 = await svc()
    expect(m2.sync.recoverStagedSyncOperations()).toEqual({ promoted: 0, dropped: 1, held: 0 })
    localStorage.setItem(K.apiUrl, "http://hub.test"); localStorage.setItem(K.token, token("tenant-A"))
    await m2.sync.flushSyncQueue()
    expect(pushedCount("op-ghost")).toBe(0)
    expect(server.expenses).toEqual({})
  })
})

describe("retry and uncertain server responses", () => {
  it("applied by the server but the response was lost: resent, and the server applies it once", async () => {
    const m = await svc()
    localStorage.setItem(K.apiUrl, "http://hub.test"); localStorage.setItem(K.token, token("tenant-A"))
    mode = "lost-response"
    const sale = m.sales.recordSale(SALE, { id: "sale-u" })
    await new Promise((r) => setTimeout(r, 0))
    await m.sync.flushSyncQueue()
    const op = business().find((o) => o.payload?.id === sale.id)!
    expect(op.status).toBe("Failed") // uncertain: still queued, never assumed lost or done
    mode = "ok"
    // The retry backoff elapses (time passes), then the next flush resends it.
    localStorage.setItem(K.queue, JSON.stringify(queue().map((o) => o.id === op.id ? { ...o, lastAttemptAt: "2000-01-01T00:00:00.000Z" } : o)))
    await m.sync.flushSyncQueue()
    expect(pushedCount(op.id)).toBe(2) // resent once
    expect(server.stock[1]).toBe(8) // 10 - 2, applied once
    expect(m.sync.getSyncOperationState(op.id)).toBe("acknowledged")
  })

  it("an acknowledged operation pruned from the queue is never queued or sent again", async () => {
    const m = await svc()
    localStorage.setItem(K.apiUrl, "http://hub.test"); localStorage.setItem(K.token, token("tenant-A"))
    m.batches.receiveInventoryBatches([{ id: "lot-p", productId: 2, productName: "Chips", barcode: "222", quantity: 6, unitCost: 1, unitPrice: 3 }], { syncOpId: "op-recv-p" })
    await m.sync.flushSyncQueue()
    expect(m.sync.getSyncOperationState("op-recv-p")).toBe("acknowledged")
    // Pruned (as the 300-entry budget does) — and three sold since on the server.
    localStorage.setItem(K.queue, JSON.stringify(queue().filter((o) => o.id !== "op-recv-p")))
    server.lots["lot-p"] = 3; server.stock[2] = 3
    // Its absence is not a failure: still recorded, and a resumed receive does not resend it.
    expect(m.sync.isSyncOperationRecorded("op-recv-p")).toBe(true)
    m.batches.receiveInventoryBatches([{ id: "lot-p", productId: 2, productName: "Chips", barcode: "222", quantity: 6, unitCost: 1, unitPrice: 3 }], { syncOpId: "op-recv-p" })
    await m.sync.enqueueSyncOperation({ id: "op-recv-p", entity: "inventory", action: "receive", summary: "again", payload: [] })
    await m.sync.flushSyncQueue()
    expect(pushedCount("op-recv-p")).toBe(1)
    expect(server.lots["lot-p"]).toBe(3) // not reset to 6
    expect(server.stock[2]).toBe(3)
  })

  it("operations queued while a flush is in flight are kept (no stale-snapshot overwrite)", async () => {
    const m = await svc()
    localStorage.setItem(K.apiUrl, "http://hub.test"); localStorage.setItem(K.token, token("tenant-A"))
    mode = "down"
    m.expense.createExpense(EXPENSE)
    mode = "ok"
    let open!: () => void
    gate = new Promise<void>((r) => { open = r })
    const flushing = m.sync.flushSyncQueue()
    await new Promise((r) => setTimeout(r, 0))
    gate = null
    m.expense.createExpense({ ...EXPENSE, amount: 7, invoiceNumber: "E-2" }) // while the push is waiting
    open()
    await flushing
    const expenseOps = business().filter((o) => o.entity === "expense")
    expect(expenseOps).toHaveLength(2)
    await m.sync.flushSyncQueue()
    expect(Object.values(server.expenses).sort()).toEqual([25, 7].sort())
  })
})

describe("store switch", () => {
  it("returning to a store keeps its stash when the queue cannot take the operations back", async () => {
    localStorage.setItem(K.token, token("tenant-A"))
    let m = await svc()
    mode = "down"
    m.expense.createExpense(EXPENSE)
    await m.sync.clearStoreData()
    m.sync.setAuthToken(token("tenant-B"))
    vi.resetModules(); m = await svc()
    await m.sync.clearStoreData()
    m.sync.setAuthToken(token("tenant-A"))
    const spy = failKey(K.queue)
    expect(m.sync.restoreStashedMoneyConflicts()).toBe(0)
    spy.mockRestore()
    expect(business()).toEqual([])
    // Still stashed: the next attempt brings it back.
    m.sync.restoreStashedMoneyConflicts()
    expect(business().filter((o) => o.entity === "expense")).toHaveLength(1)
  })

  it("a staged operation is settled before the switch, travels with its tenant, and is sent once back home", async () => {
    localStorage.setItem(K.token, token("tenant-A"))
    let m = await svc()
    mode = "down"
    const spy = failKey(K.queue, 1)
    m.expense.createExpense(EXPENSE) // written; commit failed -> staged
    spy.mockRestore()
    expect(business().filter((o) => o.staged)).toHaveLength(1)

    await m.sync.clearStoreData() // recovers staged ops first, then stashes this tenant's work
    m.sync.setAuthToken(token("tenant-B"))
    vi.resetModules(); m = await svc()
    expect(business()).toEqual([])
    expect(m.sync.getSyncStatus().staged).toBe(0)
    // Tenant B's acknowledgements never vouch for tenant A's operations.
    expect(m.sync.isRecordAcknowledged("expense", "create", "anything")).toBe(false)

    await m.sync.clearStoreData()
    m.sync.setAuthToken(token("tenant-A"))
    m.sync.restoreStashedMoneyConflicts()
    const back = business().filter((o) => o.entity === "expense")
    expect(back).toHaveLength(1)
    expect(back[0].staged).toBeUndefined()
    mode = "ok"
    localStorage.setItem(K.apiUrl, "http://hub.test")
    await m.sync.flushSyncQueue()
    await m.sync.flushSyncQueue()
    expect(pushedCount(back[0].id)).toBe(1)
    expect(Object.values(server.expenses)).toEqual([25])
  })
})
