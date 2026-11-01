import { describe, it, expect, beforeAll, afterAll } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomUUID } from "node:crypto"
import jwt from "jsonwebtoken"

// SPRINT-2 Part 5 (real Postgres, real handlers): authorization and activation boundaries.
//  - The activation gate counts a register as inside the boundary only when this server OBSERVED it
//    send a valid device credential and staff session (its latest operation included): an enrolled
//    register on the right version that never did is still a blocker.
//  - In an enforcing store, naming a manager on a held line's stock decision is a claim: it stands only
//    for the verified session's own person, or with a manager's online approval of that sale.
process.env.JWT_SECRET = process.env.JWT_SECRET || "boundaries-secret"
delete process.env.IS_LOCAL_SERVER
const prisma = (await import("../src/lib/prisma.js")).default
const app = (await import("../src/app.js")).default
const bcrypt = (await import("bcryptjs")).default
const { vi } = await import("vitest")
vi.setConfig({ testTimeout: 60_000 })

const T = randomUUID()
const OWNER = randomUUID(), MAYA = randomUUID(), RANA = randomUUID()
let server: http.Server, base = ""
let owner = "", dev: { credential: string }, session = ""
let tea = { id: 0, syncId: "" }
const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
async function call(method: string, p: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(`${base}${p}`, { method, headers: { "Content-Type": "application/json", "x-titan-sync-schema": "4", "x-forwarded-for": ip(), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await r.text()
  return { status: r.status, body: (text ? JSON.parse(text) : null) as any }
}
const register = () => ({ Authorization: `Bearer ${owner}`, "x-device-credential": dev.credential })
const push = (op: any) => call("POST", "/api/sync/push", { deviceId: "bd-till", operations: [op] }, register()).then((r) => r.body.results[0])
const enforce = () => call("POST", "/api/sync/identity-mode", { mode: "enforce-checkout", note: "boundary test" }, { Authorization: `Bearer ${owner}` })

beforeAll(async () => {
  server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, resolve))
  base = `http://localhost:${(server.address() as AddressInfo).port}`
  await prisma.tenant.create({ data: { id: T, name: "Boundaries IT (disposable)", subdomain: `bd-${T.slice(0, 8)}` } })
  for (const [id, name, role, pin, perms] of [[OWNER, "Owner", "Admin", "2201", null], [MAYA, "Maya", "Manager", "2202", null], [RANA, "Rana", "Cashier", "2203", ["sales.checkout"]]] as const)
    await prisma.staffUser.create({ data: { id, tenantId: T, name, mobile: `bd-${id.slice(0, 8)}`, pin: await bcrypt.hash(pin, 12), role, ...(perms ? { permissions: [...perms] } : {}) } as any })
  owner = jwt.sign({ userId: OWNER, tenantId: T, role: "Admin", tokenVersion: 1 }, process.env.JWT_SECRET!, { expiresIn: "1h" })
  const code = (await call("POST", "/api/device/generate-code", {}, { Authorization: `Bearer ${owner}` })).body.code
  dev = (await call("POST", "/api/device/pair", { code, deviceId: "bd-till", deviceName: "Counter" })).body
  session = (await call("POST", "/api/auth/staff-session", { pin: "2203" }, { "x-device-credential": dev.credential })).body.session
  const p = await prisma.product.create({ data: { tenantId: T, syncId: randomUUID(), name: "Tea", price: 3, cost: 1, stock: 10, barcode: `bd-${T.slice(0, 8)}`, category: "Drinks" } })
  tea = { id: p.id, syncId: p.syncId! }
})

afterAll(async () => {
  const where = { tenantId: T }
  for (const m of ["reviewResolution", "managerApproval", "operationEvidence", "staffSession", "syncOperation", "syncClient", "auditEvent", "expense", "saleItem", "sale", "stockMovement", "pairingCode", "device", "product", "staffUser"] as const) await (prisma as any)[m].deleteMany({ where }).catch(() => undefined)
  await prisma.tenant.deleteMany({ where: { id: T } }).catch(() => undefined)
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await prisma.$disconnect()
})

const expense = (ev?: Record<string, unknown>) => ({ id: randomUUID(), entity: "expense", action: "create", payload: { id: randomUUID(), expenseNumber: `EXP-${randomUUID().slice(0, 6)}`, vendor: "Market", category: "Supplies", amount: 1, paymentMethod: "Cash", recordedById: OWNER, recordedBy: "Owner", createdAt: new Date().toISOString() }, ...(ev ? { ev } : {}) })

describe("activation gate: observed capability, not a version header", () => {
  it("an enrolled register on schema 4 that never sent a staff session is a blocker; after it does, the gate opens", async () => {
    expect((await push(expense())).status).toBe("ok") // enrolled, schema 4 header, but no session
    const refused = await enforce()
    expect(refused.status).toBe(409)
    expect(refused.body.blockers.map((b: any) => b.reason)).toEqual(["no-identity-evidence"])
    expect((await push(expense({ v: 1, session }))).status).toBe("ok")
    const ok = await enforce()
    expect([ok.status, ok.body.mode]).toEqual([200, "enforce-checkout"])
  })
})

describe("an enforcing store: a named manager is a claim", () => {
  const unknownRev = `lost-${randomUUID()}`
  const saleId = randomUUID(), opId = randomUUID(), createdAt = new Date().toISOString()
  const payload = (resolution?: { by: string }) => ({
    id: saleId, saleNumber: "S-BD-1", paymentMethod: "Cash", subtotal: 3, tax: 0, total: 3, cashier: "Rana", cashierId: RANA, status: "Completed", createdAt,
    items: [{ id: tea.id, productSyncId: tea.syncId, lineId: "bd-line-1", name: "Tea", quantity: 1, unitPrice: 3, total: 3, stockPolicy: "untracked", stockPolicyRev: unknownRev, batchAllocations: [],
      ...(resolution ? { stockPolicyResolution: { policy: "untracked", note: "brewed per cup", resolvedBy: resolution.by, resolvedByName: "Maya", at: new Date().toISOString() } } : {}) }],
  })

  it("the register names Maya on Rana's session: still held; with Maya's online approval of this sale: recorded once as decided", async () => {
    const held = await push({ id: opId, entity: "sale", action: "create", payload: payload(), ev: { v: 1, session } })
    expect(held.error).toMatch(/^STOCK_POLICY_HELD/)
    // a modified (or honest but unverified) register names the manager: not enough here
    const named = await push({ id: opId, entity: "sale", action: "create", payload: payload({ by: MAYA }), ev: { v: 1, session } })
    expect(named.status).not.toBe("ok")
    expect(await prisma.sale.count({ where: { tenantId: T, id: saleId } })).toBe(0)
    // Maya approves this sale online with her PIN (inventory.manage)
    const a = await call("POST", "/api/approvals", { entity: "sale", action: "create", payload: payload({ by: MAYA }), permission: "inventory.manage", pin: "2202" }, { ...register(), "x-staff-session": session })
    expect(a.status).toBe(200)
    const decided = await push({ id: opId, entity: "sale", action: "create", payload: payload({ by: MAYA }), ev: { v: 1, session, approval: a.body.approvalId } })
    expect([decided.status, decided.error]).toEqual(["ok", undefined])
    const line = await prisma.saleItem.findFirst({ where: { saleId }, select: { stockPolicy: true, stockPolicyConflict: true } })
    expect(line).toEqual({ stockPolicy: "untracked", stockPolicyConflict: "resolved" })
    const e = (await prisma.operationEvidence.findUnique({ where: { opId } }))!
    expect([e.evidence, e.sessionStaffId]).toEqual(["verified", RANA])
    expect(e.approval).toMatchObject({ check: "valid", approverId: MAYA, permission: "inventory.manage" })
  })
})
