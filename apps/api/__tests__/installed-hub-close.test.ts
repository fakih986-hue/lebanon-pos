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
  const hubCloses = async (caps = true, revisions = false) => (await call("GET", "/api/sync/pull/full/daily-closes?limit=500", undefined, owner, { "x-titan-sync-schema": "4", ...(caps ? { "x-titan-unknown-cost": "1" } : {}), ...(revisions ? { "x-titan-close-revisions": "1" } : {}) })).body?.items as any[]
  const pick = (c: any) => c && { costOfGoods: c.costOfGoods == null ? null : Number(c.costOfGoods), returnedCost: c.returnedCost == null ? null : Number(c.returnedCost), grossMargin: c.grossMargin == null ? null : Number(c.grossMargin), netProfit: c.netProfit == null ? null : Number(c.netProfit), costStatus: c.costStatus ?? null }
  const cloudClose = (id: string) => inCloud(() => prisma.dailyClose.findFirst({ where: { tenantId: A.tenantId, id } }))
  const asOwner = async () => { storage.setItem("lebanonpos.auth-token", owner); expect((await d.security.unlockWithPin("1501"))?.id).toBe(A.staff.owner); await dispose() }
  // Rana: the default Cashier preset (sell, reprint, see stock): every approval in the batch is needed
  const asRana = async () => { storage.setItem("lebanonpos.auth-token", await login("1504")); await d.sync.pullFromServer(true); await dispose(); expect((await d.security.unlockWithPin("1504"))?.id).toBe(A.staff.rana); await dispose() }
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
      const rows = (await hubCloses(true, true)).filter((x) => x.dateKey === "2099-01-02")
      const reclose = queue().find((o) => o.entity === "daily-close" && o.payload?.id === again.id)
      const first = rows.find((x) => x.id !== again.id)
      const fix = rows.find((x) => x.id === again.id)
      evidence("re-close same date", { closes: rows.length, firstKept: !!first, supersededBy: first?.supersededById ?? null, revision: fix?.revision ?? null, correction: fix?.correction ?? null, op: reclose ? [reclose.status, reclose.error ?? null] : null })
      // the same register closing the same date again is a correction: a linked revision; the first close is kept
      expect([rows.length, first?.supersededById, fix?.revision, fix?.revisionOf, fix?.correction]).toEqual([2, again.id, 2, first?.id, "correction"])
      expect(reclose?.status).toBe("Synced")
      // an older till sees the one close its reports use: the correction
      const old = (await hubCloses()).filter((x) => x.dateKey === "2099-01-02")
      expect(old.map((x) => x.id)).toEqual([again.id])
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


  // SPRINT-2 batch, packaged hub with the cloud unreachable: approvals are checked by the hub (online at the
  // hub), work is held for forwarding; the hub is then restarted and the cloud comes back after more than an
  // approval's lifetime (close-batch-resume).
  if (PHASE === "close-batch") describe("staff-auth batch on the packaged hub, cloud down", { timeout: 300_000 }, () => {
    it("a cashier's discount at checkout, a refund and a payout, each approved by the manager on the hub; closes per register with a correction; the cashier's own close held for review", async () => {
      await asRana()
      // the date the registers close (BATCH_DAY), and the date of the cashier's own (held) close
      const day = process.env.BATCH_DAY ?? "2099-02-01"
      const heldDay = `${day.slice(0, 8)}${String(Number(day.slice(8)) + 1).padStart(2, "0")}`
      if (!d.security.getActiveShift()) expect(d.security.openShift(20)).toBeTruthy()
      const approval = await mod("features/pos/services/approval.service")
      const hub = await mod("features/pos/services/hubCheckout.service")
      const p = local(A.milkSyncId)
      // checkout: 2 x 1.50 with 0.50 off (the clerk has no discount permission): this sale is approved and sent
      const id = randomUUID()
      const sale = d.sales.buildSale({ saleNumber: `S-BT-${id.slice(0, 6)}`, paymentMethod: "Cash", subtotal: 2.5, discountTotal: 0.5, tax: 0, total: 2.5,
        items: [{ id: p.id, productSyncId: p.syncId, name: p.name, barcode: p.barcode ?? "", quantity: 2, unitPrice: 1.5, total: 3, batchAllocations: [] }] }, id)
      const ask = (entity: string, action: string, payload: any, permission: string, pin: string) => approval.requestManagerApproval({ entity, action, payload, permission, permissions: [permission], pin })
      const wrong = await ask("sale", "create", sale, "sales.discount", "0000")
      expect([wrong.ok, wrong.code]).toEqual([false, "INVALID_PIN"])
      const granted = await ask("sale", "create", sale, "sales.discount", "1502")
      expect(granted.ok).toBe(true)
      const lots = [{ productId: p.id, productName: p.name, barcode: p.barcode ?? "", quantity: 2, fallbackUnitCost: 0 }]
      const outcome = await hub.checkoutViaHub({ fingerprint: hub.cartFingerprint({ items: [{ id: p.id, quantity: 2, unitPrice: 1.5 }], paymentMethod: "Cash", total: 2.5 }), build: () => sale, lots, stock: [{ productId: p.id, quantity: 2 }], approvalId: granted.grant.approvalId })
      // the confirmation is lost: the register resends the same sale with the same approval
      const resend = await d.sync.commitSaleToHub(sale, granted.grant.approvalId)
      evidence("batch checkout", { outcome: outcome.status, resend: resend.status })
      expect([outcome.status, resend.status]).toEqual(["committed", "committed"])
      // refund of one with the manager's approval
      const sold = d.sales.getSales().find((x: any) => x.id === id)
      const quantities = { [d.sales.refundLineKeyOf(sold.items[0])]: 1 }
      const rid = randomUUID()
      expect(() => d.sales.processRefund({ saleId: id, quantities, reason: "IT", id: rid })).toThrow(/permission/i)
      expect((await ask("refund", "create", d.sales.refundApprovalPayload({ saleId: id, quantities, reason: "IT", id: rid }), "sales.refund", "1502")).ok).toBe(true)
      d.sales.processRefund({ saleId: id, quantities, reason: "IT", id: rid })
      // a payout with the manager's approval
      const input = { id: randomUUID(), type: "OwnerDraw", amountUsd: 1, reason: "Owner draw", note: "IT batch" }
      expect(d.cash.createCashMovement(input)).toBeNull()
      expect((await ask("cash-movement", "create", d.cash.cashMovementApprovalPayload(input), "cash.manage", "1502")).ok).toBe(true)
      expect(d.cash.createCashMovement(input)).toBeTruthy()
      // sent on the cashier's own connection: applied on the manager's approvals, not on anyone else's authority
      await flush()
      const approved = queue().filter((o) => [rid, input.id].includes(o.payload?.id))
      evidence("batch approved ops", approved.map((o) => [o.entity, o.status, o.lastError ?? o.error ?? null]))
      expect(approved.map((o) => o.status)).toEqual(["Synced", "Synced"])
      // closes: this register, another register of the store the same date, and this register's correction
      await asOwner()
      const c1 = closeDay(day, [id], [rid])
      // another register of the store, paired on the hub, closes the same date
      const code = (await call("POST", "/api/device/generate-code", {}, owner)).body.code
      const counter2 = (await call("POST", "/api/device/pair", { code, deviceId: `counter-2-${day}`, deviceName: "Counter 2" })).body as { credential: string }
      expect(counter2.credential).toBeTruthy()
      const other = { id: randomUUID(), dateKey: day, registerId: "REG-001", deviceId: `counter-2-${day}`, grossSales: 1, refunds: 0, netSales: 1, expenses: 0, cashIn: 1, cashOut: 0, note: "other register", closedBy: "Owner", createdAt: new Date().toISOString(), saleIds: [], refundIds: [] }
      const pushed = await call("POST", "/api/sync/push", { deviceId: `counter-2-${day}`, operations: [{ id: randomUUID(), entity: "daily-close", action: "close", payload: other }] }, owner, { "x-device-credential": counter2.credential, "x-titan-sync-schema": "4" })
      expect(pushed.body?.results?.[0]?.status, JSON.stringify(pushed.body)).toBe("ok")
      await flush()
      const c2 = closeDay(day, [id], [rid])
      await flush()
      const rows = (await hubCloses(true, true)).filter((x) => x.dateKey === day).map((x) => ({ id: x.id, scope: x.scope, revision: x.revision, revisionOf: x.revisionOf, supersededById: x.supersededById }))
      evidence("batch closes on hub", rows)
      expect(rows).toHaveLength(3)
      expect(rows.find((x) => x.id === c2.id)).toMatchObject({ revision: 2, revisionOf: c1.id, supersededById: null })
      expect(rows.find((x) => x.id === c1.id)?.supersededById).toBe(c2.id)
      // the other register keeps the default label REG-001 too: its device tells it apart
      expect(rows.find((x) => x.id === other.id)).toMatchObject({ scope: `device:counter-2-${day}`, revision: 1 })
      // the cashier closes the day (no accounting permission), on her own connection: refused, held for review
      await asRana()
      const clerkClose = closeDay(heldDay, [id], [rid])
      await flush()
      const held = queue().find((o) => o.payload?.id === clerkClose.id)
      evidence("batch held close", held && [held.status, held.lastError ?? held.error ?? null])
      expect(held?.status).not.toBe("Synced")
      // nothing reached the cloud (it is down)
      expect(await prisma.sale.count({ where: { tenantId: A.tenantId, id } })).toBe(0)
      for (const [k, v] of Object.entries({ day, sale: id, refund: rid, payout: input.id, clerkClose: clerkClose.id, c1: c1.id, c2: c2.id, other: other.id, at: new Date().toISOString() })) storage.setItem(`it.batch.${k}`, v)
    })
  })

  if (PHASE === "close-batch-resume") describe("after a hub restart, the cloud back more than an approval's lifetime later", { timeout: 300_000 }, () => {
    it("each approval reached the cloud valid (hub-checked, signed, digest matching), the closes and their links match, the sale applied once", async () => {
      const k = (x: string) => storage.getItem(`it.batch.${x}`)!
      expect(Date.now() - Date.parse(k("at"))).toBeGreaterThan(120_000)
      const opIds = { sale: `wt-${k("sale")}`, refund: queue().find((o) => o.payload?.id === k("refund"))!.id, payout: queue().find((o) => o.payload?.id === k("payout"))!.id }
      const seen: Record<string, unknown> = {}
      for (const [name, opId] of Object.entries(opIds)) {
        const e = await inCloud(() => prisma.operationEvidence.findFirst({ where: { tenantId: A.tenantId, opId } }))
        seen[name] = e && { attestation: e.attestation, check: (e.approval as any)?.check, hubCheck: (e.approval as any)?.hubCheck, permissions: (e.approval as any)?.permissions, approver: (e.approval as any)?.approverName, usedSecondsBeforeForwarding: e && Math.round((Date.parse(String(e.receivedAt)) - Date.parse((e.approval as any)?.consumedAt)) / 1000) }
        expect(e?.attestation).toBe("valid")
        expect(e?.approval).toMatchObject({ check: "valid", hubCheck: "valid", approverId: A.staff.manager })
      }
      evidence("batch cloud evidence", seen)
      expect(await prisma.sale.count({ where: { tenantId: A.tenantId, id: k("sale") } })).toBe(1)
      expect(Number((await prisma.sale.findFirst({ where: { tenantId: A.tenantId, id: k("sale") } }))?.discountTotal)).toBe(0.5)
      // the closes and their links, as the hub recorded them
      const cloudRows = await inCloud(async () => { const r = await prisma.dailyClose.findMany({ where: { tenantId: A.tenantId, dateKey: k("day") } }); return r.length === 3 ? r : null })
      const shape = (r: any) => [r.id, r.scope, r.revision, r.revisionOf ?? null, r.supersededById ?? null]
      const hubRows = (await hubCloses(true, true)).filter((x) => x.dateKey === k("day"))
      evidence("batch closes in cloud", cloudRows?.map(shape))
      expect(cloudRows!.map(shape).sort()).toEqual(hubRows.map(shape).sort())
    })

    it("review on the hub: a stale preview and a clerk without the permission are refused; the owner applies the cashier's close once; actor and reviewer kept apart; forwarded", async () => {
      const k = (x: string) => storage.getItem(`it.batch.${x}`)!
      const opId = queue().find((o) => o.payload?.id === k("clerkClose"))!.id
      const list = (await call("GET", "/api/sync/refused", undefined, owner)).body.operations as any[]
      const item = list.find((o) => o.id === opId)
      expect(item?.category).toBe("permission-missing")
      expect((await call("POST", `/api/sync/refused/${opId}/resolve`, { decision: "apply", note: "closed on the clerk's till", previewToken: "0".repeat(32) }, owner)).body.code).toBe("STALE_PREVIEW")
      const clerk = await login("1503")
      expect((await call("POST", `/api/sync/refused/${opId}/resolve`, { decision: "apply", note: "self-approve", previewToken: item.previewToken }, clerk)).status).toBe(403)
      const body = { decision: "apply", note: "closed on Rana's till", previewToken: item.previewToken }
      const [a, b] = await Promise.all([call("POST", `/api/sync/refused/${opId}/resolve`, body, owner), call("POST", `/api/sync/refused/${opId}/resolve`, body, owner)])
      expect([a.status, b.status].sort()).toEqual([200, 409])
      const decided = ((await call("GET", "/api/sync/refused/decisions", undefined, owner)).body.decisions as any[]).find((x) => x.opId === opId)
      evidence("batch review decision", decided && { decision: decided.decision, actor: decided.actor, approver: decided.approver, reviewer: decided.reviewer })
      expect(decided).toMatchObject({ decision: "apply", actor: { session: { id: A.staff.rana } }, reviewer: { id: A.staff.owner } })
      expect(await inCloud(() => prisma.dailyClose.findFirst({ where: { tenantId: A.tenantId, id: k("clerkClose") } }))).toBeTruthy()
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
