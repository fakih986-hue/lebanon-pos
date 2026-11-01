import { describe, it, expect, beforeAll, afterAll } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomUUID } from "node:crypto"
import jwt from "jsonwebtoken"

// Owner controls (real Postgres, real handlers): what the owner's Store security screen calls. The server decides:
// a stale screen or a second owner deciding at the same time is refused (nothing silently overwritten); the
// activation gate cannot be bypassed by the request; retiring and re-admitting a register record the person, and
// the register list shows enrollment, version and its own queue report.
process.env.JWT_SECRET = process.env.JWT_SECRET || "owner-controls-secret"
delete process.env.IS_LOCAL_SERVER
const prisma = (await import("../src/lib/prisma.js")).default
const app = (await import("../src/app.js")).default
const bcrypt = (await import("bcryptjs")).default
const { vi } = await import("vitest")
vi.setConfig({ testTimeout: 60_000 })

const T = randomUUID(), OWNER = randomUUID(), MAYA = randomUUID()
let server: http.Server
let base = ""
const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
const person = (id: string, role: string) => jwt.sign({ userId: id, tenantId: T, role, tokenVersion: 1, use: "person", client: "person" }, process.env.JWT_SECRET!, { expiresIn: "1h" })
async function call(method: string, p: string, body?: unknown, token = person(OWNER, "Admin")) {
  const r = await fetch(`${base}${p}`, { method, headers: { "Content-Type": "application/json", "x-forwarded-for": ip(), Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, body: (await r.json().catch(() => null)) as any }
}

beforeAll(async () => {
  server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, resolve))
  base = `http://localhost:${(server.address() as AddressInfo).port}`
  await prisma.tenant.create({ data: { id: T, name: "Owner controls IT (disposable)", subdomain: `oc-${T.slice(0, 8)}`, cloudApiKey: randomUUID() } })
  await prisma.staffUser.create({ data: { id: OWNER, tenantId: T, name: "Owner", mobile: `oc-o-${T.slice(0, 6)}`, pin: await bcrypt.hash("8401", 12), role: "Admin" } })
  await prisma.staffUser.create({ data: { id: MAYA, tenantId: T, name: "Maya", mobile: `oc-m-${T.slice(0, 6)}`, pin: await bcrypt.hash("8402", 12), role: "Manager" } })
  await prisma.syncClient.create({ data: { tenantId: T, clientKey: "device:oc-old-till", label: "Old till", syncSchema: 3, queueReport: { pending: 2, held: 0, failed: 0, staged: 0, journal: 1 } as any, queueReportedAt: new Date() } })
})

afterAll(async () => {
  for (const m of ["auditEvent", "syncClient", "staffUser"] as const) await (prisma as any)[m].deleteMany({ where: { tenantId: T } })
  await prisma.tenant.deleteMany({ where: { id: T } })
  await new Promise<void>((r) => server.close(() => r()))
  await prisma.$disconnect()
})

describe("the owner's decisions are on the version they looked at", () => {
  it("staff policy: a stale screen is refused; two owners deciding at once: one wins, the other is told to look again", async () => {
    // observe -> observe is a valid explicit decision (no gate); used here to move the version
    expect((await call("POST", "/api/sync/identity-mode", { mode: "observe", note: "baseline", expectedVersion: 0 })).body).toMatchObject({ ok: true, version: 1 })
    const stale = await call("POST", "/api/sync/identity-mode", { mode: "observe", note: "old screen", expectedVersion: 0 })
    expect([stale.status, stale.body.code, stale.body.policy?.version]).toEqual([409, "POLICY_STALE", 1])
    const [a, b] = await Promise.all([
      call("POST", "/api/sync/identity-mode", { mode: "observe", note: "owner one", expectedVersion: 1 }),
      call("POST", "/api/sync/identity-mode", { mode: "observe", note: "owner two", expectedVersion: 1 }),
    ])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    expect((await prisma.tenant.findUnique({ where: { id: T } }))?.staffPolicyVersion).toBe(2)
  })

  it("the activation gate is the server's: a request cannot skip it, whatever the screen sends", async () => {
    const r = await call("POST", "/api/sync/identity-mode", { mode: "enforce", note: "pilot", expectedVersion: 2, force: true, blockers: [] })
    expect([r.status, r.body.code]).toEqual([409, "IDENTITY_GATE"])
    expect(r.body.blockers.map((b: any) => b.reason)).toEqual(expect.arrayContaining(["topology-unset", "upgrade-needed"]))
    // a manager without the Settings permission cannot decide at all
    expect((await call("POST", "/api/sync/identity-mode", { mode: "observe", note: "manager try", expectedVersion: 2 }, person(MAYA, "Manager"))).status).toBe(403)
    // the store's setup: needs confirmation and the version
    expect((await call("POST", "/api/sync/topology", { to: "direct", note: "pilot", expectedVersion: 0 })).status).toBe(400)
  })
})

describe("registers and hubs", () => {
  it("the list shows version, enrollment and the register's own queue; retire and re-admit record the person and a reason", async () => {
    const list = (await call("GET", "/api/sync/clients")).body.clients
    const old = list.find((c: any) => c.label === "Old till")
    expect(old).toMatchObject({ kind: "register", syncSchema: 3, enrolled: false, queue: { pending: 2, journal: 1 }, retiredAt: null })
    expect((await call("POST", `/api/sync/clients/${old.id}/retire`, { note: "" })).status).toBe(400)
    expect((await call("POST", `/api/sync/clients/${old.id}/retire`, { note: "replaced by the new counter" })).status).toBe(200)
    const row = await prisma.syncClient.findUnique({ where: { id: old.id } })
    expect([row?.retiredBy, row?.retiredNote]).toEqual([OWNER, "replaced by the new counter"])
    expect((await call("GET", "/api/sync/clients")).body.clients.find((c: any) => c.id === old.id).retiredAt).toBeTruthy()
    expect((await call("POST", `/api/sync/clients/${old.id}/readmit`, { note: "back in service" })).status).toBe(200)
    const audits = await prisma.auditEvent.findMany({ where: { tenantId: T, action: { in: ["sync.client_retired", "sync.client_readmitted"] } }, select: { userId: true, userName: true } })
    expect(audits).toEqual([{ userId: OWNER, userName: "Owner" }, { userId: OWNER, userName: "Owner" }])
    // the list needs the Settings (or inventory) permission
    const cashier = randomUUID()
    await prisma.staffUser.create({ data: { id: cashier, tenantId: T, name: "Rana", mobile: `oc-c-${T.slice(0, 6)}`, pin: await bcrypt.hash("8403", 12), role: "Cashier", permissions: ["sales.checkout"] } as any })
    expect((await call("GET", "/api/sync/clients", undefined, person(cashier, "Cashier"))).status).toBe(403)
  })
})
