import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest"
import { EventEmitter } from "node:events"
import { startServer, stopServer, request } from "./helpers"
import prisma from "../src/lib/prisma"
import { signToken } from "../src/middleware/auth"

// Image generation, translation, and catalog lookup all go through node:https —
// mock it so tests never make real calls to Pollinations/MyMemory/Open Food Facts,
// and can force each one's success/failure independently.
const netState = vi.hoisted(() => ({
  imageMode: "success" as "success" | "network-error" | "http-error",
  translation: "Halloumi cheese",
  catalogMode: "miss" as "hit" | "miss",
  lastImagePath: "",
  lastCatalogPath: "",
}))

vi.mock("node:https", () => ({
  default: {
    request: (options: any, callback: (res: any) => void) => {
      const req = new EventEmitter() as any
      req.write = () => {}
      req.end = () => {
        queueMicrotask(() => {
          if (options.hostname === "api.mymemory.translated.net") {
            const res = new EventEmitter() as any
            res.statusCode = 200
            callback(res)
            queueMicrotask(() => {
              res.emit("data", Buffer.from(JSON.stringify({ responseData: { translatedText: netState.translation } })))
              res.emit("end")
            })
            return
          }
          if (options.hostname === "world.openfoodfacts.org") {
            netState.lastCatalogPath = options.path
            const res = new EventEmitter() as any
            res.statusCode = 200
            callback(res)
            queueMicrotask(() => {
              const body = netState.catalogMode === "hit"
                ? { status: 1, product: { image_front_url: "https://images.openfoodfacts.org/fake.jpg" } }
                : { status: 0 }
              res.emit("data", Buffer.from(JSON.stringify(body)))
              res.emit("end")
            })
            return
          }
          if (options.hostname === "images.openfoodfacts.org") {
            const res = new EventEmitter() as any
            res.statusCode = 200
            callback(res)
            queueMicrotask(() => {
              res.emit("data", Buffer.from("fake-catalog-image-bytes"))
              res.emit("end")
            })
            return
          }
          netState.lastImagePath = options.path
          if (netState.imageMode === "network-error") {
            req.emit("error", new Error("network down"))
            return
          }
          const res = new EventEmitter() as any
          res.statusCode = netState.imageMode === "http-error" ? 500 : 200
          callback(res)
          queueMicrotask(() => {
            res.emit("data", Buffer.from("fake-image-bytes"))
            res.emit("end")
          })
        })
      }
      return req
    },
  },
}))

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
  beforeEach(() => {
    netState.imageMode = "success"
    netState.translation = "Halloumi cheese"
    netState.catalogMode = "miss"
    netState.lastImagePath = ""
    netState.lastCatalogPath = ""
  })

  it("generates an AI image for a Latin-script name", async () => {
    const res = await request("POST", "/api/images/generate", {
      token,
      body: { name: "Test Product" },
    })
    expect(res.status).toBe(200)
    expect(res.body.generated).toBe(true)
    expect(res.body.source).toBe("ai")
    expect(res.body.image).toContain("data:image/jpeg;base64,")
    expect(netState.lastImagePath).toContain("Test%20Product")
  })

  it("uses the real catalog photo when the barcode matches, skipping AI generation", async () => {
    netState.catalogMode = "hit"
    const res = await request("POST", "/api/images/generate", {
      token,
      body: { name: "Nutella 400g", barcode: "3017620422003" },
    })
    expect(res.status).toBe(200)
    expect(res.body.generated).toBe(true)
    expect(res.body.source).toBe("catalog")
    expect(netState.lastCatalogPath).toContain("3017620422003")
    expect(netState.lastImagePath).toBe("") // AI generation never called
  })

  it("falls through to AI generation when the barcode has no catalog match", async () => {
    netState.catalogMode = "miss"
    const res = await request("POST", "/api/images/generate", {
      token,
      body: { name: "Local Bakery Item", barcode: "9999999999999" },
    })
    expect(res.status).toBe(200)
    expect(res.body.source).toBe("ai")
  })

  it("skips the catalog lookup for a non-barcode-shaped value", async () => {
    const res = await request("POST", "/api/images/generate", {
      token,
      body: { name: "Test Product", barcode: "SKU-ABC-123" },
    })
    expect(res.status).toBe(200)
    expect(res.body.source).toBe("ai")
    expect(netState.lastCatalogPath).toBe("") // never even attempted
  })

  it("includes category in the prompt when provided", async () => {
    const res = await request("POST", "/api/images/generate", {
      token,
      body: { name: "Cola", category: "Beverages" },
    })
    expect(res.status).toBe(200)
    expect(netState.lastImagePath).toContain("Beverages")
  })

  it("translates a non-Latin name before generating", async () => {
    const res = await request("POST", "/api/images/generate", {
      token,
      body: { name: "جبنة حلوم" },
    })
    expect(res.status).toBe(200)
    expect(res.body.generated).toBe(true)
    expect(netState.lastImagePath).toContain(encodeURIComponent("Halloumi cheese"))
  })

  it("falls back to a placeholder when generation fails", async () => {
    netState.imageMode = "http-error"
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
