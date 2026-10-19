import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomUUID, createHash } from "node:crypto"
import jwt from "jsonwebtoken"

// STAFF-RELEASE (real Postgres, real handlers): the release checks for staff auth.
//  - The store is never left without an active Admin by any supported write path; only the owner
//    portal's atomic transfer moves the role (and recovers a store that has none).
//  - Two devices changing access from the same version: one applies, the other gets a visible
//    rejection; an applied access change revokes that person's sessions.
//  - PIN changes from 1.0.49 devices, using the exact payload shape 1.0.49 sends.
process.env.JWT_SECRET = process.env.JWT_SECRET || "staff-release-secret"
const prisma = (await import("../src/lib/prisma.js")).default
const app = (await import("../src/app.js")).default
const bcrypt = (await import("bcryptjs")).default
delete process.env.IS_LOCAL_SERVER
vi.setConfig({ testTimeout: 90_000 }) // each login compares bcrypt hashes of every staff member

const T = randomUUID()
const SUB = `sr-${T.slice(0, 8)}`
const ADMIN = randomUUID()
const ACTOR = randomUUID() // the sync account: a manager allowed to manage staff
let server: http.Server
let base = ""
let seq = 0
const ownerToken = jwt.sign({ userId: "__admin__", tenantId: "", role: "Admin" }, process.env.JWT_SECRET!, { expiresIn: "1h" })
const actorToken = () => jwt.sign({ userId: ACTOR, tenantId: T, role: "Manager" }, process.env.JWT_SECRET!, { expiresIn: "1h" })
const sha = (pin: string) => createHash("sha256").update(pin).digest("base64")
const mobile = (tag: string) => `sr-${tag}-${T.slice(0, 6)}-${++seq}`

async function loginRaw(pin: string) {
  const res = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin, tenantSubdomain: SUB }) })
  return { status: res.status, token: res.ok ? ((await res.json()) as { token: string }).token : "" }
}
const login = async (pin: string) => (await loginRaw(pin)).status
/** Whether a session token is still accepted (any authenticated endpoint; 401 = revoked). */
async function sessionStatus(token: string) {
  const res = await fetch(`${base}/api/sync/push`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ operations: [] }) })
  return res.status === 401 ? "revoked" : "valid"
}
async function push(op: { entity: string; action: string; payload: unknown; id?: string }) {
  const res = await fetch(`${base}/api/sync/push`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${actorToken()}` }, body: JSON.stringify({ operations: [{ id: op.id ?? `op-${randomUUID()}`, ...op }] }) })
  const body = (await res.json()) as { results?: Array<{ status: string; error?: string }>; error?: string }
  return body.results?.[0] ?? { status: `http-${res.status}`, error: body.error }
}
async function owner(path: string, body: unknown) {
  const res = await fetch(`${base}/api/admin/tenants/${T}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify(body) })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}
async function staff(name: string, pin: string, role: string, extra: Record<string, unknown> = {}) {
  const id = randomUUID()
  await prisma.staffUser.create({ data: { id, tenantId: T, name, mobile: mobile("u"), pin: await bcrypt.hash(pin, 12), role, ...extra } as any })
  return id
}
const row = async (id: string) => (await prisma.staffUser.findUnique({ where: { id } }))!
const activeAdmins = () => prisma.staffUser.count({ where: { tenantId: T, role: "Admin", active: true } })

/**
 * The record a 1.0.49 device sends with ANY staff edit: its whole local copy (captured by running
 * the 1.0.49 security.service updateUser). A PIN changed on that device is its SHA-256 hash, with
 * the pinVersion the copy had (1.0.49 does not bump it); other copies hold the server's hash.
 */
async function v1049Payload(id: string, patch: Record<string, unknown>, localPin?: string) {
  const u = await row(id)
  return {
    id: u.id, name: u.name, mobile: u.mobile, role: u.role,
    pin: localPin ? sha(localPin) : u.pin, pinChanged: true,
    pinVersion: u.pinVersion, lastVerifiedPinVersion: u.pinVersion, tokenVersion: u.tokenVersion,
    active: u.active, permissions: u.permissions, createdAt: u.createdAt.toISOString(),
    ...patch,
  }
}

