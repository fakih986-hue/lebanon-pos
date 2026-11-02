import { describe, it, expect, beforeAll, afterAll } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomUUID } from "node:crypto"
import jwt from "jsonwebtoken"

// Release batch — product identity across servers (real Postgres, real handlers). A "hub" on the scratch database and
// a "cloud" on its cloud_it schema, in this process; the hub's bridge forwards over HTTP, as in hub-valuation.test.ts.
// The two databases number products independently, and here the numbers CROSS: the hub's #X is "Widget" and its
// #X+1 is "Gadget", while the cloud's #X is "Gadget" and its #X+1 is "Widget". Registers of 1.0.50/1.0.51 name products
// on adjustments and count lines (and on lines of products they had no stable id for) by number only — the hub's.
// Under test, with the exact product and lot asserted on both databases:
//  - the hub (first server) resolves its own numbers and records the stable ids; it forwards the register's command
//    unchanged with the ids beside it, and the cloud changes the right products and lots;
//  - an older hub forwarding numbers only: the cloud holds the operation for review (nothing changes), never guesses;
//  - a stable id the cloud has not received yet: kept waiting (dependency), applied once the product arrives;
//  - lost acknowledgements and re-forwards apply once; work applied before this version gets its ids at forward time;
//  - a register whose own offline numbering collided, and a line whose barcode is another product's: held at the hub;
//  - a lot of another product named on an adjustment: held; pulled records are translated by stable id only.
process.env.JWT_SECRET = process.env.JWT_SECRET || "identity-secret"
delete process.env.IS_LOCAL_SERVER
// the hub's state files (pull cursor, keys) in a folder of this run only
process.env.TITAN_DATA_DIR = (await import("node:fs")).mkdtempSync((await import("node:path")).join((await import("node:os")).tmpdir(), "pi-hub-"))

const TENANT = randomUUID()
const ADMIN = randomUUID()
const CLERK = randomUUID()
const DEVICE = `PI-${TENANT.slice(0, 8)}`
const OTHER_DEVICE = `PI2-${TENANT.slice(0, 8)}`
const CLOUD_KEY = `ck-${randomUUID()}`
const t8 = TENANT.slice(0, 8)
const SYNC = { widget: `w-${t8}`, gadget: `g-${t8}`, late: `late-${t8}`, own: `own-${t8}` }
const X = 800_000 + Math.floor(Math.random() * 100_000) * 4 // product ids nobody else uses in either schema
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
vi.setConfig({ testTimeout: 60_000 })

let hubServer: http.Server
let hubUrl = ""
let clerkToken = ""
type Op = { id: string; entity: string; action: string; payload: any; ev?: Record<string, unknown> }
type Result = { id: string; status: string; error?: string; kind?: string }
async function pushTo(base: string, op: Op, headers: Record<string, string>, deviceId?: string): Promise<Result> {
  const res = await fetch(`${base}/api/sync/push`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ deviceId, operations: [op] }) })
  const body = (await res.json()) as { results?: Result[] }
  if (!body.results) throw new Error(`push refused: HTTP ${res.status} ${JSON.stringify(body).slice(0, 200)}`)
  return body.results[0]
}
/** A 1.0.50/1.0.51 register: its numbers are the hub's (it pulled them from the hub), schema header 2. */
const asOldTill = (op: Op, device = DEVICE) => pushTo(hubUrl, op, { Authorization: `Bearer ${clerkToken}`, "x-titan-sync-schema": "2" }, device)
/** A 1.0.51 hub forwarding: its cloud key and the operation as its own database holds it, nothing beside it. */
const asOlderHub = (op: Op) => pushTo(cloudUrl, { id: op.id, entity: op.entity, action: op.action, payload: op.payload }, { "x-cloud-key": CLOUD_KEY, "x-tenant-id": TENANT, "x-titan-sync-schema": "2" })

