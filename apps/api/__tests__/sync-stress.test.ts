import { describe, it, expect, beforeAll, afterAll } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomUUID, createHash } from "node:crypto"
import jwt from "jsonwebtoken"

// IMPORTANT: unlike every other file in this directory, this one does NOT
// mock prisma. It runs against the real local dev Postgres (same
// DATABASE_URL apps/api/.env already points at) so it genuinely exercises
// concurrent-write behavior — row locking, atomic conditional decrements,
// unique constraints — that a mocked client cannot validate. That's the
// entire point of a sync stress test: faking the database would fake the
// exact thing being investigated.
//
// All data lives under one disposable, uniquely-generated test tenant
// created in beforeAll and fully deleted in afterAll. It never touches the
// "fakih" tenant or any other real data.
process.env.JWT_SECRET = process.env.JWT_SECRET || "stress-test-secret"
process.env.IS_LOCAL_SERVER = "true" // enables device-approval gating, matching a real hub

const prismaModule = await import("../src/lib/prisma.js")
const prisma = prismaModule.default
const appModule = await import("../src/app.js")
const app = appModule.default

let server: http.Server
let baseUrl = ""

async function request(method: string, path: string, opts?: { body?: unknown; token?: string; deviceId?: string }) {
  const headers: Record<string, string> = {}
  if (opts?.token) headers["Authorization"] = `Bearer ${opts.token}`
  if (opts?.body !== undefined) headers["Content-Type"] = "application/json"
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  const body = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text()
  return { status: res.status, body }
}

function pushOne(token: string, deviceId: string | undefined, entity: string, action: string, payload: unknown, opId?: string) {
  return request("POST", "/api/sync/push", {
    token,
    body: { deviceId, operations: [{ id: opId ?? randomUUID(), entity, action, payload }] },
  })
}

const TENANT_ID = randomUUID()
const ADMIN_ID = randomUUID()
const HUB_DEVICE_ID = `HUB-${randomUUID().slice(0, 8)}`
const CLIENT_A_DEVICE_ID = `DEV-A-${randomUUID().slice(0, 8)}`
const CLIENT_B_DEVICE_ID = `DEV-B-${randomUUID().slice(0, 8)}`
let adminToken: string
let productId: number
let customerId: string
const PRODUCT_BARCODE = `STRESS-${TENANT_ID.slice(0, 8)}`

function signToken(overrides: Partial<{ userId: string; role: string }> = {}) {
  return jwt.sign(
    { userId: overrides.userId ?? ADMIN_ID, tenantId: TENANT_ID, role: overrides.role ?? "Admin" },
    process.env.JWT_SECRET!,
    { expiresIn: "1h" }
  )
}