beforeAll(async () => {
  server = http.createServer(app)
  await new Promise<void>((r) => server.listen(0, r))
  base = `http://localhost:${(server.address() as AddressInfo).port}`
  await prisma.tenant.create({ data: { id: T, name: "Staff release IT (disposable)", subdomain: SUB } })
  await prisma.staffUser.create({ data: { id: ACTOR, tenantId: T, name: "Sync manager", mobile: mobile("s"), pin: await bcrypt.hash("2468", 12), role: "Manager", permissions: ["staff.manage"] } })
  await prisma.staffUser.create({ data: { id: ADMIN, tenantId: T, name: "Store admin", mobile: mobile("a"), pin: await bcrypt.hash("9090", 12), role: "Admin" } })
})
afterAll(async () => {
  await prisma.syncOperation.deleteMany({ where: { tenantId: T } })
  await prisma.auditEvent.deleteMany({ where: { tenantId: T } })
  await prisma.staffUser.deleteMany({ where: { tenantId: T } })
  await prisma.tenant.deleteMany({ where: { id: T } })
  await new Promise<void>((r) => server.close(() => r()))
  await prisma.$disconnect()
})

describe("the store always keeps an active Admin", () => {
  it("deactivating or demoting the Admin through sync is refused (current version, 1.0.50 shape)", async () => {
    const v = (await row(ADMIN)).roleVersion
    const off = await push({ entity: "staff", action: "update", payload: { id: ADMIN, name: "Store admin", active: false, role: "Admin", permissions: [], roleVersion: v } })
    const down = await push({ entity: "staff", action: "update", payload: { id: ADMIN, name: "Store admin", role: "Manager", active: true, permissions: [], roleVersion: v } })
    expect([off.status, down.status]).toEqual(["rejected", "rejected"])
    expect(off.error).toMatch(/^LAST_ADMIN:/)
    expect(down.error).toMatch(/^LAST_ADMIN:/)
    expect(await row(ADMIN)).toMatchObject({ role: "Admin", active: true, roleVersion: v })
    expect(await login("9090")).toBe(200)
  })

  it("the same through a 1.0.49 payload (no access version) is refused with an upgrade message", async () => {
    const r = await push({ entity: "staff", action: "update", payload: await v1049Payload(ADMIN, { role: "Manager" }) })
    const r2 = await push({ entity: "staff", action: "update", payload: await v1049Payload(ADMIN, { active: false }) })
    expect([r.status, r2.status]).toEqual(["rejected", "rejected"])
    expect(r.error).toMatch(/^STALE_STAFF: .*1\.0\.50/)
    expect(await activeAdmins()).toBe(1)
  })

  it("there is no staff delete through sync; the Admin row stays", async () => {
    const r = await push({ entity: "staff", action: "delete", payload: { id: ADMIN } })
    expect(r.status).not.toBe("ok")
    expect(await row(ADMIN)).toMatchObject({ role: "Admin", active: true })
  })

  it("editing the Admin's name or permissions (still Admin, still active) is allowed", async () => {
    const v = (await row(ADMIN)).roleVersion
    const r = await push({ entity: "staff", action: "update", payload: { id: ADMIN, name: "Store admin", role: "Admin", active: true, permissions: ["reports.view"], roleVersion: v } })
    expect(r.status).toBe("ok")
    expect((await row(ADMIN)).roleVersion).toBe(v + 1)
  })

  it("a transfer is the way to move the role: atomic, never zero, never two", async () => {
    const M = await staff("Successor", "5656", "Manager")
    expect((await owner("/transfer-admin", { toUserId: M, confirm: SUB })).status).toBe(200)
    expect(await activeAdmins()).toBe(1)
    expect((await row(M)).role).toBe("Admin")
    // The former admin is a Manager now and can be deactivated; the successor cannot.
    const former = await row(ADMIN)
    expect((await push({ entity: "staff", action: "update", payload: { id: ADMIN, name: former.name, role: "Manager", active: false, permissions: former.permissions, roleVersion: former.roleVersion } })).status).toBe("ok")
    const succ = await row(M)
    expect((await push({ entity: "staff", action: "update", payload: { id: M, name: succ.name, role: "Admin", active: false, permissions: succ.permissions, roleVersion: succ.roleVersion } })).error).toMatch(/^LAST_ADMIN:/)
    expect(await activeAdmins()).toBe(1)
  })

  it("owner recovery: a store that has no active Admin (older data) gets one through the transfer", async () => {
    await prisma.staffUser.updateMany({ where: { tenantId: T, role: "Admin" }, data: { role: "Manager" } }) // simulate legacy data
    expect(await activeAdmins()).toBe(0)
    const R = await staff("Recovered admin", "7878", "Manager")
    const res = await owner("/transfer-admin", { toUserId: R, confirm: SUB })
    expect(res.status).toBe(200)
    expect(res.body.from).toBeNull()
    expect(await activeAdmins()).toBe(1)
    expect(await prisma.auditEvent.count({ where: { tenantId: T, action: "staff.admin_transfer", summary: { contains: "made the store admin" } } })).toBe(1)
  })
})

