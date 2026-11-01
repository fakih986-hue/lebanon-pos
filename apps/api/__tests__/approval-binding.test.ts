import { describe, it, expect, beforeAll, afterAll } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomUUID } from "node:crypto"
import jwt from "jsonwebtoken"

// SPRINT-2 batch (real Postgres, real handlers): what a manager approval is bound to. An approval is
// requested for one command and presented with another that keeps the same record id and the same total:
// every business field that changes what the command does must invalidate it — lines, quantities,
// prices, discount, the source sale, payout direction, currency and recipient, the customer, payment
// and tender — and so must another store, register, person or action. Only fields that cannot change the
// command (when it was written, display names, receipt numbers) may differ. One builder (lib/approvals.ts
// materialOf) is used when the approval is requested and when it is used.
process.env.JWT_SECRET = process.env.JWT_SECRET || "approval-binding-secret"
delete process.env.IS_LOCAL_SERVER
const prisma = (await import("../src/lib/prisma.js")).default
const app = (await import("../src/app.js")).default
const bcrypt = (await import("bcryptjs")).default
const { materialOf, materialDigest } = await import("../src/lib/approvals.js")
const { vi } = await import("vitest")
vi.setConfig({ testTimeout: 60_000 })

const T = randomUUID(), OTHER = randomUUID()
const OWNER = randomUUID(), MAYA = randomUUID(), RANA = randomUUID(), SAMI = randomUUID(), OTHER_OWNER = randomUUID()
const PIN = { owner: "6301", maya: "6302", rana: "6303", sami: "6304", other: "6401" }
let server: http.Server, base = ""
let ranaConn = "", samiConn = "", otherConn = ""
let dev: { credential: string }, dev2: { credential: string }, otherDev: { credential: string }
let ranaSession = "", samiSession = "", ranaSession2 = "", otherSession = ""
let tea = { id: 0, syncId: "" }, cake = { id: 0, syncId: "" }
let saleA = "", saleB = "", lineA1 = "", lineA2 = "", lineB = ""
const CUSTOMER_1 = randomUUID(), CUSTOMER_2 = randomUUID()
const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
async function call(method: string, p: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(`${base}${p}`, { method, headers: { "Content-Type": "application/json", "x-titan-sync-schema": "4", "x-forwarded-for": ip(), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await r.text()
  return { status: r.status, body: (text ? JSON.parse(text) : null) as any }
}
type Reg = { conn: string; dev: { credential: string }; session: string }
let rana: Reg, sami: Reg, ranaOnTill2: Reg, otherStore: Reg
const headers = (r: Reg) => ({ Authorization: `Bearer ${r.conn}`, "x-device-credential": r.dev.credential, "x-staff-session": r.session })
async function approve(entity: string, action: string, payload: Record<string, unknown>, permissions: string[], r: Reg = rana, pin = PIN.maya) {
  const a = await call("POST", "/api/approvals", { entity, action, payload, permissions, pin }, headers(r))
  expect(a.status, JSON.stringify(a.body)).toBe(200)
  return a.body.approvalId as string
}
const push = (entity: string, action: string, payload: Record<string, unknown>, approval: string, r: Reg = rana) =>
  call("POST", "/api/sync/push", { deviceId: "bind-till", operations: [{ id: randomUUID(), entity, action, payload, ev: { v: 1, session: r.session, approval } }] }, headers(r)).then((x) => x.body.results[0] as { status: string; error?: string })

/** Approve `approved`, present the approval with `presented` (same id): refused for the reason given. */
async function refusedWith(entity: string, action: string, approved: Record<string, unknown>, presented: Record<string, unknown>, permissions: string[], check: string, r: Reg = rana) {
  const id = await approve(entity, action, approved, permissions)
  const res = await push(entity, action, presented, id, r)
  expect([res.status, res.error?.match(/^APPROVAL_INVALID: the manager approval presented is ([a-z-]+)/)?.[1]]).toEqual(["rejected", check])
  return id
}

beforeAll(async () => {
  server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, resolve))
  base = `http://localhost:${(server.address() as AddressInfo).port}`
  await prisma.tenant.create({ data: { id: T, name: "Binding IT (disposable)", subdomain: `bi-${T.slice(0, 8)}` } })
  await prisma.tenant.create({ data: { id: OTHER, name: "Binding IT other (disposable)", subdomain: `bi2-${OTHER.slice(0, 8)}` } })
  for (const [id, tenantId, name, role, pin, perms] of [
    [OWNER, T, "Owner", "Admin", PIN.owner, null], [MAYA, T, "Maya", "Manager", PIN.maya, null],
    [RANA, T, "Rana", "Cashier", PIN.rana, ["sales.checkout"]], [SAMI, T, "Sami", "Cashier", PIN.sami, ["sales.checkout"]],
    [OTHER_OWNER, OTHER, "Other owner", "Admin", PIN.other, null],
  ] as const) await prisma.staffUser.create({ data: { id, tenantId, name, mobile: `bi-${id.slice(0, 8)}`, pin: await bcrypt.hash(pin, 12), role, ...(perms ? { permissions: [...perms] } : {}) } as any })
  for (const [id, name] of [[CUSTOMER_1, "Layla"], [CUSTOMER_2, "Omar"]] as const) await prisma.customer.create({ data: { id, tenantId: T, name, mobile: `bi-${id.slice(0, 8)}` } as any })
  const sign = (userId: string, tenantId: string, role: string) => jwt.sign({ userId, tenantId, role, tokenVersion: 1 }, process.env.JWT_SECRET!, { expiresIn: "1h" })
  const owner = sign(OWNER, T, "Admin"), otherOwnerConn = sign(OTHER_OWNER, OTHER, "Admin")
  ranaConn = sign(RANA, T, "Cashier"); samiConn = sign(SAMI, T, "Cashier"); otherConn = otherOwnerConn
  const enroll = async (token: string, deviceId: string) => {
    const code = (await call("POST", "/api/device/generate-code", {}, { Authorization: `Bearer ${token}` })).body.code
    return (await call("POST", "/api/device/pair", { code, deviceId, deviceName: deviceId })).body
  }
  dev = await enroll(owner, "bind-till"); dev2 = await enroll(owner, "bind-till-2"); otherDev = await enroll(otherOwnerConn, "bind-other")
  const open = async (pin: string, d: { credential: string }) => (await call("POST", "/api/auth/staff-session", { pin }, { "x-device-credential": d.credential })).body.session as string
  ranaSession = await open(PIN.rana, dev); samiSession = await open(PIN.sami, dev); ranaSession2 = await open(PIN.rana, dev2); otherSession = await open(PIN.other, otherDev)
  rana = { conn: ranaConn, dev, session: ranaSession }; sami = { conn: samiConn, dev, session: samiSession }
  ranaOnTill2 = { conn: ranaConn, dev: dev2, session: ranaSession2 }; otherStore = { conn: otherConn, dev: otherDev, session: otherSession }
  for (const [name, price, ref] of [["Tea", 5, "tea"], ["Cake", 5, "cake"]] as const) {
    const p = await prisma.product.create({ data: { tenantId: T, syncId: randomUUID(), name, price, cost: 1, stock: 100, barcode: `bi-${ref}-${T.slice(0, 6)}`, category: "Test" } })
    if (ref === "tea") tea = { id: p.id, syncId: p.syncId! }; else cake = { id: p.id, syncId: p.syncId! }
  }
  // two sales Rana made (sources for refunds), each $10
  saleA = randomUUID(); saleB = randomUUID(); lineA1 = randomUUID(); lineA2 = randomUUID(); lineB = randomUUID()
  const sale = (id: string, items: any[]) => ({ id, saleNumber: `S-BI-${id.slice(0, 4)}`, paymentMethod: "Cash", subtotal: 10, tax: 0, total: 10, cashier: "Rana", cashierId: RANA, status: "Completed", items })
  for (const s of [
    sale(saleA, [{ id: tea.id, productSyncId: tea.syncId, lineId: lineA1, name: "Tea", quantity: 1, unitPrice: 5, total: 5, batchAllocations: [] }, { id: cake.id, productSyncId: cake.syncId, lineId: lineA2, name: "Cake", quantity: 1, unitPrice: 5, total: 5, batchAllocations: [] }]),
    sale(saleB, [{ id: tea.id, productSyncId: tea.syncId, lineId: lineB, name: "Tea", quantity: 2, unitPrice: 5, total: 10, batchAllocations: [] }]),
  ]) {
    const r = await call("POST", "/api/sync/push", { deviceId: "bind-till", operations: [{ id: randomUUID(), entity: "sale", action: "create", payload: s, ev: { v: 1, session: ranaSession } }] }, headers(rana))
    expect(r.body.results[0].status).toBe("ok")
  }
})

afterAll(async () => {
  for (const tenantId of [T, OTHER]) {
    const where = { tenantId }
    for (const m of ["managerApproval", "operationEvidence", "staffSession", "syncOperation", "syncClient", "auditEvent", "cashMovement", "refundItem", "saleRefund", "saleItem", "sale", "stockMovement", "customer", "pairingCode", "device", "product", "staffUser"] as const) {
      if (m === "refundItem") await (prisma as any).refundItem.deleteMany({ where: { refund: { tenantId } } }).catch(() => undefined)
      else await (prisma as any)[m].deleteMany({ where }).catch(() => undefined)
    }
    await prisma.tenant.deleteMany({ where: { id: tenantId } }).catch(() => undefined)
  }
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await prisma.$disconnect()
})

// A $9 sale with a $1 discount (Rana has no sales.discount): the command a manager approves.
const discounted = (over: Record<string, unknown> = {}, items?: any[]) => {
  const id = (over.id as string) ?? randomUUID()
  return {
    id, saleNumber: `S-BD-${id.slice(0, 4)}`, paymentMethod: "Cash", customerId: CUSTOMER_1, customerName: "Layla", subtotal: 9, discountTotal: 1, tax: 0, total: 9,
    cashier: "Rana", cashierId: RANA, status: "Completed", createdAt: new Date().toISOString(),
    tender: { currency: "USD", exchangeRate: 89500, paidUsd: 10, paidLbp: 0, paidTotalUsd: 10, paidTotalLbp: 895000, changeUsd: 1, changeLbp: 0, changeCurrency: "USD" },
    items: items ?? [{ id: tea.id, productSyncId: tea.syncId, lineId: "l1", name: "Tea", quantity: 2, unitPrice: 5, total: 10, batchAllocations: [] }],
    ...over,
  }
}
const refundOf = (over: Record<string, unknown> = {}) => ({
  id: randomUUID(), refundNumber: `R-BI-${randomUUID().slice(0, 4)}`, saleId: saleA, saleNumber: "S-BI-A", method: "Cash", reason: "Customer return", total: 5, cashier: "Rana", cashierId: RANA,
  createdAt: new Date().toISOString(), items: [{ id: tea.id, saleLineId: lineA1, name: "Tea", quantity: 1, unitPrice: 5, total: 5 }], ...over,
})
const payoutOf = (over: Record<string, unknown> = {}) => ({
  id: randomUUID(), type: "CashOut", direction: "Out", amountUsd: 20, reason: "Pay Ali (delivery)", note: "", recordedById: RANA, recordedByName: "Rana", createdAt: new Date().toISOString(), ...over,
})

describe("one builder for request and use: what is material", () => {
  it("only timestamps, display names and receipt numbers are not material; every other field is", () => {
    const base = discounted({ id: "fixed" })
    const d = (p: unknown, perms: string[] = ["sales.discount"]) => materialDigest(materialOf("sale", "create", p, perms)!)
    expect(d({ ...base, createdAt: "2020-01-01T00:00:00Z", saleNumber: "OTHER", cashier: "Someone", customerName: "X", items: [{ ...base.items[0], name: "Other name", barcode: "999" }] })).toBe(d(base))
    // valuation the server derives is not material (a cost-hidden till sends none)
    expect(d({ ...base, cost: 3, profit: 6, items: [{ ...base.items[0], cost: 1 }] })).toBe(d(base))
    // a field nobody listed is material
    expect(d({ ...base, somethingNew: 1 })).not.toBe(d(base))
    // a held line's stock decision is material only to an approval of that decision
    const decided = { ...base, items: [{ ...base.items[0], stockPolicyResolution: { policy: "untracked", note: "brewed", resolvedBy: MAYA } }] }
    expect(d(decided)).toBe(d(base))
    expect(d(decided, ["inventory.manage"])).not.toBe(d(base, ["inventory.manage"]))
  })
})

describe("substitutions under the same id and the same total are refused", () => {
  it("a sale: other lines, other quantities and prices, another discount split, another customer, payment or tender", async () => {
    const id = () => randomUUID()
    const cases: Array<[string, (i: string) => [Record<string, unknown>, Record<string, unknown>]]> = [
      ["other line (Cake instead of Tea)", (i) => [discounted({ id: i }), discounted({ id: i }, [{ id: cake.id, productSyncId: cake.syncId, lineId: "l1", name: "Cake", quantity: 2, unitPrice: 5, total: 10, batchAllocations: [] }])]],
      ["other quantity and price (1 x $10 instead of 2 x $5)", (i) => [discounted({ id: i }), discounted({ id: i }, [{ id: tea.id, productSyncId: tea.syncId, lineId: "l1", name: "Tea", quantity: 1, unitPrice: 10, total: 10, batchAllocations: [] }])]],
      ["another discount ($2 off, $1 tax: same $9)", (i) => [discounted({ id: i }), discounted({ id: i, discountTotal: 2, subtotal: 8, tax: 1 })]],
      ["another customer", (i) => [discounted({ id: i }), discounted({ id: i, customerId: CUSTOMER_2 })]],
      ["another payment method", (i) => [discounted({ id: i }), discounted({ id: i, paymentMethod: "Card", tender: undefined })]],
      ["another tender (change given)", (i) => { const a = discounted({ id: i }); return [a, { ...a, tender: { ...(a.tender as object), paidUsd: 20, paidTotalUsd: 20, changeUsd: 11 } }] }],
    ]
    for (const [name, make] of cases) {
      const [approved, presented] = make(id())
      await refusedWith("sale", "create", approved, presented, ["sales.discount"], "changed").catch((e) => { throw new Error(`${name}: ${e.message}`) })
    }
    expect(await prisma.sale.count({ where: { tenantId: T, saleNumber: { startsWith: "S-BD-" } } })).toBe(0)
  })

  it("a refund: other lines, other quantities or prices, another source sale, another method", async () => {
    const cases: Array<[string, (r: ReturnType<typeof refundOf>) => Record<string, unknown>]> = [
      ["other line (Cake)", (r) => ({ ...r, items: [{ id: cake.id, saleLineId: lineA2, name: "Cake", quantity: 1, unitPrice: 5, total: 5 }] })],
      ["other quantity and price (2 x $2.5)", (r) => ({ ...r, items: [{ ...r.items[0], quantity: 2, unitPrice: 2.5 }] })],
      ["another source sale", (r) => ({ ...r, saleId: saleB, items: [{ ...r.items[0], saleLineId: lineB }] })],
      ["another method", (r) => ({ ...r, method: "Store credit" })],
    ]
    for (const [name, change] of cases) {
      const r = refundOf()
      await refusedWith("refund", "create", r, change(r), ["sales.refund"], "changed").catch((e) => { throw new Error(`${name}: ${e.message}`) })
    }
    expect(await prisma.saleRefund.count({ where: { tenantId: T } })).toBe(0)
  })

  it("a payout: another direction, currency or recipient", async () => {
    const cases: Array<[string, (p: ReturnType<typeof payoutOf>) => Record<string, unknown>]> = [
      ["cash in instead of out", (p) => ({ ...p, type: "CashIn", direction: "In" })],
      ["another currency", (p) => ({ ...p, currency: "LBP" })],
      ["another recipient", (p) => ({ ...p, reason: "Pay Omar (delivery)" })],
      ["another note", (p) => ({ ...p, note: "for Omar" })],
    ]
    for (const [name, change] of cases) {
      const p = payoutOf()
      await refusedWith("cash-movement", "create", p, change(p), ["cash.manage"], "changed").catch((e) => { throw new Error(`${name}: ${e.message}`) })
    }
    expect(await prisma.cashMovement.count({ where: { tenantId: T } })).toBe(0)
  })

  it("another store, register, person or action", async () => {
    // another register of this store (Rana signed in there too)
    let p = payoutOf()
    let id = await approve("cash-movement", "create", p, ["cash.manage"], ranaOnTill2)
    expect((await push("cash-movement", "create", p, id, rana)).error).toMatch(/is other-device/)
    // another person on the same register (Sami's session): the approval was for Rana
    p = payoutOf({ recordedById: SAMI, recordedByName: "Sami" })
    id = await approve("cash-movement", "create", p, ["cash.manage"], rana)
    expect((await push("cash-movement", "create", p, id, sami)).error).toMatch(/is other-actor/)
    // another action on the same record id: a void approval cannot carry a refund
    const r = refundOf({ id: saleB })
    id = await approve("sale", "void", { id: saleB, saleNumber: "S-BI-B" }, ["sales.void"])
    expect((await push("refund", "create", r, id)).error).toMatch(/is other-record/)
    // another store: an approval of store B presented in store A
    const q = payoutOf()
    const otherId = await call("POST", "/api/approvals", { entity: "cash-movement", action: "create", payload: { ...q, recordedById: OTHER_OWNER }, permission: "cash.manage", pin: PIN.other }, headers(otherStore))
    // (the other store's owner approving in their own store is refused as self-approval; their store has no other staff)
    expect(otherId.body.code).toBe("SELF_APPROVAL")
    const foreign = await prisma.managerApproval.create({ data: { id: randomUUID(), tenantId: OTHER, deviceId: "x", entity: "cash-movement", action: "create", recordId: q.id, materialDigest: "0".repeat(64), material: {}, permission: "cash.manage", permissions: ["cash.manage"], approverId: OTHER_OWNER, approverName: "Other owner", expiresAt: new Date(Date.now() + 60_000) } })
    expect((await push("cash-movement", "create", q, foreign.id)).error).toMatch(/is other-store/)
    expect(await prisma.cashMovement.count({ where: { tenantId: T } })).toBe(0)
  })

  it("positive control: the same command with a later timestamp, another receipt number and display names is applied once on the approval", async () => {
    const r = refundOf()
    const id = await approve("refund", "create", r, ["sales.refund"])
    const res = await push("refund", "create", { ...r, createdAt: new Date(Date.now() + 5_000).toISOString(), refundNumber: "R-BI-RENUM", cashier: "Rana K.", items: [{ ...r.items[0], name: "Tea (large)" }] }, id)
    expect([res.status, res.error]).toEqual(["ok", undefined])
    expect(await prisma.saleRefund.count({ where: { tenantId: T, id: r.id } })).toBe(1)
    // one approval for a sale needing both a discount and a price below list: both permissions, one PIN
    const both = discounted({}, [{ id: tea.id, productSyncId: tea.syncId, lineId: "l1", name: "Tea", quantity: 2, unitPrice: 5, total: 10, batchAllocations: [] }])
    const below = { ...both, subtotal: 7, total: 7, discountTotal: 1, items: [{ ...both.items[0], unitPrice: 4, total: 8 }] }
    const two = await approve("sale", "create", below, ["sales.discount", "sales.price_override"])
    const sold = await push("sale", "create", below, two)
    expect([sold.status, sold.error]).toEqual(["ok", undefined])
    const ev = await prisma.operationEvidence.findFirst({ where: { tenantId: T, entity: "sale", approval: { path: ["id"], equals: two } } })
    expect(ev?.approval).toMatchObject({ check: "valid", permissions: ["sales.discount", "sales.price_override"], requestedById: RANA, approverId: MAYA })
  })
})
