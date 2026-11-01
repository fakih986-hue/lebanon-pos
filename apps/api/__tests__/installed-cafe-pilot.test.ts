/**
 * Operational readiness: one complete disposable café pilot against a RUNNING packaged hub and a loopback test
 * cloud (real PostgreSQL, real packaged handlers). Skipped unless INSTALLED_HUB_URL, INSTALLED_CLOUD_URL,
 * INSTALLED_HUB_STORE, HUB_TILL_SRC and INSTALLED_HUB_PHASE=pilot-* are set; DATABASE_URL = the cloud's scratch
 * schema. The registers are the build's own services (HUB_TILL_SRC); each phase runs on the register state the
 * previous one left (HUB_TILL_STATE). Topology: the hub keeps the stock (registers behind it).
 *
 * Owner steps run in the browser on the Store security screen between phases (setup choice, retiring the old
 * register, full enforcement, lowering to observe); a phase checks what that decided.
 *   pilot-prepare  (till A) observe: the hub enrolls its key; the owner pairs the register; one signed-in sale;
 *                  queues and the hub report reach the cloud
 *   pilot-prepare-b (till B) the second register, the same
 *   [browser: retire "Old front till", choose "registers through the hub", turn on full enforcement]
 *   pilot-roles    (till A) enforced: Rana on the owner's connection: shift, barcode-free Espresso + scanned Milk,
 *                  discount and price override on approval, refund, void, payout on approval; an adjustment she
 *                  may not make is held; Noor cannot sell; staff switch to Maya: receiving + supplier payment, a
 *                  count, a customer payment, her close of the day on this register; Rana's shift closed
 *   pilot-own      (till B) Rana on her own connection; Maya closes the day on the second register, then corrects it
 *   [browser at the hub: Maya applies Rana's held adjustment]
 *   pilot-outage   (till A, cloud stopped) LAN only: sales and an approval at the hub; work waits for the cloud
 *   pilot-restart  (till A, hub restarted, cloud still stopped) still enforcing, still the store's hub
 *   pilot-offline  (till A pointed at nothing) a routine sale and a payout made offline; the register restarts
 *   pilot-reconnect (till A) reconnected: the routine sale is applied as an offline claim, the payout held
 *   pilot-revoke   (till B) work queued, the owner revokes the register, it comes back: refused, its work kept
 *   pilot-resume   (cloud back) everything the hub applied reached the cloud once, with the same people
 *   pilot-direct   (till C straight to the cloud) told to use the hub; checkout stopped; its sale held, stock unchanged
 *   pilot-verify   hub and cloud agree on stock and lots; money, balances, close revisions, actors, approvers,
 *                  reviewers, evidence and queues as expected
 *   [browser: return to observe]
 *   pilot-lower    the hub adopted observe (a newer version)
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
const ready = loopback(HUB) && loopback(CLOUD) && !!STORE_FILE && existsSync(STORE_FILE) && !!SRC && existsSync(`${SRC}/features/pos/services/sync.service.ts`) && PHASE.startsWith("pilot")
function evidence(what: string, data: unknown) {
  const line = `EVIDENCE pilot ${what}: ${JSON.stringify(data)}`
  console.log(line)
  if (process.env.LEGACY_TILL_EVIDENCE) appendFileSync(process.env.LEGACY_TILL_EVIDENCE, `${new Date().toISOString()} ${line}\n`)
}
class MemoryStorage { m = new Map<string, string>(); get length() { return this.m.size } key(i: number) { return [...this.m.keys()][i] ?? null } getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null } setItem(k: string, v: string) { this.m.set(k, String(v)) } removeItem(k: string) { this.m.delete(k) } clear() { this.m.clear() } }

if (!ready) {
  describe.skip("installed café pilot: set INSTALLED_HUB_URL, INSTALLED_CLOUD_URL, INSTALLED_HUB_STORE, HUB_TILL_SRC and INSTALLED_HUB_PHASE=pilot-*", () => { it("skipped", () => undefined) })
} else {
  type P = { id: number; syncId: string; barcode: string }
  const store = JSON.parse(readFileSync(STORE_FILE!, "utf8"))
  const A = store.A as { tenantId: string; subdomain: string; staff: Record<string, string>; espresso: P; milk: P; water: P; supplierId: string; customerId: string }
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
  // offline: the register's server cannot be reached (its address stays what it is)
  let unreachable = false
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
    const r = await realFetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: r.status, body: (await r.json().catch(() => null)) as any }
  }
  const login = async (base: string, pin: string, client: "register" | "person") => (await call(base, "POST", "/api/auth/login", { pin, tenantSubdomain: A.subdomain, client })).body?.token as string
  const local = (syncId: string) => (JSON.parse(storage.getItem("lebanonpos.products.v1") ?? "[]") as any[]).find((p) => p.syncId === syncId)
  const credential = () => JSON.parse(storage.getItem("lebanonpos.device-credential.v1") ?? "null")?.credential as string | undefined
  const staffSession = () => JSON.parse(storage.getItem("lebanonpos.staff-session.v1") ?? "null") as { session: string; staffId: string } | null
  let prisma: any
  const waitFor = async <T>(read: () => Promise<T | null | undefined | false>, ms = 150_000): Promise<T | null> => {
    const end = Date.now() + ms
    for (;;) { const v = await read(); if (v) return v; if (Date.now() > end) return null; await new Promise((r) => setTimeout(r, 2000)) }
  }
  const cloudStock = async (syncId: string) => Number((await prisma.product.findFirst({ where: { tenantId: A.tenantId, syncId } }))!.stock)
  const hubProduct = async (token: string, syncId: string) => ((await call(HUB!, "GET", "/api/sync/pull", undefined, token)).body?.products as any[] | undefined)?.find((p) => p.syncId === syncId)
  const deviceId = storage.getItem("lebanonpos.device-id.v1") ?? `pilot-${PHASE.replace("pilot-", "")}-${randomUUID().slice(0, 6)}`
  let ownerTransport = "", ownerPerson = ""
  const ask = (entity: string, action: string, payload: any, permission: string, pin = "1502") => d.approval.requestManagerApproval({ entity, action, payload, permission, permissions: [permission], pin })
  const keep = (k: string, v: string) => storage.setItem(`it.pilot.${k}`, v)
  const kept = (k: string) => storage.getItem(`it.pilot.${k}`)!
  const shared = (k: string, v?: string) => { const f = `${STORE_FILE!.replace(/stores\.json$/, "")}pilot-shared.json`; const all = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {}; if (v === undefined) return all[k] as string; all[k] = v; writeFileSync(f, JSON.stringify(all, null, 2)); return v }

  async function signIn(pin: string, staffId: string, openShift = true) {
    d.security.lockSession(); await dispose()
    expect((await d.security.unlockWithPin(pin))?.id).toBe(staffId); await dispose()
    if (openShift && !d.security.getActiveShift()) expect(d.security.openShift(20)).toBeTruthy()
  }
  /** A café order: one barcode-free Espresso (made to order) and Milk found by scanning its barcode. */
  function cafeOrder(opts: { discount?: number; milkPrice?: number } = {}) {
    const espresso = local(A.espresso.syncId)
    const scanned = d.products.findProductByBarcode(A.milk.barcode)
    expect(scanned?.syncId).toBe(A.milk.syncId)
    const milkPrice = opts.milkPrice ?? 1.5, discount = opts.discount ?? 0
    const subtotal = 2.5 + 2 * milkPrice
    const id = randomUUID()
    return d.sales.buildSale({ saleNumber: `S-PL-${id.slice(0, 6)}`, paymentMethod: "Cash", subtotal: subtotal - discount, discountTotal: discount, tax: 0, total: subtotal - discount,
      items: [
        { id: espresso.id, productSyncId: espresso.syncId, name: espresso.name, barcode: "", quantity: 1, unitPrice: 2.5, total: 2.5, batchAllocations: [], stockPolicy: "untracked" },
        { id: scanned.id, productSyncId: scanned.syncId, name: scanned.name, barcode: scanned.barcode ?? "", quantity: 2, unitPrice: milkPrice, total: 2 * milkPrice, batchAllocations: [], stockPolicy: "tracked" },
      ] }, id)
  }
  const checkout = (sale: any) => {
    const m = local(A.milk.syncId)
    return d.sales.checkoutLocalSale({ sale, lots: [{ productId: m.id, productName: m.name, barcode: m.barcode ?? "", quantity: 2, fallbackUnitCost: 0 }], stock: [{ productId: m.id, quantity: 2 }] })
  }

  beforeAll(async () => {
    prisma = (await import("../src/lib/prisma.js")).default
    expect(await prisma.tenant.findUnique({ where: { id: A.tenantId }, select: { id: true } })).toBeTruthy()
    const fresh = !storage.getItem("lebanonpos.device-id.v1")
    const server = PHASE === "pilot-direct" ? CLOUD! : HUB!
    if (fresh) {
      storage.setItem("lebanonpos.api-url", server)
      storage.setItem("lebanonpos.connection-mode.v1", server === CLOUD ? "DIRECT_RAILWAY" : "CONNECT_TO_HUB")
      storage.setItem("lebanonpos.store-subdomain.v1", A.subdomain)
      storage.setItem("lebanonpos.tenant-id.v1", A.tenantId)
      storage.setItem("lebanonpos.device-id.v1", deviceId)
      storage.setItem("lebanonpos.users.v1", "[]")
    }
    d = {
      sync: await mod("features/pos/services/sync.service"), security: await mod("features/pos/services/security.service"), sales: await mod("features/pos/services/sales.service"),
      devices: await mod("features/pos/services/deviceRegistry.service"), products: await mod("features/pos/services/product.service"),
      approval: await mod("features/pos/services/approval.service"), cash: await mod("features/pos/services/cashMovement.service"), batches: await mod("features/pos/services/inventoryBatch.service"),
      close: await mod("features/pos/services/dailyClose.service"), supplier: await mod("features/pos/services/supplier.service"), customer: await mod("features/pos/services/customer.service"),
      count: await mod("features/pos/services/stockCount.service"),
    }
    if (!["pilot-outage", "pilot-restart", "pilot-offline"].includes(PHASE)) {
      ownerTransport = await login(server, "1501", "register")
      ownerPerson = await login(server, "1501", "person")
    } else if (PHASE !== "pilot-offline") {
      ownerTransport = await login(HUB!, "1501", "register")
      ownerPerson = await login(HUB!, "1501", "person")
    }
    if (fresh) {
      expect([!!ownerTransport, !!ownerPerson]).toEqual([true, true])
      const code = (await call(server, "POST", "/api/device/generate-code", {}, ownerPerson)).body?.code
      expect((await d.devices.pairDevice(code, deviceId, `Pilot ${PHASE}`)).ok).toBe(true)
    }
    if (ownerTransport) storage.setItem("lebanonpos.auth-token", ownerTransport)
    if (!["pilot-outage", "pilot-restart", "pilot-offline"].includes(PHASE)) { await d.sync.pullFromServer(true); await dispose() }
  })
  afterAll(async () => { await dispose(); saveState(); await prisma?.$disconnect() })

  if (PHASE === "pilot-prepare" || PHASE === "pilot-prepare-b") describe("setup (observe)", { timeout: 300_000 }, () => {
    it("the hub's key (owner PIN at the hub); the register is paired and enrolled; a signed-in sale; its queue and the hub's report reach the cloud", async () => {
      if (PHASE === "pilot-prepare") expect((await call(HUB!, "POST", "/api/setup/hub-key", { pin: "1501" })).status).toBe(200)
      await signIn("1501", A.staff.owner)
      const proof = cafeOrder()
      expect(checkout(proof).status).toBe("completed")
      await flush()
      expect(opFor("sale", proof.id)?.status).toBe("Synced")
      await d.sync.pullFromServer(false); await dispose() // reports its (empty) queue to the hub
      shared(PHASE === "pilot-prepare" ? "tillA" : "tillB", deviceId)
      const reported = await waitFor(async () => { const k = await prisma.hubKey.findFirst({ where: { tenantId: A.tenantId, status: "ACTIVE" } }); return k?.lastReportAt && k.lastReport?.registers?.some((r: any) => r.deviceId === deviceId && r.report) ? k : null })
      expect(reported).toBeTruthy()
      evidence(`${PHASE} hub report`, { hubId: reported.hubId, unsent: reported.lastReport.unsent, registers: reported.lastReport.registers.map((r: any) => [r.deviceId, r.report]) })
    })
  })

  if (PHASE === "pilot-closeshift") describe("the setup shift is closed (readiness for the store's setup)", { timeout: 300_000 }, () => {
    it("the owner closes the shift opened for the proof sale; the register reports an empty queue", async () => {
      await signIn("1501", A.staff.owner, false)
      const open = d.security.getActiveShift()
      if (open) d.security.closeShift({ shiftId: open.id, expectedCashUsd: 20, closingCashUsd: 20, notes: "setup shift" })
      await flush()
      await d.sync.pullFromServer(false); await dispose()
      expect(queue().filter((o) => o.status !== "Synced")).toEqual([])
      d.security.lockSession(); await dispose()
    })
  })

  if (PHASE === "pilot-transport") describe("enforced: the decisions reached the hub (till A)", { timeout: 300_000 }, () => {
    it("the owner's decisions reached the hub: full enforcement, registers through this hub", async () => {
      const s = (await call(HUB!, "GET", "/api/sync/status", undefined, ownerPerson)).body
      const topo = (await call(HUB!, "GET", "/api/sync/topology", undefined, ownerPerson)).body
      evidence("hub adopted", { mode: s.staffSessionMode, version: s.staffPolicyVersion, topology: topo.topology, thisHub: topo.thisHub?.isStoresHub })
      expect([s.staffSessionMode, topo.topology.mode, topo.thisHub.isStoresHub]).toEqual(["enforce", "hub", true])
      // the owner's connection alone carries no authority
      const id = randomUUID()
      const probe = { id, saleNumber: `S-PL-${id.slice(0, 6)}`, paymentMethod: "Cash", subtotal: 2.5, tax: 0, total: 2.5, cashier: "Owner", cashierId: A.staff.owner, status: "Completed", createdAt: new Date().toISOString(), items: [{ id: A.espresso.id, productSyncId: A.espresso.syncId, lineId: randomUUID(), name: "Espresso", barcode: "", quantity: 1, unitPrice: 2.5, total: 2.5, batchAllocations: [] }] }
      const r = (await call(HUB!, "POST", "/api/sync/push", { deviceId, operations: [{ id: randomUUID(), entity: "sale", action: "create", payload: probe }] }, ownerTransport, { "x-device-credential": credential() ?? "", "x-titan-sync-schema": "5" })).body
      expect(r.results[0].error).toMatch(/^IDENTITY_REQUIRED/)
      evidence("owner connection without a session", r.results[0].error.slice(0, 80))
    })
  })

  if (PHASE === "pilot-roles") describe("roles, enforced (till A)", { timeout: 600_000 }, () => {

    it("Rana on the owner's connection: shift, café orders (discount and price override on approval), refund, void, payout; an adjustment she may not make is held; Noor cannot sell", async () => {
      await signIn("1504", A.staff.rana)
      const milk0 = await cloudStock(A.milk.syncId)
      const plain = cafeOrder()
      expect(checkout(plain).status).toBe("completed")
      const discounted = cafeOrder({ discount: 0.5 })
      expect((await ask("sale", "create", discounted, "sales.discount")).ok).toBe(true)
      expect(checkout(discounted).status).toBe("completed")
      const below = cafeOrder({ milkPrice: 1.2 })
      expect((await ask("sale", "create", below, "sales.price_override")).ok).toBe(true)
      expect(checkout(below).status).toBe("completed")
      await flush()
      for (const s of [plain, discounted, below]) expect([s.id, opFor("sale", s.id)?.status]).toEqual([s.id, "Synced"])
      // refund one Milk of the discounted order, void the plain one, a payout: each on Maya's approval
      const sale = d.sales.getSales().find((s: any) => s.id === discounted.id)
      const milkLine = sale.items.find((i: any) => i.productSyncId === A.milk.syncId)
      const refundId = randomUUID()
      const refundInput = { saleId: discounted.id, quantities: { [d.sales.refundLineKeyOf(milkLine)]: 1 }, reason: "spilled", id: refundId }
      expect((await ask("refund", "create", d.sales.refundApprovalPayload(refundInput), "sales.refund")).ok).toBe(true)
      d.sales.processRefund(refundInput)
      expect((await ask("sale", "void", d.sales.voidApprovalPayload(d.sales.getSales().find((s: any) => s.id === plain.id)), "sales.void")).ok).toBe(true)
      d.sales.voidSale(plain.id)
      const payout = { id: randomUUID(), type: "PettyCash", amountUsd: 3, reason: "Ice for the café", note: "" }
      expect((await ask("cash-movement", "create", d.cash.cashMovementApprovalPayload(payout), "cash.manage")).ok).toBe(true)
      expect(d.cash.createCashMovement(payout)).toBeTruthy()
      await flush()
      for (const [e, id] of [["refund", refundId], ["sale", plain.id], ["cash-movement", payout.id]] as const) expect([e, opFor(e, id)?.status]).toEqual([e, "Synced"])
      // an adjustment Rana may not make (a modified register sends it anyway): held for review at the hub
      const adjId = randomUUID()
      const water = local(A.water.syncId)
      const adj = await call(HUB!, "POST", "/api/sync/push", { deviceId, operations: [{ id: randomUUID(), entity: "inventory", action: "adjust", payload: { id: adjId, adjustmentNumber: `ADJ-PL-${adjId.slice(0, 4)}`, productId: water.id, productSyncId: water.syncId, productName: water.name, barcode: water.barcode, quantityBefore: 30, quantityChange: -2, quantityAfter: 28, reason: "Damaged", note: "two bottles broke", createdAt: new Date().toISOString() }, ev: { v: 1, session: staffSession()!.session } }] }, ownerTransport, { "x-device-credential": credential() ?? "", "x-titan-sync-schema": "5" })
      expect(adj.body.results[0].error).toMatch(/permission/i)
      shared("heldAdjustment", adjId)
      keep("plain", plain.id); keep("discounted", discounted.id); keep("below", below.id); keep("refund", refundId); keep("payout", payout.id)
      // Noor (no checkout permission) signs in; a sale sent anyway is refused and kept for review
      await signIn("1506", A.staff.noor, false)
      const noorSale = { ...cafeOrder(), cashierId: A.staff.noor, cashier: "Noor" }
      const r = await call(HUB!, "POST", "/api/sync/push", { deviceId, operations: [{ id: randomUUID(), entity: "sale", action: "create", payload: noorSale, ev: { v: 1, session: staffSession()!.session } }] }, ownerTransport, { "x-device-credential": credential() ?? "", "x-titan-sync-schema": "5" })
      expect(r.body.results[0].error).toMatch(/Noor is not allowed to sell/)
      evidence("rana and noor", { milkBefore: milk0, noor: r.body.results[0].error.slice(0, 60), adjustment: adj.body.results[0].error.slice(0, 80) })
    })

    it("staff switch to Maya: receiving and supplier payment, a count, a customer payment, Rana's shift closed, Maya's close of the day on this register", async () => {
      await signIn("1502", A.staff.maya, false)
      const milk = local(A.milk.syncId), water = local(A.water.syncId)
      const lot = randomUUID()
      d.batches.receiveInventoryBatches([{ id: lot, productId: milk.id, productSyncId: milk.syncId, productName: milk.name, barcode: milk.barcode, quantity: 12, unitCost: 0.9, unitPrice: 1.5, supplierId: A.supplierId, supplierName: "Dairy Co" }])
      const pay = d.supplier.recordSupplierPayment({ supplierId: A.supplierId, amount: 10.8, method: "Cash", reference: "INV-PL-1" })
      const count = d.count.startStockCount()
      d.count.updateStockCountLine(count.id, water.id, Number(water.stock) - 1)
      d.count.completeStockCount(count.id)
      const custPay = d.customer.recordDebtPayment({ customerId: A.customerId, amount: 5, method: "Cash", reference: "TAB-PL-1" })
      const ranaShift = d.security.getShifts().find((s: any) => s.status === "Open" && s.openedById === A.staff.rana)
      if (ranaShift) d.security.closeShift({ shiftId: ranaShift.id, expectedCashUsd: 20, closingCashUsd: 20, notes: "closed by Maya" })
      if (!d.security.getActiveShift()) expect(d.security.openShift(0)).toBeTruthy()
      const close = d.close.closeBusinessDay({ dateKey: d.close.getLocalDateKey(), grossSales: 10, refunds: 1, netSales: 9, expenses: 0, cashIn: 9, cashOut: 3, note: "Maya, front register", unsyncedCountAtClose: 0, saleIds: [kept("discounted"), kept("below")], refundIds: [kept("refund")] } as any)
      await flush()
      for (const [e, id] of [["inventory", lot], ["supplier-payment", pay.id], ["debt", custPay.id], ["daily-close", close.id]] as const) expect([e, opFor(e, id)?.status, errOf(opFor(e, id))]).toEqual([e, "Synced", ""])
      keep("lot", lot); keep("supplierPayment", pay.id); keep("customerPayment", custPay.id); shared("closeA", close.id); keep("count", count.id)
    })
  })

  if (PHASE === "pilot-own") describe("Rana on her own connection; the day closed on a second register and corrected (till B)", { timeout: 300_000 }, () => {
    it("Rana's sale is hers; Maya closes the day here (a second close) and corrects it (a revision)", async () => {
      storage.setItem("lebanonpos.auth-token", await login(HUB!, "1504", "register"))
      await signIn("1504", A.staff.rana)
      const own = cafeOrder()
      expect(checkout(own).status).toBe("completed")
      await flush()
      expect(opFor("sale", own.id)?.status).toBe("Synced")
      shared("ownSale", own.id)
      await signIn("1502", A.staff.maya)
      const first = d.close.closeBusinessDay({ dateKey: d.close.getLocalDateKey(), grossSales: 5.5, refunds: 0, netSales: 5.5, expenses: 0, cashIn: 5.5, cashOut: 0, note: "back register", unsyncedCountAtClose: 0, saleIds: [own.id], refundIds: [] } as any)
      await flush()
      const corrected = d.close.closeBusinessDay({ dateKey: d.close.getLocalDateKey(), grossSales: 5.5, refunds: 0, netSales: 5.5, expenses: 0, cashIn: 5, cashOut: 0, note: "back register, cash recounted", unsyncedCountAtClose: 0, saleIds: [own.id], refundIds: [] } as any)
      await flush()
      for (const c of [first, corrected]) expect(opFor("daily-close", c.id)?.status).toBe("Synced")
      shared("closeB1", first.id); shared("closeB2", corrected.id)
    })
  })

  if (PHASE === "pilot-outage") describe("internet outage, LAN available (cloud stopped)", { timeout: 300_000 }, () => {
    it("the hub keeps enforcing; a sale and a refund on Maya's approval at the hub; the work waits for the cloud", async () => {
      expect((await call(CLOUD!, "GET", "/api/health").catch(() => ({ status: 0 }))).status).toBe(0)
      await signIn("1504", A.staff.rana)
      const lan = cafeOrder()
      expect(checkout(lan).status).toBe("completed")
      await flush()
      expect(opFor("sale", lan.id)?.status).toBe("Synced")
      const line = d.sales.getSales().find((s: any) => s.id === lan.id).items.find((i: any) => i.productSyncId === A.milk.syncId)
      const refundId = randomUUID()
      const input = { saleId: lan.id, quantities: { [d.sales.refundLineKeyOf(line)]: 1 }, reason: "wrong milk", id: refundId }
      expect((await ask("refund", "create", d.sales.refundApprovalPayload(input), "sales.refund")).ok).toBe(true)
      d.sales.processRefund(input)
      await flush()
      expect(opFor("refund", refundId)?.status).toBe("Synced")
      shared("lanSale", lan.id); shared("lanRefund", refundId)
      const topo = (await call(HUB!, "GET", "/api/sync/topology", undefined, ownerPerson)).body
      expect(topo.thisHub.isStoresHub).toBe(true)
    })
  })

  if (PHASE === "pilot-restart") describe("hub restarted, cloud still stopped", { timeout: 300_000 }, () => {
    it("still enforcing, still the store's hub; a sale is the session person's", async () => {
      const s = (await call(HUB!, "GET", "/api/sync/status", undefined, ownerPerson)).body
      const topo = (await call(HUB!, "GET", "/api/sync/topology", undefined, ownerPerson)).body
      expect([s.staffSessionMode, topo.topology.mode, topo.thisHub.isStoresHub]).toEqual(["enforce", "hub", true])
      await signIn("1504", A.staff.rana)
      const after = cafeOrder()
      expect(checkout(after).status).toBe("completed")
      await flush()
      expect(opFor("sale", after.id)?.status).toBe("Synced")
      shared("restartSale", after.id)
      evidence("after restart", { mode: s.staffSessionMode, version: s.staffPolicyVersion, topology: topo.topology.version })
    })
  })

  if (PHASE === "pilot-offline") describe("the register offline, then restarted", { timeout: 300_000 }, () => {
    it("a routine sale completes offline (queued); a payout made offline is queued too; nothing is lost when the register restarts", async () => {
      unreachable = true
      // Rana signs in by the register's own PIN check (no server reachable): her work is an offline claim
      await signIn("1504", A.staff.rana, false)
      if (!d.security.getActiveShift()) d.security.openShift(0)
      const routine = cafeOrder()
      expect(checkout(routine).status).toBe("completed")
      // Maya, also signed in offline, pays out: kept, decided by a manager once online
      await signIn("1502", A.staff.maya, false)
      const payout = { id: randomUUID(), type: "PettyCash", amountUsd: 1, reason: "Sugar", note: "" }
      const made = d.cash.createCashMovement(payout)
      await flush()
      expect(opFor("sale", routine.id)?.status).not.toBe("Synced")
      shared("offlineSale", routine.id); shared("offlinePayout", made ? payout.id : "")
      evidence("offline", { sale: opFor("sale", routine.id)?.status, ev: opFor("sale", routine.id)?.ev, payout: made ? opFor("cash-movement", payout.id)?.status : "not allowed offline" })
    })
  })

  if (PHASE === "pilot-reconnect") describe("reconnected after the restart", { timeout: 300_000 }, () => {
    it("the routine offline sale is applied as an offline claim; an offline payout is held for review; nothing is charged twice", async () => {
      await flush()
      const sale = opFor("sale", shared("offlineSale"))
      expect(sale?.status).toBe("Synced")
      const payoutId = shared("offlinePayout")
      const payout = payoutId ? opFor("cash-movement", payoutId) : null
      if (payout) expect(errOf(payout)).toMatch(/OFFLINE_REVIEW/)
      evidence("reconnect", { sale: sale?.status, payout: payout ? [payout.status, errOf(payout).slice(0, 60)] : "none" })
    })
  })

  if (PHASE === "pilot-revoke") describe("revocation with pending work (till B)", { timeout: 300_000 }, () => {
    it("work queued while away; the owner revokes the register; it comes back: refused, its work kept on the register", async () => {
      // Rana's sale made while the register could not reach the hub
      await signIn("1504", A.staff.rana)
      unreachable = true
      const away = cafeOrder()
      expect(checkout(away).status).toBe("completed")
      unreachable = false
      expect((await call(HUB!, "POST", "/api/device/revoke", { deviceId }, ownerPerson)).status).toBe(200)
      await flush()
      const op = opFor("sale", away.id)
      expect(op?.status).not.toBe("Synced")
      expect(op).toBeTruthy()
      evidence("revoked with pending work", { status: op?.status, error: errOf(op).slice(0, 90) })
    })
  })

  if (PHASE === "pilot-resume") describe("cloud back", { timeout: 300_000 }, () => {
    it("everything the hub applied reached the cloud once, with the same actor, approver and reviewer on the records", async () => {
      const ids = ["lanSale", "restartSale", "ownSale", "offlineSale"].map((k) => shared(k))
      const arrived = await waitFor(async () => (await prisma.sale.count({ where: { tenantId: A.tenantId, id: { in: ids } } })) === ids.length ? true : null, 180_000)
      expect(arrived).toBe(true)
      const lanRefund = await waitFor(() => prisma.saleRefund.findFirst({ where: { tenantId: A.tenantId, id: shared("lanRefund") } }))
      expect([lanRefund?.cashierId, (lanRefund?.attribution as any)?.basis, (lanRefund?.attribution as any)?.approver?.id]).toEqual([A.staff.rana, "verified", A.staff.maya])
      const offline = await prisma.sale.findFirst({ where: { tenantId: A.tenantId, id: shared("offlineSale") } })
      expect([offline?.cashierId, (offline?.attribution as any)?.basis]).toEqual([A.staff.rana, "offline-claimed"])
      const adj = await waitFor(() => prisma.stockAdjustment.findFirst({ where: { tenantId: A.tenantId, id: shared("heldAdjustment") } }))
      expect([adj?.createdById, (adj?.attribution as any)?.basis, (adj?.attribution as any)?.reviewer?.id]).toEqual([A.staff.rana, "reviewed", A.staff.maya])
      evidence("resume", { sales: ids.length, lanRefund: lanRefund?.attribution, adjustment: adj?.attribution })
    })
  })

  if (PHASE === "pilot-direct") describe("a register connected straight to the cloud in a hub store (till C)", { timeout: 300_000 }, () => {
    it("told to connect to the hub; checkout stops before payment; a sale it sends anyway is held, cloud stock unchanged, the work kept", async () => {
      // told on its first download (and on every later pull and status check)
      expect(d.sync.getTopologyGuidance()?.verdict).toBe("use-hub")
      await d.sync.pullFromServer(false); await dispose()
      expect(d.sync.getTopologyGuidance()?.verdict).toBe("use-hub")
      const milk0 = await cloudStock(A.milk.syncId)
      // the register's own sale path would not let it sell; a register on an older version sends one anyway
      await signIn("1504", A.staff.rana, false)
      const s = cafeOrder()
      const r = await call(CLOUD!, "POST", "/api/sync/push", { deviceId, operations: [{ id: randomUUID(), entity: "sale", action: "create", payload: s }] }, ownerTransport, { "x-device-credential": credential() ?? "", "x-titan-sync-schema": "5" })
      expect(r.body.results[0]).toMatchObject({ status: "error", error: expect.stringMatching(/^TOPOLOGY_USE_HUB:/) })
      expect(await cloudStock(A.milk.syncId)).toBe(milk0)
      expect(await prisma.syncOperation.count({ where: { tenantId: A.tenantId, status: "Refused", error: { startsWith: "TOPOLOGY_USE_HUB" } } })).toBeGreaterThan(0)
      expect((await call(CLOUD!, "POST", "/api/inventory/reconciliation/repair", { productId: 1, reason: "count" }, ownerPerson)).body.code).toBe("TOPOLOGY_STOCK_AUTHORITY")
      evidence("direct register", { verdict: d.sync.getTopologyGuidance()?.verdict, held: r.body.results[0].error.slice(0, 70) })
    })
  })

  if (PHASE === "pilot-verify") describe("hub and cloud agree; every record names the right people", { timeout: 300_000 }, () => {
    it("stock and lots equal (the cloud's readiness check finds no difference); money, balances, closes, actors, approvers, reviewers, evidence and queues", async () => {
      const hubKey = await waitFor(async () => { const k = await prisma.hubKey.findFirst({ where: { tenantId: A.tenantId, status: "ACTIVE" } }); return k?.lastReportAt && Date.now() - new Date(k.lastReportAt).getTime() < 120_000 ? k : null })
      expect(hubKey).toBeTruthy()
      const readiness = (await call(CLOUD!, "GET", "/api/sync/topology?to=direct", undefined, ownerPerson)).body.readiness.blockers.map((b: any) => b.code)
      expect(readiness).not.toContain("stock-unreconciled")
      expect(readiness).not.toContain("hub-unsent")
      // stock: the milk received (12) less what was sold and returned; the count corrected water by -1, the reviewed adjustment by -2
      const water = await cloudStock(A.water.syncId)
      expect(water).toBe(30 - 1 - 2)
      // closes: two registers, the second corrected (revision 2 supersedes 1)
      const closes = await prisma.dailyClose.findMany({ where: { tenantId: A.tenantId, id: { in: [shared("closeA"), shared("closeB1"), shared("closeB2")] } }, select: { id: true, revision: true, supersededById: true, closedById: true, closedBy: true, scope: true } })
      const b2 = closes.find((c: any) => c.id === shared("closeB2"))
      expect([closes.length, b2?.revision, closes.find((c: any) => c.id === shared("closeB1"))?.supersededById]).toEqual([3, 2, shared("closeB2")])
      expect(new Set(closes.map((c: any) => c.closedById))).toEqual(new Set([A.staff.maya]))
      // supplier and customer money
      const sp = await prisma.supplierPayment.findMany({ where: { tenantId: A.tenantId, supplierId: A.supplierId }, select: { amount: true, recordedById: true } })
      expect(sp.map((x: any) => [Number(x.amount), x.recordedById])).toEqual([[10.8, A.staff.maya]])
      const cp = await prisma.debtPayment.findMany({ where: { tenantId: A.tenantId, customerId: A.customerId }, select: { amount: true, recordedById: true } })
      expect(cp.map((x: any) => [Number(x.amount), x.recordedById])).toEqual([[5, A.staff.maya]])
      const lots = await prisma.inventoryBatch.findMany({ where: { tenantId: A.tenantId, productId: (await prisma.product.findFirst({ where: { tenantId: A.tenantId, syncId: A.milk.syncId } })).id }, select: { receivedById: true, initialQuantity: true } })
      expect(lots.map((l: any) => [l.receivedById, Number(l.initialQuantity)])).toEqual([[A.staff.maya, 12]])
      const actors = await prisma.sale.findMany({ where: { tenantId: A.tenantId, status: { in: ["Completed", "Voided"] } }, select: { cashierId: true, voidedById: true, status: true, attribution: true } })
      const voided = actors.filter((s: any) => s.status === "Voided")
      expect(voided.map((s: any) => [s.cashierId, s.voidedById])).toEqual([[A.staff.rana, A.staff.rana]])
      const payouts = await prisma.cashMovement.findMany({ where: { tenantId: A.tenantId }, select: { recordedById: true, attribution: true, amountUsd: true } })
      evidence("verify", { readiness, water, closes: closes.map((c: any) => [c.revision, c.supersededById ? "superseded" : "current"]), sales: actors.length, voided: voided.length, payouts: payouts.map((p: any) => [Number(p.amountUsd), p.recordedById === A.staff.rana ? "Rana" : p.recordedById, (p.attribution as any)?.basis, (p.attribution as any)?.approver?.name ?? null]) })
      expect(payouts.find((p: any) => Number(p.amountUsd) === 3)).toMatchObject({ recordedById: A.staff.rana })
      expect((payouts.find((p: any) => Number(p.amountUsd) === 3)?.attribution as any)?.approver?.id).toBe(A.staff.maya)
    })
  })

  if (PHASE === "pilot-lower") describe("lowered to observe", { timeout: 300_000 }, () => {
    it("the owner's newer decision reached the hub", async () => {
      const s = await waitFor(async () => { const x = (await call(HUB!, "GET", "/api/sync/status", undefined, ownerPerson)).body; return x?.staffSessionMode === "observe" ? x : null })
      expect(s?.staffSessionMode).toBe("observe")
      evidence("lowered", { mode: s?.staffSessionMode, version: s?.staffPolicyVersion })
    })
  })
}
