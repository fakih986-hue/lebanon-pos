import { describe, it, expect, beforeAll, afterAll } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomUUID, generateKeyPairSync } from "node:crypto"
import jwt from "jsonwebtoken"

// SPRINT-2 Phase F (real Postgres, real handlers): uncertain queued work arriving at a store that
// enforces staff sessions. Each kind of revoked or uncertain identity is held, not lost and not
// applied; the review shows why, the evidence held with it, the money already collected, and what may
// be decided by whom; one decision per operation, on the preview the reviewer saw, whole operations
// only; a decline states what happened to the money.
process.env.JWT_SECRET = process.env.JWT_SECRET || "review-queue-secret"
delete process.env.IS_LOCAL_SERVER
const prisma = (await import("../src/lib/prisma.js")).default
const app = (await import("../src/app.js")).default
const bcrypt = (await import("bcryptjs")).default
const { commandDigest } = await import("../src/routes/sync.js")
const { vi } = await import("vitest")
vi.setConfig({ testTimeout: 60_000 })

const T = randomUUID(), OTHER = randomUUID()
const OWNER = randomUUID(), RANA = randomUUID(), SAMI = randomUUID(), LEA = randomUUID(), KIM = randomUUID(), OTHER_OWNER = randomUUID()
const CLOUD_KEY = `ck-${randomUUID()}`
let server: http.Server, base = ""
let owner = "", otherOwner = "", productId = 0
const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
async function call(method: string, p: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(`${base}${p}`, { method, headers: { "Content-Type": "application/json", "x-titan-sync-schema": "4", "x-forwarded-for": ip(), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await r.text()
  return { status: r.status, body: (text ? JSON.parse(text) : null) as any, text }
}
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` })
const sale = (cashierId: string, cashier: string, unitPrice = 5, discount = 0) => {
  const id = randomUUID()
  return { id: randomUUID(), entity: "sale", action: "create", payload: { id, saleNumber: `S-RQ-${id.slice(0, 6)}`, paymentMethod: "Cash", subtotal: unitPrice - discount, discountTotal: discount, tax: 0, total: unitPrice - discount, cashier, cashierId, status: "Completed", createdAt: new Date().toISOString(), items: [{ id: productId, lineId: randomUUID(), name: "Review widget", quantity: 1, unitPrice, total: unitPrice, batchAllocations: [] }] } }
}
const enroll = async (deviceId: string) => {
  const code = (await call("POST", "/api/device/generate-code", {}, bearer(owner))).body.code
  return (await call("POST", "/api/device/pair", { code, deviceId, deviceName: deviceId })).body as { credential: string }
}
const sessionFor = async (dev: { credential: string }, pin: string) => (await call("POST", "/api/auth/staff-session", { pin }, { "x-device-credential": dev.credential })).body.session as string
const push = (op: any, dev?: { credential: string }, deviceId = "rq-till") => call("POST", "/api/sync/push", { deviceId, operations: [op] }, { ...bearer(owner), ...(dev ? { "x-device-credential": dev.credential } : {}) }).then((r) => r.body.results[0])
const review = async (token = owner) => (await call("GET", "/api/sync/refused", undefined, bearer(token))).body.operations as any[]
const held = async (opId: string) => (await review()).find((o) => o.id === opId)
const stock = async () => Number((await prisma.product.findUnique({ where: { id: productId } }))!.stock)
const resolve = (opId: string, body: Record<string, unknown>, token = owner) => call("POST", `/api/sync/refused/${opId}/resolve`, body, bearer(token))

beforeAll(async () => {
  server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, resolve))
  base = `http://localhost:${(server.address() as AddressInfo).port}`
  await prisma.tenant.create({ data: { id: T, name: "Review queue IT (disposable)", subdomain: `rq-${T.slice(0, 8)}`, cloudApiKey: CLOUD_KEY } })
  await prisma.tenant.create({ data: { id: OTHER, name: "Review queue other (disposable)", subdomain: `rq2-${OTHER.slice(0, 8)}` } })
  for (const [id, tenantId, name, role, pin, perms] of [
    [OWNER, T, "Owner", "Admin", "3301", null], [RANA, T, "Rana", "Cashier", "3302", ["sales.checkout"]], [SAMI, T, "Sami", "Cashier", "3303", ["sales.checkout"]],
    [LEA, T, "Lea", "Cashier", "3304", ["sales.checkout"]], [KIM, T, "Kim", "Cashier", "3305", ["sales.checkout"]], [OTHER_OWNER, OTHER, "Other owner", "Admin", "3401", null],
  ] as const) await prisma.staffUser.create({ data: { id, tenantId, name, mobile: `rq-${id.slice(0, 8)}`, pin: await bcrypt.hash(pin, 12), role, ...(perms ? { permissions: [...perms] } : {}) } as any })
  owner = jwt.sign({ userId: OWNER, tenantId: T, role: "Admin", tokenVersion: 1 }, process.env.JWT_SECRET!, { expiresIn: "1h" })
  otherOwner = jwt.sign({ userId: OTHER_OWNER, tenantId: OTHER, role: "Admin", tokenVersion: 1 }, process.env.JWT_SECRET!, { expiresIn: "1h" })
  productId = (await prisma.product.create({ data: { tenantId: T, name: "Review widget", price: 5, cost: 2, stock: 100, barcode: `rq-${T.slice(0, 8)}`, category: "Test" } })).id
  await prisma.tenant.update({ where: { id: T }, data: { staffSessionMode: "enforce-checkout" } })
})

afterAll(async () => {
  for (const tenantId of [T, OTHER]) {
    const where = { tenantId }
    for (const m of ["reviewResolution", "managerApproval", "operationEvidence", "staffSession", "syncOperation", "syncClient", "auditEvent", "saleItem", "sale", "stockMovement", "hubKey", "pairingCode", "device", "product", "staffUser"] as const) await (prisma as any)[m].deleteMany({ where }).catch(() => undefined)
    await prisma.tenant.deleteMany({ where: { id: tenantId } }).catch(() => undefined)
  }
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await prisma.$disconnect()
})

const ops: Record<string, any> = {}
describe("revoked or uncertain identity is held for review, with its reason", () => {
  it("device revoked, staff deactivated, PIN reset, permission removed, session ended, hub key revoked", async () => {
    const before = await stock()
    // device revoked after the cashier's session started
    const devA = await enroll("rq-till-a")
    const ranaSession = await sessionFor(devA, "3302")
    expect((await call("POST", "/api/device/revoke", { deviceId: "rq-till-a" }, bearer(owner))).status).toBe(200)
    ops.deviceRevoked = { ...sale(RANA, "Rana"), ev: { v: 1, session: ranaSession } }
    // PIN reset: the session's authorization version is now out of date
    const devB = await enroll("rq-till-b")
    const samiSession = await sessionFor(devB, "3303")
    await prisma.staffUser.update({ where: { id: SAMI }, data: { tokenVersion: { increment: 1 } } })
    ops.pinReset = { ...sale(SAMI, "Sami"), ev: { v: 1, session: samiSession } }
    // permission removed after the session started
    const leaSession = await sessionFor(devB, "3304")
    await prisma.staffUser.update({ where: { id: LEA }, data: { permissions: ["inventory.view"] } })
    ops.permissionRemoved = { ...sale(LEA, "Lea"), ev: { v: 1, session: leaSession } }
    // deactivated while the register was offline (an offline-claimed sale naming her)
    await prisma.staffUser.update({ where: { id: KIM }, data: { active: false } })
    ops.staffDeactivated = { ...sale(KIM, "Kim"), ev: { v: 1, offline: true } }
    // a discounted sale arriving after its session was signed out
    const rana2 = await sessionFor(devB, "3302")
    await prisma.staffSession.updateMany({ where: { tenantId: T, staffId: RANA, endedAt: null }, data: { endedAt: new Date(), endReason: "signed-out" } })
    ops.sessionEnded = { ...sale(RANA, "Rana", 5, 1), ev: { v: 1, session: rana2 } }

    for (const [k, dev] of [["deviceRevoked", devA], ["pinReset", devB], ["permissionRemoved", devB], ["staffDeactivated", devB], ["sessionEnded", devB]] as const) {
      const r = await push(ops[k], dev)
      expect([k, r.status]).toEqual([k, "rejected"])
    }
    // a hub whose key was revoked forwards a sale
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" })
    const kid = `hub-${randomUUID()}`
    await prisma.hubKey.create({ data: { kid, tenantId: T, publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(), status: "REVOKED", enrolledById: OWNER, revokedAt: new Date() } })
    ops.hubKeyRevoked = sale(RANA, "Rana")
    const att = jwt.sign({ typ: "hub-attestation", tid: T, op: { id: ops.hubKeyRevoked.id, entity: "sale", action: "create", digest: commandDigest("sale", "create", ops.hubKeyRevoked.payload) }, srv: { evidence: "staff-session", sessionStaffId: RANA, sessionCheck: "valid", deviceCheck: "valid" } },
      privateKey.export({ type: "pkcs8", format: "pem" }), { algorithm: "ES256", keyid: kid, issuer: "titan-hub", audience: `titan-cloud:${T}` })
    const hubPush = await call("POST", "/api/sync/push", { operations: [{ ...ops.hubKeyRevoked, ev: { v: 1, fwd: { att } } }] }, { "x-cloud-key": CLOUD_KEY, "x-tenant-id": T })
    expect(hubPush.body.results[0].error).toMatch(/^HUB_UNSUPPORTED: .*\(revoked\)/)

    // nothing was applied, nothing was lost
    expect(await stock()).toBe(before)
    const list = await review()
    const category = (k: string) => list.find((o) => o.id === ops[k].id)?.category
    expect(Object.fromEntries(Object.keys(ops).map((k) => [k, category(k)]))).toEqual({
      deviceRevoked: "device-revoked", pinReset: "pin-reset-or-session-revoked", permissionRemoved: "permission-missing",
      staffDeactivated: "staff-deactivated", sessionEnded: "session-expired-or-ended", hubKeyRevoked: "hub-key-revoked",
    })
  })

  it("each item shows the evidence it was held with, the money already collected, and who may decide — no secrets", async () => {
    const item = await held(ops.pinReset.id)
    // a session revoked by the PIN reset is not session evidence: legacy-claimed, with the check that failed
    expect(item.evidence).toMatchObject({ label: "legacy-claimed", sessionCheck: "staff-revoked", deviceCheck: "valid", sessionStaff: { id: SAMI, name: "Sami" } })
    expect(item.effects[0].lines[0]).toMatchObject({ quantity: 1, serverStockNow: expect.any(Number) })
    expect(item.money).toEqual({ direction: "collected", amountUsd: 5, method: "Cash" })
    expect(item.resolutions.map((r: any) => r.decision)).toEqual(["apply", "dismiss"])
    expect(item.resolutions[1].outcomes).toEqual(["nothing-to-correct", "manual-correction-acknowledged", "money-recovered-attested"])
    expect(item.requiredPermissions).toEqual(["sales.void", "settings.manage"])
    expect(typeof item.previewToken).toBe("string")
    const text = JSON.stringify(await review())
    expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./)
    for (const pin of ["3301", "3302", "3303", "3304", "3305"]) expect(text).not.toContain(`"${pin}"`)
    // another store's owner sees none of it and cannot decide
    expect((await review(otherOwner)).some((o) => o.id === ops.pinReset.id)).toBe(false)
    expect((await resolve(ops.pinReset.id, { decision: "apply", note: "not mine", previewToken: item.previewToken }, otherOwner)).status).toBe(404)
  })
})

