import { describe, it, expect, beforeAll, afterAll } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomUUID } from "node:crypto"
import jwt from "jsonwebtoken"

// Mixed-version valuation and operation identity (real Postgres, real handlers; docs/LEGACY-TILL-COMPAT.md).
// A "hub" on the scratch database and a "cloud" on its cloud_it schema, in this process; the hub's
// bridge forwards over HTTP. An older hub (1.0.51 and before) is its cloud link pushing without the
// per-operation mark `ev.valued = "server"`, which is exactly what those releases send.
// Under test:
//  - a hub of this version forwards its own valuation, marked; the cloud keeps it (a manager's price too);
//  - an older hub's figures (forged or stale) never become the cloud's: the cloud values them itself;
//  - work an older hub queued before it was upgraded is forwarded unmarked and valued by the cloud;
//  - identity: exact resend, changed quantity, changed price, forged cost only, lost responses
//    (till -> hub and hub -> cloud), and an older hub re-forwarding with other figures.
process.env.JWT_SECRET = process.env.JWT_SECRET || "valuation-secret"
delete process.env.IS_LOCAL_SERVER

const TENANT = randomUUID()
const ADMIN = randomUUID()
const CLERK = randomUUID()
const DEVICE = `HV-${TENANT.slice(0, 8)}`
const CLOUD_KEY = `ck-${randomUUID()}`
const SYNC_ID = `hv-${TENANT.slice(0, 8)}`
const hubDbUrl = process.env.DATABASE_URL!
const cloudDbUrl = (() => { const u = new URL(hubDbUrl); u.searchParams.set("schema", "cloud_it"); return u.toString() })()

process.env.DATABASE_URL = cloudDbUrl
const cloudPrisma = (await import("../src/lib/prisma.js")).default
const cloudApp = (await import("../src/app.js")).default
const cloudServer = http.createServer(cloudApp)
await new Promise<void>((resolve) => cloudServer.listen(0, resolve))
const cloudUrl = `http://localhost:${(cloudServer.address() as AddressInfo).port}`

const { vi } = await import("vitest")
vi.resetModules()
process.env.DATABASE_URL = hubDbUrl
process.env.CLOUD_API_URL = cloudUrl
process.env.CLOUD_TENANT_ID = TENANT
process.env.CLOUD_API_KEY = CLOUD_KEY
const prisma = (await import("../src/lib/prisma.js")).default
const hubApp = (await import("../src/app.js")).default
const bridge = await import("../src/services/cloudSync.js")
delete process.env.IS_LOCAL_SERVER

let hubServer: http.Server
let hubUrl = ""
let adminToken = ""
let clerkToken = ""
let productId = 0
let cloudProductId = 0

type Op = { id: string; entity: string; action: string; payload: any; ev?: Record<string, unknown> }
async function pushTo(base: string, op: Op, headers: Record<string, string>, deviceId?: string) {
  const res = await fetch(`${base}/api/sync/push`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ deviceId, operations: [op] }) })
  const body = (await res.json()) as { results?: Array<{ id: string; status: string; error?: string }> }
  if (!body.results) throw new Error(`push refused: HTTP ${res.status} ${JSON.stringify(body).slice(0, 200)}`)
  return body.results[0]
}
const asClerk = (op: Op) => pushTo(hubUrl, op, { Authorization: `Bearer ${clerkToken}` }, DEVICE)
const asManager = (op: Op) => pushTo(hubUrl, op, { Authorization: `Bearer ${adminToken}` }, DEVICE)
/** What a 1.0.50/1.0.51 hub sends: its cloud key, the operation as its own database holds it, no valuation mark. */
const asOlderHub = (op: Op) => pushTo(cloudUrl, { id: op.id, entity: op.entity, action: op.action, payload: op.payload }, { "x-cloud-key": CLOUD_KEY, "x-tenant-id": TENANT, "x-titan-sync-schema": "2" })