const LOT = { hubWidget: `lot-w-${t8}`, hubGadget: `lot-g-${t8}` }
const stockOf = async (db: typeof prisma, syncId: string) => Number((await db.product.findFirst({ where: { tenantId: TENANT, syncId }, select: { stock: true } }))!.stock)
const lotOf = async (db: typeof prisma, id: string) => Number((await db.inventoryBatch.findFirst({ where: { tenantId: TENANT, id }, select: { quantityRemaining: true } }))!.quantityRemaining)
const both = async (syncId: string) => [await stockOf(prisma, syncId), await stockOf(cloudPrisma, syncId)]
const hubRow = (id: string) => prisma.syncOperation.findUnique({ where: { id } })
const cloudRow = (id: string) => cloudPrisma.syncOperation.findUnique({ where: { id } })
/** What the register shows for a number (its own view, pulled from the hub). */
const hubView = new Map<number, { name: string; barcode: string }>()
const adjust = (productId: number, change: number, extra: Record<string, unknown> = {}): Op => {
  const id = randomUUID()
  const p = hubView.get(productId) ?? { name: "?", barcode: "" }
  // exactly what 1.0.51 commits (inventoryAdjustment.service.ts StockAdjustment): the register's number, no stable id
  return { id: `op-${id}`, entity: "inventory", action: "adjust", payload: {
    id, adjustmentNumber: `ADJ-${id.slice(0, 6)}`, productId, productName: p.name, barcode: p.barcode, quantityBefore: 0, quantityChange: change, quantityAfter: change,
    reason: "Count Correction", batchAllocations: [], valueImpact: 0, createdAt: new Date().toISOString(), ...extra,
  } }
}

beforeAll(async () => {
  hubServer = http.createServer(hubApp)
  await new Promise<void>((resolve) => hubServer.listen(0, resolve))
  hubUrl = `http://localhost:${(hubServer.address() as AddressInfo).port}`
  for (const db of [prisma, cloudPrisma]) await db.tenant.create({ data: { id: TENANT, name: "Identity IT (disposable)", subdomain: `pi-${t8}`, cloudApiKey: CLOUD_KEY } })
  await prisma.staffUser.create({ data: { id: ADMIN, tenantId: TENANT, name: "IT manager", mobile: `pi-a-${t8}`, pin: "x", role: "Admin" } })
  await prisma.staffUser.create({ data: { id: CLERK, tenantId: TENANT, name: "IT clerk", mobile: `pi-c-${t8}`, pin: "y", role: "Cashier", permissions: ["sales.checkout", "inventory.view", "inventory.receive", "inventory.adjust", "inventory.manage", "sales.refund"] } as any })
  for (const device of [DEVICE, OTHER_DEVICE]) await prisma.device.create({ data: { tenantId: TENANT, deviceId: device, deviceName: device, status: "APPROVED" } })
  clerkToken = jwt.sign({ userId: CLERK, tenantId: TENANT, role: "Cashier" }, process.env.JWT_SECRET!, { expiresIn: "1h" })
  // the crossing numbers
  const widget = { tenantId: TENANT, syncId: SYNC.widget, name: "Widget", price: 5, cost: 2, stock: 50, barcode: `bw-${t8}`, category: "Test" }
  const gadget = { tenantId: TENANT, syncId: SYNC.gadget, name: "Gadget", price: 7, cost: 3, stock: 40, barcode: `bg-${t8}`, category: "Test" }
  await prisma.product.create({ data: { id: X, ...widget } })
  await prisma.product.create({ data: { id: X + 1, ...gadget } })
  hubView.set(X, { name: "Widget", barcode: widget.barcode }); hubView.set(X + 1, { name: "Gadget", barcode: gadget.barcode })
  await cloudPrisma.product.create({ data: { id: X, ...gadget } })
  await cloudPrisma.product.create({ data: { id: X + 1, ...widget } })
  // the same lots on both (lot ids are stable), each on its own product's number there
  for (const [db, w, g] of [[prisma, X, X + 1], [cloudPrisma, X + 1, X]] as const) {
    await db.inventoryBatch.create({ data: { id: LOT.hubWidget, tenantId: TENANT, batchNumber: "LW", productId: w, productName: "Widget", barcode: `bw-${t8}`, initialQuantity: 50, quantityRemaining: 50, unitCost: 2, unitPrice: 5 } as any })
    await db.inventoryBatch.create({ data: { id: LOT.hubGadget, tenantId: TENANT, batchNumber: "LG", productId: g, productName: "Gadget", barcode: `bg-${t8}`, initialQuantity: 40, quantityRemaining: 40, unitCost: 3, unitPrice: 7 } as any })
  }
})