describe("resolution", () => {
  it("a stale preview, a partial repair, and a decline without a money outcome are refused", async () => {
    const item = await held(ops.deviceRevoked.id)
    // the server's state changed after the reviewer looked (another sale took stock)
    const devC = await enroll("rq-till-c")
    const s = await sessionFor(devC, "3302")
    expect((await push({ ...sale(RANA, "Rana"), ev: { v: 1, session: s } }, devC, "rq-till-c")).status).toBe("ok")
    const stale = await resolve(ops.deviceRevoked.id, { decision: "apply", note: "Rana was here", previewToken: item.previewToken })
    expect([stale.status, stale.body.code]).toEqual([409, "STALE_PREVIEW"])
    const fresh = await held(ops.deviceRevoked.id)
    expect((await resolve(ops.deviceRevoked.id, { decision: "apply", note: "x", previewToken: fresh.previewToken, partial: true })).body.code).toBe("UNSUPPORTED_PARTIAL")
    expect((await resolve(ops.deviceRevoked.id, { decision: "dismiss", note: "returned the cash", previewToken: fresh.previewToken })).body.code).toBe("OUTCOME_REQUIRED")
    expect((await held(ops.deviceRevoked.id)).status).toBe("Refused")
  })

  it("apply: exactly once (concurrent decisions), recorded apart with the evidence it was held with", async () => {
    const before = await stock()
    const item = await held(ops.pinReset.id)
    const body = { decision: "apply", note: "Sami sold it; PIN was reset later", previewToken: item.previewToken }
    const [a, b] = await Promise.all([resolve(ops.pinReset.id, body), resolve(ops.pinReset.id, body)])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    expect(await stock()).toBe(before - 1)
    const rec = (await prisma.reviewResolution.findUnique({ where: { opId: ops.pinReset.id } }))!
    expect([rec.decision, rec.outcome, rec.category, rec.reviewerId]).toEqual(["apply", "applied", "pin-reset-or-session-revoked", OWNER])
    expect(rec.originalEvidence).toMatchObject({ sessionCheck: "staff-revoked", sessionStaffId: SAMI })
    expect(rec.money).toMatchObject({ direction: "collected", amountUsd: 5 })
    // the operation itself is as it was sent
    const opRow = (await prisma.syncOperation.findUnique({ where: { id: ops.pinReset.id } }))!
    expect((opRow.payload as any).cashierId).toBe(SAMI)
    // the register retries it later: acknowledged, nothing applied twice
    const devB = await prisma.device.findFirst({ where: { tenantId: T, deviceId: "rq-till-b" } })
    expect(devB).toBeTruthy()
    expect(await stock()).toBe(before - 1)
  })

  it("decline: the money outcome is recorded; a manual correction is not proof of recovery; a resend never applies", async () => {
    const item = await held(ops.staffDeactivated.id)
    const r = await resolve(ops.staffDeactivated.id, { decision: "dismiss", note: "Kim left; the owner refunded the customer by hand", previewToken: item.previewToken, outcome: "manual-correction-acknowledged" })
    expect([r.status, r.body.outcome]).toEqual([200, "manual-correction-acknowledged"])
    const rec = (await prisma.reviewResolution.findUnique({ where: { opId: ops.staffDeactivated.id } }))!
    expect([rec.decision, rec.outcome]).toEqual(["dismiss", "manual-correction-acknowledged"])
    const before = await stock()
    const again = await push(ops.staffDeactivated)
    expect(again.status).toBe("rejected")
    expect(await stock()).toBe(before)
    // decided once
    expect((await resolve(ops.staffDeactivated.id, { decision: "apply", note: "changed my mind", previewToken: item.previewToken })).status).toBe(409)
  })
})
