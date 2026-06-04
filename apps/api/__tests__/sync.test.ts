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
    upsert: vi.fn().mockResolvedValue({}),
    update: vi.fn(),
    deleteMany: vi.fn(),
    count: vi.fn(),
  })

  const mock = {
    staffUser: model(),
    product: { ...model(), updateMany: vi.fn() },
    sale: { ...model() },
    saleItem: { ...model(), createMany: vi.fn() },
    saleTender: { ...model() },
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
    deliveryOrder: model(),
    syncOperation: model(),
    $connect: vi.fn(),
    $disconnect: vi.fn(),
  }

  mock.$transaction = vi.fn((cb: (tx: any) => unknown) => cb(mock))

  return { default: mock }
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

  it("rejects unknown entity via Zod schema", async () => {
    const res = await request("POST", "/api/sync/push", {
      token,
      body: {
        operations: [{ id: "op1", entity: "bogus-entity", action: "create", payload: {} }],
      },
    })

    expect(res.status).toBe(400)
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
    vi.mocked(prisma.deliveryOrder.findMany).mockResolvedValue(empty)
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
    expect(res.body.settings).toEqual([])
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

describe("POST /api/sync/push — sale stock integrity", () => {
  beforeEach(() => { vi.clearAllMocks() })

  function mockNewSale() {
    // Sale does not exist yet (new sale → triggers stock decrement)
    vi.mocked(prisma.sale.findUnique).mockResolvedValue(null)
    // Product has sufficient stock
    vi.mocked(prisma.product.findMany).mockResolvedValue([
      { id: 1, stock: 10, name: "Cola" } as any,
      { id: 2, stock: 5, name: "Chips" } as any,
    ])
    vi.mocked(prisma.product.updateMany).mockResolvedValue({ count: 1 } as any)
  }

  const salePayload = {
    id: "sale-1",
    saleNumber: "S-001",
    paymentMethod: "Cash",
    subtotal: 25,
    tax: 0,
    total: 25,
    cost: 15,
    profit: 10,
    cashier: "John",
    items: [
      { id: 1, name: "Cola", barcode: "111", quantity: 2, unitPrice: 5, total: 10, cost: 3 },
      { id: 2, name: "Chips", barcode: "222", quantity: 3, unitPrice: 5, total: 15, cost: 3 },
    ],
  }

  it("decrements stock for each item on new sale", async () => {
    mockNewSale()

    const res = await request("POST", "/api/sync/push", {
      token,
      body: {
        operations: [{ id: "op1", entity: "sale", action: "create", payload: salePayload }],
      },
    })

    expect(res.status).toBe(200)
    expect(res.body.results[0].status).toBe("ok")
    // updateMany called twice (one per item) with decrement
    expect(vi.mocked(prisma.product.updateMany).mock.calls.length).toBe(2)
    expect(vi.mocked(prisma.product.updateMany).mock.calls[0][0]).toMatchObject({
      where: { tenantId: "t1", id: 1 },
      data: { stock: { decrement: 2 } },
    })
    expect(vi.mocked(prisma.product.updateMany).mock.calls[1][0]).toMatchObject({
      where: { tenantId: "t1", id: 2 },
      data: { stock: { decrement: 3 } },
    })
  })

  it("does not double-decrement stock on duplicate sale push", async () => {
    mockNewSale()
    // Simulate existing sale (second push with same ID)
    vi.mocked(prisma.sale.findUnique).mockResolvedValue({ id: "sale-1" } as any)

    const res = await request("POST", "/api/sync/push", {
      token,
      body: {
        operations: [{ id: "op1", entity: "sale", action: "create", payload: salePayload }],
      },
    })

    expect(res.status).toBe(200)
    // updateMany should NOT be called because sale already exists
    expect(vi.mocked(prisma.product.updateMany).mock.calls.length).toBe(0)
  })

  it("rejects sale push when product stock is insufficient", async () => {
    // Product stock is less than sale quantity
    vi.mocked(prisma.sale.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.product.findMany).mockResolvedValue([
      { id: 1, stock: 1, name: "Cola" } as any,   // only 1 in stock, need 2
      { id: 2, stock: 5, name: "Chips" } as any,
    ])

    const res = await request("POST", "/api/sync/push", {
      token,
      body: {
        operations: [{ id: "op1", entity: "sale", action: "create", payload: salePayload }],
      },
    })

    expect(res.status).toBe(200)
    expect(res.body.results[0].status).toBe("error")
    expect(res.body.results[0].error).toContain("Insufficient stock")
    // updateMany should NOT be called (stock check failed before decrement)
    expect(vi.mocked(prisma.product.updateMany).mock.calls.length).toBe(0)
  })
})
})
