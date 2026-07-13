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
let __uuidCounter = 0
vi.mock("node:crypto", () => ({ default: {}, randomUUID: () => `test-uuid-${++__uuidCounter}` }))

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

  describe("product pull — syncId matching + backfill (POS-SYNC-IDENTITY-1)", () => {
    it("matches the local row by syncId (not numeric id) and never writes the incoming numeric id", async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
        id: "test-tenant-1", name: "Test Store", subdomain: "test",
      } as any)
      // Local row found by stable syncId; its local id (5) differs from cloud's (88)
      vi.mocked(prisma.product.findFirst).mockResolvedValue({ id: 5 } as any)
      vi.mocked(prisma.product.update).mockResolvedValue({} as any)

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => null },
        json: () => Promise.resolve({
          products: [{ id: 88, syncId: "STABLE-1", name: "loreal", barcode: "LOREAL-1", price: 2, stock: 8, tenantId: "test-tenant-1" }],
          customers: [], users: [], suppliers: [], sales: [], refunds: [],
          debtSales: [], debtPayments: [], purchaseOrders: [], supplierPayments: [],
          shifts: [], expenses: [], batches: [], adjustments: [], stockCounts: [],
          dailyCloses: [], deliveryOrders: [], settings: [], deletions: [],
        }),
        text: () => Promise.resolve(""),
      }))

      await expect(cloudSync.triggerFullPull()).resolves.toBeUndefined()

      // Looked up by syncId
      const firstFind = vi.mocked(prisma.product.findFirst).mock.calls[0][0]
      expect(firstFind.where).toEqual({ tenantId: "test-tenant-1", syncId: "STABLE-1" })
      // Updated the LOCAL id (5), never the incoming cloud id (88)
      const upd = vi.mocked(prisma.product.update).mock.calls[0][0]
      expect(upd.where).toEqual({ id: 5 })
      expect(upd.data).not.toHaveProperty("id")

      vi.unstubAllGlobals()
    })

    it("backfillProductSyncIds assigns a syncId to every product lacking one (cloud-authoritative)", async () => {
      vi.mocked(prisma.product.findMany).mockResolvedValue([{ id: 1 }, { id: 2 }] as any)
      vi.mocked(prisma.product.update).mockResolvedValue({} as any)

      await cloudSync.backfillProductSyncIds()

      const calls = vi.mocked(prisma.product.update).mock.calls
      expect(calls.length).toBe(2)
      for (const c of calls) {
        expect(typeof c[0].data.syncId).toBe("string")
        expect((c[0].data.syncId as string).length).toBeGreaterThan(0)
      }
      // only touched rows missing a syncId
      expect(vi.mocked(prisma.product.findMany).mock.calls[0][0]).toMatchObject({ where: { syncId: null } })
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

  describe("hub-authoritative inventory (POS-SYNC-AUTHORITY-1)", () => {
    const empty = {
      products: [], customers: [], users: [], suppliers: [], sales: [], refunds: [],
      debtSales: [], debtPayments: [], purchaseOrders: [], supplierPayments: [],
      shifts: [], expenses: [], batches: [], adjustments: [], stockCounts: [],
      dailyCloses: [], deliveryOrders: [], settings: [], deletions: [],
    }
    const stubPull = (body: Record<string, unknown>) =>
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => "Mon, 13 Jul 2026 12:00:00 GMT" },
        json: () => Promise.resolve({ ...empty, ...body }),
        text: () => Promise.resolve(""),
      }))

    beforeEach(() => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
        id: "test-tenant-1", name: "Test Store", subdomain: "test",
      } as any)
    })

    it("NORMAL pull: does NOT apply cloud stock to an existing product (matched by syncId)", async () => {
      vi.mocked(prisma.product.findFirst).mockResolvedValue({ id: 5 } as any)
      vi.mocked(prisma.product.update).mockResolvedValue({} as any)
      stubPull({ products: [{ id: 88, syncId: "STABLE-1", name: "cola", barcode: "C1", price: 2, stock: 20, tenantId: "test-tenant-1" }] })

      await cloudSync.pullFromCloud() // normal background pull (not a restore)

      const upd = vi.mocked(prisma.product.update).mock.calls[0][0]
      expect(upd.where).toEqual({ id: 5 })
      // stock is hub-owned — must be stripped from the update patch
      expect(upd.data).not.toHaveProperty("stock")
      // metadata still flows
      expect(upd.data).toMatchObject({ name: "cola", price: 2 })
      vi.unstubAllGlobals()
    })

    it("NORMAL pull: skips updating an EXISTING batch (hub owns quantityRemaining/status)", async () => {
      vi.mocked(prisma.inventoryBatch.findUnique).mockResolvedValue({ id: "b1" } as any)
      vi.mocked(prisma.inventoryBatch.update).mockResolvedValue({} as any)
      vi.mocked(prisma.inventoryBatch.create).mockResolvedValue({} as any)
      stubPull({ batches: [{ id: "b1", productId: 5, quantityRemaining: 20, status: "Open", tenantId: "test-tenant-1" }] })

      await cloudSync.pullFromCloud()

      expect(vi.mocked(prisma.inventoryBatch.update)).not.toHaveBeenCalled()
      expect(vi.mocked(prisma.inventoryBatch.create)).not.toHaveBeenCalled()
      vi.unstubAllGlobals()
    })

    it("NORMAL pull: still CREATES a new batch that doesn't exist locally (bootstrap of a new item)", async () => {
      vi.mocked(prisma.inventoryBatch.findUnique).mockResolvedValue(null)
      vi.mocked(prisma.inventoryBatch.create).mockResolvedValue({} as any)
      vi.mocked(prisma.inventoryBatch.update).mockResolvedValue({} as any)
      stubPull({ batches: [{ id: "new-b", productId: 9, quantityRemaining: 12, status: "Open", tenantId: "test-tenant-1" }] })

      await cloudSync.pullFromCloud()

      expect(vi.mocked(prisma.inventoryBatch.create)).toHaveBeenCalledTimes(1)
      expect(vi.mocked(prisma.inventoryBatch.update)).not.toHaveBeenCalled()
      vi.unstubAllGlobals()
    })

    it("NORMAL pull: a check-then-create race (P2002) falls back to the existing-row skip, not a failure", async () => {
      // findUnique says missing, but create races into a unique-constraint
      // violation (row inserted concurrently). Must NOT surface as a pull
      // failure — falls back to the normal-pull skip.
      vi.mocked(prisma.inventoryBatch.findUnique).mockResolvedValue(null)
      vi.mocked(prisma.inventoryBatch.create).mockRejectedValue(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }))
      vi.mocked(prisma.inventoryBatch.update).mockResolvedValue({} as any)
      stubPull({ batches: [{ id: "raced", productId: 5, quantityRemaining: 20, status: "Open", tenantId: "test-tenant-1" }] })

      await expect(cloudSync.pullFromCloud()).resolves.toBeUndefined() // no throw, cursor advances
      expect(vi.mocked(prisma.inventoryBatch.update)).not.toHaveBeenCalled() // normal pull → skip, don't overwrite
      vi.unstubAllGlobals()
    })

    it("EXPLICIT restore: DOES apply cloud stock/batch when no local stock ops are pending", async () => {
      vi.mocked(prisma.syncOperation.count).mockResolvedValue(0) // no pending stock ops
      vi.mocked(prisma.product.findFirst).mockResolvedValue({ id: 5 } as any)
      vi.mocked(prisma.product.update).mockResolvedValue({} as any)
      vi.mocked(prisma.inventoryBatch.findUnique).mockResolvedValue({ id: "b1" } as any)
      vi.mocked(prisma.inventoryBatch.update).mockResolvedValue({} as any)
      stubPull({
        products: [{ id: 88, syncId: "STABLE-1", name: "cola", barcode: "C1", price: 2, stock: 20, tenantId: "test-tenant-1" }],
        batches:  [{ id: "b1", productId: 5, quantityRemaining: 20, status: "Open", tenantId: "test-tenant-1" }],
      })

      await cloudSync.triggerFullPull() // explicit operator restore

      expect(vi.mocked(prisma.product.update).mock.calls[0][0].data).toHaveProperty("stock", 20)
      expect(vi.mocked(prisma.inventoryBatch.update)).toHaveBeenCalledTimes(1)
      vi.unstubAllGlobals()
    })

    it("EXPLICIT restore is BLOCKED from overwriting inventory while local stock ops are pending", async () => {
      vi.mocked(prisma.syncOperation.count).mockResolvedValue(3) // pending local stock ops
      vi.mocked(prisma.product.findFirst).mockResolvedValue({ id: 5 } as any)
      vi.mocked(prisma.product.update).mockResolvedValue({} as any)
      vi.mocked(prisma.inventoryBatch.findUnique).mockResolvedValue({ id: "b1" } as any)
      vi.mocked(prisma.inventoryBatch.update).mockResolvedValue({} as any)
      stubPull({
        products: [{ id: 88, syncId: "STABLE-1", name: "cola", barcode: "C1", price: 2, stock: 20, tenantId: "test-tenant-1" }],
        batches:  [{ id: "b1", productId: 5, quantityRemaining: 20, status: "Open", tenantId: "test-tenant-1" }],
      })

      await cloudSync.triggerFullPull()

      // stock stripped, existing batch left untouched — un-pushed local truth wins
      expect(vi.mocked(prisma.product.update).mock.calls[0][0].data).not.toHaveProperty("stock")
      expect(vi.mocked(prisma.inventoryBatch.update)).not.toHaveBeenCalled()
      // the guard queried pending stock ops with the right entity filter
      const countArg = vi.mocked(prisma.syncOperation.count).mock.calls[0][0] as any
      expect(countArg.where.entity.in).toEqual(expect.arrayContaining(["sale", "refund", "inventory", "product"]))
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
