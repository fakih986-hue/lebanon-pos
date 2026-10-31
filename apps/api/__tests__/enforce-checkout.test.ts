import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomUUID } from "node:crypto"
import jwt from "jsonwebtoken"

// SPRINT-2 (real Postgres, real handlers): the smallest online enforcement slice — enrolled device +
// current staff session + ordinary checkout — in a store that EXPLICITLY enabled it. The register
// stays connected with the owner's account throughout: authorization must follow the person in the
// session, invalid evidence must never fall back to legacy, and completed offline work is kept.
process.env.JWT_SECRET = process.env.JWT_SECRET || "enforce-secret"
const prisma = (await import("../src/lib/prisma.js")).default
const app = (await import("../src/app.js")).default
const bcrypt = (await import("bcryptjs")).default
const { signStaffSession } = await import("../src/lib/credentials.js")
delete process.env.IS_LOCAL_SERVER
vi.setConfig({ testTimeout: 60_000 })

const T = randomUUID(), SUB = `ec-${T.slice(0, 8)}`
let server: http.Server
let base = ""
let owner = "", ownerId = "", ranaId = "", samiId = "", kimId = ""
let cred = "", otherCred = ""
let productId = 0
const syncId = randomUUID()

const addr = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const r = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", "x-titan-sync-schema": "3", "x-forwarded-for": addr(), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, body: (await r.json().catch(() => null)) as any, raw: "" }
}
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` })
const session = async (pin: string, c = cred) => (await call("POST", "/api/auth/staff-session", { pin }, { "x-device-credential": c })).body
/** A sale from the register: always pushed with the OWNER's connection token. */
const sale = (unitPrice: number, named = { id: ranaId, name: "Rana" }) => {
  const id = randomUUID()
  return { id: `wt-${id}`, entity: "sale", action: "create", payload: { id, saleNumber: `S-EC-${id.slice(0, 6)}`, paymentMethod: "Cash", subtotal: unitPrice, tax: 0, total: unitPrice, cashier: named.name, cashierId: named.id, status: "Completed", createdAt: new Date().toISOString(), items: [{ id: productId, productSyncId: syncId, lineId: randomUUID(), name: "Coffee beans", barcode: "", quantity: 1, unitPrice, total: unitPrice, cost: 4 }] } }
}
const push = async (op: Record<string, any>, ev?: Record<string, unknown>, c: string | null = cred) =>
  (await call("POST", "/api/sync/push", { deviceId: "ec-till", operations: [{ ...op, ...(ev ? { ev } : {}) }] }, { ...bearer(owner), ...(c ? { "x-device-credential": c } : {}) })).body.results[0]
const saleRow = (op: Record<string, any>) => prisma.sale.findFirst({ where: { tenantId: T, id: op.payload.id } })
const evidence = (op: Record<string, any>) => prisma.operationEvidence.findUnique({ where: { opId: op.id } })
const stock = async () => Number((await prisma.product.findFirst({ where: { tenantId: T, id: productId } }))!.stock)

beforeAll(async () => {
  server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, resolve))
  base = `http://localhost:${(server.address() as AddressInfo).port}`
  await prisma.tenant.create({ data: { id: T, name: "Enforce checkout (disposable)", subdomain: SUB } })
  const mk = async (name: string, pin: string, role: string, permissions?: string[]) =>
    (await prisma.staffUser.create({ data: { tenantId: T, name, mobile: `ec-${name}-${T.slice(0, 6)}`, pin: await bcrypt.hash(pin, 12), role: role as any, ...(permissions ? { permissions } : {}) } as any })).id
  ownerId = await mk("Owner", "9101", "Admin")
  ranaId = await mk("Rana", "9102", "Cashier", ["sales.checkout"])
  samiId = await mk("Sami", "9103", "Manager", ["sales.checkout", "sales.price_override", "sales.void"])
  kimId = await mk("Kim", "9104", "Cashier", ["inventory.receive"])
  productId = (await prisma.product.create({ data: { tenantId: T, syncId, name: "Coffee beans", price: 10, cost: 4, stock: 100, category: "Coffee", barcode: `ec-${T.slice(0, 6)}` } })).id
  owner = (await call("POST", "/api/auth/login", { pin: "9101", tenantSubdomain: SUB })).body.token
  const code = async () => (await call("POST", "/api/device/generate-code", {}, bearer(owner))).body.code
  cred = (await call("POST", "/api/device/pair", { code: await code(), deviceId: "ec-till", deviceName: "Counter" })).body.credential
  otherCred = (await call("POST", "/api/device/pair", { code: await code(), deviceId: "ec-other", deviceName: "Other" })).body.credential
})