afterAll(async () => {
  for (const db of [prisma, cloudPrisma]) {
    const where = { tenantId: TENANT }
    await db.stockMovement.deleteMany({ where })
    await db.saleItem.deleteMany({ where: { sale: { tenantId: TENANT } } }).catch(() => undefined)
    await db.saleTender?.deleteMany({ where: { sale: { tenantId: TENANT } } }).catch(() => undefined)
    await db.sale.deleteMany({ where })
    await db.stockAdjustment.deleteMany({ where })
    await db.refundItem.deleteMany({ where: { refund: { tenantId: TENANT } } }).catch(() => undefined)
    await db.saleRefund.deleteMany({ where }).catch(() => undefined)
    await db.stockCountSession.deleteMany({ where }).catch(() => undefined)
    await db.inventoryBatch.deleteMany({ where })
    await (db as any).operationEvidence?.deleteMany({ where }).catch(() => undefined)
    await db.syncOperation.deleteMany({ where })
    await db.syncClient?.deleteMany({ where }).catch(() => undefined)
    await db.auditEvent.deleteMany({ where }).catch(() => undefined)
    await db.product.deleteMany({ where })
    await db.device.deleteMany({ where }).catch(() => undefined)
    await db.staffUser.deleteMany({ where }).catch(() => undefined)
    await db.appSettings.deleteMany({ where }).catch(() => undefined)
    await db.tenant.deleteMany({ where: { id: TENANT } }).catch(() => undefined)
  }
  await new Promise<void>((resolve) => hubServer.close(() => resolve()))
  await new Promise<void>((resolve) => cloudServer.close(() => resolve()))
  await prisma.$disconnect()
  await cloudPrisma.$disconnect()
})

