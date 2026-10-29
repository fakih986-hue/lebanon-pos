import { describe, it, expect, beforeAll, afterAll } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomUUID } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import jwt from "jsonwebtoken"

// SPRINT-1 (real Postgres, real handlers): stock-policy revisions between a hub and the cloud.
// Two servers in this process — a hub on the scratch database and a cloud on its cloud_it schema —
// with the hub's bridge forwarding over HTTP, as deployed. Both sides change a product's stock
// policy while disconnected, sales happen between the changes, then the hub reconnects, forwards,
// retries and pulls. Under test:
//  - one revision id means one policy on both databases (ids are minted once, never re-numbered);
//  - concurrent edits: the cloud's current policy wins, the other edit is kept as a recorded branch
//    (visible audit event), and both databases converge on the same current revision and history;
//  - a sale keeps the policy it was sold under through forwarding (never today's);
//  - a sale naming a revision the receiver does not know is HELD (retryable, nothing applied,
//    attempts not used up) and applies once the revision arrives;
//  - sale, stock, lots, refund and void effects agree on both databases;
//  - migration defaults for existing products and sale lines.
process.env.JWT_SECRET = process.env.JWT_SECRET || "policy-sync-secret"
delete process.env.IS_LOCAL_SERVER

const TENANT = randomUUID()
const ADMIN = randomUUID()
const DEVICE = `PS-${TENANT.slice(0, 8)}`
const CLOUD_KEY = `ck-${randomUUID()}`
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

type Db = typeof prisma
let hubServer: http.Server
let hubUrl = ""
let token = ""
const stateFile = path.resolve(__dirname, "../data/sync-state.json")
let savedState: string | null = null

async function pushTo(base: string, ops: Array<{ id: string; entity: string; action: string; payload: unknown }>, headers: Record<string, string>, deviceId?: string) {
  const res = await fetch(`${base}/api/sync/push`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ deviceId, operations: ops }) })
  const body = (await res.json()) as { results?: Array<{ id: string; status: string; error?: string }> }
  if (!body.results) throw new Error(`push refused: HTTP ${res.status} ${JSON.stringify(body).slice(0, 200)}`)
  return body.results
}
/** A till pushing to the hub. */
const till = async (entity: string, action: string, payload: unknown) => (await pushTo(hubUrl, [{ id: randomUUID(), entity, action, payload }], { Authorization: `Bearer ${token}` }, DEVICE))[0]
/** The owner's change made directly on the cloud (owner portal / a direct till). */
const onCloud = async (entity: string, action: string, payload: unknown) => (await pushTo(cloudUrl, [{ id: randomUUID(), entity, action, payload }], { "x-cloud-key": CLOUD_KEY, "x-tenant-id": TENANT }))[0]
const pull = async () => {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true })
  fs.writeFileSync(stateFile, JSON.stringify({ lastPullAt: new Date(Date.now() - 3600_000).toISOString(), staffRefresh: 2 }))
  await bridge.pullFromCloud()
}
const product = (db: Db, syncId: string) => db.product.findFirst({ where: { tenantId: TENANT, syncId } })
const stock = async (db: Db, syncId: string) => Number((await product(db, syncId))!.stock)
const lotLeft = async (db: Db, name: string) => (await db.inventoryBatch.findMany({ where: { tenantId: TENANT, productName: name } })).reduce((s, b) => s + Number(b.quantityRemaining), 0)
const line = (db: Db, saleId: string) => db.saleItem.findFirst({ where: { saleId } })
const revs = async (db: Db, syncId: string) => ((await product(db, syncId))!.stockPolicyHistory as any[]).map((e) => `${e.rev}:${e.policy}`).sort()

function sale(p: { id: number; syncId: string; name: string }, rev: string | null, policy: string | null, qty = 1, lot?: string) {
  const id = randomUUID()
  const item: Record<string, unknown> = { id: p.id, productSyncId: p.syncId, lineId: randomUUID(), name: p.name, barcode: "", quantity: qty, unitPrice: 3, total: 3 * qty, cost: 1 }
  if (rev) item.stockPolicyRev = rev
  if (policy) item.stockPolicy = policy
  if (lot) item.batchAllocations = [{ batchId: lot, quantity: qty, unitCost: 1 }]
  return { id, lineId: item.lineId as string, payload: { id, saleNumber: `S-PS-${id.slice(0, 6)}`, paymentMethod: "Cash", subtotal: 3 * qty, tax: 0, total: 3 * qty, cashier: "IT", status: "Completed", createdAt: new Date().toISOString(), items: [item] } }
}

