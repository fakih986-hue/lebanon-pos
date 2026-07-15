import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Product } from "../features/pos/types/product"

// POS-RECEIVE-UX-1A — the "add barcode to existing product" decision, committed
// only through receiveProducts on Save Batch. Verifies the service contract:
// alias append + receive into target, conflict rejection, and that normal
// new/existing receives are unchanged. (The UI staging — no updateProduct call
// until Save — is structural: ProductReceivePage no longer imports updateProduct.)

const { enqueueMock } = vi.hoisted(() => ({ enqueueMock: vi.fn() }))
vi.mock("../features/pos/services/sync.service", () => ({
  enqueueSyncOperation: (op: unknown) => enqueueMock(op),
  assertCanWrite: () => {},
}))

type SyncOp = { entity: string; action: string; payload: any }
const ops = () => enqueueMock.mock.calls.map((c) => c[0] as SyncOp)
const opsFor = (entity: string, action: string) =>
  ops().filter((o) => o.entity === entity && o.action === action)
const items = (payload: unknown): any[] => (Array.isArray(payload) ? payload : [payload])

const STORAGE_KEY = "lebanonpos.products.v1"
const base = (over: Partial<Product>): Product => ({
  id: 0, name: "X", price: 1, cost: 0.5, stock: 5, barcode: "",
  category: "Test", accent: "emerald", barcodeAliases: [], ...over,
})
function seed(products: Product[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(products))
}

