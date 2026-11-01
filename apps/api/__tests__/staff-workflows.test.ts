import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomUUID } from "node:crypto"
import { pathToFileURL } from "node:url"
import path from "node:path"

// SPRINT-2 hub batch: complete staff workflows in a store that ENFORCES staff identity, through the
// register's own services (apps/desktop/src) against the real API and a scratch database. Roles:
//  - a cashier on a register connected with the OWNER's account (transport), then with her OWN account;
//  - a manager on the same register after a staff switch;
//  - staff without the checkout permission.
// Each step asserts what the server authorized and as whom (the sale's cashier, the refund, the stock,
// the money), not only the evidence labels.
process.env.JWT_SECRET = process.env.JWT_SECRET || "staff-workflows-secret"
const SRC = path.resolve(__dirname, "../../desktop/src").replace(/\\/g, "/")

class MemoryStorage {
  m = new Map<string, string>()
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
async function dispose() {
  for (const id of timers) clearTimeout(id)
  timers.clear()
  for (let i = 0; i < 20 && (inflight.size > 0 || i < 3); i++) { await Promise.allSettled([...inflight]); await new Promise((r) => setImmediate(r)) }
}
const mod = (name: string) => import(/* @vite-ignore */ pathToFileURL(`${SRC}/features/pos/${name}.ts`).href)
const device = async () => ({
  sync: await mod("services/sync.service"), security: await mod("services/security.service"), sales: await mod("services/sales.service"),
  approval: await mod("services/approval.service"), cash: await mod("services/cashMovement.service"), devices: await mod("services/deviceRegistry.service"),
  batches: await mod("services/inventoryBatch.service"), expense: await mod("services/expense.service"), close: await mod("services/dailyClose.service"),
})
let d: Awaited<ReturnType<typeof device>>
const queue = () => JSON.parse(storage.getItem("lebanonpos.sync-queue.v1") ?? "[]") as Array<Record<string, any>>
const flush = async () => {
  for (let i = 0; i < 3; i++) {
    storage.setItem("lebanonpos.sync-queue.v1", JSON.stringify(queue().map((op) => ({ ...op, status: op.status === "Failed" ? "Pending" : op.status, lastAttemptAt: "2000-01-01T00:00:00.000Z" }))))
    await d.sync.flushSyncQueue()
    await dispose() // an automatic flush already in flight finishes before the next explicit one
  }
}

let prisma: typeof import("../src/lib/prisma.js").default
let server: http.Server
let baseUrl = ""
const T = randomUUID(), SUB = `sw-${T.slice(0, 8)}`
const OWNER = randomUUID(), MAYA = randomUUID(), RANA = randomUUID(), NOOR = randomUUID()
const PIN = { owner: "8701", maya: "8702", rana: "8703", noor: "8704" }
let tea = { id: 0, syncId: "" }, latte = { id: 0, syncId: "" }
const login = async (pin: string, client: "register" | "person") => ((await (await realFetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin, tenantSubdomain: SUB, client }) })).json()) as any).token as string
const local = (syncId: string) => (JSON.parse(storage.getItem("lebanonpos.products.v1") ?? "[]") as any[]).find((p) => p.syncId === syncId)
const serverStock = async (syncId = tea.syncId) => Number((await prisma.product.findFirst({ where: { tenantId: T, syncId } }))!.stock)
const opFor = (entity: string, id: string) => queue().find((o) => o.entity === entity && o.payload?.id === id)
const evidenceOf = (entity: string, id: string) => prisma.operationEvidence.findUnique({ where: { opId: opFor(entity, id)!.id } })
const ask = (entity: string, action: string, payload: any, permission: string, pin = PIN.maya) => d.approval.requestManagerApproval({ entity, action, payload, permission, permissions: [permission], pin })

