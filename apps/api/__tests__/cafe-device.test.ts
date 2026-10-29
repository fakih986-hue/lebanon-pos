import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomUUID } from "node:crypto"
import jwt from "jsonwebtoken"

// CAFE ACCEPTANCE (SPRINT-1; real desktop services + real API + real Postgres). A café till
// creates drinks with no barcode (made to order, untracked) and a scanned packaged item
// (tracked) through the device's own services, sells them in one order, refunds, voids, goes
// offline, restarts and re-syncs. Every claim is checked on the device AND on the server.
process.env.JWT_SECRET = process.env.JWT_SECRET || "cafe-device-secret"

class MemoryStorage {
  private m = new Map<string, string>()
  get length() { return this.m.size }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
  clear() { this.m.clear() }
}
const storage = new MemoryStorage()
const events = new EventTarget()
const g = globalThis as unknown as Record<string, unknown>
g.localStorage = storage
const deviceTimers = new Set<ReturnType<typeof setTimeout>>()
g.window = new Proxy(globalThis, {
  get(t, k) {
    if (k === "setTimeout") return (fn: () => void, ms?: number) => { const id = setTimeout(() => { deviceTimers.delete(id); fn() }, ms); deviceTimers.add(id); return id }
    if (k === "clearTimeout") return (id: ReturnType<typeof setTimeout>) => { deviceTimers.delete(id); clearTimeout(id) }
    return Reflect.get(t, k)
  },
})
g.addEventListener = events.addEventListener.bind(events)
g.removeEventListener = events.removeEventListener.bind(events)
g.dispatchEvent = events.dispatchEvent.bind(events)
let offline = false
let loseAnswers = false // the server commits, the till never hears back
const inflight = new Set<Promise<unknown>>()
const realFetch = globalThis.fetch
g.fetch = ((url: string, init?: RequestInit) => {
  if (offline) return Promise.reject(new TypeError("Failed to fetch (offline)"))
  const p = (async () => {
    const res = await realFetch(url, init)
    if (loseAnswers && String(url).includes("/api/sync/push")) { await res.text(); throw new Error("connection reset: response lost") }
    return res
  })()
  inflight.add(p); void p.catch(() => undefined).finally(() => inflight.delete(p)); return p
}) as typeof fetch
async function dispose() {
  for (const id of deviceTimers) clearTimeout(id)
  deviceTimers.clear()
  for (let i = 0; i < 20 && (inflight.size > 0 || i < 3); i++) { await Promise.allSettled([...inflight]); await new Promise((r) => setImmediate(r)) }
}

const prisma = (await import("../src/lib/prisma.js")).default
const app = (await import("../src/app.js")).default
process.env.IS_LOCAL_SERVER = "false" // pinned (not deleted): a module reset re-runs dotenv, which would fill a missing value from apps/api/.env
vi.setConfig({ testTimeout: 60_000 })

const T = randomUUID()
const ADMIN = randomUUID(), CASHIER = randomUUID()
const PEP = `PEP-${T.slice(0, 6)}`
let baseUrl = ""

async function device() {
  return {
    sync: await import("../../desktop/src/features/pos/services/sync.service.js"),
    sales: await import("../../desktop/src/features/pos/services/sales.service.js"),
    security: await import("../../desktop/src/features/pos/services/security.service.js"),
    product: await import("../../desktop/src/features/pos/services/product.service.js"),
    batches: await import("../../desktop/src/features/pos/services/inventoryBatch.service.js"),
    imports: await import("../../desktop/src/features/pos/services/import.service.js"),
    held: await import("../../desktop/src/features/pos/services/heldSale.service.js"),
  }
}
type Device = Awaited<ReturnType<typeof device>>
async function restart(): Promise<Device> { await dispose(); vi.resetModules(); const d = await device(); d.sync.recoverStagedSyncOperations(); return d }
async function flush(d: Device) {
  for (let i = 0; i < 3; i++) {
    const q = JSON.parse(storage.getItem("lebanonpos.sync-queue.v1") ?? "[]") as Array<Record<string, unknown>>
    storage.setItem("lebanonpos.sync-queue.v1", JSON.stringify(q.map((op) => ({ ...op, lastAttemptAt: "2000-01-01T00:00:00.000Z" }))))
    await d.sync.flushSyncQueue()
  }
  await dispose()
}
const queue = () => JSON.parse(storage.getItem("lebanonpos.sync-queue.v1") ?? "[]") as Array<{ id: string; entity: string; action: string; status: string; error?: string; summary: string }>
const notSynced = () => queue().filter((o) => o.status !== "Synced")
type LocalProduct = { id: number; syncId: string; name: string; barcode: string | null; stock: number; price: number; cost: number; stockPolicy?: string; stockPolicyVersion?: number }
const localProducts = () => JSON.parse(storage.getItem("lebanonpos.products.v1") ?? "[]") as LocalProduct[]
const local = (name: string) => localProducts().find((p) => p.name === name)!
const server = (name: string) => prisma.product.findFirst({ where: { tenantId: T, name } })
const signIn = (id: string) => storage.setItem("lebanonpos.current-user.v1", id)

