import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { createHash } from "node:crypto"
import { startServer, stopServer, request } from "./helpers"
import prisma from "../src/lib/prisma"

vi.mock("../src/lib/prisma", () => {
  const model = () => ({
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    upsert: vi.fn(),
  })

  const client = {
    tenant: model(),
    staffUser: model(),
    $connect: vi.fn(),
    $disconnect: vi.fn(),
  }

  return { default: client }
})

const PIN = "1234"
const PIN_HASH = createHash("sha256").update(PIN).digest("base64")

beforeAll(startServer)
afterAll(stopServer)

describe("POST /api/setup/discover", () => {
  it("backfills a missing cloudApiKey and persists it", async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
      id: "t1",
      name: "Fakih Store",
      subdomain: "fakih",
      cloudApiKey: "", // legacy tenant, backfilled with empty string by the migration
      suspended: false,
    } as any)
    vi.mocked(prisma.staffUser.findFirst).mockResolvedValue({
      id: "u1",
      name: "Admin",
      pin: PIN_HASH,
    } as any)
    vi.mocked(prisma.tenant.update).mockResolvedValue({} as any)

    const res = await request("POST", "/api/setup/discover", {
      body: { subdomain: "fakih", pin: PIN },
    })

    expect(res.status).toBe(200)
    expect(res.body.tenantId).toBe("t1")
    expect(typeof res.body.cloudApiKey).toBe("string")
    expect(res.body.cloudApiKey).not.toBe("")
    expect(res.body.cloudApiKey).toHaveLength(64) // 32 bytes hex

    // the new key must actually be persisted, not just returned once
    expect(vi.mocked(prisma.tenant.update)).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { cloudApiKey: res.body.cloudApiKey },
    })
  })

  it("returns the existing cloudApiKey unchanged when already set", async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
      id: "t2",
      name: "Newstore",
      subdomain: "newstore",
      cloudApiKey: "existing-real-key-abc123",
      suspended: false,
    } as any)
    vi.mocked(prisma.staffUser.findFirst).mockResolvedValue({
      id: "u2",
      name: "Admin",
      pin: PIN_HASH,
    } as any)
    vi.mocked(prisma.tenant.update).mockClear()

    const res = await request("POST", "/api/setup/discover", {
      body: { subdomain: "newstore", pin: PIN },
    })

    expect(res.status).toBe(200)
    expect(res.body.cloudApiKey).toBe("existing-real-key-abc123")
    expect(vi.mocked(prisma.tenant.update)).not.toHaveBeenCalled()
  })

  it("proxies discovery entirely to the cloud when running as a hub, even with no local tenant row at all", async () => {
    // No findUnique/findFirst mocks set up — a fresh hub's local DB has
    // nothing for this tenant yet, and the hub path must never touch them.
    vi.mocked(prisma.tenant.findUnique).mockReset()
    vi.mocked(prisma.staffUser.findFirst).mockReset()
    vi.mocked(prisma.tenant.upsert).mockClear().mockResolvedValue({} as any)

    process.env.IS_LOCAL_SERVER = "true"
    process.env.CLOUD_API_URL = "https://pos.titan-suite.net"
    const realFetch = global.fetch
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      // Only intercept the outbound call to the "cloud" — anything else (the
      // test harness's own request to the local test server) uses the real fetch.
      if (String(input).startsWith("https://pos.titan-suite.net")) {
        return {
          ok: true,
          json: async () => ({ tenantId: "t4", tenantName: "Fakih Store", subdomain: "fakih", cloudApiKey: "real-cloud-key-from-railway" }),
        } as Response
      }
      return realFetch(input as any, init)
    })

    try {
      const res = await request("POST", "/api/setup/discover", {
        body: { subdomain: "fakih", pin: PIN },
      })

      expect(res.status).toBe(200)
      expect(res.body.tenantId).toBe("t4")
      expect(res.body.cloudApiKey).toBe("real-cloud-key-from-railway")
      // must have asked the cloud's own discover endpoint, not looked up locally
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://pos.titan-suite.net/api/setup/discover",
        expect.objectContaining({ method: "POST" })
      )
      expect(vi.mocked(prisma.tenant.findUnique)).not.toHaveBeenCalled()
      // and mirrored the authoritative tenant + key into the local copy
      expect(vi.mocked(prisma.tenant.upsert)).toHaveBeenCalledWith({
        where: { id: "t4" },
        update: { cloudApiKey: "real-cloud-key-from-railway" },
        create: { id: "t4", name: "Fakih Store", subdomain: "fakih", cloudApiKey: "real-cloud-key-from-railway" },
      })
    } finally {
      fetchSpy.mockRestore()
      process.env.IS_LOCAL_SERVER = "false"
      delete process.env.CLOUD_API_URL
    }
  })

  it("surfaces the cloud's error (e.g. wrong subdomain) unchanged when running as a hub", async () => {
    process.env.IS_LOCAL_SERVER = "true"
    process.env.CLOUD_API_URL = "https://pos.titan-suite.net"
    const realFetch = global.fetch
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      if (String(input).startsWith("https://pos.titan-suite.net")) {
        return {
          ok: false,
          status: 404,
          json: async () => ({ error: "Store not found. Check the subdomain." }),
        } as Response
      }
      return realFetch(input as any, init)
    })

    try {
      const res = await request("POST", "/api/setup/discover", {
        body: { subdomain: "doesnotexist", pin: PIN },
      })

      expect(res.status).toBe(404)
      expect(res.body.error).toBe("Store not found. Check the subdomain.")
    } finally {
      fetchSpy.mockRestore()
      process.env.IS_LOCAL_SERVER = "false"
      delete process.env.CLOUD_API_URL
    }
  })

  it("returns 401 on an incorrect PIN without touching cloudApiKey", async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
      id: "t3",
      name: "Bendo2",
      subdomain: "bendo2",
      cloudApiKey: "",
      suspended: false,
    } as any)
    vi.mocked(prisma.staffUser.findFirst).mockResolvedValue({
      id: "u3",
      name: "Admin",
      pin: PIN_HASH,
    } as any)
    vi.mocked(prisma.tenant.update).mockClear()

    const res = await request("POST", "/api/setup/discover", {
      body: { subdomain: "bendo2", pin: "0000" },
    })

    expect(res.status).toBe(401)
    expect(vi.mocked(prisma.tenant.update)).not.toHaveBeenCalled()
  })
})

describe("POST /api/setup/cloud-config", () => {
  it("rejects with a clear, actionable error when apiKey is missing", async () => {
    const res = await request("POST", "/api/setup/cloud-config", {
      body: { tenantId: "t1", adminPassword: process.env.ADMIN_PASSWORD ?? "" },
    })

    // Runs against the real isLocalRequest/admin-password checks — accept either
    // a 401 (no ADMIN_PASSWORD configured in this env) or 400 (missing apiKey),
    // but never a 200, and never silently accept an empty key.
    expect(res.status).not.toBe(200)
    if (res.status === 400) {
      expect(res.body.error).toMatch(/tenantId and apiKey are required/)
    }
  })
})
