/**
 * Platform-wide staff enforcement ("enforce") against a RUNNING packaged hub and a loopback test cloud
 * (docs/STAFF-ENFORCEMENT.md). Skipped unless the variables of installed-hub-close.test.ts are set, plus
 * INSTALLED_CLOUD_URL; DATABASE_URL = the cloud's scratch schema. The till's own services (HUB_TILL_SRC)
 * sign people in, sell, ask for approvals, refund, void, pay out, receive, close the day.
 *
 * Phases (INSTALLED_HUB_PHASE), in order, each on the till state of the previous one:
 *   enforce-observe   observe mode: the hub enrolls its key; the till proves device and session; a legacy
 *                     register syncing through the hub blocks activation until the owner retires it; the
 *                     cloud issues enforce (the hub cannot); the hub adopts it
 *   enforce-roles     cashier via the owner's connection, via her own, manager after a staff switch, staff
 *                     without checkout; lost responses; review; revoked session and device; the hub's own screen
 *   enforce-outage    cloud stopped (LAN only): the hub keeps enforcing; approvals at the hub; work held for forwarding
 *   enforce-restart   hub restarted, cloud still stopped: still enforcing (the boundary is not lowered by a restart)
 *   enforce-resume    cloud back: the held work reached it once, as the hub signed it
 *   enforce-oldtill   (HUB_TILL_SRC = released 1.0.51, its own TILL_STATE) refused at the boundary, its sale kept
 *   enforce-direct    (INSTALLED_HUB_URL = the cloud, its own TILL_STATE) a register connected straight to the cloud
 *   enforce-lower     the owner lowers to observe at the cloud (version +1); the hub adopts it
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
const ready = loopback(HUB) && loopback(CLOUD) && !!STORE_FILE && existsSync(STORE_FILE) && !!SRC && existsSync(`${SRC}/features/pos/services/sync.service.ts`) && PHASE.startsWith("enforce")
function evidence(what: string, data: unknown) {
  const line = `EVIDENCE enforce ${what}: ${JSON.stringify(data)}`
  console.log(line)
  if (process.env.LEGACY_TILL_EVIDENCE) appendFileSync(process.env.LEGACY_TILL_EVIDENCE, `${new Date().toISOString()} ${line}\n`)
}
class MemoryStorage { m = new Map<string, string>(); failOn: RegExp | null = null; get length() { return this.m.size } key(i: number) { return [...this.m.keys()][i] ?? null } getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null } setItem(k: string, v: string) { if (this.failOn?.test(k)) throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); this.m.set(k, String(v)) } removeItem(k: string) { this.m.delete(k) } clear() { this.m.clear() } }

if (!ready) {
  describe.skip("installed hub enforcement: set INSTALLED_HUB_URL, INSTALLED_CLOUD_URL, INSTALLED_HUB_STORE, HUB_TILL_SRC and INSTALLED_HUB_PHASE=enforce*", () => { it("skipped", () => undefined) })
} else {
  const store = JSON.parse(readFileSync(STORE_FILE!, "utf8"))
  const A = store.A as { tenantId: string; subdomain: string; milkSyncId: string; sampleSyncId: string; latteSyncId: string; staff: Record<string, string> }
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
  const opFor = (entity: string, id: string) => queue().find((o) => o.entity === entity && o.payload?.id === id)
  const errOf = (o: any) => String(o?.lastError ?? o?.error ?? "")
  const flush = async () => {
    for (let i = 0; i < 3; i++) {
      storage.setItem("lebanonpos.sync-queue.v1", JSON.stringify(queue().map((op) => ({ ...op, status: op.status === "Failed" ? "Pending" : op.status, lastAttemptAt: "2000-01-01T00:00:00.000Z" }))))
      await d.sync.flushSyncQueue()
    }
    await dispose()
  }
  const call = async (base: string, method: string, path: string, body?: unknown, token?: string, headers: Record<string, string> = {}) => {
    const r = await realFetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: r.status, body: (await r.json().catch(() => null)) as any }
  }
  const login = async (base: string, pin: string, client: "register" | "person") => (await call(base, "POST", "/api/auth/login", { pin, tenantSubdomain: A.subdomain, client })).body?.token as string
  const local = (syncId: string) => (JSON.parse(storage.getItem("lebanonpos.products.v1") ?? "[]") as any[]).find((p) => p.syncId === syncId)
  const credential = () => JSON.parse(storage.getItem("lebanonpos.device-credential.v1") ?? "null")?.credential as string | undefined
  const staffSession = () => JSON.parse(storage.getItem("lebanonpos.staff-session.v1") ?? "null") as { session: string; staffId: string } | null
  /** What a register sends, with this till's device credential and (optionally) a session. */
  const rawPush = async (operations: any[], token: string, session?: string | null, schema = "5") =>
    (await call(HUB!, "POST", "/api/sync/push", { deviceId, operations: operations.map((o) => ({ ...o, ...(session ? { ev: { v: 1, session } } : {}) })) }, token, { "x-device-credential": credential() ?? "", "x-titan-sync-schema": schema })).body
  let prisma: any
  const waitFor = async <T>(read: () => Promise<T | null | undefined | false>, ms = 150_000): Promise<T | null> => {
    const end = Date.now() + ms
    for (;;) { const v = await read(); if (v) return v; if (Date.now() > end) return null; await new Promise((r) => setTimeout(r, 2000)) }
  }
  const cloudEvidence = (opId: string) => waitFor(() => prisma.operationEvidence.findFirst({ where: { tenantId: A.tenantId, opId } }))
  const cloudStock = async (syncId: string) => Number((await prisma.product.findFirst({ where: { tenantId: A.tenantId, syncId } }))!.stock)
  const hubPolicy = async (token: string) => { const s = (await call(HUB!, "GET", "/api/sync/status", undefined, token)).body; return { mode: s?.staffSessionMode, version: s?.staffPolicyVersion } }
  const deviceId = storage.getItem("lebanonpos.device-id.v1") ?? `enf-${PHASE.replace("enforce-", "")}-${randomUUID().slice(0, 6)}`
  let ownerTransport = "", ownerPerson = "", cloudOwner = ""
  const ask = (entity: string, action: string, payload: any, permission: string, pin = "1502") => d.approval.requestManagerApproval({ entity, action, payload, permission, permissions: [permission], pin })

  /** The register locks; `pin` signs in (server PIN check, staff session on this enrolled device). */
  async function signIn(pin: string, staffId: string) {
    d.security.lockSession(); await dispose()
    expect((await d.security.unlockWithPin(pin))?.id).toBe(staffId); await dispose()
    if (d.security.getActiveShift && !d.security.getActiveShift()) expect(d.security.openShift(20)).toBeTruthy()
  }
  /** A mixed café order: 2 Milk (tracked) + 1 Latte (made to order), optionally discounted. */
  function cafeOrder(discount = 0) {
    const m = local(A.milkSyncId), l = local(A.latteSyncId)
    const id = randomUUID()
    return d.sales.buildSale({ saleNumber: `S-EN-${id.slice(0, 6)}`, paymentMethod: "Cash", subtotal: 7 - discount, discountTotal: discount, tax: 0, total: 7 - discount,
      items: [
        { id: m.id, productSyncId: m.syncId, name: m.name, barcode: m.barcode ?? "", quantity: 2, unitPrice: 1.5, total: 3, batchAllocations: [], stockPolicy: "tracked" },
        { id: l.id, productSyncId: l.syncId, name: l.name, barcode: l.barcode ?? "", quantity: 1, unitPrice: 4, total: 4, batchAllocations: [], stockPolicy: "untracked" },
      ] }, id)
  }
  const checkout = (sale: any) => {
    const m = local(A.milkSyncId)
    return d.sales.checkoutLocalSale({ sale, lots: [{ productId: m.id, productName: m.name, barcode: m.barcode ?? "", quantity: 2, fallbackUnitCost: 0 }], stock: [{ productId: m.id, quantity: 2 }] })
  }
  const keep = (k: string, v: string) => storage.setItem(`it.enf.${k}`, v)
  const kept = (k: string) => storage.getItem(`it.enf.${k}`)!

  beforeAll(async () => {
    prisma = (await import("../src/lib/prisma.js")).default
    expect(await prisma.tenant.findUnique({ where: { id: A.tenantId }, select: { id: true } })).toBeTruthy()
    const fresh = !storage.getItem("lebanonpos.device-id.v1")
    if (fresh) {
      storage.setItem("lebanonpos.api-url", HUB!)
      storage.setItem("lebanonpos.connection-mode.v1", HUB === CLOUD ? "DIRECT_RAILWAY" : "CONNECT_TO_HUB")
      storage.setItem("lebanonpos.store-subdomain.v1", A.subdomain)
      storage.setItem("lebanonpos.tenant-id.v1", A.tenantId)
      storage.setItem("lebanonpos.device-id.v1", deviceId)
      storage.setItem("lebanonpos.users.v1", "[]")
    }
    const old = PHASE === "enforce-oldtill"
    d = {
      sync: await mod("features/pos/services/sync.service"), security: await mod("features/pos/services/security.service"), sales: await mod("features/pos/services/sales.service"),
      devices: await mod("features/pos/services/deviceRegistry.service"),
      ...(old ? {} : {
        approval: await mod("features/pos/services/approval.service"), cash: await mod("features/pos/services/cashMovement.service"), batches: await mod("features/pos/services/inventoryBatch.service"),
        expense: await mod("features/pos/services/expense.service"), close: await mod("features/pos/services/dailyClose.service"),
      }),
    }
    ownerTransport = await login(HUB!, "1501", "register")
    ownerPerson = await login(HUB!, "1501", "person")
    cloudOwner = await login(CLOUD!, "1501", "person")
    expect([!!ownerTransport, !!ownerPerson, !!cloudOwner]).toEqual([true, true, true])
    if (fresh) {
      // the owner pairs (and enrolls) this register; it connects with the owner's account
      const code = (await call(HUB!, "POST", "/api/device/generate-code", {}, ownerPerson)).body?.code
      expect((await d.devices.pairDevice(code, deviceId, `Enforce IT ${PHASE}`)).ok).toBe(true)
    }
    storage.setItem("lebanonpos.auth-token", ownerTransport)
    if (PHASE !== "enforce-restart" && PHASE !== "enforce-outage") { await d.sync.pullFromServer(true); await dispose() }
  })
  afterAll(async () => { await dispose(); saveState(); await prisma?.$disconnect() })

  if (PHASE === "enforce-observe") describe("activation (observe mode)", { timeout: 300_000 }, () => {
    it("the hub's key; the till proves device and session; a legacy register blocks until retired; the cloud issues enforce, the hub cannot; the hub adopts it", async () => {
      expect((await call(HUB!, "POST", "/api/setup/hub-key", { pin: "1501" })).status).toBe(200)
      await signIn("1501", A.staff.owner)
      const proof = cafeOrder(0)
      expect(checkout(proof).status).toBe("completed")
      await flush()
      expect(opFor("sale", proof.id)?.status).toBe("Synced")
      // a register still on an old version syncs through the hub with no device credential and no session
      const legacyId = `legacy-${randomUUID().slice(0, 6)}`
      const legacySale = { ...cafeOrder(0), cashier: "Owner", cashierId: A.staff.owner }
      const legacyOp = randomUUID()
      const pushed = (await call(HUB!, "POST", "/api/sync/push", { deviceId: legacyId, operations: [{ id: legacyOp, entity: "sale", action: "create", payload: legacySale }] }, ownerTransport, { "x-titan-sync-schema": "4" })).body
      expect(pushed?.results?.[0]?.status).toBe("ok") // observe: accepted, recorded as a claim
      const [eProof, eLegacy] = [await cloudEvidence(queue().find((o) => o.payload?.id === proof.id)!.id), await cloudEvidence(legacyOp)]
      evidence("observe forwarded", { proof: eProof && { attestation: eProof.attestation, relayed: { deviceCheck: (eProof.relayed as any)?.deviceCheck, sessionCheck: (eProof.relayed as any)?.sessionCheck } }, legacy: eLegacy && { attestation: eLegacy.attestation, evidence: (eLegacy.relayed as any)?.evidence } })
      expect([eProof?.attestation, (eProof?.relayed as any)?.sessionCheck, eLegacy?.attestation, (eLegacy?.relayed as any)?.deviceCheck]).toEqual(["valid", "valid", "valid", "absent"])
      const gate = async () => (await call(CLOUD!, "GET", "/api/sync/identity-gate", undefined, cloudOwner)).body
      const before = await gate()
      evidence("gate before", before.enforceBlockers)
      expect((before.enforceBlockers as any[]).map((b) => [b.id, b.reason])).toEqual([[legacyId, "hub-register-unverified"]])
      expect((await call(CLOUD!, "POST", "/api/sync/identity-mode", { mode: "enforce", note: "pilot" }, cloudOwner)).body?.code).toBe("IDENTITY_GATE")
      // the hub cannot issue the store's policy
      expect((await call(HUB!, "POST", "/api/sync/identity-mode", { mode: "enforce", note: "pilot" }, ownerPerson)).body?.code).toBe("HUB_SERVER")
      expect((await call(CLOUD!, "POST", `/api/sync/hub-registers/${legacyId}/retire`, { note: "old till replaced for the pilot" }, cloudOwner)).status).toBe(200)
      expect((await gate()).enforceBlockers).toEqual([])
      const on = await call(CLOUD!, "POST", "/api/sync/identity-mode", { mode: "enforce", note: "controlled café pilot (disposable store)" }, cloudOwner)
      evidence("enforce issued", { status: on.status, body: on.body })
      expect(on.status).toBe(200)
      const issued = await prisma.tenant.findUnique({ where: { id: A.tenantId }, select: { staffSessionMode: true, staffPolicyVersion: true } })
      expect(issued.staffSessionMode).toBe("enforce")
      const adopted = await waitFor(async () => { const p = await hubPolicy(ownerPerson); return p.mode === "enforce" && p.version === issued.staffPolicyVersion ? p : null }, 90_000)
      evidence("hub adopted", adopted)
      expect(adopted).toEqual({ mode: "enforce", version: issued.staffPolicyVersion })
      keep("version", String(issued.staffPolicyVersion))
    })
  })

  if (PHASE === "enforce-roles") describe("role workflows through the enforcing hub", { timeout: 400_000 }, () => {
    it("Rana on the owner's connection: café order with Maya's approval, receipt, refund, void and payout on approval — Rana's at hub and cloud, never the owner's", async () => {
      expect(await hubPolicy(ownerPerson)).toMatchObject({ mode: "enforce" })
      // the connection alone carries nothing: the owner's register account without a session
      d.security.lockSession(); await dispose()
      const bare = await rawPush([{ id: randomUUID(), entity: "cash-movement", action: "create", payload: { id: randomUUID(), type: "OwnerDraw", amountUsd: 1, reason: "no session", createdAt: new Date().toISOString() } }], ownerTransport)
      evidence("owner connection, no session", bare?.results?.[0])
      expect(bare?.results?.[0]?.status).not.toBe("ok")
      await signIn("1504", A.staff.rana)
      const milk0 = await cloudStock(A.milkSyncId)
      const order = cafeOrder(1)
      expect((await ask("sale", "create", order, "sales.discount")).ok).toBe(true)
      expect(checkout(order).status).toBe("completed")
      const routine = cafeOrder(0)
      expect(checkout(routine).status).toBe("completed")
      await flush()
      for (const s of [order, routine]) expect([opFor("sale", s.id)?.status, errOf(opFor("sale", s.id))]).toEqual(["Synced", ""])
      expect(d.sales.getSales().find((s: any) => s.id === order.id)?.items).toHaveLength(2) // receipt / reprint
      const lineKey = d.sales.refundLineKeyOf(d.sales.getSales().find((s: any) => s.id === order.id).items[0])
      const refundId = randomUUID()
      expect(() => d.sales.processRefund({ saleId: order.id, quantities: { [lineKey]: 1 }, reason: "spilled", id: refundId })).toThrow(/permission/i)
      expect((await ask("refund", "create", d.sales.refundApprovalPayload({ saleId: order.id, quantities: { [lineKey]: 1 }, reason: "spilled", id: refundId }), "sales.refund")).ok).toBe(true)
      d.sales.processRefund({ saleId: order.id, quantities: { [lineKey]: 1 }, reason: "spilled", id: refundId })
      expect((await ask("sale", "void", d.sales.voidApprovalPayload(d.sales.getSales().find((s: any) => s.id === routine.id)), "sales.void")).ok).toBe(true)
      d.sales.voidSale(routine.id)
      const payout = { id: randomUUID(), type: "OwnerDraw", amountUsd: 2, reason: "Owner draw", note: "" }
      expect(d.cash.createCashMovement(payout)).toBeNull()
      expect((await ask("cash-movement", "create", d.cash.cashMovementApprovalPayload(payout), "cash.manage")).ok).toBe(true)
      expect(d.cash.createCashMovement(payout)).toBeTruthy()
      await flush()
      const ops = { order: opFor("sale", order.id)!, refund: opFor("refund", refundId)!, void: queue().find((o) => o.entity === "sale" && o.action === "void" && o.payload?.id === routine.id)!, payout: opFor("cash-movement", payout.id)! }
      expect(Object.values(ops).map((o) => o.status)).toEqual(["Synced", "Synced", "Synced", "Synced"])
      const seen: Record<string, unknown> = {}
      for (const [name, op] of Object.entries(ops)) {
        const e = await cloudEvidence(op.id)
        const r = (e?.relayed ?? {}) as any
        seen[name] = e && { attestation: e.attestation, session: r.sessionStaffId, connection: r.connectionAccountId, approver: (e.approval as any)?.approverId ?? (r.approval as any)?.approverId ?? null }
        expect([e?.attestation, r.sessionStaffId, r.connectionAccountId]).toEqual(["valid", A.staff.rana, A.staff.owner])
        expect((e?.approval as any)?.approverId).toBe(A.staff.manager)
      }
      evidence("rana via owner connection", seen)
      const sold = await waitFor(() => prisma.sale.findFirst({ where: { tenantId: A.tenantId, id: order.id }, select: { cashierId: true, total: true, discountTotal: true } }))
      expect([sold?.cashierId, Number(sold?.total), Number(sold?.discountTotal)]).toEqual([A.staff.rana, 6, 1])
      expect((await waitFor(() => prisma.sale.findFirst({ where: { tenantId: A.tenantId, id: routine.id, status: "Voided" } })))).toBeTruthy()
      const refund = await waitFor(() => prisma.saleRefund.findFirst({ where: { tenantId: A.tenantId, id: refundId }, select: { total: true } }))
      expect(Number(refund?.total)).toBeCloseTo(1.29, 2) // 1 of 2 Milk at 1.50, of a $6 sale grossing $7
      expect(await waitFor(() => prisma.cashMovement.findFirst({ where: { tenantId: A.tenantId, id: payout.id }, select: { recordedById: true } }))).toMatchObject({ recordedById: A.staff.rana })
      const milk1 = await cloudStock(A.milkSyncId)
      evidence("milk stock at the cloud", { before: milk0, after: milk1 })
      expect(milk1).toBe(milk0 - 4 + 1 + 2) // sold 2+2, refunded 1, void restored 2; the latte is made to order
      keep("order", order.id)
    })

    it("lost response: the same sale resent is applied once; Rana cannot receive, record an expense or close — held, nothing applied", async () => {
      const op = opFor("sale", kept("order"))!
      const again = await rawPush([{ id: op.id, entity: op.entity, action: op.action, payload: op.payload }], ownerTransport, staffSession()?.session)
      expect(again?.results?.[0]?.status).toBe("ok")
      expect(await prisma.sale.count({ where: { tenantId: A.tenantId, id: kept("order") } })).toBe(1)
      const m = local(A.milkSyncId)
      const lot = randomUUID()
      d.batches.receiveInventoryBatches([{ id: lot, productId: m.id, productSyncId: m.syncId, productName: m.name, barcode: m.barcode ?? "", quantity: 10, unitCost: 1, unitPrice: 1.5 }])
      expect(() => d.expense.createExpense({ vendor: "Market", category: "Supplies", amount: 3, paymentMethod: "Cash", invoiceNumber: "", note: "" } as any)).toThrow(/Accounting/)
      const close = d.close.closeBusinessDay({ dateKey: "2099-06-01", grossSales: 14, refunds: 1.29, netSales: 12.71, expenses: 0, cashIn: 0, cashOut: 2, note: "Rana's close", unsyncedCountAtClose: 0, saleIds: [], refundIds: [] } as any)
      await flush()
      const receive = queue().find((o) => o.entity === "inventory" && o.action === "receive" && JSON.stringify(o.payload).includes(lot))
      const closeOp = opFor("daily-close", close.id)
      evidence("rana held", { receive: [receive?.status, errOf(receive)], close: [closeOp?.status, errOf(closeOp)] })
      expect(errOf(receive)).toMatch(/permission/i)
      expect(closeOp?.status).not.toBe("Synced")
      const held = ((await call(HUB!, "GET", "/api/sync/refused", undefined, ownerPerson)).body.operations as any[]).map((o) => o.id)
      expect(held).toEqual(expect.arrayContaining([receive!.id, closeOp!.id]))
      expect(await prisma.inventoryBatch.count({ where: { tenantId: A.tenantId, id: lot } })).toBe(0)
      keep("ranaClose", close.id)
    })

    it("Maya after a staff switch: discount, receiving, expense and close as Maya; she reviews Rana's held close as herself, once", async () => {
      await signIn("1502", A.staff.manager)
      const milk0 = await cloudStock(A.milkSyncId)
      const order = cafeOrder(2)
      expect(checkout(order).status).toBe("completed")
      const m = local(A.milkSyncId)
      const lot = randomUUID()
      d.batches.receiveInventoryBatches([{ id: lot, productId: m.id, productSyncId: m.syncId, productName: m.name, barcode: m.barcode ?? "", quantity: 10, unitCost: 1, unitPrice: 1.5 }])
      const expense = d.expense.createExpense({ vendor: "Market", category: "Supplies", amount: 3, paymentMethod: "Cash", invoiceNumber: "INV-EN", note: "" } as any)
      const close = d.close.closeBusinessDay({ dateKey: "2099-06-02", grossSales: 7, refunds: 0, netSales: 5, expenses: 3, cashIn: 5, cashOut: 3, note: "Maya's close", unsyncedCountAtClose: 0, saleIds: [order.id], refundIds: [] } as any)
      await flush()
      expect([opFor("sale", order.id)?.status, opFor("expense", expense.id)?.status, opFor("daily-close", close.id)?.status]).toEqual(["Synced", "Synced", "Synced"])
      expect(await waitFor(() => prisma.sale.findFirst({ where: { tenantId: A.tenantId, id: order.id }, select: { cashierId: true } }))).toMatchObject({ cashierId: A.staff.manager })
      expect(await waitFor(() => prisma.inventoryBatch.findFirst({ where: { tenantId: A.tenantId, id: lot } }))).toBeTruthy()
      expect(await waitFor(() => prisma.expense.findFirst({ where: { tenantId: A.tenantId, id: expense.id } }))).toBeTruthy()
      expect(await waitFor(() => prisma.dailyClose.findFirst({ where: { tenantId: A.tenantId, id: close.id }, select: { closedBy: true } }))).toMatchObject({ closedBy: "Manager Maya" })
      await waitFor(async () => (await cloudStock(A.milkSyncId)) === milk0 - 2 + 10)
      expect(await cloudStock(A.milkSyncId)).toBe(milk0 - 2 + 10)
      // review with her own sign-in (a person token), on the hub
      const maya = await login(HUB!, "1502", "person")
      const item = ((await call(HUB!, "GET", "/api/sync/refused", undefined, maya)).body.operations as any[]).find((o) => o.payload?.id === kept("ranaClose"))
      expect(item?.evidence?.sessionStaff?.id).toBe(A.staff.rana)
      const body = { decision: "apply", note: "Rana's count was right; applied on review", previewToken: item.previewToken }
      const [a, b] = await Promise.all([call(HUB!, "POST", `/api/sync/refused/${item.id}/resolve`, body, maya), call(HUB!, "POST", `/api/sync/refused/${item.id}/resolve`, body, maya)])
      expect([a.status, b.status].sort()).toEqual([200, 409])
      const decided = ((await call(HUB!, "GET", "/api/sync/refused/decisions", undefined, maya)).body.decisions as any[]).find((x) => x.opId === item.id)
      evidence("review decision", decided && { actor: decided.actor?.session?.id, reviewer: decided.reviewer?.id })
      expect([decided?.actor?.session?.id, decided?.reviewer?.id]).toEqual([A.staff.rana, A.staff.manager])
      const atCloud = await cloudEvidence(item.id)
      evidence("reviewed close at the cloud", atCloud && { attestation: atCloud.attestation, evidence: atCloud.evidence, limitations: atCloud.limitations })
      expect(await waitFor(() => prisma.dailyClose.findFirst({ where: { tenantId: A.tenantId, id: kept("ranaClose") } }))).toBeTruthy()
    })

    it("Rana on her own connection: naming the owner gets her nothing; Noor (no checkout) cannot sell", async () => {
      storage.setItem("lebanonpos.auth-token", await login(HUB!, "1504", "register"))
      await signIn("1504", A.staff.rana)
      const named = { ...cafeOrder(0), cashier: "Owner", cashierId: A.staff.owner }
      const opId = randomUUID()
      const r = await rawPush([{ id: opId, entity: "sale", action: "create", payload: named }], storage.getItem("lebanonpos.auth-token")!, staffSession()!.session)
      expect(r?.results?.[0]?.status).toBe("ok")
      const s = await waitFor(() => prisma.sale.findFirst({ where: { tenantId: A.tenantId, id: named.id }, select: { cashierId: true } }))
      const e = await cloudEvidence(opId)
      evidence("S4 enforced via hub", { cashierAtCloud: s?.cashierId, relayed: e && { session: (e.relayed as any)?.sessionStaffId, claimed: (e.relayed as any)?.actorIdClaimed } })
      expect(s?.cashierId).toBe(A.staff.rana)
      const discounted = await rawPush([{ id: randomUUID(), entity: "sale", action: "create", payload: { ...cafeOrder(1), cashier: "Owner", cashierId: A.staff.owner } }], storage.getItem("lebanonpos.auth-token")!, staffSession()!.session)
      expect(String(discounted?.results?.[0]?.error)).toMatch(/discount|permission/i)
      await signIn("1506", A.staff.noor)
      const noor = await rawPush([{ id: randomUUID(), entity: "sale", action: "create", payload: { ...cafeOrder(0), cashier: "Noor", cashierId: A.staff.noor } }], storage.getItem("lebanonpos.auth-token")!, staffSession()!.session)
      evidence("noor", noor?.results?.[0])
      expect(String(noor?.results?.[0]?.error)).toMatch(/Noor.*not allowed to sell/i)
      storage.setItem("lebanonpos.auth-token", ownerTransport)
    })

    it("the hub's own screen: its local sign-in carries nothing until the screen is enrolled and a person signs in", async () => {
      const local_ = (await call(HUB!, "POST", "/api/setup/auto-login", {})).body?.token as string
      expect(local_).toBeTruthy()
      const draw = () => ({ id: randomUUID(), entity: "cash-movement", action: "create", payload: { id: randomUUID(), type: "OwnerDraw", amountUsd: 1, reason: "hub screen", createdAt: new Date().toISOString() } })
      const bare = (await call(HUB!, "POST", "/api/sync/push", { deviceId: "hub-screen", operations: [draw()] }, local_, { "x-titan-sync-schema": "5" })).body?.results?.[0]
      const rest = await call(HUB!, "GET", "/api/sync/refused", undefined, local_)
      evidence("hub screen unenrolled", { push: bare, rest: rest.status })
      expect(bare?.status).not.toBe("ok")
      expect(rest.status).toBe(403)
      const code = (await call(HUB!, "POST", "/api/device/generate-code", {}, ownerPerson)).body.code
      const screen = (await call(HUB!, "POST", "/api/device/pair", { code, deviceId: "hub-screen", deviceName: "Hub screen" })).body as { credential: string }
      const sess = (await call(HUB!, "POST", "/api/auth/staff-session", { pin: "1502" }, undefined, { "x-device-credential": screen.credential })).body.session as string
      const asMaya = { "x-device-credential": screen.credential, "x-staff-session": sess, "x-titan-sync-schema": "5" }
      expect((await call(HUB!, "GET", "/api/sync/refused", undefined, local_, asMaya)).status).toBe(200)
      const op = draw()
      const ok = (await call(HUB!, "POST", "/api/sync/push", { deviceId: "hub-screen", operations: [{ ...op, ev: { v: 1, session: sess } }] }, local_, asMaya)).body?.results?.[0]
      expect(ok?.status).toBe("ok")
      expect(await waitFor(() => prisma.cashMovement.findFirst({ where: { tenantId: A.tenantId, id: op.payload.id }, select: { recordedById: true } }))).toMatchObject({ recordedById: A.staff.manager })
      // Rana's session on the hub screen: Maya's authority is not kept
      const rana = (await call(HUB!, "POST", "/api/auth/staff-session", { pin: "1504" }, undefined, { "x-device-credential": screen.credential })).body.session as string
      expect((await call(HUB!, "GET", "/api/sync/refused", undefined, local_, { ...asMaya, "x-staff-session": rana })).status).toBe(403)
    })

    it("a session ended elsewhere and a revoked register: refused at the boundary, the work kept on the till and held at the hub", async () => {
      await signIn("1502", A.staff.manager)
      const ended = staffSession()!.session
      expect((await call(HUB!, "POST", "/api/auth/staff-session/end", { session: ended }, undefined, { "x-device-credential": credential()! })).body?.ended).toBe(true)
      const late = await rawPush([{ id: randomUUID(), entity: "cash-movement", action: "create", payload: { id: randomUUID(), type: "OwnerDraw", amountUsd: 1, reason: "after sign-out", createdAt: new Date().toISOString() } }], ownerTransport, ended)
      evidence("ended session", late?.results?.[0])
      expect(late?.results?.[0]?.status).not.toBe("ok")
      await signIn("1502", A.staff.manager)
      expect((await call(HUB!, "POST", "/api/device/revoke", { deviceId }, ownerPerson)).status).toBe(200)
      const sale = cafeOrder(0)
      expect(checkout(sale).status).toBe("completed")
      await flush()
      const op = opFor("sale", sale.id)
      evidence("revoked register", { status: op?.status, error: errOf(op) })
      expect(op).toBeTruthy() // kept on the till, never dropped
      expect(op?.status).not.toBe("Synced")
      expect(await prisma.sale.count({ where: { tenantId: A.tenantId, id: sale.id } })).toBe(0)
      // re-enrolled by the owner for the next phases
      const code = (await call(HUB!, "POST", "/api/device/generate-code", {}, ownerPerson)).body.code
      expect((await d.devices.pairDevice(code, deviceId, "Enforce IT (re-enrolled)")).ok).toBe(true)
      await signIn("1504", A.staff.rana)
    })

    it("storage interruption on the till: a checkout that cannot be recorded is not reported as completed", async () => {
      const sale = cafeOrder(0)
      storage.failOn = /sync-queue|sales/
      let status = "threw"
      try { status = checkout(sale).status } catch { /* the register reports the failure */ }
      storage.failOn = null
      const queued = !!opFor("sale", sale.id)
      evidence("storage interruption", { status, queued })
      expect(status === "completed" ? queued : true).toBe(true)
    })
  })

  if (PHASE === "enforce-outage") describe("cloud unreachable (LAN only)", { timeout: 300_000 }, () => {
    it("the hub keeps enforcing; a session sale and an approved payout apply at the hub and wait for the cloud; no session is refused", async () => {
      expect(await hubPolicy(ownerPerson)).toMatchObject({ mode: "enforce", version: Number(kept("version")) })
      await signIn("1504", A.staff.rana)
      const sale = cafeOrder(0)
      expect(checkout(sale).status).toBe("completed")
      const payout = { id: randomUUID(), type: "OwnerDraw", amountUsd: 1, reason: "Owner draw", note: "LAN only" }
      expect((await ask("cash-movement", "create", d.cash.cashMovementApprovalPayload(payout), "cash.manage")).ok).toBe(true)
      expect(d.cash.createCashMovement(payout)).toBeTruthy()
      await flush()
      expect([opFor("sale", sale.id)?.status, opFor("cash-movement", payout.id)?.status]).toEqual(["Synced", "Synced"])
      const bare = await rawPush([{ id: randomUUID(), entity: "cash-movement", action: "create", payload: { id: randomUUID(), type: "OwnerDraw", amountUsd: 1, reason: "no session", createdAt: new Date().toISOString() } }], ownerTransport)
      expect(bare?.results?.[0]?.status).not.toBe("ok")
      expect(await prisma.sale.count({ where: { tenantId: A.tenantId, id: sale.id } })).toBe(0)
      keep("lanSale", sale.id); keep("lanSaleOp", opFor("sale", sale.id)!.id); keep("lanPayout", payout.id); keep("lanPayoutOp", opFor("cash-movement", payout.id)!.id)
    })
  })

  if (PHASE === "enforce-restart") describe("hub restarted, cloud still unreachable", { timeout: 200_000 }, () => {
    it("the hub still enforces the adopted version (a restart does not lower it)", async () => {
      expect(await hubPolicy(ownerPerson)).toEqual({ mode: "enforce", version: Number(kept("version")) })
      const bare = await rawPush([{ id: randomUUID(), entity: "cash-movement", action: "create", payload: { id: randomUUID(), type: "OwnerDraw", amountUsd: 1, reason: "after restart", createdAt: new Date().toISOString() } }], ownerTransport)
      evidence("after restart, no session", bare?.results?.[0])
      expect(bare?.results?.[0]?.status).not.toBe("ok")
    })
  })

  if (PHASE === "enforce-resume") describe("cloud back", { timeout: 300_000 }, () => {
    it("the LAN-only sale and payout reached the cloud once, signed, as Rana with Maya's approval", async () => {
      const e1 = await cloudEvidence(kept("lanSaleOp")), e2 = await cloudEvidence(kept("lanPayoutOp"))
      evidence("resumed", { sale: e1 && { attestation: e1.attestation, session: (e1.relayed as any)?.sessionStaffId }, payout: e2 && { attestation: e2.attestation, session: (e2.relayed as any)?.sessionStaffId, approver: (e2.approval as any)?.approverId } })
      expect([e1?.attestation, (e1?.relayed as any)?.sessionStaffId, e2?.attestation, (e2?.relayed as any)?.sessionStaffId, (e2?.approval as any)?.approverId]).toEqual(["valid", A.staff.rana, "valid", A.staff.rana, A.staff.manager])
      expect(await prisma.sale.count({ where: { tenantId: A.tenantId, id: kept("lanSale") } })).toBe(1)
      expect(await prisma.cashMovement.count({ where: { tenantId: A.tenantId, id: kept("lanPayout") } })).toBe(1)
    })
  })

  if (PHASE === "enforce-oldtill") describe("a till on the released 1.0.51 (HUB_TILL_SRC)", { timeout: 240_000 }, () => {
    it("is refused at the boundary; its sale stays on the till and is held at the hub for review", async () => {
      expect((await d.security.unlockWithPin("1504"))?.id).toBe(A.staff.rana); await dispose()
      const m = local(A.milkSyncId)
      const id = randomUUID()
      const sale = d.sales.buildSale({ saleNumber: `S-OLD-${id.slice(0, 6)}`, paymentMethod: "Cash", subtotal: 1.5, tax: 0, total: 1.5, items: [{ id: m.id, productSyncId: m.syncId, name: m.name, barcode: m.barcode ?? "", quantity: 1, unitPrice: 1.5, total: 1.5, batchAllocations: [] }] }, id)
      expect(d.sales.checkoutLocalSale({ sale, lots: [{ productId: m.id, productName: m.name, barcode: m.barcode ?? "", quantity: 1, fallbackUnitCost: 0 }], stock: [{ productId: m.id, quantity: 1 }] }).status).toBe("completed")
      await flush()
      const op = opFor("sale", id)
      const held = ((await call(HUB!, "GET", "/api/sync/refused", undefined, ownerPerson)).body.operations as any[]).find((o) => o.payload?.id === id)
      evidence("1.0.51 till", { status: op?.status, error: errOf(op), held: held && { category: held.category, reason: held.reason } })
      expect(op).toBeTruthy()
      expect(op?.status).not.toBe("Synced")
      expect(held).toBeTruthy()
      expect(await prisma.sale.count({ where: { tenantId: A.tenantId, id } })).toBe(0)
    })
  })

  if (PHASE === "enforce-direct") describe("a register connected straight to the cloud", { timeout: 240_000 }, () => {
    it("Rana on the owner's connection: approved discount applies as Rana; an unapproved payout is held", async () => {
      await signIn("1504", A.staff.rana)
      const order = cafeOrder(1)
      expect((await ask("sale", "create", order, "sales.discount")).ok).toBe(true)
      expect(checkout(order).status).toBe("completed")
      const opId = randomUUID()
      const payload = { id: randomUUID(), type: "OwnerDraw", amountUsd: 1, reason: "unapproved", createdAt: new Date().toISOString() }
      await flush()
      const draw = await rawPush([{ id: opId, entity: "cash-movement", action: "create", payload }], ownerTransport, staffSession()!.session)
      const e = await cloudEvidence(opFor("sale", order.id)!.id)
      evidence("direct", { sale: [opFor("sale", order.id)?.status, e?.sessionStaffId, e?.connectionAccountId, (e?.approval as any)?.approverId], payout: draw?.results?.[0] })
      expect([e?.sessionStaffId, e?.connectionAccountId, (e?.approval as any)?.approverId]).toEqual([A.staff.rana, A.staff.owner, A.staff.manager])
      expect((await prisma.sale.findFirst({ where: { tenantId: A.tenantId, id: order.id }, select: { cashierId: true } }))?.cashierId).toBe(A.staff.rana)
      expect(String(draw?.results?.[0]?.error)).toMatch(/permission/i)
      expect(await prisma.syncOperation.findUnique({ where: { id: opId }, select: { status: true } })).toMatchObject({ status: "Refused" })
    })
  })

  if (PHASE === "enforce-lower") describe("lowering to observe", { timeout: 200_000 }, () => {
    it("is an explicit newer decision at the cloud; the hub adopts it; the owner connection is then recorded as a claim again", async () => {
      const off = await call(CLOUD!, "POST", "/api/sync/identity-mode", { mode: "observe", note: "pilot finished" }, cloudOwner)
      expect(off.status).toBe(200)
      const v = (await prisma.tenant.findUnique({ where: { id: A.tenantId }, select: { staffPolicyVersion: true } })).staffPolicyVersion
      expect(v).toBe(Number(kept("version")) + 1)
      expect(await waitFor(async () => { const p = await hubPolicy(ownerPerson); return p.mode === "observe" && p.version === v ? p : null }, 90_000)).toEqual({ mode: "observe", version: v })
      d.security.lockSession(); await dispose()
      const r = await rawPush([{ id: randomUUID(), entity: "cash-movement", action: "create", payload: { id: randomUUID(), type: "OwnerDraw", amountUsd: 1, reason: "observe again", createdAt: new Date().toISOString() } }], ownerTransport)
      expect(r?.results?.[0]?.status).toBe("ok")
    })
  })
}
