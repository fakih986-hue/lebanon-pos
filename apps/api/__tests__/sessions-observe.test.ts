import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomUUID } from "node:crypto"
import jwt from "jsonwebtoken"

// SPRINT-2 Phase C (real Postgres, real handlers): device enrollment and per-staff sessions in
// OBSERVE mode. The till's connection token (transport) stays whatever it was; the device
// credential and the staff session travel separately and are only checked and recorded — never
// used to refuse work.
process.env.JWT_SECRET = process.env.JWT_SECRET || "sessions-secret"
const prisma = (await import("../src/lib/prisma.js")).default
const app = (await import("../src/app.js")).default
const bcrypt = (await import("bcryptjs")).default
const { signStaffSession } = await import("../src/lib/credentials.js")
delete process.env.IS_LOCAL_SERVER
vi.setConfig({ testTimeout: 60_000 })

const A = randomUUID(), B = randomUUID()
const SUB_A = `so-${A.slice(0, 8)}`, SUB_B = `so-${B.slice(0, 8)}`
let server: http.Server
let base = ""
let owner = "", ownerId = "", cashierId = "", managerId = "", ownerB = ""

const addr = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const r = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", "x-titan-sync-schema": "3", "x-forwarded-for": addr(), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, body: (await r.json().catch(() => null)) as any }
}
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` })
const login = async (pin: string, sub = SUB_A) => (await call("POST", "/api/auth/login", { pin, tenantSubdomain: sub })).body.token as string
const newCode = async (token = owner) => (await call("POST", "/api/device/generate-code", {}, bearer(token))).body.code as string
const enroll = async (code: string, deviceId: string, extra: Record<string, unknown> = {}) => call("POST", "/api/device/pair", { code, deviceId, deviceName: deviceId, ...extra })
const startSession = (cred: string, pin: string, extra: Record<string, unknown> = {}) => call("POST", "/api/auth/staff-session", { pin, ...extra }, { "x-device-credential": cred })
const expenseOp = (recordedById: string, ev?: Record<string, unknown>) => ({ id: randomUUID(), entity: "expense", action: "create", payload: { id: randomUUID(), expenseNumber: `EXP-${randomUUID().slice(0, 6)}`, vendor: "Market", category: "Supplies", amount: 2, paymentMethod: "Cash", recordedById, recordedBy: "someone", createdAt: new Date().toISOString() }, ...(ev ? { ev } : {}) })
/** A till push: Authorization is the CONNECTION token; the device credential rides in its own header. */
const push = (op: Record<string, unknown>, cred?: string, connection = owner, deviceId = "till-1") =>
  call("POST", "/api/sync/push", { deviceId, operations: [op] }, { ...bearer(connection), ...(cred ? { "x-device-credential": cred } : {}) })
const evidence = (opId: string) => prisma.operationEvidence.findUnique({ where: { opId } })

beforeAll(async () => {
  server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, resolve))
  base = `http://localhost:${(server.address() as AddressInfo).port}`
  await prisma.tenant.create({ data: { id: A, name: "Sessions A (disposable)", subdomain: SUB_A } })
  await prisma.tenant.create({ data: { id: B, name: "Sessions B (disposable)", subdomain: SUB_B } })
  const mk = async (tenantId: string, name: string, pin: string, role: string, permissions: string[] = []) =>
    (await prisma.staffUser.create({ data: { tenantId, name, mobile: `so-${name}-${tenantId.slice(0, 6)}`, pin: await bcrypt.hash(pin, 12), role: role as any, permissions } as any })).id
  ownerId = await mk(A, "Owner", "7101", "Admin")
  cashierId = await mk(A, "Rana", "7102", "Cashier", ["sales.checkout", "accounting.manage"])
  managerId = await mk(A, "Sami", "7103", "Manager", ["sales.checkout", "accounting.manage", "settings.manage"])
  await mk(B, "OwnerB", "7201", "Admin")
  owner = await login("7101")
  ownerB = await login("7201", SUB_B)
})

