import { describe, it, expect, beforeAll, afterAll } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomUUID } from "node:crypto"
import jwt from "jsonwebtoken"

// REFUND-REVIEW — real-Postgres checks of inventory write authority:
//  - stock adjustments (count / write-off / correction) must change server
//    stock and the adjusted lots exactly once, even when retried;
//  - absolute lot writes from any client (old clients after a sale, refund
//    or void) must never overwrite server lot balances.
// Needs the DATABASE_URL database migrated; data lives in a disposable tenant.
process.env.JWT_SECRET = process.env.JWT_SECRET || "inv-auth-secret"

const prisma = (await import("../src/lib/prisma.js")).default
const app = (await import("../src/app.js")).default

let server: http.Server
let baseUrl = ""
const TENANT_ID = randomUUID()
const ADMIN_ID = randomUUID()
const DEVICE_ID = `INV-DEV-${TENANT_ID.slice(0, 8)}`
let token = ""
let productId = 0

async function push(entity: string, action: string, payload: unknown, opId = randomUUID()) {
  const res = await fetch(`${baseUrl}/api/sync/push`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId: DEVICE_ID, operations: [{ id: opId, entity, action, payload }] }),
  })
  const body = (await res.json()) as any
  if (!body?.results) throw new Error(`push refused: HTTP ${res.status} ${JSON.stringify(body).slice(0, 300)}`)
  if (process.env.DEBUG_PUSH) console.log("PUSH", entity, action, JSON.stringify(body.results[0]).slice(0, 400))
  return body.results[0] as { status: string; error?: string }
}
const stock = async () => Number((await prisma.product.findUnique({ where: { id: productId } }))!.stock)
const lot = async (id: string) => Number((await prisma.inventoryBatch.findUnique({ where: { id } }))!.quantityRemaining)

beforeAll(async () => {
  server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, resolve))
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`
  await prisma.tenant.create({ data: { id: TENANT_ID, name: "Inventory authority IT (disposable)", subdomain: `inv-${TENANT_ID.slice(0, 8)}` } })
  await prisma.staffUser.create({ data: { id: ADMIN_ID, tenantId: TENANT_ID, name: "IT", mobile: `inv-${TENANT_ID.slice(0, 6)}`, pin: "x", role: "Admin" } })
  await prisma.device.create({ data: { tenantId: TENANT_ID, deviceId: DEVICE_ID, deviceName: "IT", status: "APPROVED" } })
  token = jwt.sign({ userId: ADMIN_ID, tenantId: TENANT_ID, role: "Admin" }, process.env.JWT_SECRET!, { expiresIn: "1h" })
  const product = await prisma.product.create({
    data: { tenantId: TENANT_ID, name: "Inv IT Widget", price: 5, cost: 2, stock: 10, barcode: `INV-${TENANT_ID.slice(0, 8)}`, category: "Test" },
  })
  productId = product.id
  await prisma.inventoryBatch.create({
    data: { id: `inv-lot-${TENANT_ID}`, tenantId: TENANT_ID, batchNumber: "A", productId, productName: "Inv IT Widget", barcode: product.barcode, initialQuantity: 10, quantityRemaining: 10, unitCost: 2, unitPrice: 5 },
  })
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
  await prisma.stockMovement.deleteMany({ where: { tenantId: TENANT_ID } })
  await prisma.syncOperation.deleteMany({ where: { tenantId: TENANT_ID } })
  await prisma.stockAdjustment.deleteMany({ where: { tenantId: TENANT_ID } })
  await prisma.inventoryBatch.deleteMany({ where: { tenantId: TENANT_ID } })
  await prisma.auditEvent.deleteMany({ where: { tenantId: TENANT_ID } })
  await prisma.device.deleteMany({ where: { tenantId: TENANT_ID } })
  await prisma.product.deleteMany({ where: { tenantId: TENANT_ID } })
  await prisma.staffUser.deleteMany({ where: { tenantId: TENANT_ID } })
  await prisma.tenant.deleteMany({ where: { id: TENANT_ID } })
})

describe("inventory write authority (real Postgres)", () => {
  it("a stock adjustment changes server stock and the adjusted lot exactly once, even when retried", async () => {
    const lotId = `inv-lot-${TENANT_ID}`
    const stock0 = await stock()
    const lot0 = await lot(lotId)
    const adjustment = {
      id: `adj-${randomUUID()}`, adjustmentNumber: `ADJ-${randomUUID().slice(0, 8)}`, productId, productName: "Inv IT Widget", barcode: `INV-${TENANT_ID.slice(0, 8)}`,
      quantityBefore: stock0, quantityChange: -3, quantityAfter: stock0 - 3, reason: "Breakage",
      // Allocations carry magnitudes; direction comes from quantityChange (as the desktop sends them).
      batchAllocations: [{ batchId: lotId, batchNumber: "A", quantity: 3, unitCost: 2 }], valueImpact: -6, createdAt: new Date().toISOString(),
    }
    const opId = randomUUID()
    expect((await push("inventory", "adjust", adjustment, opId)).status).toBe("ok")
    expect(await stock()).toBe(stock0 - 3)
    expect(await lot(lotId)).toBe(lot0 - 3)
    // Retry of the same operation, and a fresh operation carrying the same adjustment id.
    expect((await push("inventory", "adjust", adjustment, opId)).status).toBe("ok")
    expect((await push("inventory", "adjust", adjustment)).status).toBe("ok")
    expect(await stock()).toBe(stock0 - 3)
    expect(await lot(lotId)).toBe(lot0 - 3)
  })

  it("absolute lot writes from a client never overwrite server lot balances", async () => {
    const lotId = `inv-lot-${TENANT_ID}`
    const before = await lot(lotId)
    // What a pre-REFUND-INTEGRITY client sends after a sale/refund/void: its whole lot table, absolute.
    expect((await push("inventory", "update", [{ id: lotId, quantityRemaining: 999, status: "Open" }])).status).toBe("ok")
    expect(await lot(lotId)).toBe(before)
    expect((await push("inventory", "update", [{ id: lotId, quantityRemaining: 0, status: "Consumed" }])).status).toBe("ok")
    expect(await lot(lotId)).toBe(before)
    expect((await prisma.inventoryBatch.findUnique({ where: { id: lotId } }))!.status).toBe("Open")
  })
})
