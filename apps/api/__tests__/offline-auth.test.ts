import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomUUID } from "node:crypto"
import jwt from "jsonwebtoken"

// OFFLINE-AUTH — HOTFIX variant: the REAL 1.0.50 till services (apps/desktop at the deployed revision)
// against the hotfix server, real API, real Postgres. Shows what the deployed tills need offline:
// with staff PIN verifiers withheld their offline unlock stops working after a full pull (measured),
// so the hotfix keeps sending them to staff tills and withholds only customer PIN hashes.
//  - verified online once → still unlocks offline after incremental AND full pulls;
//  - never verified on this till → no offline login (documented rule since 1.0.49);
//  - PIN reset elsewhere → the pull's newer pinVersion stops the old PIN offline;
//  - deactivated → the pull's active=false stops offline login.
process.env.JWT_SECRET = process.env.JWT_SECRET || "offline-auth-secret"

class MemoryStorage {
  private m = new Map<string, string>()
  get length() { return this.m.size }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
  clear() { this.m.clear() }
}
const storage = new MemoryStorage()
const events = new EventTarget()
const g = globalThis as unknown as Record<string, unknown>
g.localStorage = storage
const deviceTimers = new Set<ReturnType<typeof setTimeout>>()
g.window = new Proxy(globalThis, {
  get(t, k) {
    if (k === "setTimeout") return (fn: () => void, ms?: number) => { const id = setTimeout(() => { deviceTimers.delete(id); fn() }, ms); deviceTimers.add(id); return id }
    if (k === "clearTimeout") return (id: ReturnType<typeof setTimeout>) => { deviceTimers.delete(id); clearTimeout(id) }
    return Reflect.get(t, k)
  },
})
g.addEventListener = events.addEventListener.bind(events)
g.removeEventListener = events.removeEventListener.bind(events)
g.dispatchEvent = events.dispatchEvent.bind(events)
let offline = false
let failEntity = "" // simulate an older server that refuses one entity of the full pull
const inflight = new Set<Promise<unknown>>()
const realFetch = globalThis.fetch
g.fetch = ((url: string, init?: RequestInit) => {
  if (offline) return Promise.reject(new TypeError("Failed to fetch (offline)"))
  if (failEntity && String(url).includes(`/pull/full/${failEntity}`)) return Promise.resolve(new Response(JSON.stringify({ error: "Unknown entity" }), { status: 400 }))
  const p = realFetch(url, init); inflight.add(p); void p.catch(() => undefined).finally(() => inflight.delete(p)); return p
}) as typeof fetch
async function dispose() {
  for (const id of deviceTimers) clearTimeout(id)
  deviceTimers.clear()
  for (let i = 0; i < 20 && (inflight.size > 0 || i < 3); i++) { await Promise.allSettled([...inflight]); await new Promise((r) => setImmediate(r)) }
}

const prisma = (await import("../src/lib/prisma.js")).default
const app = (await import("../src/app.js")).default
const bcrypt = (await import("bcryptjs")).default
delete process.env.IS_LOCAL_SERVER
vi.setConfig({ testTimeout: 60_000 })

const T = randomUUID(), SUB = `oa-${T.slice(0, 8)}`
const OWNER = randomUUID(), RANA = randomUUID(), SAMI = randomUUID()
let server: http.Server
let baseUrl = ""
const sec = () => import("../../desktop/src/features/pos/services/security.service.js")
const sync = () => import("../../desktop/src/features/pos/services/sync.service.js")
const cached = () => JSON.parse(storage.getItem("lebanonpos.users.v1") ?? "[]") as Array<Record<string, unknown>>

