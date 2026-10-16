import { describe, it, expect, beforeAll, afterAll } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomUUID } from "node:crypto"
import jwt from "jsonwebtoken"

// STOCK-REVIEW — real-Postgres proof that clients released BEFORE
// REFUND-INTEGRITY-1 still move stock correctly now that absolute lot writes
// (`inventory/update`) are ignored. Every payload below is shaped exactly like
// origin/master's desktop sends it (inventoryAdjustment.service.ts,
// stockCount.service.ts, inventoryBatch.service.ts at 43230e3):
//  - adjustment ids `stock-adjustment-…`, numbers from a per-device counter
//    (`ADJ-00001` on every fresh device);
//  - batchAllocations carry magnitudes; the sign is quantityChange's;
//  - a positive adjustment without a chosen lot creates a new `ADJ-…` lot that
//    the server has never seen;
//  - write-offs are adjustments (reason Damage/Expired); a count completes as
//    one "Count Correction" adjustment per variance line plus a count session;
//  - after consuming lots the old client ALSO pushed its absolute lot table.
// For each case: product stock, lot balance and the stock ledger are asserted.
// Needs the DATABASE_URL database migrated; data lives in a disposable tenant.
process.env.JWT_SECRET = process.env.JWT_SECRET || "old-client-adj-secret"

const prisma = (await import("../src/lib/prisma.js")).default
const app = (await import("../src/app.js")).default

let server: http.Server
let baseUrl = ""
const TENANT_ID = randomUUID()
const ADMIN_ID = randomUUID()
const DEVICE_A = `OCA-A-${TENANT_ID.slice(0, 8)}`
const DEVICE_B = `OCA-B-${TENANT_ID.slice(0, 8)}`
const BARCODE = `OCA-${TENANT_ID.slice(0, 8)}`
let token = ""
let productId = 0
const LOT_1 = `batch-${TENANT_ID}-1` // older, expires first
const LOT_2 = `batch-${TENANT_ID}-2`

async function push(deviceId: string, entity: string, action: string, payload: unknown, opId = randomUUID()) {
  const res = await fetch(`${baseUrl}/api/sync/push`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId, operations: [{ id: opId, entity, action, payload }] }),
  })
  const body = (await res.json()) as any
  if (!body?.results) throw new Error(`push refused: HTTP ${res.status} ${JSON.stringify(body).slice(0, 300)}`)
  return body.results[0] as { status: string; error?: string }
}
const stock = async () => Number((await prisma.product.findUnique({ where: { id: productId } }))!.stock)
const lot = async (id: string) => {
  const row = await prisma.inventoryBatch.findUnique({ where: { id } })
  return row ? { qty: Number(row.quantityRemaining), initial: Number(row.initialQuantity), status: row.status } : null
}
const ledger = async (reference: string) =>
  (await prisma.stockMovement.findMany({ where: { tenantId: TENANT_ID, reference }, orderBy: { createdAt: "asc" } }))
    .map((m) => ({ type: m.type, quantity: Number(m.quantity), productId: m.productId }))
const ledgerSum = async () =>
  (await prisma.stockMovement.findMany({ where: { tenantId: TENANT_ID, productId } })).reduce((s, m) => s + Number(m.quantity), 0)

/** An adjustment exactly as the pre-REFUND-INTEGRITY desktop builds it. */
function oldAdjustment(number: string, before: number, change: number, reason: string, allocations: unknown[], extra: Record<string, unknown> = {}) {
  return {
    id: `stock-adjustment-${randomUUID()}`, adjustmentNumber: number,
    productId, productName: "Old client widget", barcode: BARCODE,
    quantityBefore: before, quantityChange: change, quantityAfter: before + change,
    reason, batchAllocations: allocations, valueImpact: change * 2, createdAt: new Date().toISOString(), ...extra,
  }
}

