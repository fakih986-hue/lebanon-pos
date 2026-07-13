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
    tenant: { findUnique: vi.fn().mockResolvedValue({ licenseStatus: "active", suspendedAt: null }) },
    $connect: vi.fn(), $disconnect: vi.fn(),
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
