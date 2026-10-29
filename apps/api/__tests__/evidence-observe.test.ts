import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomUUID } from "node:crypto"
import jwt from "jsonwebtoken"

// SPRINT-2 Phase B (real Postgres, real handlers): operation evidence in OBSERVE mode. The server
// records what it knows about each applied operation, kept apart from what the client claims, and
// never labels anything "verified" or "hub-attested" before staff sessions / hub keys exist.
process.env.JWT_SECRET = process.env.JWT_SECRET || "evidence-secret"
const prisma = (await import("../src/lib/prisma.js")).default
const app = (await import("../src/app.js")).default
const bcrypt = (await import("bcryptjs")).default
delete process.env.IS_LOCAL_SERVER
vi.setConfig({ testTimeout: 60_000 })

const T = randomUUID()
const SUB = `ev-${T.slice(0, 8)}`
const KEY = `ck-${randomUUID()}`
let server: http.Server
let base = ""
let owner = "", cashier = "", ownerId = "", cashierId = ""

const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const r = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", "x-titan-sync-schema": "3", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, body: (await r.json().catch(() => null)) as any }
}
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` })
const push = (headers: Record<string, string>, op: Record<string, unknown>, deviceId = "ev-till") => call("POST", "/api/sync/push", { deviceId, operations: [op] }, headers)
const evidence = (opId: string) => prisma.operationEvidence.findUnique({ where: { opId } })
const expenseOp = (recordedById: string, extra: Record<string, unknown> = {}) => ({ id: randomUUID(), entity: "expense", action: "create", payload: { id: randomUUID(), expenseNumber: `EXP-${randomUUID().slice(0, 6)}`, vendor: "Market", category: "Supplies", amount: 2, paymentMethod: "Cash", recordedById, recordedBy: "someone", createdAt: "2026-10-30T08:00:00.000Z" }, ...extra })

beforeAll(async () => {
  server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, resolve))
  base = `http://localhost:${(server.address() as AddressInfo).port}`
  await prisma.tenant.create({ data: { id: T, name: "Evidence (disposable)", subdomain: SUB, cloudApiKey: KEY } })
  ownerId = (await prisma.staffUser.create({ data: { tenantId: T, name: "Owner", mobile: `ev-o-${T.slice(0, 6)}`, pin: await bcrypt.hash("6101", 12), role: "Admin" } })).id
  cashierId = (await prisma.staffUser.create({ data: { tenantId: T, name: "Rana", mobile: `ev-c-${T.slice(0, 6)}`, pin: await bcrypt.hash("6102", 12), role: "Cashier", permissions: ["sales.checkout", "accounting.manage"] } as any })).id
  owner = (await call("POST", "/api/auth/login", { pin: "6101", tenantSubdomain: SUB })).body.token
  cashier = (await call("POST", "/api/auth/login", { pin: "6102", tenantSubdomain: SUB })).body.token
})

afterAll(async () => {
  const where = { tenantId: T }
  for (const m of ["operationEvidence", "syncOperation", "syncClient", "auditEvent", "expense", "customer"] as const) await (prisma as any)[m].deleteMany({ where }).catch(() => undefined)
  await prisma.staffUser.deleteMany({ where })
  await prisma.tenant.deleteMany({ where: { id: T } })
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await prisma.$disconnect()
})

describe("new tokens state their kind", () => {
  it("a staff login token carries typ=staff; a token whose typ contradicts its claims is refused", async () => {
    expect((jwt.decode(owner) as any).typ).toBe("staff")
    const lying = jwt.sign({ userId: ownerId, tenantId: T, role: "Admin", typ: "customer" }, process.env.JWT_SECRET!, { expiresIn: "1h" })
    expect((await push(bearer(lying), expenseOp(ownerId))).status).toBe(403)
  })
})

