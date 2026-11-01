import { describe, it, expect, beforeAll, afterAll } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomUUID } from "node:crypto"
import jwt from "jsonwebtoken"

// Operational readiness (real Postgres, real handlers): the business record carries the authenticated actor.
// A store that enforces staff identity (registers connected to the cloud), one enrolled register, staff sessions
// opened with a server PIN check. Under test, per record kind: an omitted actor is filled with the session's
// person, a substituted or forged one never stands (payload "attribution" fields are the server's), a manager's
// approval and a reviewer are recorded apart from the actor, a void keeps the seller, renaming or deactivating
// staff later does not rewrite history; and in an observe store a claim stays a claim and old records stay null.
process.env.JWT_SECRET = process.env.JWT_SECRET || "record-attribution-secret"
delete process.env.IS_LOCAL_SERVER
const prisma = (await import("../src/lib/prisma.js")).default
const app = (await import("../src/app.js")).default
const bcrypt = (await import("bcryptjs")).default
const { vi } = await import("vitest")
vi.setConfig({ testTimeout: 60_000 })

const T = randomUUID(), OBS = randomUUID()
const OWNER = randomUUID(), MAYA = randomUUID(), RANA = randomUUID(), NOOR = randomUUID(), OBS_OWNER = randomUUID()
const PIN = { owner: "8801", maya: "8802", rana: "8803", noor: "8804" }
let server: http.Server
let base = ""
let transport = "", mayaPerson = ""
let dev: { credential: string }
let productId = 0, supplierId = "", customerId = ""
const SKU = `ra-${T.slice(0, 8)}`
const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
async function call(method: string, p: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(`${base}${p}`, { method, headers: { "Content-Type": "application/json", "x-titan-sync-schema": "5", "x-forwarded-for": ip(), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, body: (await r.json().catch(() => null)) as any }
}
const sign = (userId: string, tenantId: string, role: string, use?: "person") => jwt.sign({ userId, tenantId, role, tokenVersion: 1, ...(use ? { use, client: "person" } : { use: "transport", client: "register" }) }, process.env.JWT_SECRET!, { expiresIn: "1h" })
const sessionFor = async (pin: string) => (await call("POST", "/api/auth/staff-session", { pin }, { "x-device-credential": dev.credential })).body.session as string
const push = async (entity: string, action: string, payload: unknown, ev: Record<string, unknown>) => {
  const op = { id: randomUUID(), entity, action, payload, ev: { v: 1, ...ev } }
  const r = (await call("POST", "/api/sync/push", { deviceId: "ra-till", operations: [op] }, { Authorization: `Bearer ${transport}`, "x-device-credential": dev.credential })).body.results[0]
  return { ...r, opId: op.id }
}
const approve = async (session: string, entity: string, action: string, payload: Record<string, unknown>, permission: string) =>
  (await call("POST", "/api/approvals", { entity, action, payload, permission, pin: PIN.maya }, { Authorization: `Bearer ${transport}`, "x-device-credential": dev.credential, "x-staff-session": session })).body.approvalId as string
const sale = (extra: Record<string, unknown> = {}) => {
  const id = randomUUID()
  return { id, saleNumber: `S-RA-${id.slice(0, 6)}`, paymentMethod: "Cash", subtotal: 5, tax: 0, total: 5, status: "Completed", createdAt: new Date().toISOString(), items: [{ id: productId, productSyncId: SKU, lineId: randomUUID(), name: "Attribution tea", barcode: SKU, quantity: 1, unitPrice: 5, total: 5, cost: 2, batchAllocations: [] }], ...extra }
}
const basisOf = (a: unknown) => (a as { basis?: string } | null)?.basis ?? null

beforeAll(async () => {
  server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, resolve))
  base = `http://localhost:${(server.address() as AddressInfo).port}`
  await prisma.tenant.create({ data: { id: T, name: "Attribution IT (disposable)", subdomain: `ra-${T.slice(0, 8)}`, cloudApiKey: randomUUID(), storeTopology: "direct", topologyVersion: 1 } })
  for (const [id, name, role, pin, permissions] of [
    [OWNER, "Owner", "Admin", PIN.owner, undefined], [MAYA, "Maya", "Manager", PIN.maya, undefined],
    [RANA, "Rana", "Cashier", PIN.rana, ["sales.checkout", "sales.refund", "accounting.manage", "inventory.receive", "inventory.adjust", "suppliers.manage", "customers.manage", "shifts.manage"]],
    [NOOR, "Noor", "Cashier", PIN.noor, ["sales.checkout"]],
  ] as const) await prisma.staffUser.create({ data: { id, tenantId: T, name, mobile: `ra-${id.slice(0, 8)}`, pin: await bcrypt.hash(pin, 12), role, ...(permissions ? { permissions: [...permissions] } : {}) } as any })
  productId = (await prisma.product.create({ data: { tenantId: T, syncId: SKU, name: "Attribution tea", price: 5, cost: 2, stock: 100, barcode: SKU, category: "Test" } })).id
  supplierId = (await prisma.supplier.create({ data: { tenantId: T, name: "RA Supplier" } })).id
  customerId = (await prisma.customer.create({ data: { tenantId: T, name: "RA Customer", mobile: `ra-c-${T.slice(0, 6)}` } as any })).id
  transport = sign(OWNER, T, "Admin")
  mayaPerson = sign(MAYA, T, "Manager", "person")
  const code = (await call("POST", "/api/device/generate-code", {}, { Authorization: `Bearer ${sign(OWNER, T, "Admin", "person")}` })).body.code
  dev = (await call("POST", "/api/device/pair", { code, deviceId: "ra-till", deviceName: "RA till" })).body
  // the store enforces (the activation gate is exercised in staff-enforce / store-topology)
  await prisma.tenant.update({ where: { id: T }, data: { staffSessionMode: "enforce", staffPolicyVersion: 1 } })
  // an observe store with a record made before attribution existed
  await prisma.tenant.create({ data: { id: OBS, name: "Attribution IT observe (disposable)", subdomain: `rao-${OBS.slice(0, 8)}`, cloudApiKey: randomUUID() } })
  await prisma.staffUser.create({ data: { id: OBS_OWNER, tenantId: OBS, name: "Obs owner", mobile: `rao-${OBS.slice(0, 6)}`, pin: await bcrypt.hash("8901", 12), role: "Admin" } })
  await prisma.product.create({ data: { tenantId: OBS, syncId: `${SKU}-o`, name: "Observe tea", price: 5, cost: 2, stock: 100, barcode: `${SKU}-o`, category: "Test" } })
})