describe("POS-RECEIVE-UX-1A — alias receive decision", () => {
  beforeEach(() => {
    enqueueMock.mockClear()
    try { window.localStorage.clear() } catch { /* jsdom */ }
  })

  it("appends the alias to the target and receives stock into it (no double-count, price untouched)", async () => {
    const { receiveProducts } = await import("../features/pos/services/product.service")
    seed([base({ id: 1, name: "Pepsi", barcode: "PRIMARY-A", price: 0.75 })])

    const r = receiveProducts([
      { name: "Pepsi", barcode: "NEW-B", category: "Bev", stock: 6, cost: 0.4, price: 0.75, attachAliasToProductId: 1 },
    ])
    expect(r.rejectedCount).toBe(0)
    expect(r.batchesCreated).toBe(1)

    // alias persisted via a metadata-only product.update (never a stock field)
    const upd = opsFor("product", "update").map((o) => o.payload).find((p) => p.id === 1)
    expect(upd).toBeDefined()
    expect(upd.barcodeAliases).toContain("NEW-B")
    expect(upd).not.toHaveProperty("stock")

    // received into the target (id 1) with the full qty, once
    const recv = opsFor("inventory", "receive")
    expect(recv.length).toBe(1)
    const batch = items(recv[0].payload).find((b) => b.productId === 1)
    expect(batch).toBeDefined()
    expect(batch.initialQuantity).toBe(6)

    // no new product created
    expect(opsFor("product", "create").length).toBe(0)
  })

  it("rejects an alias whose barcode belongs to a DIFFERENT product and receives no stock", async () => {
    const { receiveProducts } = await import("../features/pos/services/product.service")
    seed([
      base({ id: 1, name: "Pepsi", barcode: "A" }),
      base({ id: 2, name: "Water", barcode: "TAKEN" }),
    ])

    const r = receiveProducts([
      { name: "Pepsi", barcode: "TAKEN", category: "Bev", stock: 5, cost: 1, price: 2, attachAliasToProductId: 1 },
    ])
    expect(r.rejectedCount).toBe(1)
    expect(r.errors[0]).toContain("TAKEN")
    expect(r.batchesCreated).toBe(0)
    expect(opsFor("inventory", "receive").length).toBe(0)
  })

  it("receives without adding a duplicate when the barcode is already the target's alias", async () => {
    const { receiveProducts } = await import("../features/pos/services/product.service")
    seed([base({ id: 1, name: "Pepsi", barcode: "A", barcodeAliases: ["B"] })])

    const r = receiveProducts([
      { name: "Pepsi", barcode: "B", category: "Bev", stock: 3, cost: 0.4, price: 0.75, attachAliasToProductId: 1 },
    ])
    expect(r.rejectedCount).toBe(0)
    expect(r.batchesCreated).toBe(1)
    // alias set unchanged → no product.update enqueued for it
    const upd = opsFor("product", "update").map((o) => o.payload).find((p) => p.id === 1)
    expect(upd).toBeUndefined()
  })

  it("regression: a normal NEW-product receive still creates at stock 0 + receives the qty", async () => {
    const { receiveProducts } = await import("../features/pos/services/product.service")
    seed([])
    const r = receiveProducts([
      { name: "Fresh Item", barcode: "NEW-X", category: "Bev", stock: 4, cost: 1, price: 2 },
    ])
    expect(r.newlyCreated.length).toBe(1)
    const created = items(opsFor("product", "create")[0].payload).find((p) => p.barcode === "NEW-X")
    expect(created.stock).toBe(0) // RECEIVE-1 authority preserved
    const batch = items(opsFor("inventory", "receive")[0].payload).find((b) => b.barcode === "NEW-X")
    expect(batch.initialQuantity).toBe(4)
  })

  it("regression: a normal receive of a KNOWN barcode still restocks the existing product", async () => {
    const { receiveProducts } = await import("../features/pos/services/product.service")
    seed([base({ id: 1, name: "Pepsi", barcode: "PRIMARY-A" })])
    const r = receiveProducts([
      { name: "Pepsi", barcode: "PRIMARY-A", category: "Test", stock: 5, cost: 0.4, price: 0.75 },
    ])
    expect(r.modifiedExisting.length).toBe(1)
    const batch = items(opsFor("inventory", "receive")[0].payload).find((b) => b.productId === 1)
    expect(batch.initialQuantity).toBe(5)
  })

  // POS-PRODUCT-IMAGE-1
  it("a NEW-product receive carries the image into the create payload (at stock 0)", async () => {
    const { receiveProducts } = await import("../features/pos/services/product.service")
    seed([])
    const r = receiveProducts([
      { name: "Imaged", barcode: "IMG-X", category: "Bev", stock: 2, cost: 1, price: 2, image: "data:image/jpeg;base64,ZZZ" },
    ])
    expect(r.newlyCreated.length).toBe(1)
    const created = items(opsFor("product", "create")[0].payload).find((p) => p.barcode === "IMG-X")
    expect(created.image).toBe("data:image/jpeg;base64,ZZZ")
    expect(created.stock).toBe(0)
  })

  it("alias receive never overwrites the target's existing image", async () => {
    const { receiveProducts } = await import("../features/pos/services/product.service")
    seed([base({ id: 1, name: "Pepsi", barcode: "A", image: "OLD-IMG" })])
    const r = receiveProducts([
      { name: "Pepsi", barcode: "NEW-B", category: "Bev", stock: 3, cost: 0.4, price: 0.75, attachAliasToProductId: 1, image: "SHOULD-IGNORE" },
    ])
    expect(r.rejectedCount).toBe(0)
    const upd = opsFor("product", "update").map((o) => o.payload).find((p) => p.id === 1)
    expect(upd.image).toBe("OLD-IMG")
  })

  it("matched restock never overwrites the target's existing image", async () => {
    const { receiveProducts } = await import("../features/pos/services/product.service")
    seed([base({ id: 1, name: "Pepsi", barcode: "PRIMARY-A", image: "OLD-IMG" })])
    const r = receiveProducts([
      { name: "Pepsi", barcode: "PRIMARY-A", category: "Test", stock: 5, cost: 0.4, price: 0.75, image: "SHOULD-IGNORE" },
    ])
    expect(r.modifiedExisting.length).toBe(1)
    const upd = opsFor("product", "update").map((o) => o.payload).find((p) => p.id === 1)
    expect(upd.image).toBe("OLD-IMG")
  })

  // POS-RECEIVE-VARIANT-1B
  it("variant row creates a child product (parentId + variantName), stock = qty (not doubled), parent stock untouched", async () => {
    const { receiveProducts } = await import("../features/pos/services/product.service")
    seed([base({ id: 1, name: "Pepsi", barcode: "A", stock: 40, price: 0.75 })])

    const r = receiveProducts([
      { name: "Pepsi - 1L", barcode: "VAR-1L", category: "Bev", stock: 5, cost: 0.5, price: 1.5, parentId: 1, variantName: "1L" },
    ])

    expect(r.newlyCreated.length).toBe(1)
    const child = r.newlyCreated[0]
    expect(child.parentId).toBe(1)
    expect(child.variantName).toBe("1L")
    expect(child.barcode).toBe("VAR-1L")

    // create payload follows the stock:0 rule → receive adds qty → net = qty, not 2×
    const created = items(opsFor("product", "create")[0].payload).find((p) => p.barcode === "VAR-1L")
    expect(created.stock).toBe(0)
    expect(created.parentId).toBe(1)
    expect(created.variantName).toBe("1L")

    // exactly one receive batch, for the CHILD; none for the parent (parent stock untouched)
    const batches = items(opsFor("inventory", "receive")[0].payload)
    expect(batches).toHaveLength(1)
    expect(batches[0].productId).toBe(child.id)
    expect(batches[0].initialQuantity).toBe(5)
    expect(batches.some((b) => b.productId === 1)).toBe(false)
  })

  it("variant flags the parent isParent (metadata only) and never adds an alias to it", async () => {
    const { receiveProducts } = await import("../features/pos/services/product.service")
    seed([base({ id: 1, name: "Pepsi", barcode: "A" })])

    receiveProducts([
      { name: "Pepsi - 1L", barcode: "VAR-1L", category: "Bev", stock: 3, cost: 0.5, price: 1.5, parentId: 1, variantName: "1L" },
    ])

    const parentUpd = opsFor("product", "update").map((o) => o.payload).find((p) => p.id === 1)
    expect(parentUpd).toBeDefined()
    expect(parentUpd.isParent).toBe(true)
    expect(parentUpd).not.toHaveProperty("stock")
    expect(parentUpd.barcodeAliases ?? []).not.toContain("VAR-1L")
  })
})