/** One café order built the way POSPage builds it (only tracked lines consume lots and stock). */
function order(d: Device, lines: Array<{ name: string; qty: number }>) {
  const items = lines.map((l) => ({ p: local(l.name), l }))
  const tracked = items.filter(({ p }) => p.stockPolicy !== "untracked")
  const lots = tracked.map(({ p, l }) => ({ productId: p.id, productName: p.name, barcode: p.barcode ?? "", quantity: l.qty, fallbackUnitCost: p.cost }))
  const dry = d.batches.consumeInventoryBatches(lots, { dryRun: true })
  const total = items.reduce((s, x) => s + x.l.qty * x.p.price, 0)
  const id = randomUUID()
  const sale = d.sales.buildSale({
    saleNumber: `S-CAFE-${id.slice(0, 6)}`, paymentMethod: "Cash", subtotal: total, tax: 0, total,
    items: items.map(({ p, l }) => {
      const untracked = p.stockPolicy === "untracked"
      return { id: p.id, productSyncId: p.syncId, name: p.name, barcode: p.barcode ?? "", cost: p.cost, stockPolicy: untracked ? "untracked" : "tracked", stockPolicyVersion: p.stockPolicyVersion ?? 1, stockPolicyRev: (p as any).stockPolicyRev ?? "initial", quantity: l.qty, unitPrice: p.price, total: l.qty * p.price, batchAllocations: untracked ? [] : dry.get(p.id) ?? [] }
    }),
  } as Parameters<typeof d.sales.buildSale>[0], id)
  return { sale, lots, stock: tracked.map(({ p, l }) => ({ productId: p.id, quantity: l.qty })) }
}

beforeAll(async () => {
  const srv = http.createServer(app)
  await new Promise<void>((r) => srv.listen(0, r))
  ;(globalThis as Record<string, unknown>).__cafeServer = srv
  baseUrl = `http://localhost:${(srv.address() as AddressInfo).port}`
  await prisma.tenant.create({ data: { id: T, name: "Cafe acceptance IT (disposable)", subdomain: `cd-${T.slice(0, 8)}` } })
  await prisma.staffUser.create({ data: { id: ADMIN, tenantId: T, name: "Owner", mobile: `cd-a-${T.slice(0, 6)}`, pin: "x", role: "Admin" } })
  await prisma.staffUser.create({ data: { id: CASHIER, tenantId: T, name: "Rana (cashier)", mobile: `cd-c-${T.slice(0, 6)}`, pin: "x", role: "Cashier", permissions: ["sales.checkout", "sales.reprint", "inventory.view"] } })
  storage.setItem("lebanonpos.users.v1", JSON.stringify([
    { id: ADMIN, name: "Owner", role: "Admin", pin: "HASH-A", active: true, permissions: [], createdAt: "2026-01-01T00:00:00.000Z" },
    { id: CASHIER, name: "Rana (cashier)", role: "Cashier", pin: "HASH-C", active: true, permissions: ["sales.checkout", "sales.reprint", "inventory.view"], createdAt: "2026-01-01T00:00:00.000Z" },
  ]))
  signIn(ADMIN)
  storage.setItem("lebanonpos.api-url", baseUrl)
  storage.setItem("lebanonpos.auth-token", jwt.sign({ userId: ADMIN, tenantId: T, role: "Admin", tokenVersion: 1 }, process.env.JWT_SECRET!, { expiresIn: "1h" }))
  storage.setItem("lebanonpos.tenant-id.v1", T)
})

afterAll(async () => {
  await dispose()
  const where = { tenantId: T }
  for (const m of ["stockMovement", "syncOperation", "saleRefund", "sale", "shift", "inventoryBatch", "auditEvent", "product", "staffUser"] as const) await (prisma[m] as any).deleteMany({ where })
  await prisma.tenant.deleteMany({ where: { id: T } })
  await new Promise<void>((r) => ((globalThis as Record<string, unknown>).__cafeServer as http.Server).close(() => r()))
})

