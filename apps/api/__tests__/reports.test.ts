import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest"
import { startServer, stopServer, request } from "./helpers"
import prisma from "../src/lib/prisma"
import { signToken } from "../src/middleware/auth"

vi.mock("../src/lib/prisma", () => {
  const model = (overrides: Record<string, unknown> = {}) => ({
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

  const aggregateModel = () => model({ aggregate: vi.fn() })

  const client = {
    shift: model(),
    sale: aggregateModel(),
    saleRefund: aggregateModel(),
    expense: aggregateModel(),
    supplierPayment: aggregateModel(),
    product: model(),
    staffUser: model(),
    $connect: vi.fn(),
    $disconnect: vi.fn(),
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(client)),
  }

  return { default: client }
})

const token = signToken({ userId: "u1", tenantId: "t1", role: "Admin" })

beforeAll(startServer)
afterAll(stopServer)

describe("POST /api/reports/z-report", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("returns 401 without auth", async () => {
    const res = await request("POST", "/api/reports/z-report")
    expect(res.status).toBe(401)
  })

  it("returns 404 when no open shift", async () => {
    vi.mocked(prisma.shift.findFirst).mockResolvedValue(null)
    const res = await request("POST", "/api/reports/z-report", { token, body: {} })
    expect(res.status).toBe(404)
  })

  it("closes an open shift successfully", async () => {
    vi.mocked(prisma.shift.findFirst).mockResolvedValue({
      id: "s1", tenantId: "t1", status: "Open",
      shiftNumber: "S-001", openedAt: new Date(), openedByName: "John",
      openingFloatUsd: 100,
    } as any)
    vi.mocked(prisma.sale.aggregate).mockResolvedValue({
      _sum: { total: 200, cost: 100, profit: 100 }, _count: 5,
    } as any)
    vi.mocked(prisma.saleRefund.aggregate).mockResolvedValue({ _sum: { total: 20 } } as any)
    vi.mocked(prisma.expense.aggregate).mockResolvedValue({ _sum: { amount: 10 } } as any)
    vi.mocked(prisma.supplierPayment.aggregate).mockResolvedValue({ _sum: { amount: 0 } } as any)
    vi.mocked(prisma.shift.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await request("POST", "/api/reports/z-report", {
      token,
      body: { closingCash: 280, closedByName: "John" },
    })
    expect(res.status).toBe(200)
    expect(res.body.type).toBe("Z")
    expect(res.body.shift.number).toBe("S-001")
  })

  it("returns 409 when shift is already closed (fix #4)", async () => {
    // Find the shift (already closed)
    vi.mocked(prisma.shift.findFirst).mockResolvedValue({
      id: "s1", tenantId: "t1", status: "Closed",
      shiftNumber: "S-001", openedAt: new Date(), openedByName: "John",
      openingFloatUsd: 100,
    } as any)
    // Mock aggregates so code doesn't crash before the update
    vi.mocked(prisma.sale.aggregate).mockResolvedValue({
      _sum: { total: 0, cost: 0, profit: 0 }, _count: 0,
    } as any)
    vi.mocked(prisma.saleRefund.aggregate).mockResolvedValue({ _sum: { total: 0 } } as any)
    vi.mocked(prisma.expense.aggregate).mockResolvedValue({ _sum: { amount: 0 } } as any)
    vi.mocked(prisma.supplierPayment.aggregate).mockResolvedValue({ _sum: { amount: 0 } } as any)
    // updateMany with status: "Open" guard returns count 0 → 409
    vi.mocked(prisma.shift.updateMany).mockResolvedValue({ count: 0 } as any)

    const res = await request("POST", "/api/reports/z-report", {
      token,
      body: { closingCash: 0 },
    })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe("Shift already closed")
  })

  it("only one of two concurrent close requests succeeds", async () => {
    vi.mocked(prisma.shift.findFirst).mockResolvedValue({
      id: "s1", tenantId: "t1", status: "Open",
      shiftNumber: "S-001", openedAt: new Date(), openedByName: "John",
      openingFloatUsd: 100,
    } as any)
    vi.mocked(prisma.sale.aggregate).mockResolvedValue({
      _sum: { total: 200, cost: 100, profit: 100 }, _count: 5,
    } as any)
    vi.mocked(prisma.saleRefund.aggregate).mockResolvedValue({ _sum: { total: 20 } } as any)
    vi.mocked(prisma.expense.aggregate).mockResolvedValue({ _sum: { amount: 10 } } as any)
    vi.mocked(prisma.supplierPayment.aggregate).mockResolvedValue({ _sum: { amount: 0 } } as any)

    let updateCalls = 0
    vi.mocked(prisma.shift.updateMany).mockImplementation(() => {
      updateCalls++
      return updateCalls <= 1
        ? Promise.resolve({ count: 1 } as any)
        : Promise.resolve({ count: 0 } as any)
    })

    const [res1, res2] = await Promise.all([
      request("POST", "/api/reports/z-report", { token, body: { closingCash: 280 } }),
      request("POST", "/api/reports/z-report", { token, body: { closingCash: 280 } }),
    ])

    expect(res1.status).toBe(200)
    expect(res2.status).toBe(409)
  })
})