describe("access-version conflicts", () => {
  it("two devices changing access from the same version at once: exactly one applies, the other is rejected", async () => {
    for (let round = 0; round < 5; round++) {
      const C = await staff(`Concurrent ${round}`, `61${round}${round}`, "Cashier", { permissions: ["pos.sell"] })
      const a = { entity: "staff", action: "update", payload: { id: C, name: `Concurrent ${round}`, role: "Cashier", active: true, permissions: ["pos.sell", "reports.view"], roleVersion: 1 } }
      const b = { entity: "staff", action: "update", payload: { id: C, name: `Concurrent ${round}`, role: "Cashier", active: true, permissions: ["pos.sell", "inventory.manage"], roleVersion: 1 } }
      const [ra, rb] = await Promise.all([push(a), push(b)])
      expect([ra.status, rb.status].sort()).toEqual(["ok", "rejected"])
      const loser = ra.status === "rejected" ? ra : rb
      const winner = ra.status === "ok" ? a : b
      expect(loser.error).toMatch(/^STALE_STAFF:/)
      const r = await row(C)
      expect(r.roleVersion).toBe(2)
      expect([...r.permissions].sort()).toEqual([...winner.payload.permissions].sort())
    }
  })

  it("a stale access change is not acknowledged and leaves an audit trail of nothing applied", async () => {
    const C = await staff("Stale target", "6262", "Cashier")
    expect((await push({ entity: "staff", action: "update", payload: { id: C, name: "Stale target", role: "Manager", active: true, permissions: [], roleVersion: 1 } })).status).toBe("ok")
    const stale = await push({ entity: "staff", action: "update", payload: { id: C, name: "Stale target", role: "Cashier", active: true, permissions: [], roleVersion: 1 } })
    expect(stale.status).toBe("rejected")
    expect((await row(C)).role).toBe("Manager")
    const op = await prisma.syncOperation.findFirst({ where: { tenantId: T, status: "Rejected", payload: { path: ["id"], equals: C } } })
    expect(op?.error).toMatch(/^STALE_STAFF:/)
  })

  it("revoking access ends the person's existing sessions (permissions, role, deactivation)", async () => {
    const C = await staff("Session holder", "6363", "Manager", { permissions: ["pos.sell", "reports.view"] })
    const t1 = (await loginRaw("6363")).token
    expect(await sessionStatus(t1)).toBe("valid")
    let r = await row(C)
    expect((await push({ entity: "staff", action: "update", payload: { id: C, name: r.name, role: "Manager", active: true, permissions: ["pos.sell"], roleVersion: r.roleVersion } })).status).toBe("ok")
    expect(await sessionStatus(t1)).toBe("revoked") // a permission was removed

    const t2 = (await loginRaw("6363")).token
    r = await row(C)
    expect((await push({ entity: "staff", action: "update", payload: { id: C, name: r.name, role: "Cashier", active: true, permissions: ["pos.sell"], roleVersion: r.roleVersion } })).status).toBe("ok")
    expect(await sessionStatus(t2)).toBe("revoked") // role lowered

    const t3 = (await loginRaw("6363")).token
    r = await row(C)
    expect((await push({ entity: "staff", action: "update", payload: { id: C, name: r.name, role: "Cashier", active: false, permissions: ["pos.sell"], roleVersion: r.roleVersion } })).status).toBe("ok")
    expect(await sessionStatus(t3)).toBe("revoked") // deactivated
    expect(await login("6363")).toBe(401)

    // A rename (no access change) does not sign anyone out.
    const D = await staff("Rename only", "6464", "Cashier")
    const t4 = (await loginRaw("6464")).token
    expect((await push({ entity: "staff", action: "update", payload: { id: D, name: "Renamed", mobile: (await row(D)).mobile, roleVersion: 1 } })).status).toBe("ok")
    expect(await sessionStatus(t4)).toBe("valid")
  })
})

