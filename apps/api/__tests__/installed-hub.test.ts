import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { randomUUID } from "node:crypto"
import { existsSync, readFileSync, appendFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import jwt from "jsonwebtoken"

// INSTALLED HUB ACCEPTANCE (docs/LEGACY-TILL-COMPAT.md). Runs against an ALREADY RUNNING installed hub
// candidate (started with apps/electron/scripts/it-hub.mjs against a local test cloud from
// scripts/it-cloud.mjs, activated for a disposable store) — never against a real hub or production.
// A till's own services (HUB_TILL_SRC: the released 1.0.51 source, or this repository's) pair with the
// hub, sync through it, and check: offline login, cost-hidden checkout, operation permissions,
// Refused work review on the hub and its forwarding to the cloud, and customer/driver containment.
//
//   INSTALLED_HUB_URL=http://127.0.0.1:3015  INSTALLED_HUB_STORE=<stores.json from the seed>
//   HUB_TILL_SRC=<checkout>/apps/desktop/src  HUB_TILL_LABEL=1.0.51  (DATABASE_URL = the cloud's scratch schema)
const HUB = process.env.INSTALLED_HUB_URL
const STORE_FILE = process.env.INSTALLED_HUB_STORE
const SRC = process.env.HUB_TILL_SRC?.replace(/\\/g, "/")
const LABEL = process.env.HUB_TILL_LABEL ?? "till"
const ready = !!HUB && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(HUB) && !!STORE_FILE && existsSync(STORE_FILE) && !!SRC && existsSync(`${SRC}/features/pos/services/sync.service.ts`)

function evidence(what: string, data: unknown) {
  const line = `EVIDENCE hub/${LABEL} ${what}: ${JSON.stringify(data)}`
  console.log(line)
  if (process.env.LEGACY_TILL_EVIDENCE) appendFileSync(process.env.LEGACY_TILL_EVIDENCE, `${new Date().toISOString()} ${line}\n`)
}

class MemoryStorage {
  private m = new Map<string, string>()
  get length() { return this.m.size }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
  clear() { this.m.clear() }
}

vi.setConfig({ testTimeout: 240_000, hookTimeout: 120_000 })

if (!ready) {
  describe.skip("installed hub acceptance: set INSTALLED_HUB_URL (loopback), INSTALLED_HUB_STORE and HUB_TILL_SRC to run", () => { it("skipped", () => undefined) })
} else {
  const store = JSON.parse(readFileSync(STORE_FILE!, "utf8")) as { A: { tenantId: string; subdomain: string; driverCode: string; milkSyncId: string; staff: Record<string, string> }; B: { tenantId: string; subdomain: string } }
  const A = store.A
  const storage = new MemoryStorage()
  const events = new EventTarget()
  const g = globalThis as unknown as Record<string, unknown>
  g.localStorage = storage
  const timers = new Set<ReturnType<typeof setTimeout>>()
  g.window = new Proxy(globalThis, {
    get(t, k) {
      if (k === "setTimeout") return (fn: () => void, ms?: number) => { const id = setTimeout(() => { timers.delete(id); fn() }, ms); timers.add(id); return id }
      if (k === "clearTimeout") return (id: ReturnType<typeof setTimeout>) => { timers.delete(id); clearTimeout(id) }
      return Reflect.get(t, k)
    },
  })
  g.addEventListener = events.addEventListener.bind(events)
  g.removeEventListener = events.removeEventListener.bind(events)
  g.dispatchEvent = events.dispatchEvent.bind(events)
  let offline = false
  const inflight = new Set<Promise<unknown>>()
  const realFetch = globalThis.fetch
  g.fetch = ((url: string, init?: RequestInit) => {
    if (offline) return Promise.reject(new TypeError("Failed to fetch (offline)"))
    const p = realFetch(url, init); inflight.add(p); void p.catch(() => undefined).finally(() => inflight.delete(p)); return p
  }) as typeof fetch
  const dispose = async () => {
    for (const id of timers) clearTimeout(id)
    timers.clear()
    for (let i = 0; i < 20 && (inflight.size > 0 || i < 3); i++) { await Promise.allSettled([...inflight]); await new Promise((r) => setImmediate(r)) }
  }
  const mod = (name: string) => import(/* @vite-ignore */ pathToFileURL(`${SRC}/features/pos/services/${name}.ts`).href)
  let d: Record<string, any>
  const queue = () => JSON.parse(storage.getItem("lebanonpos.sync-queue.v1") ?? "[]") as Array<Record<string, any>>
  const flush = async () => {
    for (let i = 0; i < 3; i++) {
      storage.setItem("lebanonpos.sync-queue.v1", JSON.stringify(queue().map((op) => ({ ...op, status: op.status === "Failed" ? "Pending" : op.status, lastAttemptAt: "2000-01-01T00:00:00.000Z" }))))
      await d.sync.flushSyncQueue()
    }
    await dispose()
  }
  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const r = await realFetch(`${HUB}${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: r.status, body: (await r.json().catch(() => null)) as any }
  }
  const login = async (pin: string, extra: Record<string, unknown> = {}) => (await call("POST", "/api/auth/login", { pin, tenantSubdomain: A.subdomain, ...extra })).body?.token as string
  const unlockOffline = async (pin: string) => {
    storage.removeItem("lebanonpos.pin-attempts.v1"); offline = true
    try { return await d.security.unlockWithPin(pin) } finally { offline = false; storage.removeItem("lebanonpos.pin-attempts.v1") }
  }
  const localMilk = () => (JSON.parse(storage.getItem("lebanonpos.products.v1") ?? "[]") as any[]).find((p) => p.syncId === A.milkSyncId)
  let prisma: any
  /** The cloud's copy, once the hub's bridge has forwarded it (the bridge runs on its own schedule). */
  const inCloud = async <T>(read: () => Promise<T | null | undefined>, ms = 150_000): Promise<T | null> => {
    const end = Date.now() + ms
    for (;;) { const v = await read(); if (v) return v; if (Date.now() > end) return null; await new Promise((r) => setTimeout(r, 2000)) }
  }
  const deviceId = `hub-it-${LABEL}-${randomUUID().slice(0, 6)}`
  let owner = ""

  beforeAll(async () => {
    prisma = (await import("../src/lib/prisma.js")).default
    // The cloud database must be the seeded scratch store's.
    expect(await prisma.tenant.findUnique({ where: { id: A.tenantId }, select: { id: true } })).toBeTruthy()
    storage.setItem("lebanonpos.api-url", HUB!)
    storage.setItem("lebanonpos.connection-mode.v1", "CONNECT_TO_HUB")
    storage.setItem("lebanonpos.store-subdomain.v1", A.subdomain)
    storage.setItem("lebanonpos.tenant-id.v1", A.tenantId)
    storage.setItem("lebanonpos.device-id.v1", deviceId)
    storage.setItem("lebanonpos.users.v1", "[]")
    d = { sync: await mod("sync.service"), security: await mod("security.service"), sales: await mod("sales.service"), batches: await mod("inventoryBatch.service"), adjust: await mod("inventoryAdjustment.service"), devices: await mod("deviceRegistry.service") }
    owner = await login("1501")
    expect(owner).toBeTruthy()
  })
  afterAll(async () => { await dispose(); await prisma?.$disconnect() })

  describe(`installed hub candidate with a paired ${LABEL} till`, () => {
    it("the hub runs and serves only its own store", async () => {
      const h = await call("GET", "/api/health")
      expect(h.status).toBe(200)
      const pulled = await call("GET", "/api/sync/pull/full/products?limit=500", undefined, owner)
      const names = (pulled.body.items as any[]).map((p) => p.name)
      evidence("hub catalogue", { status: pulled.status, names })
      expect(names).toContain("Milk 1L")
      expect(names).not.toContain("Store B secret item")
    })

    it("pairing: the owner generates a code on the hub; the till pairs with it; a cashier cannot manage devices", async () => {
      const code = await call("POST", "/api/device/generate-code", {}, owner)
      expect(code.status).toBe(200)
      const paired = await d.devices.pairDevice(code.body.code, deviceId, `Till ${LABEL}`)
      expect(paired.ok).toBe(true)
      const list = await call("GET", "/api/device/list", undefined, owner)
      const mine = (list.body.devices ?? list.body ?? []).find((x: any) => x.deviceId === deviceId)
      evidence("pairing", { status: mine?.status ?? null, enrolled: !!mine?.enrolledAt, tillKeptCredential: !!storage.getItem("lebanonpos.device-credential.v1") })
      expect(mine?.status).toBe("APPROVED")
      const rana = await login("1504")
      expect((await call("GET", "/api/device/list", undefined, rana)).status).toBe(403)
      expect((await call("POST", "/api/device/generate-code", {}, rana)).status).toBe(403)
    })

    it("connected as the clerk: the hub sends no verifier and no cost; offline login works after a full pull", async () => {
      storage.setItem("lebanonpos.auth-token", await login("1503"))
      await d.sync.pullFromServer(true); await dispose()
      const users = JSON.parse(storage.getItem("lebanonpos.users.v1")!) as any[]
      expect([...new Set(users.map((u) => u.pin))]).toEqual(["$2-withheld"])
      expect(localMilk()?.cost).toBeUndefined()
      expect((await d.security.unlockWithPin("1504"))?.id).toBe(A.staff.rana); await dispose()
      await d.sync.pullFromServer(true); await dispose()
      expect((await unlockOffline("1504"))?.id).toBe(A.staff.rana)
      expect((await d.security.unlockWithPin("1503"))?.id).toBe(A.staff.clerk); await dispose()
    })

    it("cost-hidden checkout through the hub: valued at the server's cost on the hub and, after forwarding, in the cloud", async () => {
      d.security.openShift(50)
      const milk = localMilk()
      const id = randomUUID()
      const sale = d.sales.buildSale({
        saleNumber: `S-HUB-${id.slice(0, 6)}`, paymentMethod: "Cash", subtotal: 3, tax: 0, total: 3,
        items: [{ id: milk.id, productSyncId: milk.syncId, name: milk.name, barcode: milk.barcode ?? "", cost: 999, quantity: 2, unitPrice: 1.5, total: 3, batchAllocations: [] }],
      }, id)
      expect(d.sales.checkoutLocalSale({ sale, lots: [{ productId: milk.id, productName: milk.name, barcode: milk.barcode ?? "", quantity: 2, fallbackUnitCost: milk.cost }], stock: [{ productId: milk.id, quantity: 2 }] }).status).toBe("completed")
      await flush()
      const onHub = ((await call("GET", "/api/sync/pull/full/sales?limit=500", undefined, owner)).body.items as any[]).find((s) => s.id === id)
      const cloud = await inCloud(() => prisma.sale.findFirst({ where: { tenantId: A.tenantId, id }, select: { cost: true, profit: true } }))
      evidence("checkout", { tillQueue: queue().filter((o) => o.entity === "sale").map((o) => o.status), hub: onHub ? { cost: onHub.cost, profit: onHub.profit } : null, cloud: cloud ? { cost: Number((cloud as any).cost), profit: Number((cloud as any).profit) } : null })
      expect(Number(onHub.cost)).toBe(2)
      expect(cloud).toBeTruthy()
      expect(Number((cloud as any).cost)).toBe(2)
    })

    it("permissions and Refused work: a cashier-connected till's adjustment is refused on the hub, kept, reviewed and applied by the manager on the hub, then forwarded once", async () => {
      storage.setItem("lebanonpos.auth-token", await login("1504")) // Rana: no inventory.adjust
      d.adjust.recordStockAdjustment({ productId: localMilk().id, quantityChange: 3, reason: "Count Correction", note: "crate found" })
      await flush()
      const op = queue().find((o) => o.entity === "inventory" && o.action === "adjust")!
      expect(op.status).not.toBe("Synced")
      expect(String(op.error)).toMatch(/permission/i)
      const maya = await login("1502")
      const review = await call("GET", "/api/sync/refused", undefined, maya)
      const item = (review.body.operations as any[]).find((o) => o.id === op.id)
      expect(item).toMatchObject({ status: "Refused", canResolve: true })
      expect((await call("GET", "/api/sync/refused", undefined, await login("1504"))).status).toBe(403)
      // Not forwarded while refused.
      await new Promise((r) => setTimeout(r, 5000))
      expect(await prisma.stockAdjustment.findFirst({ where: { tenantId: A.tenantId, id: op.payload.id } })).toBeNull()
      const cloudStockBefore = Number((await prisma.product.findFirst({ where: { tenantId: A.tenantId, syncId: A.milkSyncId } })).stock)
      const applied = await call("POST", `/api/sync/refused/${op.id}/resolve`, { decision: "apply", note: "crate counted on the hub" }, maya)
      expect(applied.status).toBe(200)
      const cloudAdj = await inCloud(() => prisma.stockAdjustment.findFirst({ where: { tenantId: A.tenantId, id: op.payload.id } }))
      const cloudStockAfter = Number((await prisma.product.findFirst({ where: { tenantId: A.tenantId, syncId: A.milkSyncId } })).stock)
      evidence("refused work", { reason: item.reason, hubApply: applied.status, cloud: cloudAdj ? { valueImpact: Number((cloudAdj as any).valueImpact) } : null, cloudStockBefore, cloudStockAfter })
      expect(cloudAdj).toBeTruthy()
      expect(Number((cloudAdj as any).valueImpact)).toBe(3)
      expect(cloudStockAfter).toBe(cloudStockBefore + 3)
      expect(await prisma.stockAdjustment.count({ where: { tenantId: A.tenantId, id: op.payload.id } })).toBe(1)
      storage.setItem("lebanonpos.auth-token", await login("1503"))
    })

    it("customer and driver containment on the hub", async () => {
      const driver = (await call("POST", "/api/auth/login", { pin: "1505", code: A.driverCode, tenantSubdomain: A.subdomain, role: "Driver" })).body.token
      const mobile = `7${Date.now().toString().slice(-7)}`
      expect((await call("POST", "/api/delivery/customer/signup", { tenantId: A.tenantId, name: "Rami", mobile, pin: "4321" })).status).toBe(201)
      const customer = (await call("POST", "/api/delivery/customer/login", { tenantId: A.tenantId, mobile, pin: "4321" })).body.token
      const otherStore = await call("POST", "/api/delivery/customer/signup", { tenantId: store.B.tenantId, name: "Mallory", mobile: `7${Date.now().toString().slice(-6)}9`, pin: "4321" })
      const probes = {
        driverPush: (await call("POST", "/api/sync/push", { deviceId: "d", operations: [] }, driver)).status,
        driverPull: (await call("GET", "/api/sync/pull", undefined, driver)).status,
        driverStatus: (await call("GET", "/api/sync/status", undefined, driver)).status,
        driverSetup: (await call("GET", "/api/setup/tenant-info", undefined, driver)).status,
        customerPull: (await call("GET", "/api/sync/pull", undefined, customer)).status,
        customerSetup: (await call("GET", "/api/setup/tenant-info", undefined, customer)).status,
        customerCloudPull: (await call("POST", "/api/setup/pull-from-cloud", {}, customer)).status,
        customerRefused: (await call("GET", "/api/sync/refused", undefined, customer)).status,
        driverOrders: (await call("GET", "/api/delivery/driver/orders", undefined, driver)).status,
        customerOrders: (await call("GET", "/api/delivery/customer/orders", undefined, customer)).status,
        otherStoreSignupOnThisHub: otherStore.status,
      }
      evidence("containment", probes)
      expect(probes).toMatchObject({ driverPush: 403, driverPull: 403, driverStatus: 403, driverSetup: 403, customerPull: 401, customerSetup: 403, customerCloudPull: 403, driverOrders: 200, customerOrders: 200 })
      expect([401, 403]).toContain(probes.customerRefused)
      expect(probes.otherStoreSignupOnThisHub).not.toBe(201)
      expect((jwt.decode(customer) as any)?.tenantId ?? A.tenantId).toBe(A.tenantId)
    })
  })
}
