import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest"
import { startServer, stopServer, request } from "./helpers"
import prisma from "../src/lib/prisma"
import { signToken } from "../src/middleware/auth"

vi.mock("../src/lib/prisma", () => {
  const model = () => ({
    findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(),
    create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), upsert: vi.fn(),
    deleteMany: vi.fn(), count: vi.fn(), groupBy: vi.fn(), aggregate: vi.fn(),
  })
  const mock: any = {
    product: model(), inventoryBatch: model(), stockMovement: model(),
    stockAdjustment: model(), auditEvent: model(),
    tenant: { findUnique: vi.fn().mockResolvedValue({ licenseStatus: "active", suspendedAt: null }) },
    $connect: vi.fn(), $disconnect: vi.fn(),
    $transaction: vi.fn((fn: any) => fn(mock)),
  }
  return { default: mock }
})

const admin = signToken({ userId: "u1", tenantId: "t1", role: "Admin" })
const cashier = signToken({ userId: "u2", tenantId: "t1", role: "Cashier" })
const manager = signToken({ userId: "u3", tenantId: "t1", role: "Manager" })

// groupBy is called for both a _sum and a _count query on the same model — branch on the arg.
function groupBy(sumRows: any[], countRows: any[]) {
  return vi.fn().mockImplementation((args: any) => Promise.resolve(args?._count ? countRows : sumRows))
}

beforeAll(startServer)
afterAll(stopServer)

describe("GET /api/inventory/reconciliation", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("403 for cashiers", async () => {
    const res = await request("GET", "/api/inventory/reconciliation", { token: cashier })
    expect(res.status).toBe(403)
  })

  it("flags over-stated aggregate vs empty batches (the succarinee class) and hides healthy rows", async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([
      { id: 1, syncId: "s1", name: "succ", barcode: "b1", category: "x", stock: 20 },
      { id: 3, syncId: "s3", name: "ok", barcode: "b3", category: "x", stock: 10 },
    ] as any)
    // product 1: has a (consumed) batch → open sum 0; product 3: open sum 10
    vi.mocked(prisma.inventoryBatch.groupBy as any).mockImplementation((a: any) =>
      Promise.resolve(a?._count ? [{ productId: 1, _count: { _all: 1 } }, { productId: 3, _count: { _all: 1 } }]
                                 : [{ productId: 3, _sum: { quantityRemaining: 10 } }]))
    vi.mocked(prisma.stockMovement.groupBy as any).mockImplementation((a: any) =>
      Promise.resolve(a?._count ? [{ productId: 1, _count: { _all: 1 } }, { productId: 3, _count: { _all: 2 } }]
                                 : [{ productId: 1, _sum: { quantity: 20 } }, { productId: 3, _sum: { quantity: 10 } }]))

    const res = await request("GET", "/api/inventory/reconciliation", { token: admin })
    expect(res.status).toBe(200)
    // healthy product 3 (A=B=L=10) hidden by default; only product 1 flagged
    expect(res.body.rows.length).toBe(1)
    const r = res.body.rows[0]
    expect(r.productId).toBe(1)
    expect(r).toMatchObject({ aggregate: 20, openBatchTotal: 0, ledgerExpected: 20, diffAB: 20, severity: "error" })
    expect(r.classification).toContain("stock_batch_mismatch")
    expect(res.body.summary.error).toBe(1)
  })

  it("flags a product with stock but no movements as needing a baseline", async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([
      { id: 2, syncId: "s2", name: "nolots", barcode: "b2", category: "x", stock: 5 },
    ] as any)
    vi.mocked(prisma.inventoryBatch.groupBy as any).mockResolvedValue([])
    vi.mocked(prisma.stockMovement.groupBy as any).mockResolvedValue([])

    const res = await request("GET", "/api/inventory/reconciliation", { token: manager })
    expect(res.status).toBe(200)
    expect(res.body.rows[0].classification).toContain("no_opening_baseline")
    expect(res.body.rows[0].severity).toBe("warn")
    expect(res.body.summary.needsBaseline).toBe(1)
  })

  it("includeOk=1 returns healthy rows too", async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([
      { id: 3, syncId: "s3", name: "ok", barcode: "b3", category: "x", stock: 10 },
    ] as any)
    vi.mocked(prisma.inventoryBatch.groupBy as any).mockImplementation((a: any) =>
      Promise.resolve(a?._count ? [{ productId: 3, _count: { _all: 1 } }] : [{ productId: 3, _sum: { quantityRemaining: 10 } }]))
    vi.mocked(prisma.stockMovement.groupBy as any).mockImplementation((a: any) =>
      Promise.resolve(a?._count ? [{ productId: 3, _count: { _all: 1 } }] : [{ productId: 3, _sum: { quantity: 10 } }]))

    const res = await request("GET", "/api/inventory/reconciliation?includeOk=1", { token: admin })
    expect(res.body.rows.length).toBe(1)
    expect(res.body.rows[0].severity).toBe("ok")
  })
})