describe("PIN changes from 1.0.49 devices (exact 1.0.49 payload)", () => {
  it("a legitimate PIN change applies: new PIN works, old refused, version bumped", async () => {
    const X = await staff("Legacy cashier", "4141", "Cashier")
    const r = await push({ entity: "staff", action: "update", payload: await v1049Payload(X, {}, "8282") })
    expect(r.status).toBe("ok")
    expect(await login("4141")).toBe(401)
    expect(await login("8282")).toBe(200)
    expect((await row(X)).pinVersion).toBe(2)
    // That device's next ordinary edit carries the same hash: no PIN change, the edit applies.
    const r2 = await push({ entity: "staff", action: "update", payload: { ...(await v1049Payload(X, { name: "Legacy cashier (renamed)" }, "8282")), pinVersion: 1 } })
    expect(r2.status).toBe("ok")
    expect((await row(X)).name).toBe("Legacy cashier (renamed)")
    expect(await login("8282")).toBe(200)
  })

  it("a second 1.0.49 device holding the older PIN cannot bring it back", async () => {
    const X = await staff("Two devices", "4242", "Cashier")
    const other = await v1049Payload(X, {}, "4242") // device B changed nothing but holds the PIN as a local hash
    expect((await push({ entity: "staff", action: "update", payload: await v1049Payload(X, {}, "8383") })).status).toBe("ok") // device A
    const r = await push({ entity: "staff", action: "update", payload: { ...other, name: "Two devices (B rename)" } })
    expect(r.status).toBe("rejected")
    expect(r.error).toMatch(/^STALE_STAFF:/)
    expect(await login("4242")).toBe(401)
    expect(await login("8383")).toBe(200)
  })

  it("a 1.0.49 PIN change made before an owner reset is refused, visibly; the reset stands", async () => {
    const X = await staff("Reset first", "4343", "Cashier")
    const offline = await v1049Payload(X, {}, "8484") // changed on the device while offline
    expect((await owner(`/users/${X}/reset-pin`, { pin: "8585" })).status).toBe(200)
    const r = await push({ entity: "staff", action: "update", payload: offline })
    expect(r.status).toBe("rejected")
    expect(r.error).toMatch(/^STALE_STAFF:/)
    expect(await login("8484")).toBe(401)
    expect(await login("4343")).toBe(401)
    expect(await login("8585")).toBe(200)
  })

  it("a 1.0.49 role change is refused with an upgrade-required message", async () => {
    const X = await staff("Legacy role", "4444", "Cashier")
    const r = await push({ entity: "staff", action: "update", payload: await v1049Payload(X, { role: "Manager" }) })
    expect(r.status).toBe("rejected")
    expect(r.error).toMatch(/older app version.*1\.0\.50/)
    expect((await row(X)).role).toBe("Cashier")
  })

  it("a 1.0.49 ordinary edit from an up-to-date copy applies", async () => {
    const X = await staff("Legacy rename", "4545", "Cashier", { permissions: ["pos.sell", "reports.view"] })
    // Same permissions, listed in another order: not an access change.
    const r = await push({ entity: "staff", action: "update", payload: await v1049Payload(X, { name: "Legacy renamed", permissions: ["reports.view", "pos.sell"] }) })
    expect(r.status).toBe("ok")
    expect((await row(X)).name).toBe("Legacy renamed")
    expect(await login("4545")).toBe(200)
  })

  it("1.0.50 PIN action: a concurrent owner reset wins; the older change is rejected", async () => {
    const X = await staff("Pin race", "4646", "Cashier")
    expect((await owner(`/users/${X}/reset-pin`, { pin: "8686" })).status).toBe(200)
    const r = await push({ entity: "staff", action: "pin", payload: { id: X, pin: sha("8787"), basePinVersion: 1 } })
    expect(r.status).toBe("rejected")
    expect(await login("8686")).toBe(200)
    expect(await login("8787")).toBe(401)
  })
})