const saleOp = (qty: number, lineCost: number, unitPrice = 5): Op => {
  const id = randomUUID()
  return {
    id: randomUUID(), entity: "sale", action: "create",
    payload: {
      id, saleNumber: `S-HV-${id.slice(0, 6)}`, paymentMethod: "Cash", subtotal: qty * unitPrice, tax: 0, total: qty * unitPrice, cost: qty * lineCost, profit: qty * (unitPrice - lineCost),
      cashier: "IT", status: "Completed",
      items: [{ id: productId, productSyncId: SYNC_ID, lineId: randomUUID(), name: "Valued widget", barcode: SYNC_ID, quantity: qty, unitPrice, total: qty * unitPrice, cost: lineCost, batchAllocations: [] }],
    },
  }
}
const receiveOp = (unitCost: number): Op => ({ id: randomUUID(), entity: "inventory", action: "receive", payload: [{ id: randomUUID(), batchNumber: `LOT-HV-${randomUUID().slice(0, 6)}`, productId, productSyncId: SYNC_ID, productName: "Valued widget", barcode: SYNC_ID, initialQuantity: 4, quantityRemaining: 4, unitCost, unitPrice: 5, receivedAt: new Date().toISOString(), status: "Open" }] })
const adjustOp = (change: number, valueImpact: number): Op => ({ id: randomUUID(), entity: "inventory", action: "adjust", payload: { id: randomUUID(), adjustmentNumber: `ADJ-HV-${randomUUID().slice(0, 6)}`, productId, productSyncId: SYNC_ID, productName: "Valued widget", barcode: SYNC_ID, quantityBefore: 0, quantityChange: change, quantityAfter: change, reason: "Count Correction", valueImpact, createdAt: new Date().toISOString() } })

const saleOf = async (db: typeof prisma, id: string) => {
  const s = await db.sale.findFirst({ where: { tenantId: TENANT, id }, select: { cost: true, profit: true, items: { select: { cost: true, quantity: true } } } })
  return s && { cost: Number(s.cost), profit: Number(s.profit), items: s.items.map((i) => ({ cost: Number(i.cost), quantity: Number(i.quantity) })) }
}
const hubSale = (id: string) => saleOf(prisma, id)
const cloudSale = (id: string) => saleOf(cloudPrisma, id)
const cloudLot = (id: string) => cloudPrisma.inventoryBatch.findFirst({ where: { tenantId: TENANT, id }, select: { unitCost: true } })
const hubStock = async () => Number((await prisma.product.findUnique({ where: { id: productId } }))!.stock)
const cloudStock = async () => Number((await cloudPrisma.product.findUnique({ where: { id: cloudProductId } }))!.stock)
const opRow = (id: string) => prisma.syncOperation.findUnique({ where: { id } })

beforeAll(async () => {
  hubServer = http.createServer(hubApp)
  await new Promise<void>((resolve) => hubServer.listen(0, resolve))
  hubUrl = `http://localhost:${(hubServer.address() as AddressInfo).port}`
  for (const db of [prisma, cloudPrisma]) {
    await db.tenant.create({ data: { id: TENANT, name: "Valuation IT (disposable)", subdomain: `hv-${TENANT.slice(0, 8)}`, cloudApiKey: CLOUD_KEY } })
  }
  await prisma.staffUser.create({ data: { id: ADMIN, tenantId: TENANT, name: "IT manager", mobile: `hv-a-${TENANT.slice(0, 6)}`, pin: "x", role: "Admin" } })
  // sells, receives and adjusts, but cannot see cost
  await prisma.staffUser.create({ data: { id: CLERK, tenantId: TENANT, name: "IT clerk", mobile: `hv-c-${TENANT.slice(0, 6)}`, pin: "y", role: "Cashier", permissions: ["sales.checkout", "inventory.view", "inventory.receive", "inventory.adjust"] } as any })
  await prisma.device.create({ data: { tenantId: TENANT, deviceId: DEVICE, deviceName: DEVICE, status: "APPROVED" } })
  adminToken = jwt.sign({ userId: ADMIN, tenantId: TENANT, role: "Admin" }, process.env.JWT_SECRET!, { expiresIn: "1h" })
  clerkToken = jwt.sign({ userId: CLERK, tenantId: TENANT, role: "Cashier" }, process.env.JWT_SECRET!, { expiresIn: "1h" })
  productId = (await prisma.product.create({ data: { tenantId: TENANT, syncId: SYNC_ID, name: "Valued widget", price: 5, cost: 2, stock: 100, barcode: SYNC_ID, category: "Test" } })).id
  await cloudPrisma.product.create({ data: { tenantId: TENANT, name: "Filler", price: 1, cost: 1, stock: 0, barcode: `${SYNC_ID}-f`, category: "Test" } })
  cloudProductId = (await cloudPrisma.product.create({ data: { tenantId: TENANT, syncId: SYNC_ID, name: "Valued widget", price: 5, cost: 2, stock: 100, barcode: SYNC_ID, category: "Test" } })).id
})

