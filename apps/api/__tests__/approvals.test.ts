import { describe, it, expect, beforeAll, afterAll } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { createHash, randomUUID } from "node:crypto"
import jwt from "jsonwebtoken"

// SPRINT-2 Phase E (real Postgres, real handlers): online manager approval. A cashier's register is
// connected with the cashier's own account (no refund, void or cash permission), enrolled, and the
// cashier holds a server-checked session. A manager approves one record with their PIN; the operation
// carries the approval id. The cashier stays the actor; the manager is recorded as approver.
process.env.JWT_SECRET = process.env.JWT_SECRET || "approvals-secret"
delete process.env.IS_LOCAL_SERVER
const prisma = (await import("../src/lib/prisma.js")).default
const app = (await import("../src/app.js")).default
const bcrypt = (await import("bcryptjs")).default
const { vi } = await import("vitest")
vi.setConfig({ testTimeout: 60_000 })

const TENANT = randomUUID(), OTHER = randomUUID()
const OWNER = randomUUID(), MANAGER = randomUUID(), SUPERVISOR = randomUUID(), CASHIER = randomUUID(), FORMER = randomUUID(), OTHER_OWNER = randomUUID()
const LEGACY = randomUUID()
const PINS = { owner: "7401", manager: "7402", supervisor: "7403", cashier: "7404", former: "7405", other: "7501", legacy: "7406" }
let server: http.Server
let base = ""
let owner = "", cashierConn = "", otherOwner = ""
let dev: { credential: string; enrolledDeviceId: string }, dev2: { credential: string; enrolledDeviceId: string }, otherDev: { credential: string }
let session = ""
let productId = 0
const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
async function call(method: string, p: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(`${base}${p}`, { method, headers: { "Content-Type": "application/json", "x-titan-sync-schema": "4", "x-forwarded-for": ip(), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await r.text()
  return { status: r.status, body: (text ? JSON.parse(text) : null) as any, text }
}
const asRegister = (d = dev) => ({ Authorization: `Bearer ${cashierConn}`, "x-device-credential": d.credential, "x-staff-session": session })
const approve = (entity: string, action: string, payload: Record<string, unknown>, permission: string, pin: string, d = dev, extra: Record<string, unknown> = {}) =>
  call("POST", "/api/approvals", { entity, action, payload, permission, pin, ...extra }, asRegister(d))
const push = (op: any, d = dev) => call("POST", "/api/sync/push", { deviceId: "till-a", operations: [op] }, asRegister(d)).then((r) => r.body.results[0])
let saleId = "", lineId = ""
const refundPayload = (id: string, qty = 1) => ({ id, refundNumber: `R-AP-${id.slice(0, 6)}`, saleId, saleNumber: "S-AP-1", method: "Cash", reason: "IT", total: 5 * qty, cashier: "Rana", cashierId: CASHIER, items: [{ id: productId, saleLineId: lineId, name: "Approval widget", quantity: qty, unitPrice: 5, total: 5 * qty }] })
const refundOp = (payload: any, approval?: string) => ({ id: randomUUID(), entity: "refund", action: "create", payload, ev: { v: 1, session, ...(approval ? { approval } : {}) } })
const evidence = (opId: string) => prisma.operationEvidence.findUnique({ where: { opId } })

beforeAll(async () => {
  server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, resolve))
  base = `http://localhost:${(server.address() as AddressInfo).port}`
  for (const [id, name, role, pin, permissions, active] of [
    [OWNER, "Owner", "Admin", PINS.owner, undefined, true], [MANAGER, "Maya", "Manager", PINS.manager, undefined, true],
    [SUPERVISOR, "Sami", "Cashier", PINS.supervisor, ["sales.checkout", "sales.discount"], true], [CASHIER, "Rana", "Cashier", PINS.cashier, ["sales.checkout"], true],
    [FORMER, "Former", "Manager", PINS.former, undefined, false],
  ] as const) {
    if (id === OWNER) await prisma.tenant.create({ data: { id: TENANT, name: "Approvals IT (disposable)", subdomain: `ap-${TENANT.slice(0, 8)}`, cloudApiKey: randomUUID() } })
    await prisma.staffUser.create({ data: { id, tenantId: TENANT, name, mobile: `ap-${id.slice(0, 8)}`, pin: await bcrypt.hash(pin, 12), role, active, ...(permissions ? { permissions: [...permissions] } : {}) } as any })
  }
  // a manager added on a register: the register stores the PIN as its SHA-256 (base64), as sign-in accepts it
  await prisma.staffUser.create({ data: { id: LEGACY, tenantId: TENANT, name: "Lina", mobile: `ap-${LEGACY.slice(0, 8)}`, pin: createHash("sha256").update(PINS.legacy).digest("base64"), role: "Manager" } as any })
  await prisma.tenant.create({ data: { id: OTHER, name: "Approvals IT other (disposable)", subdomain: `ap2-${OTHER.slice(0, 8)}`, cloudApiKey: randomUUID() } })
  await prisma.staffUser.create({ data: { id: OTHER_OWNER, tenantId: OTHER, name: "Other owner", mobile: `ap-x-${OTHER.slice(0, 6)}`, pin: await bcrypt.hash(PINS.other, 12), role: "Admin" } })
  const sign = (userId: string, tenantId: string, role: string) => jwt.sign({ userId, tenantId, role, tokenVersion: 1 }, process.env.JWT_SECRET!, { expiresIn: "1h" })
  owner = sign(OWNER, TENANT, "Admin"); cashierConn = sign(CASHIER, TENANT, "Cashier"); otherOwner = sign(OTHER_OWNER, OTHER, "Admin")
  const enroll = async (token: string, deviceId: string) => {
    const code = (await call("POST", "/api/device/generate-code", {}, { Authorization: `Bearer ${token}` })).body.code
    return (await call("POST", "/api/device/pair", { code, deviceId, deviceName: deviceId })).body
  }
  dev = await enroll(owner, "till-a"); dev2 = await enroll(owner, "till-b"); otherDev = await enroll(otherOwner, "till-x")
  session = (await call("POST", "/api/auth/staff-session", { pin: PINS.cashier }, { "x-device-credential": dev.credential })).body.session
  productId = (await prisma.product.create({ data: { tenantId: TENANT, name: "Approval widget", price: 5, cost: 2, stock: 50, barcode: `ap-${TENANT.slice(0, 8)}`, category: "Test" } })).id
  // a sale the cashier made (to refund and void later)
  saleId = randomUUID(); lineId = randomUUID()
  const sale = { id: randomUUID(), entity: "sale", action: "create", payload: { id: saleId, saleNumber: "S-AP-1", paymentMethod: "Cash", subtotal: 15, tax: 0, total: 15, cashier: "Rana", cashierId: CASHIER, status: "Completed", items: [{ id: productId, lineId, name: "Approval widget", quantity: 3, unitPrice: 5, total: 15, batchAllocations: [] }] }, ev: { v: 1, session } }
  expect((await push(sale)).status).toBe("ok")
})

afterAll(async () => {
  for (const tenantId of [TENANT, OTHER]) {
    const where = { tenantId }
    for (const m of ["managerApproval", "operationEvidence", "staffSession", "syncOperation", "syncClient", "auditEvent", "cashMovement", "refundItem", "saleRefund", "saleItem", "sale", "stockMovement", "pairingCode", "device", "product", "staffUser"] as const) {
      if (m === "refundItem") await (prisma as any).refundItem.deleteMany({ where: { refund: { tenantId } } }).catch(() => undefined)
      else await (prisma as any)[m].deleteMany({ where }).catch(() => undefined)
    }
    await prisma.tenant.deleteMany({ where: { id: tenantId } }).catch(() => undefined)
  }
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await prisma.$disconnect()
})

describe("online manager approval", () => {
  it("without approval the cashier's refund is refused and kept; nothing is applied", async () => {
    const r = await push(refundOp(refundPayload(randomUUID())))
    expect(r.status).not.toBe("ok")
    expect(r.error).toMatch(/permission/i)
    expect(await prisma.saleRefund.count({ where: { tenantId: TENANT } })).toBe(0)
  })

  it("refusals are clear: wrong PIN, no permission, inactive manager, another store's register or manager, unenrolled register", async () => {
    const p = refundPayload(randomUUID())
    expect((await approve("refund", "create", p, "sales.refund", "0000")).body.code).toBe("INVALID_PIN")
    expect((await approve("refund", "create", p, "sales.refund", PINS.supervisor)).body.code).toBe("APPROVER_LACKS_PERMISSION")
    expect((await approve("refund", "create", p, "sales.refund", PINS.former)).body.code).toBe("APPROVER_INACTIVE")
    expect((await approve("refund", "create", p, "sales.refund", PINS.other)).body.code).toBe("INVALID_PIN")
    expect((await approve("refund", "create", p, "sales.refund", PINS.manager, otherDev as any)).body.code).toBe("DEVICE_OTHER_STORE")
    expect((await call("POST", "/api/approvals", { entity: "refund", action: "create", payload: p, permission: "sales.refund", pin: PINS.manager }, { Authorization: `Bearer ${cashierConn}` })).body.code).toBe("DEVICE_NOT_ENROLLED")
    expect((await approve("refund", "create", p, "settings.manage", PINS.manager)).body.code).toBe("NOT_APPROVABLE")
    expect(await prisma.managerApproval.count({ where: { tenantId: TENANT } })).toBe(0)
  })

  it("approved refund: applied once, the cashier is the actor, the manager the approver; no PIN anywhere", async () => {
    const p = refundPayload(randomUUID())
    const a = await approve("refund", "create", p, "sales.refund", PINS.manager)
    expect(a.status).toBe(200)
    expect([a.body.approver.name, a.body.permission]).toEqual(["Maya", "sales.refund"])
    // a PIN as a value of its own (random ids may contain the same digits, e.g. "d5874051-…" contains 7405)
    for (const pin of Object.values(PINS)) expect(a.text).not.toMatch(new RegExp(`(?<![0-9a-f])${pin}(?![0-9a-f])`, "i"))
    const op = refundOp(p, a.body.approvalId)
    expect((await push(op)).status).toBe("ok")
    // exact retry (lost response): acknowledged, applied once
    expect((await push(op)).status).toBe("ok")
    expect(await prisma.saleRefund.count({ where: { tenantId: TENANT, id: p.id } })).toBe(1)
    const e = (await evidence(op.id))!
    expect([e.actorIdClaimed, e.sessionStaffId, e.evidence]).toEqual([CASHIER, CASHIER, "staff-session"])
    expect(e.approval).toMatchObject({ check: "valid", approverId: MANAGER, approverName: "Maya", permission: "sales.refund" })
    expect((await prisma.managerApproval.findUnique({ where: { id: a.body.approvalId } }))?.usedByOpId).toBe(op.id)
    // the register's person and connection did not change: the next refund without approval is refused
    expect((await push(refundOp(refundPayload(randomUUID())))).status).not.toBe("ok")
    const stored = JSON.stringify(await prisma.syncOperation.findMany({ where: { tenantId: TENANT } })) + JSON.stringify(await prisma.auditEvent.findMany({ where: { tenantId: TENANT } }))
    for (const pin of Object.values(PINS)) expect(stored).not.toContain(`"${pin}"`)
  })

  it("a manager whose PIN was set on a register (legacy SHA-256, base64) can approve", async () => {
    const a = await approve("refund", "create", refundPayload(randomUUID()), "sales.refund", PINS.legacy)
    expect([a.status, a.body.approver?.name]).toEqual([200, "Lina"])
  })

  it("an approval cannot authorize changed values, another record, another operation, another register, or after expiry", async () => {
    // changed quantity after approval
    const p = refundPayload(randomUUID())
    const a = (await approve("refund", "create", p, "sales.refund", PINS.manager)).body
    const changed = refundOp({ ...p, total: 10, items: [{ ...p.items[0], quantity: 2, total: 10 }] }, a.approvalId)
    const r = await push(changed)
    expect([r.status, r.error]).toEqual(["rejected", expect.stringMatching(/^APPROVAL_INVALID: .*changed/)])
    expect((await prisma.syncOperation.findUnique({ where: { id: changed.id } }))?.status).toBe("Refused")
    // another record with the same approval
    const other = refundOp(refundPayload(randomUUID()), a.approvalId)
    expect((await push(other)).error).toMatch(/other-record/)
    // the right record from another register
    expect((await push(refundOp(p, a.approvalId), dev2)).error).toMatch(/other-device/)
    // used by one operation, presented by another operation for the same record
    const first = refundOp(p, a.approvalId)
    expect((await push(first)).status).toBe("ok")
    const second = refundOp(p, a.approvalId)
    expect((await push(second)).error).toMatch(/used-by-another-operation|OPERATION_ID|already/)
    // expired before first use
    const q = refundPayload(randomUUID())
    const b = (await approve("refund", "create", q, "sales.refund", PINS.manager)).body
    await prisma.managerApproval.update({ where: { id: b.approvalId }, data: { expiresAt: new Date(Date.now() - 1000) } })
    expect((await push(refundOp(q, b.approvalId))).error).toMatch(/expired/)
    expect(await prisma.saleRefund.count({ where: { tenantId: TENANT, id: q.id } })).toBe(0)
  })

  it("concurrent operations presenting one approval: only one is applied", async () => {
    const p = refundPayload(randomUUID())
    const a = (await approve("refund", "create", p, "sales.refund", PINS.manager)).body
    const [x, y] = [refundOp(p, a.approvalId), refundOp(p, a.approvalId)]
    const results = await Promise.all([push(x), push(y)])
    expect(results.filter((r) => r.status === "ok")).toHaveLength(1)
    expect(await prisma.saleRefund.count({ where: { tenantId: TENANT, id: p.id } })).toBe(1)
  })

  it("the approver's standing is checked again on receipt; a withdrawn (cancelled) approval is not accepted", async () => {
    const p = refundPayload(randomUUID())
    const a = (await approve("refund", "create", p, "sales.refund", PINS.manager)).body
    await prisma.staffUser.update({ where: { id: MANAGER }, data: { active: false } })
    try {
      expect((await push(refundOp(p, a.approvalId))).error).toMatch(/approver-inactive/)
    } finally {
      await prisma.staffUser.update({ where: { id: MANAGER }, data: { active: true } })
    }
    const q = refundPayload(randomUUID())
    const b = (await approve("refund", "create", q, "sales.refund", PINS.manager)).body
    expect((await call("POST", `/api/approvals/${b.approvalId}/cancel`, {}, asRegister())).body.cancelled).toBe(true)
    expect((await push(refundOp(q, b.approvalId))).error).toMatch(/cancelled/)
  })

  it("void and cash payout use the same mechanism", async () => {
    const draw = { id: randomUUID(), type: "PettyCash", direction: "Out", amountUsd: 4, reason: "IT supplies", recordedById: CASHIER, recordedByName: "Rana", createdAt: new Date().toISOString() }
    const noApproval = await push({ id: randomUUID(), entity: "cash-movement", action: "create", payload: draw, ev: { v: 1, session } })
    expect(noApproval.status).not.toBe("ok")
    const c = (await approve("cash-movement", "create", draw, "cash.manage", PINS.owner)).body
    expect((await push({ id: randomUUID(), entity: "cash-movement", action: "create", payload: draw, ev: { v: 1, session, approval: c.approvalId } })).status).toBe("ok")
    expect(await prisma.cashMovement.count({ where: { tenantId: TENANT, id: draw.id } })).toBe(1)
    // a fresh sale (the first one was partly refunded above, which a void refuses)
    const voidId = randomUUID()
    expect((await push({ id: randomUUID(), entity: "sale", action: "create", payload: { id: voidId, saleNumber: "S-AP-2", paymentMethod: "Cash", subtotal: 5, tax: 0, total: 5, cashier: "Rana", cashierId: CASHIER, status: "Completed", items: [{ id: productId, lineId: randomUUID(), name: "Approval widget", quantity: 1, unitPrice: 5, total: 5, batchAllocations: [] }] }, ev: { v: 1, session } })).status).toBe("ok")
    const v = (await approve("sale", "void", { id: voidId, saleNumber: "S-AP-2" }, "sales.void", PINS.manager)).body
    const voided = await push({ id: `op-void-${voidId}`, entity: "sale", action: "void", payload: { id: voidId, saleNumber: "S-AP-2" }, ev: { v: 1, session, approval: v.approvalId } }); expect(voided.error ?? voided.status).toBe("ok")
    expect((await prisma.sale.findFirst({ where: { tenantId: TENANT, id: voidId }, select: { status: true } }))?.status).toBe("Voided")
  })

  it("too many wrong PINs on one register are locked out", async () => {
    const p = refundPayload(randomUUID())
    let last = 0
    for (let i = 0; i < 6; i++) last = (await approve("refund", "create", p, "sales.refund", "0001", dev2)).status
    expect(last).toBe(429)
    expect((await approve("refund", "create", p, "sales.refund", PINS.manager, dev2)).body.code).toBe("APPROVAL_LOCKED")
  })
})
