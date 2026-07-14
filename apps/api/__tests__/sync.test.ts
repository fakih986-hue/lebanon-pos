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
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
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
    cashMovement: model(),
    deliveryOrder: model(),
    syncOperation: model(),
    $connect: vi.fn(),
    $disconnect: vi.fn(),
  }

  mock.$transaction = vi.fn((cb: (tx: any) => unknown) => cb(mock))

  return { default: mock }
})

vi.mock("../src/ws/index", () => ({
  broadcastToTenant: vi.fn(),
  broadcastToUser: vi.fn(),
}))

import { broadcastToTenant } from "../src/ws/index"

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

describe("POST /api/sync/validate-stock", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("returns ok:true when every item has enough stock", async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([
      { id: 1, name: "Cola", stock: 10, archived: false },
      { id: 2, name: "Chips", stock: 5, archived: false },
    ] as any)

    const res = await request("POST", "/api/sync/validate-stock", {
      token,
      body: { items: [{ productId: 1, quantity: 2 }, { productId: 2, quantity: 5 }] },
    })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.insufficientItems).toEqual([])
  })

  it("returns ok:false with details when a product ran out on the hub", async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([
      { id: 1, name: "Cola", stock: 0, archived: false },
    ] as any)

    const res = await request("POST", "/api/sync/validate-stock", {
      token,
      body: { items: [{ productId: 1, quantity: 3 }] },
    })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(false)
    expect(res.body.insufficientItems).toEqual([
      { productId: 1, name: "Cola", available: 0, requested: 3 },
    ])
  })

  it("treats a product missing locally (e.g. deleted) as unavailable", async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([] as any)

    const res = await request("POST", "/api/sync/validate-stock", {
      token,
      body: { items: [{ productId: 999, quantity: 1 }] },
    })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(false)
    expect(res.body.insufficientItems[0]).toMatchObject({ productId: 999, available: 0, requested: 1 })
  })

  it("treats an archived product as unavailable even if stock is nonzero", async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([
      { id: 1, name: "Discontinued Item", stock: 20, archived: true },
    ] as any)

    const res = await request("POST", "/api/sync/validate-stock", {
      token,
      body: { items: [{ productId: 1, quantity: 1 }] },
    })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(false)
  })

  it("returns 400 for a malformed body", async () => {
    const res = await request("POST", "/api/sync/validate-stock", {
      token,
      body: { items: "not-an-array" },
    })
    expect(res.status).toBe(400)
  })
})

