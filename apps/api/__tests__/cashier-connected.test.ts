import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomUUID } from "node:crypto"
import jwt from "jsonwebtoken"

// CASHIER-CONNECTED TILL (HOTFIX; the REAL 1.0.50 till services + real API + real Postgres). A till whose
// sync connection is a CASHIER's account, while a MANAGER is unlocked on it locally: what happens to
// work the server refuses because the connecting account lacks the permission. Evidence for the
// containment release decision.
process.env.JWT_SECRET = process.env.JWT_SECRET || "cashier-connected-secret"

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

const T = randomUUID(), SUB = `cc-${T.slice(0, 8)}`
const OWNER = randomUUID(), RANA = randomUUID(), SAMI = randomUUID()
const PRODUCT_SYNC = randomUUID()
let server: http.Server
let baseUrl = ""
const sec = () => import("../../desktop/src/features/pos/services/security.service.js")
const sync = () => import("../../desktop/src/features/pos/services/sync.service.js")
const cached = () => JSON.parse(storage.getItem("lebanonpos.users.v1") ?? "[]") as Array<Record<string, unknown>>

beforeAll(async () => {
  server = http.createServer(app)
  await new Promise<void>((r) => server.listen(0, r))
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`
  await prisma.tenant.create({ data: { id: T, name: "Cashier-connected IT (disposable)", subdomain: SUB } })
  await prisma.staffUser.create({ data: { id: OWNER, tenantId: T, name: "Owner", mobile: `cc-o-${T.slice(0, 6)}`, pin: await bcrypt.hash("5101", 12), role: "Admin" } })
  await prisma.staffUser.create({ data: { id: RANA, tenantId: T, name: "Rana", mobile: `cc-r-${T.slice(0, 6)}`, pin: await bcrypt.hash("5102", 12), role: "Cashier" } })
  await prisma.staffUser.create({ data: { id: SAMI, tenantId: T, name: "Sami (manager)", mobile: `cc-s-${T.slice(0, 6)}`, pin: await bcrypt.hash("5103", 12), role: "Manager", permissions: ["sales.checkout", "inventory.manage"] } as any })
  await prisma.product.create({ data: { tenantId: T, syncId: PRODUCT_SYNC, name: "Milk 1L", price: 1.5, cost: 1, stock: 10, category: "Dairy", barcode: `cc-${T.slice(0, 6)}` } })
  // The till was CONNECTED with the cashier Rana's PIN (real login): its sync token is Rana's.
  storage.setItem("lebanonpos.api-url", baseUrl)
  storage.setItem("lebanonpos.store-subdomain.v1", SUB)
  storage.setItem("lebanonpos.tenant-id.v1", T)
  const login = await (await realFetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: "5102", tenantSubdomain: SUB }) })).json() as any
  storage.setItem("lebanonpos.auth-token", login.token)
  storage.setItem("lebanonpos.users.v1", "[]")
})
afterAll(async () => {
  await dispose()
  for (const m of ["auditEvent", "syncOperation", "stockAdjustment", "stockMovement", "inventoryBatch", "product", "staffUser"] as const) await (prisma[m] as any).deleteMany({ where: { tenantId: T } }).catch(() => undefined)
  await prisma.tenant.deleteMany({ where: { id: T } })
  await new Promise<void>((r) => server.close(() => r()))
})

const inv = () => import("../../desktop/src/features/pos/services/inventoryAdjustment.service.js")
const queue = () => JSON.parse(storage.getItem("lebanonpos.sync-queue.v1") ?? "[]") as Array<Record<string, any>>
const localStock = () => Number((JSON.parse(storage.getItem("lebanonpos.products.v1") ?? "[]") as any[]).find((p) => p.syncId === PRODUCT_SYNC)?.stock)
const tokenUser = () => (jwt.decode(storage.getItem("lebanonpos.auth-token")!) as any).userId

describe("a cashier-connected till with a manager unlocked locally (1.0.50 till, hotfix server)", () => {
  let opId = ""
  it("setup: full pull; the manager unlocks ONLINE — the sync connection stays the cashier's", async () => {
    const y = await sync(), s = await sec()
    await y.pullFromServer(true); await dispose()
    expect(localStock()).toBe(10)
    expect((await s.unlockWithPin("5103"))?.id).toBe(SAMI)
    await dispose()
    expect(tokenUser()).toBe(RANA)
  })

  it("the manager records a stock adjustment: applied locally, then the server refuses it (connecting account lacks inventory.adjust)", async () => {
    const product = (JSON.parse(storage.getItem("lebanonpos.products.v1")!) as any[]).find((p) => p.syncId === PRODUCT_SYNC)
    ;(await inv()).recordStockAdjustment({ productId: product.id, quantityChange: 5, reason: "Count Correction" as any, note: "delivery counted" })
    expect(localStock()).toBe(15)
    const y = await sync(); await y.flushSyncQueue(); await dispose()
    const op = queue().find((o) => o.entity === "inventory" && o.action === "adjust")!
    opId = op.id
    console.log("EVIDENCE till queue entry:", JSON.stringify({ status: op.status, attempts: op.attempts, error: op.error }))
    expect(op.status).not.toBe("Synced")
    expect(String(op.error)).toMatch(/permission/i)
    expect(Number((await prisma.product.findFirst({ where: { tenantId: T, syncId: PRODUCT_SYNC } }))!.stock)).toBe(10)
    const row = await prisma.syncOperation.findUnique({ where: { id: opId } })
    console.log("EVIDENCE server record:", JSON.stringify({ status: row?.status, appliedAt: row?.appliedAt, hasPayload: !!row?.payload, error: row?.error }))
    // Refused work is kept on the server: unapplied, with its payload and reason, never forwarded.
    expect(row).toMatchObject({ status: "Refused", appliedAt: null })
    expect((row!.payload as any).quantityChange ?? (row!.payload as any).quantity).toBeDefined()
    expect(String(row!.error)).toMatch(/permission/i)
    const audit = await prisma.auditEvent.findMany({ where: { tenantId: T }, select: { action: true, summary: true } })
    console.log("EVIDENCE server audit:", JSON.stringify(audit))
  })

  it("retries: the refusal repeats; after the retry limit the entry is still kept and counted on the till", async () => {
    const y = await sync()
    for (let i = 0; i < 6; i++) { const q = queue().map((o) => o.id === opId ? { ...o, status: o.status === "Failed" ? "Pending" : o.status, lastAttemptAt: "2000-01-01T00:00:00.000Z" } : o); storage.setItem("lebanonpos.sync-queue.v1", JSON.stringify(q)); await y.flushSyncQueue(); await dispose() }
    const op = queue().find((o) => o.id === opId)
    const status = y.getSyncStatus() as any
    console.log("EVIDENCE after retries:", JSON.stringify({ status: op?.status, attempts: op?.attempts, kept: !!op, syncStatus: { failed: status.failed, dead: status.dead, rejected: status.rejected, pending: status.pending } }))
    expect(op).toBeTruthy()
  })

  it("a full pull then shows the server's stock (10) while the refused adjustment stays only in the till's queue", async () => {
    const y = await sync()
    await y.pullFromServer(true); await dispose()
    console.log("EVIDENCE after full pull:", JSON.stringify({ localStock: localStock(), stillQueued: !!queue().find((o) => o.id === opId) }))
    expect(queue().find((o) => o.id === opId)).toBeTruthy()
  })

  const loginAs = async (pin: string) => (await (await realFetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin, tenantSubdomain: SUB }) })).json() as any).token as string
  const review = (token: string) => realFetch(`${baseUrl}/api/sync/refused`, { headers: { Authorization: `Bearer ${token}` } })
  const resolve = (token: string, id: string, decision: string, note = "counted the delivery myself") =>
    realFetch(`${baseUrl}/api/sync/refused/${id}/resolve`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ decision, note }) })
  const serverStock = async () => Number((await prisma.product.findFirst({ where: { tenantId: T, syncId: PRODUCT_SYNC } }))!.stock)
  /** The till's own "Retry failed": put the queued entry back to pending and flush. */
  const retryOnTill = async (id: string) => {
    const y = await sync()
    storage.setItem("lebanonpos.sync-queue.v1", JSON.stringify(queue().map((o) => o.id === id ? { ...o, status: "Pending", attempts: 0, lastAttemptAt: "2000-01-01T00:00:00.000Z" } : o)))
    await y.flushSyncQueue(); await dispose()
    return queue().find((o) => o.id === id)
  }

  it("review: a manager sees the original command, the till's local effect, the server effect, the reason and the actor limitations; a cashier cannot", async () => {
    const sami = await loginAs("5103")
    const r = await review(sami)
    const ops = ((await r.json()) as any).operations as Array<Record<string, any>>
    const op = ops.find((o) => o.id === opId)!
    console.log("EVIDENCE review item:", JSON.stringify({ reason: op.reason, pushedBy: op.pushedBy?.name, deviceId: op.deviceId, effects: op.effects, limitations: op.limitations, requiredPermissions: op.requiredPermissions, canResolve: op.canResolve }))
    expect(op).toMatchObject({ entity: "inventory", action: "adjust", status: "Refused", reason: "You don't have permission to adjust inventory", canResolve: true })
    expect(op.pushedBy).toMatchObject({ id: RANA, name: "Rana" })
    expect(op.effects[0]).toMatchObject({ kind: "stock-change", product: "Milk 1L", change: 5, serverNow: 10, serverAfter: 15 })
    expect(op.limitations).toEqual(expect.arrayContaining(["connection-account-not-proven-actor", "no-actor-recorded", "device-id-claimed"]))
    expect(op.payload.quantityChange).toBe(5)
    expect((await review(storage.getItem("lebanonpos.auth-token")!)).status).toBe(403) // Rana: no reports.view
  })

  it("resolve: the cashier cannot decide; the manager applies it once under their own authority; a second decision and the till's resend change nothing", async () => {
    expect((await resolve(storage.getItem("lebanonpos.auth-token")!, opId, "apply")).status).toBe(403)
    expect((await resolve(await loginAs("5103"), opId, "apply", "")).status).toBe(400) // a note is required
    const sami = await loginAs("5103")
    const [first, second] = await Promise.all([resolve(sami, opId, "apply"), resolve(sami, opId, "apply")])
    const statuses = [first.status, second.status].sort()
    console.log("EVIDENCE concurrent decisions:", JSON.stringify(statuses))
    expect(statuses).toEqual([200, 409])
    expect(await serverStock()).toBe(15)
    // The losing side of a race read the row as still Refused: the decision must still be refused.
    const staleRow = { ...(await prisma.syncOperation.findFirst({ where: { id: opId } }))!, status: "Refused", appliedAt: null }
    const stale = vi.spyOn(prisma.syncOperation, "findFirst").mockResolvedValueOnce(staleRow as any)
    expect((await resolve(sami, opId, "apply")).status).toBe(409)
    stale.mockRestore()
    expect(await serverStock()).toBe(15)
    expect((await resolve(sami, opId, "dismiss")).status).toBe(409) // already decided
    const tillEntry = await retryOnTill(opId)
    console.log("EVIDENCE till resend after apply:", JSON.stringify({ tillStatus: tillEntry?.status ?? "acknowledged", serverStock: await serverStock() }))
    expect(await serverStock()).toBe(15)
    expect(await prisma.stockAdjustment.count({ where: { tenantId: T, productId: (await prisma.product.findFirst({ where: { tenantId: T, syncId: PRODUCT_SYNC } }))!.id } })).toBe(1)
    const audit = await prisma.auditEvent.findFirst({ where: { tenantId: T, action: "sync.refused.applied" } })
    expect((audit!.metadata as any)).toMatchObject({ opId, reviewerId: SAMI, pushedBy: RANA, note: "counted the delivery myself" })
  })

  it("review never shows PINs or credentials from the refused operation", async () => {
    const op = { id: randomUUID(), entity: "customer", action: "create", payload: { id: randomUUID(), name: "Walk-in", mobile: `cc-${randomUUID().slice(0, 6)}`, pin: "4321", nested: { sessionToken: "eyJsecret" } } }
    const r = await realFetch(`${baseUrl}/api/sync/push`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${storage.getItem("lebanonpos.auth-token")}` }, body: JSON.stringify({ deviceId: "t", operations: [op] }) })
    expect(((await r.json()) as any).results[0].status).toBe("error")
    const body = JSON.stringify(await (await review(await loginAs("5101"))).json())
    expect(body).toContain(op.id)
    expect(body).not.toContain("4321")
    expect(body).not.toContain("eyJsecret")
  })

  it("dismiss: a declined adjustment never applies, the till is told who declined it and that nothing was undone; its local effect stays", async () => {
    const product = (JSON.parse(storage.getItem("lebanonpos.products.v1")!) as any[]).find((p) => p.syncId === PRODUCT_SYNC)
    const localBefore = localStock()
    ;(await inv()).recordStockAdjustment({ productId: product.id, quantityChange: -2, reason: "Damaged" as any, note: "broken" })
    const y = await sync(); await y.flushSyncQueue(); await dispose()
    const second = queue().find((o) => o.entity === "inventory" && o.action === "adjust" && o.id !== opId)!
    expect((await prisma.syncOperation.findUnique({ where: { id: second.id } }))!.status).toBe("Refused")
    expect((await resolve(await loginAs("5103"), second.id, "dismiss", "not damaged, found on the shelf")).status).toBe(200)
    const tillEntry = await retryOnTill(second.id)
    console.log("EVIDENCE till resend after dismiss:", JSON.stringify({ tillStatus: tillEntry?.status, error: tillEntry?.error, serverStock: await serverStock() }))
    expect(tillEntry?.status).toBe("Rejected")
    expect(String(tillEntry?.error)).toContain('DISMISSED: declined by Sami (manager) on review ("not damaged, found on the shelf").')
    expect(String(tillEntry?.error)).toMatch(/nothing this register already did .* was undone/)
    expect(await serverStock()).toBe(15)
    // The decline is NOT a reversal: the register's own -2 is still in effect locally (until its next full sync replaces stock with the server's).
    console.log("EVIDENCE local effect after decline:", JSON.stringify({ localBefore, localAfterDecline: localStock(), serverStock: await serverStock() }))
    expect(localStock()).toBe(localBefore - 2)
    expect((await prisma.syncOperation.findUnique({ where: { id: second.id } }))!.status).toBe("Dismissed")
  })

  it("cost: hidden from the cashier on the report/catalogue endpoints, still delivered to the till by sync (needed for offline sale cost)", async () => {
    const cashier = storage.getItem("lebanonpos.auth-token")!
    const api = await realFetch(`${baseUrl}/api/products`, { headers: { Authorization: `Bearer ${cashier}` } })
    const items = (await api.json()) as any
    const p = (Array.isArray(items) ? items : items.products ?? items.items ?? []).find((x: any) => x.syncId === PRODUCT_SYNC)
    const tillCost = (JSON.parse(storage.getItem("lebanonpos.products.v1")!) as any[]).find((x) => x.syncId === PRODUCT_SYNC)?.cost
    console.log("EVIDENCE cost:", JSON.stringify({ apiStatus: api.status, costOnApiProducts: p ? p.cost ?? "absent" : "product not listed", costInTillCache: tillCost }))
    expect(p?.cost).toBeUndefined()
    expect(Number(tillCost)).toBe(1)
  })
})

