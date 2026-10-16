import { describe, it, expect, beforeAll, afterAll } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomUUID } from "node:crypto"
import jwt from "jsonwebtoken"

// STOCK-REVIEW — real-Postgres checks of the server Z-report (shift close):
//  - concurrent closes: exactly one succeeds, the stored close is the winner's;
//  - expected cash counts CASH only (refunds, expenses, supplier payments by
//    method) plus cash in / out, the same formula as the desktop drawer;
//  - a caller can never read or close another tenant's shift (?tenantId=).
// The mocked reports.test.ts cannot exercise row locking; this does.
process.env.JWT_SECRET = process.env.JWT_SECRET || "z-report-secret"

const prisma = (await import("../src/lib/prisma.js")).default
const app = (await import("../src/app.js")).default

let server: http.Server
let baseUrl = ""
const TENANT_A = randomUUID()
const TENANT_B = randomUUID()
const USER_A = randomUUID()
const USER_B = randomUUID()
let tokenA = ""
let tokenB = ""

async function call(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, body: (await res.json()) as any }
}

async function openShift(tenantId: string, float = 100) {
  return prisma.shift.create({
    data: { id: randomUUID(), tenantId, shiftNumber: `Z-${randomUUID().slice(0, 8)}`, status: "Open", openedAt: new Date(Date.now() - 60_000), openedById: tenantId === TENANT_A ? USER_A : USER_B, openedByName: "IT", openingFloatUsd: float } as any,
  })
}

/** Sales, refunds, expenses, supplier payments and drawer movements across every method. */
async function seedShiftActivity(tenantId: string, shiftId: string) {
  const sale = (method: string, total: number) => prisma.sale.create({
    data: { id: randomUUID(), tenantId, shiftId, saleNumber: `ZS-${randomUUID().slice(0, 8)}`, paymentMethod: method, subtotal: total, tax: 0, total, cost: 0, profit: total, cashier: "IT", status: method === "Debt" ? "Debt" : "Completed" } as any,
  })
  const cash = await sale("Cash", 100)
  await sale("Card", 50)
  await sale("Debt", 30)
  const refund = (method: string, total: number) => prisma.saleRefund.create({
    data: { id: randomUUID(), tenantId, shiftId, refundNumber: `ZR-${randomUUID().slice(0, 6)}`, saleId: cash.id, saleNumber: cash.saleNumber, method, reason: "IT", total, cashier: "IT" } as any,
  })
  await refund("Cash", 10)
  await refund("Card", 5)
  await refund("Debt_Credit", 7)
  const expense = (paymentMethod: string, amount: number) => prisma.expense.create({
    data: { id: randomUUID(), tenantId, shiftId, expenseNumber: `ZE-${randomUUID().slice(0, 6)}`, vendor: "IT", category: "Other", amount, paymentMethod, recordedBy: "IT" } as any,
  })
  await expense("Cash", 3)
  await expense("Card", 4)
  return { cashSales: 100, cashRefunds: 10, cashExpenses: 3 }
}

