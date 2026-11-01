import { describe, it, expect, beforeAll, afterAll } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomUUID, generateKeyPairSync } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import jwt from "jsonwebtoken"

// Operational readiness (real Postgres, real handlers): the store's topology is enforced. A cloud (cloud_it
// schema) and a hub (the scratch schema) in this process; hub requests run with IS_LOCAL_SERVER set, the
// hub's bridge runs its own code against the cloud over HTTP.
// Under test: one hub per store (a second hub cannot enroll), readiness before any change (version the owner
// looked at, open shifts, held work, register queues, hub report freshness, hub and cloud stock), the owner's
// audited decision; then a register connected straight to the cloud in a hub store (held, kept, never applied
// at the cloud, refused before payment for a live checkout, delivered once through the hub), another hub's
// forwards, a hub that adopted "direct" (refuses its registers' work, stops forwarding, guidance on pull),
// adoption only of a newer version, REST stock writes, and enforcement needing a chosen topology.
process.env.JWT_SECRET = process.env.JWT_SECRET || "store-topology-secret"
delete process.env.IS_LOCAL_SERVER
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "topo-"))
process.env.TITAN_DATA_DIR = dataDir

const TENANT = randomUUID()
const OWNER = randomUUID(), CASHIER = randomUUID()
const CLOUD_KEY = `ck-${randomUUID()}`
const SKU = `tp-${TENANT.slice(0, 8)}`
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
const topo = await import("../src/lib/topology.js")
const bcrypt = (await import("bcryptjs")).default
delete process.env.IS_LOCAL_SERVER
vi.setConfig({ testTimeout: 60_000 })

