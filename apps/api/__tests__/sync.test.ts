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
    tenant: { findUnique: vi.fn().mockResolvedValue({ licenseStatus: "active", suspendedAt: null, offlineGraceDays: 7 }) },
    expense: model(),
    inventoryBatch: { ...model(), updateMany: vi.fn() },
    stockAdjustment: model(),
    stockMovement: model(),
    stockCountSession: { ...model() },
    stockCountLine: model(),
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
    vi.mocked(prisma.syncOperation.findMany).mockResolvedValue(empty)
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

  it("returns 400 when 'since' is an invalid date (fix #5)", async () => {
    const res = await request("GET", "/api/sync/pull?since=garbage", { token })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("Invalid 'since' date parameter")
  })

  it("returns 400 when 'since' is a nonsense string", async () => {
    const res = await request("GET", "/api/sync/pull?since=not-a-date", { token })
    expect(res.status).toBe(400)
  })

  it("uses createdFilter (createdAt only) for staff when since is provided", async () => {
    mockAllEmpty()
    await request("GET", "/api/sync/pull?since=2026-01-01T00:00:00Z", { token })

    const staffWhere = vi.mocked(prisma.staffUser.findMany).mock.calls[0][0]?.where
    expect(staffWhere).toBeDefined()
    expect(staffWhere.tenantId).toBe("t1")
    // StaffUser has no updatedAt — use createdAt filter only
    expect(staffWhere.createdAt).toBeDefined()
    expect(staffWhere.OR).toBeUndefined()
  })

  it("uses updatedFilter (not createdFilter) for products with since", async () => {
    mockAllEmpty()
    await request("GET", "/api/sync/pull?since=2026-01-01T00:00:00Z", { token })

    const productWhere = vi.mocked(prisma.product.findMany).mock.calls[0][0]?.where
    expect(productWhere.OR).toBeDefined()
    expect(productWhere.OR[0].createdAt).toBeDefined()
    expect(productWhere.OR[1].updatedAt).toBeDefined()
  })

  it("uses createdFilter (no OR) for sales with since", async () => {
    mockAllEmpty()
    await request("GET", "/api/sync/pull?since=2026-01-01T00:00:00Z", { token })

    const saleWhere = vi.mocked(prisma.sale.findMany).mock.calls[0][0]?.where
    // Sales use createdFilter (createdAt only, no OR)
    expect(saleWhere.createdAt).toBeDefined()
    expect(saleWhere.OR).toBeUndefined()
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

  it("strips registerId/deviceId from the sale payload — Sale has no such columns", async () => {
    mockNewSale()
    vi.mocked(prisma.sale.create).mockResolvedValue({} as any)

    const res = await request("POST", "/api/sync/push", {
      token,
      body: {
        operations: [{
          id: "op-reg",
          entity: "sale",
          action: "create",
          payload: { ...salePayload, id: "sale-reg", saleNumber: "S-REG", registerId: "REG-001", deviceId: "DEV-ABC" },
        }],
      },
    })

    expect(res.status).toBe(200)
    expect(res.body.results[0].status).toBe("ok")
    const createArgs = vi.mocked(prisma.sale.create).mock.calls[0][0] as any
    expect(createArgs.data).not.toHaveProperty("registerId")
    expect(createArgs.data).not.toHaveProperty("deviceId")
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
    // Atomic decrement returns count 0 — stock check fails inline
    vi.mocked(prisma.product.updateMany).mockResolvedValue({ count: 0 } as any)

    const res = await request("POST", "/api/sync/push", {
      token,
      body: {
        operations: [{ id: "op1", entity: "sale", action: "create", payload: salePayload }],
      },
    })

    expect(res.status).toBe(200)
    expect(res.body.results[0].status).toBe("rejected")
    expect(res.body.results[0].error).toContain("Insufficient stock")
    // updateMany IS called (it's the atomic check itself), but returns count 0
    expect(vi.mocked(prisma.product.updateMany).mock.calls.length).toBe(1)
  })
})

describe("POST /api/sync/push — product delete cascading", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("product.delete now silently archives — preserves inventory history", async () => {
    vi.mocked(prisma.product.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.syncOperation.create).mockResolvedValue({} as any)

    const res = await request("POST", "/api/sync/push", {
      token,
      body: { operations: [{ id: "op-del-now-archive", entity: "product", action: "delete", payload: { id: 42 } }] },
    })

    expect(res.status).toBe(200)
    // Product is archived, not deleted
    expect(vi.mocked(prisma.product.updateMany).mock.calls[0][0]).toMatchObject({
      where: { tenantId: "t1", id: 42 }, data: { archived: true },
    })
    expect(vi.mocked(prisma.product.deleteMany)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.inventoryBatch.deleteMany)).not.toHaveBeenCalled()
  })
})

