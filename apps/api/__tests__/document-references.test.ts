import { describe, it, expect, beforeAll, afterAll } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomUUID } from "node:crypto"
import jwt from "jsonwebtoken"

// RELEASE BLOCKER: document references (real Postgres).
//
// Sale, shift, expense and purchase-order numbers are generated offline on
// each device; the same number can legitimately appear twice in one tenant
// (docs/evidence/reference-collisions.cjs). Record ids are the identity.
// Under test:
//  - a legitimate record whose display reference is already used is accepted
//    and has its full effect (stock, debt, drawer);
//  - nothing that relates records (void → debt, debt delete gate, deletions)
//    picks "some record with that number": relationships use ids;
//  - retries stay idempotent; concurrent devices; tenant scope.
process.env.JWT_SECRET = process.env.JWT_SECRET || "doc-ref-secret"

const prisma = (await import("../src/lib/prisma.js")).default
const app = (await import("../src/app.js")).default

let server: http.Server
let baseUrl = ""
const TENANT = randomUUID()
const OTHER = randomUUID()
const ADMIN = randomUUID()
const OTHER_ADMIN = randomUUID()
const DEV_A = `DR-A-${TENANT.slice(0, 8)}`
const DEV_B = `DR-B-${TENANT.slice(0, 8)}`
const DEV_O = `DR-O-${OTHER.slice(0, 8)}`
let token = ""
let otherToken = ""
let productId = 0
let supplierId = ""
const customers: string[] = []

async function push(deviceId: string, entity: string, action: string, payload: unknown, opts: { token?: string; opId?: string } = {}) {
  const res = await fetch(`${baseUrl}/api/sync/push`, {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.token ?? token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId, operations: [{ id: opts.opId ?? randomUUID(), entity, action, payload }] }),
  })
  const body = (await res.json()) as any
  if (!body?.results) throw new Error(`push refused: HTTP ${res.status} ${JSON.stringify(body).slice(0, 300)}`)
  return body.results[0] as { status: string; error?: string }
}
const stock = async () => Number((await prisma.product.findUnique({ where: { id: productId } }))!.stock)

function salePayload(saleNumber: string, qty = 1, extra: Record<string, unknown> = {}) {
  return {
    id: randomUUID(), saleNumber, paymentMethod: "Cash", subtotal: qty * 5, tax: 0, total: qty * 5, cost: 0, profit: 0, cashier: "IT", status: "Completed",
    items: [{ id: productId, lineId: randomUUID(), name: "Doc ref widget", barcode: `DR-${TENANT.slice(0, 8)}`, quantity: qty, unitPrice: 5, total: qty * 5, cost: 2, batchAllocations: [] }],
    ...extra,
  }
}
function debtPayload(saleNumber: string, customerId: string, total: number, extra: Record<string, unknown> = {}) {
  return { id: randomUUID(), customerId, saleNumber, subtotal: total, discountTotal: 0, tax: 0, total, items: [], createdAt: new Date().toISOString(), ...extra }
}
const debtsOf = (customerId: string) => prisma.debtSale.findMany({ where: { tenantId: TENANT, customerId } })