afterAll(async () => {
  for (const tenantId of [T, OBS]) {
    const where = { tenantId }
    for (const m of ["reviewResolution", "managerApproval", "operationEvidence", "staffSession", "syncOperation", "syncClient", "auditEvent", "dailyClose", "expense", "cashMovement", "stockCountLine", "stockCountSession", "stockAdjustment", "inventoryBatch", "stockMovement", "supplierPayment", "debtPayment", "debtSale", "refundItem", "saleRefund", "saleTender", "saleItem", "sale", "shift", "pairingCode", "device", "customer", "supplier", "product", "staffUser"] as const) {
      if (m === "refundItem") await (prisma as any).refundItem.deleteMany({ where: { refund: { tenantId } } }).catch(() => undefined)
      else if (m === "stockCountLine") await (prisma as any).stockCountLine.deleteMany({ where: { session: { tenantId } } }).catch(() => undefined)
      else if (m === "saleItem" || m === "saleTender") await (prisma as any)[m].deleteMany({ where: { sale: { tenantId } } }).catch(() => undefined)
      else await (prisma as any)[m].deleteMany({ where }).catch(() => undefined)
    }
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
  }
  await new Promise<void>((r) => server.close(() => r()))
  await prisma.$disconnect()
})

let ranaSale = ""
describe("enforce: the session's person is the record's actor", () => {
  it("sale, refund, expense, receiving, adjustment, count, supplier payment, debt payment, shift and close: omitted actors filled, forged ones never stand", async () => {
    const rana = await sessionFor(PIN.rana)
    // a sale naming nobody; one naming the owner; one carrying forged server fields
    const omitted = sale({ cashier: "", cashierId: undefined })
    const forgedActor = sale({ cashier: "Owner", cashierId: OWNER })
    const forgedFields = sale({ cashier: "Rana", cashierId: RANA, attribution: { basis: "verified", actor: { id: OWNER, name: "Owner" } }, voidedById: OWNER, voidedByName: "Owner" })
    for (const s of [omitted, forgedActor, forgedFields]) expect((await push("sale", "create", s, { session: rana })).status).toBe("ok")
    for (const s of [omitted, forgedActor, forgedFields]) {
      const row = await prisma.sale.findFirst({ where: { tenantId: T, id: s.id }, select: { cashierId: true, cashier: true, attribution: true, voidedById: true } })
      expect([row?.cashierId, row?.cashier, basisOf(row?.attribution), (row?.attribution as any)?.actor, row?.voidedById]).toEqual([RANA, "Rana", "verified", undefined, null])
    }
    ranaSale = omitted.id
    // a refund of one sale, naming nobody
    const refundId = randomUUID()
    const line = (await prisma.saleItem.findFirst({ where: { saleId: omitted.id }, select: { lineId: true } }))!.lineId
    expect((await push("refund", "create", { id: refundId, refundNumber: `R-RA-${refundId.slice(0, 6)}`, saleId: omitted.id, saleNumber: omitted.saleNumber, method: "Cash", reason: "spilled", total: 5, items: [{ id: productId, saleLineId: line, name: "Attribution tea", quantity: 1, unitPrice: 5, total: 5 }] }, { session: rana })).status).toBe("ok")
    expect(await prisma.saleRefund.findFirst({ where: { tenantId: T, id: refundId }, select: { cashierId: true, cashier: true } })).toEqual({ cashierId: RANA, cashier: "Rana" })
    // an expense naming nobody
    const expenseId = randomUUID()
    expect((await push("expense", "create", { id: expenseId, expenseNumber: `EXP-RA-${expenseId.slice(0, 4)}`, vendor: "Market", category: "Supplies", amount: 3, paymentMethod: "Cash", recordedBy: "", createdAt: new Date().toISOString() }, { session: rana })).status).toBe("ok")
    expect(await prisma.expense.findFirst({ where: { tenantId: T, id: expenseId }, select: { recordedById: true, recordedBy: true } })).toEqual({ recordedById: RANA, recordedBy: "Rana" })
    // receiving (a lot), an adjustment and a count: the payloads name nobody
    const lot = randomUUID()
    expect((await push("inventory", "receive", [{ id: lot, batchNumber: `LOT-RA-${lot.slice(0, 4)}`, productId, productSyncId: SKU, productName: "Attribution tea", barcode: SKU, initialQuantity: 10, quantityRemaining: 10, unitCost: 2, unitPrice: 5, receivedAt: new Date().toISOString(), status: "Open", receivedById: OWNER }], { session: rana })).status).toBe("ok")
    expect(await prisma.inventoryBatch.findFirst({ where: { tenantId: T, id: lot }, select: { receivedById: true, receivedByName: true } })).toEqual({ receivedById: RANA, receivedByName: "Rana" })
    const adj = randomUUID()
    expect((await push("inventory", "adjust", { id: adj, adjustmentNumber: `ADJ-RA-${adj.slice(0, 4)}`, productId, productSyncId: SKU, productName: "Attribution tea", barcode: SKU, quantityBefore: 0, quantityChange: -1, quantityAfter: 0, reason: "Damaged", valueImpact: -2, createdAt: new Date().toISOString() }, { session: rana })).status).toBe("ok")
    expect(await prisma.stockAdjustment.findFirst({ where: { tenantId: T, id: adj }, select: { createdById: true, createdByName: true } })).toEqual({ createdById: RANA, createdByName: "Rana" })
    const count = randomUUID()
    expect((await push("inventory", "count", { id: count, countNumber: `CNT-RA-${count.slice(0, 4)}`, status: "Completed", lines: [{ productId, productSyncId: SKU, productName: "Attribution tea", barcode: SKU, expectedQuantity: 1, countedQuantity: 1, variance: 0 }] }, { session: rana })).status).toBe("ok")
    expect(await prisma.stockCountSession.findFirst({ where: { tenantId: T, id: count }, select: { completedById: true } })).toEqual({ completedById: RANA })
    // a supplier payment and a customer's debt payment
    const sp = randomUUID()
    expect((await push("supplier-payment", "payment", { id: sp, supplierId, supplierName: "RA Supplier", amount: 7, method: "Cash", reference: "", recordedBy: "" }, { session: rana })).status).toBe("ok")
    expect(await prisma.supplierPayment.findFirst({ where: { tenantId: T, id: sp }, select: { recordedById: true, recordedBy: true } })).toEqual({ recordedById: RANA, recordedBy: "Rana" })
    const dp = randomUUID()
    expect((await push("debt", "payment", { id: dp, customerId, amount: 2, method: "Cash", reference: "PAY-RA", createdAt: new Date().toISOString() }, { session: rana })).status).toBe("ok")
    expect(await prisma.debtPayment.findFirst({ where: { tenantId: T, id: dp }, select: { recordedById: true, recordedByName: true } })).toEqual({ recordedById: RANA, recordedByName: "Rana" })
    // her shift, opened and closed; a close of the day naming nobody
    const shift = randomUUID()
    expect((await push("shift", "open", { id: shift, shiftNumber: "SH-RA-1", openedById: RANA, openedByName: "Rana", openingFloatUsd: 20 }, { session: rana })).status).toBe("ok")
    expect((await push("shift", "close", { id: shift, closingCashUsd: 20, closedByName: "" }, { session: rana })).status).toBe("ok")
    const sh = await prisma.shift.findFirst({ where: { tenantId: T, id: shift }, select: { openedById: true, closedById: true, closedByName: true, openAttribution: true, closeAttribution: true } })
    expect([sh?.openedById, sh?.closedById, sh?.closedByName, basisOf(sh?.openAttribution), basisOf(sh?.closeAttribution)]).toEqual([RANA, RANA, "Rana", "verified", "verified"])
    const close = randomUUID()
    expect((await push("daily-close", "close", { id: close, dateKey: "2099-06-01", grossSales: 5, refunds: 0, netSales: 5, expenses: 3, cashIn: 5, cashOut: 0, note: "", closedBy: "", createdAt: new Date().toISOString() }, { session: rana })).status).toBe("ok")
    expect(await prisma.dailyClose.findFirst({ where: { tenantId: T, id: close }, select: { closedById: true, closedBy: true } })).toEqual({ closedById: RANA, closedBy: "Rana" })
    // naming another person on a non-sale record is refused (kept for review), never recorded as named
    const mismatch = await push("expense", "create", { id: randomUUID(), expenseNumber: "EXP-RA-X", vendor: "Market", category: "Supplies", amount: 1, paymentMethod: "Cash", recordedById: OWNER, recordedBy: "Owner" }, { session: rana })
    expect(mismatch.error).toMatch(/^IDENTITY_MISMATCH:/)
    // the evidence row carries the same attribution the record has
    const ev = await prisma.operationEvidence.findFirst({ where: { tenantId: T, entity: "expense", evidence: "verified" }, orderBy: { receivedAt: "desc" } })
    expect((ev?.attribution as any)?.actor?.id).toBe(RANA)
  })

  it("a payout Maya approved: Rana is the actor, Maya the approver; Maya's void keeps Rana as the seller", async () => {
    const rana = await sessionFor(PIN.rana)
    const payout = { id: randomUUID(), type: "OwnerDraw", direction: "Out", amountUsd: 6, reason: "Owner draw", note: "", recordedByName: "" }
    const approvalId = await approve(rana, "cash-movement", "create", payout, "cash.manage")
    expect(approvalId).toBeTruthy()
    expect((await push("cash-movement", "create", payout, { session: rana, approval: approvalId })).status).toBe("ok")
    const cm = await prisma.cashMovement.findFirst({ where: { tenantId: T, id: payout.id }, select: { recordedById: true, recordedByName: true, attribution: true } })
    expect([cm?.recordedById, cm?.recordedByName, basisOf(cm?.attribution), (cm?.attribution as any)?.approver]).toEqual([RANA, "Rana", "verified", { id: MAYA, name: "Maya" }])
    // Maya signs in on the register (a staff switch) and voids Rana's sale
    const maya = await sessionFor(PIN.maya)
    const s = await prisma.sale.findFirst({ where: { tenantId: T, id: ranaSale }, select: { saleNumber: true } })
    // (a sale with a refund cannot be voided: void another of Rana's)
    const toVoid = sale({ cashier: "Rana", cashierId: RANA })
    // Rana's session ended with the switch: her routine sale arriving now is completed work, still hers (never Maya's)
    expect((await push("sale", "create", toVoid, { session: rana })).status).toBe("ok")
    expect(await prisma.sale.findFirst({ where: { tenantId: T, id: toVoid.id }, select: { cashierId: true } })).toEqual({ cashierId: RANA })
    expect((await push("sale", "void", { id: toVoid.id, saleNumber: toVoid.saleNumber }, { session: maya })).status).toBe("ok")
    const voided = await prisma.sale.findFirst({ where: { tenantId: T, id: toVoid.id }, select: { status: true, cashierId: true, cashier: true, voidedById: true, voidedByName: true, voidAttribution: true } })
    expect([voided?.status, voided?.cashierId, voided?.cashier, voided?.voidedById, voided?.voidedByName, basisOf(voided?.voidAttribution)]).toEqual(["Voided", RANA, "Rana", MAYA, "Maya", "verified"])
    expect(s?.saleNumber).toBeTruthy()
  })

  it("renaming or deactivating a person later does not rewrite who did what", async () => {
    await prisma.staffUser.update({ where: { id: RANA }, data: { name: "Rana Khoury", active: false } })
    try {
      const row = await prisma.sale.findFirst({ where: { tenantId: T, id: ranaSale }, select: { cashierId: true, cashier: true } })
      expect(row).toEqual({ cashierId: RANA, cashier: "Rana" })
      const report = await call("GET", `/api/sync/pull`, undefined, { Authorization: `Bearer ${sign(OWNER, T, "Admin", "person")}` })
      expect(report.body.sales.find((x: any) => x.id === ranaSale)?.cashier).toBe("Rana")
    } finally { await prisma.staffUser.update({ where: { id: RANA }, data: { name: "Rana", active: true } }) }
  })

  it("held work a reviewer applies: the actor as checked when held, the reviewer apart", async () => {
    const noor = await sessionFor(PIN.noor)
    const payout = { id: randomUUID(), type: "PettyCash", direction: "Out", amountUsd: 2, reason: "Milk run", note: "", recordedByName: "" }
    expect((await push("cash-movement", "create", payout, { session: noor })).status).toBe("error") // Noor lacks cash.manage: held
    const item = (await call("GET", "/api/sync/refused", undefined, { Authorization: `Bearer ${mayaPerson}` })).body.operations.find((o: any) => o.payload?.id === payout.id)
    expect((await call("POST", `/api/sync/refused/${item.id}/resolve`, { decision: "apply", note: "Noor bought milk for the café", previewToken: item.previewToken }, { Authorization: `Bearer ${mayaPerson}` })).body.ok).toBe(true)
    const cm = await prisma.cashMovement.findFirst({ where: { tenantId: T, id: payout.id }, select: { recordedById: true, recordedByName: true, attribution: true } })
    expect([cm?.recordedById, cm?.recordedByName, basisOf(cm?.attribution), (cm?.attribution as any)?.reviewer]).toEqual([NOOR, "Noor", "reviewed", { id: MAYA, name: "Maya" }])
  })

  it("a routine sale the register says was made offline: recorded as an offline claim, never as verified", async () => {
    const s = sale({ cashier: "Rana", cashierId: RANA })
    expect((await push("sale", "create", s, { offline: true })).status).toBe("ok")
    const row = await prisma.sale.findFirst({ where: { tenantId: T, id: s.id }, select: { cashierId: true, attribution: true } })
    expect([row?.cashierId, basisOf(row?.attribution)]).toEqual([RANA, "offline-claimed"])
  })
})

