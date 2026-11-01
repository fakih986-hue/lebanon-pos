import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomUUID } from "node:crypto"
import { pathToFileURL } from "node:url"
import path from "node:path"

// SPRINT-2 Phase E end to end: the register's OWN services (apps/desktop/src: approval, sales, cash
// drawer, sync, security, device enrollment) against the real API handlers and a scratch database.
// The register is enrolled and connected with the cashier's own account (no refund, void or cash
// permission); the cashier signs in with her PIN (server-checked session). A manager approves.
process.env.JWT_SECRET = process.env.JWT_SECRET || "approval-till-secret"
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
let offline = false
const inflight = new Set<Promise<unknown>>()
const realFetch = globalThis.fetch
g.fetch = ((url: string, init?: RequestInit) => {
  if (offline) return Promise.reject(new TypeError("Failed to fetch (offline)"))
  const p = realFetch(url, init); inflight.add(p); void p.catch(() => undefined).finally(() => inflight.delete(p)); return p
}) as typeof fetch
async function dispose() {
  for (const id of timers) clearTimeout(id)
  timers.clear()
  for (let i = 0; i < 20 && (inflight.size > 0 || i < 3); i++) { await Promise.allSettled([...inflight]); await new Promise((r) => setImmediate(r)) }
}
const mod = (name: string) => import(/* @vite-ignore */ pathToFileURL(`${SRC}/features/pos/${name}.ts`).href)
const device = async () => ({
  sync: await mod("services/sync.service"), security: await mod("services/security.service"), sales: await mod("services/sales.service"),
  approval: await mod("services/approval.service"), cash: await mod("services/cashMovement.service"), devices: await mod("services/deviceRegistry.service"),
  grants: await mod("lib/approvalGrants"),
})
let d: Awaited<ReturnType<typeof device>>
const queue = () => JSON.parse(storage.getItem("lebanonpos.sync-queue.v1") ?? "[]") as Array<Record<string, any>>
const flush = async () => {
  for (let i = 0; i < 3; i++) {
    storage.setItem("lebanonpos.sync-queue.v1", JSON.stringify(queue().map((op) => ({ ...op, status: op.status === "Failed" ? "Pending" : op.status, lastAttemptAt: "2000-01-01T00:00:00.000Z" }))))
    await d.sync.flushSyncQueue()
  }
  await dispose()
}

let prisma: typeof import("../src/lib/prisma.js").default
let server: http.Server
let baseUrl = ""
const T = randomUUID(), SUB = `apt-${T.slice(0, 8)}`
const OWNER = randomUUID(), MAYA = randomUUID(), RANA = randomUUID()
const PIN = { owner: "6601", maya: "6602", rana: "6603" }
let product: { id: number; syncId: string; name: string; barcode: string }
const login = async (pin: string) => ((await (await realFetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin, tenantSubdomain: SUB }) })).json()) as any).token as string
const localProduct = () => (JSON.parse(storage.getItem("lebanonpos.products.v1") ?? "[]") as any[]).find((p) => p.syncId === product.syncId)
const sell = (qty: number) => {
  const p = localProduct()
  const id = randomUUID()
  const sale = d.sales.buildSale({ saleNumber: `S-APT-${id.slice(0, 6)}`, paymentMethod: "Cash", subtotal: qty * 5, tax: 0, total: qty * 5,
    items: [{ id: p.id, productSyncId: p.syncId, name: p.name, barcode: p.barcode ?? "", quantity: qty, unitPrice: 5, total: qty * 5, batchAllocations: [] }] }, id)
  expect(d.sales.checkoutLocalSale({ sale, lots: [{ productId: p.id, productName: p.name, barcode: p.barcode ?? "", quantity: qty, fallbackUnitCost: 0 }], stock: [{ productId: p.id, quantity: qty }] }).status).toBe("completed")
  return d.sales.getSales().find((s: any) => s.id === id)
}
const lineKey = (sale: any) => d.sales.refundLineKeyOf(sale.items[0])