describe("café menu: barcode-free, untracked drinks next to a tracked packaged item", () => {
  it("the till creates three drinks with no barcode and one Pepsi with a barcode and 24 in stock", async () => {
    const d = await device()
    for (const [name, price] of [["Espresso", 1.5], ["Double espresso", 2.25], ["Cappuccino", 2.5]] as const) {
      expect(d.product.createProduct({ name, barcode: "", price, cost: 0.4, stock: 0, category: "Coffee", stockPolicy: "untracked" })).toBeDefined()
    }
    expect(d.product.createProduct({ name: "Pepsi 330ml", barcode: PEP, price: 1, cost: 0.5, stock: 24, category: "Drinks" })).toBeDefined()
    expect(local("Espresso")).toMatchObject({ barcode: null, stockPolicy: "untracked", stock: 0 })
    expect(local("Pepsi 330ml")).toMatchObject({ barcode: PEP, stockPolicy: "tracked", stock: 24 })
    await flush(d)
    expect(notSynced().map((o) => `${o.summary} [${o.status} x${(o as { attempts?: number }).attempts}] ${o.error ?? ""}`.slice(0, 220))).toEqual([])
  })

  it("an incremental pull keeps exactly one local copy of each product (matched by syncId, not barcode)", async () => {
    const d = await device()
    await d.sync.pullFromServer(false); await dispose()
    const mine = localProducts().filter((p) => ["Cappuccino", "Double espresso", "Espresso", "Pepsi 330ml"].includes(p.name))
    expect(mine.map((p) => p.name).sort()).toEqual(["Cappuccino", "Double espresso", "Espresso", "Pepsi 330ml"]) // once each
    expect(new Set(mine.map((p) => p.syncId)).size).toBe(4)
  })

  it("all of them reach the server as distinct products: no barcode = NULL, own syncId, no artificial stock", async () => {
    const drinks = await prisma.product.findMany({ where: { tenantId: T, category: "Coffee" }, orderBy: { name: "asc" } })
    expect(drinks.map((p) => [p.name, p.barcode, p.stockPolicy, Number(p.stock)])).toEqual([
      ["Cappuccino", null, "untracked", 0], ["Double espresso", null, "untracked", 0], ["Espresso", null, "untracked", 0],
    ])
    expect(new Set(drinks.map((p) => p.syncId)).size).toBe(3)
    expect(await prisma.inventoryBatch.count({ where: { tenantId: T, productName: { in: ["Espresso", "Cappuccino", "Double espresso"] } } })).toBe(0)
    expect((await server("Pepsi 330ml"))).toMatchObject({ barcode: PEP, stockPolicy: "tracked" })
    expect(Number((await server("Pepsi 330ml"))!.stock)).toBe(24)
  })

  it("an imported sheet adds two more barcode-free drinks; nothing merges", async () => {
    const d = await device()
    const { rows } = d.imports.parseProductImport("Name,Barcode,Category,Cost,Price,Track stock\nIced latte,,Coffee,0.6,3,no\nNescafé,,Coffee,0.2,1,no")
    const plan = d.imports.analyzeProductImport(rows, d.product.getProductsSync())
    expect(plan.counts).toMatchObject({ create: 2, invalid: 0, conflict: 0 })
    d.imports.commitProductImport(plan)
    await flush(d)
    expect(notSynced().map((o) => `${o.summary} [${o.status} x${(o as { attempts?: number }).attempts}] ${o.error ?? ""}`.slice(0, 220))).toEqual([])
    expect(await prisma.product.count({ where: { tenantId: T, barcode: null, stockPolicy: "untracked" } })).toBe(5)
  })

  it("editing a drink (rename, price) keeps it distinct and barcode-free", async () => {
    const d = await device()
    d.product.updateProduct(local("Double espresso").id, { name: "Double shot", price: 2.5 })
    await flush(d)
    const s = await server("Double shot")
    expect(s).toMatchObject({ barcode: null, stockPolicy: "untracked" })
    expect(Number(s!.price)).toBe(2.5)
    expect(await prisma.product.count({ where: { tenantId: T, barcode: null } })).toBe(5)
  })

  it("after a restart and a full pull the till still has the five drinks, distinct and barcode-free", async () => {
    const d = await restart()
    await d.sync.pullFromServer(true); await dispose()
    const drinks = localProducts().filter((p) => p.stockPolicy === "untracked")
    expect(drinks.map((p) => p.name).sort()).toEqual(["Cappuccino", "Double shot", "Espresso", "Iced latte", "Nescafé"])
    expect(drinks.every((p) => p.barcode == null || p.barcode === "")).toBe(true)
    expect(new Set(drinks.map((p) => p.syncId)).size).toBe(5)
  })
})

