import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomUUID } from "node:crypto"
import jwt from "jsonwebtoken"

// ONE-ADMIN (real Postgres, real handlers): one active admin per store, enforced by the
// database (partial unique index) on every write path, and an atomic owner-portal transfer.
process.env.JWT_SECRET = process.env.JWT_SECRET || "one-admin-secret"
const prisma = (await import("../src/lib/prisma.js")).default
const app = (await import("../src/app.js")).default
const { adminTransferTestHooks } = await import("../src/routes/admin.js")
delete process.env.IS_LOCAL_SERVER

const A = randomUUID() // store A
const B = randomUUID() // store B (isolation)
const ACTOR_A = randomUUID()
const ACTOR_B = randomUUID()
const tag = A.slice(0, 6)
let server: http.Server
let base = ""
const sign = (userId: string, tenantId: string, role = "Manager") => jwt.sign({ userId, tenantId, role }, process.env.JWT_SECRET!, { expiresIn: "1h" })
const owner = jwt.sign({ userId: "__admin__", tenantId: "", role: "Admin" }, process.env.JWT_SECRET!, { expiresIn: "1h" })

async function push(tenant: string, actor: string, ops: Array<{ id: string; entity: string; action: string; payload: unknown }>) {
  const res = await fetch(`${base}/api/sync/push`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${sign(actor, tenant)}` }, body: JSON.stringify({ operations: ops }) })
  return (await res.json()) as { results: Array<{ id: string; status: string; error?: string }> }
}
const staffOp = (id: string, user: Record<string, unknown>, action = "create") => ({ id, entity: "staff", action, payload: user })
const person = (id: string, tenantId: string, name: string, role: string, extra: Record<string, unknown> = {}) =>
  ({ id, tenantId, name, mobile: `oa-${id.slice(0, 8)}`, pin: `$2a$12$${id.replace(/-/g, "").padEnd(53, "x").slice(0, 53)}`, role, active: true, ...extra })
const admins = (tenantId: string) => prisma.staffUser.findMany({ where: { tenantId, role: "Admin", active: true }, select: { id: true } })
async function transfer(tenantId: string, toUserId: string, confirm: string) {
  const res = await fetch(`${base}/api/admin/tenants/${tenantId}/transfer-admin`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${owner}` }, body: JSON.stringify({ toUserId, confirm }) })
  return { status: res.status, body: (await res.json()) as Record<string, any> }
}
async function wipeStaff() {
  for (const t of [A, B]) await prisma.staffUser.deleteMany({ where: { tenantId: t, id: { notIn: [ACTOR_A, ACTOR_B] } } })
  await prisma.syncOperation.deleteMany({ where: { tenantId: { in: [A, B] } } })
  await prisma.auditEvent.deleteMany({ where: { tenantId: { in: [A, B] } } })
}

beforeAll(async () => {
  server = http.createServer(app)
  await new Promise<void>((r) => server.listen(0, r))
  base = `http://localhost:${(server.address() as AddressInfo).port}`
  for (const [t, sub] of [[A, `oa-a-${tag}`], [B, `oa-b-${tag}`]]) await prisma.tenant.create({ data: { id: t, name: "One admin IT (disposable)", subdomain: sub } })
  // Sync actors: managers allowed to manage staff (staff ops need staff.manage), never admins.
  await prisma.staffUser.create({ data: { id: ACTOR_A, tenantId: A, name: "Actor A", mobile: `oa-act-a-${tag}`, pin: "x", role: "Manager", permissions: ["staff.manage"] } })
  await prisma.staffUser.create({ data: { id: ACTOR_B, tenantId: B, name: "Actor B", mobile: `oa-act-b-${tag}`, pin: "x", role: "Manager", permissions: ["staff.manage"] } })
})
afterEach(async () => { adminTransferTestHooks.afterDemote = undefined; await wipeStaff() })
afterAll(async () => {
  await wipeStaff()
  for (const t of [A, B]) { await prisma.staffUser.deleteMany({ where: { tenantId: t } }); await prisma.tenant.deleteMany({ where: { id: t } }) }
  await new Promise<void>((r) => server.close(() => r()))
  await prisma.$disconnect()
})

