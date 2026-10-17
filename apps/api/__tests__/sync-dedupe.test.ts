import { describe, it, expect, beforeAll, afterAll } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomUUID } from "node:crypto"
import jwt from "jsonwebtoken"

// SYNC-DEDUPE-2 (real Postgres, real handlers). Two servers in this process, each on its own
// database: a "hub" on the scratch database and a "cloud" on its cloud_it schema (migrated from
// the same history). The hub's cloud sync bridge forwards to the cloud over HTTP, as deployed.
// Under test:
//  - a lost response: the resend is acknowledged and nothing is applied twice;
//  - concurrent duplicates of one operation apply its effects once (sale, debt sale, debt
//    payment, stock adjustment, lot receive);
//  - a duplicate whose re-run would now fail never marks the applied operation failed or
//    rejected, and never stops its onward delivery;
//  - hub -> cloud forwarding: applied once on the cloud even when the forward is retried after a
//    lost acknowledgement or runs concurrently, and device resends after forwarding stay done.
process.env.JWT_SECRET = process.env.JWT_SECRET || "dedupe-secret"
delete process.env.IS_LOCAL_SERVER

const TENANT = randomUUID()
const ADMIN = randomUUID()
const DEVICE = `DD-${TENANT.slice(0, 8)}`
const CLOUD_KEY = `ck-${randomUUID()}`
const SYNC_ID = `dd-${TENANT.slice(0, 8)}`
const hubDbUrl = process.env.DATABASE_URL!
const cloudDbUrl = (() => { const u = new URL(hubDbUrl); u.searchParams.set("schema", "cloud_it"); return u.toString() })()

// ── cloud: its own modules and Prisma client, bound to the cloud schema ──
process.env.DATABASE_URL = cloudDbUrl
const cloudPrisma = (await import("../src/lib/prisma.js")).default
const cloudApp = (await import("../src/app.js")).default
const cloudServer = http.createServer(cloudApp)
await new Promise<void>((resolve) => cloudServer.listen(0, resolve))
const cloudUrl = `http://localhost:${(cloudServer.address() as AddressInfo).port}`

// ── hub: fresh modules bound to the scratch database, its bridge pointed at the cloud ──
const { vi } = await import("vitest")
vi.resetModules()
process.env.DATABASE_URL = hubDbUrl
process.env.CLOUD_API_URL = cloudUrl
process.env.CLOUD_TENANT_ID = TENANT
process.env.CLOUD_API_KEY = CLOUD_KEY
const prisma = (await import("../src/lib/prisma.js")).default
const hubApp = (await import("../src/app.js")).default
const bridge = await import("../src/services/cloudSync.js")
// The app loads apps/api/.env on import (a dev hub sets IS_LOCAL_SERVER): both servers here run
// in cloud mode, so the bridge (which sends no device id) is accepted. Device approval is covered
// by the hub suites.
delete process.env.IS_LOCAL_SERVER

let hubServer: http.Server
let hubUrl = ""
let token = ""
let productId = 0
let cloudProductId = 0
let customerId = ""

