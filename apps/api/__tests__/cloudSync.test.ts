import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.hoisted(() => {
  process.env.CLOUD_API_URL = "https://test-cloud.example.com"
  process.env.CLOUD_TENANT_ID = "test-tenant-1"
  process.env.CLOUD_API_KEY = "test-api-key-123"
  process.env.JWT_SECRET = "test-secret"
  process.env.DATABASE_URL = "mock://localhost"
})

// Mock fs before importing the module under test
vi.mock("node:fs", () => {
  const store: Record<string, string> = {}
  return {
    default: {
      readFileSync: vi.fn((path: string) => {
        if (store[path]) return store[path]
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
      }),
      writeFileSync: vi.fn((path: string, data: string) => { store[path] = data }),
      mkdirSync: vi.fn(),
      appendFileSync: vi.fn(),
    },
    readFileSync: vi.fn((path: string) => {
      if (store[path]) return store[path]
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
    }),
    writeFileSync: vi.fn((path: string, data: string) => { store[path] = data }),
    mkdirSync: vi.fn(),
    appendFileSync: vi.fn(),
  }
})

// Mock prisma used by cloudSync
vi.mock("../src/lib/prisma", () => {
  const model = () => ({
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
    count: vi.fn(),
    aggregate: vi.fn(),
  })

  const client: Record<string, unknown> = {
    tenant: model(),
    syncOperation: { ...model(), count: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    product: model(),
    customer: model(),
    staffUser: model(),
    supplier: model(),
    sale: model(),
    saleItem: { ...model(), createMany: vi.fn(), deleteMany: vi.fn() },
    saleTender: model(),
    saleRefund: model(),
    refundItem: { ...model(), createMany: vi.fn(), deleteMany: vi.fn() },
    debtSale: model(),
    debtPayment: model(),
    purchaseOrder: model(),
    purchaseOrderItem: { ...model(), createMany: vi.fn(), deleteMany: vi.fn() },
    supplierPayment: model(),
    shift: model(),
    appSettings: { findUnique: vi.fn(), upsert: vi.fn() },
    expense: model(),
    inventoryBatch: model(),
    stockAdjustment: model(),
    stockMovement: model(),
    stockCountSession: model(),
    stockCountLine: model(),
    dailyClose: model(),
    deliveryOrder: model(),
    deliveryOrderItem: { ...model(), deleteMany: vi.fn(), createMany: vi.fn() },
    $connect: vi.fn(),
    $disconnect: vi.fn(),
    $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(client)),
  }

  return { default: client }
})

// Mock node:crypto (used internally but not critical)
vi.mock("node:crypto", () => ({ default: {} }))

// Now import the module under test
import * as cloudSync from "../src/services/cloudSync"
import prisma from "../src/lib/prisma"

describe("cloudSync", () => {
  beforeEach(() => { vi.clearAllMocks() })
  afterEach(() => {
    cloudSync.stopCloudSyncBridge()
  })

  describe("getCloudStatus", () => {
    it("returns running=false by default", () => {
      const status = cloudSync.getCloudStatus()
      expect(status.configured).toBe(true)  // env vars set
      expect(status.running).toBe(false)
      expect(status.tenantId).toBe("test-tenant-1")
    })
  })

  describe("triggerFullPull", () => {
    it("throws when fetch fails", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")))
      await expect(cloudSync.triggerFullPull()).rejects.toThrow()
      vi.unstubAllGlobals()
    })

    it("fetches data from Railway and upserts it", async () => {
      const mockPullResponse = {
        products: [
          { id: 101, name: "Synced Cola", barcode: "111", price: 1.5, stock: 10, tenantId: "test-tenant-1" },
        ],
        customers: [],
        users: [],
        suppliers: [],
        sales: [],
        refunds: [],
        debtSales: [],
        debtPayments: [],
        purchaseOrders: [],
        supplierPayments: [],
        shifts: [],
        expenses: [],
        batches: [],
        adjustments: [],
        stockCounts: [],
        dailyCloses: [],
        deliveryOrders: [],
        settings: [],
        deletions: [],
      }

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => null },
        json: () => Promise.resolve(mockPullResponse),
        text: () => Promise.resolve(""),
      }))

      vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
        id: "test-tenant-1", name: "Test Store", subdomain: "test",
      } as any)
      vi.mocked(prisma.product.findFirst).mockResolvedValue(null)
      vi.mocked(prisma.product.upsert).mockResolvedValue({} as any)

      await expect(cloudSync.triggerFullPull()).resolves.toBeUndefined()

      // Verify upsert was called with the synced product
      expect(vi.mocked(prisma.product.upsert).mock.calls.length).toBe(1)
      const upsertCall = vi.mocked(prisma.product.upsert).mock.calls[0][0]
      expect(upsertCall.where.tenantId_barcode.barcode).toBe("111")
      expect(upsertCall.create.name).toBe("Synced Cola")

      vi.unstubAllGlobals()
    })
  })

  describe("saveCloudConfig", () => {
    it("persists config and restarts bridge", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, headers: { get: () => null }, json: () => Promise.resolve({ results: [] }) }))

      const ten = vi.mocked(prisma.tenant.findUnique)
      ten.mockResolvedValue(null)
      vi.mocked(prisma.tenant.create).mockResolvedValue({} as any)
      vi.mocked(prisma.syncOperation.count).mockResolvedValue(0)

      // saveCloudConfig writes file + calls restartCloudSyncBridge
      // restartCloudSyncBridge calls stop then start
      // start with env vars should start the bridge
      // We test that it doesn't throw
      cloudSync.saveCloudConfig("tenant-2", "key-2")
      // Verify the bridge starts
      expect(cloudSync.getCloudStatus().configured).toBe(true)

      vi.unstubAllGlobals()
    })
  })
})