beforeAll(async () => {
  server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, resolve))
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`
  await prisma.tenant.create({ data: { id: TENANT_ID, name: "Old-client adjustments IT (disposable)", subdomain: `oca-${TENANT_ID.slice(0, 8)}` } })
  await prisma.staffUser.create({ data: { id: ADMIN_ID, tenantId: TENANT_ID, name: "IT", mobile: `oca-${TENANT_ID.slice(0, 6)}`, pin: "x", role: "Admin" } })
  for (const deviceId of [DEVICE_A, DEVICE_B]) {
    await prisma.device.create({ data: { tenantId: TENANT_ID, deviceId, deviceName: deviceId, status: "APPROVED" } })
  }
  token = jwt.sign({ userId: ADMIN_ID, tenantId: TENANT_ID, role: "Admin" }, process.env.JWT_SECRET!, { expiresIn: "1h" })
  const product = await prisma.product.create({
    data: { tenantId: TENANT_ID, name: "Old client widget", price: 5, cost: 2, stock: 20, barcode: BARCODE, category: "Test" },
  })
  productId = product.id
  await prisma.inventoryBatch.createMany({
    data: [
      { id: LOT_1, tenantId: TENANT_ID, batchNumber: "L1", productId, productName: "Old client widget", barcode: BARCODE, initialQuantity: 10, quantityRemaining: 10, unitCost: 2, unitPrice: 5, expiryDate: "2026-11-01" },
      { id: LOT_2, tenantId: TENANT_ID, batchNumber: "L2", productId, productName: "Old client widget", barcode: BARCODE, initialQuantity: 10, quantityRemaining: 10, unitCost: 2, unitPrice: 5, expiryDate: "2027-03-01" },
    ],
  })
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
  await prisma.stockMovement.deleteMany({ where: { tenantId: TENANT_ID } })
  await prisma.syncOperation.deleteMany({ where: { tenantId: TENANT_ID } })
  await prisma.stockCountLine.deleteMany({ where: { session: { tenantId: TENANT_ID } } })
  await prisma.stockCountSession.deleteMany({ where: { tenantId: TENANT_ID } })
  await prisma.stockAdjustment.deleteMany({ where: { tenantId: TENANT_ID } })
  await prisma.inventoryBatch.deleteMany({ where: { tenantId: TENANT_ID } })
  await prisma.auditEvent.deleteMany({ where: { tenantId: TENANT_ID } })
  await prisma.device.deleteMany({ where: { tenantId: TENANT_ID } })
  await prisma.product.deleteMany({ where: { tenantId: TENANT_ID } })
  await prisma.staffUser.deleteMany({ where: { tenantId: TENANT_ID } })
  await prisma.tenant.deleteMany({ where: { id: TENANT_ID } })
})

describe("old-client stock adjustments after absolute lot writes are blocked (real Postgres)", () => {
  it("negative adjustment (damage write-off): stock, the consumed lot and the ledger move once; the old absolute lot push is ignored", async () => {
    const s0 = await stock()
    const adj = oldAdjustment("ADJ-00001", s0, -3, "Damage", [{ batchId: LOT_1, batchNumber: "L1", quantity: 3, unitCost: 2, expiryDate: "2026-11-01" }])
    expect((await push(DEVICE_A, "inventory", "adjust", adj)).status).toBe("ok")
    // The old client also pushed its lot table, absolute, after consuming lots.
    expect((await push(DEVICE_A, "inventory", "update", [{ id: LOT_1, quantityRemaining: 7, status: "Open" }, { id: LOT_2, quantityRemaining: 10, status: "Open" }])).status).toBe("ok")
    expect(await stock()).toBe(s0 - 3)
    expect((await lot(LOT_1))!.qty).toBe(7)
    expect((await lot(LOT_2))!.qty).toBe(10)
    expect(await ledger(adj.id)).toEqual([{ type: "Adjustment", quantity: -3, productId }])
  })

  it("positive adjustment into a chosen lot raises stock, that lot's remaining and initial quantity, and the ledger once", async () => {
    const s0 = await stock()
    const before = (await lot(LOT_2))!
    const adj = oldAdjustment("ADJ-00002", s0, 4, "Manual Correction", [{ batchId: LOT_2, batchNumber: "L2", quantity: 4, unitCost: 2 }], { batchId: LOT_2 })
    expect((await push(DEVICE_A, "inventory", "adjust", adj)).status).toBe("ok")
    expect(await stock()).toBe(s0 + 4)
    expect(await lot(LOT_2)).toMatchObject({ qty: before.qty + 4, initial: before.initial + 4, status: "Open" })
    expect(await ledger(adj.id)).toEqual([{ type: "Adjustment", quantity: 4, productId }])
  })

  it("positive adjustment without a chosen lot creates the client's new ADJ lot on the server, so the units are sellable by lot", async () => {
    const s0 = await stock()
    const newLot = `batch-adjustment-${randomUUID()}`
    const adj = oldAdjustment("ADJ-00003", s0, 2, "Count Correction", [{ batchId: newLot, batchNumber: "ADJ-1234567", quantity: 2, unitCost: 2 }])
    expect((await push(DEVICE_A, "inventory", "adjust", adj)).status).toBe("ok")
    expect(await stock()).toBe(s0 + 2)
    expect(await lot(newLot)).toMatchObject({ qty: 2, initial: 2 })
    expect(await ledger(adj.id)).toEqual([{ type: "Adjustment", quantity: 2, productId }])
  })

  it("expired lot: the Expired mark (the one status still accepted) keeps its units in stock until the write-off adjustment removes them", async () => {
    const s0 = await stock()
    const l1 = (await lot(LOT_1))!
    // The old client marks an Open lot past its expiry Expired and pushes its lot table.
    expect((await push(DEVICE_A, "inventory", "update", [{ id: LOT_1, quantityRemaining: l1.qty, status: "Expired" }])).status).toBe("ok")
    expect(await lot(LOT_1)).toMatchObject({ qty: l1.qty, status: "Expired" })
    expect(await stock()).toBe(s0)
    // The write-off itself is an adjustment (reason Expired) on that lot.
    const adj = oldAdjustment("ADJ-00004", s0, -l1.qty, "Expired", [{ batchId: LOT_1, batchNumber: "L1", quantity: l1.qty, unitCost: 2 }], { batchId: LOT_1 })
    expect((await push(DEVICE_A, "inventory", "adjust", adj)).status).toBe("ok")
    // …followed by its absolute lot table again (ignored).
    expect((await push(DEVICE_A, "inventory", "update", [{ id: LOT_1, quantityRemaining: 0, status: "Consumed" }])).status).toBe("ok")
    expect(await stock()).toBe(s0 - l1.qty)
    // Emptied lots end Consumed on the server, exactly as the old client marks them locally.
    expect(await lot(LOT_1)).toMatchObject({ qty: 0, status: "Consumed" })
    expect(await ledger(adj.id)).toEqual([{ type: "Adjustment", quantity: -l1.qty, productId }])
  })

  it("a completed count (one Count Correction adjustment per variance line + the count session) applies the variance once", async () => {
    const s0 = await stock()
    const l2 = (await lot(LOT_2))!
    const adj = oldAdjustment("ADJ-00005", s0, -1, "Count Correction", [{ batchId: LOT_2, batchNumber: "L2", quantity: 1, unitCost: 2 }], { note: "COUNT-00001" })
    const session = {
      id: `stock-count-${randomUUID()}`, countNumber: "COUNT-00001", status: "Completed",
      createdAt: new Date().toISOString(), completedAt: new Date().toISOString(),
      totalVariance: -1, totalValueImpact: -2,
      lines: [{ productId, productName: "Old client widget", barcode: BARCODE, category: "Test", expectedQuantity: s0, countedQuantity: s0 - 1, variance: -1, valueImpact: -2 }],
    }
    expect((await push(DEVICE_A, "inventory", "adjust", adj)).status).toBe("ok")
    expect((await push(DEVICE_A, "inventory", "count", session)).status).toBe("ok")
    expect(await stock()).toBe(s0 - 1)
    expect((await lot(LOT_2))!.qty).toBe(l2.qty - 1)
    expect(await ledger(adj.id)).toEqual([{ type: "Adjustment", quantity: -1, productId }])
    // The count session is a record only: it must not move stock a second time.
    expect(await prisma.stockCountSession.count({ where: { tenantId: TENANT_ID, id: session.id } })).toBe(1)
  })

  it("retries (same operation, and a new operation carrying the same adjustment) never apply twice", async () => {
    const s0 = await stock()
    const l2 = (await lot(LOT_2))!
    const adj = oldAdjustment("ADJ-00006", s0, -2, "Theft", [{ batchId: LOT_2, batchNumber: "L2", quantity: 2, unitCost: 2 }])
    const opId = randomUUID()
    for (const op of [opId, opId, randomUUID()]) expect((await push(DEVICE_A, "inventory", "adjust", adj, op)).status).toBe("ok")
    expect(await stock()).toBe(s0 - 2)
    expect((await lot(LOT_2))!.qty).toBe(l2.qty - 2)
    expect(await ledger(adj.id)).toHaveLength(1)
  })

  it("a second device's own ADJ-00001 and COUNT-00001 are accepted and applied (display numbers are not identities)", async () => {
    const s0 = await stock()
    const l2 = (await lot(LOT_2))!
    // Device B is fresh: its local counter also starts at ADJ-00001 / COUNT-00001.
    const adj = oldAdjustment("ADJ-00001", s0, -1, "Count Correction", [{ batchId: LOT_2, batchNumber: "L2", quantity: 1, unitCost: 2 }])
    const result = await push(DEVICE_B, "inventory", "adjust", adj)
    expect(result).toEqual({ id: expect.any(String), status: "ok" })
    const session = {
      id: `stock-count-${randomUUID()}`, countNumber: "COUNT-00001", status: "Completed",
      createdAt: new Date().toISOString(), completedAt: new Date().toISOString(),
      totalVariance: -1, totalValueImpact: -2,
      lines: [{ productId, productName: "Old client widget", barcode: BARCODE, category: "Test", expectedQuantity: s0, countedQuantity: s0 - 1, variance: -1, valueImpact: -2 }],
    }
    expect(await push(DEVICE_B, "inventory", "count", session)).toEqual({ id: expect.any(String), status: "ok" })
    expect(await stock()).toBe(s0 - 1)
    expect((await lot(LOT_2))!.qty).toBe(l2.qty - 1)
    expect(await ledger(adj.id)).toEqual([{ type: "Adjustment", quantity: -1, productId }])
    expect(await prisma.stockAdjustment.count({ where: { tenantId: TENANT_ID, adjustmentNumber: "ADJ-00001" } })).toBe(2)
  })

  it("the ledger still explains product stock exactly after all of the above", async () => {
    // Opening stock (20) was seeded directly without a movement.
    expect(20 + (await ledgerSum())).toBe(await stock())
  })
})