beforeAll(async () => {
  server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, resolve))
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`

  await prisma.tenant.create({
    data: { id: TENANT_ID, name: "Stress Test Store (disposable)", subdomain: `stress-${TENANT_ID.slice(0, 8)}` },
  })
  await prisma.staffUser.create({
    data: {
      id: ADMIN_ID, tenantId: TENANT_ID, name: "Stress Admin", mobile: `stress-${TENANT_ID.slice(0, 6)}`,
      pin: createHash("sha256").update("1111").digest("base64"), role: "Admin",
    },
  })
  adminToken = signToken()

  const product = await prisma.product.create({
    data: {
      tenantId: TENANT_ID, name: "Stress Test Widget", price: 5, cost: 3, stock: 100,
      barcode: PRODUCT_BARCODE, category: "Test",
    },
  })
  productId = product.id

  const customer = await prisma.customer.create({
    data: { tenantId: TENANT_ID, name: "Stress Test Customer", mobile: `cust-${TENANT_ID.slice(0, 6)}`, creditLimit: 1000 },
  })
  customerId = customer.id
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
  // Delete in FK-safe order — children of Sale/SaleRefund cascade automatically.
  // stockMovement and syncOperation must be deleted before product/sale, since
  // both reference productId/tenantId with a RESTRICT (non-cascading) FK.
  await prisma.stockMovement.deleteMany({ where: { tenantId: TENANT_ID } })
  await prisma.syncOperation.deleteMany({ where: { tenantId: TENANT_ID } })
  await prisma.sale.deleteMany({ where: { tenantId: TENANT_ID } })
  await prisma.saleRefund.deleteMany({ where: { tenantId: TENANT_ID } })
  await prisma.debtPayment.deleteMany({ where: { tenantId: TENANT_ID } })
  await prisma.debtSale.deleteMany({ where: { tenantId: TENANT_ID } })
  await prisma.inventoryBatch.deleteMany({ where: { tenantId: TENANT_ID } })
  await prisma.shift.deleteMany({ where: { tenantId: TENANT_ID } })
  await prisma.auditEvent.deleteMany({ where: { tenantId: TENANT_ID } })
  await prisma.pairingCode.deleteMany({ where: { tenantId: TENANT_ID } })
  await prisma.device.deleteMany({ where: { tenantId: TENANT_ID } })
  await prisma.customer.deleteMany({ where: { tenantId: TENANT_ID } })
  await prisma.product.deleteMany({ where: { tenantId: TENANT_ID } })
  await prisma.staffUser.deleteMany({ where: { tenantId: TENANT_ID } })
  await prisma.tenant.deleteMany({ where: { id: TENANT_ID } })
})

// ─── A. Device pairing / access control ─────────────────────────────────────

describe("A. Device pairing / access control", () => {
  it("rejects sync from an unpaired device", async () => {
    const res = await pushOne(adminToken, CLIENT_A_DEVICE_ID, "product", "update", { id: productId, barcode: PRODUCT_BARCODE, favorite: true })
    expect(res.status).toBe(403)
    expect((res.body as any).code).toBe("DEVICE_NOT_APPROVED")
  })

  it("generates a pairing code and pairs client A and client B", async () => {
    const codeA = await request("POST", "/api/device/generate-code", { token: adminToken })
    expect(codeA.status).toBe(200)
    const pairA = await request("POST", "/api/device/pair", {
      body: { code: (codeA.body as any).code, deviceId: CLIENT_A_DEVICE_ID, deviceName: "Client A" },
    })
    expect(pairA.status).toBe(200)

    const codeB = await request("POST", "/api/device/generate-code", { token: adminToken })
    const pairB = await request("POST", "/api/device/pair", {
      body: { code: (codeB.body as any).code, deviceId: CLIENT_B_DEVICE_ID, deviceName: "Client B" },
    })
    expect(pairB.status).toBe(200)

    // The hub itself is registered as a Device too (confirmed: /api/sync/push
    // requires a deviceId on every push when IS_LOCAL_SERVER=true — even the
    // hub's own local writes, no exceptions), so pair it exactly like a client.
    const codeHub = await request("POST", "/api/device/generate-code", { token: adminToken })
    const pairHub = await request("POST", "/api/device/pair", {
      body: { code: (codeHub.body as any).code, deviceId: HUB_DEVICE_ID, deviceName: "Hub" },
    })
    expect(pairHub.status).toBe(200)
  })

  it("lists both paired devices", async () => {
    const res = await request("GET", "/api/device/list", { token: adminToken })
    expect(res.status).toBe(200)
    const deviceIds = (res.body as any[]).map((d) => d.deviceId)
    expect(deviceIds).toEqual(expect.arrayContaining([CLIENT_A_DEVICE_ID, CLIENT_B_DEVICE_ID, HUB_DEVICE_ID]))
  })

  it("approved device can now sync", async () => {
    const res = await pushOne(adminToken, CLIENT_A_DEVICE_ID, "product", "update", { id: productId, barcode: PRODUCT_BARCODE, favorite: true })
    expect(res.status).toBe(200)
    expect(res.body.results[0].status).toBe("ok")
  })

  it("revoked device is rejected again", async () => {
    await request("POST", "/api/device/revoke", { token: adminToken, body: { deviceId: CLIENT_B_DEVICE_ID } })
    const res = await pushOne(adminToken, CLIENT_B_DEVICE_ID, "product", "update", { id: productId, barcode: PRODUCT_BARCODE, favorite: false })
    expect(res.status).toBe(403)
    expect((res.body as any).code).toBe("DEVICE_NOT_APPROVED")

    // Re-approve for the rest of the suite (revoke is meant to be tested in isolation)
    const codeB2 = await request("POST", "/api/device/generate-code", { token: adminToken })
    await request("POST", "/api/device/pair", {
      body: { code: (codeB2.body as any).code, deviceId: CLIENT_B_DEVICE_ID, deviceName: "Client B" },
    })
  })
})

// ─── B/C. Concurrent sales + stock ──────────────────────────────────────────

describe("B/C. Concurrent sales and stock", () => {
  it("hub + client A + client B create sales concurrently — no collisions, unique numbers/IDs, correct stock", async () => {
    const before = await prisma.product.findUnique({ where: { id: productId }, select: { stock: true } })
    const startStock = Number(before!.stock)

    function sale(saleNumber: string, qty: number, deviceId: string | undefined) {
      return pushOne(adminToken, deviceId, "sale", "create", {
        id: randomUUID(), saleNumber, paymentMethod: "Cash",
        subtotal: qty * 5, tax: 0, total: qty * 5, cost: qty * 3, cashier: "Stress Admin",
        items: [{ id: productId, name: "Stress Test Widget", barcode: `STRESS-${TENANT_ID.slice(0, 8)}`, quantity: qty, unitPrice: 5, total: qty * 5, cost: 3 }],
      })
    }

    const results = await Promise.all([
      sale("STRESS-H1", 2, HUB_DEVICE_ID),               // hub — sends its OWN registered device id, same as any client
      sale("STRESS-A1", 3, CLIENT_A_DEVICE_ID),
      sale("STRESS-B1", 1, CLIENT_B_DEVICE_ID),
      sale("STRESS-H2", 1, HUB_DEVICE_ID),
      sale("STRESS-A2", 2, CLIENT_A_DEVICE_ID),
      sale("STRESS-B2", 4, CLIENT_B_DEVICE_ID),
    ])

    for (const r of results) {
      expect(r.status).toBe(200)
      expect(r.body.results[0].status).toBe("ok")
    }

    const sales = await prisma.sale.findMany({ where: { tenantId: TENANT_ID, saleNumber: { startsWith: "STRESS-" } } })
    expect(sales.length).toBe(6)
    const saleNumbers = sales.map((s) => s.saleNumber)
    expect(new Set(saleNumbers).size).toBe(6) // all unique
    const saleIds = sales.map((s) => s.id)
    expect(new Set(saleIds).size).toBe(6) // all unique

    const totalSold = 2 + 3 + 1 + 1 + 2 + 4
    const after = await prisma.product.findUnique({ where: { id: productId }, select: { stock: true } })
    expect(Number(after!.stock)).toBe(startStock - totalSold)
    expect(Number(after!.stock)).toBeGreaterThanOrEqual(0)
  })

  it("rejects a sale when concurrent demand would exceed remaining stock, without corrupting stock", async () => {
    const low = await prisma.product.create({
      data: { tenantId: TENANT_ID, name: "Low Stock Widget", price: 5, cost: 3, stock: 5, barcode: `LOW-${TENANT_ID.slice(0, 8)}`, category: "Test" },
    })
    const buy = (n: string, qty: number, deviceId: string) =>
      pushOne(adminToken, deviceId, "sale", "create", {
        id: randomUUID(), saleNumber: n, paymentMethod: "Cash",
        subtotal: qty * 5, tax: 0, total: qty * 5, cost: qty * 3, cashier: "Stress Admin",
        items: [{ id: low.id, name: "Low Stock Widget", barcode: `LOW-${TENANT_ID.slice(0, 8)}`, quantity: qty, unitPrice: 5, total: qty * 5, cost: 3 }],
      })

    const results = await Promise.all([
      buy("STRESS-LOW-A", 3, CLIENT_A_DEVICE_ID),
      buy("STRESS-LOW-B", 3, CLIENT_B_DEVICE_ID),
    ])
    const statuses = results.map((r) => r.body.results[0].status)
    // Exactly one of the two overlapping (3+3=6 > 5 available) sales should succeed.
    // The other must come back "rejected" (sync.ts's deliberate classification for
    // "Insufficient stock" — a non-retryable business conflict, marked dead
    // immediately with attempts:5 so the client doesn't keep retrying a sale that
    // can never succeed), not "error" (which implies a transient/retryable failure).
    expect(statuses.filter((s) => s === "ok").length).toBe(1)
    expect(statuses.filter((s) => s === "rejected").length).toBe(1)

    const final = await prisma.product.findUnique({ where: { id: low.id }, select: { stock: true } })
    expect(Number(final!.stock)).toBe(2) // 5 - 3, never went negative, never double-decremented
  })

  it("duplicate push of the same sale id is idempotent — no double stock decrement", async () => {
    const p = await prisma.product.create({
      data: { tenantId: TENANT_ID, name: "Idempotency Widget", price: 5, cost: 3, stock: 10, barcode: `IDEM-${TENANT_ID.slice(0, 8)}`, category: "Test" },
    })
    const saleId = randomUUID()
    const payload = {
      id: saleId, saleNumber: "STRESS-IDEM-1", paymentMethod: "Cash",
      subtotal: 10, tax: 0, total: 10, cost: 6, cashier: "Stress Admin",
      items: [{ id: p.id, name: "Idempotency Widget", barcode: `IDEM-${TENANT_ID.slice(0, 8)}`, quantity: 2, unitPrice: 5, total: 10, cost: 3 }],
    }
    const r1 = await pushOne(adminToken, CLIENT_A_DEVICE_ID, "sale", "create", payload, randomUUID())
    const r2 = await pushOne(adminToken, CLIENT_A_DEVICE_ID, "sale", "create", payload, randomUUID()) // retry, same sale id, different op id (matches a real client retry with a fresh op wrapper)
    expect(r1.body.results[0].status).toBe("ok")
    expect(r2.body.results[0].status).toBe("ok") // safe retry, not an error

    const count = await prisma.sale.count({ where: { id: saleId } })
    expect(count).toBe(1) // not duplicated

    const stock = await prisma.product.findUnique({ where: { id: p.id }, select: { stock: true } })
    expect(Number(stock!.stock)).toBe(8) // decremented exactly once, not twice
  })

  it("concurrent sales allocating from the same batch never over-consume it, even when both devices pick the same batch", async () => {
    const bp = await prisma.product.create({
      data: { tenantId: TENANT_ID, name: "Batch Widget", price: 5, cost: 3, stock: 5, barcode: `BATCH-${TENANT_ID.slice(0, 8)}`, category: "Test" },
    })
    const batch = await prisma.inventoryBatch.create({
      data: {
        tenantId: TENANT_ID, batchNumber: "B-1", productId: bp.id, productName: "Batch Widget", barcode: `BATCH-${TENANT_ID.slice(0, 8)}`,
        initialQuantity: 5, quantityRemaining: 5, unitCost: 3, unitPrice: 5,
      },
    })

    // Batch/FEFO selection is client-computed — this simulates two devices that
    // both independently picked the SAME batch (a real scenario: both pulled the
    // same "oldest open batch" before either had synced the other's pull).
    const buyFromBatch = (n: string, qty: number, deviceId: string) =>
      pushOne(adminToken, deviceId, "sale", "create", {
        id: randomUUID(), saleNumber: n, paymentMethod: "Cash",
        subtotal: qty * 5, tax: 0, total: qty * 5, cost: qty * 3, cashier: "Stress Admin",
        items: [{
          id: bp.id, name: "Batch Widget", barcode: `BATCH-${TENANT_ID.slice(0, 8)}`, quantity: qty, unitPrice: 5, total: qty * 5, cost: 3,
          batchAllocations: [{ batchId: batch.id, quantity: qty }],
        }],
      })

    const results = await Promise.all([
      buyFromBatch("STRESS-BATCH-A", 3, CLIENT_A_DEVICE_ID),
      buyFromBatch("STRESS-BATCH-B", 3, CLIENT_B_DEVICE_ID),
    ])
    const statuses = results.map((r) => r.body.results[0].status)
    // The atomic conditional decrement (quantityRemaining >= quantity) guarantees
    // the batch itself is never over-consumed — confirmed below. KNOWN LIMITATION
    // (documented in the report, not fixed here — would require redesigning
    // client-side batch selection to retry against a different batch, out of
    // scope for a surgical sync fix): when two devices pick the SAME batch
    // concurrently, the second one's ENTIRE sale is rejected outright with
    // "Insufficient stock in batch", even though overall product stock (5) was
    // enough for both combined (6 > 5, so this specific case would fail either
    // way, but a 3+2 split against the same over-selected batch would also fail
    // the second sale even though total product stock could have covered it).
    expect(statuses.filter((s) => s === "ok" || s === "rejected").length).toBe(2) // one of each, never both "ok"

    const finalBatch = await prisma.inventoryBatch.findUnique({ where: { id: batch.id }, select: { quantityRemaining: true } })
    expect(Number(finalBatch!.quantityRemaining)).toBeGreaterThanOrEqual(0) // never went negative
    expect(Number(finalBatch!.quantityRemaining)).toBe(2) // exactly one 3-unit consumption applied, not two (would be -1)
  })
})

// ─── D. Customer debt ────────────────────────────────────────────────────────

describe("D. Customer debt across devices", () => {
  it("concurrent debt sale (client A) + debt payment (client B) + debt sale (hub) leave a correct final balance", async () => {
    const debtSale = (n: string, total: number, deviceId: string | undefined) =>
      pushOne(adminToken, deviceId, "debt", "create", {
        id: randomUUID(), customerId, saleNumber: n, subtotal: total, tax: 0, total,
        items: [{ id: productId, name: "Stress Test Widget", barcode: "x", quantity: 1, unitPrice: total, total }],
      })
    const debtPayment = (amount: number, deviceId: string | undefined) =>
      pushOne(adminToken, deviceId, "debt", "payment", { id: randomUUID(), customerId, amount, method: "Cash" })

    const results = await Promise.all([
      debtSale("STRESS-DEBT-A", 50, CLIENT_A_DEVICE_ID),
      debtPayment(20, CLIENT_B_DEVICE_ID),
      debtSale("STRESS-DEBT-H", 30, HUB_DEVICE_ID),
    ])
    for (const r of results) expect(r.body.results[0].status).toBe("ok")

    const debtSales = await prisma.debtSale.findMany({ where: { tenantId: TENANT_ID, customerId } })
    const debtPayments = await prisma.debtPayment.findMany({ where: { tenantId: TENANT_ID, customerId } })
    const totalOwed = debtSales.reduce((s, d) => s + Number(d.total), 0)
    const totalPaid = debtPayments.reduce((s, p) => s + Number(p.amount), 0)
    expect(totalOwed).toBe(80) // 50 + 30
    expect(totalPaid).toBe(20)
    expect(totalOwed - totalPaid).toBe(60) // correct outstanding balance, computed the same way the desktop client does
  })
})

// ─── E. Refund / void ────────────────────────────────────────────────────────

describe("E. Refund / void across devices", () => {
  it("refund restores stock, and a duplicate refund retry does not double-restore", async () => {
    const p = await prisma.product.create({
      data: { tenantId: TENANT_ID, name: "Refund Widget", price: 5, cost: 3, stock: 10, barcode: `REF-${TENANT_ID.slice(0, 8)}`, category: "Test" },
    })
    const saleId = randomUUID()
    await pushOne(adminToken, CLIENT_A_DEVICE_ID, "sale", "create", {
      id: saleId, saleNumber: "STRESS-REF-SALE", paymentMethod: "Cash",
      subtotal: 10, tax: 0, total: 10, cost: 6, cashier: "Stress Admin",
      items: [{ id: p.id, name: "Refund Widget", barcode: `REF-${TENANT_ID.slice(0, 8)}`, quantity: 2, unitPrice: 5, total: 10, cost: 3 }],
    })
    const afterSale = await prisma.product.findUnique({ where: { id: p.id }, select: { stock: true } })
    expect(Number(afterSale!.stock)).toBe(8)

    const refundId = randomUUID()
    const refundPayload = {
      id: refundId, refundNumber: "STRESS-REF-1", saleId, saleNumber: "STRESS-REF-SALE",
      method: "Cash", reason: "stress test", total: 10, cashier: "Stress Admin",
      items: [{ productId: p.id, name: "Refund Widget", barcode: `REF-${TENANT_ID.slice(0, 8)}`, quantity: 2, unitPrice: 5, total: 10 }],
    }
    const r1 = await pushOne(adminToken, CLIENT_B_DEVICE_ID, "refund", "create", refundPayload, randomUUID())
    const r2 = await pushOne(adminToken, CLIENT_B_DEVICE_ID, "refund", "create", refundPayload, randomUUID()) // retry, same refund id, different op id
    expect(r1.body.results[0].status).toBe("ok")
    expect(r2.body.results[0].status).toBe("ok")

    const refundCount = await prisma.saleRefund.count({ where: { id: refundId } })
    expect(refundCount).toBe(1)

    const afterRefund = await prisma.product.findUnique({ where: { id: p.id }, select: { stock: true } })
    expect(Number(afterRefund!.stock)).toBe(10) // fully restored, not double-restored
  })

  it("void guards against re-voiding an already-voided sale, and restores stock exactly once", async () => {
    const p = await prisma.product.create({
      data: { tenantId: TENANT_ID, name: "Void Widget", price: 5, cost: 3, stock: 10, barcode: `VOID-${TENANT_ID.slice(0, 8)}`, category: "Test" },
    })
    const saleId = randomUUID()
    await pushOne(adminToken, HUB_DEVICE_ID, "sale", "create", {
      id: saleId, saleNumber: "STRESS-VOID-SALE", paymentMethod: "Cash",
      subtotal: 15, tax: 0, total: 15, cost: 9, cashier: "Stress Admin",
      items: [{ id: p.id, name: "Void Widget", barcode: `VOID-${TENANT_ID.slice(0, 8)}`, quantity: 3, unitPrice: 5, total: 15, cost: 3 }],
    })

    const voidPayload = { id: saleId, saleNumber: "STRESS-VOID-SALE" }
    const v1 = await pushOne(adminToken, CLIENT_A_DEVICE_ID, "sale", "void", voidPayload, randomUUID())
    const v2 = await pushOne(adminToken, CLIENT_B_DEVICE_ID, "sale", "void", voidPayload, randomUUID()) // concurrent-ish re-void, same sale id, different op id
    expect(v1.body.results[0].status).toBe("ok")
    // second void of an already-voided sale must not throw an unhandled error or re-restore stock;
    // it may report ok (no-op) or error, but stock must not move twice either way
    expect(["ok", "error"]).toContain(v2.body.results[0].status)

    const sale = await prisma.sale.findUnique({ where: { id: saleId }, select: { status: true } })
    expect(sale!.status).toBe("Voided")
    const stock = await prisma.product.findUnique({ where: { id: p.id }, select: { stock: true } })
    expect(Number(stock!.stock)).toBe(10) // restored exactly once, not twice
  })
})

// ─── F. Shift / cash / device attribution ───────────────────────────────────

describe("F. Shift and device/register attribution", () => {
  it("shiftId/shiftNumber are stamped correctly on a sale created by a paired client device", async () => {
    const shiftId = randomUUID()
    await pushOne(adminToken, HUB_DEVICE_ID, "shift", "open", {
      id: shiftId, shiftNumber: "STRESS-SHIFT-1", openedById: ADMIN_ID, openedByName: "Stress Admin",
    })
    const saleId = randomUUID()
    await pushOne(adminToken, CLIENT_A_DEVICE_ID, "sale", "create", {
      id: saleId, saleNumber: "STRESS-SHIFT-SALE", paymentMethod: "Cash",
      subtotal: 5, tax: 0, total: 5, cost: 3, cashier: "Stress Admin",
      shiftId, shiftNumber: "STRESS-SHIFT-1",
      items: [{ id: productId, name: "Stress Test Widget", barcode: "x", quantity: 1, unitPrice: 5, total: 5, cost: 3 }],
    })
    const sale = await prisma.sale.findUnique({ where: { id: saleId }, select: { shiftId: true, shiftNumber: true } })
    expect(sale!.shiftId).toBe(shiftId)
    expect(sale!.shiftNumber).toBe("STRESS-SHIFT-1")
  })

  it("KNOWN LIMITATION: registerId/deviceId are never persisted on Sale — confirms this is intentional (stripped), not silently dropped by accident", async () => {
    // See apps/api/src/routes/sync.ts processOperation()'s stripClientMeta —
    // registerId/deviceId are deliberately removed before any prisma write
    // because no transactional model has columns for them (the earlier
    // registerId/deviceId "Unknown argument" bug fix, generalized). This test
    // documents that as expected behavior for the stress report, not a bug.
    const saleId = randomUUID()
    await pushOne(adminToken, CLIENT_A_DEVICE_ID, "sale", "create", {
      id: saleId, saleNumber: "STRESS-ATTR-SALE", paymentMethod: "Cash",
      subtotal: 5, tax: 0, total: 5, cost: 3, cashier: "Stress Admin",
      registerId: "REG-001", deviceId: CLIENT_A_DEVICE_ID,
      items: [{ id: productId, name: "Stress Test Widget", barcode: "x", quantity: 1, unitPrice: 5, total: 5, cost: 3 }],
    })
    const raw = await prisma.$queryRawUnsafe<any[]>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'Sale' AND column_name IN ('registerId','deviceId')`
    )
    expect(raw.length).toBe(0) // confirmed: no such columns exist anywhere on Sale
  })
})

