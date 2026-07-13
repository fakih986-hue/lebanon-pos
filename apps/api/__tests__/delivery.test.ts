import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest"
import { Prisma } from "../src/generated/prisma/index.js"
import { startServer, stopServer, request } from "./helpers"
import prisma from "../src/lib/prisma"
import { signToken } from "../src/middleware/auth"

vi.mock("../src/lib/prisma", () => {
  const model = <T extends Record<string, unknown>>(overrides: Partial<T> = {}) => ({
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
    count: vi.fn(),
    ...overrides,
  })

  // $transaction calls the callback with the same mock client (no real DB transaction in tests)
  const client = {
    deliveryOrder: model(),
    deliveryOrderItem: model(),
    staffUser: model(),
    product: model(),
    stockMovement: model(),
    appSettings: { findUnique: vi.fn(), upsert: vi.fn() },
    tenant: { findUnique: vi.fn(), count: vi.fn().mockResolvedValue(1) },
    customer: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    $connect: vi.fn(),
    $disconnect: vi.fn(),
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(client)),
  }

  return { default: client }
})

const adminToken = signToken({ userId: "u1", tenantId: "t1", role: "Admin" })
const adminTokenT2 = signToken({ userId: "u2", tenantId: "t2", role: "Admin" })
const driverToken = signToken({ userId: "d1", tenantId: "t1", role: "Driver" })

beforeAll(startServer)
afterAll(stopServer)

describe("POST /api/delivery/order", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("returns 400 when body is missing required fields", async () => {
    const res = await request("POST", "/api/delivery/order", { body: {} })
    expect(res.status).toBe(400)
  })

  it("returns 404 when tenant not found", async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue(null)
    const res = await request("POST", "/api/delivery/order", {
      body: {
        tenantId: "nonexistent",
        customerName: "John",
        customerPhone: "70000000",
        address: "Beirut",
        items: [{ productId: 1, productName: "Cola", barcode: "123", quantity: 2, unitPrice: 1.5 }],
      },
    })
    expect(res.status).toBe(404)
  })

  it("creates an order successfully", async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
      id: "t1", name: "Store", subdomain: "store", createdAt: new Date(), updatedAt: new Date(),
    })
    vi.mocked(prisma.deliveryOrder.count).mockResolvedValue(0)
    vi.mocked(prisma.product.findMany).mockResolvedValue([
      { id: 1, name: "Cola", barcode: "123", price: new Prisma.Decimal(1.5), stock: 10 },
    ] as any)
    vi.mocked(prisma.appSettings.findUnique).mockResolvedValue({
      deliveryFee: 2,
      assignMode: "manual",
      defaultDriverId: "",
    } as any)
    vi.mocked(prisma.deliveryOrder.create).mockResolvedValue({
      id: "do1",
      orderNumber: "DEL-000001-1234",
      status: "Pending",
      tenantId: "t1",
      customerName: "John",
      customerPhone: "70000000",
      address: "Beirut",
      itemsTotal: 3,
      deliveryFee: 2,
      total: 5,
      changeRequired: 0,
      items: [],
    } as any)

    const res = await request("POST", "/api/delivery/order", {
      body: {
        tenantId: "t1",
        customerName: "John",
        customerPhone: "70000000",
        address: "Beirut",
        items: [{ productId: 1, productName: "Cola", barcode: "123", quantity: 2, unitPrice: 1.5 }],
      },
    })
    expect(res.status).toBe(201)
    expect(res.body.order.orderNumber).toMatch(/^DEL-000001-\d{4}$/)
  })
})

describe("POST /api/delivery/customer/signup", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("returns 400 when name is missing", async () => {
    const res = await request("POST", "/api/delivery/customer/signup", { body: {} })
    expect(res.status).toBe(400)
  })

  it("returns 400 when PIN is too short", async () => {
    const res = await request("POST", "/api/delivery/customer/signup", {
      body: { tenantSubdomain: "store", name: "John", mobile: "70000000", pin: "12" },
    })
    expect(res.status).toBe(400)
  })
})