beforeAll(async () => {
  server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, resolve))
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`
  for (const [tenantId, userId] of [[TENANT_A, USER_A], [TENANT_B, USER_B]]) {
    await prisma.tenant.create({ data: { id: tenantId, name: "Z-report IT (disposable)", subdomain: `zr-${tenantId.slice(0, 8)}` } })
    await prisma.staffUser.create({ data: { id: userId, tenantId, name: "IT", mobile: `zr-${tenantId.slice(0, 6)}`, pin: "x", role: "Admin" } })
  }
  tokenA = jwt.sign({ userId: USER_A, tenantId: TENANT_A, role: "Admin" }, process.env.JWT_SECRET!, { expiresIn: "1h" })
  tokenB = jwt.sign({ userId: USER_B, tenantId: TENANT_B, role: "Admin" }, process.env.JWT_SECRET!, { expiresIn: "1h" })
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
  for (const tenantId of [TENANT_A, TENANT_B]) {
    await prisma.saleRefund.deleteMany({ where: { tenantId } })
    await prisma.sale.deleteMany({ where: { tenantId } })
    await prisma.expense.deleteMany({ where: { tenantId } })
    await prisma.supplierPayment.deleteMany({ where: { tenantId } })
    await prisma.cashMovement.deleteMany({ where: { tenantId } })
    await prisma.supplier.deleteMany({ where: { tenantId } })
    await prisma.shift.deleteMany({ where: { tenantId } })
    await prisma.auditEvent.deleteMany({ where: { tenantId } })
    await prisma.staffUser.deleteMany({ where: { tenantId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
  }
})

describe("server Z-report close (real Postgres)", () => {
  it("of ten concurrent closes exactly one succeeds, and the stored close is the winner's", async () => {
    const shift = await openShift(TENANT_A)
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      call("POST", "/api/reports/z-report", tokenA, { shiftId: shift.id, closingCash: 100 + i })))
    const winners = results.filter((r) => r.status === 200)
    expect(winners).toHaveLength(1)
    expect(results.filter((r) => r.status === 409)).toHaveLength(9)
    const stored = await prisma.shift.findUnique({ where: { id: shift.id } })
    expect(stored!.status).toBe("Closed")
    expect(Number(stored!.closingCashUsd)).toBe(winners[0].body.shift.closingCash)
    expect(Number(stored!.expectedCashUsd)).toBe(winners[0].body.cashReconciliation.expectedCash)
  })

  it("expected cash counts only cash: card/debt refunds and card expenses do not reduce the drawer; cash in/out do move it", async () => {
    const shift = await openShift(TENANT_A, 100)
    const { cashSales, cashRefunds, cashExpenses } = await seedShiftActivity(TENANT_A, shift.id)
    const supplier = await prisma.supplier.create({ data: { tenantId: TENANT_A, name: "Z supplier" } })
    await prisma.supplierPayment.createMany({
      data: [
        { id: randomUUID(), tenantId: TENANT_A, shiftId: shift.id, supplierId: supplier.id, supplierName: "IT", amount: 2, method: "Cash", recordedBy: "IT" },
        { id: randomUUID(), tenantId: TENANT_A, shiftId: shift.id, supplierId: supplier.id, supplierName: "IT", amount: 6, method: "Card", recordedBy: "IT" },
      ] as any,
    })
    const supplierCash = 2
    await prisma.cashMovement.createMany({
      data: [
        { id: randomUUID(), tenantId: TENANT_A, shiftId: shift.id, type: "CashIn", direction: "In", amountUsd: 20, reason: "IT", recordedByName: "IT" },
        { id: randomUUID(), tenantId: TENANT_A, shiftId: shift.id, type: "SafeDrop", direction: "Out", amountUsd: 8, reason: "IT", recordedByName: "IT" },
      ],
    })
    const expected = 100 + cashSales - cashRefunds - cashExpenses - supplierCash + 20 - 8
    const res = await call("POST", "/api/reports/z-report", tokenA, { shiftId: shift.id, closingCash: expected })
    expect(res.status).toBe(200)
    expect(res.body.cashReconciliation.expectedCash).toBe(expected)
    expect(res.body.cashReconciliation.difference).toBe(0)
  })

  it("a caller cannot read or close another tenant's shift by passing ?tenantId=", async () => {
    const shiftA = await openShift(TENANT_A, 55)
    // Tenant B has no open shift; it asks for tenant A's.
    const close = await call("POST", `/api/reports/z-report?tenantId=${TENANT_A}`, tokenB, { closingCash: 0 })
    expect(close.status).toBe(404)
    expect((await prisma.shift.findUnique({ where: { id: shiftA.id } }))!.status).toBe("Open")
    const byId = await call("POST", `/api/reports/z-report?tenantId=${TENANT_A}`, tokenB, { shiftId: shiftA.id, closingCash: 0 })
    expect(byId.status).toBe(404)
    expect((await prisma.shift.findUnique({ where: { id: shiftA.id } }))!.status).toBe("Open")
    const x = await call("GET", `/api/reports/x-report?tenantId=${TENANT_A}`, tokenB)
    expect(JSON.stringify(x.body)).not.toContain(shiftA.shiftNumber)
    await prisma.shift.update({ where: { id: shiftA.id }, data: { status: "Closed" } as any })
  })
})