async function pushTo(base: string, op: { id: string; entity: string; action: string; payload: unknown }, headers: Record<string, string>, deviceId?: string) {
  const res = await fetch(`${base}/api/sync/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ deviceId, operations: [op] }),
  })
  const body = (await res.json()) as { results?: Array<{ id: string; status: string; error?: string }> }
  if (!body.results) throw new Error(`push refused: HTTP ${res.status} ${JSON.stringify(body).slice(0, 200)}`)
  return body.results[0]
}
const push = (op: { id: string; entity: string; action: string; payload: unknown }) => pushTo(hubUrl, op, { Authorization: `Bearer ${token}` }, DEVICE)
const pushCloudAsBridge = (op: { id: string; entity: string; action: string; payload: unknown }) =>
  pushTo(cloudUrl, op, { "x-cloud-key": CLOUD_KEY, "x-tenant-id": TENANT })

const hubStock = async () => Number((await prisma.product.findUnique({ where: { id: productId } }))!.stock)
const cloudStock = async () => Number((await cloudPrisma.product.findUnique({ where: { id: cloudProductId } }))!.stock)
const opRow = (id: string) => prisma.syncOperation.findUnique({ where: { id } })
const balance = async (db: typeof prisma, customer: string) => {
  const debts = await db.debtSale.findMany({ where: { tenantId: TENANT, customerId: customer } })
  const pays = await db.debtPayment.findMany({ where: { tenantId: TENANT, customerId: customer } })
  return debts.reduce((s, d) => s + Number(d.total), 0) - pays.reduce((s, p) => s + Number(p.amount), 0)
}

function saleOp(qty: number, extra: Record<string, unknown> = {}) {
  const id = randomUUID()
  return {
    id: randomUUID(), entity: "sale", action: "create",
    payload: {
      id, saleNumber: `S-DD-${id.slice(0, 6)}`, paymentMethod: "Cash", subtotal: qty * 5, tax: 0, total: qty * 5, cost: qty * 2, profit: qty * 3,
      cashier: "IT", status: "Completed",
      items: [{ id: productId, productSyncId: SYNC_ID, lineId: randomUUID(), name: "Dedupe widget", barcode: SYNC_ID, quantity: qty, unitPrice: 5, total: qty * 5, cost: 2, batchAllocations: [] }],
      ...extra,
    },
  }
}
const debtOp = (total: number) => ({ id: randomUUID(), entity: "debt", action: "create", payload: { id: randomUUID(), customerId, saleNumber: `S-DEBT-${randomUUID().slice(0, 6)}`, subtotal: total, discountTotal: 0, tax: 0, total, items: [], createdAt: new Date().toISOString() } })
const payOp = (amount: number) => ({ id: randomUUID(), entity: "debt", action: "payment", payload: { id: randomUUID(), customerId, amount, method: "Cash", reference: `PAY-${randomUUID().slice(0, 6)}`, createdAt: new Date().toISOString() } })

beforeAll(async () => {
  hubServer = http.createServer(hubApp)
  await new Promise<void>((resolve) => hubServer.listen(0, resolve))
  hubUrl = `http://localhost:${(hubServer.address() as AddressInfo).port}`
  for (const db of [prisma, cloudPrisma]) {
    await db.tenant.create({ data: { id: TENANT, name: "Dedupe IT (disposable)", subdomain: `dd-${TENANT.slice(0, 8)}`, cloudApiKey: CLOUD_KEY } })
  }
  await prisma.staffUser.create({ data: { id: ADMIN, tenantId: TENANT, name: "IT", mobile: `dd-${TENANT.slice(0, 6)}`, pin: "x", role: "Admin" } })
  await prisma.device.create({ data: { tenantId: TENANT, deviceId: DEVICE, deviceName: DEVICE, status: "APPROVED" } })
  token = jwt.sign({ userId: ADMIN, tenantId: TENANT, role: "Admin" }, process.env.JWT_SECRET!, { expiresIn: "1h" })
  productId = (await prisma.product.create({ data: { tenantId: TENANT, syncId: SYNC_ID, name: "Dedupe widget", price: 5, cost: 2, stock: 100, barcode: SYNC_ID, category: "Test" } })).id
  // The cloud's copy of the same product (same syncId, its own numeric id).
  await cloudPrisma.product.create({ data: { tenantId: TENANT, name: "Filler", price: 1, cost: 1, stock: 0, barcode: `${SYNC_ID}-f`, category: "Test" } })
  cloudProductId = (await cloudPrisma.product.create({ data: { tenantId: TENANT, syncId: SYNC_ID, name: "Dedupe widget", price: 5, cost: 2, stock: 100, barcode: SYNC_ID, category: "Test" } })).id
  customerId = randomUUID()
  for (const db of [prisma, cloudPrisma]) {
    await db.customer.create({ data: { id: customerId, tenantId: TENANT, name: "Nour", mobile: `dd-${randomUUID().slice(0, 8)}`, creditLimit: 1000 } })
  }
})

afterAll(async () => {
  for (const db of [prisma, cloudPrisma]) {
    const where = { tenantId: TENANT }
    await db.stockMovement.deleteMany({ where })
    await db.saleItem.deleteMany({ where }).catch(() => undefined)
    await db.saleTender?.deleteMany({ where }).catch(() => undefined)
    await db.sale.deleteMany({ where })
    await db.debtPayment.deleteMany({ where })
    await db.debtSale.deleteMany({ where })
    await db.stockAdjustment.deleteMany({ where })
    await db.inventoryBatch.deleteMany({ where })
    await db.syncOperation.deleteMany({ where })
    await db.auditEvent.deleteMany({ where }).catch(() => undefined)
    await db.customer.deleteMany({ where })
    await db.product.deleteMany({ where })
    await db.device.deleteMany({ where }).catch(() => undefined)
    await db.staffUser.deleteMany({ where }).catch(() => undefined)
    await db.tenant.deleteMany({ where: { id: TENANT } }).catch(() => undefined)
  }
  await new Promise<void>((resolve) => hubServer.close(() => resolve()))
  await new Promise<void>((resolve) => cloudServer.close(() => resolve()))
  await prisma.$disconnect()
  await cloudPrisma.$disconnect()
})