describe("POST /api/inventory/ledger/initialize", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("403 for non-admins", async () => {
    const res = await request("POST", "/api/inventory/ledger/initialize", { token: manager })
    expect(res.status).toBe(403)
  })

  it("seeds an Opening only for products not already anchored", async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([
      { id: 1, syncId: "s1", stock: 20 }, // already anchored: existing sum = 20
      { id: 2, syncId: "s2", stock: 5 },  // no movements → needs opening = 5
    ] as any)
    vi.mocked(prisma.stockMovement.groupBy as any).mockResolvedValue([{ productId: 1, _sum: { quantity: 20 } }])
    vi.mocked(prisma.stockMovement.count).mockResolvedValueOnce(0).mockResolvedValueOnce(1) // before/after for product 2
    vi.mocked(prisma.stockMovement.findFirst).mockResolvedValue(null) // idempotency + balance lookups
    vi.mocked(prisma.stockMovement.create).mockResolvedValue({} as any)

    const res = await request("POST", "/api/inventory/ledger/initialize", { token: admin })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: true, seeded: 1, totalProducts: 2 })
    // exactly one opening movement created (for product 2), quantity 5
    expect(vi.mocked(prisma.stockMovement.create).mock.calls.length).toBe(1)
    expect(vi.mocked(prisma.stockMovement.create).mock.calls[0][0].data).toMatchObject({ productId: 2, type: "Opening", quantity: 5, reference: "opening:s2" })
  })
})

describe("POST /api/inventory/reconciliation/repair (2C-2 narrow repair)", () => {
  beforeEach(() => { vi.clearAllMocks() })

  // $transaction runs the callback with the same mock client
  function txMock() { vi.mocked((prisma as any).$transaction).mockImplementation((fn: any) => fn(prisma)) }

  function seedProduct(stock: number, batchCount = 1, openTotal = 0) {
    txMock()
    vi.mocked(prisma.product.findFirst).mockResolvedValue({ id: 7, name: "succ", barcode: "b7", stock, cost: 2 } as any)
    vi.mocked(prisma.inventoryBatch.count).mockResolvedValue(batchCount as any)
    vi.mocked(prisma.inventoryBatch.aggregate).mockResolvedValue({ _sum: { quantityRemaining: openTotal } } as any)
    vi.mocked(prisma.product.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.stockAdjustment.create).mockResolvedValue({} as any)
    vi.mocked(prisma.stockMovement.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.stockMovement.create).mockResolvedValue({} as any)
    vi.mocked(prisma.auditEvent.create).mockResolvedValue({} as any)
  }

  it("403 for cashiers", async () => {
    const res = await request("POST", "/api/inventory/reconciliation/repair", { token: cashier, body: { productId: 7, reason: "x" } })
    expect(res.status).toBe(403)
  })

  it("rejects a missing reason", async () => {
    const res = await request("POST", "/api/inventory/reconciliation/repair", { token: admin, body: { productId: 7 } })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/reason/i)
  })

  it("lowers aggregate to open-batch total, records adjustment + movement + audit, does NOT touch batches", async () => {
    seedProduct(20, 1, 0) // aggregate 20, has batches, open total 0 → repair to 0
    const res = await request("POST", "/api/inventory/reconciliation/repair", { token: manager, body: { productId: 7, reason: "batches are truth" } })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: true, aggregateBefore: 20, batchTotal: 0, aggregateAfter: 0, delta: -20 })
    // stock set to batch total via guarded updateMany
    expect(vi.mocked(prisma.product.updateMany)).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: "t1", id: 7, stock: 20 }, data: { stock: 0, updatedAt: expect.any(Date) } }))
    // adjustment + movement + audit recorded
    expect(vi.mocked(prisma.stockAdjustment.create)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(prisma.stockAdjustment.create).mock.calls[0][0].data).toMatchObject({ productId: 7, quantityBefore: 20, quantityChange: -20, quantityAfter: 0 })
    expect(vi.mocked(prisma.stockMovement.create).mock.calls[0][0].data).toMatchObject({ productId: 7, type: "Adjustment", quantity: -20 })
    expect(vi.mocked(prisma.auditEvent.create)).toHaveBeenCalledTimes(1)
    // NEVER writes batches
    expect(vi.mocked(prisma.inventoryBatch.update)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.inventoryBatch.updateMany)).not.toHaveBeenCalled()
  })

  it("rejects when aggregate <= batch total (no downward mismatch) — also covers a safe second click", async () => {
    seedProduct(10, 1, 10) // aggregate 10 == batch total 10 → nothing to repair
    const res = await request("POST", "/api/inventory/reconciliation/repair", { token: admin, body: { productId: 7, reason: "again" } })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/no downward mismatch/i)
    expect(vi.mocked(prisma.product.updateMany)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.stockAdjustment.create)).not.toHaveBeenCalled()
  })

  it("refuses a product with no batch records (would wipe untracked stock)", async () => {
    seedProduct(20, 0, 0) // no batches
    const res = await request("POST", "/api/inventory/reconciliation/repair", { token: admin, body: { productId: 7, reason: "no" } })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/no batch records/i)
    expect(vi.mocked(prisma.product.updateMany)).not.toHaveBeenCalled()
  })

  it("404 when the product does not exist", async () => {
    txMock()
    vi.mocked(prisma.product.findFirst).mockResolvedValue(null)
    const res = await request("POST", "/api/inventory/reconciliation/repair", { token: admin, body: { productId: 999, reason: "x" } })
    expect(res.status).toBe(404)
  })
})
