import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import { appendFileSync, existsSync } from "node:fs"
import { pathToFileURL } from "node:url"
import jwt from "jsonwebtoken"

// LEGACY-TILL ACCEPTANCE (docs/LEGACY-TILL-COMPAT.md; the RELEASED till source + this API + real
// Postgres). The same suite runs against the exact source of a released till (a git checkout at the
// release commit, read-only) and against this repository's till. It proves, with that till's own
// services:
//  - offline login: incremental and full pulls, a full pull that fails part-way, PIN reset,
//    deactivation, restart; the server never sends a PIN verifier to a staff token;
//  - cost-hidden operations: checkout, receiving, adjustments, counts, refunds and manager review of
//    refused work are valued from the SERVER's cost, whatever cost the till sends.
// Each release's checkout is named by an environment variable; without it the suite is skipped.

export type TillUnderTest = {
  label: string
  /** apps/desktop/src of the till under test. */
  srcRoot: string | undefined
  /** The release commit the checkout must be at (null: this repository's own till). */
  commit: string | null
  /** This till keeps its own offline verifier through a full pull even when the server's staff
   *  record has no pin at all (only this repository's till since the SPRINT-0 change). */
  survivesMissingPin: boolean
  /** This till keeps its own offline verifier when a full pull fails part-way. 1.0.50/1.0.51 do
   *  not, against ANY server (their restore step runs only after every entity was pulled). */
  survivesPartialPull: boolean
  /** On a PIN two people share (server: 409 AMBIGUOUS_PIN), this till falls back to its local
   *  verifiers and signs in whoever it cached (1.0.50/1.0.51: they do not know 409). */
  sharedPinFallsBackLocally: boolean
}

process.env.JWT_SECRET = process.env.JWT_SECRET || "legacy-till-secret"