describe("POST /api/sync/push — concurrent stock race", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("only one of two concurrent sales succeeds when product stock is insufficient", async () => {
    // Two devices sell the same last unit simultaneously.
    // Product has stock=1, each sale needs 1.
    vi.mocked(prisma.sale.findUnique).mockResolvedValue(null)

    vi.mocked(prisma.product.findMany).mockResolvedValue([
      { id: 1, stock: 1, name: "Cola" } as any,
    ])

    // First product.updateMany succeeds, second fails (stock race)
    let productUpdateCalls = 0
    vi.mocked(prisma.product.updateMany).mockImplementation(() => {
      productUpdateCalls++
      return productUpdateCalls <= 1
        ? Promise.resolve({ count: 1 } as any)
        : Promise.resolve({ count: 0 } as any)
    })

    vi.mocked(prisma.sale.create).mockResolvedValue({} as any)
    vi.mocked(prisma.syncOperation.create).mockResolvedValue({} as any)

    const salePayload = (suffix: string) => ({
      id: `sale-concurrent-${suffix}`,
      saleNumber: `S-CON-${suffix}`,
      paymentMethod: "Cash",
      subtotal: 10,
      total: 10,
      cashier: "Dev",
      items: [{ id: 1, name: "Cola", barcode: "111", quantity: 1, unitPrice: 10, total: 10, cost: 5 }],
    })

    const [res1, res2] = await Promise.all([
      request("POST", "/api/sync/push", {
        token,
        body: { operations: [{ id: "op-con-a", entity: "sale", action: "create", payload: salePayload("a") }] },
      }),
      request("POST", "/api/sync/push", {
        token,
        body: { operations: [{ id: "op-con-b", entity: "sale", action: "create", payload: salePayload("b") }] },
      }),
    ])

    const statuses = [res1.body.results[0].status, res2.body.results[0].status].sort()
    expect(statuses).toEqual(["ok", "rejected"])
    const rejectedResult = res1.body.results[0].status === "rejected" ? res1.body.results[0] : res2.body.results[0]
    expect(rejectedResult.error).toContain("Insufficient stock")
  })

  it("idempotent push does not race with first-time push", async () => {
    // Device 1 pushes a new sale; Device 2 pushes the same sale (retry).
    // The duplicate should be safely skipped without error.
    vi.mocked(prisma.sale.findUnique)
      .mockResolvedValueOnce(null)   // Device 1: sale doesn't exist
      .mockResolvedValueOnce({ id: "sale-con-retry" } as any)  // Device 2: sale exists

    vi.mocked(prisma.product.findMany).mockResolvedValue([
      { id: 1, stock: 10, name: "Cola" } as any,
    ])
    vi.mocked(prisma.product.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.sale.create).mockResolvedValue({} as any)
    vi.mocked(prisma.syncOperation.create).mockResolvedValue({} as any)

    const salePayload = {
      id: "sale-con-retry",
      saleNumber: "S-CON-RETRY",
      paymentMethod: "Cash",
      subtotal: 10,
      total: 10,
      cashier: "Dev",
      items: [{ id: 1, name: "Cola", barcode: "111", quantity: 1, unitPrice: 10, total: 10, cost: 5 }],
    }

    const [res1, res2] = await Promise.all([
      request("POST", "/api/sync/push", {
        token,
        body: { operations: [{ id: "op-retry-1", entity: "sale", action: "create", payload: salePayload }] },
      }),
      request("POST", "/api/sync/push", {
        token,
        body: { operations: [{ id: "op-retry-2", entity: "sale", action: "create", payload: salePayload }] },
      }),
    ])

    // Both should be "ok" — the duplicate is idempotent
    expect(res1.body.results[0].status).toBe("ok")
    expect(res2.body.results[0].status).toBe("ok")
    // Product stock should only decrement once
    const productUpdateCalls = vi.mocked(prisma.product.updateMany).mock.calls
    const decrementCalls = productUpdateCalls.filter((c: any) => c[0]?.data?.stock?.decrement !== undefined)
    expect(decrementCalls.length).toBe(1)
  })
})

