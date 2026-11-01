/**
 * Daily-close valuation against a RUNNING packaged hub (docs/LEGACY-TILL-COMPAT.md "Daily close").
 * Skipped unless the same variables as installed-hub.test.ts are set; DATABASE_URL = the cloud's
 * scratch schema. The till's own services (HUB_TILL_SRC) sell, refund, pay and close the day.
 *
 * Phases (INSTALLED_HUB_PHASE):
 *   close         known / zero / hidden / missing costs, mixed tenders, refund, expense, supplier
 *                 payment, cash movement; cost-visible and cost-hidden closes; hub and cloud records;
 *                 duplicate submissions; what an older client is sent
 *   close-outage  the cloud is down: a close is taken by the hub and held for forwarding
 *   close-resume  after hub restart and cloud return: the held close reached the cloud once
 *
 * Dates: a store has one close per date (unique), so each scenario closes its own date key; the
 * server values a close from the sales and refunds it names, not from its date.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { pathToFileURL } from "node:url"

const HUB = process.env.INSTALLED_HUB_URL
const PHASE = process.env.INSTALLED_HUB_PHASE ?? "close"
const STATE = process.env.HUB_TILL_STATE
const STORE_FILE = process.env.INSTALLED_HUB_STORE
const SRC = process.env.HUB_TILL_SRC?.replace(/\\/g, "/")
const ready = !!HUB && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(HUB) && !!STORE_FILE && existsSync(STORE_FILE) && !!SRC && existsSync(`${SRC}/features/pos/services/sync.service.ts`) && PHASE.startsWith("close")
function evidence(what: string, data: unknown) {
  const line = `EVIDENCE close ${what}: ${JSON.stringify(data)}`
  console.log(line)
  if (process.env.LEGACY_TILL_EVIDENCE) appendFileSync(process.env.LEGACY_TILL_EVIDENCE, `${new Date().toISOString()} ${line}\n`)
}
class MemoryStorage { m = new Map<string, string>(); get length() { return this.m.size } key(i: number) { return [...this.m.keys()][i] ?? null } getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null } setItem(k: string, v: string) { this.m.set(k, String(v)) } removeItem(k: string) { this.m.delete(k) } clear() { this.m.clear() } }

if (!ready) {
  describe.skip("installed hub daily close: set INSTALLED_HUB_URL, INSTALLED_HUB_STORE, HUB_TILL_SRC and INSTALLED_HUB_PHASE=close*", () => { it("skipped", () => undefined) })
} else {
  const store = JSON.parse(readFileSync(STORE_FILE!, "utf8"))
  const A = store.A as { tenantId: string; subdomain: string; milkSyncId: string; sampleSyncId: string; staff: Record<string, string> }
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
  g.fetch = ((url: string, init?: RequestInit) => { const p = realFetch(url, init); inflight.add(p); void p.catch(() => undefined).finally(() => inflight.delete(p)); return p }) as typeof fetch
  const dispose = async () => {
    for (const id of timers) clearTimeout(id)
    timers.clear()
    for (let i = 0; i < 20 && (inflight.size > 0 || i < 3); i++) { await Promise.allSettled([...inflight]); await new Promise((r) => setImmediate(r)) }
  }
  const mod = (path: string) => import(/* @vite-ignore */ pathToFileURL(`${SRC}/${path}.ts`).href)
  let d: Record<string, any>
  const queue = () => JSON.parse(storage.getItem("lebanonpos.sync-queue.v1") ?? "[]") as Array<Record<string, any>>
  const flush = async () => {
    for (let i = 0; i < 3; i++) {
      storage.setItem("lebanonpos.sync-queue.v1", JSON.stringify(queue().map((op) => ({ ...op, status: op.status === "Failed" ? "Pending" : op.status, lastAttemptAt: "2000-01-01T00:00:00.000Z" }))))
      await d.sync.flushSyncQueue()
    }
    await dispose()
  }
  const call = async (method: string, path: string, body?: unknown, token?: string, headers: Record<string, string> = {}) => {
    const r = await realFetch(`${HUB}${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: r.status, body: (await r.json().catch(() => null)) as any }
  }
  const login = async (pin: string) => (await call("POST", "/api/auth/login", { pin, tenantSubdomain: A.subdomain })).body?.token as string
  const local = (syncId: string) => (JSON.parse(storage.getItem("lebanonpos.products.v1") ?? "[]") as any[]).find((p) => p.syncId === syncId)
  let prisma: any
  const inCloud = async <T>(read: () => Promise<T | null | undefined>, ms = 150_000): Promise<T | null> => {
    const end = Date.now() + ms
    for (;;) { const v = await read(); if (v) return v; if (Date.now() > end) return null; await new Promise((r) => setTimeout(r, 2000)) }
  }
  const deviceId = storage.getItem("lebanonpos.device-id.v1") ?? `close-it-${randomUUID().slice(0, 6)}`
  let owner = ""

  /** A checkout on the till. cost: what the till's line carries (undefined when it cannot see cost). */
  const sell = (syncId: string, qty: number, unitPrice: number, paymentMethod: string, cost: number | undefined) => {
    const p = local(syncId)
    const id = randomUUID()
    const sale = d.sales.buildSale({
      saleNumber: `S-CL-${id.slice(0, 6)}`, paymentMethod, subtotal: qty * unitPrice, tax: 0, total: qty * unitPrice,
      items: [{ id: p.id, productSyncId: p.syncId, name: p.name, barcode: p.barcode ?? "", ...(cost === undefined ? {} : { cost }), quantity: qty, unitPrice, total: qty * unitPrice, batchAllocations: [] }],
    }, id)
    expect(d.sales.checkoutLocalSale({ sale, lots: [{ productId: p.id, productName: p.name, barcode: p.barcode ?? "", quantity: qty, fallbackUnitCost: cost ?? 0 }], stock: [{ productId: p.id, quantity: qty }] }).status).toBe("completed")
    return id
  }
  const refundOne = (saleId: string) => {
    const sale = d.sales.getSales().find((s: any) => s.id === saleId)
    return d.sales.processRefund({ saleId, quantities: { [d.sales.refundLineKeyOf(sale.items[0])]: 1 }, reason: "IT refund" }).id as string
  }
  /** The close as the till builds it from its own records, for the given sales and refunds, under its own date key. */
  const closeDay = (dateKey: string, saleIds: string[], refundIds: string[]) => {
    const sales = d.sales.getSales().filter((s: any) => saleIds.includes(s.id))
    const refunds = d.sales.getRefunds().filter((r: any) => refundIds.includes(r.id))
    const expenses = d.expense.getExpenses().filter((e: any) => storage.getItem(`it.close.${dateKey}.expenses`)?.includes(e.id))
    const payments = d.supplier.getSupplierPayments().filter((p: any) => storage.getItem(`it.close.${dateKey}.payments`)?.includes(p.id))
    const s = d.acct.getAccountingSummary(sales, refunds, expenses, payments)
    // exactly the fields the Accounting page sends (AccountingPage.tsx closeBusinessDay call)
    const close = d.close.closeBusinessDay({
      dateKey, grossSales: s.grossSales, refunds: s.refunds, netSales: s.netSales, costOfGoods: s.costOfGoods, returnedCost: s.returnedCost,
      grossMargin: s.grossMargin, expenses: s.expenses, supplierPayments: s.supplierPayments, netProfit: s.netProfit, cashIn: s.cashIn, cashOut: s.cashOut,
      unsyncedCountAtClose: 0, note: "IT close", saleIds: s.saleIds, refundIds: s.refundIds,
    })
    return { id: close.id as string, summary: s }
  }
  const hubCloses = async (caps = true) => (await call("GET", "/api/sync/pull/full/daily-closes?limit=500", undefined, owner, { "x-titan-sync-schema": "4", ...(caps ? { "x-titan-unknown-cost": "1" } : {}) })).body?.items as any[]
  const pick = (c: any) => c && { costOfGoods: c.costOfGoods == null ? null : Number(c.costOfGoods), returnedCost: c.returnedCost == null ? null : Number(c.returnedCost), grossMargin: c.grossMargin == null ? null : Number(c.grossMargin), netProfit: c.netProfit == null ? null : Number(c.netProfit), costStatus: c.costStatus ?? null }
  const cloudClose = (id: string) => inCloud(() => prisma.dailyClose.findFirst({ where: { tenantId: A.tenantId, id } }))
  const asOwner = async () => { storage.setItem("lebanonpos.auth-token", owner); expect((await d.security.unlockWithPin("1501"))?.id).toBe(A.staff.owner); await dispose() }
  const asClerk = async () => { storage.setItem("lebanonpos.auth-token", await login("1503")); await d.sync.pullFromServer(true); await dispose(); expect((await d.security.unlockWithPin("1503"))?.id).toBe(A.staff.clerk); await dispose() }

  beforeAll(async () => {
    prisma = (await import("../src/lib/prisma.js")).default
    expect(await prisma.tenant.findUnique({ where: { id: A.tenantId }, select: { id: true } })).toBeTruthy()
    if (!storage.getItem("lebanonpos.device-id.v1")) {
      storage.setItem("lebanonpos.api-url", HUB!)
      storage.setItem("lebanonpos.connection-mode.v1", "CONNECT_TO_HUB")
      storage.setItem("lebanonpos.store-subdomain.v1", A.subdomain)
      storage.setItem("lebanonpos.tenant-id.v1", A.tenantId)
      storage.setItem("lebanonpos.device-id.v1", deviceId)
      storage.setItem("lebanonpos.users.v1", "[]")
    }
    d = {
      sync: await mod("features/pos/services/sync.service"), security: await mod("features/pos/services/security.service"), sales: await mod("features/pos/services/sales.service"),
      expense: await mod("features/pos/services/expense.service"), supplier: await mod("features/pos/services/supplier.service"), cash: await mod("features/pos/services/cashMovement.service"),
      close: await mod("features/pos/services/dailyClose.service"), acct: await mod("pages/accounting/accounting.helpers"), devices: await mod("features/pos/services/deviceRegistry.service"),
    }
    owner = await login("1501")
    expect(owner).toBeTruthy()
    if (PHASE === "close" || PHASE === "close-oldclient" || PHASE === "close-approve") {
      const code = await call("POST", "/api/device/generate-code", {}, owner)
      expect((await d.devices.pairDevice(code.body.code, deviceId, "Close IT till")).ok).toBe(true)
      storage.setItem("lebanonpos.auth-token", owner)
      await d.sync.pullFromServer(true); await dispose()
    }
  })
  afterAll(async () => { await dispose(); saveState(); await prisma?.$disconnect() })

  if (PHASE === "close") describe("daily close on the packaged hub", { timeout: 240_000 }, () => {
    let mixed: { id: string; summary: any }
    it("cost-visible close: known and zero costs, cash and card, refund, expense, supplier payment, cash movement", async () => {
      await asOwner()
      expect(d.security.openShift(50)).toBeTruthy()
      const milkCash = sell(A.milkSyncId, 2, 1.5, "Cash", 1)
      const sampleCard = sell(A.sampleSyncId, 1, 0.5, "Card", 0)
      const refund = refundOne(milkCash)
      const exp = d.expense.createExpense({ vendor: "IT", category: "Other", amount: 2, paymentMethod: "Cash", invoiceNumber: "", note: "" })
      const supplier = d.supplier.createSupplier({ name: `IT supplier ${randomUUID().slice(0, 4)}`, mobile: "", contact: "", address: "", notes: "" })
      const pay = d.supplier.recordSupplierPayment({ supplierId: supplier.id, amount: 3, method: "Cash", reference: "" })
      const draw = d.cash.createCashMovement({ type: "OwnerDraw", amountUsd: 1, reason: "IT draw" })
      expect(draw).toBeTruthy()
      storage.setItem("it.close.2099-01-01.expenses", JSON.stringify([exp.id]))
      storage.setItem("it.close.2099-01-01.payments", JSON.stringify([pay.id]))
      await flush()
      mixed = closeDay("2099-01-01", [milkCash, sampleCard], [refund])
      await flush()
      // sold 2 x 1 + 1 x 0 = 2, returned 1: COGS 1; margin (3 - 2) + (0.5 - 0) - (1.5 - 1) = 1; net 1 - 2
      const expected = { costOfGoods: 1, returnedCost: 1, grossMargin: 1, netProfit: -1, costStatus: "server" }
      const onHub = (await hubCloses()).find((c) => c.id === mixed.id)
      evidence("mixed", { till: { costOfGoods: mixed.summary.costOfGoods, grossMargin: mixed.summary.grossMargin, netProfit: mixed.summary.netProfit, cashIn: mixed.summary.cashIn, cashOut: mixed.summary.cashOut }, hub: pick(onHub), queue: queue().filter((o) => o.entity === "daily-close").map((o) => [o.status, o.error ?? null]) })
      expect(pick(onHub)).toEqual(expected)
      // the till's own figures agree with the server's
      expect({ c: mixed.summary.costOfGoods, m: mixed.summary.grossMargin, n: mixed.summary.netProfit }).toEqual({ c: 1, m: 1, n: -1 })
      // cash: sales in 3 cash; out: cash refund 1.5 + expense 2 + supplier payment 3 (the owner draw is a drawer movement, not in the close)
      expect({ cashIn: Number(onHub.cashIn), cashOut: Number(onHub.cashOut), grossSales: Number(onHub.grossSales), refunds: Number(onHub.refunds), expenses: Number(onHub.expenses) }).toEqual({ cashIn: 3, cashOut: 6.5, grossSales: 3.5, refunds: 1.5, expenses: 2 })
      expect(pick(await cloudClose(mixed.id))).toEqual(expected)
    })

    it("a true zero is zero: a close whose only sale cost nothing", async () => {
      const zero = sell(A.sampleSyncId, 2, 0.5, "Cash", 0)
      await flush()
      const c = closeDay("2099-01-02", [zero], [])
      await flush()
      const z = { costOfGoods: 0, returnedCost: 0, grossMargin: 1, netProfit: 1, costStatus: "server" }
      expect(pick((await hubCloses()).find((x) => x.id === c.id))).toEqual(z)
      expect(pick(await cloudClose(c.id))).toEqual(z)
    })

    it("a close naming a sale the server does not hold: the cost-visible figures are kept as stated", async () => {
      const c = d.close.closeBusinessDay({ dateKey: "2099-01-03", grossSales: 5, refunds: 0, netSales: 5, costOfGoods: 2, returnedCost: 0, grossMargin: 3, expenses: 0, supplierPayments: 0, netProfit: 3, cashIn: 5, cashOut: 0, unsyncedCountAtClose: 1, note: "", saleIds: [randomUUID()], refundIds: [] })
      await flush()
      expect(pick((await hubCloses()).find((x) => x.id === c.id))).toEqual({ costOfGoods: 2, returnedCost: 0, grossMargin: 3, netProfit: 3, costStatus: "complete" })
    })

    it("duplicate submissions: an exact resend applies once; closing the same date again", async () => {
      const op = queue().find((o) => o.entity === "daily-close" && o.payload?.dateKey === "2099-01-02")!
      const resend = await call("POST", "/api/sync/push", { deviceId, operations: [{ id: op.id, entity: op.entity, action: op.action, payload: op.payload }] }, owner)
      evidence("exact resend", resend.body?.results)
      expect(resend.body.results[0].status).toBe("ok")
      expect((await hubCloses()).filter((x) => x.dateKey === "2099-01-02")).toHaveLength(1)
      // The register lets a manager close the same day again ("This day was already closed."): a new close id for the same date.
      const again = closeDay("2099-01-02", [queue().find((o) => o.entity === "sale")!.payload.id], [])
      await flush()
      const rows = (await hubCloses()).filter((x) => x.dateKey === "2099-01-02")
      const reclose = queue().find((o) => o.entity === "daily-close" && o.payload?.id === again.id)
      evidence("re-close same date", { closesForDate: rows.length, newCloseStored: rows.some((x) => x.id === again.id), op: reclose ? [reclose.status, reclose.error ?? null] : null })
      expect(rows).toHaveLength(1)
      expect(rows[0].id).toBe(again.id) // the latest close of the day is the record
      expect(reclose?.status).toBe("Synced")
    })

    it("cost-hidden close (manager on a clerk-connected till): refused under the clerk's connection, applied on review, valued by the server", async () => {
      await asClerk()
      const sale = sell(A.milkSyncId, 1, 1.5, "Cash", undefined)
      await flush()
      // a manager unlocks the clerk-connected till to close the day: the connection stays the clerk's
      expect((await d.security.unlockWithPin("1502"))?.id).toBe(A.staff.manager); await dispose()
      const c = closeDay("2099-01-04", [sale], [])
      expect(c.summary.costOfGoods).toBeUndefined() // the till could not see cost
      await flush()
      const op = queue().find((o) => o.entity === "daily-close" && o.payload?.id === c.id)!
      evidence("clerk close", [op.status, op.error ?? null])
      expect(String(op.error)).toMatch(/permission/i)
      const applied = await call("POST", `/api/sync/refused/${op.id}/resolve`, { decision: "apply", note: "closed on the clerk's till", previewToken: ((await call("GET", "/api/sync/refused", undefined, owner)).body?.operations as any[] | undefined)?.find((o) => o.id === op.id)?.previewToken }, owner)
      expect(applied.status).toBe(200)
      const hidden = { costOfGoods: 1, returnedCost: 0, grossMargin: 0.5, netProfit: 0.5, costStatus: "server" }
      expect(pick((await hubCloses()).find((x) => x.id === c.id))).toEqual(hidden)
      expect(pick(await cloudClose(c.id))).toEqual(hidden)
      // the clerk's connection is sent no cost figures
      const clerkView = (await call("GET", "/api/sync/pull/full/daily-closes?limit=500", undefined, storage.getItem("lebanonpos.auth-token")!, { "x-titan-unknown-cost": "1" })).body.items as any[]
      expect(clerkView.every((x) => !("netProfit" in x) && !("costOfGoods" in x))).toBe(true)
    })

    it("cost-hidden close naming a sale the server lacks: unknown, never 0; an older client is not sent the unknown", async () => {
      // the manager on the clerk-connected till closes a day naming a sale the server never received
      const c = d.close.closeBusinessDay({ dateKey: "2099-01-05", grossSales: 4, refunds: 0, netSales: 4, expenses: 0, supplierPayments: 0, cashIn: 4, cashOut: 0, unsyncedCountAtClose: 1, note: "", saleIds: [randomUUID()], refundIds: [] })
      const op = () => queue().find((o) => o.entity === "daily-close" && o.payload?.id === c.id)!
      await flush()
      expect((await call("POST", `/api/sync/refused/${op().id}/resolve`, { decision: "apply", note: "IT review", previewToken: ((await call("GET", "/api/sync/refused", undefined, owner)).body?.operations as any[] | undefined)?.find((o) => o.id === op().id)?.previewToken }, owner)).status).toBe(200)
      const unknown = { costOfGoods: null, returnedCost: null, grossMargin: null, netProfit: null, costStatus: "incomplete" }
      expect(pick((await hubCloses()).find((x) => x.id === c.id))).toEqual(unknown)
      expect(pick(await cloudClose(c.id))).toEqual(unknown)
      const old = (await hubCloses(false)).find((x) => x.id === c.id)
      evidence("older client sees", old)
      expect(old).not.toHaveProperty("costStatus")
      expect(old).not.toHaveProperty("netProfit")
    })
  })

  if (PHASE === "close-oldclient") describe("an older till (HUB_TILL_SRC = released 1.0.51)", { timeout: 240_000 }, () => {
    it("pulls closes without the unknown figures (it cannot represent unknown); known figures intact", async () => {
      storage.setItem("lebanonpos.api-url", HUB!)
      storage.setItem("lebanonpos.auth-token", owner)
      await d.sync.pullFromServer(true); await dispose()
      const closes = JSON.parse(storage.getItem("lebanonpos.daily-closes.v1") ?? "[]") as any[]
      const unknown = closes.find((c) => c.dateKey === "2099-01-05")
      const known = closes.find((c) => c.dateKey === "2099-01-01")
      evidence("1.0.51 till stores", { unknown, known: known && { netProfit: known.netProfit, costOfGoods: known.costOfGoods } })
      expect(unknown).toBeTruthy()
      expect(unknown).not.toHaveProperty("netProfit")
      expect(unknown).not.toHaveProperty("costStatus")
      expect(Number(known.netProfit)).toBe(-1)
    })
  })

  if (PHASE === "close-approve") describe("manager approval through the packaged hub, attested to the cloud", { timeout: 240_000 }, () => {
    it("the owner enrolls the hub key on the hub; a clerk's void approved by the manager reaches the cloud attested, with the approver", async () => {
      const enroll = await call("POST", "/api/setup/hub-key", { pin: "1501" })
      evidence("hub key", { status: enroll.status, enrolled: !!enroll.body?.kid })
      expect(enroll.status).toBe(200)
      await asClerk() // connected and signed in as the clerk (no void permission), on the enrolled register
      const id = sell(A.milkSyncId, 1, 1.5, "Cash", undefined)
      await flush()
      const sale = d.sales.getSales().find((x: any) => x.id === id)
      expect(() => d.sales.voidSale(id)).toThrow(/permission/i)
      const approval = await mod("features/pos/services/approval.service")
      const r = await approval.requestManagerApproval({ entity: "sale", action: "void", payload: d.sales.voidApprovalPayload(sale), permission: "sales.void", pin: "1502" })
      evidence("approval", { ok: r.ok, code: r.ok ? null : r.code })
      expect(r.ok).toBe(true)
      d.sales.voidSale(id)
      await flush()
      const op = queue().find((o) => o.entity === "sale" && o.action === "void" && o.payload?.id === id)!
      expect(op.status).toBe("Synced")
      const atCloud = await inCloud(() => prisma.operationEvidence.findFirst({ where: { tenantId: A.tenantId, opId: op.id } }))
      evidence("cloud evidence", atCloud && { attestation: atCloud.attestation, evidence: atCloud.evidence, approval: atCloud.approval })
      expect(atCloud?.attestation).toBe("valid")
      expect(atCloud?.approval).toMatchObject({ check: "valid", approverId: A.staff.manager, permission: "sales.void" })
      expect((await prisma.sale.findFirst({ where: { tenantId: A.tenantId, id }, select: { status: true } }))?.status).toBe("Voided")
    })
  })

  if (PHASE === "close-outage") describe("cloud down", { timeout: 240_000 }, () => {
    it("a close is taken by the hub and held for forwarding", async () => {
      await asOwner()
      const sale = sell(A.milkSyncId, 1, 1.5, "Card", 1)
      await flush()
      const c = closeDay("2099-01-06", [sale], [])
      await flush()
      storage.setItem("it.outage.close", c.id)
      expect(pick((await hubCloses()).find((x) => x.id === c.id))).toEqual({ costOfGoods: 1, returnedCost: 0, grossMargin: 0.5, netProfit: 0.5, costStatus: "server" })
      expect(await prisma.dailyClose.findFirst({ where: { tenantId: A.tenantId, id: c.id } })).toBeNull()
    })
  })

  if (PHASE === "close-resume") describe("after hub restart and cloud return", { timeout: 240_000 }, () => {
    it("the held close reached the cloud once, with the server's figures", async () => {
      const id = storage.getItem("it.outage.close")!
      expect(pick(await cloudClose(id))).toEqual({ costOfGoods: 1, returnedCost: 0, grossMargin: 0.5, netProfit: 0.5, costStatus: "server" })
      expect(await prisma.dailyClose.count({ where: { tenantId: A.tenantId, dateKey: "2099-01-06" } })).toBe(1)
    })
  })
}
