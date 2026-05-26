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
      appSettings: { findUnique: vi.fn(), upsert: vi.fn() },
      $connect: vi.fn(),
      $disconnect: vi.fn(),
    },
  }
})

beforeAll(startServer)
afterAll(stopServer)

describe("POST /api/auth/login", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("returns 400 when PIN is missing", async () => {
    const res = await request("POST", "/api/auth/login", { body: {} })
    expect(res.status).toBe(400)
  })

  it("returns 401 when PIN does not match any user", async () => {
    vi.mocked(prisma.staffUser.findFirst).mockResolvedValue(null)
    const res = await request("POST", "/api/auth/login", { body: { pin: "wrong" } })
    expect(res.status).toBe(401)
  })

  it("returns token and user data on successful login", async () => {
    vi.mocked(prisma.staffUser.findFirst).mockResolvedValue({
      id: "u1",
      name: "Cashier One",
      role: "Cashier" as const,
      tenantId: "t1",
      pin: "hash",
      mobile: "700",
      active: true,
      createdAt: new Date().toISOString(),
      tenant: { id: "t1", name: "Downtown Store", subdomain: "downtown" },
    })

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
      createdAt: new Date().toISOString(),
    })

    const token = signToken({ userId: "u1", tenantId: "t1", role: "Admin" })
    const res = await request("GET", "/api/auth/me", { token })
    expect(res.status).toBe(200)
    expect(res.body.id).toBe("u1")
    expect(res.body.name).toBe("Admin User")
  })
})