describe("one café order: Espresso ×2 (untracked, no stock) + Pepsi ×1 (tracked)", () => {
  let saleId = ""
  it("the cashier opens a shift and the order completes locally", async () => {
    const d = await device()
    signIn(CASHIER)
    d.security.setCurrentUser(CASHIER)
    d.security.openShift(50)
    const o = order(d, [{ name: "Espresso", qty: 2 }, { name: "Pepsi 330ml", qty: 1 }])
    saleId = o.sale.id
    expect(d.sales.checkoutLocalSale(o).status).toBe("completed")
    expect(local("Espresso").stock).toBe(0)     // no artificial stock, nothing decremented
    expect(local("Pepsi 330ml").stock).toBe(23)
    await flush(d)
    expect(notSynced().map((o) => `${o.summary} [${o.status} x${(o as { attempts?: number }).attempts}] ${o.error ?? ""}`.slice(0, 220))).toEqual([])
  })

  it("the server records it once: money for both lines, stock only for Pepsi, line snapshots kept", async () => {
    const sale = await prisma.sale.findUnique({ where: { id: saleId }, include: { items: true } })
    expect(Number(sale!.total)).toBe(4)
    expect(sale!.items.map((i) => [i.productName, i.stockPolicy, i.barcode]).sort()).toEqual([["Espresso", "untracked", ""], ["Pepsi 330ml", "tracked", PEP]])
    expect(sale!.items.find((i) => i.productName === "Espresso")!.batchAllocations).toEqual([])
    expect(Number((await server("Pepsi 330ml"))!.stock)).toBe(23)
    expect(Number((await server("Espresso"))!.stock)).toBe(0)
  })

  it("offline: another order completes on the till, then syncs exactly once on reconnect (even with a lost answer)", async () => {
    const d = await device()
    offline = true
    const o = order(d, [{ name: "Cappuccino", qty: 1 }, { name: "Pepsi 330ml", qty: 2 }])
    try {
      expect(d.sales.checkoutLocalSale(o).status).toBe("completed")
      await dispose()
    } finally { offline = false }
    expect(notSynced().some((op) => op.entity === "sale")).toBe(true)
    // Reconnect: the first push is committed by the server but its answer is lost...
    loseAnswers = true
    try { await d.sync.flushSyncQueue(); await dispose() } finally { loseAnswers = false }
    // ...the retry is acknowledged as already applied.
    await flush(d)
    expect(notSynced().map((o) => `${o.summary} [${o.status} x${(o as { attempts?: number }).attempts}] ${o.error ?? ""}`.slice(0, 220))).toEqual([])
    expect(await prisma.sale.count({ where: { tenantId: T, id: o.sale.id } })).toBe(1)
    expect(Number((await server("Pepsi 330ml"))!.stock)).toBe(21)
  })

  it("a tracked item with no stock is still refused (till and server)", async () => {
    await prisma.product.updateMany({ where: { tenantId: T, name: "Pepsi 330ml" }, data: { stock: 0 } })
    const id = randomUUID()
    const p = (await server("Pepsi 330ml"))!
    const res = await realFetch(`${baseUrl}/api/sync/push`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${storage.getItem("lebanonpos.auth-token")}`, "x-titan-sync-schema": "3" }, body: JSON.stringify({ operations: [{ id, entity: "sale", action: "create", payload: { id, saleNumber: "S-OUT", paymentMethod: "Cash", subtotal: 1, tax: 0, total: 1, cashier: "Rana", status: "Completed", items: [{ id: p.id, productSyncId: p.syncId, lineId: randomUUID(), name: p.name, barcode: PEP, quantity: 1, unitPrice: 1, total: 1, cost: 0.5 }] } }] }) })
    const r = ((await res.json()) as { results: Array<{ status: string; error?: string }> }).results[0]
    expect(r.status).toBe("rejected")
    expect(r.error).toMatch(/Insufficient stock/)
    await prisma.product.updateMany({ where: { tenantId: T, name: "Pepsi 330ml" }, data: { stock: 21 } })
  })
})

describe("refunds and voids follow the line's stock policy when it was sold", () => {
  let saleId = ""
  it("a refund of the Espresso returns money only; a refund of the Pepsi restores stock and its lot", async () => {
    let d = await device()
    signIn(ADMIN); d.security.setCurrentUser(ADMIN)
    d = await device()
    await d.sync.pullFromServer(true); await dispose()
    const pepBefore = local("Pepsi 330ml").stock
    const o = order(d, [{ name: "Espresso", qty: 1 }, { name: "Pepsi 330ml", qty: 1 }])
    saleId = o.sale.id
    expect(d.sales.checkoutLocalSale(o).status).toBe("completed")
    await flush(d)
    const serverPepBefore = Number((await server("Pepsi 330ml"))!.stock)
    const lines = d.sales.getSales().find((s) => s.id === saleId)!.items
    const espLine = lines.find((l) => l.name === "Espresso")!.lineId!
    const pepLine = lines.find((l) => l.name === "Pepsi 330ml")!.lineId!
    d.sales.processRefund({ saleId, quantities: { [espLine]: 1 }, reason: "spilled" })
    expect(local("Espresso").stock).toBe(0)
    d.sales.processRefund({ saleId, quantities: { [pepLine]: 1 }, reason: "unopened" })
    expect(local("Pepsi 330ml").stock).toBe(pepBefore)
    await flush(d)
    expect(notSynced().map((o) => `${o.summary} [${o.status} x${(o as { attempts?: number }).attempts}] ${o.error ?? ""}`.slice(0, 220))).toEqual([])
    expect(Number((await server("Espresso"))!.stock)).toBe(0)
    expect(Number((await server("Pepsi 330ml"))!.stock)).toBe(serverPepBefore + 1)
    const refunds = await prisma.saleRefund.findMany({ where: { tenantId: T, saleId }, include: { items: true } })
    expect(refunds.reduce((s, r) => s + Number(r.total), 0)).toBe(2.5)
    expect(await prisma.stockMovement.count({ where: { tenantId: T, type: "Refund", productId: (await server("Espresso"))!.id } })).toBe(0)
  })

  it("voiding a mixed sale restores the Pepsi only", async () => {
    const d = await device()
    const o = order(d, [{ name: "Cappuccino", qty: 2 }, { name: "Pepsi 330ml", qty: 1 }])
    expect(d.sales.checkoutLocalSale(o).status).toBe("completed")
    await flush(d)
    const pep = Number((await server("Pepsi 330ml"))!.stock)
    d.sales.voidSale(o.sale.id)
    await flush(d)
    expect(notSynced().map((o) => `${o.summary} [${o.status} x${(o as { attempts?: number }).attempts}] ${o.error ?? ""}`.slice(0, 220))).toEqual([])
    expect(Number((await server("Pepsi 330ml"))!.stock)).toBe(pep + 1)
    expect(Number((await server("Cappuccino"))!.stock)).toBe(0)
    expect(local("Cappuccino").stock).toBe(0)
  })

  it("a policy change AFTER the sale does not change what the old line's refund does", async () => {
    // The owner starts counting Nescafé jars as stock (tracked) after a cup was sold untracked.
    const d = await device()
    const o = order(d, [{ name: "Nescafé", qty: 1 }])
    expect(d.sales.checkoutLocalSale(o).status).toBe("completed")
    await flush(d)
    d.product.updateProduct(local("Nescafé").id, { stockPolicy: "tracked" })
    await flush(d)
    expect((await server("Nescafé"))!.stockPolicy).toBe("tracked")
    const line = d.sales.getSales().find((s) => s.id === o.sale.id)!.items[0].lineId!
    d.sales.processRefund({ saleId: o.sale.id, quantities: { [line]: 1 }, reason: "remade" })
    await flush(d)
    expect(notSynced().map((o) => `${o.summary} [${o.status} x${(o as { attempts?: number }).attempts}] ${o.error ?? ""}`.slice(0, 220))).toEqual([])
    expect(Number((await server("Nescafé"))!.stock)).toBe(0) // the old untracked line restored nothing
    expect(local("Nescafé").stock).toBe(0)
  })
})

describe("compatibility with existing stores and older tills", () => {
  it("a product created without a stock policy (existing stores, older clients) is tracked", async () => {
    const id = randomUUID()
    const r = await realFetch(`${baseUrl}/api/sync/push`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${storage.getItem("lebanonpos.auth-token")}`, "x-titan-sync-schema": "3" }, body: JSON.stringify({ operations: [{ id, entity: "product", action: "create", payload: { syncId: randomUUID(), name: "Chips", barcode: `CH-${T.slice(0, 6)}`, price: 0.75, cost: 0.3, category: "Snacks" } }] }) })
    expect(((await r.json()) as { results: Array<{ status: string }> }).results[0].status).toBe("ok")
    expect((await server("Chips"))!.stockPolicy).toBe("tracked")
  })

  it("an older till sending empty-string barcodes: stored as NULL, several coexist", async () => {
    const push = async (name: string) => {
      const id = randomUUID()
      const r = await realFetch(`${baseUrl}/api/sync/push`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${storage.getItem("lebanonpos.auth-token")}`, "x-titan-sync-schema": "3" }, body: JSON.stringify({ operations: [{ id, entity: "product", action: "create", payload: { syncId: randomUUID(), name, barcode: "", price: 1, cost: 0.2, category: "Old" } }] }) })
      return ((await r.json()) as { results: Array<{ status: string }> }).results[0].status
    }
    expect([await push("Old till item A"), await push("Old till item B")]).toEqual(["ok", "ok"])
    expect(await prisma.product.count({ where: { tenantId: T, category: "Old", barcode: null } })).toBe(2)
  })

  it("an older till's sale of an untracked drink (no stockPolicy on its lines) is accepted: the server's policy decides", async () => {
    const p = (await server("Espresso"))!
    const id = randomUUID()
    const r = await realFetch(`${baseUrl}/api/sync/push`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${storage.getItem("lebanonpos.auth-token")}`, "x-titan-sync-schema": "3" }, body: JSON.stringify({ operations: [{ id, entity: "sale", action: "create", payload: { id, saleNumber: "S-OLD", paymentMethod: "Cash", subtotal: 1.5, tax: 0, total: 1.5, cashier: "Old till", status: "Completed", items: [{ id: p.id, productSyncId: p.syncId, lineId: randomUUID(), name: p.name, barcode: "", quantity: 1, unitPrice: 1.5, total: 1.5, cost: 0.4, batchAllocations: [{ batchId: "legacy-stock", quantity: 1, unitCost: 0.4 }] }] } }] }) })
    expect(((await r.json()) as { results: Array<{ status: string }> }).results[0].status).toBe("ok")
    expect((await prisma.saleItem.findFirst({ where: { saleId: id } }))!.stockPolicy).toBe("untracked")
    expect(Number((await server("Espresso"))!.stock)).toBe(0)
  })

  it("a 1.0.50 hub (sync schema 2) pulls products and sales without the new column; schema 3 gets it", async () => {
    const auth = { Authorization: `Bearer ${storage.getItem("lebanonpos.auth-token")}` }
    for (const [schema, expectPolicy] of [["2", false], ["3", true]] as const) {
      const r = await realFetch(`${baseUrl}/api/sync/pull`, { headers: { ...auth, "x-titan-sync-schema": schema } })
      const body = (await r.json()) as { products: Array<Record<string, unknown>>; sales: Array<{ items: Array<Record<string, unknown>> }> }
      expect([schema, body.products.some((p) => "stockPolicy" in p)]).toEqual([schema, expectPolicy])
      expect([schema, body.sales.some((s) => s.items.some((i) => "stockPolicy" in i))]).toEqual([schema, expectPolicy])
      const full = await realFetch(`${baseUrl}/api/sync/pull/full/products`, { headers: { ...auth, "x-titan-sync-schema": schema } })
      expect([schema, ((await full.json()) as { items: Array<Record<string, unknown>> }).items.some((p) => "stockPolicy" in p)]).toEqual([schema, expectPolicy])
    }
  })

  it("a till cannot declare a packaged (tracked) item untracked to skip stock control", async () => {
    await prisma.product.updateMany({ where: { tenantId: T, name: "Chips" }, data: { stock: 0 } })
    const p = (await server("Chips"))!
    const id = randomUUID()
    const r = await realFetch(`${baseUrl}/api/sync/push`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${storage.getItem("lebanonpos.auth-token")}`, "x-titan-sync-schema": "3" }, body: JSON.stringify({ operations: [{ id, entity: "sale", action: "create", payload: { id, saleNumber: "S-CHEAT", paymentMethod: "Cash", subtotal: 0.75, tax: 0, total: 0.75, cashier: "x", status: "Completed", items: [{ id: p.id, productSyncId: p.syncId, lineId: randomUUID(), name: p.name, barcode: p.barcode, stockPolicy: "untracked", quantity: 1, unitPrice: 0.75, total: 0.75, cost: 0.3 }] } }] }) })
    expect(((await r.json()) as { results: Array<{ status: string }> }).results[0].status).toBe("rejected")
  })
})

// ── SPRINT-1 acceptance: stock-policy changes between an offline checkout and its sync ──────────
async function adminPush(entity: string, action: string, payload: unknown) {
  const id = randomUUID()
  const r = await realFetch(`${baseUrl}/api/sync/push`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${storage.getItem("lebanonpos.auth-token")}`, "x-titan-sync-schema": "3" }, body: JSON.stringify({ operations: [{ id, entity, action, payload }] }) })
  return ((await r.json()) as { results: Array<{ status: string; error?: string }> }).results[0]
}
const saleLine = async (saleId: string, name: string) => (await prisma.saleItem.findFirst({ where: { saleId, productName: name } }))!

