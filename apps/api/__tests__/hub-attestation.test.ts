import { describe, it, expect, beforeAll, afterAll } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomUUID, generateKeyPairSync } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import jwt from "jsonwebtoken"

// SPRINT-2 Phase D (real Postgres, real handlers): an enrolled hub signs each forwarded command and
// the evidence it recorded; the cloud verifies it against the store's enrolled key. A hub on the
// scratch database and a cloud on its cloud_it schema, in this process; the bridge forwards over HTTP.
// Under test: owner-authorized enrollment only (the cloud key alone cannot enroll), rotation and
// revocation, unknown keys, another store's key, tampered commands, an attestation replayed for another
// operation, valuation not changing the command digest, concurrent duplicate forwarding, lost
// acknowledgements, a client claim staying a claim, no secrets in review responses, and an enforcing
// store accepting an attested hub sale as the session's person while refusing unattested ones.
process.env.JWT_SECRET = process.env.JWT_SECRET || "hub-attestation-secret"
delete process.env.IS_LOCAL_SERVER
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-att-"))
process.env.TITAN_DATA_DIR = dataDir

const TENANT = randomUUID(), OTHER = randomUUID()
const OWNER = randomUUID(), CASHIER = randomUUID(), OTHER_OWNER = randomUUID()
const CLOUD_KEY = `ck-${randomUUID()}`, OTHER_KEY = `ck-${randomUUID()}`
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
const att = await import("../src/lib/hubAttestation.js")
const { commandDigest } = await import("../src/routes/sync.js")
const bcrypt = (await import("bcryptjs")).default
delete process.env.IS_LOCAL_SERVER
vi.setConfig({ testTimeout: 60_000 })