beforeAll(async () => {
  server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, resolve))
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`
  for (const [tenantId, userId, devices] of [[TENANT, ADMIN, [DEV_A, DEV_B]], [OTHER, OTHER_ADMIN, [DEV_O]]] as const) {
    await prisma.tenant.create({ data: { id: tenantId, name: "Doc ref IT (disposable)", subdomain: `dr-${tenantId.slice(0, 8)}` } })
    await prisma.staffUser.create({ data: { id: userId, tenantId, name: "IT", mobile: `dr-${tenantId.slice(0, 6)}`, pin: "x", role: "Admin" } })
    for (const deviceId of devices) await prisma.device.create({ data: { tenantId, deviceId, deviceName: deviceId, status: "APPROVED" } })
  }
  token = jwt.sign({ userId: ADMIN, tenantId: TENANT, role: "Admin" }, process.env.JWT_SECRET!, { expiresIn: "1h" })
  otherToken = jwt.sign({ userId: OTHER_ADMIN, tenantId: OTHER, role: "Admin" }, process.env.JWT_SECRET!, { expiresIn: "1h" })
  const product = await prisma.product.create({ data: { tenantId: TENANT, name: "Doc ref widget", price: 5, cost: 2, stock: 100, barcode: `DR-${TENANT.slice(0, 8)}`, category: "Test" } })
  productId = product.id
  supplierId = (await prisma.supplier.create({ data: { tenantId: TENANT, name: "Doc ref supplier" } })).id
  for (const name of ["Nour", "Karim", "Hadi"]) {
    customers.push((await prisma.customer.create({ data: { tenantId: TENANT, name, mobile: `dr-${randomUUID().slice(0, 8)}`, creditLimit: 1000 } })).id)
  }
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
  for (const tenantId of [TENANT, OTHER]) {
    await prisma.stockMovement.deleteMany({ where: { tenantId } })
    await prisma.syncOperation.deleteMany({ where: { tenantId } })
    await prisma.debtPayment.deleteMany({ where: { tenantId } })
    await prisma.debtSale.deleteMany({ where: { tenantId } })
    await prisma.saleRefund.deleteMany({ where: { tenantId } })
    await prisma.sale.deleteMany({ where: { tenantId } })
    await prisma.expense.deleteMany({ where: { tenantId } })
    await prisma.purchaseOrderItem.deleteMany({ where: { tenantId } })
    await prisma.purchaseOrder.deleteMany({ where: { tenantId } })
    await prisma.shift.deleteMany({ where: { tenantId } })
    await prisma.auditEvent.deleteMany({ where: { tenantId } })
    await prisma.device.deleteMany({ where: { tenantId } })
    await prisma.customer.deleteMany({ where: { tenantId } })
    await prisma.supplier.deleteMany({ where: { tenantId } })
    await prisma.product.deleteMany({ where: { tenantId } })
    await prisma.staffUser.deleteMany({ where: { tenantId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
  }
})

describe("document references are display references, ids are identities (real Postgres)", () => {
  it("two devices' sales with the same number are both accepted and both move stock; a retry applies once", async () => {
    const s0 = await stock()
    const a = salePayload("S-48291177", 2)
    const b = salePayload("S-48291177", 3)
    expect(await push(DEV_A, "sale", "create", a)).toMatchObject({ status: "ok" })
    expect(await push(DEV_B, "sale", "create", b)).toMatchObject({ status: "ok" })
    expect(await push(DEV_B, "sale", "create", b)).toMatchObject({ status: "ok" }) // retry
    expect(await prisma.sale.count({ where: { tenantId: TENANT, saleNumber: "S-48291177" } })).toBe(2)
    expect(await stock()).toBe(s0 - 5)
  })

  it("concurrent devices pushing the same number at the same moment both succeed", async () => {
    const s0 = await stock()
    const results = await Promise.all([push(DEV_A, "sale", "create", salePayload("S-77777711")), push(DEV_B, "sale", "create", salePayload("S-77777711"))])
    expect(results.map((r) => r.status)).toEqual(["ok", "ok"])
    expect(await stock()).toBe(s0 - 2)
  })

  it("voiding one of two same-numbered debt sales removes only its own customer's debt", async () => {
    const [nour, karim] = customers
    const a = salePayload("S-30300011", 1, { paymentMethod: "Debt", status: "Debt", customerId: nour })
    const b = salePayload("S-30300011", 1, { paymentMethod: "Debt", status: "Debt", customerId: karim })
    for (const [dev, sale, cust] of [[DEV_A, a, nour], [DEV_B, b, karim]] as const) {
      expect(await push(dev, "sale", "create", sale)).toMatchObject({ status: "ok" })
      expect(await push(dev, "debt", "create", debtPayload("S-30300011", cust, 5, { saleId: sale.id }))).toMatchObject({ status: "ok" })
    }
    expect(await push(DEV_A, "sale", "void", { id: a.id, saleNumber: "S-30300011" })).toMatchObject({ status: "ok" })
    expect(await debtsOf(nour)).toHaveLength(0)
    expect(await debtsOf(karim)).toHaveLength(1)
  })

  it("an old client's debt (no saleId) is linked to its sale, and its void removes only that debt", async () => {
    const [, , hadi] = customers
    const sale = salePayload("S-41400011", 1, { paymentMethod: "Debt", status: "Debt", customerId: hadi })
    expect(await push(DEV_A, "sale", "create", sale)).toMatchObject({ status: "ok" })
    const debt = debtPayload("S-41400011", hadi, 5) // pre-release clients send no saleId
    expect(await push(DEV_A, "debt", "create", debt)).toMatchObject({ status: "ok" })
    expect((await prisma.debtSale.findFirst({ where: { id: debt.id, tenantId: TENANT } }) as any)?.saleId).toBe(sale.id)
    // A different sale (other device) reuses the number with no debt.
    expect(await push(DEV_B, "sale", "create", salePayload("S-41400011"))).toMatchObject({ status: "ok" })
    expect(await push(DEV_A, "sale", "void", { id: sale.id, saleNumber: "S-41400011" })).toMatchObject({ status: "ok" })
    expect(await prisma.debtSale.count({ where: { id: debt.id, tenantId: TENANT } })).toBe(0)
  })

  it("an old client's debt delete is gated on ITS sale, not on whichever sale shares the number", async () => {
    const [nour, karim] = customers
    const voided = salePayload("S-52500011", 1, { paymentMethod: "Debt", status: "Debt", customerId: nour })
    const live = salePayload("S-52500011", 1, { paymentMethod: "Debt", status: "Debt", customerId: karim })
    const liveDebt = debtPayload("S-52500011", karim, 5, { saleId: live.id })
    expect(await push(DEV_A, "sale", "create", voided)).toMatchObject({ status: "ok" })
    expect(await push(DEV_B, "sale", "create", live)).toMatchObject({ status: "ok" })
    expect(await push(DEV_B, "debt", "create", liveDebt)).toMatchObject({ status: "ok" })
    expect(await push(DEV_A, "sale", "void", { id: voided.id, saleNumber: "S-52500011" })).toMatchObject({ status: "ok" })
    // Old-client void flow sends the debt delete with the number; this debt's sale is NOT voided.
    expect(await push(DEV_B, "debt", "delete", { id: liveDebt.id, saleNumber: "S-52500011" })).toMatchObject({ status: "ok" })
    expect(await prisma.debtSale.count({ where: { id: liveDebt.id, tenantId: TENANT } })).toBe(1)
  })

  it("an ambiguous legacy debt (no saleId, number shared by two customers' sales) is never deleted by the other sale's void", async () => {
    const [nour, karim] = customers
    const a = salePayload("S-63600011", 1, { paymentMethod: "Debt", status: "Debt", customerId: nour })
    const b = salePayload("S-63600011", 1, { paymentMethod: "Debt", status: "Debt", customerId: karim })
    expect(await push(DEV_A, "sale", "create", a)).toMatchObject({ status: "ok" })
    expect(await push(DEV_B, "sale", "create", b)).toMatchObject({ status: "ok" })
    // Legacy rows written before the link existed.
    const legacyB = await prisma.debtSale.create({ data: { id: randomUUID(), tenantId: TENANT, customerId: karim, saleNumber: "S-63600011", subtotal: 5, tax: 0, total: 5 } as any })
    expect(await push(DEV_A, "sale", "void", { id: a.id, saleNumber: "S-63600011" })).toMatchObject({ status: "ok" })
    expect(await prisma.debtSale.count({ where: { id: legacyB.id } })).toBe(1)
  })

  it("two devices' shifts, expenses and purchase orders with the same numbers are all accepted; retries apply once", async () => {
    for (const dev of [DEV_A, DEV_B]) {
      const shift = { id: randomUUID(), shiftNumber: "SHIFT-001", status: "Open", openedAt: new Date().toISOString(), openedById: ADMIN, openedByName: "IT", openingFloatUsd: 50 }
      expect(await push(dev, "shift", "open", shift)).toMatchObject({ status: "ok" })
      expect(await push(dev, "shift", "open", shift)).toMatchObject({ status: "ok" })
      const expense = { id: randomUUID(), expenseNumber: "EXP-482911", vendor: "EDL", category: "Utilities", amount: 12, paymentMethod: "Cash", recordedBy: "IT", shiftId: shift.id, createdAt: new Date().toISOString() }
      expect(await push(dev, "expense", "create", expense)).toMatchObject({ status: "ok" })
      expect(await push(dev, "expense", "create", expense)).toMatchObject({ status: "ok" })
      const po = { id: randomUUID(), poNumber: "PO-482911", supplierId, supplierName: "Doc ref supplier", status: "Received", total: 40, createdBy: "IT", items: [{ name: "Doc ref widget", barcode: "x", quantity: 8, unitCost: 5, total: 40 }] }
      expect(await push(dev, "purchase-order", "create", po)).toMatchObject({ status: "ok" })
    }
    expect(await prisma.shift.count({ where: { tenantId: TENANT, shiftNumber: "SHIFT-001" } })).toBe(2)
    expect(await prisma.expense.count({ where: { tenantId: TENANT, expenseNumber: "EXP-482911" } })).toBe(2)
    expect(await prisma.purchaseOrder.count({ where: { tenantId: TENANT, poNumber: "PO-482911" } })).toBe(2)
  })

  it("tenant scope: another tenant can neither overwrite these records by id nor void this tenant's sale", async () => {
    const shift = { id: randomUUID(), shiftNumber: "SHIFT-900", status: "Open", openedAt: new Date().toISOString(), openedById: ADMIN, openedByName: "IT", openingFloatUsd: 50 }
    expect(await push(DEV_A, "shift", "open", shift)).toMatchObject({ status: "ok" })
    const sale = salePayload("S-90000011")
    expect(await push(DEV_A, "sale", "create", sale)).toMatchObject({ status: "ok" })
    const hijack = await push(DEV_O, "shift", "open", { ...shift, openedById: OTHER_ADMIN, openingFloatUsd: 9999, shiftNumber: "HIJACK" }, { token: otherToken })
    const row = await prisma.shift.findUnique({ where: { id: shift.id } })
    expect({ tenantId: row!.tenantId, float: Number(row!.openingFloatUsd), number: row!.shiftNumber }).toEqual({ tenantId: TENANT, float: 50, number: "SHIFT-900" })
    expect(hijack.status).toBe("rejected")
    await push(DEV_O, "sale", "void", { id: sale.id, saleNumber: "S-90000011" }, { token: otherToken })
    expect((await prisma.sale.findUnique({ where: { id: sale.id } }))!.status).toBe("Completed")
  })
  it("the new debt link reaches only schema-2 clients (old hubs re-insert pulled rows verbatim)", async () => {
    const get = async (path: string, headers: Record<string, string> = {}) => (await (await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}`, ...headers } })).json()) as any
    const legacy = await get("/api/sync/pull/full/debt-sales?limit=5000")
    expect(legacy.items.length).toBeGreaterThan(0)
    expect(legacy.items.every((d: any) => !("saleId" in d))).toBe(true)
    const modern = await get("/api/sync/pull/full/debt-sales?limit=5000", { "x-titan-sync-schema": "2" })
    expect(modern.items.some((d: any) => typeof d.saleId === "string")).toBe(true)
    const inc = await get("/api/sync/pull?since=2000-01-01T00:00:00Z")
    expect(inc.debtSales.every((d: any) => !("saleId" in d))).toBe(true)
  })
})