describe("stock-policy change between an offline checkout and its sync: the sale-time policy is kept", () => {
  it("sold as made-to-order offline; the owner switches it to tracked before the sale syncs", async () => {
    const d = await device()
    signIn(ADMIN); d.security.setCurrentUser(ADMIN)
    d.product.createProduct({ name: "Flat white", barcode: "", price: 2.75, cost: 0.6, stock: 0, category: "Coffee", stockPolicy: "untracked" })
    await flush(d)
    offline = true
    const o = order(d, [{ name: "Flat white", qty: 1 }])
    try { expect(d.sales.checkoutLocalSale(o).status).toBe("completed"); await dispose() } finally { offline = false }
    expect(o.sale.items[0]).toMatchObject({ stockPolicy: "untracked", stockPolicyRev: "initial" })
    expect((await adminPush("product", "update", { syncId: local("Flat white").syncId, stockPolicy: "tracked" })).status).toBe("ok")
    expect(await server("Flat white")).toMatchObject({ stockPolicy: "tracked", stockPolicyVersion: 2 })
    await flush(d)
    const line = await saleLine(o.sale.id, "Flat white")
    expect([line.stockPolicy, line.stockPolicyConflict]).toEqual(["untracked", "changed"]) // sale-time policy kept, flagged
    expect(Number((await server("Flat white"))!.stock)).toBe(0) // nothing taken from stock it never used
    expect(await prisma.auditEvent.count({ where: { tenantId: T, action: "sale.stock_policy_conflict", metadata: { path: ["saleId"], equals: o.sale.id } } })).toBe(1)
  })

  it("sold as tracked offline; switched to made-to-order before the sale syncs: lots consumed, flagged", async () => {
    const d = await device()
    d.product.createProduct({ name: "Croissant", barcode: "", price: 1.25, cost: 0.4, stock: 5, category: "Bakery" })
    await flush(d)
    const lot = (await prisma.inventoryBatch.findFirst({ where: { tenantId: T, productName: "Croissant" } }))!
    offline = true
    const o = order(d, [{ name: "Croissant", qty: 1 }])
    try { expect(d.sales.checkoutLocalSale(o).status).toBe("completed"); await dispose() } finally { offline = false }
    expect((await adminPush("product", "update", { syncId: local("Croissant").syncId, stockPolicy: "untracked" })).status).toBe("ok")
    await flush(d)
    const line = await saleLine(o.sale.id, "Croissant")
    expect([line.stockPolicy, line.stockPolicyConflict]).toEqual(["tracked", "changed"])
    expect(Number((await prisma.inventoryBatch.findUnique({ where: { id: lot.id } }))!.quantityRemaining)).toBe(4)
    expect(Number((await server("Croissant"))!.stock)).toBe(4) // stock taken by the line's policy, though the product is made-to-order today
  })

  it("an older till's line with no policy revision, for a product whose policy changed: held (retryable), nothing applied", async () => {
    const p = (await server("Croissant"))!
    const before = Number(p.stock)
    const id = randomUUID()
    const r = await adminPush("sale", "create", { id, saleNumber: "S-OLD-TILL", paymentMethod: "Cash", subtotal: 1.25, tax: 0, total: 1.25, cashier: "Old till", status: "Completed", createdAt: new Date(Date.now() - 3600_000).toISOString(), items: [{ id: p.id, productSyncId: p.syncId, lineId: randomUUID(), name: p.name, barcode: "", quantity: 1, unitPrice: 1.25, total: 1.25, cost: 0.4 }] })
    expect(r.status).toBe("error")
    expect(r.error).toMatch(/^STOCK_POLICY_HELD:/)
    expect(await prisma.sale.count({ where: { id } })).toBe(0)
    expect(Number((await server("Croissant"))!.stock)).toBe(before)
  })

  it("a line claiming a policy that contradicts its own revision is refused visibly (not applied)", async () => {
    const p = (await server("Croissant"))!
    const id = randomUUID()
    const r = await adminPush("sale", "create", { id, saleNumber: "S-BAD", paymentMethod: "Cash", subtotal: 1.25, tax: 0, total: 1.25, cashier: "x", status: "Completed", items: [{ id: p.id, productSyncId: p.syncId, lineId: randomUUID(), name: p.name, barcode: "", stockPolicy: "tracked", stockPolicyRev: p.stockPolicyRev, quantity: 1, unitPrice: 1.25, total: 1.25, cost: 0.4 }] })
    expect(r.status).toBe("rejected")
    expect(r.error).toMatch(/^STOCK_POLICY_MISMATCH:/)
    expect(await prisma.sale.count({ where: { id } })).toBe(0)
  })

  it("a policy change made on this till, then a sale before syncing: same version on both sides, no conflict", async () => {
    let d = await device()
    await d.sync.pullFromServer(true); await dispose()
    d = await device()
    const v = local("Flat white").stockPolicyVersion ?? 1
    d.product.updateProduct(local("Flat white").id, { stockPolicy: "untracked" })
    expect(local("Flat white").stockPolicyVersion).toBe(v + 1)
    const minted = local("Flat white").stockPolicyRev
    expect(minted).toMatch(/^[0-9a-f-]{36}$/)
    const o = order(d, [{ name: "Flat white", qty: 1 }])
    expect(d.sales.checkoutLocalSale(o).status).toBe("completed")
    await flush(d)
    expect(notSynced().map((x) => `${x.summary} ${x.error ?? ""}`)).toEqual([])
    const line = await saleLine(o.sale.id, "Flat white")
    expect([line.stockPolicy, line.stockPolicyRev, line.stockPolicyConflict]).toEqual(["untracked", minted, null])
    expect(await server("Flat white")).toMatchObject({ stockPolicyRev: minted, stockPolicyVersion: v + 1 })
  })
})