describe("observe: a claim stays a claim; old records are not upgraded", () => {
  it("a register naming someone is recorded as a claim; naming nobody is unattributed; a record from before stays null", async () => {
    const old = await prisma.sale.create({ data: { tenantId: OBS, saleNumber: "S-OLD-1", paymentMethod: "Cash", subtotal: 5, tax: 0, total: 5, cashier: "Old cashier" } as any })
    const owner = sign(OBS_OWNER, OBS, "Admin")
    const op = (entity: string, action: string, payload: unknown) => call("POST", "/api/sync/push", { deviceId: "rao-till", operations: [{ id: randomUUID(), entity, action, payload }] }, { Authorization: `Bearer ${owner}` })
    const claimed = { ...sale({ cashier: "Someone", cashierId: OBS_OWNER, attribution: { basis: "verified" } }), items: [{ id: 1, productSyncId: `${SKU}-o`, lineId: randomUUID(), name: "Observe tea", barcode: `${SKU}-o`, quantity: 1, unitPrice: 5, total: 5, cost: 2, batchAllocations: [] }] }
    expect((await op("sale", "create", claimed)).body.results[0].status).toBe("ok")
    const row = await prisma.sale.findFirst({ where: { tenantId: OBS, id: claimed.id }, select: { cashierId: true, attribution: true } })
    expect([row?.cashierId, basisOf(row?.attribution)]).toEqual([OBS_OWNER, "claimed"])
    expect((await op("sale", "void", { id: claimed.id, saleNumber: claimed.saleNumber })).body.results[0].status).toBe("ok")
    const v = await prisma.sale.findFirst({ where: { tenantId: OBS, id: claimed.id }, select: { voidedById: true, voidAttribution: true, cashierId: true } })
    expect([v?.voidedById, basisOf(v?.voidAttribution), v?.cashierId]).toEqual([null, "unattributed", OBS_OWNER])
    expect((await prisma.sale.findUnique({ where: { id: old.id }, select: { attribution: true } }))?.attribution).toBeNull()
  })
})