describe("one active admin per store, under concurrency (sync push)", () => {
  it("two simultaneous admin creations in one store: exactly one succeeds; a retry of the winner is acknowledged", async () => {
    const u1 = randomUUID(), u2 = randomUUID()
    const [r1, r2] = await Promise.all([
      push(A, ACTOR_A, [staffOp(`op-c1-${u1}`, person(u1, A, "First", "Admin"))]),
      push(A, ACTOR_A, [staffOp(`op-c2-${u2}`, person(u2, A, "Second", "Admin"))]),
    ])
    const statuses = [r1.results[0].status, r2.results[0].status].sort()
    expect(statuses).toEqual(["ok", "rejected"])
    expect([r1, r2].find((r) => r.results[0].status === "rejected")!.results[0].error).toMatch(/ONE_ADMIN/)
    expect(await admins(A)).toHaveLength(1)
    // Same-store retry of the winning operation: acknowledged, nothing doubled.
    const winner = r1.results[0].status === "ok" ? { op: `op-c1-${u1}`, u: person(u1, A, "First", "Admin") } : { op: `op-c2-${u2}`, u: person(u2, A, "Second", "Admin") }
    expect((await push(A, ACTOR_A, [staffOp(winner.op, winner.u)])).results[0].status).toBe("ok")
    expect(await admins(A)).toHaveLength(1)
  })

  it("two simultaneous promotions of existing managers: exactly one becomes admin", async () => {
    const m1 = randomUUID(), m2 = randomUUID()
    await prisma.staffUser.createMany({ data: [person(m1, A, "Manager one", "Manager"), person(m2, A, "Manager two", "Manager")] as any })
    const [r1, r2] = await Promise.all([
      // Both made on the current access version (1): two legitimate promotions racing.
      push(A, ACTOR_A, [staffOp(`op-p1-${m1}`, { ...person(m1, A, "Manager one", "Admin"), roleVersion: 1 }, "update")]),
      push(A, ACTOR_A, [staffOp(`op-p2-${m2}`, { ...person(m2, A, "Manager two", "Admin"), roleVersion: 1 }, "update")]),
    ])
    expect([r1.results[0].status, r2.results[0].status].sort()).toEqual(["ok", "rejected"])
    expect(await admins(A)).toHaveLength(1)
  })

  it("stores are isolated: each store may have its own admin at the same moment", async () => {
    const a = randomUUID(), b = randomUUID()
    const [ra, rb] = await Promise.all([
      push(A, ACTOR_A, [staffOp(`op-ia-${a}`, person(a, A, "Admin A", "Admin"))]),
      push(B, ACTOR_B, [staffOp(`op-ib-${b}`, person(b, B, "Admin B", "Admin"))]),
    ])
    expect([ra.results[0].status, rb.results[0].status]).toEqual(["ok", "ok"])
    expect(await admins(A)).toHaveLength(1)
    expect(await admins(B)).toHaveLength(1)
  })

  it("the database itself refuses a second active admin, whatever the write path", async () => {
    const x = randomUUID(), y = randomUUID()
    await prisma.staffUser.create({ data: person(x, A, "Direct one", "Admin") as any })
    await expect(prisma.staffUser.create({ data: person(y, A, "Direct two", "Admin") as any })).rejects.toThrow()
    // Inactive admins do not count (a former admin can stay on record).
    await prisma.staffUser.create({ data: person(y, A, "Former admin", "Admin", { active: false }) as any })
    expect(await admins(A)).toHaveLength(1)
  })
})