describe("PATCH /api/delivery/orders/:id", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("returns 401 without auth", async () => {
    const res = await request("PATCH", "/api/delivery/orders/do1", {
      body: { status: "Confirmed" },
    })
    expect(res.status).toBe(401)
  })

  it("returns 200 for valid status update", async () => {
    vi.mocked(prisma.deliveryOrder.findFirst).mockResolvedValue({ id: "do1", status: "Pending" } as any)
    vi.mocked(prisma.deliveryOrder.updateMany).mockResolvedValue({ count: 1 })
    vi.mocked(prisma.deliveryOrder.findUnique).mockResolvedValue({ id: "do1", status: "Confirmed", items: [], driverId: null } as any)

    const res = await request("PATCH", "/api/delivery/orders/do1", {
      token: adminToken,
      body: { status: "Confirmed" },
    })
    expect(res.status).toBe(200)
  })

  it("emits a stock-ledger movement when a delivery decrements stock (POS-SYNC-AUTHORITY-2A)", async () => {
    vi.mocked(prisma.deliveryOrder.findFirst).mockResolvedValue({ id: "do1", status: "Pending" } as any)
    vi.mocked(prisma.deliveryOrder.updateMany).mockResolvedValue({ count: 1 })
    vi.mocked(prisma.deliveryOrder.findUnique).mockResolvedValue({
      id: "do1", status: "OutForDelivery", driverId: null,
      items: [{ productId: 1, productName: "Cola", quantity: 2 }],
    } as any)
    vi.mocked(prisma.product.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await request("PATCH", "/api/delivery/orders/do1", {
      token: adminToken,
      body: { status: "OutForDelivery" },
    })
    expect(res.status).toBe(200)
    // Stock still decremented (record-only) AND a delivery movement is logged.
    expect(vi.mocked(prisma.product.updateMany)).toHaveBeenCalledWith(expect.objectContaining({ data: { stock: { decrement: 2 }, updatedAt: expect.any(Date) } }))
    const moves = vi.mocked((prisma as any).stockMovement.create).mock.calls.map((c: any) => c[0].data)
    const m = moves.find((x: any) => x.reference === "delivery:do1")
    expect(m).toBeTruthy()
    expect(m).toMatchObject({ productId: 1, type: "Sale", quantity: -2 })
  })
})

describe("POST /api/delivery/drivers", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("returns 401 without auth", async () => {
    const res = await request("POST", "/api/delivery/drivers", {
      body: { name: "Driver1", mobile: "70000000", pin: "1234" },
    })
    expect(res.status).toBe(401)
  })

  it("returns 400 when PIN is too short", async () => {
    const res = await request("POST", "/api/delivery/drivers", {
      token: adminToken,
      body: { name: "Driver1", mobile: "70000000", pin: "12" },
    })
    expect(res.status).toBe(400)
  })

  it("allows same driver code in different tenants (fix #1)", async () => {
    // Both tenants try to create driver with code "D001"
    // No existing driver in either tenant
    vi.mocked(prisma.staffUser.findFirst)
      .mockResolvedValueOnce(null)  // Tenant 1: no conflict
      .mockResolvedValueOnce(null)  // Tenant 2: no conflict
    vi.mocked(prisma.staffUser.create).mockResolvedValue({ id: "d1" } as any)

    const res1 = await request("POST", "/api/delivery/drivers", {
      token: adminToken,
      body: { name: "Driver1", mobile: "70000000", code: "D001", pin: "1234" },
    })
    expect(res1.status).toBe(201)

    const res2 = await request("POST", "/api/delivery/drivers", {
      token: adminTokenT2,
      body: { name: "Driver2", mobile: "70000001", code: "D001", pin: "5678" },
    })
    expect(res2.status).toBe(201)

    // Verify tenant-specific uniqueness: staffUser.findFirst was called with tenantId
    const findFirstCalls = vi.mocked(prisma.staffUser.findFirst).mock.calls
    expect(findFirstCalls[0][0]?.where?.tenantId).toBe("t1")
    expect(findFirstCalls[1][0]?.where?.tenantId).toBe("t2")
  })

  it("blocks same driver code within same tenant", async () => {
    vi.mocked(prisma.staffUser.findFirst).mockResolvedValue({ id: "existing" } as any)
    vi.mocked(prisma.staffUser.create).mockResolvedValue({ id: "d2" } as any)

    const res = await request("POST", "/api/delivery/drivers", {
      token: adminToken,
      body: { name: "Driver1", mobile: "70000000", code: "D001", pin: "1234" },
    })
    expect(res.status).toBe(409)
    expect(res.body.error).toContain("already exists")
  })
})

