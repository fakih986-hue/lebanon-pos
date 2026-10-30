import { describe, it, expect, beforeAll, afterAll } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomUUID } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import jwt from "jsonwebtoken"

// SPRINT-2 Phase C (real Postgres, real handlers): a hub's tills enroll with the HUB, open staff
// sessions there, and the hub forwards their work to the cloud through its cloud link. The cloud
// must keep the original staff/device evidence the hub recorded — marked as the hub's unattested
// record (hub attestation is Phase D) — and never re-label it from the cloud link's own identity.
// Two servers in this process: a hub on the scratch database and a cloud on its cloud_it schema.
process.env.JWT_SECRET = process.env.JWT_SECRET || "sessions-relay-secret"
delete process.env.IS_LOCAL_SERVER

const TENANT = randomUUID()
const OWNER = randomUUID(), CASHIER = randomUUID()
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
const bcrypt = (await import("bcryptjs")).default
delete process.env.IS_LOCAL_SERVER
vi.setConfig({ testTimeout: 60_000 })

let hubServer: http.Server
let hubUrl = ""
let owner = ""
const stateFile = path.resolve(__dirname, "../data/sync-state.json")
let savedState: string | null = null
const addr = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
const realFetch = globalThis.fetch
globalThis.fetch = ((input: any, init: any = {}) => {
  const url = typeof input === "string" ? input : String(input?.url ?? input)
  if (!url.startsWith(cloudUrl)) return realFetch(input, init)
  const headers = new Headers(init.headers ?? {})
  if (!headers.has("x-forwarded-for")) headers.set("x-forwarded-for", addr())
  return realFetch(input, { ...init, headers })
}) as typeof fetch
const hub = async (method: string, p: string, body?: unknown, headers: Record<string, string> = {}) => {
  const r = await realFetch(`${hubUrl}${p}`, { method, headers: { "Content-Type": "application/json", "x-titan-sync-schema": "3", "x-forwarded-for": addr(), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, body: (await r.json().catch(() => null)) as any }
}
const expenseOp = (recordedById: string, ev?: Record<string, unknown>) => ({ id: randomUUID(), entity: "expense", action: "create", payload: { id: randomUUID(), expenseNumber: `EXP-${randomUUID().slice(0, 6)}`, vendor: "Market", category: "Supplies", amount: 2, paymentMethod: "Cash", recordedById, recordedBy: "Rana", createdAt: new Date().toISOString() }, ...(ev ? { ev } : {}) })

beforeAll(async () => {
  savedState = fs.existsSync(stateFile) ? fs.readFileSync(stateFile, "utf8") : null
  hubServer = http.createServer(hubApp)
  await new Promise<void>((resolve) => hubServer.listen(0, resolve))
  hubUrl = `http://localhost:${(hubServer.address() as AddressInfo).port}`
  for (const db of [prisma, cloudPrisma]) {
    await db.tenant.create({ data: { id: TENANT, name: "Session relay IT (disposable)", subdomain: `sr-${TENANT.slice(0, 8)}`, cloudApiKey: CLOUD_KEY } })
    await db.staffUser.create({ data: { id: OWNER, tenantId: TENANT, name: "Owner", mobile: `sr-o-${TENANT.slice(0, 6)}`, pin: await bcrypt.hash("8101", 12), role: "Admin" } })
    await db.staffUser.create({ data: { id: CASHIER, tenantId: TENANT, name: "Rana", mobile: `sr-c-${TENANT.slice(0, 6)}`, pin: await bcrypt.hash("8102", 12), role: "Cashier", permissions: ["sales.checkout", "accounting.manage"] } as any })
  }
  owner = jwt.sign({ userId: OWNER, tenantId: TENANT, role: "Admin", tokenVersion: 1 }, process.env.JWT_SECRET!, { expiresIn: "1h" })
})

afterAll(async () => {
  if (savedState === null) fs.rmSync(stateFile, { force: true }); else fs.writeFileSync(stateFile, savedState)
  for (const db of [prisma, cloudPrisma]) {
    const where = { tenantId: TENANT }
    for (const m of ["operationEvidence", "staffSession", "syncOperation", "syncClient", "auditEvent", "expense", "pairingCode", "device", "staffUser"] as const) await (db as any)[m].deleteMany({ where }).catch(() => undefined)
    await db.tenant.deleteMany({ where: { id: TENANT } }).catch(() => undefined)
  }
  await new Promise<void>((resolve) => hubServer.close(() => resolve()))
  await new Promise<void>((resolve) => cloudServer.close(() => resolve()))
  await prisma.$disconnect()
  await cloudPrisma.$disconnect()
})

describe("hub forwarding keeps the original staff and device evidence", () => {
  it("a till enrolled with the hub, cashier session at the hub, owner-connected: the cloud stores the hub's record as relayed, unattested", async () => {
    const code = (await hub("POST", "/api/device/generate-code", {}, { Authorization: `Bearer ${owner}` })).body.code
    const enrolled = (await hub("POST", "/api/device/pair", { code, deviceId: "lan-till-7", deviceName: "Counter 2" })).body
    const session = (await hub("POST", "/api/auth/staff-session", { pin: "8102" }, { "x-device-credential": enrolled.credential })).body
    expect(session.staff.id).toBe(CASHIER)

    const op = expenseOp(CASHIER, { v: 1, session: session.session })
    const r = await hub("POST", "/api/sync/push", { deviceId: "lan-till-7", operations: [op] }, { Authorization: `Bearer ${owner}`, "x-device-credential": enrolled.credential })
    expect(r.body.results[0].status).toBe("ok")
    const atHub = (await prisma.operationEvidence.findUnique({ where: { opId: op.id } }))!
    expect([atHub.evidence, atHub.sessionStaffId, atHub.connectionAccountId]).toEqual(["staff-session", CASHIER, OWNER])

    await bridge.pushToCloudOnce()
    const atCloud = (await cloudPrisma.operationEvidence.findUnique({ where: { opId: op.id } }))!
    expect(atCloud).toBeTruthy()
    // The cloud link is the hub's store identity: it is NOT the actor, and the cloud does not
    // check the hub's sessions itself.
    expect([atCloud.credentialKind, atCloud.evidence, atCloud.sessionCheck, atCloud.deviceCheck]).toEqual(["bridge", "legacy-claimed", null, null])
    expect(atCloud.limitations).toEqual(expect.arrayContaining(["relayed-by-hub-without-attestation", "hub-evidence-unattested"]))
    // ...but the original evidence survives forwarding intact.
    expect(atCloud.relayed).toMatchObject({
      evidence: "staff-session", sessionStaffId: CASHIER, sessionCheck: "valid", deviceCheck: "valid",
      enrolledDeviceId: enrolled.enrolledDeviceId, deviceIdClaimed: "lan-till-7", connectionAccountId: OWNER, credentialKind: "staff",
      actorIdClaimed: CASHIER,
    })
    expect((atCloud.relayed as any).sessionId).toBe(session.sessionId)
    expect((atCloud.relayed as any).limitations).toContain("observe-mode-not-enforced")
  })

  it("a re-forward (lost acknowledgement) does not change the cloud's evidence row", async () => {
    const op = expenseOp(CASHIER)
    await hub("POST", "/api/sync/push", { deviceId: "lan-till-7", operations: [op] }, { Authorization: `Bearer ${owner}` })
    await bridge.pushToCloudOnce()
    const first = await cloudPrisma.operationEvidence.findUnique({ where: { opId: op.id } })
    await prisma.syncOperation.update({ where: { id: op.id }, data: { status: "Pending", syncedAt: null } })
    await bridge.pushToCloudOnce()
    expect(await cloudPrisma.operationEvidence.findUnique({ where: { opId: op.id } })).toEqual(first)
    expect((first!.relayed as any).evidence).toBe("legacy-claimed")
  })

  it("a direct till cannot fake a relayed record: `relayed` is ignored unless it arrives through a hub's cloud link", async () => {
    const op = expenseOp(CASHIER, { v: 1, relayed: { evidence: "staff-session", sessionStaffId: CASHIER } })
    const r = await realFetch(`${cloudUrl}/api/sync/push`, { method: "POST", headers: { "Content-Type": "application/json", "x-titan-sync-schema": "3", "x-forwarded-for": addr(), Authorization: `Bearer ${owner}` }, body: JSON.stringify({ deviceId: "direct", operations: [op] }) })
    expect(((await r.json()) as any).results[0].status).toBe("ok")
    const e = (await cloudPrisma.operationEvidence.findUnique({ where: { opId: op.id } }))!
    expect([e.relayed, e.evidence]).toEqual([null, "legacy-claimed"])
  })
})
