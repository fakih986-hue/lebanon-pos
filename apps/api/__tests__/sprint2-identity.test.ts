import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomUUID } from "node:crypto"

// SPRINT-2 identity probes (real Postgres, real handlers). `it.fails` marks a CONFIRMED DEFECT that is
// not fixed yet: it passes while the defect exists and turns red once fixed (then flip it to `it`).
// Each probe uses only public endpoints a real client can reach.
process.env.JWT_SECRET = process.env.JWT_SECRET || "sprint2-identity-secret"
const prisma = (await import("../src/lib/prisma.js")).default
const app = (await import("../src/app.js")).default
const bcrypt = (await import("bcryptjs")).default
delete process.env.IS_LOCAL_SERVER
vi.setConfig({ testTimeout: 60_000 })

const T = randomUUID()
const SUB = `s2-${T.slice(0, 8)}`
let server: http.Server
let base = ""
let customerToken = ""
let productSyncId = ""

const post = async (path: string, body: unknown, token?: string) => {
  const r = await fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "x-titan-sync-schema": "3", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })
  return { status: r.status, body: (await r.json().catch(() => null)) as any }
}

beforeAll(async () => {
  server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, resolve))
  base = `http://localhost:${(server.address() as AddressInfo).port}`
  await prisma.tenant.create({ data: { id: T, name: "Sprint 2 identity probes (disposable)", subdomain: SUB } })
  await prisma.staffUser.create({ data: { tenantId: T, name: "Owner", mobile: `s2-o-${T.slice(0, 6)}`, pin: await bcrypt.hash("9101", 12), role: "Admin" } })
  productSyncId = randomUUID()
  await prisma.product.create({ data: { tenantId: T, syncId: productSyncId, name: "Latte", price: 3, cost: 1, stock: 0, category: "Coffee" } })
  // anyone can sign up as a customer of a store (ordering app): no staff involvement
  const mobile = `7${Date.now().toString().slice(-7)}`
  expect((await post("/api/delivery/customer/signup", { tenantId: T, name: "Walk-in", mobile, pin: "4321" })).status).toBe(201)
  const login = await post("/api/delivery/customer/login", { tenantId: T, mobile, pin: "4321" })
  customerToken = login.body?.token ?? ""
  expect(customerToken).not.toBe("")
})

afterAll(async () => {
  const where = { tenantId: T }
  await prisma.syncOperation.deleteMany({ where })
  await prisma.syncClient.deleteMany({ where })
  await prisma.auditEvent.deleteMany({ where }).catch(() => undefined)
  await prisma.stockAdjustment.deleteMany({ where }).catch(() => undefined)
  await prisma.stockMovement.deleteMany({ where }).catch(() => undefined)
  await prisma.product.deleteMany({ where })
  await prisma.customer.deleteMany({ where })
  await prisma.staffUser.deleteMany({ where })
  await prisma.tenant.deleteMany({ where: { id: T } })
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await prisma.$disconnect()
})

describe("token kinds: a customer token is not a staff credential (fixed in Sprint 2 phase B)", () => {
  it("an ordering-app customer token cannot change a product's price through till sync", async () => {
    const r = await post("/api/sync/push", { deviceId: "customer-phone", operations: [{ id: randomUUID(), entity: "product", action: "update", payload: { syncId: productSyncId, price: 0.01 } }] }, customerToken)
    const price = Number((await prisma.product.findFirst({ where: { tenantId: T, syncId: productSyncId } }))!.price)
    expect(r.body?.results?.[0]?.status).not.toBe("ok")
    expect(price).toBe(3)
  })

  it("an ordering-app customer token is not accepted by the till's sync push at all", async () => {
    const r = await post("/api/sync/push", { deviceId: "customer-phone", operations: [] }, customerToken)
    expect(r.status).toBe(401)
  })

  it("a refused customer push leaves no upgrade-gate record (it cannot block stock-setting changes)", async () => {
    await fetch(`${base}/api/sync/push`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${customerToken}` }, body: JSON.stringify({ deviceId: "customer-phone-legacy", operations: [] }) })
    expect(await prisma.syncClient.count({ where: { tenantId: T } })).toBe(0)
  })

  it("a staff token of another store is refused by this store's sync (tenant comes from the token, staff must belong to it)", async () => {
    const other = randomUUID()
    await prisma.tenant.create({ data: { id: other, name: "other (disposable)", subdomain: `s2o-${other.slice(0, 8)}` } })
    const staff = await prisma.staffUser.create({ data: { tenantId: other, name: "Other owner", mobile: `s2x-${other.slice(0, 6)}`, pin: "x", role: "Admin" } })
    const jwt = (await import("jsonwebtoken")).default
    const forged = jwt.sign({ userId: staff.id, tenantId: T, role: "Admin" }, process.env.JWT_SECRET!, { expiresIn: "1h" })
    const r = await post("/api/sync/push", { deviceId: "x", operations: [{ id: randomUUID(), entity: "product", action: "update", payload: { syncId: productSyncId, price: 0.02 } }] }, forged)
    expect(r.status).toBe(401)
    await prisma.staffUser.deleteMany({ where: { tenantId: other } }); await prisma.tenant.delete({ where: { id: other } })
  })
})

describe("authorization matrix gaps (Sprint 2 phase B/C)", () => {
  it.fails("CONFIRMED DEFECT: a delivery driver (only delivery.manage) cannot adjust stock through till sync", async () => {
    const driver = await prisma.staffUser.create({ data: { tenantId: T, name: "Driver", mobile: `s2-d-${T.slice(0, 6)}`, pin: "x", role: "Driver", code: `D${T.slice(0, 4)}` } as any })
    const jwt = (await import("jsonwebtoken")).default
    const token = jwt.sign({ userId: driver.id, tenantId: T, role: "Driver" }, process.env.JWT_SECRET!, { expiresIn: "1h" })
    const p = (await prisma.product.findFirst({ where: { tenantId: T, syncId: productSyncId } }))!
    const r = await post("/api/sync/push", { deviceId: "driver-phone", operations: [{ id: randomUUID(), entity: "inventory", action: "adjust", payload: { id: randomUUID(), adjustmentNumber: "ADJ-S2-1", productId: p.id, productSyncId, productName: "Latte", barcode: "", quantityBefore: 0, quantityChange: 50, quantityAfter: 50, reason: "Count Correction", valueImpact: 50, createdAt: new Date().toISOString() } }] }, token)
    expect(r.body?.results?.[0]?.status).not.toBe("ok")
  })
})
