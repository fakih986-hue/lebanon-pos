import { describe, it, expect, beforeAll, afterAll } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomUUID } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import jwt from "jsonwebtoken"

// SPRINT-2 hub batch (real Postgres, real handlers): platform-wide staff enforcement ("enforce"). A hub on
// the scratch database and a cloud on its cloud_it schema, in this process; the bridge forwards over HTTP.
//  - the policy is issued at the cloud (versioned), adopted by the hub only when newer, kept when the cloud
//    is unreachable, after a restart, or when an older/absent policy arrives; lowered only explicitly;
//  - at the hub every register operation and REST permission is the person of the verified staff session
//    on an enrolled device — an owner connection gives the cashier nothing; offline claims (other than a
//    routine sale), past sessions, substituted actors, unenrolled/old/revoked registers are held for review;
//  - the cloud authorizes a hub's forwarded work from the hub's signature (actor, device, approver and the
//    accepting server kept), holds unattested or revoked forwards, applies duplicates once;
//  - the activation gate counts every client ever seen (not an activity window).
process.env.JWT_SECRET = process.env.JWT_SECRET || "staff-enforce-secret"
delete process.env.IS_LOCAL_SERVER
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "staff-enforce-"))
process.env.TITAN_DATA_DIR = dataDir

const T = randomUUID(), GATE = randomUUID()
const OWNER = randomUUID(), MAYA = randomUUID(), RANA = randomUUID(), NOOR = randomUUID()
const PIN = { owner: "9101", maya: "9102", rana: "9103", noor: "9104" }
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
process.env.CLOUD_TENANT_ID = T
process.env.CLOUD_API_KEY = CLOUD_KEY
const prisma = (await import("../src/lib/prisma.js")).default
const hubApp = (await import("../src/app.js")).default
let bridge = await import("../src/services/cloudSync.js")
const att = await import("../src/lib/hubAttestation.js")
const policyLib = await import("../src/lib/staffPolicy.js")
const bcrypt = (await import("bcryptjs")).default
delete process.env.IS_LOCAL_SERVER
vi.setConfig({ testTimeout: 90_000 })

