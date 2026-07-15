import { describe, it, expect, vi, beforeEach } from "vitest"

// POS-PRODUCT-CREATE-STOCK-1 — regression guard for the opening-stock
// double-count. createProduct() must send the product `create` op with
// stock: 0 and let the inventory/receive op carry the entered quantity, so the
// server/cloud stock ends at the entered amount (not 2×). The local product
// object keeps the entered stock for immediate on-screen display.

// Capture every sync op both product.service and inventoryBatch.service enqueue.
const { enqueueMock } = vi.hoisted(() => ({ enqueueMock: vi.fn() }))

vi.mock("../features/pos/services/sync.service", () => ({
  enqueueSyncOperation: (op: unknown) => enqueueMock(op),
  assertCanWrite: () => {},
}))

type SyncOp = { entity: string; action: string; payload: unknown }

function opsFor(entity: string, action: string): SyncOp[] {
  return enqueueMock.mock.calls
    .map((c) => c[0] as SyncOp)
    .filter((op) => op.entity === entity && op.action === action)
}

function asItems<T = Record<string, unknown>>(payload: unknown): T[] {
  return (Array.isArray(payload) ? payload : [payload]) as T[]
}

describe("POS-PRODUCT-CREATE-STOCK-1 — createProduct opening stock", () => {
  beforeEach(() => {
    enqueueMock.mockClear()
    try {
      window.localStorage.clear()
    } catch {
      /* jsdom always has localStorage; guard for safety */
    }
  })

  it("sends product.create with stock 0 and inventory/receive with the full quantity", async () => {
    const { createProduct } = await import("../features/pos/services/product.service")

    const created = createProduct({
      name: "ZZ Test Cola",
      price: 2,
      cost: 1,
      stock: 24,
      barcode: "990000000024",
      category: "Test Beverages",
    })

    // Local cache keeps the entered quantity for immediate display.
    expect(created).toBeDefined()
    expect(created!.stock).toBe(24)

    // The server create op must carry stock 0 (authoritative stock comes from receive).
    const createOps = opsFor("product", "create")
    expect(createOps.length).toBe(1)
    const createdRow = asItems(createOps[0].payload).find(
      (p) => p.barcode === "990000000024"
    ) as { stock: number } | undefined
    expect(createdRow).toBeDefined()
    expect(createdRow!.stock).toBe(0)

    // The inventory/receive op carries the full entered quantity exactly once.
    const receiveOps = opsFor("inventory", "receive")
    expect(receiveOps.length).toBe(1)
    const batches = asItems<{ initialQuantity: number }>(receiveOps[0].payload)
    expect(batches).toHaveLength(1)
    expect(batches[0].initialQuantity).toBe(24)

    // Net server stock = 0 (create) + 24 (receive) = 24, never 48.
  })

  it("creates no inventory/receive batch when opening stock is 0", async () => {
    const { createProduct } = await import("../features/pos/services/product.service")

    const created = createProduct({
      name: "ZZ Test Water",
      price: 1,
      cost: 0.5,
      stock: 0,
      barcode: "990000000000",
      category: "Test Beverages",
    })

    expect(created).toBeDefined()

    const createOps = opsFor("product", "create")
    expect(createOps.length).toBe(1)
    const createdRow = asItems(createOps[0].payload).find(
      (p) => p.barcode === "990000000000"
    ) as { stock: number } | undefined
    expect(createdRow!.stock).toBe(0)

    // No opening stock → no receive op → server stock stays 0.
    expect(opsFor("inventory", "receive").length).toBe(0)
  })

  // POS-PRODUCT-IMAGE-1
  it("carries an optional image into the product.create payload", async () => {
    const { createProduct } = await import("../features/pos/services/product.service")
    const created = createProduct({
      name: "ZZ Imaged", price: 1, cost: 0.5, stock: 0,
      barcode: "990000000900", category: "Test Beverages",
      image: "data:image/jpeg;base64,IMGDATA",
    })
    expect(created!.image).toBe("data:image/jpeg;base64,IMGDATA")
    const row = asItems(opsFor("product", "create")[0].payload).find((p) => p.barcode === "990000000900") as { image?: string }
    expect(row.image).toBe("data:image/jpeg;base64,IMGDATA")
  })

  it("creates fine without an image (image optional)", async () => {
    const { createProduct } = await import("../features/pos/services/product.service")
    const created = createProduct({ name: "ZZ NoImage", price: 1, cost: 0.5, stock: 0, barcode: "990000000901", category: "Test Beverages" })
    expect(created).toBeDefined()
    const row = asItems(opsFor("product", "create")[0].payload).find((p) => p.barcode === "990000000901") as { image?: string }
    expect(row.image).toBeUndefined()
  })
})