describe("forwarded product references: stable ids only", () => {
  it("a 1.0.51 adjustment by the hub's number: the hub records the stable id; the cloud changes Widget, not its own #X (Gadget)", async () => {
    const op = adjust(X, -3)
    expect((await asOldTill(op)).status).toBe("ok")
    expect(await both(SYNC.widget)).toEqual([47, 50])
    const row = await hubRow(op.id)
    expect(row!.productRefs).toEqual([{ path: [], key: "productSyncId", syncId: SYNC.widget }])
    // the command kept is the register's (no stable id written into it)
    expect((row!.payload as any).productSyncId).toBeUndefined()
    await bridge.pushToCloudOnce()
    expect((await hubRow(op.id))!.status).toBe("Synced")
    expect(await both(SYNC.widget)).toEqual([47, 47])
    expect(await both(SYNC.gadget)).toEqual([40, 40])
    const cloudAdj = await cloudPrisma.stockAdjustment.findFirst({ where: { tenantId: TENANT, id: op.payload.id } })
    expect(cloudAdj!.productId).toBe(X + 1) // the cloud's Widget
    // the cloud stored the register's command too, with the hub's ids beside it
    expect((await cloudRow(op.id))!.productRefs).toEqual([{ path: [], key: "productSyncId", syncId: SYNC.widget }])
  })

  it("a lot-moving adjustment: the exact lot changes on both databases", async () => {
    const op = adjust(X + 1, -4, { batchAllocations: [{ batchId: LOT.hubGadget, quantity: 4 }] })
    expect((await asOldTill(op)).status).toBe("ok")
    await bridge.pushToCloudOnce()
    expect(await both(SYNC.gadget)).toEqual([36, 36])
    expect([await lotOf(prisma, LOT.hubGadget), await lotOf(cloudPrisma, LOT.hubGadget)]).toEqual([36, 36])
    expect([await lotOf(prisma, LOT.hubWidget), await lotOf(cloudPrisma, LOT.hubWidget)]).toEqual([50, 50])
  })

  it("a 1.0.51 count: its lines name the right products on both databases (the hub's numbers never reach the cloud's table)", async () => {
    const id = randomUUID()
    const op: Op = { id: randomUUID(), entity: "inventory", action: "count", payload: { id, countNumber: `CNT-${t8}`, status: "Completed", completedAt: new Date().toISOString(), totalVariance: -1, totalValueImpact: 0, lines: [
      { productId: X, productName: "Widget", barcode: `bw-${t8}`, category: "Test", expectedQuantity: 47, countedQuantity: 46, variance: -1 },
      { productId: X + 1, productName: "Gadget", barcode: `bg-${t8}`, category: "Test", expectedQuantity: 36, countedQuantity: 36, variance: 0 },
    ] } }
    expect((await asOldTill(op)).status).toBe("ok")
    await bridge.pushToCloudOnce()
    const lines = async (db: typeof prisma) => (await db.stockCountLine.findMany({ where: { sessionId: id }, orderBy: { productName: "asc" } })).map((l) => [l.productName, l.productId])
    expect(await lines(prisma)).toEqual([["Gadget", X + 1], ["Widget", X]])
    expect(await lines(cloudPrisma)).toEqual([["Gadget", X], ["Widget", X + 1]])
  })

  it("a line without a stable id (a product the register had none for) and a refund by sale line: right products both sides", async () => {
    const saleId = randomUUID(), lineId = randomUUID()
    const sale: Op = { id: randomUUID(), entity: "sale", action: "create", payload: {
      id: saleId, saleNumber: `S-PI-${t8}`, paymentMethod: "Cash", subtotal: 14, tax: 0, total: 14, cashier: "IT clerk", status: "Completed",
      items: [{ id: X + 1, lineId, name: "Gadget", barcode: `bg-${t8}`, quantity: 2, unitPrice: 7, total: 14, batchAllocations: [{ batchId: LOT.hubGadget, quantity: 2 }] }],
    } }
    expect((await asOldTill(sale)).status).toBe("ok")
    const refund: Op = { id: randomUUID(), entity: "refund", action: "create", payload: {
      id: randomUUID(), refundNumber: `R-PI-${t8}`, saleId, saleNumber: `S-PI-${t8}`, method: "Cash", total: 7, reason: "IT", cashier: "IT clerk", items: [{ id: X + 1, saleLineId: lineId, name: "Gadget", quantity: 1, unitPrice: 7, total: 7 }],
    } }
    expect((await asOldTill(refund)).status).toBe("ok")
    await bridge.pushToCloudOnce()
    for (const op of [sale, refund]) expect((await hubRow(op.id))!.status).toBe("Synced")
    expect(await both(SYNC.gadget)).toEqual([35, 35])
    expect([await lotOf(prisma, LOT.hubGadget), await lotOf(cloudPrisma, LOT.hubGadget)]).toEqual([35, 35])
    const cloudLine = await cloudPrisma.saleItem.findFirst({ where: { saleId } })
    expect(cloudLine!.productId).toBe(X) // the cloud's Gadget
  })
})