beforeAll(async () => {
  savedState = fs.existsSync(stateFile) ? fs.readFileSync(stateFile, "utf8") : null
  hubServer = http.createServer(hubApp)
  await new Promise<void>((resolve) => hubServer.listen(0, resolve))
  hubUrl = `http://localhost:${(hubServer.address() as AddressInfo).port}`
  for (const db of [prisma, cloudPrisma]) {
    await db.tenant.create({ data: { id: TENANT, name: "Policy sync IT (disposable)", subdomain: `ps-${TENANT.slice(0, 8)}`, cloudApiKey: CLOUD_KEY } })
  }
  await prisma.staffUser.create({ data: { id: ADMIN, tenantId: TENANT, name: "IT", mobile: `ps-${TENANT.slice(0, 6)}`, pin: "x", role: "Admin" } })
  await prisma.device.create({ data: { tenantId: TENANT, deviceId: DEVICE, deviceName: DEVICE, status: "APPROVED" } })
  token = jwt.sign({ userId: ADMIN, tenantId: TENANT, role: "Admin" }, process.env.JWT_SECRET!, { expiresIn: "1h" })
})

afterAll(async () => {
  if (savedState === null) fs.rmSync(stateFile, { force: true }); else fs.writeFileSync(stateFile, savedState)
  for (const db of [prisma, cloudPrisma]) {
    const where = { tenantId: TENANT }
    await db.stockMovement.deleteMany({ where })
    await db.saleRefund.deleteMany({ where }).catch(() => undefined)
    await db.sale.deleteMany({ where })
    await db.inventoryBatch.deleteMany({ where })
    await db.syncOperation.deleteMany({ where })
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

describe("stock-policy revisions between a hub and the cloud (both change while disconnected)", () => {
  const LATTE = randomUUID()
  const RH = `rh-${randomUUID()}`   // the hub till's change: tracked → untracked
  const RC = `rc-${randomUUID()}`   // the owner's changes on the cloud: tracked → untracked → tracked
  const RC2 = `rc2-${randomUUID()}`
  const LOT = randomUUID()
  let hubLatte: { id: number; syncId: string; name: string }
  let s0: ReturnType<typeof sale>, s1: ReturnType<typeof sale>

  it("setup: a tracked product with 10 in stock, on both sides", async () => {
    expect((await till("product", "create", { syncId: LATTE, name: "Latte", price: 3, cost: 1, stock: 0, category: "Coffee", barcode: null })).status).toBe("ok")
    const hubId = (await product(prisma, LATTE))!.id
    expect((await till("inventory", "receive", [{ id: LOT, batchNumber: "LOT-PS-1", productId: hubId, productSyncId: LATTE, productName: "Latte", barcode: "", initialQuantity: 10, quantityRemaining: 10, unitCost: 1, unitPrice: 3, receivedAt: new Date().toISOString(), status: "Open" }])).status).toBe("ok")
    await bridge.pushToCloudOnce()
    for (const db of [prisma, cloudPrisma]) {
      const p = (await product(db, LATTE))!
      expect([p.stockPolicy, p.stockPolicyRev, Number(p.stock)]).toEqual(["tracked", "initial", 10])
      expect(await lotLeft(db, "Latte")).toBe(10)
    }
    const p = (await product(prisma, LATTE))!
    hubLatte = { id: p.id, syncId: LATTE, name: "Latte" }
  })

  it("disconnected: the hub sells under 'initial' (tracked), its till switches to made-to-order (RH) and sells under RH", async () => {
    s0 = sale(hubLatte, "initial", "tracked", 1, LOT)
    expect((await till("sale", "create", s0.payload)).status).toBe("ok")
    expect((await till("product", "update", { syncId: LATTE, stockPolicy: "untracked", stockPolicyRev: RH, stockPolicyParentRev: "initial" })).status).toBe("ok")
    s1 = sale(hubLatte, RH, "untracked")
    expect((await till("sale", "create", s1.payload)).status).toBe("ok")
    expect(await stock(prisma, LATTE)).toBe(9)
    expect(await lotLeft(prisma, "Latte")).toBe(9)
    expect([(await line(prisma, s0.id))!.stockPolicy, (await line(prisma, s1.id))!.stockPolicy]).toEqual(["tracked", "untracked"])
  })

  it("disconnected: meanwhile the owner changes it on the cloud twice (RC untracked, then RC2 tracked)", async () => {
    expect((await onCloud("product", "update", { syncId: LATTE, stockPolicy: "untracked", stockPolicyRev: RC, stockPolicyParentRev: "initial" })).status).toBe("ok")
    expect((await onCloud("product", "update", { syncId: LATTE, stockPolicy: "tracked", stockPolicyRev: RC2, stockPolicyParentRev: RC })).status).toBe("ok")
    const c = (await product(cloudPrisma, LATTE))!
    expect([c.stockPolicy, c.stockPolicyRev]).toEqual(["tracked", RC2])
  })

  it("reconnect: the hub's change is a concurrent edit — recorded on the cloud as a branch, the cloud's current setting stays, visibly", async () => {
    await bridge.pushToCloudOnce()
    const c = (await product(cloudPrisma, LATTE))!
    expect([c.stockPolicy, c.stockPolicyRev]).toEqual(["tracked", RC2])
    expect(await revs(cloudPrisma, LATTE)).toEqual([`${RC2}:tracked`, `${RC}:untracked`, `${RH}:untracked`, "initial:tracked"].sort())
    expect(await cloudPrisma.auditEvent.count({ where: { tenantId: TENANT, action: "product.stock_policy_conflict" } })).toBe(1)
  })

  it("forwarded sales keep the policy they were sold under (initial → tracked, RH → untracked), not today's", async () => {
    const c0 = (await line(cloudPrisma, s0.id))!, c1 = (await line(cloudPrisma, s1.id))!
    expect([c0.stockPolicy, c0.stockPolicyRev, c0.stockPolicyConflict]).toEqual(["tracked", "initial", null])
    expect([c1.stockPolicy, c1.stockPolicyRev, c1.stockPolicyConflict]).toEqual(["untracked", RH, "changed"]) // today is tracked on the cloud
    expect(await stock(cloudPrisma, LATTE)).toBe(9)
    expect(await lotLeft(cloudPrisma, "Latte")).toBe(9)
  })

  it("the hub pulls: it adopts the cloud's current revision (the cloud has seen the hub's) and both histories are identical", async () => {
    await pull()
    const h = (await product(prisma, LATTE))!
    expect([h.stockPolicy, h.stockPolicyRev]).toEqual(["tracked", RC2])
    expect(await revs(prisma, LATTE)).toEqual(await revs(cloudPrisma, LATTE))
    for (const id of [s0.id, s1.id]) {
      const [a, b] = [(await line(prisma, id))!, (await line(cloudPrisma, id))!]
      expect([a.stockPolicy, a.stockPolicyRev]).toEqual([b.stockPolicy, b.stockPolicyRev])
    }
    expect(await stock(prisma, LATTE)).toBe(9)
  })

  it("refund of the made-to-order sale (RH) returns money only; void of the tracked sale restocks and restores its lot — on both databases", async () => {
    const r = await till("refund", "create", { id: randomUUID(), refundNumber: `R-PS-${s1.id.slice(0, 6)}`, saleId: s1.id, saleNumber: s1.payload.saleNumber, method: "Cash", reason: "IT", total: 3, cashier: "IT", items: [{ id: hubLatte.id, saleLineId: s1.lineId, name: "Latte", quantity: 1, unitPrice: 3, total: 3 }] })
    expect([r.status, r.error]).toEqual(["ok", undefined])
    expect((await till("sale", "void", { id: s0.id })).status).toBe("ok")
    await bridge.pushToCloudOnce()
    for (const db of [prisma, cloudPrisma]) {
      expect(await stock(db, LATTE)).toBe(10)
      expect(await lotLeft(db, "Latte")).toBe(10)
      expect((await db.sale.findUnique({ where: { id: s0.id } }))!.status).toBe("Voided")
    }
    expect(await prisma.syncOperation.count({ where: { tenantId: TENANT, status: { not: "Synced" } } })).toBe(0)
  })

  it("a sale whose revision has not reached the cloud yet is held there: nothing applied, kept pending (no attempts used), applied on retry", async () => {
    const RX = `rx-${randomUUID()}`
    expect((await till("product", "update", { syncId: LATTE, stockPolicy: "untracked", stockPolicyRev: RX, stockPolicyParentRev: RC2 })).status).toBe("ok")
    const s2 = sale(hubLatte, RX, "untracked")
    expect((await till("sale", "create", s2.payload)).status).toBe("ok")
    // The product change has not been forwarded (e.g. it is stuck behind a failure); only the sale goes.
    const upd = (await prisma.syncOperation.findFirst({ where: { tenantId: TENANT, entity: "product", status: "Pending" } }))!
    await prisma.syncOperation.update({ where: { id: upd.id }, data: { status: "Failed" } })
    await bridge.pushToCloudOnce()
    const op = (await prisma.syncOperation.findFirst({ where: { tenantId: TENANT, entity: "sale", status: { not: "Synced" } } }))!
    expect([op.status, op.attempts]).toEqual(["Pending", 0])
    expect(op.error).toMatch(/^STOCK_POLICY_HELD:/)
    expect(await cloudPrisma.sale.count({ where: { id: s2.id } })).toBe(0)
    expect(await stock(cloudPrisma, LATTE)).toBe(10)
    // the change reaches the cloud; the retry applies the sale under RX
    await prisma.syncOperation.update({ where: { id: upd.id }, data: { status: "Pending" } })
    await bridge.pushToCloudOnce()
    await bridge.pushToCloudOnce()
    const c2 = (await line(cloudPrisma, s2.id))!
    expect([c2.stockPolicy, c2.stockPolicyRev]).toEqual(["untracked", RX])
    expect(await stock(cloudPrisma, LATTE)).toBe(10)
    expect((await product(cloudPrisma, LATTE))!.stockPolicyRev).toBe(RX) // fast-forward: RX was made on top of RC2
  })

  it("an older till's line (no revision) for a product whose policy changed is held at the hub, not applied with today's policy", async () => {
    const before = await stock(prisma, LATTE)
    const s3 = sale(hubLatte, null, null)
    const r = await till("sale", "create", s3.payload)
    expect(r.status).toBe("error")
    expect(r.error).toMatch(/^STOCK_POLICY_HELD:/)
    expect(await prisma.sale.count({ where: { id: s3.id } })).toBe(0)
    expect(await stock(prisma, LATTE)).toBe(before)
  })

  it("...while an older till's line for a product that never changed policy applies normally", async () => {
    const WATER = randomUUID()
    expect((await till("product", "create", { syncId: WATER, name: "Water", price: 1, cost: 0.2, stock: 4, category: "Drinks", barcode: null })).status).toBe("ok")
    const w = (await product(prisma, WATER))!
    const s4 = sale({ id: w.id, syncId: WATER, name: "Water" }, null, null)
    expect((await till("sale", "create", s4.payload)).status).toBe("ok")
    expect([(await line(prisma, s4.id))!.stockPolicy, (await line(prisma, s4.id))!.stockPolicyRev]).toEqual(["tracked", "initial"])
    expect(await stock(prisma, WATER)).toBe(3)
  })

  it("a claim that contradicts the receiver's record of a revision is refused (one id, one policy)", async () => {
    const s5 = sale(hubLatte, RH, "tracked") // RH is untracked everywhere
    const r = await till("sale", "create", s5.payload)
    expect(r.status).toBe("rejected")
    expect(r.error).toMatch(/^STOCK_POLICY_MISMATCH:/)
    // and a product.update re-using a known id with another policy is refused too
    expect((await till("product", "update", { syncId: LATTE, stockPolicy: "tracked", stockPolicyRev: RH })).status).toBe("rejected")
  })
})

describe("migration defaults", () => {
  it("existing products start at revision 'initial' with an empty history; existing sale lines keep their policy with no revision", async () => {
    for (const db of [prisma, cloudPrisma]) {
      const cols = await db.$queryRaw<Array<{ table_name: string; column_name: string; column_default: string | null; is_nullable: string }>>`
        SELECT table_name, column_name, column_default, is_nullable FROM information_schema.columns
        WHERE table_schema = current_schema() AND column_name IN ('stockPolicyRev', 'stockPolicyHistory', 'stockPolicy') AND table_name IN ('Product', 'SaleItem') ORDER BY 1, 2`
      expect(cols.map((c) => [c.table_name, c.column_name, c.column_default?.replace(/::\w+.*$/, ""), c.is_nullable])).toEqual([
        ["Product", "stockPolicy", "'tracked'", "NO"],
        ["Product", "stockPolicyHistory", "'[]'", "NO"],
        ["Product", "stockPolicyRev", "'initial'", "NO"],
        ["SaleItem", "stockPolicy", "'tracked'", "NO"],
        ["SaleItem", "stockPolicyRev", undefined, "YES"],
      ])
      // rows that existed before this migration (other test stores in the scratch database) got the defaults
      const bad = await db.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "Product" WHERE "stockPolicyRev" IS NULL OR "stockPolicyRev" = ''`
      expect(Number(bad[0].n)).toBe(0)
    }
  })

  it("a product row written without any policy fields (as before the migrations) resolves to one 'initial' revision of its policy", async () => {
    const SYNC = randomUUID()
    await prisma.$executeRaw`INSERT INTO "Product" ("tenantId", "syncId", "name", "price", "cost", "stock", "category", "updatedAt") VALUES (${TENANT}, ${SYNC}, 'Legacy row', 1, 0, 2, 'Legacy', now())`
    const p = (await product(prisma, SYNC))!
    expect([p.stockPolicy, p.stockPolicyRev, p.stockPolicyHistory]).toEqual(["tracked", "initial", []])
    const s = sale({ id: p.id, syncId: SYNC, name: "Legacy row" }, null, null)
    expect((await till("sale", "create", s.payload)).status).toBe("ok")
    expect(await stock(prisma, SYNC)).toBe(1)
  })
})
