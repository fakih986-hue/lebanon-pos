import { describe, it, expect, beforeAll, afterAll } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomUUID } from "node:crypto"
import jwt from "jsonwebtoken"

// DURABILITY-2 end to end (real Postgres, real handlers, real device services). The desktop's own
// services (apps/desktop/src) run here against an in-memory localStorage and push to this API over
// HTTP exactly as on a till. Storage failures and lost responses are injected; a device restart is
// a fresh import of the device modules (vi.resetModules) with storage kept. Assertions compare the
// device's numbers with the server's rows: stock, lots, sales, debt balances.
process.env.JWT_SECRET = process.env.JWT_SECRET || "device-durability-secret"

// ── a minimal browser for the device services ──
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
g.window = globalThis
g.addEventListener = events.addEventListener.bind(events)
g.removeEventListener = events.removeEventListener.bind(events)
g.dispatchEvent = events.dispatchEvent.bind(events)
/** Make device writes to some keys fail (each after N successful writes). */
function failKeys(rules: Record<string, number>) {
  const seen: Record<string, number> = {}
  const original = MemoryStorage.prototype.setItem
  storage.setItem = function (k: string, v: string) {
    if (k in rules && (seen[k] = (seen[k] ?? 0) + 1) > rules[k]) throw new Error("QuotaExceededError")
    return original.call(this, k, v)
  }
  return { restore: () => { storage.setItem = original } }
}

const prisma = (await import("../src/lib/prisma.js")).default
const app = (await import("../src/app.js")).default
const { vi } = await import("vitest")
// The app loads apps/api/.env (a dev hub sets IS_LOCAL_SERVER): run in cloud mode (no device pairing).
delete process.env.IS_LOCAL_SERVER

let server: http.Server
let baseUrl = ""
const TENANT = randomUUID()
const OTHER = randomUUID()
const ADMIN = randomUUID()
const SYNC_ID = `dv-${TENANT.slice(0, 8)}`
let productId = 0
let customerId = ""

// The network: real HTTP to the API; in "lose" mode the server receives and applies the push, but
// its answer never reaches the device.
let lose = false
const realFetch = globalThis.fetch
g.fetch = (async (url: string, init?: RequestInit) => {
  const res = await realFetch(url, init)
  if (lose && String(url).includes("/api/sync/push")) { await res.text(); throw new Error("connection reset: response lost") }
  return res
}) as typeof fetch

const token = (tenantId: string) => jwt.sign({ userId: ADMIN, tenantId, role: "Admin" }, process.env.JWT_SECRET!, { expiresIn: "1h" })
async function device() {
  return {
    sync: await import("../../desktop/src/features/pos/services/sync.service.js"),
    sales: await import("../../desktop/src/features/pos/services/sales.service.js"),
    security: await import("../../desktop/src/features/pos/services/security.service.js"),
    batches: await import("../../desktop/src/features/pos/services/inventoryBatch.service.js"),
    customer: await import("../../desktop/src/features/pos/services/customer.service.js"),
    journal: await import("../../desktop/src/features/pos/services/businessJournal.service.js"),
  }
}
type Device = Awaited<ReturnType<typeof device>>
async function restart(): Promise<Device> {
  vi.resetModules()
  const d = await device()
  d.sync.recoverStagedSyncOperations() // startup recovery (journal first)
  return d
}
async function flush(d: Device) {
  for (let i = 0; i < 4; i++) {
    // let failed attempts be retried at once (the device's backoff is time-based)
    const q = JSON.parse(storage.getItem("lebanonpos.sync-queue.v1") ?? "[]") as Array<Record<string, unknown>>
    storage.setItem("lebanonpos.sync-queue.v1", JSON.stringify(q.map((op) => ({ ...op, lastAttemptAt: "2000-01-01T00:00:00.000Z" }))))
    await d.sync.flushSyncQueue()
  }
}
const serverStock = async () => Number((await prisma.product.findUnique({ where: { id: productId } }))!.stock)
const deviceStock = () => (JSON.parse(storage.getItem("lebanonpos.products.v1") ?? "[]") as Array<{ id: number; stock: number }>).find((p) => p.id === productId)!.stock
async function serverBalance() {
  const debts = await prisma.debtSale.findMany({ where: { tenantId: TENANT, customerId } })
  const pays = await prisma.debtPayment.findMany({ where: { tenantId: TENANT, customerId } })
  return debts.reduce((s, x) => s + Number(x.total), 0) - pays.reduce((s, x) => s + Number(x.amount), 0)
}
const deviceBalance = (d: Device) => d.customer.getCustomerLedger().find((c) => c.id === customerId)?.balance ?? 0
const pendingOps = () => (JSON.parse(storage.getItem("lebanonpos.sync-queue.v1") ?? "[]") as Array<{ status: string; staged?: boolean }>).filter((o) => o.status !== "Synced")