describe("never a guess: held, waiting, once", () => {
  it("an older hub forwarding numbers only: held for review at the cloud, nothing changes, never matched by the cloud's #X", async () => {
    const op = adjust(X, -5)
    const r = await asOlderHub(op)
    expect([r.status, r.kind, /^IDENTITY_HELD:/.test(r.error ?? "")]).toEqual(["error", "review", true])
    expect(await both(SYNC.gadget)).toEqual([35, 35])
    expect(await stockOf(cloudPrisma, SYNC.widget)).toBe(47)
    const row = await cloudRow(op.id)
    expect([row!.status, row!.appliedAt]).toEqual(["Refused", null])
    // the same forward again: still held, still nothing
    expect((await asOlderHub(op)).kind).toBe("review")
    expect(await stockOf(cloudPrisma, SYNC.gadget)).toBe(35)
  })

  it("a stable id the cloud has not received yet: kept waiting (attempts not used up), applied once the product arrives", async () => {
    const late = await prisma.product.create({ data: { tenantId: TENANT, syncId: SYNC.late, name: "Late item", price: 1, cost: 0.5, stock: 10, barcode: `bl-${t8}`, category: "Test" } })
    hubView.set(late.id, { name: "Late item", barcode: `bl-${t8}` })
    const op = adjust(late.id, -1)
    expect((await asOldTill(op)).status).toBe("ok")
    for (let i = 0; i < 6; i++) await bridge.pushToCloudOnce()
    const waiting = await hubRow(op.id)
    expect([waiting!.status, waiting!.attempts, /^PRODUCT_PENDING:/.test(waiting!.error ?? "")]).toEqual(["Pending", 0, true])
    await cloudPrisma.product.create({ data: { tenantId: TENANT, syncId: SYNC.late, name: "Late item", price: 1, cost: 0.5, stock: 10, barcode: `bl-${t8}`, category: "Test" } })
    await bridge.pushToCloudOnce()
    expect((await hubRow(op.id))!.status).toBe("Synced")
    expect(await both(SYNC.late)).toEqual([9, 9])
  })

  it("lost acknowledgements: the hub forwards again (twice), the cloud applies once", async () => {
    const op = adjust(X, -2)
    expect((await asOldTill(op)).status).toBe("ok")
    // the till's response was lost: it sends again; the hub acknowledges without applying again
    expect((await asOldTill(op)).status).toBe("ok")
    await bridge.pushToCloudOnce()
    for (let i = 0; i < 2; i++) {
      await prisma.syncOperation.update({ where: { id: op.id }, data: { status: "Pending", syncedAt: null } })
      await bridge.pushToCloudOnce()
    }
    expect((await hubRow(op.id))!.status).toBe("Synced")
    expect(await both(SYNC.widget)).toEqual([45, 45])
  })

  it("work applied before this version (no stable ids recorded): resolved by the hub's own numbers when forwarded", async () => {
    const op = adjust(X + 1, -1)
    expect((await asOldTill(op)).status).toBe("ok")
    await prisma.syncOperation.update({ where: { id: op.id }, data: { productRefs: null as any } })
    await bridge.pushToCloudOnce()
    expect((await hubRow(op.id))!.productRefs).toEqual([{ path: [], key: "productSyncId", syncId: SYNC.gadget }])
    expect(await both(SYNC.gadget)).toEqual([34, 34])
  })

  it("an earlier version gave up on a waiting forward: it is forwarded again and applied once", async () => {
    const op = adjust(X, -1)
    expect((await asOldTill(op)).status).toBe("ok")
    await prisma.syncOperation.update({ where: { id: op.id }, data: { status: "Failed", attempts: 5, error: "PRODUCT_PENDING: \"Widget\" has not reached this server yet" } })
    await bridge.pushToCloudOnce()
    expect((await hubRow(op.id))!.status).toBe("Synced")
    expect(await both(SYNC.widget)).toEqual([44, 44])
  })
})