afterAll(async () => {
  for (const db of [prisma, cloudPrisma]) {
    const where = { tenantId: TENANT }
    await db.stockMovement.deleteMany({ where })
    await db.saleItem.deleteMany({ where }).catch(() => undefined)
    await db.saleTender?.deleteMany({ where }).catch(() => undefined)
    await db.sale.deleteMany({ where })
    await db.stockAdjustment.deleteMany({ where })
    await db.inventoryBatch.deleteMany({ where })
    await (db as any).operationEvidence?.deleteMany({ where }).catch(() => undefined)
    await db.syncOperation.deleteMany({ where })
    await db.syncClient?.deleteMany({ where }).catch(() => undefined)
    await db.auditEvent.deleteMany({ where }).catch(() => undefined)
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

describe("mixed-version valuation: which figures the cloud keeps", () => {
  it("this hub forwards its own valuation, marked: the cloud keeps it, including a manager's purchase price", async () => {
    const sale = saleOp(2, 999) // a till's forged cost
    expect((await asClerk(sale)).status).toBe("ok")
    expect(await hubSale(sale.payload.id)).toMatchObject({ cost: 4, profit: 6 })
    expect((await opRow(sale.id))?.serverValued).toBe(true)
    const bought = receiveOp(7) // the manager's own purchase price (can see cost)
    expect((await asManager(bought)).status).toBe("ok")
    await bridge.pushToCloudOnce()
    expect((await opRow(sale.id))?.status).toBe("Synced")
    expect(await cloudSale(sale.payload.id)).toMatchObject({ cost: 4, profit: 6, items: [{ cost: 2, quantity: 2 }] })
    expect(Number((await cloudLot(bought.payload[0].id))?.unitCost)).toBe(7)
  })

  it("an older hub's forged or stale figures are valued by the cloud", async () => {
    // The cloud's cost moved on (3); the older hub still sends its till's figures.
    await cloudPrisma.product.update({ where: { id: cloudProductId }, data: { cost: 3 } })
    try {
      const forged = saleOp(2, 999)
      expect((await asOlderHub(forged)).status).toBe("ok")
      expect(await cloudSale(forged.payload.id)).toMatchObject({ cost: 6, profit: 4, items: [{ cost: 3 }] })
      const stale = saleOp(1, 2)
      expect((await asOlderHub(stale)).status).toBe("ok")
      expect(await cloudSale(stale.payload.id)).toMatchObject({ cost: 3, profit: 2 })
      const lot = receiveOp(999)
      expect((await asOlderHub(lot)).status).toBe("ok")
      expect(Number((await cloudLot(lot.payload[0].id))?.unitCost)).toBe(3)
      const adj = adjustOp(2, 99999)
      expect((await asOlderHub(adj)).status).toBe("ok")
      const row = await cloudPrisma.stockAdjustment.findFirst({ where: { tenantId: TENANT, id: adj.payload.id }, select: { valueImpact: true } })
      expect(Number(row?.valueImpact)).toBe(6)
      // Known limit (docs): a manager's real purchase price relayed by an older hub is valued at the
      // cloud's product cost too; the hub keeps its own figure.
      const managerLot = receiveOp(7)
      expect((await asOlderHub(managerLot)).status).toBe("ok")
      expect(Number((await cloudLot(managerLot.payload[0].id))?.unitCost)).toBe(3)
    } finally {
      await cloudPrisma.product.update({ where: { id: cloudProductId }, data: { cost: 2 } })
    }
  })

  it("work an older hub queued before it was upgraded is forwarded unmarked and valued by the cloud", async () => {
    // A 1.0.51 hub applied this sale with its till's figures and had not forwarded it when the hub
    // was upgraded: the row predates server valuation (the migration adds serverValued = false).
    const queued = saleOp(1, 999)
    await prisma.syncOperation.create({ data: { id: queued.id, tenantId: TENANT, entity: "sale", action: "create", summary: "create sale", payload: { ...queued.payload, cost: 999, profit: -994 }, status: "Pending", appliedAt: new Date() } })
    expect((await opRow(queued.id))?.serverValued).toBe(false)
    await bridge.pushToCloudOnce()
    expect((await opRow(queued.id))?.status).toBe("Synced")
    expect(await cloudSale(queued.payload.id)).toMatchObject({ cost: 2, profit: 3, items: [{ cost: 2 }] })
  })
})

describe("operation identity when the server replaces submitted valuation", () => {
  it("resends, changed commands, forged cost and lost responses (till -> hub -> cloud)", async () => {
    await bridge.pushToCloudOnce()
    const hub0 = await hubStock()
    const cloud0 = await cloudStock()
    const op = saleOp(2, 999)
    expect((await asClerk(op)).status).toBe("ok")
    expect(await hubStock()).toBe(hub0 - 2)

    // Lost response: the till resends exactly; acknowledged, applied once.
    expect((await asClerk(op)).status).toBe("ok")
    // The hub's cost changed meanwhile and the till resends other cost figures: still the same
    // operation (cost is not part of its identity); the stored valuation does not move.
    await prisma.product.update({ where: { id: productId }, data: { cost: 4 } })
    try {
      const otherCost = { ...op, payload: { ...op.payload, cost: 10, profit: 0, items: [{ ...op.payload.items[0], cost: 5 }] } }
      expect((await asClerk(otherCost)).status).toBe("ok")
    } finally {
      await prisma.product.update({ where: { id: productId }, data: { cost: 2 } })
    }
    expect(await hubStock()).toBe(hub0 - 2)
    expect(await hubSale(op.payload.id)).toMatchObject({ cost: 4, profit: 6 })

    // A changed business command under the same id is refused, whatever cost it carries.
    const moreQty = { ...op, payload: { ...op.payload, subtotal: 15, total: 15, items: [{ ...op.payload.items[0], quantity: 3, total: 15 }] } }
    const r1 = await asClerk(moreQty)
    expect(r1.status).toBe("rejected")
    expect(r1.error).toMatch(/OPERATION_ID_REUSED/)
    const otherPrice = { ...op, payload: { ...op.payload, subtotal: 8, total: 8, items: [{ ...op.payload.items[0], unitPrice: 4, total: 8 }] } }
    const r2 = await asClerk(otherPrice)
    expect(r2.status).toBe("rejected")
    expect(r2.error).toMatch(/OPERATION_ID_REUSED/)
    expect(await hubStock()).toBe(hub0 - 2)

    // Forwarded once; the acknowledgement is lost and the hub forwards it again.
    await bridge.pushToCloudOnce()
    expect((await opRow(op.id))?.status).toBe("Synced")
    await prisma.syncOperation.update({ where: { id: op.id }, data: { status: "Pending", syncedAt: null } })
    await bridge.pushToCloudOnce()
    expect((await opRow(op.id))?.status).toBe("Synced")
    expect(await cloudStock()).toBe(cloud0 - 2)
    expect(await cloudPrisma.sale.count({ where: { tenantId: TENANT, id: op.payload.id } })).toBe(1)
    expect(await cloudSale(op.payload.id)).toMatchObject({ cost: 4, profit: 6 })

    // The same operation re-forwarded by an older hub with its till's figures: acknowledged, nothing
    // changes; with a changed quantity: refused by the cloud.
    expect((await asOlderHub({ ...op, payload: { ...op.payload, cost: 1998, profit: -1988 } })).status).toBe("ok")
    expect(await cloudSale(op.payload.id)).toMatchObject({ cost: 4, profit: 6 })
    const r3 = await asOlderHub(moreQty)
    expect(r3.status).toBe("rejected")
    expect(r3.error).toMatch(/OPERATION_ID_REUSED/)
    expect(await cloudStock()).toBe(cloud0 - 2)
    // The till resends after forwarding: acknowledged, forwarding state untouched.
    expect((await asClerk(op)).status).toBe("ok")
    expect((await opRow(op.id))?.status).toBe("Synced")
  })
})