afterAll(async () => {
  for (const t of [A, B]) {
    const where = { tenantId: t }
    for (const m of ["operationEvidence", "staffSession", "syncOperation", "syncClient", "auditEvent", "expense", "pairingCode", "device"] as const) await (prisma as any)[m].deleteMany({ where }).catch(() => undefined)
    await prisma.staffUser.deleteMany({ where })
    await prisma.tenant.deleteMany({ where: { id: t } })
  }
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await prisma.$disconnect()
})

describe("enrollment", () => {
  it("a manager's code enrolls a device once: the server assigns the device record and issues a device credential", async () => {
    const code = await newCode()
    const r = await enroll(code, "till-1")
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ ok: true, deviceId: "till-1", tenantId: A })
    expect(typeof r.body.credential).toBe("string")
    const d = await prisma.device.findFirst({ where: { tenantId: A, deviceId: "till-1" } })
    expect([d!.id, d!.credentialVersion, d!.enrolledById]).toEqual([r.body.enrolledDeviceId, 1, ownerId])
    expect((await enroll(code, "till-x")).status).toBe(403) // single use
  })

  it("concurrent use of one code enrolls exactly one device (the consume is atomic, even after a stale read)", async () => {
    const code = await newCode()
    const rs = await Promise.all(["race-1", "race-2", "race-3"].map((d) => enroll(code, d)))
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1)
    // The losing request of a race read the code as unused just before the winner consumed it.
    const unused = { ...(await prisma.pairingCode.findUnique({ where: { code } }))!, usedAt: null }
    const stale = vi.spyOn(prisma.pairingCode, "findUnique").mockResolvedValueOnce(unused as any)
    expect((await enroll(code, "race-4")).status).toBe(403)
    stale.mockRestore()
    expect(await prisma.device.count({ where: { tenantId: A, deviceId: "race-4" } })).toBe(0)
  })

  it("an expired code is refused", async () => {
    const code = await newCode()
    await prisma.pairingCode.update({ where: { code }, data: { expiresAt: new Date(Date.now() - 1000) } })
    expect((await enroll(code, "late-till")).status).toBe(403)
  })

  it("cross-store: a device of store B cannot be enrolled with store A's code (the code stays unused)", async () => {
    const code = await newCode()
    const r = await enroll(code, "b-till", { expectTenantId: B })
    expect([r.status, r.body.code]).toEqual([403, "PAIRING_OTHER_STORE"])
    expect((await prisma.pairingCode.findUnique({ where: { code } }))!.usedAt).toBeNull()
  })

  it("a device credential or a staff session is never a connection token: it cannot create codes, sync, or read lists", async () => {
    const cred = (await enroll(await newCode(), "till-2")).body.credential
    const ses = (await startSession(cred, "7102")).body.session
    for (const t of [cred, ses]) {
      expect((await call("POST", "/api/device/generate-code", {}, bearer(t))).status).toBe(401)
      expect((await call("GET", "/api/sync/pull", undefined, bearer(t))).status).toBe(401)
      expect((await call("GET", "/api/products", undefined, bearer(t))).status).toBe(401)
    }
  })

  it("re-enrolling a device supersedes its earlier credential", async () => {
    const first = (await enroll(await newCode(), "till-3")).body.credential
    const second = (await enroll(await newCode(), "till-3")).body.credential
    expect((await startSession(first, "7102")).status).toBe(401)
    expect((await startSession(second, "7102")).status).toBe(200)
    const op = expenseOp(cashierId)
    await push(op, first)
    expect((await evidence(op.id))!.deviceCheck).toBe("superseded")
  })
})