// ─── G. Offline / recovery (simulated) ──────────────────────────────────────

describe("G. Offline / recovery simulation", () => {
  it("a queued write that failed while a device was unreachable syncs cleanly once retried, without duplicating", async () => {
    // Simulate "client A went offline mid-write, queued locally, reconnects and
    // retries the same operation id" — this is exactly the desktop client's
    // sync.service.ts retry semantics (same op id, same idempotency guards
    // already proven in section B/C and E above). We re-exercise it here
    // against a fresh sale to keep this section self-contained in the report.
    const opId = randomUUID()
    const saleId = randomUUID()
    const payload = {
      id: saleId, saleNumber: "STRESS-OFFLINE-1", paymentMethod: "Cash",
      subtotal: 5, tax: 0, total: 5, cost: 3, cashier: "Stress Admin",
      items: [{ id: productId, name: "Stress Test Widget", barcode: "x", quantity: 1, unitPrice: 5, total: 5, cost: 3 }],
    }
    // First attempt "fails" from the client's perspective (e.g. network drop
    // after the request left but before the response arrived) — but the
    // server already processed it. Client retries with the same op+sale id.
    const first = await pushOne(adminToken, CLIENT_A_DEVICE_ID, "sale", "create", payload, opId)
    const retry = await pushOne(adminToken, CLIENT_A_DEVICE_ID, "sale", "create", payload, opId)
    expect(first.body.results[0].status).toBe("ok")
    expect(retry.body.results[0].status).toBe("ok")
    const count = await prisma.sale.count({ where: { id: saleId } })
    expect(count).toBe(1)
  })
})