let hubServer: http.Server
let hubUrl = ""
let owner = ""
let hubTill: { credential: string }
const addr = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
const realFetch = globalThis.fetch
const call = async (base: string, method: string, p: string, body?: unknown, headers: Record<string, string> = {}) => {
  const r = await realFetch(`${base}${p}`, { method, headers: { "Content-Type": "application/json", "x-titan-sync-schema": "5", "x-forwarded-for": addr(), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, body: (await r.json().catch(() => null)) as any }
}
/** A request the hub handles (this process plays the hub while it runs). */
const atHub = async (method: string, p: string, body?: unknown, headers: Record<string, string> = {}) => {
  process.env.IS_LOCAL_SERVER = "true"
  try { return await call(hubUrl, method, p, body, headers) } finally { delete process.env.IS_LOCAL_SERVER }
}
const atCloud = (method: string, p: string, body?: unknown, headers: Record<string, string> = {}) => call(cloudUrl, method, p, body, { Authorization: `Bearer ${owner}`, ...headers })
const zeroQueue = JSON.stringify({ pending: 0, held: 0, failed: 0, staged: 0, journal: 0 })
const saleOp = (qty = 1, idPrefix = "") => {
  const id = randomUUID()
  return { id: `${idPrefix}${randomUUID()}`, entity: "sale", action: "create", payload: { id, saleNumber: `S-TP-${id.slice(0, 6)}`, paymentMethod: "Cash", subtotal: 5 * qty, tax: 0, total: 5 * qty, cashier: "Rana", cashierId: CASHIER, status: "Completed", createdAt: new Date().toISOString(), items: [{ id: 1, productSyncId: SKU, lineId: randomUUID(), name: "Topology milk", barcode: SKU, quantity: qty, unitPrice: 5, total: 5 * qty, cost: 2, batchAllocations: [] }] } }
}
const stockAt = async (db: typeof prisma) => Number((await db.product.findFirst({ where: { tenantId: TENANT, syncId: SKU }, select: { stock: true } }))!.stock)
const readiness = async (to: string, hubId?: string) => (await atCloud("GET", `/api/sync/topology?to=${to}${hubId ? `&hubId=${hubId}` : ""}`)).body
const codes = (r: any) => (r.readiness?.blockers ?? r.blockers ?? []).map((b: any) => b.code).sort()

beforeAll(async () => {
  hubServer = http.createServer(hubApp)
  await new Promise<void>((resolve) => hubServer.listen(0, resolve))
  hubUrl = `http://localhost:${(hubServer.address() as AddressInfo).port}`
  for (const db of [prisma, cloudPrisma]) {
    await db.tenant.create({ data: { id: TENANT, name: "Topology IT (disposable)", subdomain: `tp-${TENANT.slice(0, 8)}`, cloudApiKey: CLOUD_KEY } })
    await db.staffUser.create({ data: { id: OWNER, tenantId: TENANT, name: "Owner", mobile: `tp-o-${TENANT.slice(0, 6)}`, pin: await bcrypt.hash("8601", 12), role: "Admin" } })
    await db.staffUser.create({ data: { id: CASHIER, tenantId: TENANT, name: "Rana", mobile: `tp-c-${TENANT.slice(0, 6)}`, pin: await bcrypt.hash("8602", 12), role: "Cashier", permissions: ["sales.checkout"] } as any })
    await db.product.create({ data: { tenantId: TENANT, syncId: SKU, name: "Topology milk", price: 5, cost: 2, stock: 100, barcode: SKU, category: "Test" } })
  }
  owner = jwt.sign({ userId: OWNER, tenantId: TENANT, role: "Admin", tokenVersion: 1, use: "person", client: "person" }, process.env.JWT_SECRET!, { expiresIn: "1h" })
  const code = (await atHub("POST", "/api/device/generate-code", {}, { Authorization: `Bearer ${owner}` })).body.code
  hubTill = (await atHub("POST", "/api/device/pair", { code, deviceId: "hub-till-1", deviceName: "Counter 1" })).body
})

afterAll(async () => {
  for (const db of [prisma, cloudPrisma]) {
    const where = { tenantId: TENANT }
    for (const m of ["operationEvidence", "reviewResolution", "staffSession", "syncOperation", "syncClient", "auditEvent", "saleItem", "sale", "shift", "stockMovement", "inventoryBatch", "hubKey", "pairingCode", "device", "product", "staffUser"] as const) await (db as any)[m].deleteMany({ where }).catch(() => undefined)
    await db.tenant.deleteMany({ where: { id: TENANT } }).catch(() => undefined)
  }
  await new Promise<void>((resolve) => hubServer.close(() => resolve()))
  await new Promise<void>((resolve) => cloudServer.close(() => resolve()))
  await prisma.$disconnect()
  await cloudPrisma.$disconnect()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

describe("before a topology is chosen (every existing store)", () => {
  it("nothing changes: a direct register's sale applies at the cloud; enforcement needs a chosen topology", async () => {
    const op = saleOp(1)
    const r = await call(cloudUrl, "POST", "/api/sync/push", { deviceId: "cloud-till-1", operations: [op] }, { Authorization: `Bearer ${owner}` })
    expect(r.body.results[0].status).toBe("ok")
    expect(await stockAt(cloudPrisma)).toBe(99)
    await cloudPrisma.product.updateMany({ where: { tenantId: TENANT, syncId: SKU }, data: { stock: 100 } })
    const gate = (await atCloud("GET", "/api/sync/identity-gate")).body
    expect(gate.enforceBlockers.map((b: any) => b.reason)).toContain("topology-unset")
    expect((await atCloud("POST", "/api/sync/identity-mode", { mode: "enforce", note: "pilot" })).body.code).toBe("IDENTITY_GATE")
  })
})

describe("one hub per store", () => {
  it("the hub enrolls with its installation id; a second hub cannot enroll while it is active; the same hub rotates", async () => {
    const first = await bridge.enrollHubKey("8601")
    expect(first.ok).toBe(true)
    const own = topo.hubIdentity()
    const key = await cloudPrisma.hubKey.findFirst({ where: { tenantId: TENANT, status: "ACTIVE" } })
    expect(key?.hubId).toBe(own.hubId)
    // another hub (its own installation id and key), with the owner's PIN
    const { publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" })
    const second = await call(cloudUrl, "POST", "/api/hub-keys/enroll", { kid: `hub-${randomUUID()}`, publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(), pin: "8601", hubId: `hubi-${randomUUID()}`, label: "Back office PC" }, { "x-cloud-key": CLOUD_KEY, "x-tenant-id": TENANT })
    expect(second.status).toBe(409)
    expect(second.body.code).toBe("HUB_CONFLICT")
    expect(await cloudPrisma.auditEvent.count({ where: { tenantId: TENANT, action: "hub.key.refused" } })).toBe(1)
    // an enrollment without a hub id is refused (an older hub must be updated)
    expect((await call(cloudUrl, "POST", "/api/hub-keys/enroll", { kid: `hub-${randomUUID()}`, publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(), pin: "8601" }, { "x-cloud-key": CLOUD_KEY, "x-tenant-id": TENANT })).status).toBe(400)
    // the same hub rotates its key: still one active key, same hub
    expect((await bridge.enrollHubKey("8601")).ok).toBe(true)
    const keys = await cloudPrisma.hubKey.findMany({ where: { tenantId: TENANT } })
    expect(keys.filter((k) => k.status === "ACTIVE").map((k) => k.hubId)).toEqual([own.hubId])
    expect(keys.filter((k) => k.status === "ROTATED")).toHaveLength(1)
  })
})

describe("readiness before the store becomes a hub store", () => {
  it("each check blocks until cleared; a stale screen and a missing confirmation are refused; then the owner's decision is the next version", async () => {
    const own = topo.hubIdentity()
    // a direct register that has traded: its queue is unconfirmed; an open shift; the hub has not reported
    let r = await readiness("hub", own.hubId)
    expect(codes(r)).toEqual(expect.arrayContaining(["hub-not-reporting", "register-queue"]))
    const shiftId = randomUUID()
    await cloudPrisma.shift.create({ data: { id: shiftId, tenantId: TENANT, shiftNumber: "SH-TP-1", openedById: CASHIER, openedByName: "Rana" } })
    // the hub reports (signed): fresh, nothing unsent, stock as the cloud's
    expect(await bridge.sendHubReport()).toBe(true)
    r = await readiness("hub", own.hubId)
    expect(codes(r)).toEqual(["open-shifts", "register-queue"])
    expect(r.readiness.blockers.find((b: any) => b.code === "open-shifts").items[0].label).toBe("SH-TP-1")
    await cloudPrisma.shift.update({ where: { id: shiftId }, data: { status: "Closed", closedAt: new Date() } })
    // the register reports its queue with its pull: one queued sale, then empty
    await call(cloudUrl, "GET", "/api/sync/pull", undefined, { Authorization: `Bearer ${owner}`, "x-device-id": "cloud-till-1", "x-titan-queue": JSON.stringify({ pending: 1, held: 0, failed: 0, staged: 0, journal: 0 }) })
    r = await readiness("hub", own.hubId)
    expect(r.readiness.blockers.find((b: any) => b.code === "register-queue").items[0].detail).toMatch(/pending 1/)
    await call(cloudUrl, "GET", "/api/sync/pull", undefined, { Authorization: `Bearer ${owner}`, "x-device-id": "cloud-till-1", "x-titan-queue": zeroQueue })
    // hub and cloud stock disagree: named, with both figures
    await prisma.product.updateMany({ where: { tenantId: TENANT, syncId: SKU }, data: { stock: 97 } })
    await bridge.sendHubReport()
    r = await readiness("hub", own.hubId)
    expect(codes(r)).toEqual(["stock-unreconciled"])
    expect(r.readiness.blockers[0].items[0]).toMatchObject({ label: "Topology milk", detail: expect.stringMatching(/hub 97 .*cloud 100/) })
    await prisma.product.updateMany({ where: { tenantId: TENANT, syncId: SKU }, data: { stock: 100 } })
    await bridge.sendHubReport()
    expect(codes(await readiness("hub", own.hubId))).toEqual([])
    // the decision: confirmation and the version looked at are required; a stale version is refused
    expect((await atCloud("POST", "/api/sync/topology", { to: "hub", hubId: own.hubId, expectedVersion: 0, note: "pilot hub" })).status).toBe(400)
    expect((await atCloud("POST", "/api/sync/topology", { to: "hub", hubId: own.hubId, expectedVersion: 3, note: "pilot hub", confirm: true })).body.code).toBe("TOPOLOGY_STALE")
    // a register's connection account cannot decide in an enforcing store; here: a cashier cannot
    const cashier = jwt.sign({ userId: CASHIER, tenantId: TENANT, role: "Cashier", tokenVersion: 1, use: "person", client: "person" }, process.env.JWT_SECRET!, { expiresIn: "1h" })
    expect((await call(cloudUrl, "POST", "/api/sync/topology", { to: "hub", hubId: own.hubId, expectedVersion: 0, note: "pilot hub", confirm: true }, { Authorization: `Bearer ${cashier}` })).status).toBe(403)
    const ok = await atCloud("POST", "/api/sync/topology", { to: "hub", hubId: own.hubId, expectedVersion: 0, note: "pilot hub", confirm: true })
    expect(ok.body).toMatchObject({ ok: true, topology: { mode: "hub", hubId: own.hubId, version: 1 } })
    // two owners deciding on the same screen: the second is refused, nothing overwritten
    expect((await atCloud("POST", "/api/sync/topology", { to: "direct", expectedVersion: 0, note: "other owner", confirm: true })).body.code).toBe("TOPOLOGY_STALE")
    expect((await cloudPrisma.tenant.findUnique({ where: { id: TENANT } }))?.storeTopology).toBe("hub")
    expect(await cloudPrisma.auditEvent.count({ where: { tenantId: TENANT, action: "security.topology.changed" } })).toBe(1)
  })
})

describe("a hub store at the cloud", () => {
  let heldOp: ReturnType<typeof saleOp>
  it("a register connected straight to the cloud: its queued sale is held (kept, not applied), a live checkout is refused before payment, and its pull says where to connect", async () => {
    heldOp = saleOp(2)
    const r = await call(cloudUrl, "POST", "/api/sync/push", { deviceId: "cloud-till-1", operations: [heldOp] }, { Authorization: `Bearer ${owner}` })
    expect(r.body.results[0].status).toBe("error")
    expect(r.body.results[0].error).toMatch(/^TOPOLOGY_USE_HUB: .*Connect this register to the store hub/)
    expect(await stockAt(cloudPrisma)).toBe(100)
    const row = await cloudPrisma.syncOperation.findUnique({ where: { id: heldOp.id } })
    expect(row).toMatchObject({ status: "Refused", appliedAt: null })
    // a live (write-through) checkout: refused, nothing stored, the customer is not charged
    const live = saleOp(1, "wt-")
    const lr = await call(cloudUrl, "POST", "/api/sync/push", { deviceId: "cloud-till-1", operations: [live] }, { Authorization: `Bearer ${owner}` })
    expect(lr.body.results[0]).toMatchObject({ status: "rejected", error: expect.stringMatching(/take no payment/) })
    expect(await cloudPrisma.syncOperation.findUnique({ where: { id: live.id } })).toBeNull()
    // read access stays; the guidance comes with every pull and status answer
    const pull = await call(cloudUrl, "GET", "/api/sync/pull", undefined, { Authorization: `Bearer ${owner}` })
    expect(pull.status).toBe(200)
    expect(pull.body.connection).toMatchObject({ verdict: "use-hub" })
    expect(pull.body.products.length).toBeGreaterThan(0)
    expect((await call(cloudUrl, "GET", "/api/sync/status", undefined, { Authorization: `Bearer ${owner}` })).body.connection.verdict).toBe("use-hub")
    // REST stock writes at the cloud are refused (stock is kept at the hub)
    expect((await atCloud("POST", "/api/inventory/reconciliation/repair", { productId: 1, reason: "count" })).body.code).toBe("TOPOLOGY_STOCK_AUTHORITY")
  })

  it("review at the cloud: the held sale cannot be applied there (only declined, or delivered through the hub)", async () => {
    const list = (await atCloud("GET", "/api/sync/refused")).body.operations
    const item = list.find((o: any) => o.id === heldOp.id)
    expect(item.category).toBe("topology")
    const apply = await atCloud("POST", `/api/sync/refused/${heldOp.id}/resolve`, { decision: "apply", note: "apply here", previewToken: item.previewToken })
    expect(apply.body.code).toBe("TOPOLOGY_APPLY_ELSEWHERE")
    expect(await stockAt(cloudPrisma)).toBe(100)
  })

  it("the register connected to the hub resends it: applied at the hub, forwarded once, applied at the cloud", async () => {
    // the hub adopts the store's topology from its pull (its bridge does this on every pull)
    expect(await topo.adoptTopology(TENANT, (await call(cloudUrl, "GET", "/api/sync/pull", undefined, { "x-cloud-key": CLOUD_KEY, "x-tenant-id": TENANT })).body.topology)).toBe("adopted")
    const r = await atHub("POST", "/api/sync/push", { deviceId: "hub-till-1", operations: [heldOp] }, { Authorization: `Bearer ${owner}`, "x-device-credential": hubTill.credential })
    expect(r.body.results[0].status).toBe("ok")
    expect(await stockAt(prisma)).toBe(98)
    await bridge.pushToCloudOnce()
    expect(await cloudPrisma.syncOperation.findUnique({ where: { id: heldOp.id } })).toMatchObject({ appliedAt: expect.any(Date) })
    expect(await stockAt(cloudPrisma)).toBe(98)
    // a second forward is acknowledged without applying again
    await prisma.syncOperation.update({ where: { id: heldOp.id }, data: { status: "Pending" } })
    await bridge.pushToCloudOnce()
    expect(await stockAt(cloudPrisma)).toBe(98)
  })

  it("a forward the store's hub did not sign (another hub, or an unenrolled one) is held", async () => {
    const op = saleOp(1)
    const r = await call(cloudUrl, "POST", "/api/sync/push", { operations: [op] }, { "x-cloud-key": CLOUD_KEY, "x-tenant-id": TENANT })
    expect(r.body.results[0].error).toMatch(/^TOPOLOGY_OTHER_HUB:/)
    expect(await stockAt(cloudPrisma)).toBe(98)
  })
})

describe("the store moves its registers to the cloud (hub -> direct)", () => {
  it("the hub must have sent everything; after the change it refuses its registers' work, stops forwarding, and keeps the newer version", async () => {
    const own = topo.hubIdentity()
    // decline the forward that no hub vouched for (it is held work at the cloud)
    for (const o of (await atCloud("GET", "/api/sync/refused")).body.operations) {
      expect((await atCloud("POST", `/api/sync/refused/${o.id}/resolve`, { decision: "dismiss", outcome: "nothing-to-correct", note: "test forward", previewToken: o.previewToken })).body.ok).toBe(true)
    }
    // a sale at the hub not yet forwarded: the hub's report shows it unsent
    const pending = saleOp(1)
    await atHub("POST", "/api/sync/push", { deviceId: "hub-till-1", operations: [pending] }, { Authorization: `Bearer ${owner}`, "x-device-credential": hubTill.credential })
    // both registers confirm an empty queue after their latest operation (the hub's in its report)
    await atHub("GET", "/api/sync/pull", undefined, { Authorization: `Bearer ${owner}`, "x-device-credential": hubTill.credential, "x-titan-queue": zeroQueue })
    await call(cloudUrl, "GET", "/api/sync/pull", undefined, { Authorization: `Bearer ${owner}`, "x-device-id": "cloud-till-1", "x-titan-queue": zeroQueue })
    await bridge.sendHubReport()
    expect(codes(await readiness("direct"))).toEqual(["hub-unsent", "stock-unreconciled"])
    await bridge.pushToCloudOnce()
    await bridge.sendHubReport()
    expect(codes(await readiness("direct"))).toEqual([])
    const v = (await cloudPrisma.tenant.findUnique({ where: { id: TENANT } }))!.topologyVersion
    expect((await atCloud("POST", "/api/sync/topology", { to: "direct", expectedVersion: v, note: "registers to the cloud", confirm: true })).body.ok).toBe(true)
    // the hub adopts it from its pull
    const pulled = (await call(cloudUrl, "GET", "/api/sync/pull", undefined, { "x-cloud-key": CLOUD_KEY, "x-tenant-id": TENANT })).body.topology
    expect(await topo.adoptTopology(TENANT, pulled)).toBe("adopted")
    expect(await topo.adoptTopology(TENANT, { ...pulled, mode: "hub", hubId: own.hubId, version: pulled.version - 1 })).toBe("kept") // never lowered by an older one
    // its register: a queued sale is held at the hub (kept), a live checkout refused, guidance on pull
    const queued = saleOp(1)
    const q = await atHub("POST", "/api/sync/push", { deviceId: "hub-till-1", operations: [queued] }, { Authorization: `Bearer ${owner}`, "x-device-credential": hubTill.credential })
    expect(q.body.results[0]).toMatchObject({ status: "error", error: expect.stringMatching(/^TOPOLOGY_NOT_THIS_HUB: .*Connect this register to the cloud/) })
    expect((await prisma.syncOperation.findUnique({ where: { id: queued.id } }))?.status).toBe("Refused")
    const live = saleOp(1, "wt-")
    expect((await atHub("POST", "/api/sync/push", { deviceId: "hub-till-1", operations: [live] }, { Authorization: `Bearer ${owner}`, "x-device-credential": hubTill.credential })).body.results[0].status).toBe("rejected")
    expect((await atHub("GET", "/api/sync/pull", undefined, { Authorization: `Bearer ${owner}`, "x-device-credential": hubTill.credential })).body.connection.verdict).toBe("use-cloud")
    expect(await stockAt(prisma)).toBe(97)
    // the hub's review cannot apply it here
    const item = (await atHub("GET", "/api/sync/refused", undefined, { Authorization: `Bearer ${owner}` })).body.operations.find((o: any) => o.id === queued.id)
    expect((await atHub("POST", `/api/sync/refused/${queued.id}/resolve`, { decision: "apply", note: "apply", previewToken: item.previewToken }, { Authorization: `Bearer ${owner}` })).body.code).toBe("TOPOLOGY_APPLY_ELSEWHERE")
    // anything the hub still had is not forwarded any more
    await prisma.syncOperation.update({ where: { id: pending.id }, data: { status: "Pending" } })
    const cloudBefore = await cloudPrisma.syncOperation.count({ where: { tenantId: TENANT } })
    await bridge.pushToCloudOnce()
    expect(await cloudPrisma.syncOperation.count({ where: { tenantId: TENANT } })).toBe(cloudBefore)
    // the register, connected to the cloud now, sends its held sale there: applied (the cloud is the stock authority)
    const direct = await call(cloudUrl, "POST", "/api/sync/push", { deviceId: "hub-till-1", operations: [queued] }, { Authorization: `Bearer ${owner}` })
    expect(direct.body.results[0].status).toBe("ok")
    expect(await stockAt(cloudPrisma)).toBe(96)
  })
})