describe("owner-portal admin transfer (atomic)", () => {
  async function store() {
    const cur = randomUUID(), next = randomUUID(), other = randomUUID(), inactive = randomUUID(), driver = randomUUID()
    await prisma.staffUser.create({ data: person(cur, A, "Current admin", "Admin") as any })
    await prisma.staffUser.createMany({ data: [person(next, A, "Successor", "Manager"), person(other, A, "Other manager", "Cashier"), person(inactive, A, "Left", "Manager", { active: false }), person(driver, A, "Driver", "Driver")] as any })
    // A sale and a pending operation recorded by the current admin: untouched by the transfer.
    await prisma.syncOperation.create({ data: { id: `op-pending-${cur}`, tenantId: A, entity: "expense", action: "create", summary: "pending", payload: { id: "x" }, status: "Pending", attempts: 0 } as any })
    return { cur, next, other, inactive, driver }
  }
  const row = (id: string) => prisma.staffUser.findUnique({ where: { id }, select: { role: true, pin: true, tokenVersion: true, pinVersion: true, active: true } })
  const sub = `oa-a-${tag}`

  it("promotes the successor and demotes the admin in one step; PINs and pending work kept; tokens revoked; audited", async () => {
    const s = await store()
    const before = { cur: await row(s.cur), next: await row(s.next) }
    const res = await transfer(A, s.next, sub)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ from: { id: s.cur }, to: { id: s.next } })
    const after = { cur: await row(s.cur), next: await row(s.next) }
    expect(after.cur).toMatchObject({ role: "Manager", pin: before.cur!.pin, pinVersion: before.cur!.pinVersion, tokenVersion: before.cur!.tokenVersion + 1 })
    expect(after.next).toMatchObject({ role: "Admin", pin: before.next!.pin, pinVersion: before.next!.pinVersion, tokenVersion: before.next!.tokenVersion + 1 })
    expect(await admins(A)).toEqual([{ id: s.next }])
    expect(await prisma.syncOperation.count({ where: { id: `op-pending-${s.cur}`, status: "Pending" } })).toBe(1)
    const audit = await prisma.auditEvent.findMany({ where: { tenantId: A, action: "staff.admin_transfer" } })
    expect(audit).toHaveLength(1)
    expect(audit[0].metadata).toMatchObject({ fromUserId: s.cur, toUserId: s.next, by: "owner-portal" })
  })

  it("a failure between demotion and promotion rolls both back (still exactly one admin, the same one)", async () => {
    const s = await store()
    adminTransferTestHooks.afterDemote = async () => { throw new Error("injected failure") }
    const res = await transfer(A, s.next, sub)
    expect(res.status).toBe(500)
    expect((await row(s.cur))?.role).toBe("Admin")
    expect((await row(s.next))?.role).toBe("Manager")
    expect(await admins(A)).toEqual([{ id: s.cur }])
    expect(await prisma.auditEvent.count({ where: { tenantId: A, action: "staff.admin_transfer" } })).toBe(0)
  })

  it("two simultaneous transfers to different successors: they run one after the other; exactly one admin at the end", async () => {
    const s = await store()
    const [r1, r2] = await Promise.all([transfer(A, s.next, sub), transfer(A, s.other, sub)])
    expect([r1.status, r2.status]).toEqual([200, 200])
    const final = await admins(A)
    expect(final).toHaveLength(1)
    expect([s.next, s.other]).toContain(final[0].id)
    expect(await prisma.auditEvent.count({ where: { tenantId: A, action: "staff.admin_transfer" } })).toBe(2)
  })

  it("refuses self-transfer, inactive people, drivers, people of another store and a wrong confirmation; nothing changes", async () => {
    const s = await store()
    const foreign = randomUUID()
    await prisma.staffUser.create({ data: person(foreign, B, "Other store", "Manager") as any })
    expect((await transfer(A, s.cur, sub)).status).toBe(400)       // already the admin
    expect((await transfer(A, s.inactive, sub)).status).toBe(400)  // inactive
    expect((await transfer(A, s.driver, sub)).status).toBe(400)    // driver
    expect((await transfer(A, foreign, sub)).status).toBe(404)     // another store's staff
    expect((await transfer(A, s.next, "wrong-store")).status).toBe(400)
    expect(await admins(A)).toEqual([{ id: s.cur }])
    expect((await row(foreign))?.role).toBe("Manager")
  })
})