let hubServer: http.Server
let hubUrl = ""
let owner = "", cloudOwner = ""
let enrolled: { credential: string; enrolledDeviceId: string }
let session: { session: string; sessionId: string }
const addr = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
const realFetch = globalThis.fetch
globalThis.fetch = ((input: any, init: any = {}) => {
  const url = typeof input === "string" ? input : String(input?.url ?? input)
  if (!url.startsWith(cloudUrl)) return realFetch(input, init)
  const headers = new Headers(init.headers ?? {})
  if (!headers.has("x-forwarded-for")) headers.set("x-forwarded-for", addr())
  return realFetch(input, { ...init, headers })
}) as typeof fetch
const call = async (base: string, method: string, p: string, body?: unknown, headers: Record<string, string> = {}) => {
  const r = await realFetch(`${base}${p}`, { method, headers: { "Content-Type": "application/json", "x-titan-sync-schema": "4", "x-forwarded-for": addr(), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, body: (await r.json().catch(() => null)) as any }
}
const hub = (method: string, p: string, body?: unknown, headers: Record<string, string> = {}) => call(hubUrl, method, p, body, headers)
/** What the hub's cloud link sends: the store's cloud key. */
const asHubLink = (op: any, key = CLOUD_KEY, tenant = TENANT) => call(cloudUrl, "POST", "/api/sync/push", { operations: [op] }, { "x-cloud-key": key, "x-tenant-id": tenant })
const expenseOp = (ev?: Record<string, unknown>, amount = 2) => ({ id: randomUUID(), entity: "expense", action: "create", payload: { id: randomUUID(), expenseNumber: `EXP-${randomUUID().slice(0, 6)}`, vendor: "Market", category: "Supplies", amount, paymentMethod: "Cash", recordedById: CASHIER, recordedBy: "Rana", createdAt: new Date().toISOString() }, ...(ev ? { ev } : {}) })
const saleOp = (ev?: Record<string, unknown>, unitPrice = 5) => {
  const id = randomUUID()
  return { id: randomUUID(), entity: "sale", action: "create", payload: { id, saleNumber: `S-AT-${id.slice(0, 6)}`, paymentMethod: "Cash", subtotal: unitPrice, tax: 0, total: unitPrice, cashier: "Rana", cashierId: CASHIER, status: "Completed", createdAt: new Date().toISOString(), items: [{ id: 1, productSyncId: `at-${TENANT.slice(0, 8)}`, lineId: randomUUID(), name: "Attested widget", barcode: `at-${TENANT.slice(0, 8)}`, quantity: 1, unitPrice, total: unitPrice, cost: 999, batchAllocations: [] }] }, ...(ev ? { ev } : {}) }
}
const pushAtHub = (op: any) => hub("POST", "/api/sync/push", { deviceId: "lan-till-9", operations: [op] }, { Authorization: `Bearer ${owner}`, "x-device-credential": enrolled.credential })
const cloudEvidence = (opId: string) => cloudPrisma.operationEvidence.findUnique({ where: { opId } })
const cloudOp = (opId: string) => cloudPrisma.syncOperation.findUnique({ where: { id: opId } })

beforeAll(async () => {
  hubServer = http.createServer(hubApp)
  await new Promise<void>((resolve) => hubServer.listen(0, resolve))
  hubUrl = `http://localhost:${(hubServer.address() as AddressInfo).port}`
  for (const db of [prisma, cloudPrisma]) {
    await db.tenant.create({ data: { id: TENANT, name: "Attestation IT (disposable)", subdomain: `at-${TENANT.slice(0, 8)}`, cloudApiKey: CLOUD_KEY } })
    await db.staffUser.create({ data: { id: OWNER, tenantId: TENANT, name: "Owner", mobile: `at-o-${TENANT.slice(0, 6)}`, pin: await bcrypt.hash("8201", 12), role: "Admin" } })
    await db.staffUser.create({ data: { id: CASHIER, tenantId: TENANT, name: "Rana", mobile: `at-c-${TENANT.slice(0, 6)}`, pin: await bcrypt.hash("8202", 12), role: "Cashier", permissions: ["sales.checkout", "accounting.manage"] } as any })
    await db.product.create({ data: { tenantId: TENANT, syncId: `at-${TENANT.slice(0, 8)}`, name: "Attested widget", price: 5, cost: 2, stock: 100, barcode: `at-${TENANT.slice(0, 8)}`, category: "Test" } })
  }
  await cloudPrisma.tenant.create({ data: { id: OTHER, name: "Attestation IT other (disposable)", subdomain: `at2-${OTHER.slice(0, 8)}`, cloudApiKey: OTHER_KEY } })
  await cloudPrisma.staffUser.create({ data: { id: OTHER_OWNER, tenantId: OTHER, name: "Other owner", mobile: `at-x-${OTHER.slice(0, 6)}`, pin: await bcrypt.hash("8301", 12), role: "Admin" } })
  owner = jwt.sign({ userId: OWNER, tenantId: TENANT, role: "Admin", tokenVersion: 1 }, process.env.JWT_SECRET!, { expiresIn: "1h" })
  cloudOwner = owner
  const code = (await hub("POST", "/api/device/generate-code", {}, { Authorization: `Bearer ${owner}` })).body.code
  enrolled = (await hub("POST", "/api/device/pair", { code, deviceId: "lan-till-9", deviceName: "Counter 9" })).body
  session = (await hub("POST", "/api/auth/staff-session", { pin: "8202" }, { "x-device-credential": enrolled.credential })).body
})

afterAll(async () => {
  for (const db of [prisma, cloudPrisma]) {
    for (const tenantId of [TENANT, OTHER]) {
      const where = { tenantId }
      for (const m of ["operationEvidence", "staffSession", "syncOperation", "syncClient", "auditEvent", "expense", "saleItem", "sale", "stockMovement", "hubKey", "pairingCode", "device", "product", "staffUser"] as const) await (db as any)[m].deleteMany({ where }).catch(() => undefined)
      await db.tenant.deleteMany({ where: { id: tenantId } }).catch(() => undefined)
    }
  }
  await new Promise<void>((resolve) => hubServer.close(() => resolve()))
  await new Promise<void>((resolve) => cloudServer.close(() => resolve()))
  await prisma.$disconnect()
  await cloudPrisma.$disconnect()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

describe("enrollment: owner-authorized, never by sync alone", () => {
  it("the cloud key alone cannot enroll a key; a cashier's PIN cannot; another store's owner cannot; the owner's PIN can", async () => {
    const { publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" })
    const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString()
    const kid = `hub-${randomUUID()}`
    const link = { "x-cloud-key": CLOUD_KEY, "x-tenant-id": TENANT }
    expect((await call(cloudUrl, "POST", "/api/hub-keys/enroll", { kid, publicPem }, link)).status).toBe(400) // no PIN
    expect((await call(cloudUrl, "POST", "/api/hub-keys/enroll", { kid, publicPem, pin: "8202" }, link)).body.code).toBe("FORBIDDEN") // cashier
    expect((await call(cloudUrl, "POST", "/api/hub-keys/enroll", { kid, publicPem, pin: "8301" }, link)).body.code).toBe("INVALID_PIN") // other store's owner
    expect((await call(cloudUrl, "POST", "/api/hub-keys/enroll", { kid, publicPem, pin: "8201" }, { Authorization: `Bearer ${owner}` })).body.code).toBe("HUB_LINK_REQUIRED") // a staff token is not the hub
    expect(await cloudPrisma.hubKey.count({ where: { tenantId: TENANT } })).toBe(0)
    // ordinary sync cannot carry a key either: an attestation from an unenrolled key is just unknown
    const op = expenseOp()
    expect((await pushAtHub(op)).body.results[0].status).toBe("ok")
    await bridge.pushToCloudOnce()
    expect((await cloudEvidence(op.id))?.attestation).toBe("absent")
  })

  it("the hub enrolls through its own endpoint with the owner's PIN; the PIN is not stored or logged", async () => {
    const r = await hub("POST", "/api/setup/hub-key", { pin: "8201" })
    expect(r.status).toBe(200)
    const key = att.readHubKey()!
    expect([r.body.kid, !!key.enrolledAt, key.tenantId]).toEqual([key.kid, true, TENANT])
    const row = (await cloudPrisma.hubKey.findUnique({ where: { kid: key.kid } }))!
    expect([row.status, row.enrolledById]).toEqual(["ACTIVE", OWNER])
    const audits = JSON.stringify(await cloudPrisma.auditEvent.findMany({ where: { tenantId: TENANT, action: { startsWith: "hub.key" } } }))
    expect(audits).not.toContain("8201")
    expect(audits).not.toContain("8202")
    // a wrong PIN leaves the enrolled key in place
    expect((await hub("POST", "/api/setup/hub-key", { pin: "0000" })).status).toBe(401)
    expect(att.readHubKey()!.kid).toBe(key.kid)
  })
})

describe("attested forwarding", () => {
  it("the cloud verifies the hub's signature and keeps the hub's own evidence as signed", async () => {
    const op = expenseOp({ v: 1, session: session.session })
    expect((await pushAtHub(op)).body.results[0].status).toBe("ok")
    await bridge.pushToCloudOnce()
    const e = (await cloudEvidence(op.id))!
    expect([e.credentialKind, e.attestation, e.attestationKid, e.evidence]).toEqual(["bridge", "valid", att.readHubKey()!.kid, "hub-attested"])
    expect(e.limitations).toContain("hub-vouched-not-independent-pin-proof")
    expect(e.limitations).not.toContain("hub-evidence-unattested")
    expect(e.relayed).toMatchObject({ evidence: "staff-session", sessionStaffId: CASHIER, sessionCheck: "valid", deviceCheck: "valid", enrolledDeviceId: enrolled.enrolledDeviceId, connectionAccountId: OWNER })
  })

  it("a client's claim stays a claim: an offline-claimed sale is attested as offline-claimed, not as a verified person", async () => {
    const op = expenseOp({ v: 1, offline: true })
    await pushAtHub(op)
    await bridge.pushToCloudOnce()
    const e = (await cloudEvidence(op.id))!
    expect([e.attestation, e.evidence]).toEqual(["valid", "offline-claimed"])
  })

  it("server valuation does not change the command digest: the till's command and the hub's stored, valued copy match", async () => {
    const op = saleOp({ v: 1, session: session.session })
    delete (op.payload.items[0] as any).cost // the line carries no cost: the hub values it
    const tillDigest = commandDigest(op.entity, op.action, op.payload)
    expect((await pushAtHub(op)).body.results[0].status).toBe("ok")
    const stored = (await prisma.syncOperation.findUnique({ where: { id: op.id } }))!
    expect((stored.payload as any).items[0].cost).toBe(2) // the hub's valuation, written back
    expect(commandDigest(stored.entity, stored.action, stored.payload)).toBe(tillDigest)
    await bridge.pushToCloudOnce()
    expect((await cloudEvidence(op.id))?.attestation).toBe("valid")
  })

  it("a tampered command, a replayed attestation, another store's key and an unknown key are all recorded as such", async () => {
    // tampered: the hub's stored command changes after it was accepted (a different quantity)
    const tampered = expenseOp()
    await pushAtHub(tampered)
    const signedFor = (op: any) => att.signAttestation(TENANT, { id: op.id, entity: op.entity, action: op.action, digest: commandDigest(op.entity, op.action, op.payload) }, { evidence: "staff-session", sessionStaffId: CASHIER })!
    const goodAtt = signedFor(tampered)
    const changed = { ...tampered, payload: { ...tampered.payload, amount: 200 }, ev: { v: 1, fwd: { att: goodAtt } } }
    expect((await asHubLink(changed)).body.results[0].status).toBe("ok") // observe mode: applied, recorded
    expect((await cloudEvidence(changed.id))?.attestation).toBe("digest-mismatch")
    // replay: a valid attestation presented for another operation
    const other = { ...expenseOp(), ev: { v: 1, fwd: { att: goodAtt } } }
    await asHubLink(other)
    expect((await cloudEvidence(other.id))?.attestation).toBe("op-mismatch")
    // unknown key: signed by a key no store enrolled
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" })
    const stranger = expenseOp()
    const forged = jwt.sign({ typ: "hub-attestation", tid: TENANT, op: { id: stranger.id, entity: stranger.entity, action: stranger.action, digest: commandDigest(stranger.entity, stranger.action, stranger.payload) }, srv: { evidence: "staff-session" } }, privateKey.export({ type: "pkcs8", format: "pem" }), { algorithm: "ES256", keyid: `hub-${randomUUID()}`, issuer: "titan-hub", audience: `titan-cloud:${TENANT}` })
    await asHubLink({ ...stranger, ev: { v: 1, fwd: { att: forged } } })
    expect((await cloudEvidence(stranger.id))?.attestation).toBe("unknown-key")
    // another store's hub link presenting this store's valid attestation
    const cross = expenseOp()
    cross.payload.recordedById = OTHER_OWNER; cross.payload.recordedBy = "Other owner"
    const crossAtt = signedFor(cross)
    await asHubLink({ ...cross, ev: { v: 1, fwd: { att: crossAtt } } }, OTHER_KEY, OTHER)
    const ce = await cloudPrisma.operationEvidence.findUnique({ where: { opId: cross.id } })
    expect([ce?.tenantId, ce?.attestation]).toEqual([OTHER, "other-store"])
  })

  it("concurrent duplicate forwarding and a lost acknowledgement apply once and keep one evidence row", async () => {
    const op = expenseOp({ v: 1, session: session.session })
    await pushAtHub(op)
    await Promise.all([bridge.pushToCloudOnce(), bridge.pushToCloudOnce()])
    const first = await cloudEvidence(op.id)
    expect(first?.attestation).toBe("valid")
    expect(await cloudPrisma.expense.count({ where: { tenantId: TENANT, id: op.payload.id } })).toBe(1)
    await prisma.syncOperation.update({ where: { id: op.id }, data: { status: "Pending", syncedAt: null } })
    await bridge.pushToCloudOnce()
    expect((await prisma.syncOperation.findUnique({ where: { id: op.id } }))?.status).toBe("Synced")
    expect(await cloudEvidence(op.id)).toEqual(first)
    expect(await cloudPrisma.expense.count({ where: { tenantId: TENANT, id: op.payload.id } })).toBe(1)
    // a changed amount under the same id is refused by the cloud whatever the signature says
    const changed = { id: op.id, entity: op.entity, action: op.action, payload: { ...op.payload, amount: 9 } }
    expect((await asHubLink(changed)).body.results[0].error).toMatch(/OPERATION_ID_REUSED/)
  })

  it("rotation: a new enrollment rotates the key; revocation: the key is never accepted again", async () => {
    const oldKid = att.readHubKey()!.kid
    expect((await hub("POST", "/api/setup/hub-key", { pin: "8201" })).status).toBe(200)
    const newKid = att.readHubKey()!.kid
    expect((await cloudPrisma.hubKey.findUnique({ where: { kid: oldKid } }))?.status).toBe("ROTATED")
    const op = expenseOp({ v: 1, session: session.session })
    await pushAtHub(op)
    await bridge.pushToCloudOnce()
    expect([(await cloudEvidence(op.id))?.attestation, (await cloudEvidence(op.id))?.attestationKid]).toEqual(["valid", newKid])
    // revoke the current key (owner at the cloud, with a note)
    expect((await call(cloudUrl, "POST", `/api/hub-keys/${newKid}/revoke`, { note: "hub replaced" }, { Authorization: `Bearer ${cloudOwner}` })).status).toBe(200)
    const after = expenseOp({ v: 1, session: session.session })
    await pushAtHub(after)
    await bridge.pushToCloudOnce()
    expect((await cloudEvidence(after.id))?.attestation).toBe("revoked")
    const keys = (await call(cloudUrl, "GET", "/api/hub-keys", undefined, { Authorization: `Bearer ${cloudOwner}` })).body.keys as any[]
    expect(JSON.stringify(keys)).not.toContain("BEGIN")
    expect(keys.map((k) => k.status).sort()).toEqual(["REVOKED", "ROTATED"])
    // re-enroll for the remaining tests
    expect((await hub("POST", "/api/setup/hub-key", { pin: "8201" })).status).toBe(200)
  })
})

describe("an enforcing store: attested hub sales", () => {
  beforeAll(async () => { await cloudPrisma.tenant.update({ where: { id: TENANT }, data: { staffSessionMode: "enforce-checkout" } }) })
  afterAll(async () => { await cloudPrisma.tenant.update({ where: { id: TENANT }, data: { staffSessionMode: "observe" } }) })

  it("a sale on a hub-checked session is applied as that person; an unattested one is refused and kept; no secrets in the review", async () => {
    const op = saleOp({ v: 1, session: session.session })
    expect((await pushAtHub(op)).body.results[0].status).toBe("ok")
    await bridge.pushToCloudOnce()
    expect((await cloudOp(op.id))?.appliedAt).toBeTruthy()
    const sale = await cloudPrisma.sale.findFirst({ where: { tenantId: TENANT, id: op.payload.id }, select: { cashierId: true, cashier: true } })
    expect(sale).toEqual({ cashierId: CASHIER, cashier: "Rana" })
    expect((await cloudEvidence(op.id))?.evidence).toBe("hub-attested")

    // the same kind of sale with no attestation (an older hub, or a hub without an enrolled key)
    const bare = saleOp()
    const r = await asHubLink({ id: bare.id, entity: bare.entity, action: bare.action, payload: bare.payload })
    expect(r.body.results[0].error).toMatch(/^HUB_UNSUPPORTED: .*\(absent\)/)
    expect((await cloudOp(bare.id))?.status).toBe("Refused")
    // a sale the hub recorded with no session (legacy-claimed), attested: refused for the identity rule
    const noSession = saleOp()
    await pushAtHub(noSession)
    await bridge.pushToCloudOnce()
    expect((await cloudOp(noSession.id))?.error).toMatch(/IDENTITY_REQUIRED/)
    const review = await call(cloudUrl, "GET", "/api/sync/refused", undefined, { Authorization: `Bearer ${cloudOwner}` })
    const text = JSON.stringify(review.body)
    expect(review.status).toBe(200)
    expect(text).toContain(bare.id)
    for (const secret of [session.session, enrolled.credential, "BEGIN", "8201", "8202"]) expect(text).not.toContain(secret)
    expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./)
  })
})