describe("applied once on this server (real Postgres)", () => {
  it("a lost response: the resend is acknowledged and nothing is applied twice", async () => {
    const before = await hubStock()
    const sale = saleOp(3)
    expect((await push(sale)).status).toBe("ok")
    expect((await push(sale)).status).toBe("ok") // the device never saw the first answer
    expect(await hubStock()).toBe(before - 3)
    expect(await prisma.sale.count({ where: { tenantId: TENANT, id: sale.payload.id } })).toBe(1)
    expect(await prisma.stockMovement.count({ where: { tenantId: TENANT, productId, type: "Sale", reference: sale.payload.saleNumber } })).toBeLessThanOrEqual(1)
    const row = await opRow(sale.id)
    expect(row?.appliedAt).toBeTruthy()
    expect(row?.status).toBe("Pending") // still to be forwarded

    const bal0 = await balance(prisma, customerId)
    const debt = debtOp(40)
    const pay = payOp(15)
    for (const op of [debt, debt, pay, pay, pay]) expect((await push(op)).status).toBe("ok")
    expect(await balance(prisma, customerId)).toBe(bal0 + 40 - 15)
  })

  it("concurrent duplicates apply their effects once", async () => {
    const before = await hubStock()
    const sale = saleOp(2)
    const results = await Promise.all(Array.from({ length: 6 }, () => push(sale)))
    expect(results.every((r) => r.status === "ok")).toBe(true)
    expect(await hubStock()).toBe(before - 2)
    expect(await prisma.sale.count({ where: { tenantId: TENANT, id: sale.payload.id } })).toBe(1)
    // The operation stays forwardable: a losing duplicate never rewrites its row as failed.
    expect(await opRow(sale.id)).toMatchObject({ status: "Pending", error: null })

    const bal0 = await balance(prisma, customerId)
    const debt = debtOp(25)
    const pay = payOp(10)
    await Promise.all([...Array.from({ length: 4 }, () => push(debt)), ...Array.from({ length: 4 }, () => push(pay))])
    expect(await balance(prisma, customerId)).toBe(bal0 + 25 - 10)
    expect(await prisma.debtPayment.count({ where: { tenantId: TENANT, id: pay.payload.id } })).toBe(1)

    // Stock adjustment and lot receive: their own record ids anchor them, and the operation claim
    // makes concurrent copies wait for each other.
    const s1 = await hubStock()
    const adj = { id: randomUUID(), entity: "inventory", action: "adjust", payload: { id: randomUUID(), adjustmentNumber: "ADJ-DD-1", productId, productSyncId: SYNC_ID, productName: "Dedupe widget", barcode: SYNC_ID, quantityBefore: s1, quantityChange: 7, quantityAfter: s1 + 7, reason: "Count Correction", valueImpact: 14, createdAt: new Date().toISOString() } }
    const lot = { id: randomUUID(), entity: "inventory", action: "receive", payload: [{ id: randomUUID(), batchNumber: "LOT-DD-1", productId, productSyncId: SYNC_ID, productName: "Dedupe widget", barcode: SYNC_ID, initialQuantity: 5, quantityRemaining: 5, unitCost: 2, unitPrice: 5, receivedAt: new Date().toISOString(), status: "Open" }] }
    await Promise.all([...Array.from({ length: 4 }, () => push(adj)), ...Array.from({ length: 4 }, () => push(lot))])
    expect(await hubStock()).toBe(s1 + 7 + 5)
    expect(await prisma.inventoryBatch.count({ where: { tenantId: TENANT, id: lot.payload[0].id } })).toBe(1)
    expect(await prisma.stockAdjustment.count({ where: { tenantId: TENANT, id: adj.payload.id } })).toBe(1)
  })

  it("a duplicate whose re-run would now fail never marks the applied operation failed, and keeps it forwardable", async () => {
    await prisma.product.update({ where: { id: productId }, data: { stock: 4 } })
    const sale = saleOp(4)
    expect((await push(sale)).status).toBe("ok") // stock 4 -> 0
    // Re-running it now would throw "Insufficient stock" (and used to mark the row Rejected).
    const again = await push(sale)
    expect(again).toMatchObject({ status: "ok" })
    expect(await hubStock()).toBe(0)
    const row = await opRow(sale.id)
    expect(row).toMatchObject({ status: "Pending", error: null })
    expect(row?.appliedAt).toBeTruthy()
    await prisma.product.update({ where: { id: productId }, data: { stock: 100 } })
  })
})

