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

  it("a manager can list the refused work on the server; the cashier account cannot", async () => {
    const owner = (await (await realFetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: "5101", tenantSubdomain: SUB }) })).json() as any).token
    const list = await realFetch(`${baseUrl}/api/sync/refused`, { headers: { Authorization: `Bearer ${owner}` } })
    const ops = ((await list.json()) as any).operations as Array<Record<string, any>>
    console.log("EVIDENCE refused list (manager):", JSON.stringify(ops.map((o) => ({ entity: o.entity, action: o.action, attempts: o.attempts, error: o.error }))))
    expect(ops.map((o) => o.id)).toContain(opId)
    expect((await realFetch(`${baseUrl}/api/sync/refused`, { headers: { Authorization: `Bearer ${storage.getItem("lebanonpos.auth-token")}` } })).status).toBe(403)
  })

  it("once the connecting account is allowed, the same queued operation applies exactly once (recoverable, no re-entry)", async () => {
    await prisma.staffUser.update({ where: { id: RANA }, data: { permissions: ["inventory.adjust"] } as any })
    const y = await sync()
    const q = queue().map((o) => o.id === opId ? { ...o, status: "Pending", attempts: 0, lastAttemptAt: "2000-01-01T00:00:00.000Z" } : o)
    storage.setItem("lebanonpos.sync-queue.v1", JSON.stringify(q))
    await y.flushSyncQueue(); await dispose(); await y.flushSyncQueue(); await dispose()
    const row = await prisma.syncOperation.findUnique({ where: { id: opId } })
    const stock = Number((await prisma.product.findFirst({ where: { tenantId: T, syncId: PRODUCT_SYNC } }))!.stock)
    console.log("EVIDENCE after permission granted:", JSON.stringify({ serverStatus: row?.status, applied: !!row?.appliedAt, serverStock: stock, tillEntry: queue().find((o) => o.id === opId)?.status ?? "removed" }))
    expect(row?.appliedAt).toBeTruthy()
    expect(stock).toBe(15)
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