beforeAll(async () => {
  vi.setConfig({ testTimeout: 60_000 })
  prisma = (await import("../src/lib/prisma.js")).default
  const bcrypt = (await import("bcryptjs")).default
  const app = (await import("../src/app.js")).default
  process.env.IS_LOCAL_SERVER = "false"
  server = http.createServer(app)
  await new Promise<void>((r) => server.listen(0, r))
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`
  await prisma.tenant.create({ data: { id: T, name: "Approval till IT (disposable)", subdomain: SUB } })
  for (const [id, name, role, pin, perms] of [[OWNER, "Owner", "Admin", PIN.owner, null], [MAYA, "Maya", "Manager", PIN.maya, null], [RANA, "Rana", "Cashier", PIN.rana, ["sales.checkout"]]] as const)
    await prisma.staffUser.create({ data: { id, tenantId: T, name, mobile: `apt-${id.slice(0, 8)}`, pin: await bcrypt.hash(pin, 12), role, ...(perms ? { permissions: [...perms] } : {}) } as any })
  const p = await prisma.product.create({ data: { tenantId: T, syncId: randomUUID(), name: "Tea box", price: 5, cost: 2, stock: 40, barcode: `apt-${T.slice(0, 6)}`, category: "Tea" } })
  product = { id: p.id, syncId: p.syncId!, name: p.name, barcode: p.barcode ?? "" }
  storage.setItem("lebanonpos.api-url", baseUrl)
  storage.setItem("lebanonpos.store-subdomain.v1", SUB)
  storage.setItem("lebanonpos.tenant-id.v1", T)
  storage.setItem("lebanonpos.device-id.v1", "apt-till")
  storage.setItem("lebanonpos.users.v1", "[]")
  d = await device()
  // the owner enrolls the register, then it is connected with the CASHIER's own account
  const code = ((await (await realFetch(`${baseUrl}/api/device/generate-code`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await login(PIN.owner)}` }, body: "{}" })).json()) as any).code
  storage.setItem("lebanonpos.auth-token", await login(PIN.owner))
  expect((await d.devices.pairDevice(code, "apt-till", "Counter 1")).ok).toBe(true)
  storage.setItem("lebanonpos.auth-token", await login(PIN.rana))
  await d.sync.pullFromServer(true); await dispose()
  expect((await d.security.unlockWithPin(PIN.rana))?.id).toBe(RANA); await dispose()
  expect(d.security.openShift(20)).toBeTruthy()
  await flush()
})

afterAll(async () => {
  await dispose()
  for (const m of ["managerApproval", "auditEvent", "operationEvidence", "syncOperation", "syncClient", "stockMovement", "cashMovement", "saleItem", "sale", "shift", "staffSession", "pairingCode", "device", "product", "staffUser"])
    await (prisma as any)[m]?.deleteMany({ where: { tenantId: T } }).catch(() => undefined)
  await (prisma as any).refundItem.deleteMany({ where: { refund: { tenantId: T } } }).catch(() => undefined)
  await prisma.saleRefund.deleteMany({ where: { tenantId: T } }).catch(() => undefined)
  await prisma.tenant.deleteMany({ where: { id: T } })
  await new Promise<void>((r) => server.close(() => r()))
})

