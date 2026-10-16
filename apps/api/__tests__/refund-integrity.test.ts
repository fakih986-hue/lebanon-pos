import { describe, it, expect, beforeAll, afterAll } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomUUID } from "node:crypto"
import jwt from "jsonwebtoken"

// REFUND-INTEGRITY-1 — real-Postgres proof of the refund invariants.
//
// Like sync-stress.test.ts this does NOT mock prisma: row locks, transaction
// isolation and unique constraints are exactly what is under test, and a mock
// cannot exercise them. It needs the DATABASE_URL database to have the
// 20261016120000_refund_integrity migration applied. All data lives under one
// disposable tenant created here and deleted in afterAll.
process.env.JWT_SECRET = process.env.JWT_SECRET || "refund-it-secret"

const prisma = (await import("../src/lib/prisma.js")).default
const app = (await import("../src/app.js")).default

let server: http.Server
let baseUrl = ""
const TENANT_ID = randomUUID()
const ADMIN_ID = randomUUID()
let token = ""
let productId = 0
const BARCODE = `RIT-${TENANT_ID.slice(0, 8)}`
const DEVICE_ID = `RIT-DEV-${TENANT_ID.slice(0, 8)}`

async function request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, body: (await res.json()) as any }
}
async function push(entity: string, action: string, payload: unknown) {
  const res = await request("POST", "/api/sync/push", { deviceId: DEVICE_ID, operations: [{ id: randomUUID(), entity, action, payload }] })
  if (!res.body?.results) throw new Error(`push refused: HTTP ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`)
  return res.body.results[0] as { status: string; error?: string }
}
const stockOf = async () => Number((await prisma.product.findUnique({ where: { id: productId } }))!.stock)
const lotOf = async (id: string) => Number((await prisma.inventoryBatch.findUnique({ where: { id } }))!.quantityRemaining)

async function makeLots(qtyA: number, qtyB: number) {
  const a = `lot-a-${randomUUID()}`
  const b = `lot-b-${randomUUID()}`
  for (const [id, qty, cost] of [[a, qtyA, 2], [b, qtyB, 3]] as const) {
    await prisma.inventoryBatch.create({
      data: {
        id, tenantId: TENANT_ID, batchNumber: id, productId, productName: "Refund IT Widget", barcode: BARCODE,
        initialQuantity: qty, quantityRemaining: qty, unitCost: cost, unitPrice: 5,
      },
    })
  }
  await prisma.product.update({ where: { id: productId }, data: { stock: { increment: qtyA + qtyB } } })
  return { a, b }
}

/** Push a tracked sale of `qty` consuming lot A then lot B (as the till's dry-run would). */
async function sellTracked(qty: number, lots: { a: string; b: string }, split: [number, number], withTender = true) {
  const saleId = randomUUID()
  const lineId = randomUUID()
  const result = await push("sale", "create", {
    id: saleId, saleNumber: `S-${saleId.slice(0, 8)}`, paymentMethod: "Cash", subtotal: qty * 5, tax: 0, total: qty * 5,
    cost: 0, profit: 0, cashier: "IT", status: "Completed",
    ...(withTender ? { tender: { currency: "USD", exchangeRate: 89500, paidUsd: qty * 5, paidLbp: 0, paidTotalUsd: qty * 5, paidTotalLbp: qty * 5 * 89500, changeUsd: 0, changeLbp: 0, changeCurrency: "USD" } } : {}),
    items: [{
      id: productId, lineId, name: "Refund IT Widget", barcode: BARCODE, quantity: qty, unitPrice: 5, total: qty * 5, cost: 2,
      batchAllocations: [
        ...(split[0] ? [{ batchId: lots.a, batchNumber: "A", quantity: split[0], unitCost: 2 }] : []),
        ...(split[1] ? [{ batchId: lots.b, batchNumber: "B", quantity: split[1], unitCost: 3 }] : []),
      ],
    }],
  })
  expect(result.status).toBe("ok")
  return { saleId, lineId }
}
function refundPayload(saleId: string, lineId: string | null, quantity: number, total: number, extra: Record<string, unknown> = {}) {
  const id = randomUUID()
  return {
    id, refundNumber: `R-${id.slice(0, 10)}`, saleId, saleNumber: "S", method: "Cash", reason: "IT", total, cashier: "IT",
    items: [{ id: productId, ...(lineId ? { saleLineId: lineId } : {}), name: "Refund IT Widget", barcode: BARCODE, quantity, unitPrice: 5, total }],
    ...extra,
  }
}

