import { describe, it, expect, beforeAll, afterAll } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomUUID, createHash } from "node:crypto"
import jwt from "jsonwebtoken"

// STAFF-STALE (real Postgres, real handlers). A device that was offline syncs an older copy of a
// staff member after the owner changed their PIN or their role centrally. The owner's change must
// stand: ordinary staff updates never carry authentication fields, and a role/permission/active
// change made on an older version of the record is refused.
process.env.JWT_SECRET = process.env.JWT_SECRET || "staff-stale-secret"
const prisma = (await import("../src/lib/prisma.js")).default
const app = (await import("../src/app.js")).default
const bcrypt = (await import("bcryptjs")).default
delete process.env.IS_LOCAL_SERVER

const T = randomUUID()
const SUB = `ss-${T.slice(0, 8)}`
const OWNER_ADMIN = randomUUID() // the store's admin
const ACTOR = randomUUID()       // the sync account: a manager allowed to manage staff
let server: http.Server
let base = ""
const ownerToken = jwt.sign({ userId: "__admin__", tenantId: "", role: "Admin" }, process.env.JWT_SECRET!, { expiresIn: "1h" })
const actorToken = () => jwt.sign({ userId: ACTOR, tenantId: T, role: "Manager" }, process.env.JWT_SECRET!, { expiresIn: "1h" })
const sha = (pin: string) => createHash("sha256").update(pin).digest("base64")
const login = async (pin: string) => (await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin, tenantSubdomain: SUB }) })).status
async function push(op: { id: string; entity: string; action: string; payload: unknown }) {
  const res = await fetch(`${base}/api/sync/push`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${actorToken()}` }, body: JSON.stringify({ operations: [op] }) })
  return ((await res.json()) as { results: Array<{ status: string; error?: string }> }).results[0]
}
async function owner(path: string, body: unknown) {
  const res = await fetch(`${base}/api/admin/tenants/${T}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify(body) })
  return { status: res.status, body: await res.json() }
}
/** What a till holds for a staff member and sends with any edit (the whole local record). */
async function deviceCopy(id: string, localPin: string) {
  const u = (await prisma.staffUser.findUnique({ where: { id } }))!
  return { id: u.id, name: u.name, mobile: u.mobile, code: u.code, role: u.role, permissions: u.permissions, active: u.active,
    pin: sha(localPin), pinVersion: u.pinVersion, pinChanged: true, tokenVersion: u.tokenVersion,
    ...(u as Record<string, unknown>).roleVersion !== undefined ? { roleVersion: (u as Record<string, unknown>).roleVersion } : {},
    createdAt: u.createdAt.toISOString() }
}

beforeAll(async () => {
  server = http.createServer(app)
  await new Promise<void>((r) => server.listen(0, r))
  base = `http://localhost:${(server.address() as AddressInfo).port}`
  await prisma.tenant.create({ data: { id: T, name: "Staff stale IT (disposable)", subdomain: SUB } })
  await prisma.staffUser.create({ data: { id: ACTOR, tenantId: T, name: "Sync manager", mobile: `ss-s-${T.slice(0, 6)}`, pin: await bcrypt.hash("2468", 12), role: "Manager", permissions: ["staff.manage"] } })
  await prisma.staffUser.create({ data: { id: OWNER_ADMIN, tenantId: T, name: "Store admin", mobile: `ss-a-${T.slice(0, 6)}`, pin: await bcrypt.hash("9090", 12), role: "Admin" } })
})
afterAll(async () => {
  await prisma.syncOperation.deleteMany({ where: { tenantId: T } })
  await prisma.auditEvent.deleteMany({ where: { tenantId: T } })
  await prisma.staffUser.deleteMany({ where: { tenantId: T } })
  await prisma.tenant.deleteMany({ where: { id: T } })
  await new Promise<void>((r) => server.close(() => r()))
  await prisma.$disconnect()
})

describe("a stale offline staff edit cannot undo the owner's change", () => {
  it("a device copy carrying device-only fields (lastVerifiedPinVersion) still syncs its ordinary edit", async () => {
    const Y = randomUUID()
    await prisma.staffUser.create({ data: { id: Y, tenantId: T, name: "Verified here", mobile: `ss-y-${T.slice(0, 6)}`, pin: await bcrypt.hash("1357", 12), role: "Cashier" } })
    const copy = { ...(await deviceCopy(Y, "1357")), lastVerifiedPinVersion: 1 }
    const r = await push({ id: `op-lv-${Y}`, entity: "staff", action: "update", payload: { ...copy, name: "Verified here (renamed)" } })
    expect(r.status).toBe("ok")
    expect((await prisma.staffUser.findUnique({ where: { id: Y } }))?.name).toBe("Verified here (renamed)")
  })

  it("PIN reset stands: the old PIN stays refused after an older rename is synced", async () => {
    const X = randomUUID()
    await prisma.staffUser.create({ data: { id: X, tenantId: T, name: "Cashier", mobile: `ss-x-${T.slice(0, 6)}`, pin: await bcrypt.hash("4321", 12), role: "Cashier" } })
    const stale = await deviceCopy(X, "4321") // the till's copy before the reset
    const reset = await owner(`/users/${X}/reset-pin`, { pin: "8765" })
    expect(reset.status).toBe(200)
    // The till, offline during the reset, renames the cashier and syncs its whole record.
    const r = await push({ id: `op-ren-${X}`, entity: "staff", action: "update", payload: { ...stale, name: "Cashier (renamed)" } })
    expect(r.status).toBe("ok")
    expect(await login("4321")).toBe(401)
    expect(await login("8765")).toBe(200)
    const row = (await prisma.staffUser.findUnique({ where: { id: X } }))!
    expect(row.name).toBe("Cashier (renamed)") // the ordinary edit itself is kept
    expect(row.pinVersion).toBe(2)
  })

  it("Admin transfer stands: an older copy cannot restore the former admin or demote the successor", async () => {
    const M = randomUUID()
    await prisma.staffUser.create({ data: { id: M, tenantId: T, name: "Successor", mobile: `ss-m-${T.slice(0, 6)}`, pin: await bcrypt.hash("5656", 12), role: "Manager" } })
    const staleFormer = await deviceCopy(OWNER_ADMIN, "9090") // a till still sees "Store admin" as Admin
    const staleSuccessor = await deviceCopy(M, "5656")         // ... and "Successor" as Manager
    expect((await owner("/transfer-admin", { toUserId: M, confirm: SUB })).status).toBe(200)
    const r1 = await push({ id: `op-sf-${M}`, entity: "staff", action: "update", payload: { ...staleFormer, name: "Store admin (edited offline)" } })
    const r2 = await push({ id: `op-ss-${M}`, entity: "staff", action: "update", payload: { ...staleSuccessor, mobile: `ss-m2-${T.slice(0, 6)}` } })
    expect(r1.status).not.toBe("error")
    expect(r2.status).not.toBe("error")
    expect((await prisma.staffUser.findUnique({ where: { id: OWNER_ADMIN } }))?.role).toBe("Manager")
    expect((await prisma.staffUser.findUnique({ where: { id: M } }))?.role).toBe("Admin")
    expect(await prisma.staffUser.count({ where: { tenantId: T, role: "Admin", active: true } })).toBe(1)
  })
})