describe("an operation id names one change (real Postgres)", () => {
  it("reusing an id for a different entity, action or payload is rejected, never acknowledged as the original", async () => {
    const before = await hubStock()
    const sale = saleOp(1)
    expect((await push(sale)).status).toBe("ok")
    expect(await hubStock()).toBe(before - 1)

    // Same id, same change, keys in another order: still the original (acknowledged, no effect).
    const reordered = { id: sale.id, entity: "sale", action: "create", payload: Object.fromEntries(Object.entries(sale.payload).reverse()) }
    expect((await push(reordered)).status).toBe("ok")

    const otherPayload = { ...sale, payload: { ...sale.payload, total: 999 } }
    const otherAction = { ...sale, action: "void" }
    const otherEntity = { ...sale, entity: "expense", payload: { id: randomUUID(), amount: 5 } }
    for (const reused of [otherPayload, otherAction, otherEntity]) {
      const r = await push(reused)
      expect(r.status).toBe("rejected")
      expect(r.error).toMatch(/OPERATION_ID_REUSED/)
    }
    expect(await hubStock()).toBe(before - 1)
    expect(await prisma.expense.count({ where: { tenantId: TENANT } })).toBe(0)
    const row = await opRow(sale.id)
    expect(row).toMatchObject({ entity: "sale", action: "create", status: "Pending", error: null }) // the original row untouched
    expect(row?.appliedAt).toBeTruthy()

    // Another store using the same id is refused too (and changes nothing here).
    const otherTenant = randomUUID()
    await prisma.tenant.create({ data: { id: otherTenant, name: "Dedupe IT other (disposable)", subdomain: `dd-o-${otherTenant.slice(0, 8)}` } })
    const otherToken = jwt.sign({ userId: ADMIN, tenantId: otherTenant, role: "Admin" }, process.env.JWT_SECRET!, { expiresIn: "1h" })
    const r = await pushTo(hubUrl, sale, { Authorization: `Bearer ${otherToken}` })
    expect(r.status).toBe("rejected")
    expect((await opRow(sale.id))?.tenantId).toBe(TENANT)
    await prisma.syncOperation.deleteMany({ where: { tenantId: otherTenant } })
    await prisma.auditEvent.deleteMany({ where: { tenantId: otherTenant } }).catch(() => undefined)
    await prisma.tenant.delete({ where: { id: otherTenant } })
  })

  it("a failed attempt's id cannot be reused for a different change either", async () => {
    await prisma.product.update({ where: { id: productId }, data: { stock: 1 } })
    const tooMuch = saleOp(5) // fails: insufficient stock
    expect((await push(tooMuch)).status).not.toBe("ok")
    const swapped = { ...tooMuch, payload: { ...tooMuch.payload, total: 1, items: [{ ...tooMuch.payload.items[0], quantity: 1, total: 5 }] } }
    const r = await push(swapped)
    expect(r.status).toBe("rejected")
    expect(r.error).toMatch(/OPERATION_ID_REUSED/)
    expect(await hubStock()).toBe(1)
    await prisma.product.update({ where: { id: productId }, data: { stock: 100 } })
  })
})

describe("hub -> cloud forwarding (two real servers, two databases)", () => {
  it("forwards applied operations once, even after a lost acknowledgement, concurrently, and with device resends", async () => {
    // Bring the cloud copy level with the hub before measuring.
    await bridge.pushToCloudOnce()
    await cloudPrisma.product.update({ where: { id: cloudProductId }, data: { stock: 100 } })
    await prisma.product.update({ where: { id: productId }, data: { stock: 100 } })

    const a = saleOp(2)
    const b = saleOp(3)
    expect((await push(a)).status).toBe("ok")
    expect((await push(b)).status).toBe("ok")
    expect(await hubStock()).toBe(95)

    // b already reached the cloud once, but the bridge never saw the acknowledgement.
    expect((await pushCloudAsBridge(b)).status).toBe("ok")
    expect(await cloudStock()).toBe(97)

    // The bridge forwards both, twice at once, while the device resends a to the hub.
    await Promise.all([bridge.pushToCloudOnce(), bridge.pushToCloudOnce(), push(a)])
    await bridge.pushToCloudOnce()
    expect(await cloudStock()).toBe(95) // a once, b once
    expect(await cloudPrisma.sale.count({ where: { tenantId: TENANT, id: { in: [a.payload.id, b.payload.id] } } })).toBe(2)
    expect((await opRow(a.id))?.status).toBe("Synced")
    expect((await opRow(b.id))?.status).toBe("Synced")

    // After forwarding, a device resend to the hub is acknowledged and changes nothing.
    expect((await push(a)).status).toBe("ok")
    expect((await opRow(a.id))?.status).toBe("Synced")
    expect(await hubStock()).toBe(95)
    await bridge.pushToCloudOnce()
    expect(await cloudStock()).toBe(95)

    // Money too: a debt sale and payment reach the cloud once.
    const cb0 = await balance(cloudPrisma, customerId)
    const debt = debtOp(60)
    const pay = payOp(20)
    await push(debt); await push(pay); await push(pay)
    await pushCloudAsBridge(pay) // forwarded once already, acknowledgement lost
    await Promise.all([bridge.pushToCloudOnce(), bridge.pushToCloudOnce()])
    expect(await balance(cloudPrisma, customerId)).toBe(cb0 + 60 - 20)
    expect(await balance(prisma, customerId)).toBe(await balance(cloudPrisma, customerId))
  })
})