beforeAll(async () => {
  server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, resolve))
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`
  await prisma.tenant.create({ data: { id: TENANT_ID, name: "Refund IT (disposable)", subdomain: `rit-${TENANT_ID.slice(0, 8)}` } })
  await prisma.staffUser.create({
    data: { id: ADMIN_ID, tenantId: TENANT_ID, name: "IT Admin", mobile: `rit-${TENANT_ID.slice(0, 6)}`, pin: "x", role: "Admin" },
  })
  // The API may run in hub mode (IS_LOCAL_SERVER), which only accepts approved devices.
  await prisma.device.create({ data: { tenantId: TENANT_ID, deviceId: DEVICE_ID, deviceName: "Refund IT", status: "APPROVED" } })
  token = jwt.sign({ userId: ADMIN_ID, tenantId: TENANT_ID, role: "Admin" }, process.env.JWT_SECRET!, { expiresIn: "1h" })
  const product = await prisma.product.create({
    data: { tenantId: TENANT_ID, name: "Refund IT Widget", price: 5, cost: 2, stock: 0, barcode: BARCODE, category: "Test" },
  })
  productId = product.id
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
  await prisma.stockMovement.deleteMany({ where: { tenantId: TENANT_ID } })
  await prisma.syncOperation.deleteMany({ where: { tenantId: TENANT_ID } })
  await prisma.debtPayment.deleteMany({ where: { tenantId: TENANT_ID } })
  await prisma.debtSale.deleteMany({ where: { tenantId: TENANT_ID } })
  await prisma.saleRefund.deleteMany({ where: { tenantId: TENANT_ID } })
  await prisma.sale.deleteMany({ where: { tenantId: TENANT_ID } })
  await prisma.inventoryBatch.deleteMany({ where: { tenantId: TENANT_ID } })
  await prisma.auditEvent.deleteMany({ where: { tenantId: TENANT_ID } })
  await prisma.device.deleteMany({ where: { tenantId: TENANT_ID } })
  await prisma.customer.deleteMany({ where: { tenantId: TENANT_ID } })
  await prisma.product.deleteMany({ where: { tenantId: TENANT_ID } })
  await prisma.staffUser.deleteMany({ where: { tenantId: TENANT_ID } })
  await prisma.tenant.deleteMany({ where: { id: TENANT_ID } })
})

describe("REFUND-INTEGRITY-1 against real Postgres", () => {
  it("persists the line identity and the lots the server actually consumed", async () => {
    const lots = await makeLots(6, 4)
    const { saleId, lineId } = await sellTracked(10, lots, [6, 4])
    const item = await prisma.saleItem.findFirst({ where: { saleId } })
    expect(item?.lineId).toBe(lineId)
    expect(item?.batchAllocations).toEqual([
      { batchId: lots.a, quantity: 6, unitCost: 2 },
      { batchId: lots.b, quantity: 4, unitCost: 3 },
    ])
    expect(await lotOf(lots.a)).toBe(0)
    expect(await lotOf(lots.b)).toBe(0)
  })

  it("repeated partial refunds restore the exact lots, and the original rate is kept", async () => {
    const lots = await makeLots(6, 4)
    const { saleId, lineId } = await sellTracked(10, lots, [6, 4])
    const stock0 = await stockOf()

    // The client claims the wrong lot; the server ignores it.
    expect((await push("refund", "create", refundPayload(saleId, lineId, 6, 30, {
      items: [{ id: productId, saleLineId: lineId, barcode: BARCODE, quantity: 6, batchAllocations: [{ batchId: lots.b, quantity: 6 }] }],
    }))).status).toBe("ok")
    expect(await lotOf(lots.a)).toBe(6)
    expect(await lotOf(lots.b)).toBe(0)

    expect((await push("refund", "create", refundPayload(saleId, lineId, 4, 20))).status).toBe("ok")
    expect(await lotOf(lots.a)).toBe(6)
    expect(await lotOf(lots.b)).toBe(4)
    expect(await stockOf()).toBe(stock0 + 10)

    const refunds = await prisma.saleRefund.findMany({ where: { saleId }, orderBy: { createdAt: "asc" } })
    expect(refunds.map((r) => [Number(r.exchangeRate), r.rateSource])).toEqual([[89500, "sale_tender"], [89500, "sale_tender"]])

    const over = await push("refund", "create", refundPayload(saleId, lineId, 1, 5))
    expect(over.status).toBe("rejected")
    expect(over.error).toMatch(/^REFUND_EXCEEDS_REFUNDABLE/)
    expect(await stockOf()).toBe(stock0 + 10)
  })

  it("two devices refunding the same sale at the same moment: exactly one wins, effects apply once", async () => {
    const lots = await makeLots(6, 4)
    const { saleId, lineId } = await sellTracked(10, lots, [6, 4])
    const stock0 = await stockOf()

    const [r1, r2] = await Promise.all([
      push("refund", "create", refundPayload(saleId, lineId, 10, 50)),
      push("refund", "create", refundPayload(saleId, lineId, 10, 50)),
    ])
    const statuses = [r1.status, r2.status].sort()
    expect(statuses).toEqual(["ok", "rejected"])
    expect([r1, r2].find((r) => r.status === "rejected")!.error).toMatch(/^REFUND_EXCEEDS_REFUNDABLE/)

    expect(await stockOf()).toBe(stock0 + 10)
    expect(await lotOf(lots.a)).toBe(6)
    expect(await lotOf(lots.b)).toBe(4)
    const refunds = await prisma.saleRefund.findMany({ where: { saleId } })
    expect(refunds).toHaveLength(1)
    expect(Number(refunds[0].total)).toBe(50)
  })

  it("refund and void of the same sale at the same moment: exactly one wins, stock restored once", async () => {
    for (let round = 0; round < 5; round++) {
      const lots = await makeLots(6, 4)
      const { saleId, lineId } = await sellTracked(10, lots, [6, 4])
      const stock0 = await stockOf()
      const [refund, voided] = await Promise.all([
        push("refund", "create", refundPayload(saleId, lineId, 10, 50)),
        push("sale", "void", { id: saleId }),
      ])
      const sale = await prisma.sale.findUnique({ where: { id: saleId } })
      const refunds = await prisma.saleRefund.count({ where: { saleId } })
      // Either the void won (sale voided, refund rejected) or the refund won (void rejected).
      if (sale!.status === "Voided") {
        expect(refund.status).toBe("rejected")
        expect(refund.error).toMatch(/^REFUND_SALE_VOIDED/)
        expect(refunds).toBe(0)
      } else {
        expect(voided.status).toBe("rejected")
        expect(voided.error).toMatch(/^VOID_HAS_REFUNDS/)
        expect(refunds).toBe(1)
      }
      expect(await stockOf()).toBe(stock0 + 10)
      expect(await lotOf(lots.a)).toBe(6)
      expect(await lotOf(lots.b)).toBe(4)
    }
  })

  it("two voids of the same sale at the same moment restore stock once", async () => {
    const lots = await makeLots(6, 4)
    const { saleId } = await sellTracked(10, lots, [6, 4])
    const stock0 = await stockOf()
    const results = await Promise.all([push("sale", "void", { id: saleId }), push("sale", "void", { id: saleId })])
    expect(results.map((r) => r.status)).not.toContain("rejected")
    expect(await stockOf()).toBe(stock0 + 10)
    expect(await lotOf(lots.a)).toBe(6)
    expect(await lotOf(lots.b)).toBe(4)
  })

  it("a retried refund (same id) is idempotent", async () => {
    const lots = await makeLots(5, 0)
    const { saleId, lineId } = await sellTracked(5, lots, [5, 0])
    const stock0 = await stockOf()
    const payload = refundPayload(saleId, lineId, 2, 10)
    const [a, b] = await Promise.all([push("refund", "create", payload), push("refund", "create", payload)])
    expect([a.status, b.status]).not.toContain("rejected")
    expect(await stockOf()).toBe(stock0 + 2)
    expect(await prisma.saleRefund.count({ where: { saleId } })).toBe(1)
  })

  it("legacy sale (pre-migration shape): pooled per product, product stock only, rate unavailable", async () => {
    const lots = await makeLots(5, 0)
    const saleId = randomUUID()
    await prisma.sale.create({
      data: {
        id: saleId, tenantId: TENANT_ID, saleNumber: `L-${saleId.slice(0, 8)}`, paymentMethod: "Cash",
        subtotal: 25, tax: 0, total: 25, cashier: "legacy",
        items: { create: [
          { productId, productName: "Refund IT Widget", barcode: BARCODE, quantity: 3, unitPrice: 5, total: 15 },
          { productId, productName: "Refund IT Widget", barcode: BARCODE, quantity: 2, unitPrice: 5, total: 10 },
        ] },
      },
    })
    const stock0 = await stockOf()
    const lot0 = await lotOf(lots.a)
    // An old client sends no line id.
    expect((await push("refund", "create", refundPayload(saleId, null, 4, 20))).status).toBe("ok")
    expect(await stockOf()).toBe(stock0 + 4)
    expect(await lotOf(lots.a)).toBe(lot0) // no lot guessed
    const refund = await prisma.saleRefund.findFirst({ where: { saleId }, include: { items: true } })
    expect(refund?.exchangeRate).toBeNull()
    expect(refund?.rateSource).toBe("unavailable")
    expect(refund?.items[0].saleLineId).toBe(`legacy-product:${productId}`)
    expect((await push("refund", "create", refundPayload(saleId, null, 2, 10))).status).toBe("rejected")
  })

  it("a sale with refunds cannot be voided; a clean void restores the recorded lots once", async () => {
    const lots = await makeLots(6, 4)
    const refunded = await sellTracked(10, lots, [6, 4])
    expect((await push("refund", "create", refundPayload(refunded.saleId, refunded.lineId, 1, 5))).status).toBe("ok")
    const blocked = await push("sale", "void", { id: refunded.saleId })
    expect(blocked.status).toBe("rejected")
    expect(blocked.error).toMatch(/^VOID_HAS_REFUNDS/)
    expect((await prisma.sale.findUnique({ where: { id: refunded.saleId } }))?.status).toBe("Completed")

    const lots2 = await makeLots(6, 4)
    const clean = await sellTracked(10, lots2, [6, 4])
    const stock0 = await stockOf()
    expect((await push("sale", "void", { id: clean.saleId })).status).toBe("ok")
    expect((await push("sale", "void", { id: clean.saleId })).status).toBe("ok") // retry is a no-op
    expect(await stockOf()).toBe(stock0 + 10)
    expect(await lotOf(lots2.a)).toBe(6)
    expect(await lotOf(lots2.b)).toBe(4)
  })

  it("a debt refund's customer credit is created with the refund, once — even if an old client also sends it", async () => {
    const lots = await makeLots(5, 0)
    const customer = await prisma.customer.create({ data: { tenantId: TENANT_ID, name: "Debt IT", mobile: `d-${randomUUID().slice(0, 8)}`, creditLimit: 500 } })
    const saleId = randomUUID()
    const lineId = randomUUID()
    expect((await push("sale", "create", {
      id: saleId, saleNumber: `D-${saleId.slice(0, 8)}`, paymentMethod: "Debt", customerId: customer.id, customerName: "Debt IT",
      subtotal: 25, tax: 0, total: 25, cost: 0, profit: 0, cashier: "IT", status: "Debt",
      items: [{ id: productId, lineId, name: "Refund IT Widget", barcode: BARCODE, quantity: 5, unitPrice: 5, total: 25, cost: 2, batchAllocations: [{ batchId: lots.a, quantity: 5, unitCost: 2 }] }],
    })).status).toBe("ok")
    const refund = refundPayload(saleId, lineId, 2, 10, { method: "Debt_Credit", customerId: customer.id })
    expect((await push("refund", "create", refund)).status).toBe("ok")
    const credits = () => prisma.debtPayment.findMany({ where: { tenantId: TENANT_ID, customerId: customer.id } })
    expect((await credits()).map((c) => [c.id, Number(c.amount), c.method])).toEqual([[`refund-credit:${refund.id}`, 10, "Refund Credit"]])

    // An older client sends the credit separately, with its own id.
    expect((await push("debt", "payment", { id: randomUUID(), customerId: customer.id, amount: 10, method: "Refund Credit", reference: `${refund.refundNumber} return for D-${saleId.slice(0, 8)}` })).status).toBe("ok")
    expect(await credits()).toHaveLength(1)

    // A credit whose refund never reached the server is not applied (it waits / retries visibly).
    const orphan = await push("debt", "payment", { id: randomUUID(), customerId: customer.id, amount: 10, method: "Refund Credit", reference: `R-NEVER return for D-${saleId.slice(0, 8)}` })
    expect(orphan.status).toBe("error")
    expect(await credits()).toHaveLength(1)
  })

  it("a rejected void of a debt sale does not erase the customer's debt", async () => {
    const lots = await makeLots(5, 0)
    const customer = await prisma.customer.create({ data: { tenantId: TENANT_ID, name: "Void IT", mobile: `v-${randomUUID().slice(0, 8)}`, creditLimit: 500 } })
    const saleId = randomUUID()
    const lineId = randomUUID()
    const saleNumber = `V-${saleId.slice(0, 8)}`
    await push("sale", "create", {
      id: saleId, saleNumber, paymentMethod: "Debt", customerId: customer.id, subtotal: 25, tax: 0, total: 25, cost: 0, profit: 0, cashier: "IT", status: "Debt",
      items: [{ id: productId, lineId, name: "Refund IT Widget", barcode: BARCODE, quantity: 5, unitPrice: 5, total: 25, cost: 2, batchAllocations: [{ batchId: lots.a, quantity: 5, unitCost: 2 }] }],
    })
    const debtId = randomUUID()
    await push("debt", "create", { id: debtId, customerId: customer.id, saleNumber, subtotal: 25, discountTotal: 0, tax: 0, total: 25 })
    expect((await push("refund", "create", refundPayload(saleId, lineId, 1, 5, { method: "Debt_Credit" }))).status).toBe("ok")
    // The till sends the debt delete just before the void (voidSale → reverseDebtSale).
    expect((await push("debt", "delete", { id: debtId, saleNumber })).status).toBe("ok")
    expect((await push("sale", "void", { id: saleId, saleNumber })).status).toBe("rejected")
    expect(await prisma.debtSale.count({ where: { id: debtId } })).toBe(1)
  })

  it("a legacy refund's lot-less stock is an explained reconciliation exception, and later sales never drive lots negative", async () => {
    // Fresh product so the report row is unambiguous.
    const p = await prisma.product.create({ data: { tenantId: TENANT_ID, name: "Legacy IT", price: 5, cost: 2, stock: 4, barcode: `LEG-${randomUUID().slice(0, 8)}`, category: "Test" } })
    const lotId = `leg-lot-${randomUUID()}`
    await prisma.inventoryBatch.create({ data: { id: lotId, tenantId: TENANT_ID, batchNumber: "L", productId: p.id, productName: "Legacy IT", barcode: p.barcode, initialQuantity: 4, quantityRemaining: 4, unitCost: 2, unitPrice: 5 } })
    const saleId = randomUUID()
    await prisma.sale.create({ data: { id: saleId, tenantId: TENANT_ID, saleNumber: `LG-${saleId.slice(0, 8)}`, paymentMethod: "Cash", subtotal: 10, tax: 0, total: 10, cashier: "legacy",
      items: { create: [{ productId: p.id, productName: "Legacy IT", barcode: p.barcode, quantity: 2, unitPrice: 5, total: 10 }] } } })
    const refundId = randomUUID()
    expect((await push("refund", "create", { id: refundId, refundNumber: `R-${refundId.slice(0, 10)}`, saleId, saleNumber: "LG", method: "Cash", reason: "IT", total: 10, cashier: "IT",
      items: [{ id: p.id, barcode: p.barcode, quantity: 2 }] })).status).toBe("ok")
    expect(Number((await prisma.product.findUnique({ where: { id: p.id } }))!.stock)).toBe(6)
    expect(await lotOf(lotId)).toBe(4)

    const report = await request("GET", "/api/inventory/reconciliation")
    const row = report.body.rows.find((r: any) => r.productId === p.id)
    expect(row).toMatchObject({ severity: "warn", unallocatedReturnQty: 2 })
    expect(row.classification).toContain("unallocated_return")
    expect(row.classification).not.toContain("stock_batch_mismatch")
    expect(report.body.summary.unallocatedReturns).toBeGreaterThanOrEqual(1)

    // Sell all 6: the till allocates 4 from the lot and 2 as untracked stock.
    const sale2 = randomUUID()
    expect((await push("sale", "create", { id: sale2, saleNumber: `LG2-${sale2.slice(0, 8)}`, paymentMethod: "Cash", subtotal: 30, tax: 0, total: 30, cost: 0, profit: 0, cashier: "IT", status: "Completed",
      items: [{ id: p.id, lineId: randomUUID(), name: "Legacy IT", barcode: p.barcode, quantity: 6, unitPrice: 5, total: 30, cost: 2,
        batchAllocations: [{ batchId: lotId, quantity: 4, unitCost: 2 }, { batchId: "legacy-stock", quantity: 2, unitCost: 2 }] }] })).status).toBe("ok")
    expect(Number((await prisma.product.findUnique({ where: { id: p.id } }))!.stock)).toBe(0)
    expect(await lotOf(lotId)).toBe(0)
  })

  it("old hubs (no schema header) do not receive the new columns; schema-2 clients do", async () => {
    const lots = await makeLots(2, 0)
    await sellTracked(2, lots, [2, 0])
    const legacy = await request("GET", "/api/sync/pull/full/sales?limit=5000")
    const legacyItem = legacy.body.items.find((s: any) => s.items?.length)?.items[0]
    expect(legacyItem).toBeTruthy()
    expect(legacyItem).not.toHaveProperty("lineId")
    expect(legacyItem).not.toHaveProperty("batchAllocations")

    const modern = await request("GET", "/api/sync/pull/full/sales?limit=5000", undefined, { "x-titan-sync-schema": "2" })
    const modernItem = modern.body.items.find((s: any) => s.items?.some((i: any) => i.lineId))?.items.find((i: any) => i.lineId)
    expect(modernItem?.batchAllocations).toBeTruthy()

    const inc = await request("GET", "/api/sync/pull?since=2000-01-01T00:00:00Z")
    expect(inc.body.refunds.every((r: any) => !("rateSource" in r))).toBe(true)
  })
})
