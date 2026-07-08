import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest"
import { startServer, stopServer, request } from "./helpers"
import prisma from "../src/lib/prisma"
import { signToken } from "../src/middleware/auth"

vi.mock("../src/lib/prisma", () => {
  const model = () => ({
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  })

  const client = {
    product: model(),
    $connect: vi.fn(),
    $disconnect: vi.fn(),
  }

  return { default: client }
})

const token = signToken({ userId: "u1", tenantId: "t1", role: "Admin" })

beforeAll(startServer)
afterAll(stopServer)

describe("POST /api/images/save", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("returns 401 without auth", async () => {
    const res = await request("POST", "/api/images/save", {
      body: { productId: 1, image: "data:image/png;base64,iVBORw0KGgo=" },
    })
    expect(res.status).toBe(401)
  })

  it("returns 400 when body is missing fields", async () => {
    const res = await request("POST", "/api/images/save", { token, body: {} })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain("required")
  })

  it("returns 404 when product not found", async () => {
    vi.mocked(prisma.product.findFirst).mockResolvedValue(null)
    const res = await request("POST", "/api/images/save", {
      token,
      body: { productId: 999, image: "data:image/png;base64,iVBORw0KGgo=" },
    })
    expect(res.status).toBe(404)
  })

  it("saves image successfully", async () => {
    vi.mocked(prisma.product.findFirst).mockResolvedValue({ id: 1, tenantId: "t1" } as any)
    vi.mocked(prisma.product.update).mockResolvedValue({} as any)

    const res = await request("POST", "/api/images/save", {
      token,
      body: { productId: 1, image: "data:image/png;base64,iVBORw0KGgo=" },
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(vi.mocked(prisma.product.update).mock.calls[0][0]).toMatchObject({
      where: { id: 1 },
      data: { image: "data:image/png;base64,iVBORw0KGgo=" },
    })
  })
})

describe("POST /api/images/save-all", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("saves multiple product images", async () => {
    vi.mocked(prisma.product.findFirst)
      .mockResolvedValueOnce({ id: 1, tenantId: "t1" } as any)
      .mockResolvedValueOnce({ id: 2, tenantId: "t1" } as any)
      .mockResolvedValueOnce(null) // third doesn't exist — skipped
    vi.mocked(prisma.product.update).mockResolvedValue({} as any)

    const res = await request("POST", "/api/images/save-all", {
      token,
      body: {
        products: [
          { productId: 1, image: "data:image/png;base64,a" },
          { productId: 2, image: "data:image/png;base64,b" },
          { productId: 999, image: "data:image/png;base64,c" },
        ],
      },
    })
    expect(res.status).toBe(200)
    expect(res.body.saved).toBe(2)
    expect(res.body.total).toBe(3)
  })
})

describe("POST /api/images/generate", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("generates a placeholder when no HF_TOKEN", async () => {
    const res = await request("POST", "/api/images/generate", {
      token,
      body: { name: "Test Product" },
    })
    expect(res.status).toBe(200)
    expect(res.body.generated).toBe(false)
    expect(res.body.image).toContain("data:image/svg+xml;base64,")
  })

  it("returns 400 when name is missing", async () => {
    const res = await request("POST", "/api/images/generate", {
      token,
      body: {},
    })
    expect(res.status).toBe(400)
  })
})

describe("GET /api/images/serve/:id", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("serves image as binary", async () => {
    vi.mocked(prisma.product.findFirst).mockResolvedValue({
      image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    } as any)

    const res = await request("GET", "/api/images/serve/1", { token })
    expect(res.status).toBe(200)
    expect(typeof res.body).toBe("string")
  })

  it("returns 400 for invalid product ID", async () => {
    const res = await request("GET", "/api/images/serve/abc", { token })
    expect(res.status).toBe(400)
  })

  it("returns 404 when product has no image", async () => {
    vi.mocked(prisma.product.findFirst).mockResolvedValue({ image: null } as any)
    const res = await request("GET", "/api/images/serve/1", { token })
    expect(res.status).toBe(404)
  })
})

describe("GET /api/images/debug", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("returns image debug info", async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([
      { id: 1, name: "Cola", image: "data:image/png;base64,aGVsbG8=" },
    ] as any)

    const res = await request("GET", "/api/images/debug", { token })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body[0].name).toBe("Cola")
    expect(res.body[0].hasImage).toBe(true)
  })
})
