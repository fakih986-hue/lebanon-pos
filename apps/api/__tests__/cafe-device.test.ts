import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomUUID } from "node:crypto"
import jwt from "jsonwebtoken"

// CAFE-DEVICE (real desktop services + real API + real Postgres): a café till creates drinks with
// no barcode and a scanned packaged item through the device's own product service, sells them in
// one order through the device's checkout, and syncs. Evidence for docs/CAFE-COMPATIBILITY-AUDIT.md.
// `it.fails` = CONFIRMED DEFECT (passes while the defect exists).
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
const inflight = new Set<Promise<unknown>>()
const realFetch = globalThis.fetch
g.fetch = ((url: string, init?: RequestInit) => { const p = realFetch(url, init); inflight.add(p); void p.catch(() => undefined).finally(() => inflight.delete(p)); return p }) as typeof fetch
async function dispose() {
  for (const id of deviceTimers) clearTimeout(id)
  deviceTimers.clear()
  for (let i = 0; i < 20 && (inflight.size > 0 || i < 3); i++) { await Promise.allSettled([...inflight]); await new Promise((r) => setImmediate(r)) }
}

const prisma = (await import("../src/lib/prisma.js")).default
const app = (await import("../src/app.js")).default
delete process.env.IS_LOCAL_SERVER
vi.setConfig({ testTimeout: 60_000 })

const T = randomUUID()
const ADMIN = randomUUID(), CASHIER = randomUUID()
let server: http.Server
let baseUrl = ""
const evidence: Array<{ step: string; data: unknown }> = []
const note = (step: string, data: unknown) => evidence.push({ step, data })

async function device() {
  return {
    sync: await import("../../desktop/src/features/pos/services/sync.service.js"),
    sales: await import("../../desktop/src/features/pos/services/sales.service.js"),
    security: await import("../../desktop/src/features/pos/services/security.service.js"),
    product: await import("../../desktop/src/features/pos/services/product.service.js"),
    batches: await import("../../desktop/src/features/pos/services/inventoryBatch.service.js"),
  }
}
type Device = Awaited<ReturnType<typeof device>>
async function flush(d: Device) {
  for (let i = 0; i < 3; i++) {
    const q = JSON.parse(storage.getItem("lebanonpos.sync-queue.v1") ?? "[]") as Array<Record<string, unknown>>
    storage.setItem("lebanonpos.sync-queue.v1", JSON.stringify(q.map((op) => ({ ...op, lastAttemptAt: "2000-01-01T00:00:00.000Z" }))))
    await d.sync.flushSyncQueue()
  }
  await dispose()
}
const queue = () => JSON.parse(storage.getItem("lebanonpos.sync-queue.v1") ?? "[]") as Array<{ id: string; entity: string; action: string; status: string; error?: string; summary: string }>
const localProducts = () => JSON.parse(storage.getItem("lebanonpos.products.v1") ?? "[]") as Array<{ id: number; syncId: string; name: string; barcode: string | null; stock: number; price: number; cost: number }>

function order(d: Device, lines: Array<{ name: string; qty: number }>) {
  const ps = localProducts()
  const items = lines.map((l) => {
    const p = ps.find((x) => x.name === l.name)!
    const alloc = d.batches.consumeInventoryBatches([{ productId: p.id, productName: p.name, barcode: p.barcode ?? "", quantity: l.qty, fallbackUnitCost: p.cost }], { dryRun: true }).get(p.id) ?? []
    return { p, l, alloc }
  })
  const total = items.reduce((s, x) => s + x.l.qty * x.p.price, 0)
  const id = randomUUID()
  const sale = d.sales.buildSale({
    saleNumber: `S-CAFE-${id.slice(0, 6)}`, paymentMethod: "Cash", subtotal: total, tax: 0, total,
    items: items.map(({ p, l, alloc }) => ({ id: p.id, productSyncId: p.syncId, name: p.name, barcode: p.barcode, cost: p.cost, quantity: l.qty, unitPrice: p.price, total: l.qty * p.price, batchAllocations: alloc })),
  } as Parameters<typeof d.sales.buildSale>[0], id)
  return {
    sale,
    lots: items.map(({ p, l }) => ({ productId: p.id, productName: p.name, barcode: p.barcode ?? "", quantity: l.qty, fallbackUnitCost: p.cost })),
    stock: items.map(({ p, l }) => ({ productId: p.id, quantity: l.qty })),
  }
}