/** The register connects with `transportPin`'s account; then `pin` signs in (server PIN check). */
async function signIn(pin: string, staffId: string) {
  d.security.lockSession(); await dispose()
  expect((await d.security.unlockWithPin(pin))?.id).toBe(staffId); await dispose()
  if (!d.security.getActiveShift()) expect(d.security.openShift(20)).toBeTruthy()
}
async function connect(transportPin: string, deviceId: string) {
  storage.clear()
  storage.setItem("lebanonpos.api-url", baseUrl)
  storage.setItem("lebanonpos.store-subdomain.v1", SUB)
  storage.setItem("lebanonpos.tenant-id.v1", T)
  storage.setItem("lebanonpos.device-id.v1", deviceId)
  storage.setItem("lebanonpos.users.v1", "[]")
  vi.resetModules(); d = await device()
  const code = ((await (await realFetch(`${baseUrl}/api/device/generate-code`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await login(PIN.owner, "person")}` }, body: "{}" })).json()) as any).code
  storage.setItem("lebanonpos.auth-token", await login(transportPin, "register"))
  expect((await d.devices.pairDevice(code, deviceId, deviceId)).ok).toBe(true)
  await d.sync.pullFromServer(true); await dispose()
}
/** A mixed café order: 2 Tea (tracked) + 1 Latte (made to order), with an optional discount. */
function cafeOrder(discount = 0) {
  const t = local(tea.syncId), l = local(latte.syncId)
  const id = randomUUID()
  return d.sales.buildSale({ saleNumber: `S-SW-${id.slice(0, 6)}`, paymentMethod: "Cash", subtotal: 14 - discount, discountTotal: discount, tax: 0, total: 14 - discount,
    items: [
      { id: t.id, productSyncId: t.syncId, name: t.name, barcode: t.barcode ?? "", quantity: 2, unitPrice: 5, total: 10, batchAllocations: [], stockPolicy: "tracked" },
      { id: l.id, productSyncId: l.syncId, name: l.name, barcode: l.barcode ?? "", quantity: 1, unitPrice: 4, total: 4, batchAllocations: [], stockPolicy: "untracked" },
    ] }, id)
}
const checkout = (sale: any) => {
  const t = local(tea.syncId)
  return d.sales.checkoutLocalSale({ sale, lots: [{ productId: t.id, productName: t.name, barcode: t.barcode ?? "", quantity: 2, fallbackUnitCost: 0 }], stock: [{ productId: t.id, quantity: 2 }] })
}

beforeAll(async () => {
  vi.setConfig({ testTimeout: 120_000 })
  prisma = (await import("../src/lib/prisma.js")).default
  const bcrypt = (await import("bcryptjs")).default
  const app = (await import("../src/app.js")).default
  process.env.IS_LOCAL_SERVER = "false"
  server = http.createServer(app)
  await new Promise<void>((r) => server.listen(0, r))
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`
  await prisma.tenant.create({ data: { id: T, name: "Staff workflows IT (disposable)", subdomain: SUB } })
  for (const [id, name, role, pin, perms] of [[OWNER, "Owner", "Admin", PIN.owner, null], [MAYA, "Maya", "Manager", PIN.maya, null], [RANA, "Rana", "Cashier", PIN.rana, null], [NOOR, "Noor", "Cashier", PIN.noor, ["inventory.view"]]] as const)
    await prisma.staffUser.create({ data: { id, tenantId: T, name, mobile: `sw-${id.slice(0, 8)}`, pin: await bcrypt.hash(pin, 12), role, ...(perms ? { permissions: [...perms] } : {}) } as any })
  const t = await prisma.product.create({ data: { tenantId: T, syncId: randomUUID(), name: "Tea", price: 5, cost: 2, stock: 40, barcode: `sw-t-${T.slice(0, 6)}`, category: "Drinks" } })
  const l = await prisma.product.create({ data: { tenantId: T, syncId: randomUUID(), name: "Latte", price: 4, cost: 1, stock: 0, barcode: `sw-l-${T.slice(0, 6)}`, category: "Drinks", stockPolicy: "untracked" } as any })
  tea = { id: t.id, syncId: t.syncId! }; latte = { id: l.id, syncId: l.syncId! }
  // the pilot store enforces (the activation gate is exercised in staff-enforce.test.ts)
  const { issuePolicy } = await import("../src/lib/staffPolicy.js")
  await issuePolicy(T, "enforce", OWNER, (await prisma.tenant.findUnique({ where: { id: T } }))!.staffPolicyVersion)
})

afterAll(async () => {
  await dispose()
  for (const m of ["reviewResolution", "managerApproval", "operationEvidence", "staffSession", "syncOperation", "syncClient", "auditEvent", "dailyClose", "expense", "cashMovement", "inventoryBatch", "stockMovement", "saleItem", "sale", "pairingCode", "device", "shift", "product", "staffUser"] as const)
    await (prisma as any)[m]?.deleteMany({ where: { tenantId: T } }).catch(() => undefined)
  await (prisma as any).refundItem.deleteMany({ where: { refund: { tenantId: T } } }).catch(() => undefined)
  await prisma.saleRefund.deleteMany({ where: { tenantId: T } }).catch(() => undefined)
  await prisma.tenant.deleteMany({ where: { id: T } })
  await new Promise<void>((r) => server.close(() => r()))
})

describe("a cashier on a register connected with the OWNER's account", { timeout: 120_000 }, () => {
  it("shift, mixed café order with a manager-approved discount, receipt, refund and void on approval, payout on approval: all Rana's, never the owner's", async () => {
    await connect(PIN.owner, "sw-front")
    await signIn(PIN.rana, RANA)
    const tea0 = await serverStock()
    // discounted order: Rana lacks sales.discount; Maya approves this sale
    const order = cafeOrder(1)
    expect((await ask("sale", "create", order, "sales.discount")).ok).toBe(true)
    expect(checkout(order).status).toBe("completed")
    // a routine order without a discount (to void later)
    const routine = cafeOrder(0)
    expect(checkout(routine).status).toBe("completed")
    await flush()
    for (const s of [order, routine]) expect(opFor("sale", s.id)?.status).toBe("Synced")
    const sold = await prisma.sale.findFirst({ where: { tenantId: T, id: order.id }, select: { cashierId: true, cashier: true, total: true, discountTotal: true, items: { select: { productName: true, quantity: true } } } })
    expect([sold?.cashierId, sold?.cashier, Number(sold?.total), Number(sold?.discountTotal), sold?.items.length]).toEqual([RANA, "Rana", 13, 1, 2])
    expect(await serverStock()).toBe(tea0 - 4) // two orders of 2 Tea; the latte is made to order
    const e = (await evidenceOf("sale", order.id))!
    expect([e.evidence, e.sessionStaffId, e.connectionAccountId, (e.approval as any)?.approverId]).toEqual(["verified", RANA, OWNER, MAYA])
    // receipt: the register keeps the sale as sold (reprint)
    expect(d.sales.getSales().find((s: any) => s.id === order.id)?.items).toHaveLength(2)
    // refund one Tea on approval
    const lineKey = d.sales.refundLineKeyOf(d.sales.getSales().find((s: any) => s.id === order.id).items[0])
    const refundId = randomUUID()
    expect(() => d.sales.processRefund({ saleId: order.id, quantities: { [lineKey]: 1 }, reason: "spilled", id: refundId })).toThrow(/permission/i)
    expect((await ask("refund", "create", d.sales.refundApprovalPayload({ saleId: order.id, quantities: { [lineKey]: 1 }, reason: "spilled", id: refundId }), "sales.refund")).ok).toBe(true)
    d.sales.processRefund({ saleId: order.id, quantities: { [lineKey]: 1 }, reason: "spilled", id: refundId })
    // void the routine order on approval
    const routineSale = d.sales.getSales().find((s: any) => s.id === routine.id)
    expect((await ask("sale", "void", d.sales.voidApprovalPayload(routineSale), "sales.void")).ok).toBe(true)
    d.sales.voidSale(routine.id)
    // payout on approval
    const payout = { id: randomUUID(), type: "OwnerDraw", amountUsd: 6, reason: "Owner draw", note: "" }
    expect(d.cash.createCashMovement(payout)).toBeNull()
    expect((await ask("cash-movement", "create", d.cash.cashMovementApprovalPayload(payout), "cash.manage")).ok).toBe(true)
    expect(d.cash.createCashMovement(payout)).toBeTruthy()
    await flush()
    const refund = await prisma.saleRefund.findFirst({ where: { tenantId: T, id: refundId }, select: { total: true } })
    expect(Number(refund?.total)).toBeCloseTo(4.64, 2) // 1 of 2 Tea at 5, of a $13 sale grossing $14
    expect((await prisma.sale.findFirst({ where: { tenantId: T, id: routine.id }, select: { status: true } }))?.status).toBe("Voided")
    expect(await serverStock()).toBe(tea0 - 4 + 1 + 2) // refunded 1, void restored 2
    expect(await prisma.cashMovement.findFirst({ where: { tenantId: T, id: payout.id }, select: { recordedById: true, amountUsd: true } })).toMatchObject({ recordedById: RANA })
    for (const [entity, id] of [["refund", refundId], ["sale", routine.id], ["cash-movement", payout.id]] as const) {
      const ev = (await prisma.operationEvidence.findFirst({ where: { tenantId: T, entity, payload: undefined as any, opId: queue().find((o) => o.entity === entity && (o.payload?.id === id))?.id } }))!
      expect([ev.sessionStaffId, ev.connectionAccountId, (ev.approval as any)?.approverId]).toEqual([RANA, OWNER, MAYA])
    }
  })

  it("what Rana may not do even through the owner's connection: receive stock, record an expense, close the day — refused or held, nothing applied", async () => {
    const t = local(tea.syncId)
    const tea0 = await serverStock()
    const lot = randomUUID()
    d.batches.receiveInventoryBatches([{ id: lot, productId: t.id, productSyncId: t.syncId, productName: "Tea", barcode: t.barcode ?? "", quantity: 10, unitCost: 2, unitPrice: 5 }])
    expect(() => d.expense.createExpense({ vendor: "Market", category: "Supplies", amount: 3, paymentMethod: "Cash", invoiceNumber: "", note: "" } as any)).toThrow(/Accounting/)
    const close = d.close.closeBusinessDay({ dateKey: "2099-05-01", grossSales: 27, refunds: 4.64, netSales: 22.36, expenses: 0, cashIn: 0, cashOut: 6, note: "Rana's close", unsyncedCountAtClose: 0, saleIds: [], refundIds: [] } as any)
    await flush()
    expect(await prisma.inventoryBatch.count({ where: { tenantId: T, id: lot } })).toBe(0)
    expect(await serverStock()).toBe(tea0)
    expect(await prisma.dailyClose.count({ where: { tenantId: T, id: close.id } })).toBe(0)
    const receiveOp = queue().find((o) => o.entity === "inventory" && o.action === "receive")!
    expect((await prisma.syncOperation.findUnique({ where: { id: receiveOp.id } }))?.status).toBe("Refused")
    expect(String(receiveOp.lastError ?? receiveOp.error)).toMatch(/permission/i)
    storage.setItem("it.rana.close", close.id)
  })
})

describe("a manager on the same register after a staff switch; review", { timeout: 120_000 }, () => {
  it("Maya: discount without approval, receiving, expense, daily close — as Maya; she reviews Rana's held work as herself", async () => {
    await signIn(PIN.maya, MAYA)
    expect(d.security.getCurrentUser()?.id).toBe(MAYA)
    const tea0 = await serverStock()
    const order = cafeOrder(2)
    expect(checkout(order).status).toBe("completed")
    const t = local(tea.syncId)
    const lot = randomUUID()
    d.batches.receiveInventoryBatches([{ id: lot, productId: t.id, productSyncId: t.syncId, productName: "Tea", barcode: t.barcode ?? "", quantity: 10, unitCost: 2, unitPrice: 5 }])
    const expense = d.expense.createExpense({ vendor: "Market", category: "Supplies", amount: 3, paymentMethod: "Cash", invoiceNumber: "INV-1", note: "" } as any)
    const close = d.close.closeBusinessDay({ dateKey: "2099-05-02", grossSales: 12, refunds: 0, netSales: 12, expenses: 3, cashIn: 0, cashOut: 0, note: "Maya's close", unsyncedCountAtClose: 0, saleIds: [order.id], refundIds: [] } as any)
    await flush()
    expect((await prisma.sale.findFirst({ where: { tenantId: T, id: order.id }, select: { cashierId: true, discountTotal: true } }))).toMatchObject({ cashierId: MAYA })
    expect(await prisma.inventoryBatch.count({ where: { tenantId: T, id: lot } })).toBe(1)
    expect(await serverStock()).toBe(tea0 - 2 + 10)
    expect(await prisma.expense.count({ where: { tenantId: T, id: expense.id } })).toBe(1)
    expect(await prisma.dailyClose.findFirst({ where: { tenantId: T, id: close.id }, select: { closedBy: true } })).toMatchObject({ closedBy: "Maya" })
    // review: Maya (her own sign-in) declines Rana's held close; actor, reviewer kept apart
    const maya = await login(PIN.maya, "person")
    const list = (await (await realFetch(`${baseUrl}/api/sync/refused`, { headers: { Authorization: `Bearer ${maya}` } })).json()) as any
    const held = list.operations.find((o: any) => o.entity === "daily-close" && o.payload?.id === storage.getItem("it.rana.close"))
    expect(held?.evidence?.sessionStaff?.id).toBe(RANA)
    const r = await realFetch(`${baseUrl}/api/sync/refused/${held.id}/resolve`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${maya}` }, body: JSON.stringify({ decision: "dismiss", outcome: "nothing-to-correct", note: "Rana cannot close the day; Maya closed it", previewToken: held.previewToken }) })
    expect(r.status).toBe(200)
    const decided = ((await (await realFetch(`${baseUrl}/api/sync/refused/decisions`, { headers: { Authorization: `Bearer ${maya}` } })).json()) as any).decisions.find((x: any) => x.opId === held.id)
    expect([decided.actor.session.id, decided.reviewer.id]).toEqual([RANA, MAYA])
    // the same decision cannot be made twice
    const again = await realFetch(`${baseUrl}/api/sync/refused/${held.id}/resolve`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${maya}` }, body: JSON.stringify({ decision: "apply", note: "again", previewToken: held.previewToken }) })
    expect(again.status).toBe(409)
  })
})