afterAll(async () => {
  const where = { tenantId: T }
  for (const m of ["operationEvidence", "staffSession", "syncOperation", "syncClient", "auditEvent", "stockMovement", "saleItem", "sale", "expense", "pairingCode", "device", "product"] as const) await (prisma as any)[m].deleteMany({ where }).catch(() => undefined)
  await prisma.staffUser.deleteMany({ where })
  await prisma.tenant.deleteMany({ where: { id: T } })
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await prisma.$disconnect()
})

describe("observe mode stays the default", () => {
  it("a new store is in observe mode; a below-price sale with Rana's session is authorized as the connecting owner (today's behaviour)", async () => {
    expect((await call("GET", "/api/sync/status", undefined, bearer(owner))).body.staffSessionMode).toBe("observe")
    const op = sale(7)
    expect((await push(op, { v: 1, session: (await session("9102")).session })).status).toBe("ok")
    expect((await evidence(op))!.evidence).toBe("staff-session") // recorded, not enforced
  })
})

describe("switching enforcement on is an explicit, authorized, audited decision", () => {
  it("a cashier cannot; a note is required; the owner can", async () => {
    const rana = (await call("POST", "/api/auth/login", { pin: "9102", tenantSubdomain: SUB })).body.token
    expect((await call("POST", "/api/sync/identity-mode", { mode: "enforce-checkout", note: "switching on" }, bearer(rana))).status).toBe(403)
    expect((await call("POST", "/api/sync/identity-mode", { mode: "enforce-checkout" }, bearer(owner))).status).toBe(400)
    const r = await call("POST", "/api/sync/identity-mode", { mode: "enforce-checkout", note: "all registers enrolled" }, bearer(owner))
    expect(r.body).toMatchObject({ ok: true, mode: "enforce-checkout", before: "observe" })
    expect(await prisma.auditEvent.count({ where: { tenantId: T, action: "security.identity_mode.changed" } })).toBe(1)
    expect((await call("GET", "/api/sync/status", undefined, bearer(owner))).body.staffSessionMode).toBe("enforce-checkout")
  })
})

describe("enforce-checkout: authorization follows the person in the session (connection stays the owner's)", () => {
  it("changing cashier changes authorization: Rana's below-price sale is refused; the same sale by Sami is applied and recorded as Sami's", async () => {
    const before = await stock()
    const asRana = sale(7)
    const r1 = await push(asRana, { v: 1, session: (await session("9102")).session })
    expect([r1.status, r1.error]).toEqual(["rejected", expect.stringMatching(/^PRICE_OVERRIDE/)])
    expect(await saleRow(asRana)).toBeNull()
    const asSami = sale(7) // the payload still names Rana: the actor comes from the session
    expect((await push(asSami, { v: 1, session: (await session("9103")).session })).status).toBe("ok")
    expect(await saleRow(asSami)).toMatchObject({ cashierId: samiId, cashier: "Sami" })
    const e = (await evidence(asSami))!
    expect([e.evidence, e.sessionStaffId, e.connectionAccountId]).toEqual(["verified", samiId, ownerId])
    expect(e.limitations).toEqual(expect.arrayContaining(["actor-derived-from-session", "pin-checked-at-session-start-not-per-operation", "device-credential-bearer"]))
    expect(e.limitations).not.toContain("observe-mode-not-enforced")
    expect(await stock()).toBe(before - 1)
  })

  it("an ordinary sale by Rana is applied as Rana; Kim (no sales.checkout) cannot sell", async () => {
    const asRana = sale(10)
    expect((await push(asRana, { v: 1, session: (await session("9102")).session })).status).toBe("ok")
    expect(await saleRow(asRana)).toMatchObject({ cashierId: ranaId })
    const asKim = sale(10)
    const r = await push(asKim, { v: 1, session: (await session("9104")).session })
    expect([r.status, r.error]).toEqual(["rejected", expect.stringMatching(/^IDENTITY_REQUIRED: Kim is not allowed to sell/)])
  })

  it("invalid evidence never falls back to legacy: no device, no session, forged, another device's session, revoked staff — refused and kept for review", async () => {
    const forged = jwt.sign({ typ: "staff-session", tid: T, dev: "x", av: 1, sid: randomUUID(), auth_time: 1, amr: ["pin"] }, "not-the-key", { audience: "titan:staff-session", issuer: "titan-cloud", subject: ranaId })
    const cases: Array<[string, Record<string, any>, Record<string, unknown> | undefined, string | null]> = [
      ["no device credential", sale(10), { v: 1, session: (await session("9102")).session }, null],
      ["no session", sale(10), { v: 1 }, cred],
      ["no envelope at all (older register)", sale(10), undefined, cred],
      ["forged session", sale(10), { v: 1, session: forged }, cred],
      ["another register's session", sale(10), { v: 1, session: (await session("9102", otherCred)).session }, cred],
    ]
    for (const [label, op, ev, c] of cases) {
      const r = await push(op, ev, c)
      expect([label, r.status]).toEqual([label, "rejected"])
      expect(String(r.error)).toMatch(/^IDENTITY_REQUIRED/)
      expect(await saleRow(op)).toBeNull()
      expect((await prisma.syncOperation.findUnique({ where: { id: op.id } }))!.status).toBe("Refused")
    }
    const s = (await session("9102")).session
    await prisma.staffUser.update({ where: { id: ranaId }, data: { tokenVersion: { increment: 1 } } }) // PIN reset
    const revoked = sale(10)
    expect((await push(revoked, { v: 1, session: s })).error).toMatch(/IDENTITY_REQUIRED: the staff session is not valid \(staff-revoked\)/)
  })

  it("other operations are not part of this slice (an expense still applies as before)", async () => {
    const op = { id: randomUUID(), entity: "expense", action: "create", payload: { id: randomUUID(), expenseNumber: `EXP-${randomUUID().slice(0, 6)}`, vendor: "Market", category: "Supplies", amount: 2, paymentMethod: "Cash", recordedById: ownerId, recordedBy: "Owner", createdAt: new Date().toISOString() } }
    expect((await push(op, undefined, null)).status).toBe("ok")
  })
})