let hubServer: http.Server
let hubUrl = ""
const addr = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
let cloudDown = false
const realFetch = globalThis.fetch
globalThis.fetch = ((input: any, init: any = {}) => {
  const url = typeof input === "string" ? input : String(input?.url ?? input)
  if (!url.startsWith(cloudUrl)) return realFetch(input, init)
  if (cloudDown) return Promise.reject(new TypeError("fetch failed (cloud unreachable)"))
  const headers = new Headers(init.headers ?? {})
  if (!headers.has("x-forwarded-for")) headers.set("x-forwarded-for", addr())
  return realFetch(input, { ...init, headers })
}) as typeof fetch
const call = async (base: string, method: string, p: string, body?: unknown, headers: Record<string, string> = {}) => {
  const r = await realFetch(`${base}${p}`, { method, headers: { "Content-Type": "application/json", "x-titan-sync-schema": "5", "x-forwarded-for": addr(), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await r.text()
  return { status: r.status, body: (text ? JSON.parse(text) : null) as any }
}
const hub = (method: string, p: string, body?: unknown, headers: Record<string, string> = {}) => call(hubUrl, method, p, body, headers)
const login = async (base: string, pin: string, client?: "register" | "person") => (await call(base, "POST", "/api/auth/login", { pin, tenantSubdomain: `se-${T.slice(0, 8)}`, ...(client ? { client } : {}) })).body.token as string
let tea = { id: 0, syncId: "" }
let front: { credential: string }, back: { credential: string }
let ownerTransport = "", ranaTransport = "", ownerPerson = "", cloudOwnerPerson = ""
const session = async (pin: string, dev = front) => (await hub("POST", "/api/auth/staff-session", { pin }, { "x-device-credential": dev.credential })).body.session as string
const reg = (token: string, dev: { credential: string } | null, s?: string) => ({ Authorization: `Bearer ${token}`, ...(dev ? { "x-device-credential": dev.credential } : {}), ...(s ? { "x-staff-session": s } : {}) })
const push = (op: any, token = ownerTransport, dev: { credential: string } | null = front, deviceId = "se-front") =>
  hub("POST", "/api/sync/push", { deviceId, operations: [op] }, reg(token, dev)).then((r) => r.body.results?.[0] ?? r.body)
const opOf = (entity: string, action: string, payload: any, ev?: any) => ({ id: randomUUID(), entity, action, payload, ...(ev ? { ev } : {}) })
const stock = async (db = prisma) => Number((await db.product.findFirst({ where: { tenantId: T, syncId: tea.syncId } }))!.stock)
const evidence = (opId: string, db = prisma) => db.operationEvidence.findUnique({ where: { opId } })
const heldRow = (opId: string, db = prisma) => db.syncOperation.findUnique({ where: { id: opId }, select: { status: true, appliedAt: true, error: true } })
const sale = (cashierId: string, cashier: string, opts: { discount?: number; qty?: number } = {}) => {
  const id = randomUUID(), qty = opts.qty ?? 1, gross = 5 * qty, discount = opts.discount ?? 0
  return { id, saleNumber: `S-SE-${id.slice(0, 6)}`, paymentMethod: "Cash", subtotal: gross - discount, discountTotal: discount, tax: 0, total: gross - discount, cashier, cashierId, status: "Completed", createdAt: new Date().toISOString(),
    items: [{ id: tea.id, productSyncId: tea.syncId, lineId: randomUUID(), name: "Tea", quantity: qty, unitPrice: 5, total: gross, batchAllocations: [] }] }
}

beforeAll(async () => {
  hubServer = http.createServer(hubApp)
  await new Promise<void>((resolve) => hubServer.listen(0, resolve))
  hubUrl = `http://localhost:${(hubServer.address() as AddressInfo).port}`
  for (const db of [prisma, cloudPrisma]) {
    await db.tenant.create({ data: { id: T, name: "Staff enforce IT (disposable)", subdomain: `se-${T.slice(0, 8)}`, cloudApiKey: CLOUD_KEY } })
    for (const [id, name, role, pin, perms] of [[OWNER, "Owner", "Admin", PIN.owner, null], [MAYA, "Maya", "Manager", PIN.maya, null], [RANA, "Rana", "Cashier", PIN.rana, null], [NOOR, "Noor", "Cashier", PIN.noor, ["inventory.view"]]] as const)
      await db.staffUser.create({ data: { id, tenantId: T, name, mobile: `se-${id.slice(0, 8)}`, pin: await bcrypt.hash(pin, 12), role, ...(perms ? { permissions: [...perms] } : {}) } as any })
    await db.product.create({ data: { tenantId: T, syncId: `se-tea-${T.slice(0, 8)}`, name: "Tea", price: 5, cost: 2, stock: 50, barcode: `se-${T.slice(0, 8)}`, category: "Drinks" } })
  }
  const p = (await prisma.product.findFirst({ where: { tenantId: T } }))!
  tea = { id: p.id, syncId: p.syncId! }
  ownerTransport = await login(hubUrl, PIN.owner, "register")
  ranaTransport = await login(hubUrl, PIN.rana, "register")
  ownerPerson = await login(hubUrl, PIN.owner, "person")
  cloudOwnerPerson = await login(cloudUrl, PIN.owner, "person")
  const pair = async (deviceId: string) => {
    const code = (await hub("POST", "/api/device/generate-code", {}, { Authorization: `Bearer ${ownerPerson}` })).body.code
    return (await hub("POST", "/api/device/pair", { code, deviceId, deviceName: deviceId })).body as { credential: string }
  }
  front = await pair("se-front"); back = await pair("se-back")
  // the hub's key, enrolled with the owner's PIN (forwarding is signed from here on)
  expect((await hub("POST", "/api/setup/hub-key", { pin: PIN.owner })).status).toBe(200)
})

afterAll(async () => {
  globalThis.fetch = realFetch
  for (const db of [prisma, cloudPrisma]) {
    for (const tenantId of [T, GATE]) {
      const where = { tenantId }
      for (const m of ["reviewResolution", "managerApproval", "operationEvidence", "staffSession", "syncOperation", "syncClient", "auditEvent", "cashMovement", "refundItem", "saleRefund", "saleItem", "sale", "stockMovement", "hubKey", "pairingCode", "device", "product", "staffUser"] as const) {
        if (m === "refundItem") await (db as any).refundItem.deleteMany({ where: { refund: { tenantId } } }).catch(() => undefined)
        else await (db as any)[m].deleteMany({ where }).catch(() => undefined)
      }
      await db.tenant.deleteMany({ where: { id: tenantId } }).catch(() => undefined)
    }
  }
  await new Promise<void>((resolve) => hubServer.close(() => resolve()))
  await new Promise<void>((resolve) => cloudServer.close(() => resolve()))
  await prisma.$disconnect()
  await cloudPrisma.$disconnect()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

describe("activation: every client ever seen, every approved device, hubs by key and signature", () => {
  it("old, long-unseen, unenrolled, never-synced and account-only clients block; retired and superseded ones do not", async () => {
    await cloudPrisma.tenant.create({ data: { id: GATE, name: "Gate IT (disposable)", subdomain: `seg-${GATE.slice(0, 8)}` } })
    // (in this process the cloud's token check reads the hub's database after a module reset: the owner is in both)
    const gateOwner = randomUUID()
    await prisma.tenant.create({ data: { id: GATE, name: "Gate IT (disposable)", subdomain: `seg-${GATE.slice(0, 8)}` } })
    for (const db of [prisma, cloudPrisma]) await db.staffUser.create({ data: { id: gateOwner, tenantId: GATE, name: "Gate owner", mobile: `seg-${GATE.slice(0, 6)}`, pin: await bcrypt.hash("9201", 12), role: "Admin" } })
    const longAgo = new Date(Date.now() - 90 * 86_400_000)
    const mk = (clientKey: string, syncSchema: number, lastSeenAt = new Date(), retiredAt: Date | null = null) => cloudPrisma.syncClient.create({ data: { tenantId: GATE, clientKey, label: clientKey, syncSchema, lastSeenAt, retiredAt } })
    await mk("device:old-till", 4)
    await mk("device:quiet-till", 5, longAgo) // not seen for 90 days: still counted
    await mk("device:retired-till", 3, longAgo, new Date())
    await mk("user:legacy-account", 2)
    await mk("hub-bridge@3", 3, new Date(Date.now() - 3_600_000)) // the same hub before its upgrade
    await mk("hub-bridge@5", 5) // its upgraded link: no hub key enrolled
    await cloudPrisma.device.create({ data: { tenantId: GATE, deviceId: "quiet-till", deviceName: "Quiet till", status: "APPROVED", credentialVersion: 1, enrolledAt: new Date() } as any })
    await cloudPrisma.device.create({ data: { tenantId: GATE, deviceId: "never-synced", deviceName: "Spare till", status: "APPROVED" } as any })
    const owner = jwt.sign({ userId: (await cloudPrisma.staffUser.findFirst({ where: { tenantId: GATE } }))!.id, tenantId: GATE, role: "Admin", tokenVersion: 1, use: "person" }, process.env.JWT_SECRET!, { expiresIn: "1h" })
    const gate = await call(cloudUrl, "GET", "/api/sync/identity-gate", undefined, { Authorization: `Bearer ${owner}` })
    expect(gate.status, JSON.stringify(gate.body)).toBe(200)
    const reasons = Object.fromEntries((gate.body.enforceBlockers as any[]).map((b) => [b.label, b.reason]))
    expect(reasons).toEqual({ "device:old-till": "upgrade-needed", "device:quiet-till": "no-identity-evidence", "user:legacy-account": "no-device-id", "hub-bridge@5": "hub-not-enrolled", "Spare till": "device-not-enrolled", "Store setup": "topology-unset" })
    const refused = await call(cloudUrl, "POST", "/api/sync/identity-mode", { mode: "enforce", note: "pilot" }, { Authorization: `Bearer ${owner}` })
    expect([refused.status, refused.body.code]).toEqual([409, "IDENTITY_GATE"])
    expect((await policyLib.storePolicy(GATE))).toMatchObject({ mode: "observe", version: 0 })
  })

  it("a register seen only through a hub without a verified session blocks until the owner retires it (with a note, audited)", async () => {
    const owner = jwt.sign({ userId: (await cloudPrisma.staffUser.findFirst({ where: { tenantId: GATE } }))!.id, tenantId: GATE, role: "Admin", tokenVersion: 1, use: "person" }, process.env.JWT_SECRET!, { expiresIn: "1h" })
    const ev = (opId: string, relayed: Record<string, unknown>, receivedAt: Date) => cloudPrisma.operationEvidence.create({ data: { opId, tenantId: GATE, entity: "sale", action: "create", acceptedBy: "cloud", transport: "hub-bridge", credentialKind: "bridge", evidence: "hub-attested", attestation: "valid", relayed: relayed as any, receivedAt } })
    // the old hub till: its latest forwarded operation had no session; an earlier one did (the latest decides)
    await ev(randomUUID(), { deviceIdClaimed: "old-hub-till", deviceCheck: "valid", sessionCheck: "valid" }, new Date(Date.now() - 7_200_000))
    await ev(randomUUID(), { deviceIdClaimed: "old-hub-till", deviceCheck: "absent", sessionCheck: "absent" }, new Date(Date.now() - 3_600_000))
    await ev(randomUUID(), { enrolledDeviceId: "good-hub-till", deviceCheck: "valid", sessionCheck: "valid" }, new Date())
    const blockers = async () => ((await call(cloudUrl, "GET", "/api/sync/identity-gate", undefined, { Authorization: `Bearer ${owner}` })).body.enforceBlockers as any[]).filter((b) => b.reason === "hub-register-unverified").map((b) => b.id)
    expect(await blockers()).toEqual(["old-hub-till"])
    expect((await call(cloudUrl, "POST", "/api/sync/hub-registers/old-hub-till/retire", { note: "" }, { Authorization: `Bearer ${owner}` })).status).toBe(400)
    expect((await call(cloudUrl, "POST", "/api/sync/hub-registers/old-hub-till/retire", { note: "replaced by the new front till" }, { Authorization: `Bearer ${owner}` })).status).toBe(200)
    expect(await blockers()).toEqual([])
    expect(await cloudPrisma.auditEvent.count({ where: { tenantId: GATE, action: "sync.client_retired", summary: { contains: "old-hub-till" } } })).toBe(1)
  })
})

describe("policy: issued at the cloud, adopted by the hub only when newer, never silently lowered", () => {
  it("before enforcement: an owner connection authorizes as the owner (observe); the hub's registers prove themselves", async () => {
    // observe: a cashier on the owner's connection sells with a discount (the owner may)
    const rana = await session(PIN.rana)
    const s = sale(RANA, "Rana", { discount: 1 })
    expect((await push(opOf("sale", "create", s, { v: 1, session: rana }))).status).toBe("ok")
    // a register behind the hub, observed with a valid device and session, forwarded signed
    await bridge.pushToCloudOnce()
    expect((await evidence((await prisma.syncOperation.findFirst({ where: { tenantId: T, entity: "sale" } }))!.id, cloudPrisma))?.attestation).toBe("valid")
  })

  it("the cloud issues enforce (version 1); a hub cannot issue it; the hub adopts it from its pull", async () => {
    // operational readiness: the store chose its topology (registers behind this hub; store-topology.test.ts)
    await cloudPrisma.tenant.update({ where: { id: T }, data: { storeTopology: "hub", topologyHubId: (await import("../src/lib/topology.js")).hubIdentity().hubId, topologyVersion: 1 } })
    // (this in-process hub mostly answers without hub mode, so it would apply the topology rules of a cloud: its own
    // copy is pinned at a higher version so it does not adopt the cloud's; hub adoption is tested in store-topology)
    await prisma.tenant.update({ where: { id: T }, data: { topologyVersion: 1000 } })
    process.env.IS_LOCAL_SERVER = "true"
    const atHub = await hub("POST", "/api/sync/identity-mode", { mode: "observe", note: "local try" }, { Authorization: `Bearer ${ownerPerson}` })
    delete process.env.IS_LOCAL_SERVER
    expect([atHub.status, atHub.body.code]).toEqual([409, "HUB_SERVER"])
    // a connection token is not the owner signing in for themselves
    const viaTransport = await call(cloudUrl, "POST", "/api/sync/identity-mode", { mode: "enforce", note: "pilot" }, { Authorization: `Bearer ${await login(cloudUrl, PIN.owner)}` })
    expect(viaTransport.status, JSON.stringify(viaTransport.body)).toBe(200) // observe store: an older token still acts as its person
    const v = (await policyLib.storePolicy(T))
    expect(v.mode).toBe("observe") // the hub has not pulled yet
    const cloudPolicy = await call(cloudUrl, "GET", "/api/sync/identity-gate", undefined, { Authorization: `Bearer ${cloudOwnerPerson}` })
    expect(cloudPolicy.body.policy).toMatchObject({ mode: "enforce", version: 1 })
    await bridge.pullFromCloud()
    expect(await policyLib.storePolicy(T)).toMatchObject({ mode: "enforce", version: 1, issuedBy: OWNER })
  })

  it("the hub keeps enforcing: cloud unreachable, a restart, an absent or older policy", async () => {
    cloudDown = true
    await expect(bridge.pullFromCloud()).rejects.toThrow()
    cloudDown = false
    expect((await policyLib.storePolicy(T)).mode).toBe("enforce")
    expect(await policyLib.adoptPolicy(T, undefined)).toBe("kept")
    expect(await policyLib.adoptPolicy(T, { mode: "observe", version: 0 })).toBe("kept")
    expect(await policyLib.adoptPolicy(T, { mode: "observe", version: 1 })).toBe("kept")
    vi.resetModules()
    bridge = await import("../src/services/cloudSync.js")
    const restarted = await import("../src/lib/staffPolicy.js")
    expect((await restarted.storePolicy(T)).mode).toBe("enforce")
  })
})

describe("enforced at the hub: the session's person, never the connection", () => {
  it("a cashier on the owner's connection: no session, refused; her own session: her permissions, not the owner's", async () => {
    const before = await stock()
    const noSession = await push(opOf("sale", "create", sale(OWNER, "Owner", { discount: 1 })))
    expect(noSession.error).toMatch(/^IDENTITY_REQUIRED: .*no staff session/)
    const rana = await session(PIN.rana)
    const discounted = await push(opOf("sale", "create", sale(RANA, "Rana", { discount: 1 }), { v: 1, session: rana }))
    expect(discounted.error).toMatch(/discount|permission/i)
    // a routine sale: applied as Rana (cashier fields are hers whatever the register wrote)
    const routine = opOf("sale", "create", sale(RANA, "Rana"), { v: 1, session: rana })
    expect((await push(routine)).status).toBe("ok")
    expect(await prisma.sale.findFirst({ where: { tenantId: T, id: routine.payload.id }, select: { cashierId: true } })).toEqual({ cashierId: RANA })
    expect(await stock()).toBe(before - 1)
    // a refund and a payout: not hers to make; a substituted actor is refused as such
    const refund = { id: randomUUID(), saleId: routine.payload.id, method: "Cash", reason: "IT", total: 5, cashier: "Rana", cashierId: RANA, items: [{ id: tea.id, saleLineId: routine.payload.items[0].lineId, name: "Tea", quantity: 1, unitPrice: 5, total: 5 }] }
    expect((await push(opOf("refund", "create", refund, { v: 1, session: rana }))).error).toMatch(/permission/i)
    const payoutAsOwner = { id: randomUUID(), type: "CashOut", direction: "Out", amountUsd: 5, reason: "Pay", note: "", recordedById: OWNER, recordedByName: "Owner", createdAt: new Date().toISOString() }
    expect((await push(opOf("cash-movement", "create", payoutAsOwner, { v: 1, session: rana }))).error).toMatch(/^IDENTITY_MISMATCH:/)
    expect(await stock()).toBe(before - 1)
    expect(await prisma.cashMovement.count({ where: { tenantId: T } })).toBe(0)
  })

  it("with a manager's approval the same cashier's refund applies; Rana stays the actor, Maya the approver", async () => {
    const rana = await session(PIN.rana)
    const s = opOf("sale", "create", sale(RANA, "Rana"), { v: 1, session: rana })
    expect((await push(s)).status).toBe("ok")
    const refund = { id: randomUUID(), saleId: s.payload.id, method: "Cash", reason: "IT", total: 5, cashier: "Rana", cashierId: RANA, items: [{ id: tea.id, saleLineId: s.payload.items[0].lineId, name: "Tea", quantity: 1, unitPrice: 5, total: 5 }] }
    const a = await hub("POST", "/api/approvals", { entity: "refund", action: "create", payload: refund, permission: "sales.refund", pin: PIN.maya }, reg(ownerTransport, front, rana))
    expect(a.status).toBe(200)
    const op = opOf("refund", "create", refund, { v: 1, session: rana, approval: a.body.approvalId })
    expect((await push(op)).status).toBe("ok")
    const e = (await evidence(op.id))!
    expect([e.sessionStaffId, e.evidence, (e.approval as any)?.approverId]).toEqual([RANA, "verified", MAYA])
  })

  it("S4 enforced online: a substituted actor obtains no authority — the sale is the session person's, a payout naming someone else is held", async () => {
    const rana = await session(PIN.rana)
    const named = opOf("sale", "create", sale(OWNER, "Owner"), { v: 1, session: rana })
    expect((await push(named)).status).toBe("ok")
    // recorded as Rana's (the person whose PIN the server checked), never as the owner the register named
    expect(await prisma.sale.findFirst({ where: { tenantId: T, id: named.payload.id }, select: { cashierId: true, cashier: true } })).toEqual({ cashierId: RANA, cashier: "Rana" })
    const e = (await evidence(named.id))!
    expect([e.evidence, e.sessionStaffId, e.actorIdClaimed]).toEqual(["verified", RANA, OWNER])
    // the owner's discount authority is not obtained by naming her
    expect((await push(opOf("sale", "create", sale(OWNER, "Owner", { discount: 1 }), { v: 1, session: rana }))).error).toMatch(/discount|permission/i)
  })

  it("a manager's own session: her permissions; staff without checkout cannot sell; offline and past sessions are held", async () => {
    const maya = await session(PIN.maya)
    const payout = { id: randomUUID(), type: "CashOut", direction: "Out", amountUsd: 4, reason: "Ice delivery", note: "", recordedById: MAYA, recordedByName: "Maya", createdAt: new Date().toISOString() }
    expect((await push(opOf("cash-movement", "create", payout, { v: 1, session: maya }))).status).toBe("ok")
    const noor = await session(PIN.noor)
    expect((await push(opOf("sale", "create", sale(NOOR, "Noor"), { v: 1, session: noor }))).error).toMatch(/not allowed to sell/)
    // offline: a routine sale is accepted as claimed; a payout is held for review
    const offlineSale = opOf("sale", "create", sale(RANA, "Rana"), { v: 1, offline: true })
    expect((await push(offlineSale)).status).toBe("ok")
    expect((await evidence(offlineSale.id))?.evidence).toBe("offline-claimed")
    const offlinePayout = opOf("cash-movement", "create", { ...payout, id: randomUUID(), recordedById: RANA, recordedByName: "Rana" }, { v: 1, offline: true })
    expect((await push(offlinePayout)).error).toMatch(/^OFFLINE_REVIEW:/)
    expect((await heldRow(offlinePayout.id))?.status).toBe("Refused")
    // a session that has ended: completed work kept for review, not applied
    const ended = await session(PIN.maya)
    expect((await hub("POST", "/api/auth/staff-session/end", { session: ended }, { "x-device-credential": front.credential })).body.ended).toBe(true)
    const late = opOf("cash-movement", "create", { ...payout, id: randomUUID() }, { v: 1, session: ended })
    expect((await push(late)).error).toMatch(/^SESSION_REVIEW:/)
  })

  it("old, unenrolled, revoked and unknown registers are refused at the boundary and their work kept (no silent downgrade)", async () => {
    // a register on an older version: no device credential, no session
    const old = opOf("sale", "create", sale(RANA, "Rana"))
    const r1 = await hub("POST", "/api/sync/push", { deviceId: "se-front", operations: [old] }, { Authorization: `Bearer ${ownerTransport}`, "x-titan-sync-schema": "3" })
    expect(r1.body.results[0].error).toMatch(/^IDENTITY_REQUIRED: .*device credential absent/)
    expect((await heldRow(old.id))?.status).toBe("Refused")
    // revoked register
    await prisma.device.updateMany({ where: { tenantId: T, deviceId: "se-back" }, data: { status: "REVOKED" } })
    const rana = await session(PIN.rana, front)
    const viaRevoked = await push(opOf("sale", "create", sale(RANA, "Rana"), { v: 1, session: rana }), ownerTransport, back, "se-back")
    expect(String(viaRevoked.error ?? viaRevoked.code)).toMatch(/IDENTITY_REQUIRED|DEVICE_NOT_APPROVED|revoked/i)
    // the review lists the held work for a person who may decide (historical review)
    const list = (await hub("GET", "/api/sync/refused", undefined, { Authorization: `Bearer ${ownerPerson}` })).body.operations as any[]
    expect(list.some((o) => o.id === old.id && o.category === "identity-missing")).toBe(true)
  })

  it("a held operation resent after its session ended keeps the reason it was first held for (the reviewer sees the real cause)", async () => {
    const rana = await session(PIN.rana)
    const draw = opOf("cash-movement", "create", { id: randomUUID(), type: "CashOut", direction: "Out", amountUsd: 2, reason: "Pay", note: "", recordedById: RANA, recordedByName: "Rana", createdAt: new Date().toISOString() }, { v: 1, session: rana })
    expect((await push(draw)).error).toMatch(/permission/i)
    expect((await hub("POST", "/api/auth/staff-session/end", { session: rana }, { "x-device-credential": front.credential })).body.ended).toBe(true)
    expect((await push(draw)).error).toMatch(/^SESSION_REVIEW:/) // what the register is told now
    const listed = ((await hub("GET", "/api/sync/refused", undefined, { Authorization: `Bearer ${ownerPerson}` })).body.operations as any[]).find((o) => o.id === draw.id)
    expect([listed?.category, listed?.attempts]).toEqual(["permission-missing", 2])
    expect(listed?.reason).toMatch(/permission/i)
  })

  it("REST: the acting person decides — a cashier's session on the owner's connection is not the owner", async () => {
    const rana = await session(PIN.rana)
    const maya = await session(PIN.maya)
    const recon = (h: Record<string, string>) => hub("GET", "/api/inventory/reconciliation", undefined, h).then((r) => r.status)
    expect(await recon(reg(ownerTransport, front))).toBe(403) // no session
    expect(await recon(reg(ownerTransport, front, rana))).toBe(403) // Rana cannot adjust stock
    expect(await recon(reg(ownerTransport, front, maya))).toBe(200) // Maya can
    expect(await recon({ Authorization: `Bearer ${ownerPerson}` })).toBe(200) // the owner signed in for herself
    expect(await recon({ Authorization: `Bearer ${ranaTransport}` })).toBe(403)
    const hubScreen = jwt.sign({ userId: "__admin__", tenantId: T, role: "Admin" }, process.env.JWT_SECRET!, { expiresIn: "1h" })
    expect(await recon({ Authorization: `Bearer ${hubScreen}` })).toBe(403) // the hub's own screen without a session
    // a review decision made through the owner's connection is Rana's (refused)
    const held = (await hub("GET", "/api/sync/refused", undefined, { Authorization: `Bearer ${ownerPerson}` })).body.operations[0]
    const viaRana = await hub("POST", `/api/sync/refused/${held.id}/resolve`, { decision: "dismiss", outcome: "nothing-to-correct", note: "not mine", previewToken: held.previewToken }, reg(ownerTransport, front, rana))
    expect(viaRana.status).toBe(403)
  })
})

describe("the cloud enforces too: a hub's forwarded work by its signature", () => {
  it("forwarded applied work keeps actor, device, approver and accepting server; held work is not forwarded; duplicates once", async () => {
    await bridge.pushToCloudOnce()
    await bridge.pushToCloudOnce()
    const refund = (await prisma.syncOperation.findFirst({ where: { tenantId: T, entity: "refund", appliedAt: { not: null } } }))!
    const c = (await evidence(refund.id, cloudPrisma))!
    const relayed = (c.relayed ?? {}) as any
    // the accepting server as it recorded itself (the packaged hub records "hub")
    const atHub = (await evidence(refund.id))!
    expect([c.attestation, c.evidence, relayed.sessionStaffId, relayed.enrolledDeviceId, relayed.acceptedBy, (c.approval as any)?.approverId, (c.approval as any)?.check]).toEqual(["valid", "hub-attested", RANA, atHub.enrolledDeviceId, atHub.acceptedBy, MAYA, "valid"])
    expect((await cloudPrisma.syncOperation.findUnique({ where: { id: refund.id } }))?.appliedAt).toBeTruthy()
    expect(await cloudPrisma.saleRefund.count({ where: { tenantId: T, id: (refund.payload as any).id } })).toBe(1)
    // the routine offline sale stays a claim in the cloud
    const offline = (await prisma.operationEvidence.findFirst({ where: { tenantId: T, evidence: "offline-claimed" } }))!
    expect((await evidence(offline.opId, cloudPrisma))?.evidence).toBe("offline-claimed")
    // held at the hub: never forwarded
    expect(await cloudPrisma.syncOperation.count({ where: { tenantId: T, error: { startsWith: "OFFLINE_REVIEW" } } })).toBe(0)
  })

  it("work a manager applies on review at the hub is applied in the cloud as that reviewer", async () => {
    const first = ((await hub("GET", "/api/sync/refused", undefined, { Authorization: `Bearer ${ownerPerson}` })).body.operations as any[]).find((o) => o.entity === "cash-movement" && /OFFLINE_REVIEW/.test(o.reason))
    // the register kept resending it until its own limit (as on the packaged hub): those were refused deliveries, not forwarding attempts
    await prisma.syncOperation.update({ where: { id: first.id }, data: { attempts: 5 } })
    const held = ((await hub("GET", "/api/sync/refused", undefined, { Authorization: `Bearer ${ownerPerson}` })).body.operations as any[]).find((o) => o.id === first.id)
    const r = await hub("POST", `/api/sync/refused/${held.id}/resolve`, { decision: "apply", note: "Rana paid the ice man; counted", previewToken: held.previewToken }, { Authorization: `Bearer ${ownerPerson}` })
    expect(r.status).toBe(200)
    await bridge.pushToCloudOnce()
    const row = await cloudPrisma.syncOperation.findUnique({ where: { id: held.id }, select: { appliedAt: true } })
    expect(row?.appliedAt).toBeTruthy()
    const e = (await evidence(held.id, cloudPrisma))!
    expect((e.relayed as any)?.connectionAccountId).toBe(OWNER)
  })

  it("an unattested forward and a revoked key are held; after rotation forwarding is accepted again", async () => {
    const plain = opOf("cash-movement", "create", { id: randomUUID(), type: "CashIn", direction: "In", amountUsd: 1, reason: "float", note: "", recordedById: MAYA, recordedByName: "Maya", createdAt: new Date().toISOString() })
    const r = await call(cloudUrl, "POST", "/api/sync/push", { operations: [plain] }, { "x-cloud-key": CLOUD_KEY, "x-tenant-id": T })
    expect(r.body.results[0].error).toMatch(/^HUB_UNSUPPORTED: .*absent/)
    const kid = att.readHubKey()!.kid
    expect((await call(cloudUrl, "POST", `/api/hub-keys/${kid}/revoke`, { note: "hub stolen (test)" }, { Authorization: `Bearer ${cloudOwnerPerson}` })).status).toBe(200)
    const maya = await session(PIN.maya)
    const after = opOf("cash-movement", "create", { id: randomUUID(), type: "CashIn", direction: "In", amountUsd: 2, reason: "float", note: "", recordedById: MAYA, recordedByName: "Maya", createdAt: new Date().toISOString() }, { v: 1, session: maya })
    expect((await push(after)).status).toBe("ok")
    await bridge.pushToCloudOnce()
    expect((await cloudPrisma.syncOperation.findUnique({ where: { id: after.id }, select: { status: true, appliedAt: true } }))).toMatchObject({ status: "Refused", appliedAt: null })
    // the owner enrolls a new key (rotation); the next forward is accepted
    expect((await hub("POST", "/api/setup/hub-key", { pin: PIN.owner })).status).toBe(200)
    const next = opOf("cash-movement", "create", { id: randomUUID(), type: "CashIn", direction: "In", amountUsd: 3, reason: "float", note: "", recordedById: MAYA, recordedByName: "Maya", createdAt: new Date().toISOString() }, { v: 1, session: maya })
    expect((await push(next)).status).toBe("ok")
    await bridge.pushToCloudOnce()
    expect((await cloudPrisma.syncOperation.findUnique({ where: { id: next.id }, select: { appliedAt: true } }))?.appliedAt).toBeTruthy()
  })

  it("lowering is an explicit, newer decision: the cloud issues observe (version 2); the hub adopts it", async () => {
    expect((await call(cloudUrl, "POST", "/api/sync/identity-mode", { mode: "observe", note: "pilot over" }, { Authorization: `Bearer ${cloudOwnerPerson}` })).body).toMatchObject({ mode: "observe", version: 2 })
    await bridge.pullFromCloud()
    expect(await policyLib.storePolicy(T)).toMatchObject({ mode: "observe", version: 2 })
  })
})