describe("staff sessions (PIN checked by this server, per device)", () => {
  let cred = ""
  beforeAll(async () => { cred = (await enroll(await newCode(), "till-s")).body.credential })

  it("needs the person's PIN every time; a wrong PIN is refused and audited", async () => {
    expect((await call("POST", "/api/auth/staff-session", {}, { "x-device-credential": cred })).status).toBe(400)
    expect((await startSession(cred, "0000")).status).toBe(401)
    expect(await prisma.auditEvent.count({ where: { tenantId: A, action: "staff.session.refused" } })).toBeGreaterThan(0)
    expect((await call("POST", "/api/auth/staff-session", { pin: "7102" })).body.code).toBe("DEVICE_NOT_ENROLLED")
  })

  it("a device of another store cannot open a session in this store", async () => {
    expect((await startSession(cred, "7102", {})).status).toBe(200)
    const r = await call("POST", "/api/auth/staff-session", { pin: "7102" }, { "x-device-credential": cred, "x-tenant-id": B })
    expect(r.status).toBe(403)
  })

  it("switching person opens a new session and ends the previous one; the connection token is unchanged", async () => {
    const rana = await startSession(cred, "7102")
    const sami = await startSession(cred, "7103")
    expect([rana.body.staff.id, sami.body.staff.id]).toEqual([cashierId, managerId])
    const old = await prisma.staffSession.findUnique({ where: { id: rana.body.sessionId } })
    expect([old!.endedAt != null, old!.endReason]).toEqual([true, "switched"])
    expect(sami.body.token).toBeUndefined() // no connection token is issued here
  })

  it("the operation records the CONNECTION account and the SESSION person separately — labelled staff-session with its limitations, not verified", async () => {
    const s = (await startSession(cred, "7102")).body.session
    const op = expenseOp(cashierId, { v: 1, session: s })
    expect((await push(op, cred)).body.results[0].status).toBe("ok")
    const e = (await evidence(op.id))!
    expect(e).toMatchObject({ evidence: "staff-session", connectionAccountId: ownerId, sessionStaffId: cashierId, actorIdClaimed: cashierId, deviceCheck: "valid", sessionCheck: "valid" })
    expect(e.limitations).toEqual(expect.arrayContaining(["observe-mode-not-enforced", "pin-checked-at-session-start-not-per-operation", "device-credential-bearer", "connection-account-not-proven-actor"]))
    expect(e.sessionAuthTime).toBeTruthy()
    expect(await prisma.operationEvidence.count({ where: { tenantId: A, evidence: { in: ["verified", "hub-attested"] } } })).toBe(0)
  })

  it("actor substitution is recorded and audited (observe: applied)", async () => {
    const s = (await startSession(cred, "7102")).body.session
    const op = expenseOp(managerId, { v: 1, session: s })
    expect((await push(op, cred)).body.results[0].status).toBe("ok")
    expect((await evidence(op.id))!.limitations).toContain("claimed-actor-differs-from-session")
    expect(await prisma.auditEvent.count({ where: { tenantId: A, action: "security.session.observed", metadata: { path: ["opId"], equals: op.id } } })).toBe(1)
  })

  it("a session sent from another device is recorded as other-device (observe: applied, audited)", async () => {
    const s = (await startSession(cred, "7102")).body.session
    const other = (await enroll(await newCode(), "till-o")).body.credential
    const op = expenseOp(cashierId, { v: 1, session: s })
    expect((await push(op, other)).body.results[0].status).toBe("ok")
    const e = (await evidence(op.id))!
    expect([e.sessionCheck, e.evidence]).toEqual(["other-device", "legacy-claimed"])
    expect(e.limitations).toContain("staff-session-other-device")
  })

  it("a session without the device credential is not accepted as one", async () => {
    const s = (await startSession(cred, "7102")).body.session
    const op = expenseOp(cashierId, { v: 1, session: s })
    await push(op)
    expect([(await evidence(op.id))!.sessionCheck, (await evidence(op.id))!.evidence]).toEqual(["no-device", "legacy-claimed"])
  })

  it("work completed under a session that ended before it arrived (switch, then reconnect) is applied and says so", async () => {
    const s = (await startSession(cred, "7102")).body.session
    const queued = expenseOp(cashierId, { v: 1, session: s })
    await startSession(cred, "7103") // the till switched person before the queue was pushed
    expect((await push(queued, cred)).body.results[0].status).toBe("ok")
    const e = (await evidence(queued.id))!
    expect(e.evidence).toBe("staff-session")
    expect(e.limitations).toContain("session-ended-before-receipt")
  })

  it("an expired session is applied and recorded as expired", async () => {
    const live = (await startSession(cred, "7102")).body
    const decoded = jwt.decode(live.session) as any
    const expired = signStaffSession({ sub: cashierId, tid: A, dev: decoded.dev, av: decoded.av, sid: live.sessionId, authTime: new Date(Date.now() - 20 * 3600_000), expiresAt: new Date(Date.now() - 3600_000) })
    const op = expenseOp(cashierId, { v: 1, session: expired })
    expect((await push(op, cred)).body.results[0].status).toBe("ok")
    expect((await evidence(op.id))!.limitations).toContain("session-expired-at-receipt")
  })

  it("a forged or foreign-key session is invalid", async () => {
    const forged = jwt.sign({ typ: "staff-session", tid: A, dev: "x", av: 1, sid: randomUUID(), auth_time: 1, amr: ["pin"] }, "not-the-key", { audience: "titan:staff-session", issuer: "titan-cloud", subject: cashierId })
    const op = expenseOp(cashierId, { v: 1, session: forged })
    await push(op, cred)
    expect((await evidence(op.id))!.sessionCheck).toBe("invalid")
  })
})