describe("manager approval on the register (its own services, real API)", () => {
  it("refund: refused locally without approval; a wrong PIN changes nothing; the manager approves; the cashier stays signed in and is the actor", async () => {
    const sale = sell(2)
    await flush()
    const quantities = { [lineKey(sale)]: 1 }
    expect(() => d.sales.processRefund({ saleId: sale.id, quantities, reason: "IT" })).toThrow(/permission/i)
    const id = randomUUID()
    const payload = d.sales.refundApprovalPayload({ saleId: sale.id, quantities, reason: "IT", id })
    const wrong = await d.approval.requestManagerApproval({ entity: "refund", action: "create", payload, permission: "sales.refund", pin: "0000" })
    expect([wrong.ok, wrong.code]).toEqual([false, "INVALID_PIN"])
    expect(d.grants.pendingApprovalCount()).toBe(0)
    const tokenBefore = storage.getItem("lebanonpos.auth-token")
    const ok = await d.approval.requestManagerApproval({ entity: "refund", action: "create", payload, permission: "sales.refund", pin: PIN.maya })
    expect(ok.ok).toBe(true)
    // the register did not switch person or connection
    expect(d.security.getCurrentUser()?.id).toBe(RANA)
    expect(storage.getItem("lebanonpos.auth-token")).toBe(tokenBefore)
    const refund = d.sales.processRefund({ saleId: sale.id, quantities, reason: "IT", id })
    expect(refund.id).toBe(id)
    expect(d.grants.pendingApprovalCount()).toBe(0) // attached to the operation, gone from the register
    const op = queue().find((o) => o.entity === "refund" && o.payload?.id === id)!
    expect(op.ev?.approval).toBe(ok.grant.approvalId)
    await flush()
    { const q = queue().find((o) => o.id === op.id); expect([q?.status, q?.lastError ?? q?.error ?? null]).toEqual(["Synced", null]) }
    const e = (await prisma.operationEvidence.findUnique({ where: { opId: op.id } }))!
    // the actor: the person whose server-checked session it was made under (a refund names its cashier by name only)
    expect([e.sessionStaffId, e.actorNameClaimed, e.evidence]).toEqual([RANA, "Rana", "staff-session"])
    expect(e.approval).toMatchObject({ check: "valid", approverId: MAYA, permission: "sales.refund" })
    expect(await prisma.saleRefund.count({ where: { tenantId: T, id } })).toBe(1)
    // no PIN in what the register keeps
    for (const pin of Object.values(PIN)) expect(JSON.stringify(Object.fromEntries(storage.m))).not.toContain(`"${pin}"`)
  })

  it("a staff switch, a lock and a restart each drop an unused approval", async () => {
    const sale = sell(1)
    const quantities = { [lineKey(sale)]: 1 }
    const id = randomUUID()
    const payload = d.sales.refundApprovalPayload({ saleId: sale.id, quantities, reason: "IT", id })
    expect((await d.approval.requestManagerApproval({ entity: "refund", action: "create", payload, permission: "sales.refund", pin: PIN.maya })).ok).toBe(true)
    d.security.lockSession()
    expect(d.grants.pendingApprovalCount()).toBe(0)
    expect((await d.security.unlockWithPin(PIN.rana))?.id).toBe(RANA); await dispose()
    expect(() => d.sales.processRefund({ saleId: sale.id, quantities, reason: "IT", id })).toThrow(/permission/i)
    // restart: approvals live in memory only
    expect((await d.approval.requestManagerApproval({ entity: "refund", action: "create", payload, permission: "sales.refund", pin: PIN.maya })).ok).toBe(true)
    await dispose(); vi.resetModules(); d = await device()
    expect(d.grants.pendingApprovalCount()).toBe(0)
    expect(() => d.sales.processRefund({ saleId: sale.id, quantities, reason: "IT", id })).toThrow(/permission/i)
  })

  it("a refund recorded with more than was approved is refused by the server and kept for review", async () => {
    const sale = sell(3)
    await flush()
    const id = randomUUID()
    const approved = { [lineKey(sale)]: 1 }
    const payload = d.sales.refundApprovalPayload({ saleId: sale.id, quantities: approved, reason: "IT", id })
    const granted = await d.approval.requestManagerApproval({ entity: "refund", action: "create", payload, permission: "sales.refund", pin: PIN.maya })
    expect(granted.ok).toBe(true)
    // this register refuses to record a refund other than the one approved (and drops the approval)
    expect(() => d.sales.processRefund({ saleId: sale.id, quantities: { [lineKey(sale)]: 2 }, reason: "IT", id })).toThrow(/APPROVAL_CHANGED/)
    expect(d.grants.pendingApprovalCount()).toBe(0)
    // a modified register that skips that check: the server refuses it
    if (granted.ok) d.grants.addApprovalGrant({ ...granted.grant, command: undefined })
    d.sales.processRefund({ saleId: sale.id, quantities: { [lineKey(sale)]: 2 }, reason: "IT", id })
    await flush()
    const op = queue().find((o) => o.entity === "refund" && o.payload?.id === id)!
    expect(op.status).toBe("Rejected")
    expect(String(op.error)).toMatch(/APPROVAL_INVALID: .*changed/)
    expect(await prisma.saleRefund.count({ where: { tenantId: T, id } })).toBe(0)
    expect((await prisma.syncOperation.findUnique({ where: { id: op.id } }))?.status).toBe("Refused")
  })

  it("void and cash payout through the register's services", async () => {
    const sale = sell(1)
    await flush()
    expect(() => d.sales.voidSale(sale.id)).toThrow(/permission/i)
    expect((await d.approval.requestManagerApproval({ entity: "sale", action: "void", payload: d.sales.voidApprovalPayload(sale), permission: "sales.void", pin: PIN.maya })).ok).toBe(true)
    d.sales.voidSale(sale.id)
    const input = { id: randomUUID(), type: "OwnerDraw", amountUsd: 3, reason: "Owner draw" }
    expect(d.cash.createCashMovement(input)).toBeNull()
    expect((await d.approval.requestManagerApproval({ entity: "cash-movement", action: "create", payload: d.cash.cashMovementApprovalPayload(input), permission: "cash.manage", pin: PIN.owner })).ok).toBe(true)
    expect(d.cash.createCashMovement(input)).toBeTruthy()
    await flush()
    expect((await prisma.sale.findFirst({ where: { tenantId: T, id: sale.id }, select: { status: true } }))?.status).toBe("Voided")
    expect(await prisma.cashMovement.count({ where: { tenantId: T, id: input.id } })).toBe(1)
    expect(queue().filter((o) => ["sale", "cash-movement"].includes(o.entity) && ["void", "create"].includes(o.action) && o.payload?.id && [sale.id, input.id].includes(o.payload.id)).every((o) => o.status === "Synced")).toBe(true)
  })

  it("the connection expired with completed work queued: nothing is dropped or re-charged; delivered once after signing in again", async () => {
    const good = storage.getItem("lebanonpos.auth-token")!
    const expired = (await import("jsonwebtoken")).default.sign({ userId: RANA, tenantId: T, role: "Cashier", tokenVersion: 1 }, process.env.JWT_SECRET!, { expiresIn: -60 })
    storage.setItem("lebanonpos.auth-token", expired)
    const sale = sell(1)
    await flush()
    const op = queue().find((o) => o.entity === "sale" && o.payload?.id === sale.id)!
    expect(op).toBeTruthy()
    expect(op.status).not.toBe("Synced")
    expect(d.sales.getSales().find((x: any) => x.id === sale.id)?.status).not.toBe("Voided") // the paid sale stands on the register
    expect(await prisma.sale.count({ where: { tenantId: T, id: sale.id } })).toBe(0)
    storage.setItem("lebanonpos.auth-token", good) // signed in again
    await flush()
    expect(queue().find((o) => o.id === op.id)?.status).toBe("Synced")
    expect(await prisma.sale.count({ where: { tenantId: T, id: sale.id } })).toBe(1)
  })

  it("offline: no approval is possible, and the work is left as it was", async () => {
    offline = true
    try {
      const r = await d.approval.requestManagerApproval({ entity: "sale", action: "void", payload: { id: randomUUID(), saleNumber: "x" }, permission: "sales.void", pin: PIN.maya })
      expect([r.ok, r.code]).toEqual([false, "OFFLINE"])
    } finally { offline = false }
    expect(d.grants.pendingApprovalCount()).toBe(0)
  })
})
