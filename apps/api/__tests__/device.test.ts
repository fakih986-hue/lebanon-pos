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
    device: model(),
    pairingCode: model(),
    $connect: vi.fn(),
    $disconnect: vi.fn(),
  }

  mock.$transaction = vi.fn((cb: (tx: any) => unknown) => cb(mock))

  return { default: mock }
})

const token = signToken({ userId: "u1", tenantId: "t1", role: "Admin" })

beforeAll(() => { vi.useFakeTimers(); return startServer() })
afterAll(() => { vi.useRealTimers(); return stopServer() })

describe("POST /api/device/generate-code", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("returns 401 without auth", async () => {
    const res = await request("POST", "/api/device/generate-code")
    expect(res.status).toBe(401)
  })

  it("generates a 6-character hex code", async () => {
    vi.mocked(prisma.pairingCode.create).mockResolvedValue({ id: "pc1" })
    vi.mocked(prisma.auditEvent.create).mockResolvedValue({} as any)
    const res = await request("POST", "/api/device/generate-code", { token })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.code).toMatch(/^[0-9A-F]{6}$/)
    expect(res.body.expiresAt).toBeDefined()
  })
})

describe("POST /api/device/pair", () => {
  beforeEach(() => { vi.clearAllMocks() })

  const validCode = { id: "pc1", tenantId: "t1", code: "ABC123", expiresAt: new Date(Date.now() + 300_000), usedAt: null, deviceId: null, deviceName: "" }

  it("rejects invalid pairing code", async () => {
    vi.mocked(prisma.pairingCode.findUnique).mockResolvedValue(null)
    const res = await request("POST", "/api/device/pair", {
      body: { code: "INVALID", deviceId: "DEV-001", deviceName: "Test Device" },
    })
    expect(res.status).toBe(403)
    expect(res.body.error).toBe("Invalid pairing code")
  })

  it("rejects already used code", async () => {
    vi.mocked(prisma.pairingCode.findUnique).mockResolvedValue({ ...validCode, usedAt: new Date() })
    const res = await request("POST", "/api/device/pair", {
      body: { code: "ABC123", deviceId: "DEV-001", deviceName: "Test Device" },
    })
    expect(res.status).toBe(403)
    expect(res.body.error).toBe("Pairing code already used")
  })

  it("rejects expired code", async () => {
    vi.mocked(prisma.pairingCode.findUnique).mockResolvedValue({ ...validCode, expiresAt: new Date(Date.now() - 60_000) })
    const res = await request("POST", "/api/device/pair", {
      body: { code: "EXPIRED", deviceId: "DEV-001", deviceName: "Test Device" },
    })
    expect(res.status).toBe(403)
    expect(res.body.error).toBe("Pairing code has expired")
  })

  it("approves device with valid code", async () => {
    vi.mocked(prisma.pairingCode.findUnique).mockResolvedValue(validCode)
    vi.mocked(prisma.pairingCode.update).mockResolvedValue({} as any)
    vi.mocked(prisma.device.upsert).mockResolvedValue({ id: "d1" } as any)
    vi.mocked(prisma.auditEvent.create).mockResolvedValue({} as any)
    const res = await request("POST", "/api/device/pair", {
      body: { code: "ABC123", deviceId: "DEV-001", deviceName: "Test Device" },
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.deviceId).toBe("DEV-001")
  })
})

describe("POST /api/sync/push — device approval check", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("allows push from approved device on local hub", async () => {
    process.env.IS_LOCAL_SERVER = "true"
    vi.mocked(prisma.device.findUnique).mockResolvedValue({ id: "d1", status: "APPROVED", tenantId: "t1", deviceId: "DEV-001" } as any)
    vi.mocked(prisma.device.update).mockResolvedValue({} as any)
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({ licenseStatus: "active", suspendedAt: null, offlineGraceDays: 7 })
    vi.mocked(prisma.syncOperation.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.syncOperation.create).mockResolvedValue({} as any)
    const res = await request("POST", "/api/sync/push", {
      token,
      body: { deviceId: "DEV-001", operations: [{ id: "op1", entity: "product", action: "create", payload: { name: "Cola", price: 1.5 } }] },
    })
    expect(res.status).toBe(200)
  })

  it("rejects push from unknown device on local hub", async () => {
    process.env.IS_LOCAL_SERVER = "true"
    vi.mocked(prisma.device.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.auditEvent.create).mockResolvedValue({} as any)
    const res = await request("POST", "/api/sync/push", {
      token,
      body: { deviceId: "DEV-UNKNOWN", operations: [{ id: "op1", entity: "product", action: "create", payload: {} }] },
    })
    expect(res.status).toBe(403)
    expect(res.body.code).toBe("DEVICE_NOT_APPROVED")
  })

  it("rejects push from revoked device on local hub", async () => {
    process.env.IS_LOCAL_SERVER = "true"
    vi.mocked(prisma.device.findUnique).mockResolvedValue({ id: "d2", status: "REVOKED", tenantId: "t1", deviceId: "DEV-REVOKED" } as any)
    vi.mocked(prisma.auditEvent.create).mockResolvedValue({} as any)
    const res = await request("POST", "/api/sync/push", {
      token,
      body: { deviceId: "DEV-REVOKED", operations: [{ id: "op2", entity: "product", action: "create", payload: {} }] },
    })
    expect(res.status).toBe(403)
    expect(res.body.code).toBe("DEVICE_NOT_APPROVED")
  })

  it("requires deviceId on local hub", async () => {
    process.env.IS_LOCAL_SERVER = "true"
    const res = await request("POST", "/api/sync/push", {
      token,
      body: { operations: [{ id: "op1", entity: "product", action: "create", payload: {} }] },
    })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe("DEVICE_ID_REQUIRED")
  })

  it("rejects unknown device when IS_LOCAL_SERVER is '1'", async () => {
    process.env.IS_LOCAL_SERVER = "1"
    vi.mocked(prisma.device.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.auditEvent.create).mockResolvedValue({} as any)
    const res = await request("POST", "/api/sync/push", {
      token,
      body: { deviceId: "DEV-UNKNOWN", operations: [{ id: "op1", entity: "product", action: "create", payload: {} }] },
    })
    expect(res.status).toBe(403)
    expect(res.body.code).toBe("DEVICE_NOT_APPROVED")
  })

  it("skips device check when not local hub", async () => {
    process.env.IS_LOCAL_SERVER = "false"
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({ licenseStatus: "active", suspendedAt: null, offlineGraceDays: 7 })
    vi.mocked(prisma.syncOperation.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.syncOperation.create).mockResolvedValue({} as any)
    const res = await request("POST", "/api/sync/push", {
      token,
      body: { operations: [{ id: "op1", entity: "product", action: "create", payload: { name: "Cola", price: 1.5 } }] },
    })
    expect(res.status).toBe(200)
  })
})