describe("historical stock policy across revisions (tracked → untracked → tracked): the server's record decides", () => {
  const A = `rev-a-${randomUUID()}`, B = `rev-b-${randomUUID()}`, C = `rev-c-${randomUUID()}`
  const sellLine = async (extra: Record<string, unknown>) => {
    const p = (await server("Latte"))!
    const id = randomUUID()
    const r = await adminPush("sale", "create", { id, saleNumber: `S-H-${id.slice(0, 6)}`, paymentMethod: "Cash", subtotal: 3, tax: 0, total: 3, cashier: "x", status: "Completed", createdAt: new Date().toISOString(), items: [{ id: p.id, productSyncId: p.syncId, lineId: randomUUID(), name: p.name, barcode: "", quantity: 1, unitPrice: 3, total: 3, cost: 0.7, ...extra }] })
    return { id, r }
  }
  const stock = async () => Number((await server("Latte"))!.stock)

  it("three revisions are recorded server-side; a client cannot write the history", async () => {
    const d = await device()
    d.product.createProduct({ name: "Latte", barcode: "", price: 3, cost: 0.7, stock: 10, category: "Coffee" })
    await flush(d)
    const syncId = local("Latte").syncId
    expect((await adminPush("product", "update", { syncId, stockPolicy: "untracked", stockPolicyRev: A, stockPolicyParentRev: "initial" })).status).toBe("ok")
    expect((await adminPush("product", "update", { syncId, stockPolicy: "tracked", stockPolicyRev: B, stockPolicyParentRev: A, stockPolicyHistory: [{ rev: "initial", policy: "untracked" }] })).status).toBe("ok")
    const p = (await server("Latte"))!
    expect([p.stockPolicy, p.stockPolicyRev, p.stockPolicyVersion]).toEqual(["tracked", B, 3])
    expect((p.stockPolicyHistory as any[]).map((e) => [e.rev, e.policy])).toEqual([["initial", "tracked"], [A, "untracked"], [B, "tracked"]])
  })

  it("'initial' line: tracked → stock taken, no conflict", async () => {
    const before = await stock()
    const { id, r } = await sellLine({ stockPolicyRev: "initial" })
    expect(r.status).toBe("ok")
    expect([(await saleLine(id, "Latte")).stockPolicy, (await saleLine(id, "Latte")).stockPolicyConflict]).toEqual(["tracked", null])
    expect(await stock()).toBe(before - 1)
  })

  it("revision A line: untracked (A's policy, though today is tracked) → no stock effect, flagged 'changed'", async () => {
    const before = await stock()
    const { id, r } = await sellLine({ stockPolicyRev: A, stockPolicy: "untracked" })
    expect(r.status).toBe("ok")
    const line = await saleLine(id, "Latte")
    expect([line.stockPolicy, line.stockPolicyRev, line.stockPolicyConflict]).toEqual(["untracked", A, "changed"])
    expect(await stock()).toBe(before)
  })

  it("a claim that contradicts the server's record of that revision is refused (A claimed tracked, initial claimed untracked)", async () => {
    for (const extra of [{ stockPolicyRev: A, stockPolicy: "tracked" }, { stockPolicyRev: "initial", stockPolicy: "untracked" }]) {
      const { id, r } = await sellLine(extra)
      expect(r.status).toBe("rejected")
      expect(r.error).toMatch(/^STOCK_POLICY_MISMATCH:/)
      expect(await prisma.sale.count({ where: { id } })).toBe(0)
    }
  })

  it("a revision the server does not know is held (retryable): nothing applied, the claim is not used", async () => {
    const before = await stock()
    const { id, r } = await sellLine({ stockPolicyRev: `unknown-${randomUUID()}`, stockPolicy: "untracked" })
    expect(r.status).toBe("error")
    expect(r.error).toMatch(/^STOCK_POLICY_HELD:/)
    expect(await prisma.sale.count({ where: { id } })).toBe(0)
    expect(await stock()).toBe(before)
  })

  it("a tracked line ('initial') for a product that is made-to-order TODAY still takes stock (the line's policy, not today's)", async () => {
    expect((await adminPush("product", "update", { syncId: local("Latte").syncId, stockPolicy: "untracked", stockPolicyRev: C, stockPolicyParentRev: B })).status).toBe("ok")
    const before = await stock()
    const { id, r } = await sellLine({ stockPolicyRev: "initial", stockPolicy: "tracked" })
    expect(r.status).toBe("ok")
    const line = await saleLine(id, "Latte")
    expect([line.stockPolicy, line.stockPolicyConflict]).toEqual(["tracked", "changed"])
    expect(await stock()).toBe(before - 1)
  })
})