beforeAll(async () => {
  server = http.createServer(app)
  await new Promise<void>((r) => server.listen(0, r))
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`
  await prisma.tenant.create({ data: { id: T, name: "Cafe device IT (disposable)", subdomain: `cd-${T.slice(0, 8)}` } })
  await prisma.staffUser.create({ data: { id: ADMIN, tenantId: T, name: "Owner", mobile: `cd-a-${T.slice(0, 6)}`, pin: "x", role: "Admin" } })
  await prisma.staffUser.create({ data: { id: CASHIER, tenantId: T, name: "Rana (cashier)", mobile: `cd-c-${T.slice(0, 6)}`, pin: "x", role: "Cashier", permissions: ["sales.checkout", "sales.reprint", "inventory.view"] } })
  // The till: signed in to the store with the owner's sync token (as a till is), the cashier at the till.
  storage.setItem("lebanonpos.users.v1", JSON.stringify([
    { id: ADMIN, name: "Owner", role: "Admin", pin: "HASH-A", active: true, permissions: [], createdAt: "2026-01-01T00:00:00.000Z" },
    { id: CASHIER, name: "Rana (cashier)", role: "Cashier", pin: "HASH-C", active: true, permissions: ["sales.checkout", "sales.reprint", "inventory.view"], createdAt: "2026-01-01T00:00:00.000Z" },
  ]))
  storage.setItem("lebanonpos.current-user.v1", ADMIN)
  storage.setItem("lebanonpos.api-url", baseUrl)
  storage.setItem("lebanonpos.auth-token", jwt.sign({ userId: ADMIN, tenantId: T, role: "Admin", tokenVersion: 1 }, process.env.JWT_SECRET!, { expiresIn: "1h" }))
  storage.setItem("lebanonpos.tenant-id.v1", T)
})

afterAll(async () => {
  await dispose()
  if (process.env.CAFE_DEVICE_EVIDENCE) (await import("node:fs")).writeFileSync(process.env.CAFE_DEVICE_EVIDENCE, JSON.stringify(evidence, null, 2))
  const where = { tenantId: T }
  await prisma.stockMovement.deleteMany({ where })
  await prisma.syncOperation.deleteMany({ where })
  await prisma.sale.deleteMany({ where })
  await prisma.shift.deleteMany({ where })
  await prisma.inventoryBatch.deleteMany({ where })
  await prisma.auditEvent.deleteMany({ where })
  await prisma.product.deleteMany({ where })
  await prisma.staffUser.deleteMany({ where })
  await prisma.tenant.deleteMany({ where: { id: T } })
  await new Promise<void>((r) => server.close(() => r()))
})

describe("café menu created on the till", () => {
  it("the till creates two drinks with no barcode and one packaged item with a barcode", async () => {
    const d = await device()
    for (const [name, barcode, stock] of [["Espresso", "", 0], ["Cappuccino", "", 0], ["Pepsi 330ml", `PEP-${T.slice(0, 6)}`, 24]] as const) {
      const p = d.product.createProduct({ name, barcode, price: name === "Pepsi 330ml" ? 1 : 1.5, cost: 0.4, stock, category: name === "Pepsi 330ml" ? "Drinks" : "Coffee" } as Parameters<typeof d.product.createProduct>[0])
      note(`createProduct ${name}`, p ? { id: p.id, barcode: p.barcode } : "refused")
      expect(p).toBeDefined()
    }
    await flush(d)
    note("queue after flush", queue().map((o) => ({ s: o.summary, status: o.status, error: o.error?.slice(0, 120) })))
    note("server products", (await prisma.product.findMany({ where: { tenantId: T }, select: { name: true, barcode: true, stock: true } })))
  })

  it.fails("CONFIRMED DEFECT: both barcode-less drinks reach the server", async () => {
    expect(await prisma.product.count({ where: { tenantId: T, name: { in: ["Espresso", "Cappuccino"] } } })).toBe(2)
  })
})

describe("one café order: drink + scanned packaged item", () => {
  it("the cashier opens a shift (attributed to the cashier on the device)", async () => {
    const d = await device()
    storage.setItem("lebanonpos.current-user.v1", CASHIER)
    // The device unlock records the session; set the session as unlocked for the cashier.
    d.security.setCurrentUser(CASHIER)
    d.security.openShift(50)
    await flush(d)
    const shift = await prisma.shift.findFirst({ where: { tenantId: T } })
    note("server shift", shift ? { openedById: shift.openedById, openedByName: shift.openedByName } : null)
    expect(shift?.openedById).toBe(CASHIER)
  })

  it("adding an Espresso with stock 0: what the device does", async () => {
    const d = await device()
    const esp = localProducts().find((p) => p.name === "Espresso")!
    note("device espresso stock", esp.stock)
    let result: unknown
    try { result = d.sales.checkoutLocalSale(order(d, [{ name: "Espresso", qty: 1 }, { name: "Pepsi 330ml", qty: 1 }])) } catch (e) { result = { threw: (e as Error).message } }
    note("checkoutLocalSale espresso+pepsi", result && typeof result === "object" && "status" in (result as object) ? { status: (result as { status: string }).status } : result)
    await flush(d)
    const sales = queue().filter((o) => o.entity === "sale")
    note("sale ops after flush", sales.map((o) => ({ status: o.status, error: o.error?.slice(0, 160) })))
    note("server sales", await prisma.sale.count({ where: { tenantId: T } }))
  })

  it.fails("CONFIRMED DEFECT (café blocker): the drink + Pepsi order is recorded on the server", async () => {
    expect(await prisma.sale.count({ where: { tenantId: T } })).toBe(1)
  })

  it.fails("CONFIRMED DEFECT: the device sale carries the acting cashier's staff id (today only the display name)", async () => {
    const s = await prisma.sale.findFirst({ where: { tenantId: T } })
    const local = (JSON.parse(storage.getItem("lebanonpos.sales.v1") ?? "[]") as Array<{ cashierId?: string; cashier?: string }>)[0]
    note("local sale attribution", local ? { cashierId: local.cashierId === CASHIER ? "CASHIER" : local.cashierId, cashier: local.cashier } : null)
    note("server sale attribution", s ? { cashierId: s.cashierId === CASHIER ? "CASHIER" : s.cashierId } : "no server sale")
    expect(local?.cashierId).toBe(CASHIER)
  })
})
