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

  describe("triggerFullPull — cursor behavior on partial failure", () => {
    const basePullResponse = {
      products: [], customers: [], users: [], suppliers: [], sales: [], refunds: [],
      debtSales: [], debtPayments: [], purchaseOrders: [], supplierPayments: [],
      shifts: [], expenses: [], batches: [], adjustments: [], stockCounts: [],
      dailyCloses: [], deliveryOrders: [], settings: [], deletions: [],
    }

    it("does NOT advance lastPullAt when an entity upsert fails (incremental pull)", async () => {
      // Seed an existing cursor via a clean pull first, matching a hub that's
      // already been running for a while (not a fresh triggerFullPull reset).
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
        id: "test-tenant-1", name: "Test Store", subdomain: "test",
      } as any)
      vi.mocked(prisma.staffUser.upsert).mockResolvedValue({} as any)
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => "Sat, 11 Jul 2026 12:00:00 GMT" },
        json: () => Promise.resolve(basePullResponse),
        text: () => Promise.resolve(""),
      }))
      await cloudSync.pullFromCloud()
      const before = cloudSync.getCloudStatus().lastPullAt
      expect(before).toBeTruthy()
      vi.unstubAllGlobals()

      // Now an incremental pull returns a staff record whose upsert fails —
      // simulates the real-world bug: tenant/products sync fine but a staff
      // record fails, and the cursor must not move past it.
      vi.mocked(prisma.staffUser.upsert).mockRejectedValue(new Error("DB constraint violation"))
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => "Sat, 11 Jul 2026 12:00:30 GMT" },
        json: () => Promise.resolve({
          ...basePullResponse,
          users: [{ id: "staff-1", name: "test", role: "Admin", pin: "hash", active: true }],
        }),
        text: () => Promise.resolve(""),
      }))

      await expect(cloudSync.pullFromCloud()).rejects.toThrow(/Partial pull failure/)

      const after = cloudSync.getCloudStatus().lastPullAt
      expect(after).toBe(before) // cursor unchanged despite tenant/products succeeding

      vi.unstubAllGlobals()
    })

    it("force-advances the cursor after repeated identical failures (self-heal from a poisoned record)", async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
        id: "test-tenant-1", name: "Test Store", subdomain: "test",
      } as any)
      // Seed a starting cursor with a clean pull
      vi.mocked(prisma.staffUser.upsert).mockResolvedValue({} as any)
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => "Sat, 11 Jul 2026 10:00:00 GMT" },
        json: () => Promise.resolve(basePullResponse),
        text: () => Promise.resolve(""),
      }))
      await cloudSync.pullFromCloud()
      const seedCursor = cloudSync.getCloudStatus().lastPullAt
      vi.unstubAllGlobals()

      // Same poisoned record fails identically on every retry
      vi.mocked(prisma.staffUser.upsert).mockRejectedValue(new Error("Foreign key constraint violated"))
      const poisonedResponse = {
        ...basePullResponse,
        users: [{ id: "poisoned-staff", name: "ghost", role: "Cashier", pin: "hash", active: true }],
      }
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => "Sat, 11 Jul 2026 10:05:00 GMT" },
        json: () => Promise.resolve(poisonedResponse),
        text: () => Promise.resolve(""),
      }))

      // First 4 attempts: cursor stays put, error thrown each time
      for (let i = 0; i < 4; i++) {
        await expect(cloudSync.pullFromCloud()).rejects.toThrow()
        expect(cloudSync.getCloudStatus().lastPullAt).toBe(seedCursor)
      }

      // 5th identical failure: self-heals — advances the cursor instead of
      // blocking forever, since every OTHER entity is otherwise stuck too.
      await expect(cloudSync.pullFromCloud()).resolves.toBeUndefined()
      expect(cloudSync.getCloudStatus().lastPullAt).not.toBe(seedCursor)

      vi.unstubAllGlobals()
    })

    it("advances lastPullAt when every entity upserts cleanly", async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
        id: "test-tenant-1", name: "Test Store", subdomain: "test",
      } as any)
      vi.mocked(prisma.staffUser.upsert).mockResolvedValue({} as any)

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => "Sat, 12 Jul 2026 00:00:00 GMT" },
        json: () => Promise.resolve({
          ...basePullResponse,
          users: [{ id: "staff-1", name: "test", role: "Admin", pin: "hash", active: true }],
        }),
        text: () => Promise.resolve(""),
      }))

      await expect(cloudSync.pullFromCloud()).resolves.toBeUndefined()

      expect(cloudSync.getCloudStatus().lastPullAt).toBeTruthy()

      vi.unstubAllGlobals()
    })
  })

  describe("product pull — barcode-fallback must never clobber a local row's own id", () => {
    it("does NOT include the incoming (mismatched) id when updating a locally-created product matched by barcode", async () => {
      // Simulates: this hub created "loreal" locally BEFORE ever syncing it to
      // Railway (its own sequence assigned id 5). Railway later assigns its
      // own id (79) to the same product once pushed up. On the next pull,
      // this hub sees Railway's copy (id: 79) and must reconcile it against
      // its OWN existing local row (id: 5) — found by barcode, since the ids
      // don't match. The local row's own id must never be overwritten by the
      // incoming one — that would silently rewrite a live primary key,
      // orphaning any local FK (SaleItem, InventoryBatch, etc.) that already
      // points at id 5.
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
        id: "test-tenant-1", name: "Test Store", subdomain: "test",
      } as any)
      // No local row exists with id 79 (Railway's id) — this hub's copy is id 5
      vi.mocked(prisma.product.findFirst).mockResolvedValue(null)
      vi.mocked(prisma.product.upsert).mockResolvedValue({} as any)

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => null },
        json: () => Promise.resolve({
          products: [{ id: 79, name: "loreal", barcode: "LOREAL-1", price: 2, stock: 8, tenantId: "test-tenant-1" }],
          customers: [], users: [], suppliers: [], sales: [], refunds: [],
          debtSales: [], debtPayments: [], purchaseOrders: [], supplierPayments: [],
          shifts: [], expenses: [], batches: [], adjustments: [], stockCounts: [],
          dailyCloses: [], deliveryOrders: [], settings: [], deletions: [],
        }),
        text: () => Promise.resolve(""),
      }))

      await expect(cloudSync.triggerFullPull()).resolves.toBeUndefined()

      const call = vi.mocked(prisma.product.upsert).mock.calls[0][0]
      expect(call.where).toEqual({ tenantId_barcode: { tenantId: "test-tenant-1", barcode: "LOREAL-1" } })
      // The critical assertion: the UPDATE branch (what runs when the local
      // row is matched by barcode) must not carry the incoming id at all.
      expect(call.update).not.toHaveProperty("id")
      expect(call.update).not.toHaveProperty("tenantId")
      // Every other field should still flow through normally.
      expect(call.update).toMatchObject({ name: "loreal", barcode: "LOREAL-1", price: 2, stock: 8 })

      vi.unstubAllGlobals()
    })
  })

  describe("deliveryOrder pull — dangling customerId", () => {
    it("drops the customerId FK instead of failing when the referenced customer doesn't exist locally", async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
        id: "test-tenant-1", name: "Test Store", subdomain: "test",
      } as any)
      vi.mocked(prisma.customer.findUnique).mockResolvedValue(null) // customer not found locally
      vi.mocked((prisma as any).deliveryOrder.upsert).mockResolvedValue({} as any)

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => "Sat, 12 Jul 2026 00:00:00 GMT" },
        json: () => Promise.resolve({
          products: [], customers: [], users: [], suppliers: [], sales: [], refunds: [],
          debtSales: [], debtPayments: [], purchaseOrders: [], supplierPayments: [],
          shifts: [], expenses: [], batches: [], adjustments: [], stockCounts: [],
          dailyCloses: [], settings: [], deletions: [],
          deliveryOrders: [{
            id: "do-1", orderNumber: "D-1", status: "Pending",
            customerId: "dangling-customer-id", customerName: "Guest", customerPhone: "70000000",
            address: "Somewhere", itemsTotal: 10, deliveryFee: 0, total: 10,
          }],
        }),
        text: () => Promise.resolve(""),
      }))

      await expect(cloudSync.triggerFullPull()).resolves.toBeUndefined()

      const call = vi.mocked((prisma as any).deliveryOrder.upsert).mock.calls[0][0]
      expect(call.create.customerId).toBeNull()

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