describe("enforce-checkout: completed offline work stays recoverable", () => {
  it("a sale completed offline with the register's own PIN check applies as today, labelled offline-claimed", async () => {
    const op = sale(10)
    expect((await push(op, { v: 1, offline: true })).status).toBe("ok")
    expect((await evidence(op))!.evidence).toBe("offline-claimed")
  })

  it("a sale completed under a session that was signed out (person switched) before the queue arrived is applied, as that person, not 'verified'", async () => {
    const sami = await session("9103")
    const queued = sale(10)
    await session("9101") // the register switched to the owner before pushing
    expect((await push(queued, { v: 1, session: sami.session })).status).toBe("ok")
    expect(await saleRow(queued)).toMatchObject({ cashierId: samiId })
    const e = (await evidence(queued))!
    expect(e.evidence).toBe("staff-session")
    expect(e.limitations).toContain("session-ended-before-receipt")
  })

  it("a sale completed under a session that has since expired is applied, labelled expired", async () => {
    const live = await session("9103")
    const d = jwt.decode(live.session) as any
    const expired = signStaffSession({ sub: samiId, tid: T, dev: d.dev, av: d.av, sid: live.sessionId, authTime: new Date(Date.now() - 20 * 3600_000), expiresAt: new Date(Date.now() - 3600_000) })
    const op = sale(10)
    expect((await push(op, { v: 1, session: expired })).status).toBe("ok")
    expect((await evidence(op))!.limitations).toContain("session-expired-at-receipt")
  })
})

describe("enforce-checkout: refused sales are reviewed like other refused work", () => {
  it("an identity-refused sale is listed for a manager and can be applied once under their authority", async () => {
    const op = sale(10)
    await push(op, { v: 1 })
    const list = (await call("GET", "/api/sync/refused", undefined, bearer(owner))).body.operations as Array<Record<string, any>>
    const item = list.find((o) => o.id === op.id)!
    expect(item.reason).toMatch(/^IDENTITY_REQUIRED/)
    expect(item.requiredPermissions).toEqual(["sales.void", "settings.manage"])
    expect((await call("POST", `/api/sync/refused/${op.id}/resolve`, { decision: "apply", note: "Sami was at the register" }, bearer(owner))).status).toBe(200)
    expect(await saleRow(op)).not.toBeNull()
    expect((await evidence(op))!.limitations).toContain("applied-on-manager-review")
  })

  it("evidence reads never contain session tokens, credentials or PINs", async () => {
    const op = sale(10)
    const s = (await session("9103")).session
    await push(op, { v: 1, session: s })
    const r = await fetch(`${base}/api/sync/evidence/${op.id}`, { headers: { ...bearer(owner), "x-forwarded-for": addr() } })
    const text = await r.text()
    expect(r.status).toBe(200)
    expect(text).not.toContain(s)
    expect(text).not.toContain(cred)
    expect(text).not.toMatch(/eyJ|"pin"/)
  })
})