describe("the first server holds numbers it cannot trust", () => {
  it("a register's own offline product numbered like an existing one: its bare number is held, not applied to Widget", async () => {
    // the register created "Own item" offline as its #X; the hub gave it a new number
    const create: Op = { id: randomUUID(), entity: "product", action: "create", payload: { id: X, syncId: SYNC.own, name: "Own item", price: 2, cost: 1, stock: 0, barcode: null, category: "Test" } }
    expect((await asOldTill(create)).status).toBe("ok")
    const own = await prisma.product.findFirst({ where: { tenantId: TENANT, syncId: SYNC.own } })
    expect(own!.id).not.toBe(X)
    const before = await stockOf(prisma, SYNC.widget)
    // the register's view of its #X: its own item (no barcode, so only the numbering tells them apart)
    const op = adjust(X, 6, { productName: "Own item", barcode: "" })
    const r = await asOldTill(op)
    expect([r.status, r.kind, /^IDENTITY_HELD:/.test(r.error ?? "")]).toEqual(["error", "review", true])
    expect(await stockOf(prisma, SYNC.widget)).toBe(before)
    expect(await stockOf(prisma, SYNC.own)).toBe(0)
    // another register's #X is the hub's Widget: applied
    expect((await asOldTill(adjust(X, -1), OTHER_DEVICE)).status).toBe("ok")
    expect(await stockOf(prisma, SYNC.widget)).toBe(before - 1)
  })

  it("a count line whose barcode is another product's: held at the hub, nothing recorded", async () => {
    const id = randomUUID()
    const op: Op = { id: randomUUID(), entity: "inventory", action: "count", payload: { id, countNumber: `CNT2-${t8}`, status: "Completed", lines: [{ productId: X, productName: "Widget", barcode: `bg-${t8}`, category: "Test", expectedQuantity: 1, countedQuantity: 1, variance: 0 }] } }
    const r = await asOldTill(op, OTHER_DEVICE)
    expect([r.status, r.kind]).toEqual(["error", "review"])
    expect(await prisma.stockCountSession.count({ where: { id } })).toBe(0)
  })

  it("an adjustment naming another product's lot: held, neither product nor lot moves", async () => {
    const before = [await stockOf(prisma, SYNC.widget), await lotOf(prisma, LOT.hubGadget)]
    const op = adjust(X, -1, { productSyncId: SYNC.widget, batchAllocations: [{ batchId: LOT.hubGadget, quantity: 1 }] })
    const r = await asOldTill(op, OTHER_DEVICE)
    expect([r.status, r.kind]).toEqual(["error", "review"])
    expect([await stockOf(prisma, SYNC.widget), await lotOf(prisma, LOT.hubGadget)]).toEqual(before)
  })
})

describe("pulled records: translated by stable id only", () => {
  it("a sale and a count recorded at the cloud reach the hub on the hub's own products", async () => {
    const saleId = randomUUID()
    await cloudPrisma.sale.create({ data: { id: saleId, tenantId: TENANT, saleNumber: `S-CL-${t8}`, paymentMethod: "Cash", subtotal: 5, tax: 0, total: 5, cashier: "Cloud", status: "Completed",
      items: { create: [{ productId: X + 1, productName: "Widget", barcode: `bw-${t8}`, quantity: 1, unitPrice: 5, total: 5 }] } } as any })
    const countId = randomUUID()
    await cloudPrisma.stockCountSession.create({ data: { id: countId, tenantId: TENANT, countNumber: `CNT-CL-${t8}`, status: "Completed",
      lines: { create: [{ productId: X, productName: "Gadget", barcode: `bg-${t8}`, category: "Test", expectedQuantity: 1, countedQuantity: 1, variance: 0 }] } } as any })
    await bridge.pullFromCloud()
    const line = await prisma.saleItem.findFirst({ where: { saleId } })
    expect(line!.productId).toBe(X) // the hub's Widget (the cloud's #X+1)
    const countLine = await prisma.stockCountLine.findFirst({ where: { sessionId: countId } })
    expect(countLine!.productId).toBe(X + 1) // the hub's Gadget (the cloud's #X)
  })
})