/** Evidence line: printed, and appended to LEGACY_TILL_EVIDENCE (a file) when set. */
function evidence(what: string, data: unknown) {
  const line = `EVIDENCE ${what}: ${JSON.stringify(data)}`
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

export function legacyTillSuite(till: TillUnderTest) {
  const ready = !!till.srcRoot && existsSync(`${till.srcRoot}/features/pos/services/sync.service.ts`)
  if (!ready) {
    describe.skip(`legacy till ${till.label}: set its checkout (apps/desktop/src) in the environment to run`, () => { it("skipped", () => undefined) })
    return
  }
  const root = till.srcRoot!.replace(/\\/g, "/")

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
  let failEntity = ""   // an older server refusing one entity of the full pull
  let stripPins = false // negative control: a server that omits the staff pin field entirely
  let deployedShape = false // control: what the deployed server sends a staff token (a real bcrypt verifier)
  const inflight = new Set<Promise<unknown>>()
  const realFetch = globalThis.fetch
  g.fetch = ((url: string, init?: RequestInit) => {
    if (offline) return Promise.reject(new TypeError("Failed to fetch (offline)"))
    if (failEntity && String(url).includes(`/pull/full/${failEntity}`)) return Promise.resolve(new Response(JSON.stringify({ error: "Unknown entity" }), { status: 400 }))
    const p = (async () => {
      const res = await realFetch(url, init)
      if (!(stripPins || deployedShape) || !String(url).includes("/api/sync/pull")) return res
      const body = await res.json() as any
      const bcryptShaped = "$2a$12$" + "x".repeat(53)
      const strip = (rows: any[]) => rows?.map(({ pin: _p, ...rest }: any) => stripPins ? rest : { ...rest, pin: bcryptShaped })
      if (Array.isArray(body.users)) body.users = strip(body.users)
      if (String(url).includes("/pull/full/users") && Array.isArray(body.items)) body.items = strip(body.items)
      return new Response(JSON.stringify(body), { status: res.status, headers: { "Content-Type": "application/json" } })
    })()
    inflight.add(p); void p.catch(() => undefined).finally(() => inflight.delete(p)); return p
  }) as typeof fetch
  async function dispose() {
    for (const id of deviceTimers) clearTimeout(id)
    deviceTimers.clear()
    for (let i = 0; i < 20 && (inflight.size > 0 || i < 3); i++) { await Promise.allSettled([...inflight]); await new Promise((r) => setImmediate(r)) }
  }

  const mod = (name: string) => import(/* @vite-ignore */ pathToFileURL(`${root}/features/pos/services/${name}.ts`).href)
  const device = async () => ({
    sync: await mod("sync.service"), security: await mod("security.service"), sales: await mod("sales.service"),
    batches: await mod("inventoryBatch.service"), adjust: await mod("inventoryAdjustment.service"), counts: await mod("stockCount.service"),
  })
  type Device = Awaited<ReturnType<typeof device>>
  let d: Device
  async function restart() { await dispose(); vi.resetModules(); d = await device() }
  const unlock = async (pin: string) => { const u = await d.security.unlockWithPin(pin); await dispose(); return u as { id: string } | null }
  const unlockOffline = async (pin: string) => {
    storage.removeItem("lebanonpos.pin-attempts.v1")
    offline = true
    try { return (await d.security.unlockWithPin(pin)) as { id: string } | null } finally { offline = false; storage.removeItem("lebanonpos.pin-attempts.v1") }
  }
  const pull = async (full: boolean) => { await d.sync.pullFromServer(full); await dispose() }
  const flush = async () => {
    for (let i = 0; i < 3; i++) {
      const q = queue()
      storage.setItem("lebanonpos.sync-queue.v1", JSON.stringify(q.map((op) => ({ ...op, status: op.status === "Failed" ? "Pending" : op.status, lastAttemptAt: "2000-01-01T00:00:00.000Z" }))))
      await d.sync.flushSyncQueue()
    }
    await dispose()
  }
  const queue = () => JSON.parse(storage.getItem("lebanonpos.sync-queue.v1") ?? "[]") as Array<Record<string, any>>
  const cachedUsers = () => JSON.parse(storage.getItem("lebanonpos.users.v1") ?? "[]") as Array<Record<string, unknown>>
  const localProducts = () => JSON.parse(storage.getItem("lebanonpos.products.v1") ?? "[]") as Array<Record<string, any>>
  const localMilk = () => localProducts().find((p) => p.syncId === MILK_SYNC)!
  /** A stale or tampered cost in the till's cache: whatever it is, the server must not take it. */
  const forgeLocalCost = (cost: number) => storage.setItem("lebanonpos.products.v1", JSON.stringify(localProducts().map((p) => p.syncId === MILK_SYNC ? { ...p, cost } : p)))

  let prisma: typeof import("../../src/lib/prisma.js").default
  let bcrypt: typeof import("bcryptjs").default
  let server: http.Server
  let baseUrl = ""
  const T = randomUUID(), SUB = `lt-${T.slice(0, 8)}`
  const OWNER = randomUUID(), RANA = randomUUID(), SAMI = randomUUID(), OLDPIN = randomUUID(), CLERK = randomUUID(), MGR = randomUUID()
  const MILK_SYNC = randomUUID()
  const MILK_COST = 1, FORGED = 999
  const serverMilk = () => prisma.product.findFirst({ where: { tenantId: T, syncId: MILK_SYNC } })
  const loginToken = async (pin: string) => (await (await realFetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin, tenantSubdomain: SUB }) })).json() as any).token as string

  beforeAll(async () => {
    vi.setConfig({ testTimeout: 60_000 })
    prisma = (await import("../../src/lib/prisma.js")).default
    bcrypt = (await import("bcryptjs")).default
    const app = (await import("../../src/app.js")).default
    process.env.IS_LOCAL_SERVER = "false" // pinned: a module reset re-runs dotenv
    server = http.createServer(app)
    await new Promise<void>((r) => server.listen(0, r))
    baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`
    await prisma.tenant.create({ data: { id: T, name: `Legacy till ${till.label} IT (disposable)`, subdomain: SUB } })
    const staff = (id: string, name: string, pin: string, role: string, permissions?: string[]) =>
      prisma.staffUser.create({ data: { id, tenantId: T, name, mobile: `lt-${id.slice(0, 8)}`, pin, role, ...(permissions ? { permissions } : {}) } as any })
    await staff(OWNER, "Owner", await bcrypt.hash("5101", 12), "Admin")
    await staff(RANA, "Rana", await bcrypt.hash("5102", 12), "Cashier")
    await staff(SAMI, "Sami", await bcrypt.hash("5103", 12), "Cashier")
    // A legacy SHA-256 verifier on the server (base64 of sha256("5104")), as older stores still hold.
    const { createHash } = await import("node:crypto")
    await staff(OLDPIN, "Old-pin Omar", createHash("sha256").update("5104").digest("base64"), "Cashier")
    // The till's connection account: may sell, refund, receive and adjust, but cannot see cost.
    await staff(CLERK, "Clerk Carla", await bcrypt.hash("5105", 12), "Cashier", ["sales.checkout", "sales.refund", "inventory.view", "inventory.receive", "inventory.adjust"])
    await staff(MGR, "Manager Maya", await bcrypt.hash("5106", 12), "Manager")
    const milk = await prisma.product.create({ data: { tenantId: T, syncId: MILK_SYNC, name: "Milk 1L", price: 1.5, cost: MILK_COST, stock: 10, category: "Dairy", barcode: `lt-${T.slice(0, 6)}` } })
    await prisma.inventoryBatch.create({ data: { id: `lot-${T}`, tenantId: T, batchNumber: "LOT-1", productId: milk.id, productName: "Milk 1L", barcode: milk.barcode ?? "", initialQuantity: 10, quantityRemaining: 10, unitCost: MILK_COST, unitPrice: 1.5 } as any })
    storage.setItem("lebanonpos.api-url", baseUrl)
    storage.setItem("lebanonpos.store-subdomain.v1", SUB)
    storage.setItem("lebanonpos.tenant-id.v1", T)
    storage.setItem("lebanonpos.auth-token", await loginToken("5105")) // connected with the clerk's PIN (real login)
    storage.setItem("lebanonpos.users.v1", "[]")
    d = await device()
  })
  afterAll(async () => {
    await dispose()
    // Everything this disposable store holds, children first; a model a release does not have is skipped.
    for (const m of ["auditEvent", "operationEvidence", "syncOperation", "syncClient", "stockMovement", "stockAdjustment", "stockCountLine", "stockCountSession", "saleRefund", "debtPayment", "debtSale", "saleItem", "salePayment", "sale", "cashMovement", "shift", "staffSession", "device", "inventoryBatch", "product", "staffUser"])
      await (prisma as any)[m]?.deleteMany({ where: { tenantId: T } }).catch((e: Error) => console.warn(`cleanup ${m}: ${e.message.split("\n").pop()}`))
    await prisma.tenant.deleteMany({ where: { id: T } })
    await new Promise<void>((r) => server.close(() => r()))
  })

  describe(`till ${till.label}`, () => {
    it("runs the exact release source", () => {
      if (!till.commit) return
      const repo = root.replace(/\/apps\/desktop\/src$/, "")
      const head = execFileSync("git", ["-c", `safe.directory=${repo}`, "-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
      const dirty = execFileSync("git", ["-c", `safe.directory=${repo}`, "-C", repo, "status", "--porcelain", "--", "apps/desktop/src"], { encoding: "utf8" }).trim()
      evidence(`${till.label} source`, { repo, head, desktopSrcClean: dirty === "" })
      expect(head).toBe(till.commit)
      expect(dirty).toBe("")
    })
  })

  describe(`offline login on till ${till.label} (connection account cannot see cost; no verifier is ever sent)`, () => {
    it("a full pull: staff records carry the withheld placeholder, never a verifier; products carry no cost", async () => {
      await pull(true)
      const users = cachedUsers()
      expect(users.map((u) => u.name).sort()).toEqual(["Clerk Carla", "Manager Maya", "Old-pin Omar", "Owner", "Rana", "Sami"])
      const pins = [...new Set(users.map((u) => u.pin))]
      evidence(`${till.label} pins after first full pull`, pins)
      expect(pins).toEqual(["$2-withheld"])
      expect(localMilk().cost).toBeUndefined()
    })

    it("Rana signs in online once; offline she unlocks, also after an incremental and after a full pull", async () => {
      expect((await unlock("5102"))?.id).toBe(RANA)
      expect((await unlockOffline("5102"))?.id).toBe(RANA)
      await pull(false)
      expect((await unlockOffline("5102"))?.id).toBe(RANA)
      await pull(true)
      expect((await unlockOffline("5102"))?.id).toBe(RANA)
    })

    it(`a full pull that fails part-way ${till.survivesPartialPull ? "keeps" : "LOSES (pre-existing defect of this till, same against the deployed server)"} the offline verifier`, async () => {
      const partial = async (shape: boolean) => {
        expect((await unlock("5102"))?.id).toBe(RANA)
        failEntity = "cash-movements"; deployedShape = shape
        try { await pull(true) } finally { failEntity = ""; deployedShape = false }
        return (await unlockOffline("5102"))?.id === RANA
      }
      const here = await partial(false), deployed = await partial(true)
      evidence(`${till.label} offline unlock after a partial full pull`, { thisServer: here, deployedServerShape: deployed })
      expect(here).toBe(till.survivesPartialPull)
      expect(deployed).toBe(here) // the placeholder changes nothing here
      // Recovery on any till: one online sign-in writes the verifier again.
      expect((await unlock("5102"))?.id).toBe(RANA)
      expect((await unlockOffline("5102"))?.id).toBe(RANA)
    })

    it("restart (modules reloaded, storage kept): offline unlock still works", async () => {
      await restart()
      expect((await unlockOffline("5102"))?.id).toBe(RANA)
      await pull(true)
      expect((await unlockOffline("5102"))?.id).toBe(RANA)
    })

    it("never signed in on this till: no offline login (Sami, bcrypt on the server)", async () => {
      expect(await unlockOffline("5103")).toBeNull()
    })

    it("KNOWN REGRESSION vs the deployed server: a staff member whose SERVER verifier is legacy SHA-256 and who never signed in on this till cannot unlock offline", async () => {
      // The deployed (containment) server sends this SHA-256 hash, which these tills match offline
      // directly: it IS the PIN for anyone who reads the sync response. This server does not.
      expect(await unlockOffline("5104")).toBeNull()
      expect((await unlock("5104"))?.id).toBe(OLDPIN) // one online sign-in restores it
      expect((await unlockOffline("5104"))?.id).toBe(OLDPIN)
    })

    it(`negative control: a server that omits the pin field ${till.survivesMissingPin ? "does not" : "DOES"} break this till's offline login after a full pull`, async () => {
      stripPins = true
      try { await pull(true) } finally { stripPins = false }
      const after = await unlockOffline("5102")
      evidence(`${till.label} offline unlock after a pin-less full pull`, { unlocked: after?.id === RANA })
      if (till.survivesMissingPin) expect(after?.id).toBe(RANA)
      else expect(after).toBeNull()
      expect((await unlock("5102"))?.id).toBe(RANA) // recover for the next tests
    })

    it("PIN reset by the owner: after the next full pull the old PIN no longer works offline; the new one does after one online sign-in", async () => {
      await prisma.staffUser.update({ where: { id: RANA }, data: { pin: await bcrypt.hash("5202", 12), pinVersion: { increment: 1 }, tokenVersion: { increment: 1 } } })
      await pull(true)
      expect(await unlockOffline("5102")).toBeNull()
      expect((await unlock("5202"))?.id).toBe(RANA)
      expect((await unlockOffline("5202"))?.id).toBe(RANA)
    })

    it("PIN reset, incremental pull only: the old PIN no longer works offline", async () => {
      await prisma.staffUser.update({ where: { id: RANA }, data: { pin: await bcrypt.hash("5302", 12), pinVersion: { increment: 1 }, tokenVersion: { increment: 1 }, updatedAt: new Date() } as any })
      await pull(false)
      expect(await unlockOffline("5202")).toBeNull()
      expect((await unlock("5302"))?.id).toBe(RANA)
    })

    it("deactivated by the owner: after the next pull, no offline login", async () => {
      await prisma.staffUser.update({ where: { id: RANA }, data: { active: false, roleVersion: { increment: 1 }, tokenVersion: { increment: 1 }, updatedAt: new Date() } as any })
      await pull(false)
      expect(await unlockOffline("5302")).toBeNull()
      await pull(true)
      expect(await unlockOffline("5302")).toBeNull()
    })

    it("the placeholder can never be written back as a PIN", async () => {
      const token = storage.getItem("lebanonpos.auth-token")!
      const push = async (operations: unknown[]) => realFetch(`${baseUrl}/api/sync/push`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await loginToken("5101")}` }, body: JSON.stringify({ deviceId: "lt-owner", operations }) })
      const before = (await prisma.staffUser.findUnique({ where: { id: SAMI } }))!
      const created = randomUUID()
      const r = await (await push([
        { id: randomUUID(), entity: "staff", action: "create", payload: { id: created, name: "Nadia", role: "Cashier", pin: "$2-withheld", active: true } },
        { id: randomUUID(), entity: "staff", action: "update", payload: { ...before, pin: "$2-withheld", name: "Sami" } },
      ])).json() as any
      expect(r.results[0].status).toBe("error")
      expect(await prisma.staffUser.findUnique({ where: { id: created } })).toBeNull()
      expect((await prisma.staffUser.findUnique({ where: { id: SAMI } }))!.pin).toBe(before.pin)
      expect(token).toBeTruthy()
    })
  })

  describe(`cost-hidden operations on till ${till.label}: the server values every movement from its own cost`, () => {
    beforeAll(async () => {
      await unlock("5105") // the clerk works the till
      await pull(true)
      d.security.openShift(50)
      await flush()
    })

    it("checkout: the till has no cost; the server's sale is costed from its own cost and lot", async () => {
      const stockBefore = Number((await serverMilk())!.stock)
      const milk = localMilk()
      expect(milk.cost).toBeUndefined()
      const dry = d.batches.consumeInventoryBatches([{ productId: milk.id, productName: milk.name, barcode: milk.barcode ?? "", quantity: 2, fallbackUnitCost: milk.cost }], { dryRun: true })
      const id = randomUUID()
      const sale = d.sales.buildSale({
        saleNumber: `S-LT-${id.slice(0, 6)}`, paymentMethod: "Cash", subtotal: 3, tax: 0, total: 3,
        items: [{ id: milk.id, productSyncId: milk.syncId, name: milk.name, barcode: milk.barcode ?? "", cost: milk.cost, quantity: 2, unitPrice: 1.5, total: 3, batchAllocations: dry.get(milk.id) ?? [] }],
      } as any, id)
      expect(d.sales.checkoutLocalSale({ sale, lots: [{ productId: milk.id, productName: milk.name, barcode: milk.barcode ?? "", quantity: 2, fallbackUnitCost: milk.cost }], stock: [{ productId: milk.id, quantity: 2 }] }).status).toBe("completed")
      await flush()
      const row = await prisma.sale.findFirst({ where: { tenantId: T, id }, include: { items: true } as any }) as any
      evidence(`${till.label} cost-hidden sale`, { queue: queue().filter((o) => o.entity === "sale").map((o) => o.status), cost: row?.cost, profit: row?.profit, itemCost: row?.items?.[0]?.cost })
      expect(Number(row.cost)).toBe(2 * MILK_COST)
      expect(Number(row.profit)).toBe(3 - 2 * MILK_COST)
      expect(Number(row.items[0].cost)).toBe(MILK_COST)
      expect(Number((await serverMilk())!.stock)).toBe(stockBefore - 2)
    })

    it("checkout with a forged cost in the till's cache: the server still uses its own cost", async () => {
      forgeLocalCost(FORGED)
      const milk = localMilk()
      const id = randomUUID()
      const sale = d.sales.buildSale({
        saleNumber: `S-LT-${id.slice(0, 6)}`, paymentMethod: "Cash", subtotal: 1.5, tax: 0, total: 1.5,
        items: [{ id: milk.id, productSyncId: milk.syncId, name: milk.name, barcode: milk.barcode ?? "", cost: milk.cost, quantity: 1, unitPrice: 1.5, total: 1.5, batchAllocations: [] }],
      } as any, id)
      expect(d.sales.checkoutLocalSale({ sale, lots: [{ productId: milk.id, productName: milk.name, barcode: milk.barcode ?? "", quantity: 1, fallbackUnitCost: milk.cost }], stock: [{ productId: milk.id, quantity: 1 }] }).status).toBe("completed")
      await flush()
      const row = await prisma.sale.findFirst({ where: { tenantId: T, id }, include: { items: true } as any }) as any
      expect(Number(row.items[0].cost)).toBe(MILK_COST)
      expect(Number(row.cost)).toBe(MILK_COST)
      expect(Number(row.profit)).toBe(0.5)
      // What this server keeps and would forward (a hub to its cloud) carries the server's valuation, never the till's.
      const kept = (await prisma.syncOperation.findUnique({ where: { id: queue().find((o) => o.entity === "sale" && o.payload?.id === id)!.id } }))!.payload as any
      evidence(`${till.label} kept (forwardable) sale`, { lineCost: kept.items[0].cost, cost: kept.cost, profit: kept.profit })
      expect(kept.items[0].cost).toBe(MILK_COST)
      expect(kept.cost).toBe(MILK_COST)
      expect(kept.profit).toBe(0.5)
    })

    it("refund: applied on the server; the refund is valued from the sale the server recorded", async () => {
      const stockBefore = Number((await serverMilk())!.stock)
      const sale = (d.sales.getSales() as any[]).find((s) => Number(s.total) === 3)!
      const line = sale.items[0]
      const key = d.sales.refundLineKeyOf ? d.sales.refundLineKeyOf(line) : (line.lineId ?? String(line.id))
      d.sales.processRefund({ saleId: sale.id, quantities: { [key]: 1 }, reason: "spilled" })
      await flush()
      const refund = await prisma.saleRefund.findFirst({ where: { tenantId: T, saleId: sale.id } }) as any
      evidence(`${till.label} cost-hidden refund`, { queue: queue().filter((o) => o.entity === "refund").map((o) => [o.status, o.error ?? null]), refund: refund ? { amount: refund.amount ?? refund.total, items: refund.items } : null })
      expect(refund).toBeTruthy()
      expect(Number((await serverMilk())!.stock)).toBe(stockBefore + 1)
    })

    it("receiving: the purchase price the receiver enters is the lot cost; with none entered, the server's cost", async () => {
      const stockBefore = Number((await serverMilk())!.stock)
      const milk = localMilk()
      const priced = `lot-recv-${randomUUID()}`
      const unpriced = `lot-recv-${randomUUID()}`
      // the delivery's invoice price, typed by a receiver who cannot see cost
      d.batches.receiveInventoryBatches([{ id: priced, productId: milk.id, productSyncId: milk.syncId, productName: milk.name, barcode: milk.barcode ?? "", quantity: 6, unitCost: 1.25, unitPrice: 1.5 }])
      d.batches.receiveInventoryBatches([{ id: unpriced, productId: milk.id, productSyncId: milk.syncId, productName: milk.name, barcode: milk.barcode ?? "", quantity: 2, unitCost: undefined as unknown as number, unitPrice: 1.5 }])
      await flush()
      const lot = await prisma.inventoryBatch.findFirst({ where: { tenantId: T, id: priced } })
      const lot2 = await prisma.inventoryBatch.findFirst({ where: { tenantId: T, id: unpriced } })
      evidence(`${till.label} cost-hidden receive`, { queue: queue().filter((o) => o.entity === "inventory" && o.action === "receive").map((o) => [o.status, o.error ?? null]), lotUnitCost: lot?.unitCost ?? null, unpricedLotUnitCost: lot2?.unitCost ?? null })
      expect(Number(lot!.unitCost)).toBe(1.25)
      expect(Number(lot2!.unitCost)).toBe(MILK_COST)
      expect(Number((await serverMilk())!.stock)).toBe(stockBefore + 8)
    })

    it("adjustment: valueImpact comes from the server's cost, whatever the till computed", async () => {
      const stockBefore = Number((await serverMilk())!.stock)
      forgeLocalCost(FORGED)
      const milk = localMilk()
      d.adjust.recordStockAdjustment({ productId: milk.id, quantityChange: -2, reason: "Damaged", note: "broken" })
      await flush()
      const adj = await prisma.stockAdjustment.findFirst({ where: { tenantId: T, quantityChange: -2 } as any }) as any
      const sent = queue().find((o) => o.entity === "inventory" && o.action === "adjust")
      evidence(`${till.label} cost-hidden adjustment`, { sentValueImpact: sent?.payload?.valueImpact ?? null, status: sent?.status, stored: adj?.valueImpact ?? null })
      expect(Number(adj.valueImpact)).toBe(-2 * MILK_COST)
      expect(Number((await serverMilk())!.stock)).toBe(stockBefore - 2)
    })

    it("stock count: line and total value impact come from the server's cost", async () => {
      forgeLocalCost(FORGED)
      const session = d.counts.startStockCount()
      const line = (session.lines as any[]).find((l) => l.productId === localMilk().id)
      d.counts.updateStockCountLine(session.id, line.productId ?? line.id, Number(line.expectedQuantity) + 1)
      d.counts.completeStockCount(session.id)
      await flush()
      const row = await prisma.stockCountSession.findFirst({ where: { tenantId: T, id: session.id }, include: { lines: true } as any }) as any
      const counted = row?.lines?.find((l: any) => Number(l.variance) !== 0)
      evidence(`${till.label} cost-hidden count`, { queue: queue().filter((o) => o.action === "count").map((o) => [o.status, o.error ?? null]), total: row?.totalValueImpact ?? null, line: counted ? { variance: counted.variance, valueImpact: counted.valueImpact } : null })
      expect(row).toBeTruthy()
      expect(Number(counted.valueImpact)).toBe(Number(counted.variance) * MILK_COST)
      expect(Number(row.totalValueImpact)).toBe(Number(counted.variance) * MILK_COST)
    })

    it("manager review: refused work applied by a manager is valued at the server's cost, not the till's", async () => {
      await prisma.staffUser.update({ where: { id: CLERK }, data: { permissions: ["sales.checkout", "sales.refund", "inventory.view", "inventory.receive"] } as any })
      try {
        forgeLocalCost(FORGED)
        d.adjust.recordStockAdjustment({ productId: localMilk().id, quantityChange: 3, reason: "Count Correction", note: "found a crate" })
        await flush()
        const op = queue().find((o) => o.entity === "inventory" && o.action === "adjust" && Number(o.payload?.quantityChange) === 3)!
        expect((await prisma.syncOperation.findUnique({ where: { id: op.id } }))!.status).toBe("Refused")
        const maya = await loginToken("5106")
        const review = (await (await realFetch(`${baseUrl}/api/sync/refused`, { headers: { Authorization: `Bearer ${maya}` } })).json()) as any
        expect(review.operations.some((o: any) => o.id === op.id)).toBe(true)
        const r = await realFetch(`${baseUrl}/api/sync/refused/${op.id}/resolve`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${maya}` }, body: JSON.stringify({ decision: "apply", note: "crate counted", previewToken: review.operations.find((o: any) => o.id === op.id)?.previewToken }) })
        expect(r.status).toBe(200)
        const adj = await prisma.stockAdjustment.findFirst({ where: { tenantId: T, id: op.payload.id } }) as any
        evidence(`${till.label} reviewed adjustment`, { sentValueImpact: op.payload.valueImpact ?? null, stored: adj?.valueImpact ?? null })
        expect(Number(adj.valueImpact)).toBe(3 * MILK_COST)
      } finally {
        await prisma.staffUser.update({ where: { id: CLERK }, data: { permissions: ["sales.checkout", "sales.refund", "inventory.view", "inventory.receive", "inventory.adjust"] } as any })
      }
    })

    it("reports: the connection account gets no cost from the server; the store's own figures are server-costed", async () => {
      const clerk = storage.getItem("lebanonpos.auth-token")!
      const products = await (await realFetch(`${baseUrl}/api/products`, { headers: { Authorization: `Bearer ${clerk}` } })).json() as any
      const list = Array.isArray(products) ? products : products.products ?? products.items ?? []
      expect(list.length).toBeGreaterThan(0)
      expect(list.every((p: any) => !("cost" in p))).toBe(true)
      const full = await (await realFetch(`${baseUrl}/api/sync/pull/full/products`, { headers: { Authorization: `Bearer ${clerk}`, "x-titan-sync-schema": "2" } })).json() as any
      expect(full.items.every((p: any) => !("cost" in p))).toBe(true)
      const maya = await loginToken("5106")
      const kpi = await realFetch(`${baseUrl}/api/dashboard/kpi`, { headers: { Authorization: `Bearer ${maya}` } })
      const sales = await prisma.sale.findMany({ where: { tenantId: T }, select: { cost: true, profit: true } })
      evidence(`${till.label} server-side figures`, { kpiStatus: kpi.status, sales: sales.map((s) => ({ cost: Number(s.cost), profit: Number(s.profit) })) })
      expect(sales.every((s) => Number(s.cost) > 0 && Number(s.cost) < FORGED)).toBe(true)
    })
  })

  describe(`shared PIN on till ${till.label} (server answers 409 AMBIGUOUS_PIN)`, () => {
    const HADI = randomUUID(), LINA = randomUUID()
    beforeAll(async () => {
      // Two people with one PIN (possible only in data from before uniqueness was enforced).
      for (const [id, name, role] of [[HADI, "Hadi (manager)", "Manager"], [LINA, "Lina", "Cashier"]] as const)
        await prisma.staffUser.create({ data: { id, tenantId: T, name, mobile: `lt-${id.slice(0, 8)}`, pin: await bcrypt.hash("5199", 12), role } as any })
      await pull(true)
    })

    it("the server refuses the shared PIN online", async () => {
      const r = await realFetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: "5199", tenantSubdomain: SUB }) })
      expect(r.status).toBe(409)
    })

    it("neither has unlocked on this till: no one is signed in", async () => {
      storage.removeItem("lebanonpos.pin-attempts.v1")
      expect(await unlock("5199")).toBeNull()
    })

    it(`the manager unlocked here before (a pre-uniqueness server resolved it to him): ${till.sharedPinFallsBackLocally ? "KNOWN RISK, this till signs in the MANAGER" : "this till refuses"}; the sync connection stays the clerk's`, async () => {
      const h = await d.security.hashPin("5199")
      storage.setItem("lebanonpos.users.v1", JSON.stringify(cachedUsers().map((u) => u.id === HADI ? { ...u, pin: h, lastVerifiedPinVersion: (u.pinVersion as number) ?? 1 } : u)))
      storage.removeItem("lebanonpos.pin-attempts.v1")
      const who = await unlock("5199")
      const tokenUser = (jwt.decode(storage.getItem("lebanonpos.auth-token")!) as any).userId
      evidence(`${till.label} shared PIN with a cached manager verifier`, { unlocked: (who as any)?.name ?? null, syncConnection: tokenUser === CLERK ? "clerk" : tokenUser })
      expect(who?.id ?? null).toBe(till.sharedPinFallsBackLocally ? HADI : null)
      expect(tokenUser).toBe(CLERK)
    })
  })
}