describe("POST /api/sync/push — product.delete archive safety", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("product.delete with barcode fallback archives by tenantId + barcode", async () => {
    vi.mocked(prisma.product.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.product.findMany).mockResolvedValue([])
    vi.mocked(prisma.syncOperation.create).mockResolvedValue({} as any)

    const res = await request("POST", "/api/sync/push", {
      token,
      body: { operations: [{ id: "op-del-barcode", entity: "product", action: "delete", payload: { barcode: "5281000123457" } }] },
    })

    expect(res.status).toBe(200)
    // Archives by barcode (no id in payload)
    expect(vi.mocked(prisma.product.updateMany).mock.calls[0][0]).toMatchObject({
      where: { tenantId: "t1", barcode: "5281000123457" }, data: { archived: true },
    })
    expect(vi.mocked(prisma.product.deleteMany)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.inventoryBatch.deleteMany)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.stockMovement.deleteMany)).not.toHaveBeenCalled()
  })

  it("product.delete with id archives by id (not barcode) when both present", async () => {
    vi.mocked(prisma.product.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.product.findMany).mockResolvedValue([])
    vi.mocked(prisma.syncOperation.create).mockResolvedValue({} as any)

    const res = await request("POST", "/api/sync/push", {
      token,
      body: { operations: [{ id: "op-del-both", entity: "product", action: "delete", payload: { id: 99, barcode: "5281999999999" } }] },
    })

    expect(res.status).toBe(200)
    // id takes priority
    expect(vi.mocked(prisma.product.updateMany).mock.calls[0][0]).toMatchObject({
      where: { tenantId: "t1", id: 99 }, data: { archived: true },
    })
  })
})

