import { describe, it, expect, beforeAll, afterAll } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomUUID } from "node:crypto"
import jwt from "jsonwebtoken"

// TENANT SCOPE (real Postgres). Record ids are unique across the whole
// database, and many sync handlers upsert/update by id. For every id-keyed
// write path:
//  - tenant B replaying tenant A's id (create/update/close/void/delete/adjust/
//    receive) is REJECTED ("rejected", never retried) and A's row is unchanged;
//  - tenant A retrying its own operation is accepted and applied once.
// The guard refuses an existing row whose owner is not the caller — a row
// whose tenant cannot be established is never treated as writable.
process.env.JWT_SECRET = process.env.JWT_SECRET || "tenant-scope-secret"

const prisma = (await import("../src/lib/prisma.js")).default
const app = (await import("../src/app.js")).default

let server: http.Server
let baseUrl = ""
const A = randomUUID(), B = randomUUID()
const ADMIN_A = randomUUID(), ADMIN_B = randomUUID()
const DEV_A = `TS-A-${A.slice(0, 8)}`, DEV_B = `TS-B-${B.slice(0, 8)}`
const tokens: Record<string, string> = {}
let productA = 0
let customerA = "", supplierA = ""

async function push(tenant: "A" | "B", entity: string, action: string, payload: unknown) {
  const res = await fetch(`${baseUrl}/api/sync/push`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokens[tenant]}`, "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId: tenant === "A" ? DEV_A : DEV_B, operations: [{ id: randomUUID(), entity, action, payload }] }),
  })
  const body = (await res.json()) as any
  if (!body?.results) throw new Error(`push refused: HTTP ${res.status} ${JSON.stringify(body).slice(0, 300)}`)
  return body.results[0] as { status: string; error?: string }
}
const stockA = async () => Number((await prisma.product.findUnique({ where: { id: productA } }))!.stock)
const row = (model: string, id: string) => (prisma as any)[model].findUnique({ where: { id } })
const plain = (r: any) => JSON.parse(JSON.stringify(r, (_k, v) => (typeof v === "object" && v !== null && "toFixed" in v ? Number(v) : v)))

beforeAll(async () => {
  server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, resolve))
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`
  for (const [t, tenantId, admin, dev] of [["A", A, ADMIN_A, DEV_A], ["B", B, ADMIN_B, DEV_B]] as const) {
    await prisma.tenant.create({ data: { id: tenantId, name: `Tenant scope IT ${t} (disposable)`, subdomain: `ts-${tenantId.slice(0, 8)}` } })
    await prisma.staffUser.create({ data: { id: admin, tenantId, name: `Admin ${t}`, mobile: `ts-${tenantId.slice(0, 6)}`, pin: "x", role: "Admin" } })
    await prisma.device.create({ data: { tenantId, deviceId: dev, deviceName: dev, status: "APPROVED" } })
    tokens[t] = jwt.sign({ userId: admin, tenantId, role: "Admin" }, process.env.JWT_SECRET!, { expiresIn: "1h" })
  }
  productA = (await prisma.product.create({ data: { tenantId: A, name: "Scope widget", price: 5, cost: 2, stock: 50, barcode: `TS-${A.slice(0, 8)}`, category: "Test" } })).id
  customerA = (await prisma.customer.create({ data: { tenantId: A, name: "Nour", mobile: `ts-${randomUUID().slice(0, 8)}`, creditLimit: 500 } })).id
  supplierA = (await prisma.supplier.create({ data: { tenantId: A, name: "Malia" } })).id
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
  for (const tenantId of [A, B]) {
    for (const m of ["stockMovement", "syncOperation", "debtPayment", "debtSale", "saleRefund", "sale", "expense", "purchaseOrderItem", "purchaseOrder", "supplierPayment",
      "cashMovement", "dailyClose", "deliveryOrderItem", "deliveryOrder", "stockAdjustment", "inventoryBatch", "shift", "auditEvent", "device", "customer", "supplier", "product"]) {
      await (prisma as any)[m].deleteMany({ where: { tenantId } }).catch(() => {})
    }
    await prisma.staffUser.deleteMany({ where: { tenantId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
  }
})

type Case = { name: string; entity: string; action: string; model: string; payload: () => Record<string, unknown>; hijack: (p: Record<string, unknown>) => Record<string, unknown> }
const now = () => new Date().toISOString()
const CASES: Case[] = [
  { name: "shift open", entity: "shift", action: "open", model: "shift",
    payload: () => ({ id: randomUUID(), shiftNumber: "SHIFT-A-001", status: "Open", openedAt: now(), openedById: ADMIN_A, openedByName: "A", openingFloatUsd: 50 }),
    hijack: (p) => ({ ...p, openedById: ADMIN_B, openingFloatUsd: 9999, shiftNumber: "HIJACK" }) },
  { name: "expense", entity: "expense", action: "create", model: "expense",
    payload: () => ({ id: randomUUID(), expenseNumber: "EXP-A-1", vendor: "EDL", category: "Utilities", amount: 12, paymentMethod: "Cash", recordedBy: "A", createdAt: now() }),
    hijack: (p) => ({ ...p, amount: 999, vendor: "HIJACK" }) },
  { name: "customer", entity: "customer", action: "create", model: "customer",
    payload: () => ({ id: randomUUID(), name: "Karim", mobile: `ts-${randomUUID().slice(0, 8)}`, creditLimit: 100 }),
    hijack: (p) => ({ ...p, name: "HIJACK", creditLimit: 99999 }) },
  { name: "supplier", entity: "supplier", action: "create", model: "supplier",
    payload: () => ({ id: randomUUID(), name: "Gandour" }),
    hijack: (p) => ({ ...p, name: "HIJACK" }) },
  { name: "staff (role)", entity: "staff", action: "create", model: "staffUser",
    payload: () => ({ id: randomUUID(), name: "Maya", mobile: `ts-${randomUUID().slice(0, 8)}`, pin: String(1000 + Math.floor(Math.random() * 8999)), role: "Cashier" }),
    hijack: (p) => ({ ...p, name: "HIJACK", role: "Admin", pin: "4321" }) },
  { name: "debt sale", entity: "debt", action: "create", model: "debtSale",
    payload: () => ({ id: randomUUID(), customerId: customerA, saleNumber: "S-A-1", subtotal: 5, tax: 0, total: 5, createdAt: now() }),
    hijack: (p) => ({ ...p, total: 999 }) },
  { name: "debt payment", entity: "debt", action: "payment", model: "debtPayment",
    payload: () => ({ id: randomUUID(), customerId: customerA, amount: 10, method: "Cash", createdAt: now() }),
    hijack: (p) => ({ ...p, amount: 999 }) },
  { name: "purchase order", entity: "purchase-order", action: "create", model: "purchaseOrder",
    payload: () => ({ id: randomUUID(), poNumber: "PO-A-1", supplierId: supplierA, supplierName: "Malia", status: "Received", total: 40, createdBy: "A", items: [{ name: "Scope widget", barcode: "x", quantity: 8, unitCost: 5, total: 40 }] }),
    hijack: (p) => ({ ...p, total: 999, supplierName: "HIJACK", items: [] }) },
  { name: "supplier payment", entity: "supplier-payment", action: "payment", model: "supplierPayment",
    payload: () => ({ id: randomUUID(), supplierId: supplierA, supplierName: "Malia", amount: 30, method: "Cash", recordedBy: "A" }),
    hijack: (p) => ({ ...p, amount: 999 }) },
  { name: "cash movement", entity: "cash-movement", action: "create", model: "cashMovement",
    payload: () => ({ id: randomUUID(), type: "CashIn", direction: "In", amountUsd: 20, reason: "float", recordedByName: "A" }),
    hijack: (p) => ({ ...p, amountUsd: 999, reason: "HIJACK" }) },
  { name: "daily close", entity: "daily-close", action: "close", model: "dailyClose",
    payload: () => ({ id: randomUUID(), dateKey: `2026-10-${String(10 + Math.floor(Math.random() * 18)).padStart(2, "0")}-${randomUUID().slice(0, 4)}`, grossSales: 100, netSales: 90, closedBy: "A" }),
    hijack: (p) => ({ ...p, netSales: 0, closedBy: "HIJACK" }) },
  { name: "delivery order", entity: "delivery-order", action: "create", model: "deliveryOrder",
    payload: () => ({ id: randomUUID(), orderNumber: `DEL-A-${randomUUID().slice(0, 6)}`, customerName: "Hadi", customerPhone: "03 000 000", address: "Hamra", itemsTotal: 10, total: 12, items: [] }),
    hijack: (p) => ({ ...p, total: 0, address: "HIJACK" }) },
]

describe("tenant scope of id-keyed writes (real Postgres)", () => {
  for (const c of CASES) {
    it(`${c.name}: another tenant cannot overwrite it; the owner's retry is applied once`, async () => {
      const payload = c.payload()
      expect(await push("A", c.entity, c.action, payload)).toMatchObject({ status: "ok" })
      const before = plain(await row(c.model, payload.id as string))
      expect(before.tenantId).toBe(A)

      const hijack = await push("B", c.entity, c.action, c.hijack(payload))
      expect(hijack.status).toBe("rejected")
      expect(hijack.error).toMatch(/TENANT_SCOPE/)
      const after = plain(await row(c.model, payload.id as string))
      expect({ ...after, updatedAt: undefined }).toEqual({ ...before, updatedAt: undefined })

      // Owner's retry of the same operation: accepted, still one row.
      expect(await push("A", c.entity, c.action, payload)).toMatchObject({ status: "ok" })
      expect(await (prisma as any)[c.model].count({ where: { id: payload.id } })).toBe(1)
    })
  }

  it("shift close, debt delete and sale void with another tenant's ids are rejected and change nothing", async () => {
    const shift = { id: randomUUID(), shiftNumber: "SHIFT-A-009", status: "Open", openedAt: now(), openedById: ADMIN_A, openedByName: "A", openingFloatUsd: 50 }
    expect(await push("A", "shift", "open", shift)).toMatchObject({ status: "ok" })
    expect((await push("B", "shift", "close", { id: shift.id, closingCashUsd: 0 })).status).toBe("rejected")
    expect((await row("shift", shift.id)).status).toBe("Open")

    const debt = { id: randomUUID(), customerId: customerA, saleNumber: "S-A-9", subtotal: 5, tax: 0, total: 5, createdAt: now() }
    expect(await push("A", "debt", "create", debt)).toMatchObject({ status: "ok" })
    expect((await push("B", "debt", "delete", { id: debt.id, saleNumber: "S-A-9" })).status).toBe("rejected")
    expect(await prisma.debtSale.count({ where: { id: debt.id } })).toBe(1)

    const s0 = await stockA()
    const sale = { id: randomUUID(), saleNumber: "S-A-10", paymentMethod: "Cash", subtotal: 5, tax: 0, total: 5, cost: 0, profit: 0, cashier: "A", status: "Completed",
      items: [{ id: productA, lineId: randomUUID(), name: "Scope widget", barcode: `TS-${A.slice(0, 8)}`, quantity: 1, unitPrice: 5, total: 5, cost: 2, batchAllocations: [] }] }
    expect(await push("A", "sale", "create", sale)).toMatchObject({ status: "ok" })
    expect((await push("B", "sale", "void", { id: sale.id, saleNumber: "S-A-10" })).status).toBe("rejected")
    expect((await push("B", "sale", "create", { ...sale, total: 999 })).status).toBe("rejected")
    expect((await row("sale", sale.id)).status).toBe("Completed")
    expect(await stockA()).toBe(s0 - 1)
    // Owner's retry: no second decrement.
    expect(await push("A", "sale", "create", sale)).toMatchObject({ status: "ok" })
    expect(await stockA()).toBe(s0 - 1)
  })

  it("stock adjustments and received lots cannot be rewritten by another tenant; the owner's retries apply once", async () => {
    const s0 = await stockA()
    const adj = { id: randomUUID(), adjustmentNumber: "ADJ-A-1", productId: productA, productName: "Scope widget", barcode: `TS-${A.slice(0, 8)}`,
      quantityBefore: s0, quantityChange: -2, quantityAfter: s0 - 2, reason: "Damage", batchAllocations: [], valueImpact: -4, createdAt: now() }
    expect(await push("A", "inventory", "adjust", adj)).toMatchObject({ status: "ok" })
    expect((await push("B", "inventory", "adjust", { ...adj, reason: "HIJACK", quantityChange: 50 })).status).toBe("rejected")
    expect((await row("stockAdjustment", adj.id)).reason).toBe("Damage")
    expect(await push("A", "inventory", "adjust", adj)).toMatchObject({ status: "ok" })
    expect(await stockA()).toBe(s0 - 2)

    const lotId = `lot-${randomUUID()}`
    const lot = { id: lotId, batchNumber: "L-A-1", productId: productA, productName: "Scope widget", barcode: `TS-${A.slice(0, 8)}`, initialQuantity: 6, quantityRemaining: 6, unitCost: 2, unitPrice: 5, receivedAt: now() }
    expect(await push("A", "inventory", "receive", [lot])).toMatchObject({ status: "ok" })
    const s1 = await stockA()
    expect((await push("B", "inventory", "receive", [{ ...lot, batchNumber: "HIJACK", unitCost: 0 }])).status).toBe("rejected")
    const after = await row("inventoryBatch", lotId)
    expect({ tenantId: after.tenantId, batchNumber: after.batchNumber, unitCost: Number(after.unitCost) }).toEqual({ tenantId: A, batchNumber: "L-A-1", unitCost: 2 })
    expect(await push("A", "inventory", "receive", [lot])).toMatchObject({ status: "ok" })
    expect(await stockA()).toBe(s1)
  })
})