describe("evidence recorded per applied operation (observe mode)", () => {
  it("owner-connected till records a cashier's expense: connecting account authenticated, actor only claimed and different", async () => {
    const op = expenseOp(cashierId)
    expect((await push(bearer(owner), op)).body.results[0].status).toBe("ok")
    const e = (await evidence(op.id as string))!
    expect(e).toMatchObject({ tenantId: T, entity: "expense", action: "create", acceptedBy: "cloud", credentialKind: "staff", connectionAccountId: ownerId, deviceIdClaimed: "ev-till", actorIdClaimed: cashierId, actorMatchesAccount: false, evidence: "legacy-claimed", claimedAt: "2026-10-30T08:00:00.000Z", envelopeVersion: 0 })
    expect(e.limitations).toEqual(expect.arrayContaining(["connection-account-not-proven-actor", "actor-differs-from-connection-account", "device-id-claimed", "client-time-claimed"]))
  })

  it("even when the claimed actor IS the connecting account, it stays legacy-claimed (a device token is not a fresh PIN check)", async () => {
    const op = expenseOp(cashierId)
    expect((await push(bearer(cashier), op)).body.results[0].status).toBe("ok")
    const e = (await evidence(op.id as string))!
    expect([e.actorMatchesAccount, e.evidence]).toEqual([true, "legacy-claimed"])
    expect(e.limitations).toContain("connection-account-not-proven-actor")
  })

  it("a hub's cloud link: relayed without attestation, no connecting staff account", async () => {
    const op = expenseOp(cashierId)
    expect((await push({ "x-cloud-key": KEY, "x-tenant-id": T }, op, "")).body.results[0].status).toBe("ok")
    const e = (await evidence(op.id as string))!
    expect([e.credentialKind, e.connectionAccountId, e.evidence]).toEqual(["bridge", null, "legacy-claimed"])
    expect(e.limitations).toContain("relayed-by-hub-without-attestation")
  })

  it("the hub's own screen (store account)", async () => {
    const hub = jwt.sign({ userId: "__admin__", tenantId: T, role: "Admin", typ: "hub-local" }, process.env.JWT_SECRET!, { expiresIn: "1h" })
    const op = expenseOp(cashierId)
    expect((await push(bearer(hub), op)).body.results[0].status).toBe("ok")
    const e = (await evidence(op.id as string))!
    expect([e.credentialKind, e.evidence]).toEqual(["hub-local", "legacy-claimed"])
    expect(e.limitations).toContain("pushed-by-hub-screen-store-account")
  })

  it("a client saying it worked offline is recorded as offline-claimed — distinct, still unverified", async () => {
    const op = expenseOp(cashierId, { ev: { v: 1, offline: true } })
    expect((await push(bearer(owner), op)).body.results[0].status).toBe("ok")
    const e = (await evidence(op.id as string))!
    expect([e.evidence, e.envelopeVersion]).toEqual(["offline-claimed", 1])
    expect(e.limitations).toContain("offline-local-pin-claimed")
  })

  it("an operation with no actor field records that it has none", async () => {
    const op = { id: randomUUID(), entity: "customer", action: "create", payload: { id: randomUUID(), name: "Walk-in", mobile: `ev-${randomUUID().slice(0, 8)}` } }
    expect((await push(bearer(owner), op)).body.results[0].status).toBe("ok")
    expect((await evidence(op.id))!.limitations).toContain("no-actor-recorded")
  })

  it("a resend is acknowledged without a second or changed evidence row; the envelope is not part of the operation's identity", async () => {
    const op = expenseOp(cashierId)
    await push(bearer(owner), op)
    const first = (await evidence(op.id as string))!
    const again = await push(bearer(cashier), { ...op, ev: { v: 1, offline: true } })
    expect(again.body.results[0].status).toBe("ok")
    expect(await prisma.operationEvidence.count({ where: { opId: op.id as string } })).toBe(1)
    expect((await evidence(op.id as string))!).toEqual(first)
  })

  it("a refused operation leaves no evidence row (only applied operations are recorded)", async () => {
    const op = expenseOp(cashierId)
    const noPerm = await prisma.staffUser.create({ data: { tenantId: T, name: "Temp", mobile: `ev-t-${T.slice(0, 6)}`, pin: await bcrypt.hash("6109", 12), role: "Cashier", permissions: ["sales.checkout"] } as any })
    const t = (await call("POST", "/api/auth/login", { pin: "6109", tenantSubdomain: SUB })).body.token
    expect((await push(bearer(t), op)).body.results[0].status).not.toBe("ok")
    expect(await evidence(op.id as string)).toBeNull()
    await prisma.staffUser.delete({ where: { id: noPerm.id } })
  })

  it("nothing is ever labelled verified or hub-attested in observe mode", async () => {
    expect(await prisma.operationEvidence.count({ where: { tenantId: T, evidence: { in: ["verified", "hub-attested"] } } })).toBe(0)
  })

  it("the evidence can be read by staff with reports.view, not by a cashier without it", async () => {
    const op = expenseOp(cashierId)
    await push(bearer(owner), op)
    expect((await call("GET", `/api/sync/evidence/${op.id}`, undefined, bearer(owner))).body.evidence).toBe("legacy-claimed")
    expect((await call("GET", `/api/sync/evidence/${op.id}`, undefined, bearer(cashier))).status).toBe(403)
  })
})
