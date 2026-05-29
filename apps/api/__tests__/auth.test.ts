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
    count: vi.fn(),
  })

  return {
    default: {
      tenant: model(),
      staffUser: model(),
      appSettings: { findUnique: vi.fn(), upsert: vi.fn() },
      $connect: vi.fn(),
      $disconnect: vi.fn(),
    },
  }
})

beforeAll(startServer)
afterAll(stopServer)

describe("POST /api/auth/tenant/setup (Zod validation)", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("returns 400 when storeName is empty", async () => {
    const res = await request("POST", "/api/auth/tenant/setup", {
      body: { storeName: "", subdomain: "test", adminName: "Admin", adminMobile: "70000000", adminPin: "1234" },
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toBeDefined()
  })

  it("returns 400 when subdomain has invalid characters", async () => {
    const res = await request("POST", "/api/auth/tenant/setup", {
      body: { storeName: "Store", subdomain: "INVALID UPPERCASE", adminName: "Admin", adminMobile: "70000000", adminPin: "1234" },
    })
    expect(res.status).toBe(400)
  })

  it("returns 400 when adminPin is too short", async () => {
    const res = await request("POST", "/api/auth/tenant/setup", {
      body: { storeName: "Store", subdomain: "store", adminName: "Admin", adminMobile: "70000000", adminPin: "12" },
    })
    expect(res.status).toBe(400)
  })

  it("returns 409 when subdomain already exists", async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
      id: "existing", name: "Other", subdomain: "store", createdAt: new Date(), updatedAt: new Date(),
    })
    const res = await request("POST", "/api/auth/tenant/setup", {
      body: { storeName: "Store", subdomain: "store", adminName: "Admin", adminMobile: "70000000", adminPin: "1234" },
    })
    expect(res.status).toBe(409)
  })
})

describe("POST /api/auth/login", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("returns 400 when PIN is missing", async () => {
    const res = await request("POST", "/api/auth/login", { body: {} })
    expect(res.status).toBe(400)
  })

  it("returns 400 when PIN is empty string", async () => {
    const res = await request("POST", "/api/auth/login", { body: { pin: "" } })
    expect(res.status).toBe(400)
  })

  it("returns 400 when subdomain is required but not provided (multi-tenant)", async () => {
    vi.mocked(prisma.tenant.count).mockResolvedValue(2)
    const res = await request("POST", "/api/auth/login", { body: { pin: "1234" } })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain("subdomain")
  })

  it("returns 401 when PIN does not match any user", async () => {
    vi.mocked(prisma.tenant.count).mockResolvedValue(1)
    vi.mocked(prisma.staffUser.findMany).mockResolvedValue([])
    const res = await request("POST", "/api/auth/login", { body: { pin: "wrong" } })
    expect(res.status).toBe(401)
  })

  it("returns 401 when driver code is missing for driver login", async () => {
    const res = await request("POST", "/api/auth/login", { body: { pin: "1234", role: "Driver" } })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain("code")
  })

  it("returns 401 when driver code does not match", async () => {
    vi.mocked(prisma.staffUser.findFirst).mockResolvedValue(null)
    const res = await request("POST", "/api/auth/login", { body: { pin: "1234", role: "Driver", code: "X999" } })
    expect(res.status).toBe(401)
  })

  it("returns token and user data on successful staff login", async () => {
    vi.mocked(prisma.tenant.count).mockResolvedValue(1)
    vi.mocked(prisma.staffUser.findMany).mockResolvedValue([{
      id: "u1",
      name: "Cashier One",
      role: "Cashier",
      tenantId: "t1",
      pin: "1234",
      mobile: "700",
      active: true,
      createdAt: new Date(),
      tenant: { id: "t1", name: "Downtown Store", subdomain: "downtown" },
    }])

    const res = await request("POST", "/api/auth/login", { body: { pin: "1234" } })
    expect(res.status).toBe(200)
    expect(res.body.token).toBeDefined()
    expect(typeof res.body.token).toBe("string")
    expect(res.body.user.tenantName).toBe("Downtown Store")
  })
})

describe("GET /api/auth/me", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("returns 401 when no Authorization header", async () => {
    const res = await request("GET", "/api/auth/me")
    expect(res.status).toBe(401)
  })

  it("returns 401 for an invalid token", async () => {
    const res = await request("GET", "/api/auth/me", { token: "bad-jwt" })
    expect(res.status).toBe(401)
  })

  it("returns the user profile for a valid token", async () => {
    vi.mocked(prisma.staffUser.findUnique).mockResolvedValue({
      id: "u1",
      name: "Admin User",
      mobile: "70000000",
      role: "Admin" as const,
      active: true,
      tenantId: "t1",
      pin: "hash",
      createdAt: new Date(),
    })

    const token = signToken({ userId: "u1", tenantId: "t1", role: "Admin" })
    const res = await request("GET", "/api/auth/me", { token })
    expect(res.status).toBe(200)
    expect(res.body.id).toBe("u1")
    expect(res.body.name).toBe("Admin User")
  })
})