describe("shared PIN on a 1.0.50 till against the hotfix server (409 AMBIGUOUS_PIN)", () => {
  const HADI = randomUUID(), LINA = randomUUID()
  beforeAll(async () => {
    await prisma.staffUser.create({ data: { id: HADI, tenantId: T, name: "Hadi (manager)", mobile: `cc-h-${T.slice(0, 6)}`, pin: await bcrypt.hash("5199", 12), role: "Manager" } })
    await prisma.staffUser.create({ data: { id: LINA, tenantId: T, name: "Lina", mobile: `cc-l-${T.slice(0, 6)}`, pin: await bcrypt.hash("5199", 12), role: "Cashier" } })
    const y = await sync(); await y.pullFromServer(true); await dispose()
  })

  it("the server refuses the shared PIN online", async () => {
    const r = await realFetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: "5199", tenantSubdomain: SUB }) })
    expect(r.status).toBe(409)
  })

  it("a till where neither has unlocked before: the 1.0.50 till has no local match and refuses", async () => {
    const s = await sec()
    const who = await s.unlockWithPin("5199"); await dispose()
    console.log("EVIDENCE shared PIN, no prior unlock on this till:", JSON.stringify({ unlocked: who?.name ?? null }))
    expect(who).toBeNull()
    storage.removeItem("lebanonpos.pin-attempts.v1")
  })

  it("a till where the manager unlocked before the hotfix: the 1.0.50 till falls back to its local verifier and signs in the MANAGER", async () => {
    const s = await sec()
    // What the pre-hotfix server produced: it resolved the shared PIN to the higher role, and the till cached that verifier.
    const h = await s.hashPin("5199")
    storage.setItem("lebanonpos.users.v1", JSON.stringify(cached().map((u) => u.id === HADI ? { ...u, pin: h, lastVerifiedPinVersion: u.pinVersion ?? 1 } : u)))
    const who = await s.unlockWithPin("5199"); await dispose()
    console.log("EVIDENCE shared PIN, manager unlocked here before:", JSON.stringify({ unlocked: who?.name ?? null, role: who?.role ?? null, syncTokenStillCashier: tokenUser() === RANA }))
    expect(who?.id).toBe(HADI)
    expect(tokenUser()).toBe(RANA)
  })
})