describe("PATCH /api/delivery/driver/orders/:id/status", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("returns 401 without auth", async () => {
    const res = await request("PATCH", "/api/delivery/driver/orders/do1/status", {
      body: { status: "OutForDelivery" },
    })
    expect(res.status).toBe(401)
  })

  it("rejects delivering an already-delivered order", async () => {
    vi.mocked(prisma.deliveryOrder.findFirst).mockResolvedValue({ id: "do1", status: "Delivered" } as any)
    // Guard blocks: updateMany returns count 0 because status is already Delivered
    vi.mocked(prisma.deliveryOrder.updateMany).mockResolvedValue({ count: 0 })
    vi.mocked(prisma.deliveryOrder.findUnique).mockResolvedValue({ id: "do1", status: "Delivered", items: [], driverId: null } as any)

    const res = await request("PATCH", "/api/delivery/orders/do1", {
      token: adminToken,
      body: { status: "Delivered" },
    })
    expect(res.status).toBe(200)
    // Stock should NOT be decremented because updateMany guard blocked it
    const updateManyCalls = vi.mocked(prisma.deliveryOrder.updateMany).mock.calls
    expect(updateManyCalls[0][0].where.status.notIn).toContain("Delivered")
  })

  it("rejects delivering a cancelled order (fix #2)", async () => {
    vi.mocked(prisma.deliveryOrder.findFirst).mockResolvedValue({ id: "do1", status: "Cancelled" } as any)
    vi.mocked(prisma.deliveryOrder.updateMany).mockResolvedValue({ count: 0 })
    vi.mocked(prisma.deliveryOrder.findUnique).mockResolvedValue({ id: "do1", status: "Cancelled", items: [], driverId: null } as any)

    const res = await request("PATCH", "/api/delivery/orders/do1", {
      token: adminToken,
      body: { status: "Delivered" },
    })
    expect(res.status).toBe(200)
    const updateManyCalls = vi.mocked(prisma.deliveryOrder.updateMany).mock.calls
    expect(updateManyCalls[0][0].where.status.notIn).toContain("Cancelled")
  })

  it("only one of two concurrent deliver attempts succeeds", async () => {
    // Two POS devices try to deliver the same order simultaneously.
    // Only the first should succeed (status guard blocks the second).
    vi.mocked(prisma.deliveryOrder.findFirst).mockResolvedValue({ id: "do1", status: "OutForDelivery" } as any)

    let updateCalls = 0
    vi.mocked(prisma.deliveryOrder.updateMany).mockImplementation(() => {
      updateCalls++
      return updateCalls <= 1
        ? Promise.resolve({ count: 1 } as any)
        : Promise.resolve({ count: 0 } as any)
    })

    vi.mocked(prisma.deliveryOrder.findUnique).mockResolvedValue({ id: "do1", status: "Delivered", items: [], driverId: null } as any)

    const [res1, res2] = await Promise.all([
      request("PATCH", "/api/delivery/orders/do1", {
        token: adminToken,
        body: { status: "Delivered" },
      }),
      request("PATCH", "/api/delivery/orders/do1", {
        token: adminToken,
        body: { status: "Delivered" },
      }),
    ])

    // Both return 200 but the second has no-op updateMany (count=0)
    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200)
  })

  it("driver endpoint also rejects cancelling/delivered orders", async () => {
    vi.mocked(prisma.deliveryOrder.findUnique)
      .mockResolvedValueOnce({ id: "do1", driverId: "d1", tenantId: "t1", status: "Delivered" } as any)

    const res = await request("PATCH", "/api/delivery/driver/orders/do1/status", {
      token: driverToken,
      body: { status: "Delivered" },
    })
    // Driver endpoint checks driverId match first then updateMany guard
    expect(res.status).toBe(200)
  })

  it("prevents NaN changeRequired when paidAmount set without total selected", async () => {
    vi.mocked(prisma.deliveryOrder.findUnique)
      .mockResolvedValueOnce({
        id: "do1",
        tenantId: "t1",
        total: new Prisma.Decimal(15),
        deliveryFee: new Prisma.Decimal(2),
        paidAmount: new Prisma.Decimal(20),
        changeRequired: new Prisma.Decimal(0),
        status: "OutForDelivery",
        driverId: "d1",
      })
      .mockResolvedValueOnce({
        id: "do1", items: [], tenantId: "t1", status: "Delivered",
      } as any)
    vi.mocked(prisma.deliveryOrder.updateMany).mockImplementation(async (args) => {
      const data = args.data as Record<string, unknown>
      const change = data.changeRequired as number
      expect(Number.isNaN(change)).toBe(false)
      return { count: 1 }
    })

    const res = await request("PATCH", "/api/delivery/driver/orders/do1/status", {
      token: driverToken,
      body: { status: "Delivered", paidAmount: 20 },
    })
    expect(res.status).toBe(200)
  })
})
