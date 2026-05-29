import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest"
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
    deleteMany: vi.fn(),
    count: vi.fn(),
    ...overrides,
  })

  return {
    default: {
      deliveryOrder: model(),
      deliveryOrderItem: model(),
      staffUser: model(),
      appSettings: { findUnique: vi.fn(), upsert: vi.fn() },
      tenant: { findUnique: vi.fn(), count: vi.fn().mockResolvedValue(1) },
      customer: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
      $connect: vi.fn(),
      $disconnect: vi.fn(),
    },
  }
})

const adminToken = signToken({ userId: "u1", tenantId: "t1", role: "Admin" })
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
    vi.mocked(prisma.deliveryOrder.count).mockResolvedValue(0)
    vi.mocked(prisma.deliveryOrder.create).mockResolvedValue({
      id: "do1",
      orderNumber: "DEL-000001",
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
    expect(res.body.order.orderNumber).toBe("DEL-000001")
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
    vi.mocked(prisma.deliveryOrder.findFirst).mockResolvedValue({ id: "do1" })
    vi.mocked(prisma.deliveryOrder.update).mockResolvedValue({ id: "do1", status: "Confirmed" } as any)

    const res = await request("PATCH", "/api/delivery/orders/do1", {
      token: adminToken,
      body: { status: "Confirmed" },
    })
    expect(res.status).toBe(200)
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
})

describe("PATCH /api/delivery/driver/orders/:id/status", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("returns 401 without auth", async () => {
    const res = await request("PATCH", "/api/delivery/driver/orders/do1/status", {
      body: { status: "OutForDelivery" },
    })
    expect(res.status).toBe(401)
  })

  it("prevents NaN changeRequired when paidAmount set without total selected", async () => {
    vi.mocked(prisma.deliveryOrder.findUnique).mockResolvedValue({
      id: "do1",
      tenantId: "t1",
      total: 15,
      deliveryFee: 2,
      paidAmount: 20,
      changeRequired: 0,
      status: "OutForDelivery",
      driverId: "d1",
    })
    vi.mocked(prisma.deliveryOrder.update).mockImplementation(async (args) => {
      const data = args.data as Record<string, unknown>
      const change = data.changeRequired as number
      expect(Number.isNaN(change)).toBe(false)
      return { id: "do1", ...data }
    })

    const res = await request("PATCH", "/api/delivery/driver/orders/do1/status", {
      token: driverToken,
      body: { status: "Delivered", paidAmount: 20 },
    })
    expect(res.status).toBe(200)
  })
})