describe("revocation (observe: completed work stays recoverable)", () => {
  it("a PIN reset (authorization version) makes earlier sessions staff-revoked; the queued op still applies", async () => {
    const cred = (await enroll(await newCode(), "till-r1")).body.credential
    const s = (await startSession(cred, "7102")).body.session
    await prisma.staffUser.update({ where: { id: cashierId }, data: { tokenVersion: { increment: 1 } } })
    const op = expenseOp(cashierId, { v: 1, session: s })
    expect((await push(op, cred)).body.results[0].status).toBe("ok")
    expect([(await evidence(op.id))!.sessionCheck, (await evidence(op.id))!.evidence]).toEqual(["staff-revoked", "legacy-claimed"])
  })

  it("a deactivated staff member's session is staff-inactive", async () => {
    const tmp = await prisma.staffUser.create({ data: { tenantId: A, name: "Temp", mobile: `so-tmp-${A.slice(0, 6)}`, pin: await bcrypt.hash("7109", 12), role: "Cashier", permissions: ["sales.checkout", "accounting.manage"] } as any })
    const cred = (await enroll(await newCode(), "till-r2")).body.credential
    const s = (await startSession(cred, "7109")).body.session
    await prisma.staffUser.update({ where: { id: tmp.id }, data: { active: false } })
    const op = expenseOp(tmp.id, { v: 1, session: s })
    await push(op, cred)
    expect((await evidence(op.id))!.sessionCheck).toBe("staff-inactive")
  })

  it("revoking a device ends its sessions; its queued work is applied and recorded as from a revoked device (never dated by client time)", async () => {
    const cred = (await enroll(await newCode(), "till-r3")).body.credential
    const st = await startSession(cred, "7103")
    const op = expenseOp(managerId, { v: 1, session: st.body.session })
    expect((await call("POST", "/api/device/revoke", { deviceId: "till-r3" }, bearer(owner))).status).toBe(200)
    expect((await prisma.staffSession.findUnique({ where: { id: st.body.sessionId } }))!.endReason).toBe("device-revoked")
    expect((await startSession(cred, "7103")).status).toBe(401)
    expect((await push(op, cred)).body.results[0].status).toBe("ok")
    const e = (await evidence(op.id))!
    expect([e.deviceCheck, e.evidence]).toEqual(["revoked", "legacy-claimed"])
    expect(e.limitations).toEqual(expect.arrayContaining(["device-credential-revoked", "client-time-claimed"]))
  })

  it("another store's owner cannot revoke or list this store's devices", async () => {
    expect((await call("POST", "/api/device/revoke", { deviceId: "till-1" }, bearer(ownerB))).status).toBe(404)
    const list = await call("GET", "/api/device/list", undefined, bearer(ownerB))
    expect(JSON.stringify(list.body)).not.toContain("till-1")
  })
})

describe("legacy tills are unchanged", () => {
  it("no device credential, no session: legacy-claimed exactly as in Phase B", async () => {
    const op = expenseOp(cashierId)
    expect((await push(op)).body.results[0].status).toBe("ok")
    const e = (await evidence(op.id))!
    expect([e.evidence, e.deviceCheck, e.sessionCheck]).toEqual(["legacy-claimed", "absent", "absent"])
  })
})
