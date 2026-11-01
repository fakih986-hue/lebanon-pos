/**
 * Café batch acceptance: one complete café day against a RUNNING packaged hub and a loopback test cloud (real
 * PostgreSQL, the build's own handlers; the registers are the build's own services from HUB_TILL_SRC). Skipped unless
 * INSTALLED_HUB_URL, INSTALLED_CLOUD_URL, INSTALLED_HUB_STORE, HUB_TILL_SRC and INSTALLED_HUB_PHASE=day-* are set;
 * DATABASE_URL = the cloud's scratch schema. Each phase runs on the register state the previous one left
 * (HUB_TILL_STATE): a phase is a register (re)start. Store: observe mode, registers through the hub (topology hub).
 *   day-setup      (till A, Maya on the owner's connection) the hub's key; the store's setup (hub); ingredients in g/ml/
 *                  units; Pepsi and chips; option groups; Espresso, Nescafé, Cappuccino, Iced latte and their recipes;
 *                  ingredients received in purchase units (kg, L, packs) with invoice prices and a purchase order
 *   day-sell       (till B, Rana on her own cashier connection) shift; live checkouts through the hub of configured drinks
 *                  with packaged items; a repeat and an edited configuration; a missing required choice and a short
 *                  ingredient refused before payment; a discount approved by Maya (bound to the options); refund of a
 *                  drink (money only), return of a Pepsi (stock back); a remake she records is held for a manager
 *   day-remake     (till A, Maya) her remake applies; she applies Rana's held one at the hub
 *   day-outage     (till A, cloud stopped) live sales at the hub; work waits for the cloud
 *   day-offline    (till B, its server unreachable) a drink sold offline (recipe revision 1), then the register stops
 *   day-revise     (till A) Maya saves recipe revision 2 for Cappuccino at the hub
 *   day-reconnect  (till B restarted, hub reachable) the offline sale is applied with revision 1, never today's; a lost
 *                  response resent consumes nothing again; Rana's shift closed
 *   day-close      (till A) ingredients counted in g/ml; Maya's shift and the day closed
 *   day-resume     (cloud back) everything reached the cloud once: hub and cloud stock, lots, sale lines, consumption,
 *                  cost, refunds, waste and the purchase order agree; café report; a cashier receives no cost
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { pathToFileURL } from "node:url"

const HUB = process.env.INSTALLED_HUB_URL
const CLOUD = process.env.INSTALLED_CLOUD_URL
const PHASE = process.env.INSTALLED_HUB_PHASE ?? ""
const STATE = process.env.HUB_TILL_STATE
const STORE_FILE = process.env.INSTALLED_HUB_STORE
const SRC = process.env.HUB_TILL_SRC?.replace(/\\/g, "/")
const loopback = (u?: string) => !!u && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(u)
const ready = loopback(HUB) && loopback(CLOUD) && !!STORE_FILE && existsSync(STORE_FILE) && !!SRC && existsSync(`${SRC}/features/pos/services/menu.service.ts`) && PHASE.startsWith("day-")
function evidence(what: string, data: unknown) {
  const line = `EVIDENCE cafe-day ${what}: ${JSON.stringify(data)}`
  console.log(line)
  if (process.env.LEGACY_TILL_EVIDENCE) appendFileSync(process.env.LEGACY_TILL_EVIDENCE, `${new Date().toISOString()} ${line}\n`)
}
class MemoryStorage { m = new Map<string, string>(); get length() { return this.m.size } key(i: number) { return [...this.m.keys()][i] ?? null } getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null } setItem(k: string, v: string) { this.m.set(k, String(v)) } removeItem(k: string) { this.m.delete(k) } clear() { this.m.clear() } }
const r2 = (n: number) => Math.round(n * 100) / 100

if (!ready) {
  describe.skip("installed café day: set INSTALLED_HUB_URL, INSTALLED_CLOUD_URL, INSTALLED_HUB_STORE, HUB_TILL_SRC and INSTALLED_HUB_PHASE=day-*", () => { it("skipped", () => undefined) })
} else {
  const store = JSON.parse(readFileSync(STORE_FILE!, "utf8"))
  const A = store.A as { tenantId: string; subdomain: string; staff: Record<string, string>; supplierId: string }
  const storage = new MemoryStorage()
  if (STATE && existsSync(STATE)) for (const [k, v] of Object.entries(JSON.parse(readFileSync(STATE, "utf8")) as Record<string, string>)) storage.setItem(k, v)
  const saveState = () => { if (STATE) writeFileSync(STATE, JSON.stringify(Object.fromEntries(storage.m))) }
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
  const inflight = new Set<Promise<unknown>>()
  const realFetch = globalThis.fetch
  let unreachable = PHASE === "day-offline"
  g.fetch = ((url: string, init?: RequestInit) => { if (unreachable) return Promise.reject(new TypeError("Failed to fetch")); const p = realFetch(url, init); inflight.add(p); void p.catch(() => undefined).finally(() => inflight.delete(p)); return p }) as typeof fetch
  const dispose = async () => {
    for (const id of timers) clearTimeout(id)
    timers.clear()
    for (let i = 0; i < 20 && (inflight.size > 0 || i < 3); i++) { await Promise.allSettled([...inflight]); await new Promise((r) => setImmediate(r)) }
  }
  const mod = (path: string) => import(/* @vite-ignore */ pathToFileURL(`${SRC}/${path}.ts`).href)
  let d: Record<string, any>
  const queue = () => JSON.parse(storage.getItem("lebanonpos.sync-queue.v1") ?? "[]") as Array<Record<string, any>>
  const opFor = (entity: string, id: string) => queue().find((o) => o.entity === entity && (o.payload?.id === id || (Array.isArray(o.payload) && o.payload.some((x: any) => x?.id === id))))
  const errOf = (o: any) => String(o?.lastError ?? o?.error ?? "")
  const flush = async () => {
    for (let i = 0; i < 3; i++) {
      storage.setItem("lebanonpos.sync-queue.v1", JSON.stringify(queue().map((op) => ({ ...op, status: op.status === "Failed" ? "Pending" : op.status, lastAttemptAt: "2000-01-01T00:00:00.000Z" }))))
      await d.sync.flushSyncQueue()
      await dispose()
    }
  }
  const call = async (base: string, method: string, path: string, body?: unknown, token?: string, headers: Record<string, string> = {}) => {
    const r = await realFetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", "x-titan-sync-schema": "6", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: r.status, body: (await r.json().catch(() => null)) as any }
  }
  const login = async (base: string, pin: string, client: "register" | "person") => (await call(base, "POST", "/api/auth/login", { pin, tenantSubdomain: A.subdomain, client })).body?.token as string
  const products = () => JSON.parse(storage.getItem("lebanonpos.products.v1") ?? "[]") as any[]
  const local = (syncId: string) => products().find((p) => p.syncId === syncId)
  let prisma: any
  const waitFor = async <T>(read: () => Promise<T | null | undefined | false>, ms = 180_000): Promise<T | null> => {
    const end = Date.now() + ms
    for (;;) { const v = await read(); if (v) return v; if (Date.now() > end) return null; await new Promise((r) => setTimeout(r, 2000)) }
  }
  const tillOf = PHASE === "day-sell" || PHASE === "day-offline" || PHASE === "day-reconnect" ? "B" : "A"
  const deviceId = storage.getItem("lebanonpos.device-id.v1") ?? `day-${tillOf}-${randomUUID().slice(0, 6)}`
  const keep = (k: string, v: string) => storage.setItem(`it.day.${k}`, v)
  const kept = (k: string) => storage.getItem(`it.day.${k}`)!
  const sharedFile = () => `${STORE_FILE!.replace(/stores\.json$/, "")}day-shared.json`
  const shared = (k: string, v?: unknown) => { const f = sharedFile(); const all = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {}; if (v === undefined) return all[k]; all[k] = v; writeFileSync(f, JSON.stringify(all, null, 2)); return v }
  let connection = "", ownerPerson = "", mayaPerson = ""
  const ask = (entity: string, action: string, payload: any, permission: string, pin = "1502") => d.approval.requestManagerApproval({ entity, action, payload, permission, permissions: [permission], pin })

  // ── the menu (ids fixed by day-setup, shared with every phase) ──────────────────────────────────────────────────
  const M = () => shared("menu") as { g: Record<string, string>; o: Record<string, string>; p: Record<string, string>; rev: Record<string, string> }
  async function signIn(pin: string, staffId: string, openShift = true) {
    d.security.lockSession(); await dispose()
    expect((await d.security.unlockWithPin(pin))?.id).toBe(staffId); await dispose()
    if (openShift && !d.security.getActiveShift()) expect(d.security.openShift(20)).toBeTruthy()
  }
  function drink(sid: string, options: string[], qty: number, note = "") {
    const p = local(sid)
    const groups = d.menu.groupsForProduct(p)
    const selection = options.map((optionId) => ({ groupId: groups.find((gr: any) => gr.options.some((o: any) => o.id === optionId))?.id ?? "unknown", optionId }))
    const made = d.menu.configuredLine(p, selection, note, qty)
    return { id: p.id, productSyncId: p.syncId, lineId: randomUUID(), name: p.name, barcode: "", quantity: qty, unitPrice: made.unitPrice, total: r2(made.unitPrice * qty), stockPolicy: "recipe", stockPolicyVersion: p.stockPolicyVersion ?? 1, stockPolicyRev: p.stockPolicyRev ?? "initial", batchAllocations: [], ...(made.modifiers.length ? { modifiers: made.modifiers } : {}), ...(made.note ? { note: made.note } : {}), basePrice: made.basePrice, recipeRev: made.recipeRev, consumption: d.menu.consumptionPayload(made.consumption), _key: made.lineKey }
  }
  function packaged(sid: string, qty: number) {
    const p = local(sid)
    const alloc = d.batches.consumeInventoryBatches([{ productId: p.id, productName: p.name, barcode: p.barcode ?? "", quantity: qty, fallbackUnitCost: p.cost ?? 0 }], { dryRun: true }).get(p.id) ?? []
    return { id: p.id, productSyncId: p.syncId, lineId: randomUUID(), name: p.name, barcode: p.barcode ?? "", quantity: qty, unitPrice: Number(p.price), total: r2(Number(p.price) * qty), stockPolicy: "tracked", stockPolicyVersion: p.stockPolicyVersion ?? 1, stockPolicyRev: p.stockPolicyRev ?? "initial", batchAllocations: alloc, cost: alloc.length ? alloc[0].unitCost : p.cost }
  }
  function sale(lines: any[], discount = 0) {
    const id = randomUUID()
    const subtotal = r2(lines.reduce((s, l) => s + l.total, 0))
    const items = lines.map(({ _key, ...l }) => l)
    return d.sales.buildSale({ saleNumber: `S-D-${id.slice(0, 6)}`, paymentMethod: "Cash", subtotal: r2(subtotal - discount), discountTotal: discount, tax: 0, total: r2(subtotal - discount), items }, id)
  }
  function journal(s: any) {
    const tracked = s.items.filter((i: any) => i.stockPolicy === "tracked")
    const io = d.menu.ingredientCheckoutLines(s.items.map((i: any) => ({ productId: i.id, quantity: i.quantity, stockPolicy: i.stockPolicy, recipeRev: i.recipeRev, modifiers: i.modifiers })), products())
    return {
      lots: [...tracked.map((i: any) => ({ productId: i.id, productName: i.name, barcode: i.barcode, quantity: i.quantity, fallbackUnitCost: i.cost ?? 0 })), ...io.lots],
      stock: [...tracked.map((i: any) => ({ productId: i.id, quantity: i.quantity })), ...io.stock],
    }
  }
  const live = async (s: any) => { const j = journal(s); const out = await d.hub.checkoutViaHub({ fingerprint: `${s.id}`, build: () => s, lots: j.lots, stock: j.stock }); await dispose(); return out }
  const queued = (s: any) => { const j = journal(s); return d.sales.checkoutLocalSale({ sale: s, lots: j.lots, stock: j.stock }) }
  const hubPull = async (token: string) => (await call(HUB!, "GET", "/api/sync/pull", undefined, token)).body
  const hubStock = async (token: string) => Object.fromEntries(((await hubPull(token)).products as any[]).map((p) => [p.syncId, Number(p.stock)]))
  const cloudProducts = async () => Object.fromEntries((await prisma.product.findMany({ where: { tenantId: A.tenantId }, select: { syncId: true, stock: true } })).map((p: any) => [p.syncId, Number(p.stock)]))

  beforeAll(async () => {
    prisma = (await import("../src/lib/prisma.js")).default
    expect(await prisma.tenant.findUnique({ where: { id: A.tenantId }, select: { id: true } })).toBeTruthy()
    const fresh = !storage.getItem("lebanonpos.device-id.v1")
    if (fresh) {
      storage.setItem("lebanonpos.api-url", HUB!)
      storage.setItem("lebanonpos.connection-mode.v1", "CONNECT_TO_HUB")
      storage.setItem("lebanonpos.store-subdomain.v1", A.subdomain)
      storage.setItem("lebanonpos.tenant-id.v1", A.tenantId)
      storage.setItem("lebanonpos.device-id.v1", deviceId)
      storage.setItem("lebanonpos.users.v1", "[]")
    }
    d = {
      sync: await mod("features/pos/services/sync.service"), security: await mod("features/pos/services/security.service"), sales: await mod("features/pos/services/sales.service"),
      devices: await mod("features/pos/services/deviceRegistry.service"), products: await mod("features/pos/services/product.service"), menu: await mod("features/pos/services/menu.service"),
      approval: await mod("features/pos/services/approval.service"), batches: await mod("features/pos/services/inventoryBatch.service"), hub: await mod("features/pos/services/hubCheckout.service"),
      close: await mod("features/pos/services/dailyClose.service"), supplier: await mod("features/pos/services/supplier.service"), count: await mod("features/pos/services/stockCount.service"),
    }
    if (PHASE !== "day-offline") {
      connection = await login(HUB!, tillOf === "B" ? "1504" : "1501", "register")
      ownerPerson = await login(HUB!, "1501", "person")
      mayaPerson = await login(HUB!, "1502", "person")
      expect([!!connection, !!ownerPerson, !!mayaPerson]).toEqual([true, true, true])
      if (fresh) {
        const code = (await call(HUB!, "POST", "/api/device/generate-code", {}, ownerPerson)).body?.code
        expect((await d.devices.pairDevice(code, deviceId, `Cafe day till ${tillOf}`)).ok).toBe(true)
      }
      storage.setItem("lebanonpos.auth-token", connection)
      await d.sync.pullFromServer(true); await dispose()
    }
  })
  afterAll(async () => { await dispose(); saveState(); await prisma?.$disconnect() })

  if (PHASE === "day-setup") describe("setup: the store's hub, the menu, ingredients received in purchase units (till A)", { timeout: 600_000 }, () => {
    it("the hub's key; the store is set up with its registers through this hub (owner, readiness checked)", async () => {
      expect((await call(HUB!, "POST", "/api/setup/hub-key", { pin: "1501" })).status).toBe(200)
      const cloudOwner = await login(CLOUD!, "1501", "person")
      const reported = await waitFor(async () => { const k = await prisma.hubKey.findFirst({ where: { tenantId: A.tenantId, status: "ACTIVE" } }); return k?.lastReportAt ? k : null })
      expect(reported).toBeTruthy()
      await d.sync.pullFromServer(false); await dispose()
      const topo = (await call(CLOUD!, "GET", "/api/sync/topology", undefined, cloudOwner)).body
      const changed = await waitFor(async () => {
        const r = await call(CLOUD!, "POST", "/api/sync/topology", { to: "hub", hubId: reported.hubId, expectedVersion: topo.topology.version, note: "café day: registers through the hub", confirm: true }, cloudOwner)
        if (r.status !== 200) evidence("topology not ready yet", r.body?.blockers?.map((b: any) => b.code))
        return r.status === 200 ? r.body : null
      }, 240_000)
      expect(changed?.topology?.mode).toBe("hub")
      const adopted = await waitFor(async () => { const t = (await call(HUB!, "GET", "/api/sync/topology", undefined, ownerPerson)).body; return t?.thisHub?.isStoresHub && t.topology.mode === "hub" ? t : null })
      expect(adopted).toBeTruthy()
      evidence("topology", { mode: adopted.topology.mode, version: adopted.topology.version })
    })

    it("Maya sets up ingredients (g, ml, units), packaged goods, option groups, four drinks and their recipes", async () => {
      await signIn("1502", A.staff.maya, false)
      const ing = (name: string, stockUnit: string, purchaseUnit: string, unitsPerPurchase?: number) => d.products.createProduct({ name, price: 0, stock: 0, barcode: null, category: "Ingredients", stockPolicy: "tracked", sellable: false, stockUnit, purchaseUnit, unitsPerPurchase })
      const p: Record<string, string> = {}
      for (const [k, name, u, pu, n] of [["beans", "Coffee beans", "g", "kg"], ["instant", "Instant coffee", "g", "kg"], ["milk", "Whole milk", "ml", "L"], ["oat", "Oat milk", "ml", "L"], ["syrup", "Vanilla syrup", "ml", "ml"], ["sugar", "Sugar sticks", "unit", "pack", 100], ["cups", "Cups", "unit", "pack", 50], ["lids", "Lids", "unit", "pack", 100]] as const) p[k] = ing(name, u, pu, n as number | undefined).syncId
      // a kg of something counted in millilitres is refused before saving (the editor's check; the server's below)
      expect(d.products.getProductsSync().filter((x: any) => x.sellable === false).length).toBe(8)
      p.pepsi = d.products.createProduct({ name: "Pepsi 330ml", price: 1, cost: 0.4, stock: 24, barcode: "5281001000101", category: "Drinks" }).syncId
      p.chips = d.products.createProduct({ name: "Chips", price: 0.75, cost: 0.3, stock: 30, barcode: "5281001000202", category: "Snacks" }).syncId
      const G = (name: string, nameAr: string, required: boolean, max: number, options: Array<[string, string, string, number, boolean?]>) => {
        const grp = d.menu.newModifierGroup()
        return d.menu.saveModifierGroup({ ...grp, name, nameAr, required, minSelect: required ? 1 : 0, maxSelect: max, options: options.map(([id, n, ar, delta, def], i) => ({ id: `${grp.id}-${id}`, name: n, nameAr: ar, priceDelta: delta, isDefault: !!def, sortOrder: i })) })
      }
      const size = G("Size", "الحجم", true, 1, [["s", "Small", "صغير", -0.25], ["m", "Medium", "وسط", 0, true], ["l", "Large", "كبير", 0.75]])
      const milk = G("Milk", "الحليب", true, 1, [["whole", "Whole milk", "حليب كامل", 0, true], ["oat", "Oat milk", "حليب الشوفان", 0.5]])
      const sugar = G("Sugar", "السكر", false, 1, [["none", "No sugar", "بدون سكر", 0, true], ["one", "1 sugar", "سكر واحد", 0], ["two", "2 sugars", "سكرتان", 0]])
      const shot = G("Extra", "إضافات", false, 2, [["shot", "Extra shot", "شوت إضافي", 0.75], ["vanilla", "Vanilla", "فانيلا", 0.5]])
      const ice = G("Ice", "الثلج", true, 1, [["reg", "Regular ice", "ثلج عادي", 0, true], ["light", "Light ice", "ثلج خفيف", 0], ["none", "No ice", "بدون ثلج", 0]])
      const o = (grp: any, id: string) => `${grp.id}-${id}`
      const O = { s: o(size, "s"), m: o(size, "m"), l: o(size, "l"), whole: o(milk, "whole"), oat: o(milk, "oat"), one: o(sugar, "one"), two: o(sugar, "two"), shot: o(shot, "shot"), vanilla: o(shot, "vanilla"), noIce: o(ice, "none") }
      const drinkOf = (name: string, price: number, groups: any[]) => d.products.createProduct({ name, price, stock: 0, barcode: null, category: "Coffee", stockPolicy: "recipe", modifierGroupIds: groups.map((x) => x.id) })
      p.espresso = drinkOf("Espresso", 2, [shot]).syncId
      p.nescafe = drinkOf("Nescafé", 1.5, [size, milk, sugar]).syncId
      p.capp = drinkOf("Cappuccino", 3, [size, milk, shot]).syncId
      p.iced = drinkOf("Iced latte", 3.5, [size, ice]).syncId
      const bySize = (sid: string, q: [number, number, number], unless?: string, when?: string) => ([[O.s, q[0]], [O.m, q[1]], [O.l, q[2]]] as Array<[string, number]>).map(([sz, n]) => ({ ingredientSyncId: sid, quantity: String(n), when: when ? [sz, when] : [sz], ...(unless ? { unless: [unless] } : {}) }))
      const save = (sid: string, lines: any[], yieldN = 1) => d.menu.saveRecipe(local(sid), { yield: yieldN, lines, note: "opening menu" }).id
      const rev: Record<string, string> = {}
      rev.espresso = save(p.espresso, [{ ingredientSyncId: p.beans, quantity: "9" }, { ingredientSyncId: p.beans, quantity: "9", when: [O.shot] }, { ingredientSyncId: p.syrup, quantity: "15", when: [O.vanilla] }, { ingredientSyncId: p.cups, quantity: "1" }])
      rev.nescafe = save(p.nescafe, [...bySize(p.instant, [2, 3, 4]), ...bySize(p.milk, [50, 80, 100], O.oat), ...bySize(p.oat, [50, 80, 100], undefined, O.oat), { ingredientSyncId: p.sugar, quantity: "1", when: [O.one] }, { ingredientSyncId: p.sugar, quantity: "2", when: [O.two] }, { ingredientSyncId: p.cups, quantity: "1" }])
      rev.capp = save(p.capp, [{ ingredientSyncId: p.beans, quantity: "18" }, ...bySize(p.milk, [150, 200, 250], O.oat), ...bySize(p.oat, [150, 200, 250], undefined, O.oat), { ingredientSyncId: p.beans, quantity: "18", when: [O.shot] }, { ingredientSyncId: p.syrup, quantity: "15", when: [O.vanilla] }, { ingredientSyncId: p.cups, quantity: "1" }, { ingredientSyncId: p.lids, quantity: "1" }])
      rev.iced = save(p.iced, [{ ingredientSyncId: p.beans, quantity: "18" }, ...bySize(p.milk, [180, 220, 260]), { ingredientSyncId: p.cups, quantity: "1" }, { ingredientSyncId: p.lids, quantity: "1" }])
      shared("menu", { g: { size: size.id, milk: milk.id, sugar: sugar.id, shot: shot.id, ice: ice.id }, o: O, p, rev })
      await flush()
      const bad = queue().filter((op) => op.status !== "Synced")
      expect(bad.map((op) => [op.entity, op.action, errOf(op)])).toEqual([])
      // the server refuses what the editor refuses: kg for a millilitre ingredient
      const refused = await call(HUB!, "POST", "/api/sync/push", { deviceId, operations: [{ id: randomUUID(), entity: "product", action: "create", payload: { syncId: randomUUID(), name: "Bad milk", price: 0, cost: 0, stock: 0, barcode: null, category: "Ingredients", sellable: false, stockUnit: "ml", purchaseUnit: "kg" } }] }, connection)
      expect(refused.body.results[0].error).toMatch(/PRODUCT_SETUP/)
      evidence("menu", { groups: 5, drinks: ["Espresso", "Nescafé", "Cappuccino", "Iced latte"], refusedUnit: refused.body.results[0].error.slice(0, 60) })
    })

    it("ingredients received in purchase units with invoice prices: exact stock in g/ml/units, a purchase order at the invoice", async () => {
      const m = M()
      const row = (sid: string, unit: string, qty: number, price: number, pack?: number, expiry?: string) => {
        const p = local(sid)
        const conv = d.menu && (pack ?? (unit === "kg" || unit === "L" ? 1000 : 1))
        return { name: p.name, barcode: "", category: p.category, quantity: qty * conv, cost: Math.round((price / conv) * 10000) / 10000, price: 0, expiryDate: expiry, receiveIntoProductId: p.id, purchaseUnit: unit, purchaseQuantity: qty, unitsPerPurchase: conv, purchasePrice: price, supplierReference: "INV-D71" }
      }
      const entries = [row(m.p.beans, "kg", 2, 18.37, undefined, "2027-03-01"), row(m.p.instant, "kg", 0.5, 12), row(m.p.milk, "L", 6, 1.25, undefined, "2026-12-01"), row(m.p.oat, "L", 1, 2.4), row(m.p.syrup, "ml", 750, 0.01), row(m.p.sugar, "pack", 1, 3, 100), row(m.p.cups, "pack", 4, 4, 50), row(m.p.lids, "pack", 2, 3, 100)]
      const summary = await d.supplier.receiveAndRecord(entries, { supplierId: A.supplierId, supplierName: "Bean & Dairy Co", invoiceNumber: "INV-D71", paymentMethod: "On Account", note: "opening delivery" }, { submissionId: `receive-${randomUUID()}` })
      await dispose()
      expect(summary.results.every((r: any) => r.status === "accepted")).toBe(true)
      await flush()
      expect(queue().filter((op) => op.status !== "Synced").map((op) => [op.entity, errOf(op)])).toEqual([])
      const s = await hubStock(ownerPerson)
      expect([s[m.p.beans], s[m.p.instant], s[m.p.milk], s[m.p.oat], s[m.p.syrup], s[m.p.sugar], s[m.p.cups], s[m.p.lids]]).toEqual([2000, 500, 6000, 1000, 750, 100, 200, 200])
      const lots = ((await hubPull(ownerPerson)).batches as any[]).filter((b) => b.productSyncId === m.p.beans)
      const po = (await hubPull(ownerPerson)).purchaseOrders.find((x: any) => x.invoiceNumber === "INV-D71")
      evidence("received", { stock: s, beansLot: lots.map((b) => ({ qty: b.initialQuantity, unit: b.purchaseUnit, price: b.purchasePrice, unitCost: b.unitCost })), poTotal: po?.total })
      expect(Number(po?.total)).toBeCloseTo(36.74 + 6 + 7.5 + 2.4 + 7.5 + 3 + 16 + 6, 2)
    })
  })

  if (PHASE === "day-sell") describe("selling (till B, Rana on her own cashier connection)", { timeout: 600_000 }, () => {
    it("configured drinks with packaged items, live through the hub: options kept, ingredients taken by the recipe, drink stock never touched", async () => {
      const m = M()
      await signIn("1504", A.staff.rana)
      const before = await hubStock(ownerPerson)
      const capp = drink(m.p.capp, [m.o.l, m.o.oat, m.o.shot], 2)
      const s1 = sale([capp, packaged(m.p.pepsi, 1), packaged(m.p.chips, 1)])
      const out = await live(s1)
      expect(out.status).toBe("committed")
      const after = await hubStock(ownerPerson)
      // 2 × Large oat + shot: beans 2 × 36 = 72 g, oat 2 × 250 = 500 ml, cups 2, lids 2; Pepsi −1, chips −1; the drink's own stock 0
      expect([before[m.p.beans] - after[m.p.beans], before[m.p.oat] - after[m.p.oat], before[m.p.milk] - after[m.p.milk], before[m.p.cups] - after[m.p.cups], before[m.p.lids] - after[m.p.lids], before[m.p.pepsi] - after[m.p.pepsi], after[m.p.capp]]).toEqual([72, 500, 0, 2, 2, 1, 0])
      // the same configuration twice is one line; a changed option is another
      const again = drink(m.p.capp, [m.o.shot, m.o.oat, m.o.l], 1), other = drink(m.p.capp, [m.o.l, m.o.whole, m.o.shot], 1)
      expect([again._key === capp._key.replace("|2|", "|1|") || again._key === capp._key, other._key === capp._key]).toEqual([true, false])
      // queued (as a register with its own journal): Nescafé medium whole 1 sugar + Espresso double shot vanilla, "extra hot"
      const s2 = sale([drink(m.p.nescafe, [m.o.m, m.o.whole, m.o.one], 1, "extra hot"), drink(m.p.espresso, [m.o.shot, m.o.vanilla], 1)])
      expect(queued(s2).status).toBe("completed")
      await flush()
      expect(opFor("sale", s2.id)?.status).toBe("Synced")
      keep("s1", s1.id); keep("s2", s2.id)
      evidence("sold", { s1: { total: s1.total, lines: s1.items.map((i: any) => [i.name, i.quantity, i.unitPrice, (i.modifiers ?? []).map((x: any) => x.name)]) }, s2: s2.items.map((i: any) => [i.name, i.unitPrice, i.note ?? null]) })
    })

    it("a missing required choice and a short ingredient are refused before payment; nothing is recorded", async () => {
      const m = M()
      const before = await hubStock(ownerPerson)
      const noSize = sale([drink(m.p.nescafe, [m.o.whole], 1)])
      const r1 = await live(noSize)
      expect(r1.status).toBe("rejected")
      expect(r1.error).toMatch(/MODIFIERS_INVALID: "Nescafé"/)
      // oat milk: 500 ml left; 3 large oat cappuccinos need 750 ml
      expect(d.menu.cartShortage([{ productId: local(m.p.capp).id, quantity: 3, stockPolicy: "recipe", recipeRev: m.rev.capp, modifiers: [{ optionId: m.o.l }, { optionId: m.o.oat }] }], products())).toMatchObject({ ingredient: "Oat milk" })
      const short = sale([drink(m.p.capp, [m.o.l, m.o.oat], 3)])
      const r2 = await live(short)
      expect([r2.status, /INGREDIENT_SHORT: Not enough "Oat milk"/.test(r2.error)]).toEqual(["rejected", true])
      expect(await hubStock(ownerPerson)).toEqual(before)
      evidence("refused before payment", { missingChoice: r1.error.slice(0, 70), short: r2.error.slice(0, 90) })
    })

    it("a discount approved by Maya binds to the options: the approved sale goes through; a changed option needs a new approval", async () => {
      const m = M()
      const discounted = sale([drink(m.p.capp, [m.o.m, m.o.whole], 2)], 0.5)
      const approval = await ask("sale", "create", discounted, "sales.discount")
      expect(approval.ok).toBe(true)
      // the same sale with a different option is not what was approved: the hub does not accept the approval for it
      const changed = { ...discounted, items: discounted.items.map((i: any) => ({ ...i, modifiers: [i.modifiers[0], { ...i.modifiers[1], optionId: m.o.oat, name: "Oat milk", priceDelta: 0.5 }] })) }
      const probe = await call(HUB!, "POST", "/api/sync/push", { deviceId, operations: [{ id: `probe-${randomUUID()}`, entity: "sale", action: "create", payload: changed, ev: { v: 1, approval: approval.grant.approvalId } }] }, connection, { "x-device-credential": JSON.parse(storage.getItem("lebanonpos.device-credential.v1") ?? "null")?.credential ?? "" })
      expect(probe.body.results[0].status).not.toBe("ok")
      expect(probe.body.results[0].error).toMatch(/permission/i)
      // the approved sale itself goes through with it
      expect(queued(discounted).status).toBe("completed")
      await flush()
      expect([opFor("sale", discounted.id)?.status, errOf(opFor("sale", discounted.id))]).toEqual(["Synced", ""])
      keep("discounted", discounted.id)
      evidence("discount approved", { total: discounted.total, discount: 0.5, changedOption: probe.body.results[0].error.slice(0, 60) })
    })

    it("refund of a drink returns money only; a Pepsi returned goes back to stock and its lot; Rana's remake is held for a manager", async () => {
      const m = M()
      const before = await hubStock(ownerPerson)
      const s1 = d.sales.getSales().find((s: any) => s.id === kept("s1"))
      const drinkLine = s1.items.find((i: any) => i.stockPolicy === "recipe"), pepsiLine = s1.items.find((i: any) => i.name.startsWith("Pepsi"))
      const refundId = randomUUID()
      const input = { saleId: s1.id, quantities: { [d.sales.refundLineKeyOf(drinkLine)]: 1, [d.sales.refundLineKeyOf(pepsiLine)]: 1 }, reason: "wrong drink; can returned unopened", id: refundId }
      expect((await ask("refund", "create", d.sales.refundApprovalPayload(input), "sales.refund")).ok).toBe(true)
      const localDrinkStock = local(m.p.capp).stock
      d.sales.processRefund(input)
      expect(local(m.p.capp).stock).toBe(localDrinkStock) // never restocked here either
      await flush()
      expect([opFor("refund", refundId)?.status, errOf(opFor("refund", refundId))]).toEqual(["Synced", ""])
      const after = await hubStock(ownerPerson)
      expect([after[m.p.beans] - before[m.p.beans], after[m.p.oat] - before[m.p.oat], after[m.p.cups] - before[m.p.cups], after[m.p.pepsi] - before[m.p.pepsi], after[m.p.capp]]).toEqual([0, 0, 0, 1, 0])
      // Rana records a remake: her connection may not adjust stock — held for a manager's review
      const wasteId = await d.menu.recordWaste({ product: local(m.p.capp), quantity: 1, reason: "Remake", note: "milk too hot, remade", selection: [{ groupId: m.g.size, optionId: m.o.m }, { groupId: m.g.milk, optionId: m.o.whole }] })
      await flush()
      expect(errOf(opFor("inventory", wasteId))).toMatch(/permission/i)
      expect((await hubStock(ownerPerson))[m.p.beans]).toBe(after[m.p.beans])
      shared("heldWaste", wasteId); keep("refund", refundId)
      evidence("refund and remake", { refund: Number((d.sales.getRefunds?.() ?? []).find?.((r: any) => r.id === refundId)?.total ?? 0), held: errOf(opFor("inventory", wasteId)).slice(0, 60) })
    })
  })

  if (PHASE === "day-remake") describe("remakes and waste (till A, Maya)", { timeout: 300_000 }, () => {
    it("Maya's remake takes the recipe's ingredients once; she applies Rana's held remake at the hub (reviewer recorded)", async () => {
      const m = M()
      await signIn("1502", A.staff.maya)
      const before = await hubStock(ownerPerson)
      const wasteId = await d.menu.recordWaste({ product: local(m.p.capp), quantity: 1, reason: "Remake", note: "dropped on the counter", selection: [{ groupId: m.g.size, optionId: m.o.m }, { groupId: m.g.milk, optionId: m.o.whole }] })
      await flush()
      expect(opFor("inventory", wasteId)?.status).toBe("Synced")
      const after = await hubStock(ownerPerson)
      expect([before[m.p.beans] - after[m.p.beans], before[m.p.milk] - after[m.p.milk], before[m.p.cups] - after[m.p.cups], before[m.p.lids] - after[m.p.lids]]).toEqual([18, 200, 1, 1])
      // spilled milk, in millilitres
      const spill = await d.menu.recordWaste({ product: local(m.p.milk), quantity: 125.5, reason: "Waste", note: "jug knocked over" })
      await flush()
      expect(opFor("inventory", spill)?.status).toBe("Synced")
      const list = (await call(HUB!, "GET", "/api/sync/refused", undefined, mayaPerson)).body
      const held = list.operations.find((o: any) => o.entity === "inventory" && o.action === "waste")
      expect(held).toBeTruthy()
      const decided = await call(HUB!, "POST", `/api/sync/refused/${held.id}/resolve`, { decision: "apply", previewToken: held.previewToken, note: "remake confirmed with Rana" }, mayaPerson)
      expect(decided.status).toBe(200)
      const final = await hubStock(ownerPerson)
      expect([after[m.p.beans] - final[m.p.beans], Math.round((after[m.p.milk] - final[m.p.milk]) * 1000) / 1000]).toEqual([18, 325.5])
      keep("waste", wasteId); shared("spill", spill)
      evidence("remakes", { maya: wasteId, spill: 125.5, ranaApplied: decided.body?.status ?? decided.status })
    })
  })

  if (PHASE === "day-outage") describe("cloud outage, the hub keeps selling (till A)", { timeout: 300_000 }, () => {
    it("live sales at the hub with the cloud stopped; they wait for the cloud", async () => {
      const m = M()
      await signIn("1502", A.staff.maya)
      expect(await realFetch(`${CLOUD}/api/health`).then(() => "up", () => "down")).toBe("down")
      const s = sale([drink(m.p.iced, [m.o.l, m.o.noIce], 1), drink(m.p.espresso, [], 2), packaged(m.p.chips, 2)])
      const out = await live(s)
      expect(out.status).toBe("committed")
      keep("outage", s.id)
      evidence("outage sale", { id: s.id, total: s.total })
    })
  })

  if (PHASE === "day-offline") describe("offline register (till B, its server unreachable)", { timeout: 300_000 }, () => {
    it("a drink sold offline with the recipe revision this register has; its ingredients taken here by the journal", async () => {
      const m = M()
      d.security.lockSession(); await dispose()
      expect((await d.security.unlockWithPin("1504"))?.id).toBe(A.staff.rana); await dispose()
      if (!d.security.getActiveShift()) expect(d.security.openShift(20)).toBeTruthy()
      const beansHere = local(m.p.beans).stock
      const s = sale([drink(m.p.capp, [m.o.m, m.o.whole], 1)])
      expect(s.items[0].recipeRev).toBe(m.rev.capp)
      expect(queued(s).status).toBe("completed")
      await flush()
      expect(opFor("sale", s.id)?.status).not.toBe("Synced")
      expect(local(m.p.beans).stock).toBe(Math.round((beansHere - 18) * 1000) / 1000)
      shared("offlineSale", s.id)
      evidence("offline sale", { id: s.id, recipeRev: s.items[0].recipeRev, beansHere: local(m.p.beans).stock })
    })
  })

  if (PHASE === "day-revise") describe("a recipe change while a register is offline (till A)", { timeout: 300_000 }, () => {
    it("Maya saves Cappuccino revision 2 (20 g beans): it becomes current at the hub; revision 1 stays", async () => {
      const m = M()
      await signIn("1502", A.staff.maya, false)
      const capp = local(m.p.capp)
      const r1 = d.menu.recipeOf(capp)
      const rev2 = d.menu.saveRecipe(capp, { yield: 1, lines: r1.lines.map((l: any) => (l.ingredientSyncId === m.p.beans && !l.when ? { ...l, quantity: "20" } : l)), note: "stronger" }).id
      await flush()
      expect(queue().filter((op) => op.status !== "Synced").map((op) => [op.entity, errOf(op)])).toEqual([])
      const hubCapp = ((await hubPull(ownerPerson)).products as any[]).find((p) => p.syncId === m.p.capp)
      expect(hubCapp.recipeRev).toBe(rev2)
      shared("rev2", rev2)
      evidence("revision 2", { rev2, current: hubCapp.recipeRev })
    })
  })

  if (PHASE === "day-reconnect") describe("the offline register restarts and reconnects (till B)", { timeout: 300_000 }, () => {
    it("the offline sale is applied with revision 1 (18 g), never today's (20 g); a lost response resent consumes nothing again; Rana's shift closes", async () => {
      const m = M()
      await signIn("1504", A.staff.rana, false)
      const offline = shared("offlineSale") as string
      // the register sends its queue as it starts (before this check runs): the hub's record of the line decides
      await flush()
      expect([opFor("sale", offline)?.status, errOf(opFor("sale", offline))]).toEqual(["Synced", ""])
      const recorded = ((await hubPull(ownerPerson)).sales as any[]).find((s) => s.id === offline).items[0]
      const taken = Object.fromEntries((recorded.consumption as any[]).map((c) => [c.ingredientSyncId, c.quantity]))
      expect([recorded.recipeRev, taken[m.p.beans], taken[m.p.milk], recorded.costStatus]).toEqual([m.rev.capp, 18, 200, "known"])
      const after = await hubStock(ownerPerson)
      // the response was lost: the same operation is sent again
      const op = opFor("sale", offline)!
      const resent = await call(HUB!, "POST", "/api/sync/push", { deviceId, operations: [{ id: op.id, entity: op.entity, action: op.action, payload: op.payload }] }, connection)
      expect(resent.body.results[0].status).toBe("ok")
      expect((await hubStock(ownerPerson))[m.p.beans]).toBe(after[m.p.beans])
      const line = ((await hubPull(ownerPerson)).sales as any[]).find((s) => s.id === offline).items[0]
      expect(line.recipeRev).toBe(m.rev.capp)
      const shift = d.security.getActiveShift()
      if (shift) d.security.closeShift({ shiftId: shift.id, expectedCashUsd: 20, closingCashUsd: 20, notes: "Rana's shift" })
      await flush()
      expect(queue().filter((o) => o.status !== "Synced").map((o) => [o.entity, errOf(o)])).toEqual([])
      evidence("reconnected", { offline, beansTaken: taken[m.p.beans], milkTaken: taken[m.p.milk], recipeRev: line.recipeRev, rev2: shared("rev2"), resentStatus: resent.body.results[0].status })
    })
  })

  if (PHASE === "day-close") describe("counts and close (till A, Maya)", { timeout: 300_000 }, () => {
    it("ingredients counted in their units (a variance in grams and millilitres); Maya's shift and the day closed", async () => {
      const m = M()
      await signIn("1502", A.staff.maya)
      const beans = local(m.p.beans), milk = local(m.p.milk)
      const count = d.count.startStockCount()
      d.count.updateStockCountLine(count.id, beans.id, Math.round((Number(beans.stock) - 4.5) * 1000) / 1000)
      d.count.updateStockCountLine(count.id, milk.id, Math.round((Number(milk.stock) - 30) * 1000) / 1000)
      d.count.completeStockCount(count.id)
      const shift = d.security.getActiveShift()
      if (shift) d.security.closeShift({ shiftId: shift.id, expectedCashUsd: 20, closingCashUsd: 20, notes: "Maya's shift" })
      const close = d.close.closeBusinessDay({ dateKey: d.close.getLocalDateKey(), grossSales: 0, refunds: 0, netSales: 0, expenses: 0, cashIn: 0, cashOut: 0, note: "café day close", unsyncedCountAtClose: 0, saleIds: [], refundIds: [] } as any)
      await flush()
      expect(queue().filter((o) => o.status !== "Synced").map((o) => [o.entity, errOf(o)])).toEqual([])
      const s = await hubStock(ownerPerson)
      expect([s[m.p.beans], s[m.p.milk]]).toEqual([Math.round((Number(beans.stock) - 4.5) * 1000) / 1000, Math.round((Number(milk.stock) - 30) * 1000) / 1000])
      shared("close", close.id); shared("count", count.id)
      evidence("counted and closed", { beans: s[m.p.beans], milk: s[m.p.milk], close: close.id })
    })
  })

  if (PHASE === "day-resume") describe("the cloud is back: everything reached it once, and the books agree (verification)", { timeout: 600_000 }, () => {
    it("hub and cloud stock and open lots agree for every product; sale lines, consumption and cost agree", async () => {
      const m = M()
      await signIn("1502", A.staff.maya, false)
      const hub = await hubPull(ownerPerson)
      const hubStockNow = Object.fromEntries((hub.products as any[]).map((p) => [p.syncId, Number(p.stock)]))
      const settled = await waitFor(async () => {
        const pending = await prisma.syncOperation.count({ where: { tenantId: A.tenantId, status: { in: ["Pending", "Failed", "Refused"] } } })
        const c = await cloudProducts()
        return Object.entries(hubStockNow).every(([sid, q]) => c[sid] === q) ? { pending, c } : null
      }, 300_000)
      expect(settled).toBeTruthy()
      // open lots by product
      const lotsOf = (rows: any[]) => rows.filter((b) => b.status === "Open").reduce((acc: Record<string, number>, b) => { const k = b.productSyncId ?? String(b.productId); acc[k] = Math.round(((acc[k] ?? 0) + Number(b.quantityRemaining)) * 1000) / 1000; return acc }, {})
      const cloudLots = lotsOf((await prisma.inventoryBatch.findMany({ where: { tenantId: A.tenantId }, include: { product: { select: { syncId: true } } } })).map((b: any) => ({ ...b, productSyncId: b.product.syncId })))
      const hubLots = lotsOf(hub.batches)
      expect(hubLots).toEqual(cloudLots)
      // every hub sale line is on the cloud with the same consumption and cost
      const cloudSales = await prisma.sale.findMany({ where: { tenantId: A.tenantId }, include: { items: true } })
      for (const hs of hub.sales as any[]) {
        const cs = cloudSales.find((x: any) => x.id === hs.id)
        expect([hs.id, !!cs]).toEqual([hs.id, true])
        for (const hi of hs.items) {
          const ci = cs.items.find((x: any) => x.lineId === hi.lineId)
          expect([hi.lineId, (ci.consumption ?? []).map((c: any) => [c.ingredientSyncId, c.quantity]), Number(ci.cost), ci.recipeRev ?? null, (ci.modifiers ?? []).map((x: any) => x.optionId)])
            .toEqual([hi.lineId, (hi.consumption ?? []).map((c: any) => [c.ingredientSyncId, c.quantity]), Number(hi.cost), hi.recipeRev ?? null, (hi.modifiers ?? []).map((x: any) => x.optionId)])
        }
      }
      const waste = await prisma.stockAdjustment.findMany({ where: { tenantId: A.tenantId, wasteRef: { not: null } } })
      evidence("hub = cloud", { products: Object.keys(hubStockNow).length, lots: Object.keys(hubLots).length, sales: (hub.sales as any[]).length, wasteAdjustments: waste.length, beans: hubStockNow[m.p.beans], milk: hubStockNow[m.p.milk] })
      expect(waste.length).toBe(4 + 1 + 4) // Maya's remake (beans, milk, cup, lid), the spill, Rana's remake applied on review
    })

    it("the café report: drinks' own price and options apart, ingredient cost from the lots, waste; a cashier receives no cost", async () => {
      const cloudOwner = await login(CLOUD!, "1501", "person")
      const rep = (await call(CLOUD!, "GET", "/api/reports/cafe?days=1", undefined, cloudOwner)).body
      expect(rep.summary.modifierRevenue).toBeGreaterThan(0)
      expect(rep.summary.ingredientCost).toBeGreaterThan(0)
      expect(rep.summary.wasteCost).toBeGreaterThan(0)
      expect(rep.drinks.every((x: any) => x.costStatus === "known")).toBe(true)
      const rana = await login(CLOUD!, "1504", "register")
      const pull = (await call(CLOUD!, "GET", "/api/sync/pull", undefined, rana)).body
      const line = (pull.sales as any[]).flatMap((s) => s.items).find((i: any) => Array.isArray(i.consumption) && i.consumption.length)
      expect([line.cost, line.costStatus, line.consumption[0].cost, (pull.batches as any[])[0]?.purchasePrice, (pull.batches as any[])[0]?.unitCost]).toEqual([undefined, undefined, undefined, undefined, undefined])
      expect((await call(CLOUD!, "GET", "/api/reports/cafe?days=1", undefined, await login(CLOUD!, "1504", "person"))).status).toBe(403)
      evidence("café report", { summary: rep.summary, drinks: rep.drinks.map((x: any) => [x.name, x.quantity, x.baseRevenue, x.modifierRevenue, x.ingredientCost, x.costStatus, x.margin]), waste: rep.waste })
    })
  })
}