async function cart(d: Device, qty: number, debt: boolean) {
  const lotsIn = [{ productId, productName: "Durable widget", barcode: SYNC_ID, quantity: qty, fallbackUnitCost: 2 }]
  const alloc = d.batches.consumeInventoryBatches(lotsIn, { dryRun: true }).get(productId) ?? []
  const id = randomUUID()
  const sale = d.sales.buildSale({
    saleNumber: `S-DV-${id.slice(0, 6)}`, paymentMethod: debt ? "Debt" : "Cash", subtotal: qty * 5, tax: 0, total: qty * 5,
    customerId: debt ? customerId : undefined, customerName: debt ? "Nour" : undefined,
    items: [{ id: productId, productSyncId: SYNC_ID, name: "Durable widget", barcode: SYNC_ID, cost: 2, quantity: qty, unitPrice: 5, total: qty * 5, batchAllocations: alloc }],
  } as Parameters<typeof d.sales.buildSale>[0], id)
  return {
    sale, lots: lotsIn, stock: [{ productId, quantity: qty }],
    debt: debt ? { customerId, saleNumber: sale.saleNumber, subtotal: qty * 5, discountTotal: 0, tax: 0, total: qty * 5, items: [] } : undefined,
  }
}

beforeAll(async () => {
  server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, resolve))
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`
  for (const t of [TENANT, OTHER]) await prisma.tenant.create({ data: { id: t, name: "Device durability IT (disposable)", subdomain: `dv-${t.slice(0, 8)}` } })
  await prisma.staffUser.create({ data: { id: ADMIN, tenantId: TENANT, name: "IT", mobile: `dv-${TENANT.slice(0, 6)}`, pin: "x", role: "Admin" } })
  productId = (await prisma.product.create({ data: { tenantId: TENANT, syncId: SYNC_ID, name: "Durable widget", price: 5, cost: 2, stock: 50, barcode: SYNC_ID, category: "Test" } })).id
  // The same lot on both sides (the server decrements the lots a sale names).
  await prisma.inventoryBatch.create({ data: { id: `lot-${SYNC_ID}`, tenantId: TENANT, batchNumber: "L1", productId, productName: "Durable widget", barcode: SYNC_ID, initialQuantity: 50, quantityRemaining: 50, unitCost: 2, unitPrice: 5, receivedAt: new Date("2026-01-01T00:00:00.000Z"), status: "Open" } as any })
  customerId = (await prisma.customer.create({ data: { tenantId: TENANT, name: "Nour", mobile: `dv-${randomUUID().slice(0, 8)}`, creditLimit: 1000 } })).id

  // The device: same product (id + syncId) and customer, one lot of 50, signed in to TENANT.
  storage.setItem("lebanonpos.users.v1", JSON.stringify([{ id: ADMIN, name: "IT", role: "Admin", pin: "HASH", code: "IT", active: true, permissions: [] }]))
  storage.setItem("lebanonpos.current-user.v1", ADMIN)
  storage.setItem("lebanonpos.products.v1", JSON.stringify([{ id: productId, syncId: SYNC_ID, name: "Durable widget", barcode: SYNC_ID, price: 5, cost: 2, stock: 50, category: "Test" }]))
  storage.setItem("lebanonpos.inventory-batches.v1", JSON.stringify([{ id: `lot-${SYNC_ID}`, batchNumber: "L1", productId, productName: "Durable widget", barcode: SYNC_ID, initialQuantity: 50, quantityRemaining: 50, unitCost: 2, unitPrice: 5, receivedAt: "2026-01-01T00:00:00.000Z", status: "Open" }]))
  storage.setItem("lebanonpos.customers.v1", JSON.stringify([{ id: customerId, name: "Nour", mobile: "1", creditLimit: 1000, createdAt: "2026-01-01T00:00:00.000Z" }]))
  storage.setItem("lebanonpos.api-url", baseUrl)
  storage.setItem("lebanonpos.auth-token", token(TENANT))
  storage.setItem("lebanonpos.tenant-id.v1", TENANT)
  const d = await device()
  d.security.openShift(100)
  await flush(d)
})

afterAll(async () => {
  for (const t of [TENANT, OTHER]) {
    const where = { tenantId: t }
    await prisma.stockMovement.deleteMany({ where })
    await prisma.saleItem.deleteMany({ where }).catch(() => undefined)
    await prisma.saleTender?.deleteMany({ where }).catch(() => undefined)
    await prisma.sale.deleteMany({ where })
    await prisma.debtPayment.deleteMany({ where })
    await prisma.debtSale.deleteMany({ where })
    await prisma.inventoryBatch.deleteMany({ where })
    await prisma.syncOperation.deleteMany({ where })
    await prisma.auditEvent.deleteMany({ where }).catch(() => undefined)
    await prisma.shift.deleteMany({ where }).catch(() => undefined)
    await prisma.customer.deleteMany({ where })
    await prisma.product.deleteMany({ where })
    await prisma.staffUser.deleteMany({ where }).catch(() => undefined)
    await prisma.tenant.deleteMany({ where: { id: t } }).catch(() => undefined)
  }
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await prisma.$disconnect()
})

describe("device -> real server (Postgres)", () => {
  it("a debt checkout reaches the server once, with lost responses on the way", async () => {
    const d = await device()
    const s0 = await serverStock()
    const b0 = await serverBalance()
    const c = await cart(d, 3, true)
    expect(d.sales.checkoutLocalSale(c).status).toBe("completed")
    lose = true
    await flush(d) // the server applies everything; the device hears nothing
    lose = false
    expect(pendingOps().length).toBeGreaterThan(0) // still queued: uncertain, never assumed
    await flush(d) // resent: acknowledged as already applied
    expect(pendingOps()).toEqual([])
    expect(await serverStock()).toBe(s0 - 3)
    expect(deviceStock()).toBe(await serverStock())
    expect(await prisma.sale.count({ where: { tenantId: TENANT, id: c.sale.id } })).toBe(1)
    expect(await serverBalance()).toBe(b0 + 15)
    expect(deviceBalance(d)).toBe(await serverBalance())
  })

  it("a checkout interrupted after its commit point is completed (next flush or restart) and reaches the server once", async () => {
    let d = await device()
    const s0 = await serverStock()
    const c = await cart(d, 4, true)
    const f = failKeys({ "lebanonpos.products.v1": 0 })
    expect(d.sales.checkoutLocalSale(c).status).toBe("blocked") // the sale stands; stock pending
    f.restore()
    // Held by its journal while storage fails; the next flush (storage working again) settles the
    // journal first — stock decreased once — and only then sends the sale.
    await flush(d)
    expect(deviceStock()).toBe(s0 - 4)

    // A restart afterwards changes nothing.
    d = await restart()
    await flush(d)
    expect(await prisma.sale.count({ where: { tenantId: TENANT, id: c.sale.id } })).toBe(1)
    expect(await serverStock()).toBe(s0 - 4)
    expect(deviceStock()).toBe(await serverStock())
    expect(deviceBalance(d)).toBe(await serverBalance())
  })

  it("a checkout interrupted before its commit point leaves no trace on either side", async () => {
    const d = await device()
    const s0 = await serverStock()
    const lots0 = storage.getItem("lebanonpos.inventory-batches.v1")
    const c = await cart(d, 2, false)
    const f = failKeys({ "lebanonpos.sales.v1": 0 })
    expect(() => d.sales.checkoutLocalSale(c)).toThrow()
    f.restore()
    await flush(d)
    expect(await prisma.sale.count({ where: { tenantId: TENANT, id: c.sale.id } })).toBe(0)
    expect(await serverStock()).toBe(s0)
    expect(deviceStock()).toBe(s0)
    expect(storage.getItem("lebanonpos.inventory-batches.v1")).toBe(lots0)
  })

  it("a debt sale voided with the stock write failing: completed, and the server ends voided, restocked and owed nothing for it", async () => {
    let d = await device()
    const c = await cart(d, 5, true)
    expect(d.sales.checkoutLocalSale(c).status).toBe("completed")
    await flush(d)
    const s1 = await serverStock()
    const b1 = await serverBalance()
    const f = failKeys({ "lebanonpos.products.v1": 0 })
    d.sales.voidSale(c.sale.id)
    f.restore()
    d = await restart()
    lose = true
    await flush(d)
    lose = false
    await flush(d)
    expect((await prisma.sale.findUnique({ where: { id: c.sale.id } }))?.status).toBe("Voided")
    expect(await serverStock()).toBe(s1 + 5)
    expect(deviceStock()).toBe(await serverStock())
    expect(await serverBalance()).toBe(b1 - 25)
    expect(deviceBalance(d)).toBe(await serverBalance())
  })

  it("a debt payment whose commit failed is released once after restart; retries and a store switch do not double it", async () => {
    let d = await device()
    const b0 = await serverBalance()
    const f = failKeys({ "lebanonpos.sync-queue.v1": 1 })
    d.customer.recordDebtPayment({ customerId, amount: 7, method: "Cash", reference: "DV-P1", id: `pay-${TENANT.slice(0, 6)}` })
    f.restore()
    d.customer.recordDebtPayment({ customerId, amount: 7, method: "Cash", reference: "DV-P1", id: `pay-${TENANT.slice(0, 6)}` }) // a double tap: same id

    // Switch to another store and back before restarting.
    await d.sync.clearStoreData()
    storage.setItem("lebanonpos.auth-token", token(OTHER)); storage.setItem("lebanonpos.tenant-id.v1", OTHER)
    d = await restart()
    expect(pendingOps()).toEqual([]) // nothing of the first store here
    await d.sync.clearStoreData()
    storage.setItem("lebanonpos.auth-token", token(TENANT)); storage.setItem("lebanonpos.tenant-id.v1", TENANT)
    d = await restart()
    d.sync.restoreStashedMoneyConflicts()
    lose = true
    await flush(d)
    lose = false
    await flush(d)
    expect(await serverBalance()).toBe(b0 - 7)
    expect(await prisma.debtPayment.count({ where: { tenantId: TENANT, id: `pay-${TENANT.slice(0, 6)}` } })).toBe(1)
  })
})
