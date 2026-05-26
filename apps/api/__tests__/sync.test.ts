import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest"
import { startServer, stopServer, request } from "./helpers"
import prisma from "../src/lib/prisma"
import { signToken } from "../src/middleware/auth"

vi.mock("../src/lib/prisma", () => {
  const model = () => ({
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  })

  return {
    default: {
      staffUser: model(),
      product: model(),
      sale: { ...model() },
      saleRefund: { ...model() },
      customer: model(),
      debtSale: model(),
      debtPayment: model(),
      supplier: model(),
      purchaseOrder: model(),
      supplierPayment: model(),
      shift: model(),
      auditEvent: model(),
      appSettings: { findUnique: vi.fn(), upsert: vi.fn() },
      expense: model(),
      inventoryBatch: model(),
      stockAdjustment: model(),
      stockCountSession: { ...model() },
      dailyClose: model(),
      syncOperation: model(),
      $connect: vi.fn(),
      $disconnect: vi.fn(),
    },
  }
})

const token = signToken({ userId: "u1", tenantId: "t1", role: "Admin" })

beforeAll(startServer)
afterAll(stopServer)

describe("POST /api/sync/push", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("returns 401 when no Authorization header", async () => {
    const res = await request("POST", "/api/sync/push", { body: { operations: [] } })
    expect(res.status).toBe(401)
  })

  it("returns 400 when operations is not an array", async () => {
    const res = await request("POST", "/api/sync/push", { body: { operations: "bad" }, token })
    expect(res.status).toBe(400)
  })

  it("processes a valid push operation", async () => {
    vi.mocked(prisma.product.upsert).mockResolvedValue({ id: 1 })
    vi.mocked(prisma.syncOperation.create).mockResolvedValue({ id: "op1" })

    const res = await request("POST", "/api/sync/push", {
      token,
      body: {
        operations: [{ id: "op1", entity: "product", action: "create", payload: { name: "Cola", price: 1.5 } }],
      },
    })

    expect(res.status).toBe(200)
    expect(res.body.results).toHaveLength(1)
    expect(res.body.results[0].status).toBe("ok")
  })

  it("handles unknown entity without throwing", async () => {
    vi.mocked(prisma.syncOperation.create).mockResolvedValue({ id: "op1" })

    const res = await request("POST", "/api/sync/push", {
      token,
      body: {
        operations: [{ id: "op1", entity: "bogus-entity", action: "create", payload: {} }],
      },
    })

    expect(res.status).toBe(200)
  })
})

describe("GET /api/sync/pull", () => {
  function mockAllEmpty() {
    const empty: unknown[] = []
    vi.mocked(prisma.product.findMany).mockResolvedValue(empty)
    vi.mocked(prisma.sale.findMany).mockResolvedValue(empty)
    vi.mocked(prisma.saleRefund.findMany).mockResolvedValue(empty)
    vi.mocked(prisma.customer.findMany).mockResolvedValue(empty)
    vi.mocked(prisma.debtSale.findMany).mockResolvedValue(empty)
    vi.mocked(prisma.debtPayment.findMany).mockResolvedValue(empty)
    vi.mocked(prisma.supplier.findMany).mockResolvedValue(empty)
    vi.mocked(prisma.purchaseOrder.findMany).mockResolvedValue(empty)
    vi.mocked(prisma.supplierPayment.findMany).mockResolvedValue(empty)
    vi.mocked(prisma.staffUser.findMany).mockResolvedValue(empty)
    vi.mocked(prisma.shift.findMany).mockResolvedValue(empty)
    vi.mocked(prisma.auditEvent.findMany).mockResolvedValue(empty)
    vi.mocked(prisma.appSettings.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.expense.findMany).mockResolvedValue(empty)
    vi.mocked(prisma.inventoryBatch.findMany).mockResolvedValue(empty)
    vi.mocked(prisma.stockAdjustment.findMany).mockResolvedValue(empty)
    vi.mocked(prisma.stockCountSession.findMany).mockResolvedValue(empty)
    vi.mocked(prisma.dailyClose.findMany).mockResolvedValue(empty)
  }

  beforeEach(() => { vi.clearAllMocks() })

  it("returns 401 when no Authorization header", async () => {
    const res = await request("GET", "/api/sync/pull")
    expect(res.status).toBe(401)
  })

  it("returns all entities as empty arrays by default", async () => {
    mockAllEmpty()
    const res = await request("GET", "/api/sync/pull", { token })
    expect(res.status).toBe(200)
    expect(res.body.products).toEqual([])
    expect(res.body.sales).toEqual([])
    expect(res.body.customers).toEqual([])
    expect(res.body.settings).toBeNull()
  })

  it("scopes queries to the authenticated tenant", async () => {
    mockAllEmpty()
    await request("GET", "/api/sync/pull", { token })

    expect(vi.mocked(prisma.product.findMany).mock.calls[0][0]).toMatchObject({
      where: { tenantId: "t1" },
    })
    expect(vi.mocked(prisma.sale.findMany).mock.calls[0][0]).toMatchObject({
      where: { tenantId: "t1" },
    })
  })
})