describe("GET /api/device/list", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("returns 401 without auth", async () => {
    const res = await request("GET", "/api/device/list")
    expect(res.status).toBe(401)
  })

  it("lists devices for the tenant", async () => {
    const devices = [
      { id: "d1", tenantId: "t1", deviceId: "DEV-001", deviceName: "Hub", registerId: "", status: "APPROVED", firstSeenAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), lastIp: "192.168.1.10" },
    ]
    vi.mocked(prisma.device.findMany).mockResolvedValue(devices as any)
    const res = await request("GET", "/api/device/list", { token })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body[0].deviceId).toBe("DEV-001")
  })
})

describe("POST /api/device/rename", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("renames a device", async () => {
    vi.mocked(prisma.device.update).mockResolvedValue({} as any)
    vi.mocked(prisma.auditEvent.create).mockResolvedValue({} as any)
    const res = await request("POST", "/api/device/rename", {
      token,
      body: { deviceId: "DEV-001", deviceName: "New Name" },
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })
})

describe("POST /api/device/register-hub", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("registers the hub device as approved", async () => {
    vi.mocked(prisma.device.upsert).mockResolvedValue({ id: "d1" } as any)
    vi.mocked(prisma.auditEvent.create).mockResolvedValue({} as any)
    const res = await request("POST", "/api/device/register-hub", {
      token,
      body: { deviceId: "DEV-HUB-001", deviceName: "Hub" },
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.deviceId).toBe("DEV-HUB-001")
  })
})

describe("POST /api/device/revoke", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("revokes a device", async () => {
    vi.mocked(prisma.device.findUnique).mockResolvedValue({ id: "d1", tenantId: "t1", deviceId: "DEV-001" } as any)
    vi.mocked(prisma.device.update).mockResolvedValue({} as any)
    vi.mocked(prisma.auditEvent.create).mockResolvedValue({} as any)
    const res = await request("POST", "/api/device/revoke", {
      token,
      body: { deviceId: "DEV-001" },
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it("returns 404 for missing device", async () => {
    vi.mocked(prisma.device.findUnique).mockResolvedValue(null)
    const res = await request("POST", "/api/device/revoke", {
      token,
      body: { deviceId: "DEV-MISSING" },
    })
    expect(res.status).toBe(404)
  })
})