describe("NULL barcodes in the database, barcode transitions, and id remapping", () => {
  const dbBarcode = async (name: string) => (await prisma.$queryRaw<Array<{ barcode: string | null; isnull: boolean }>>`SELECT "barcode", "barcode" IS NULL AS isnull FROM "Product" WHERE "tenantId" = ${T} AND "name" = ${name}`)[0]
  it("blank → NULL, blank → barcode, barcode → blank (NULL again); no '' barcodes anywhere in the store", async () => {
    const d = await device()
    d.product.createProduct({ name: "Mocha", barcode: "  ", price: 3, cost: 0.8, stock: 0, category: "Coffee", stockPolicy: "untracked" })
    await flush(d)
    expect(await dbBarcode("Mocha")).toEqual({ barcode: null, isnull: true })
    d.product.updateProduct(local("Mocha").id, { barcode: `MOCHA-${T.slice(0, 4)}` })
    await flush(d)
    expect((await dbBarcode("Mocha")).barcode).toBe(`MOCHA-${T.slice(0, 4)}`)
    d.product.updateProduct(local("Mocha").id, { barcode: "" })
    expect(local("Mocha").barcode).toBeNull()
    await flush(d)
    expect(await dbBarcode("Mocha")).toEqual({ barcode: null, isnull: true })
    const counts = (await prisma.$queryRaw<Array<{ empty: bigint; nulls: bigint }>>`SELECT count(*) FILTER (WHERE "barcode" = '') AS empty, count(*) FILTER (WHERE "barcode" IS NULL) AS nulls FROM "Product" WHERE "tenantId" = ${T}`)[0]
    expect(Number(counts.empty)).toBe(0)
    expect(Number(counts.nulls)).toBeGreaterThanOrEqual(8)
  })

  it("after a pull replaces a product's local id, its lots, movements, sale lines and held sales follow; a refund still restocks it", async () => {
    let d = await device()
    d.product.createProduct({ name: "House cookie", barcode: "", price: 0.75, cost: 0.2, stock: 3, category: "Bakery" })
    const localId = local("House cookie").id
    const o = order(d, [{ name: "House cookie", qty: 1 }])
    expect(d.sales.checkoutLocalSale(o).status).toBe("completed")
    d.held.holdSale({ items: [{ ...local("House cookie"), quantity: 1 }], paymentMethod: "Cash", selectedCustomerId: undefined, discountMode: "amount", discountValue: 0, note: "table 2" } as never)
    // Another device created products meanwhile: the server's next id is not this till's local id.
    for (let i = 0; i < 3; i++) await prisma.product.create({ data: { tenantId: T, name: `Other till item ${i}`, price: 1, cost: 0, stock: 0, category: "Other", syncId: randomUUID() } as any })
    await flush(d)
    const serverId = (await server("House cookie"))!.id
    expect(serverId).not.toBe(localId)
    await d.sync.pullFromServer(false); await dispose()
    d = await device()
    expect(local("House cookie").id).toBe(serverId)
    expect(localProducts().filter((p) => p.name === "House cookie")).toHaveLength(1)
    const lots = JSON.parse(storage.getItem("lebanonpos.inventory-batches.v1") ?? "[]") as Array<{ productName: string; productId: number }>
    expect(lots.filter((l) => l.productName === "House cookie").length).toBeGreaterThan(0)
    expect(lots.filter((l) => l.productName === "House cookie").every((l) => l.productId === serverId)).toBe(true)
    const moves = JSON.parse(storage.getItem("lebanonpos.stock-movements.v1") ?? "[]") as Array<{ productName?: string; productId: number }>
    expect(moves.filter((m) => m.productName === "House cookie").every((m) => m.productId === serverId)).toBe(true)
    expect(d.sales.getSales().find((s) => s.id === o.sale.id)!.items[0].id).toBe(serverId)
    expect(d.held.getHeldSales().find((h) => h.note === "table 2")!.items[0].id).toBe(serverId)
    const stockBefore = local("House cookie").stock
    const line = d.sales.getSales().find((s) => s.id === o.sale.id)!.items[0].lineId!
    d.sales.processRefund({ saleId: o.sale.id, quantities: { [line]: 1 }, reason: "unopened" })
    expect(local("House cookie").stock).toBe(stockBefore + 1)
    await flush(d)
    expect(notSynced().map((x) => `${x.summary} ${x.error ?? ""}`)).toEqual([])
    expect(Number((await server("House cookie"))!.stock)).toBe(3)
  })
})