describe("POST /api/sync/push — refund idempotency and batch restore", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("refund retry does not double-restore product stock or batch quantity", async () => {
    // First push: refund does not exist yet
    vi.mocked(prisma.saleRefund.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.saleRefund.upsert).mockResolvedValue({} as any)
    vi.mocked(prisma.product.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.syncOperation.create).mockResolvedValue({} as any)
    vi.mocked(prisma.product.findMany).mockResolvedValue([])
    // Mock stockMovement.create
    const stockMovMock = (prisma as any).stockMovement
    if (stockMovMock.create) vi.mocked(stockMovMock.create).mockResolvedValue({} as any)
    if (stockMovMock.findFirst) vi.mocked(stockMovMock.findFirst).mockResolvedValue(null)

    const refundPayload = {
      id: "ref-retry-1",
      refundNumber: "R-001",
      saleId: "sale-1",
      saleNumber: "S-001",
      method: "Cash",
      reason: "Test",
      total: 30,
      items: [{ id: 1, name: "Cola", barcode: "111", quantity: 3, unitPrice: 10, total: 30, cost: 5 }],
    }

    const op = [{ id: "op-ref-1", entity: "refund", action: "create", payload: refundPayload }]

    const res1 = await request("POST", "/api/sync/push", { token, body: { operations: op } })
    expect(res1.status).toBe(200)

    // Second push: same refund — should skip
    vi.mocked(prisma.saleRefund.findUnique).mockResolvedValue({ id: "ref-retry-1" } as any)

    const res2 = await request("POST", "/api/sync/push", { token, body: { operations: op } })
    expect(res2.status).toBe(200)

    // Stock should only have been incremented once (from first push)
    const stockCalls = vi.mocked(prisma.product.updateMany).mock.calls.filter(
      (c: any) => c[0]?.data?.stock?.increment !== undefined
    )
    expect(stockCalls.length).toBe(1)
  })

  it("refund restores batch quantities from batchAllocations", async () => {
    vi.mocked(prisma.saleRefund.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.saleRefund.upsert).mockResolvedValue({} as any)
    vi.mocked(prisma.product.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.syncOperation.create).mockResolvedValue({} as any)
    vi.mocked(prisma.product.findMany).mockResolvedValue([])
    vi.mocked(prisma.inventoryBatch.updateMany).mockResolvedValue({ count: 1 } as any)
    const stockMovMock = (prisma as any).stockMovement
    if (stockMovMock.create) vi.mocked(stockMovMock.create).mockResolvedValue({} as any)
    if (stockMovMock.findFirst) vi.mocked(stockMovMock.findFirst).mockResolvedValue(null)

    const refundPayload = {
      id: "ref-batch-1",
      refundNumber: "R-BATCH-1",
      saleId: "sale-batch-1",
      saleNumber: "S-BATCH-1",
      method: "Cash",
      reason: "Test",
      total: 10,
      items: [{
        id: 1, name: "Cola", barcode: "111", quantity: 2, unitPrice: 5, total: 10, cost: 3,
        batchAllocations: [{ batchId: "batch-a", batchNumber: "BN-001", quantity: 2 }],
      }],
    }

    const res = await request("POST", "/api/sync/push", {
      token,
      body: { operations: [{ id: "op-ref-batch", entity: "refund", action: "create", payload: refundPayload }] },
    })

    expect(res.status).toBe(200)
    // Batch should be restored
    const batchCalls = vi.mocked(prisma.inventoryBatch.updateMany).mock.calls
    expect(batchCalls.length).toBeGreaterThanOrEqual(1)
    const batchRestoreCall = batchCalls[0][0]
    expect(batchRestoreCall.where).toMatchObject({ id: "batch-a", tenantId: "t1" })
    expect(batchRestoreCall.data).toMatchObject({ quantityRemaining: { increment: 2 }, status: "Open" })
  })

  it("refund without batchAllocations triggers fallback batch restore", async () => {
    vi.mocked(prisma.saleRefund.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.saleRefund.upsert).mockResolvedValue({} as any)
    vi.mocked(prisma.product.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.syncOperation.create).mockResolvedValue({} as any)
    vi.mocked(prisma.product.findMany).mockResolvedValue([])
    vi.mocked(prisma.inventoryBatch.updateMany).mockResolvedValue({ count: 1 } as any)
    // Mock findFirst for fallback
    vi.mocked(prisma.inventoryBatch.findFirst).mockResolvedValue({ id: "batch-fallback", productId: 1 } as any)
    const stockMovMock = (prisma as any).stockMovement
    if (stockMovMock.create) vi.mocked(stockMovMock.create).mockResolvedValue({} as any)
    if (stockMovMock.findFirst) vi.mocked(stockMovMock.findFirst).mockResolvedValue(null)

    const refundPayload = {
      id: "ref-fallback-1",
      refundNumber: "R-FALLBACK-1",
      saleId: "sale-fallback-1",
      saleNumber: "S-FALLBACK-1",
      method: "Cash",
      reason: "Test",
      total: 10,
      items: [{ id: 1, name: "Cola", barcode: "111", quantity: 2, unitPrice: 5, total: 10, cost: 3 }],
    }

    const res = await request("POST", "/api/sync/push", {
      token,
      body: { operations: [{ id: "op-ref-fallback", entity: "refund", action: "create", payload: refundPayload }] },
    })

    expect(res.status).toBe(200)
    // Fallback: restored to newest batch
    expect(vi.mocked(prisma.inventoryBatch.findFirst)).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ productId: 1 }) })
    )
    const batchCalls = vi.mocked(prisma.inventoryBatch.updateMany).mock.calls
    expect(batchCalls.length).toBeGreaterThanOrEqual(1)
  })

  it("refund matches original item by barcode (not desktop productId)", async () => {
    vi.mocked(prisma.saleRefund.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.saleRefund.upsert).mockResolvedValue({} as any)
    vi.mocked(prisma.product.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.syncOperation.create).mockResolvedValue({} as any)
    vi.mocked(prisma.product.findMany).mockResolvedValue([])
    vi.mocked(prisma.inventoryBatch.updateMany).mockResolvedValue({ count: 1 } as any)
    const stockMovMock = (prisma as any).stockMovement
    if (stockMovMock.create) vi.mocked(stockMovMock.create).mockResolvedValue({} as any)
    if (stockMovMock.findFirst) vi.mocked(stockMovMock.findFirst).mockResolvedValue(null)

    // Desktop productId=500, but server resolved productId=3 via barcode "111"
    // The matching should use barcode "111" to find originalItem, not id=500
    const refundPayload = {
      id: "ref-match-test",
      refundNumber: "R-MATCH",
      saleId: "sale-match-1",
      saleNumber: "S-MATCH-1",
      method: "Cash",
      reason: "Match test",
      total: 10,
      items: [{
        id: 500, name: "Cola", barcode: "111", quantity: 1, unitPrice: 10, total: 10, cost: 5,
        batchAllocations: [{ batchId: "batch-match", batchNumber: "BN-MATCH", quantity: 1 }],
      }],
    }

    const res = await request("POST", "/api/sync/push", {
      token,
      body: { operations: [{ id: "op-ref-match", entity: "refund", action: "create", payload: refundPayload }] },
    })

    expect(res.status).toBe(200)
    // findFirst was called to resolve productId by barcode
    expect(vi.mocked(prisma.product.findFirst)).toHaveBeenCalled()
  })
})
})