describe("GET /api/sync/sale-committed/:saleId (write-through idempotency check)", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("returns committed:true when a non-voided sale with that id exists", async () => {
    vi.mocked(prisma.sale.findFirst).mockResolvedValue({ id: "sale-x" } as any)
    const res = await request("GET", "/api/sync/sale-committed/sale-x", { token })
    expect(res.status).toBe(200)
    expect(res.body.committed).toBe(true)
    // scoped to tenant + not voided
    const where = vi.mocked(prisma.sale.findFirst).mock.calls[0][0].where
    expect(where).toMatchObject({ id: "sale-x", tenantId: "t1", status: { not: "Voided" } })
  })

  it("returns committed:false when no such sale exists", async () => {
    vi.mocked(prisma.sale.findFirst).mockResolvedValue(null)
    const res = await request("GET", "/api/sync/sale-committed/nope", { token })
    expect(res.status).toBe(200)
    expect(res.body.committed).toBe(false)
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

  it("filters batches by receivedAt OR updatedAt so consumed batches propagate (POS-SYNC-AUTHORITY-1)", async () => {
    mockAllEmpty()
    await request("GET", "/api/sync/pull?since=2026-01-01T00:00:00Z", { token })

    const batchCall = vi.mocked(prisma.inventoryBatch.findMany).mock.calls[0][0]
    const batchWhere = batchCall?.where as any
    // A batch consumed by a sale bumps updatedAt but NOT receivedAt — the old
    // receivedAt-only filter missed it, stranding stale stock on other devices.
    expect(batchWhere.OR).toBeDefined()
    expect(batchWhere.OR[0].receivedAt).toBeDefined()
    expect(batchWhere.OR[1].updatedAt).toBeDefined()
    // And order by updatedAt so the most-recently-changed batches come first.
    expect((batchCall as any).orderBy).toMatchObject({ updatedAt: "desc" })
  })

describe("POST /api/sync/push — stock ledger record-only (POS-SYNC-AUTHORITY-2A)", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("logs a Refund movement (+qty, ref=refundId) without changing the restore", async () => {
    vi.mocked(prisma.saleRefund.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.saleRefund.upsert).mockResolvedValue({} as any)
    vi.mocked(prisma.product.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.product.findMany).mockResolvedValue([])

    const res = await request("POST", "/api/sync/push", {
      token,
      body: { operations: [{ id: "op-led-ref", entity: "refund", action: "create", payload: {
        id: "ref-led-1", refundNumber: "R-LED", saleId: "sale-x", saleNumber: "S-x", method: "Cash", reason: "t", total: 5, cashier: "Amy",
        items: [{ id: 1, name: "Cola", barcode: "111", quantity: 2, unitPrice: 5, total: 10, cost: 3 }],
      } }] },
    })
    expect(res.status).toBe(200)
    // Record-only: the stock restore (increment) still happens.
    expect(vi.mocked(prisma.product.updateMany)).toHaveBeenCalledWith(expect.objectContaining({ data: { stock: { increment: 2 }, updatedAt: expect.any(Date) } }))
    const moves = vi.mocked((prisma as any).stockMovement.create).mock.calls.map((c: any) => c[0].data)
    const refMove = moves.find((m: any) => m.type === "Refund" && m.reference === "ref-led-1")
    expect(refMove).toBeTruthy()
    expect(refMove.quantity).toBe(2)
    expect(refMove.userName).toBe("Amy")
  })

  it("logs an Opening movement when a product is created with initial stock", async () => {
    vi.mocked(prisma.product.findFirst).mockResolvedValue(null) // no syncId/barcode match → create
    vi.mocked(prisma.product.create).mockResolvedValue({ id: 99, stock: 7, syncId: "sync-new" } as any)

    const res = await request("POST", "/api/sync/push", {
      token,
      body: { operations: [{ id: "op-led-open", entity: "product", action: "create", payload: {
        syncId: "sync-new", name: "New Item", barcode: "NB1", price: 1, cost: 0.5, category: "x", stock: 7,
      } }] },
    })
    expect(res.status).toBe(200)
    const moves = vi.mocked((prisma as any).stockMovement.create).mock.calls.map((c: any) => c[0].data)
    const opening = moves.find((m: any) => m.type === "Opening")
    expect(opening).toBeTruthy()
    expect(opening).toMatchObject({ productId: 99, quantity: 7, reference: "opening:sync-new" })
  })

  it("does NOT log an Opening movement when a product is created with zero stock", async () => {
    vi.mocked(prisma.product.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.product.create).mockResolvedValue({ id: 100, stock: 0, syncId: "sync-zero" } as any)

    await request("POST", "/api/sync/push", {
      token,
      body: { operations: [{ id: "op-led-zero", entity: "product", action: "create", payload: {
        syncId: "sync-zero", name: "Zero Item", barcode: "NB2", price: 1, cost: 0.5, category: "x", stock: 0,
      } }] },
    })
    const moves = vi.mocked((prisma as any).stockMovement.create).mock.calls.map((c: any) => c[0].data)
    expect(moves.find((m: any) => m.type === "Opening")).toBeFalsy()
  })
})

describe("POST /api/sync/push — server-side stock write guard (POS-SYNC-HARDEN-2)", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("strips 'stock' from a generic product update but still applies metadata", async () => {
    vi.mocked(prisma.product.updateMany).mockResolvedValue({ count: 1 } as any)
    const res = await request("POST", "/api/sync/push", {
      token,
      body: { operations: [{ id: "op-guard", entity: "product", action: "update", payload: {
        syncId: "sync-1", name: "Renamed", price: 3.5, cost: 2, category: "Drinks", barcode: "B1", archived: false, reorderPoint: 4, stock: 9999,
      } }] },
    })
    expect(res.status).toBe(200)
    const data = vi.mocked(prisma.product.updateMany).mock.calls[0][0].data as any
    expect(data).not.toHaveProperty("stock")             // stock stripped
    expect(data).not.toHaveProperty("_stockUpdate")      // marker never persisted
    expect(data).toMatchObject({ name: "Renamed", price: 3.5, cost: 2, category: "Drinks", barcode: "B1", archived: false, reorderPoint: 4 })
  })

  it("KEEPS 'stock' when the update is a marked receive (_stockUpdate) — restocking still works", async () => {
    vi.mocked(prisma.product.updateMany).mockResolvedValue({ count: 1 } as any)
    const res = await request("POST", "/api/sync/push", {
      token,
      body: { operations: [{ id: "op-receive", entity: "product", action: "update", payload: {
        syncId: "sync-2", name: "Cola", stock: 50, _stockUpdate: true,
      } }] },
    })
    expect(res.status).toBe(200)
    const data = vi.mocked(prisma.product.updateMany).mock.calls[0][0].data as any
    expect(data.stock).toBe(50)                          // stock preserved for receive
    expect(data).not.toHaveProperty("_stockUpdate")      // marker not persisted
    expect(data.name).toBe("Cola")
  })

  it("a stockless product update is unaffected", async () => {
    vi.mocked(prisma.product.updateMany).mockResolvedValue({ count: 1 } as any)
    const res = await request("POST", "/api/sync/push", {
      token, body: { operations: [{ id: "op-meta", entity: "product", action: "update", payload: { syncId: "sync-3", name: "Just Metadata" } }] },
    })
    expect(res.status).toBe(200)
    const data = vi.mocked(prisma.product.updateMany).mock.calls[0][0].data as any
    expect(data).toMatchObject({ name: "Just Metadata" })
    expect(data).not.toHaveProperty("stock")
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

  it("consumes a real open batch server-side instead of silently skipping when the client falls back to legacy-stock", async () => {
    // Reproduces the exact live bug found in POS-SYNC-TORTURE-1's follow-up:
    // product 63's aggregate stock drifted to 0 while its real batch still
    // had 21 units remaining, because the client's stale local batch cache
    // fell back to "legacy-stock" (never touching the real batch) while the
    // aggregate decrement still ran. The server must now try to consume
    // from a real open batch before conceding the shortfall is truly
    // untracked legacy stock.
    mockNewSale()
    vi.mocked(prisma.inventoryBatch.findMany).mockResolvedValue([
      { id: "batch-real-1", quantityRemaining: 21 },
    ] as any)
    vi.mocked(prisma.inventoryBatch.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await request("POST", "/api/sync/push", {
      token,
      body: {
        operations: [{
          id: "op-legacy-fallback",
          entity: "sale",
          action: "create",
          payload: {
            ...salePayload,
            id: "sale-legacy-fallback",
            saleNumber: "S-LEGACY-1",
            items: [
              { id: 1, name: "Cola", barcode: "111", quantity: 2, unitPrice: 5, total: 10, cost: 3,
                batchAllocations: [{ batchId: "legacy-stock", quantity: 2 }] },
            ],
          },
        }],
      },
    })

    expect(res.status).toBe(200)
    expect(res.body.results[0].status).toBe("ok")

    // The server must have looked for real open batches for this product...
    expect(vi.mocked(prisma.inventoryBatch.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ productId: 1, status: "Open" }) })
    )
    // ...and consumed from the real batch instead of silently skipping it.
    expect(vi.mocked(prisma.inventoryBatch.updateMany)).toHaveBeenCalledWith({
      where: { id: "batch-real-1", tenantId: "t1", quantityRemaining: { gte: 2 } },
      data: { quantityRemaining: { decrement: 2 } },
    })
  })

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

  it("records a Sale stock movement (record-only) without changing the stock decrement (POS-SYNC-AUTHORITY-2A)", async () => {
    mockNewSale()
    const res = await request("POST", "/api/sync/push", {
      token,
      body: {
        deviceId: "DEV-XYZ",
        operations: [{ id: "op-ledger-sale", entity: "sale", action: "create", payload: { ...salePayload, id: "sale-ledger", saleNumber: "S-LEDGER" } }],
      },
    })
    expect(res.status).toBe(200)
    expect(res.body.results[0].status).toBe("ok")

    // Record-only: the real stock decrement still happens exactly as before.
    expect(vi.mocked(prisma.product.updateMany).mock.calls.length).toBe(2)
    expect(vi.mocked(prisma.product.updateMany).mock.calls[0][0]).toMatchObject({ data: { stock: { decrement: 2 } } })

    // New: a signed Sale movement is logged per item, referencing the sale id,
    // with source attribution threaded (deviceId from push, cashier as userName).
    const movements = vi.mocked((prisma as any).stockMovement.create).mock.calls.map((c: any) => c[0].data)
    const saleMoves = movements.filter((m: any) => m.type === "Sale" && m.reference === "sale-ledger")
    expect(saleMoves.length).toBe(2)
    expect(saleMoves.map((m: any) => m.quantity).sort((a: number, b: number) => a - b)).toEqual([-3, -2])
    expect(saleMoves[0]).toMatchObject({ deviceId: "DEV-XYZ", userId: "u1", userName: "John" })
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

  it.each([
    ["shift", "open", "shift", { id: "shift-x", shiftNumber: "SHIFT-X" }],
    ["expense", "create", "expense", { id: "exp-x", expenseNumber: "EXP-X", vendor: "v", category: "c", amount: 5, paymentMethod: "Cash", recordedBy: "Admin" }],
    ["cash-movement", "create", "cashMovement", { id: "cm-x", type: "CashIn", amountUsd: 5, reason: "r", recordedByName: "Admin" }],
    ["daily-close", "close", "dailyClose", { id: "dc-x", dateKey: "2026-07-11", grossSales: 5, netSales: 5, closedBy: "Admin" }],
    ["purchase-order", "create", "purchaseOrder", { id: "po-x", poNumber: "PO-X", supplierId: "sup1", supplierName: "s", total: 5, createdBy: "Admin" }],
    ["supplier-payment", "create", "supplierPayment", { id: "sp-x", supplierId: "sup1", supplierName: "s", amount: 5, method: "Cash", recordedBy: "Admin" }],
  ])("strips registerId/deviceId from %s payload — %s model has no such columns", async (entity, action, model, basePayload) => {
    const res = await request("POST", "/api/sync/push", {
      token,
      body: {
        operations: [{
          id: `op-${entity}`,
          entity,
          action,
          payload: { ...basePayload, registerId: "REG-001", deviceId: "DEV-ABC" },
        }],
      },
    })

    expect(res.status).toBe(200)
    expect(res.body.results[0].status).toBe("ok")
    const upsertArgs = vi.mocked((prisma as any)[model].upsert).mock.calls.at(-1)?.[0] as any
    expect(upsertArgs.create).not.toHaveProperty("registerId")
    expect(upsertArgs.create).not.toHaveProperty("deviceId")
  })

  it("strips registerName from settings payload (device-local, no AppSettings column) but keeps profitPercent1/2 (real, persisted columns)", async () => {
    vi.mocked(prisma.appSettings.upsert).mockResolvedValue({} as any)

    const res = await request("POST", "/api/sync/push", {
      token,
      body: {
        operations: [{
          id: "op-settings",
          entity: "settings",
          action: "update",
          payload: { storeName: "Fakih Store", vatRate: 0.11, profitPercent1: 25, profitPercent2: 35, registerName: "Front Counter" },
        }],
      },
    })

    expect(res.status).toBe(200)
    expect(res.body.results[0].status).toBe("ok")
    const upsertArgs = vi.mocked(prisma.appSettings.upsert).mock.calls.at(-1)?.[0] as any
    expect(upsertArgs.update).not.toHaveProperty("registerName")
    expect(upsertArgs.update.profitPercent1).toBe(25)
    expect(upsertArgs.update.profitPercent2).toBe(35)
  })

  it("accepts unsyncedCountAtClose on daily-close payload — DailyClose now has that column", async () => {
    vi.mocked(prisma.dailyClose.upsert).mockResolvedValue({} as any)

    const res = await request("POST", "/api/sync/push", {
      token,
      body: {
        operations: [{
          id: "op-dc",
          entity: "daily-close",
          action: "close",
          payload: { id: "dc-1", dateKey: "2026-07-11", grossSales: 100, netSales: 100, closedBy: "Admin", unsyncedCountAtClose: 3 },
        }],
      },
    })

    expect(res.status).toBe(200)
    expect(res.body.results[0].status).toBe("ok")
    const upsertArgs = vi.mocked(prisma.dailyClose.upsert).mock.calls.at(-1)?.[0] as any
    expect(upsertArgs.create.unsyncedCountAtClose).toBe(3)
  })

  it.each([
    ["customer", "customer"],
    ["supplier", "supplier"],
  ])("accepts a partial archived-only payload on %s update — %s model now has that column", async (entity, model) => {
    // Archive/restore send only {id, archived} — a combined upsert requires
    // the full create+update shape even though only update runs, so this
    // partial payload always threw "Argument name is missing" (same defect
    // class as the earlier product fix; found live against production
    // during the 1.0.20 rollout). Update now goes through updateMany, a real
    // partial patch, not upsert.
    vi.mocked((prisma as any)[model].updateMany).mockResolvedValue({ count: 1 })

    const res = await request("POST", "/api/sync/push", {
      token,
      body: {
        operations: [{
          id: `op-archive-${entity}`,
          entity,
          action: "update",
          payload: { id: `${entity}-1`, archived: true },
        }],
      },
    })

    expect(res.status).toBe(200)
    expect(res.body.results[0].status).toBe("ok")
    const updateArgs = vi.mocked((prisma as any)[model].updateMany).mock.calls.at(-1)?.[0] as any
    expect(updateArgs.data.archived).toBe(true)
    expect(updateArgs.data).not.toHaveProperty("id") // id is the where-key, not part of the patch
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

describe("POST /api/sync/push — live activity feed", () => {
  beforeEach(() => { vi.clearAllMocks() })

  function mockNewSale() {
    vi.mocked(prisma.sale.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.product.findMany).mockResolvedValue([
      { id: 1, stock: 10, name: "Cola" } as any,
    ])
    vi.mocked(prisma.product.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.sale.create).mockResolvedValue({} as any)
  }

  const salePayload = {
    id: "sale-activity-1",
    saleNumber: "S-ACT-1",
    paymentMethod: "Cash",
    subtotal: 10,
    tax: 0,
    total: 10,
    cost: 6,
    profit: 4,
    cashier: "Ahmad",
    items: [
      { id: 1, name: "Coca-Cola", barcode: "111", quantity: 2, unitPrice: 5, total: 10, cost: 3 },
    ],
  }

  it("broadcasts a friendly activity summary for a successful sale, including the sender's deviceId", async () => {
    mockNewSale()

    const res = await request("POST", "/api/sync/push", {
      token,
      body: {
        deviceId: "register-2",
        operations: [{ id: "op-activity-1", entity: "sale", action: "create", payload: salePayload }],
      },
    })

    expect(res.status).toBe(200)
    expect(res.body.results[0].status).toBe("ok")

    const activityCall = vi.mocked(broadcastToTenant).mock.calls.find(c => c[1] === "sync:activity")
    expect(activityCall).toBeTruthy()
    expect(activityCall![0]).toBe("t1")
    expect(activityCall![2].deviceId).toBe("register-2")
    expect(activityCall![2].activities).toEqual([
      { entity: "sale", action: "create", summary: "Ahmad sold 2x Coca-Cola" },
    ])

    // The existing raw data-changed signal must still fire too
    const dataChangedCall = vi.mocked(broadcastToTenant).mock.calls.find(c => c[1] === "sync:data-changed")
    expect(dataChangedCall).toBeTruthy()
  })

  it("does not broadcast an activity for uninteresting entities (e.g. settings)", async () => {
    vi.mocked(prisma.appSettings.upsert).mockResolvedValue({} as any)

    const res = await request("POST", "/api/sync/push", {
      token,
      body: {
        operations: [{ id: "op-activity-2", entity: "settings", action: "update", payload: { storeName: "New Name" } }],
      },
    })

    expect(res.status).toBe(200)
    expect(res.body.results[0].status).toBe("ok")

    const activityCall = vi.mocked(broadcastToTenant).mock.calls.find(c => c[1] === "sync:activity")
    expect(activityCall).toBeUndefined()

    // data-changed still fires — only the friendly activity feed is selective
    const dataChangedCall = vi.mocked(broadcastToTenant).mock.calls.find(c => c[1] === "sync:data-changed")
    expect(dataChangedCall).toBeTruthy()
  })
})

describe("POST /api/sync/push — product sync identity (POS-SYNC-IDENTITY-1)", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("create with syncId persists syncId and never forwards the client's numeric id", async () => {
    vi.mocked(prisma.product.findFirst).mockResolvedValue(null) // no syncId match, no barcode match
    vi.mocked(prisma.product.create).mockResolvedValue({} as any)

    const res = await request("POST", "/api/sync/push", {
      token,
      body: { operations: [{ id: "op-si-1", entity: "product", action: "create", payload: {
        id: 5, syncId: "sync-new-1", name: "SyncCola", barcode: "SIBC1", price: 1, cost: 1, stock: 3, category: "Test",
      } }] },
    })

    expect(res.status).toBe(200)
    expect(res.body.results[0].status).toBe("ok")
    const call = vi.mocked(prisma.product.create).mock.calls[0][0]
    expect(call.data.syncId).toBe("sync-new-1")
    expect(call.data.id).toBeUndefined()
  })

  it("create with an existing barcode adopts the existing row — no duplicate product", async () => {
    vi.mocked(prisma.product.findFirst)
      .mockResolvedValueOnce(null)                              // syncId lookup → none
      .mockResolvedValueOnce({ id: 42, syncId: null } as any)  // barcode lookup → found
    vi.mocked(prisma.product.update).mockResolvedValue({} as any)

    const res = await request("POST", "/api/sync/push", {
      token,
      body: { operations: [{ id: "op-si-2", entity: "product", action: "create", payload: {
        id: 9, syncId: "sync-incoming-2", name: "DupCola", barcode: "SIBC-DUP", price: 1, cost: 1, stock: 0, category: "Test",
      } }] },
    })

    expect(res.status).toBe(200)
    expect(res.body.results[0].status).toBe("ok")
    // Adopted the existing barcode-matched row; did NOT create a duplicate
    expect(vi.mocked(prisma.product.create)).not.toHaveBeenCalled()
    const upd = vi.mocked(prisma.product.update).mock.calls[0][0]
    expect(upd.where).toEqual({ id: 42 })
    expect(upd.data.syncId).toBe("sync-incoming-2") // existing row had null → adopts incoming
  })

  it("update matches by syncId (not numeric id) when syncId is present", async () => {
    vi.mocked(prisma.product.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await request("POST", "/api/sync/push", {
      token,
      body: { operations: [{ id: "op-si-3", entity: "product", action: "update", payload: {
        id: 5, syncId: "sync-x", archived: true,
      } }] },
    })

    expect(res.status).toBe(200)
    const call = vi.mocked(prisma.product.updateMany).mock.calls[0][0]
    expect(call.where).toEqual({ tenantId: "t1", syncId: "sync-x" })
    expect(call.data).toMatchObject({ archived: true })
    // matched by syncId (count 1) → no second id-based update
    expect(vi.mocked(prisma.product.updateMany).mock.calls.length).toBe(1)
  })

  it("update falls back to numeric id when syncId matches nothing (legacy/transition)", async () => {
    vi.mocked(prisma.product.updateMany)
      .mockResolvedValueOnce({ count: 0 } as any)   // syncId → no row
      .mockResolvedValueOnce({ count: 1 } as any)   // id fallback → matched

    await request("POST", "/api/sync/push", {
      token,
      body: { operations: [{ id: "op-si-4", entity: "product", action: "update", payload: {
        id: 7, syncId: "sync-missing", archived: true,
      } }] },
    })

    const calls = vi.mocked(prisma.product.updateMany).mock.calls
    expect(calls[0][0].where).toEqual({ tenantId: "t1", syncId: "sync-missing" })
    expect(calls[1][0].where).toEqual({ tenantId: "t1", id: 7 })
  })

  it("delete/archive matches by syncId first", async () => {
    vi.mocked(prisma.product.updateMany).mockResolvedValue({ count: 1 } as any)

    await request("POST", "/api/sync/push", {
      token,
      body: { operations: [{ id: "op-si-5", entity: "product", action: "delete", payload: {
        id: 5, syncId: "sync-del",
      } }] },
    })

    const call = vi.mocked(prisma.product.updateMany).mock.calls[0][0]
    expect(call.where).toEqual({ tenantId: "t1", syncId: "sync-del" })
    expect(call.data).toEqual({ archived: true })
  })

  it("legacy create WITHOUT syncId is still accepted (old clients during transition)", async () => {
    vi.mocked(prisma.product.findFirst).mockResolvedValue(null) // barcode lookup → none
    vi.mocked(prisma.product.create).mockResolvedValue({} as any)

    const res = await request("POST", "/api/sync/push", {
      token,
      body: { operations: [{ id: "op-si-6", entity: "product", action: "create", payload: {
        id: 3, name: "LegacyCola", barcode: "SIBC-LEGACY", price: 1, cost: 1, stock: 0, category: "Test",
      } }] },
    })

    expect(res.status).toBe(200)
    expect(res.body.results[0].status).toBe("ok")
    expect(vi.mocked(prisma.product.create)).toHaveBeenCalled()
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