describe("a cashier on her OWN connection; staff without checkout", { timeout: 120_000 }, () => {
  it("the connection does not change who acts: Rana's discount still needs Maya; Noor cannot sell", async () => {
    await connect(PIN.rana, "sw-back")
    await signIn(PIN.rana, RANA)
    const plain = cafeOrder(1) // no approval asked: the server refuses the discount, keeps the sale for review
    expect(checkout(plain).status).toBe("completed")
    const approved = cafeOrder(1)
    expect((await ask("sale", "create", approved, "sales.discount")).ok).toBe(true)
    expect(checkout(approved).status).toBe("completed")
    await flush()
    expect(await prisma.sale.count({ where: { tenantId: T, id: plain.id } })).toBe(0)
    expect(String(opFor("sale", plain.id)?.lastError ?? opFor("sale", plain.id)?.error)).toMatch(/discount|permission/i)
    expect((await prisma.sale.findFirst({ where: { tenantId: T, id: approved.id }, select: { cashierId: true } }))?.cashierId).toBe(RANA)
    const e = (await evidenceOf("sale", approved.id))!
    expect([e.sessionStaffId, e.connectionAccountId]).toEqual([RANA, RANA])
    // Noor (no sales.checkout) signs in on the same register: a sale made anyway is refused by the server
    d.security.lockSession(); await dispose()
    expect((await d.security.unlockWithPin(PIN.noor))?.id).toBe(NOOR); await dispose()
    // (the register itself would not let her ring it up; a modified one sends it with her session)
    const s = cafeOrder(0)
    const enrollment = JSON.parse(storage.getItem("lebanonpos.device-credential.v1")!)
    const noorSession = JSON.parse(storage.getItem("lebanonpos.staff-session.v1")!)
    expect(noorSession.staffId).toBe(NOOR)
    const pushed = await realFetch(`${baseUrl}/api/sync/push`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${storage.getItem("lebanonpos.auth-token")}`, "x-device-credential": enrollment.credential, "x-titan-sync-schema": "5" },
      body: JSON.stringify({ deviceId: "sw-back", operations: [{ id: randomUUID(), entity: "sale", action: "create", payload: { ...s, cashierId: NOOR, cashier: "Noor" }, ev: { v: 1, session: noorSession.session } }] }) })
    expect(((await pushed.json()) as any).results[0].error).toMatch(/Noor is not allowed to sell/)
    expect(await prisma.sale.count({ where: { tenantId: T, id: s.id } })).toBe(0)
  })
})