beforeAll(async () => {
  server = http.createServer(app)
  await new Promise<void>((r) => server.listen(0, r))
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`
  await prisma.tenant.create({ data: { id: T, name: "Offline auth IT (disposable)", subdomain: SUB } })
  await prisma.staffUser.create({ data: { id: OWNER, tenantId: T, name: "Owner", mobile: `oa-o-${T.slice(0, 6)}`, pin: await bcrypt.hash("5101", 12), role: "Admin" } })
  await prisma.staffUser.create({ data: { id: RANA, tenantId: T, name: "Rana", mobile: `oa-r-${T.slice(0, 6)}`, pin: await bcrypt.hash("5102", 12), role: "Cashier" } })
  await prisma.staffUser.create({ data: { id: SAMI, tenantId: T, name: "Sami", mobile: `oa-s-${T.slice(0, 6)}`, pin: await bcrypt.hash("5103", 12), role: "Cashier" } })
  // A till connected to this store with the owner's connection token (as the connect screen does).
  storage.setItem("lebanonpos.api-url", baseUrl)
  storage.setItem("lebanonpos.store-subdomain.v1", SUB)
  storage.setItem("lebanonpos.tenant-id.v1", T)
  storage.setItem("lebanonpos.auth-token", jwt.sign({ userId: OWNER, tenantId: T, role: "Admin", tokenVersion: 1 }, process.env.JWT_SECRET!, { expiresIn: "1h" }))
  storage.setItem("lebanonpos.users.v1", "[]")
})
afterAll(async () => {
  await dispose()
  for (const m of ["auditEvent", "syncOperation", "staffUser"] as const) await (prisma[m] as any).deleteMany({ where: { tenantId: T } })
  await prisma.tenant.deleteMany({ where: { id: T } })
  await new Promise<void>((r) => server.close(() => r()))
})

describe("offline login of 1.0.50 tills against the hotfix server", () => {
  it("the till still receives staff records with their PIN verifiers (1.0.50 needs them); customer PIN hashes are not sent", async () => {
    const s = await sync()
    await s.pullFromServer(true)
    await dispose()
    const users = cached()
    expect(users.map((u) => u.name).sort()).toEqual(["Owner", "Rana", "Sami"])
    const owner = await prisma.staffUser.findFirst({ where: { tenantId: T, name: "Owner" } })
    const token = jwt.sign({ userId: owner!.id, tenantId: T, role: "Admin" }, process.env.JWT_SECRET!, { expiresIn: "1h" })
    await prisma.customer.create({ data: { tenantId: T, name: "Walk-in", mobile: `oa-${T.slice(0, 6)}`, pin: "$2b$12$fakefakefakefakefakefuQ7cY2N5yq0Qx3Jz4m1M5x8l1u3nY6uW" } as any })
    const pulled = await (await realFetch(`${baseUrl}/api/sync/pull/full/customers?limit=50`, { headers: { Authorization: `Bearer ${token}` } })).json() as any
    const rows = pulled.items ?? pulled.customers ?? pulled.data ?? []
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((c: any) => !("pin" in c))).toBe(true)
    await prisma.customer.deleteMany({ where: { tenantId: T } })
  })

  it("Rana signs in online once on this till; then, offline, her PIN still unlocks", async () => {
    const s = await sec()
    expect((await s.unlockWithPin("5102"))?.id).toBe(RANA)
    await dispose()
    offline = true
    try { expect((await s.unlockWithPin("5102"))?.id).toBe(RANA) } finally { offline = false }
  })

  it("...still after an incremental pull and after a full pull (the till keeps its own verifier)", async () => {
    const y = await sync(), s = await sec()
    await y.pullFromServer(false); await dispose()
    offline = true
    try { expect((await s.unlockWithPin("5102"))?.id).toBe(RANA) } finally { offline = false }
    await y.pullFromServer(true); await dispose()
    offline = true
    try { expect((await s.unlockWithPin("5102"))?.id).toBe(RANA) } finally { offline = false }
  })

  // KNOWN 1.0.50 LIMITATION (fixed by the Sprint 0 till, not part of this server hotfix): a full pull
  // that fails part-way skips the 1.0.50 till's verifier restore. With this server, full pulls no
  // longer fail on cash-movements (it is now served), which was the usual trigger.
  it.fails("KNOWN 1.0.50 LIMITATION: a full pull that fails part-way keeps the offline verifiers", async () => {
    const y = await sync(), s = await sec()
    failEntity = "cash-movements"
    try { await y.pullFromServer(true); await dispose() } finally { failEntity = "" }
    expect(cached().find((u) => u.id === RANA)?.lastVerifiedPinVersion).toBe(1)
    offline = true
    try { expect((await s.unlockWithPin("5102"))?.id).toBe(RANA) } finally { offline = false }
  })

  it("Sami never signed in on this till: no offline login for him (needs one online sign-in)", async () => {
    const s = await sec()
    storage.removeItem("lebanonpos.pin-attempts.v1")
    offline = true
    try { expect(await s.unlockWithPin("5103")).toBeNull() } finally { offline = false }
    storage.removeItem("lebanonpos.pin-attempts.v1")
  })

  it("a PIN reset by the owner: after the next pull, Rana's old PIN no longer works offline", async () => {
    await prisma.staffUser.update({ where: { id: RANA }, data: { pin: await bcrypt.hash("5202", 12), pinVersion: { increment: 1 }, tokenVersion: { increment: 1 } } })
    const y = await sync(), s = await sec()
    await y.pullFromServer(true); await dispose()
    storage.removeItem("lebanonpos.pin-attempts.v1")
    offline = true
    try { expect(await s.unlockWithPin("5102")).toBeNull() } finally { offline = false }
    storage.removeItem("lebanonpos.pin-attempts.v1")
    // Online with the new PIN works, and then the new PIN works offline too.
    expect((await s.unlockWithPin("5202"))?.id).toBe(RANA)
    await dispose()
    offline = true
    try { expect((await s.unlockWithPin("5202"))?.id).toBe(RANA) } finally { offline = false }
  })

  it("deactivated by the owner: after the next pull, Rana cannot unlock offline", async () => {
    await prisma.staffUser.update({ where: { id: RANA }, data: { active: false, roleVersion: { increment: 1 }, tokenVersion: { increment: 1 } } })
    const y = await sync(), s = await sec()
    await y.pullFromServer(true); await dispose()
    storage.removeItem("lebanonpos.pin-attempts.v1")
    offline = true
    try { expect(await s.unlockWithPin("5202")).toBeNull() } finally { offline = false }
  })
})
