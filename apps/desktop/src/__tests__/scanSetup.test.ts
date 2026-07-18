import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Product } from "../features/pos/types/product"
import {
  resolveScannedBarcode,
  commitScanSetup,
} from "../features/pos/services/scanSetup.service"

// POS-FIRST-SETUP-CATALOG-1D — one-by-one scan into Opening inventory.
const { enqueueMock } = vi.hoisted(() => ({ enqueueMock: vi.fn() }))
vi.mock("../features/pos/services/sync.service", () => ({
  enqueueSyncOperation: (op: unknown) => enqueueMock(op),
  assertCanWrite: () => {},
}))

const MOVEMENTS_KEY = "lebanonpos.stock-movements.v1"
const PRODUCTS_KEY = "lebanonpos.products.v1"

const base = (over: Partial<Product>): Product => ({
  id: 0, name: "X", price: 1, cost: 0.5, stock: 5, barcode: "",
  category: "General", accent: "emerald", barcodeAliases: [], ...over,
})
const items = (payload: unknown): any[] => (Array.isArray(payload) ? payload : [payload])
const opsFor = (entity: string, action: string) =>
  enqueueMock.mock.calls.map((c) => c[0] as any).filter((o) => o.entity === entity && o.action === action)
const movements = (): any[] => { try { return JSON.parse(window.localStorage.getItem(MOVEMENTS_KEY) ?? "[]") } catch { return [] } }
const seed = (list: Product[]) => window.localStorage.setItem(PRODUCTS_KEY, JSON.stringify(list))

beforeEach(() => {
  enqueueMock.mockClear()
  try { window.localStorage.clear(); window.localStorage.setItem("lebanonpos.suppliers.v1", "[]") } catch { /* jsdom */ }
})

describe("POS-FIRST-SETUP-CATALOG-1D — resolveScannedBarcode (pure)", () => {
  const catalog = [base({ id: 1, name: "Pepsi", barcode: "PRIMARY-A", barcodeAliases: ["ALIAS-1"] })]

  it("new barcode → new (with any exact name matches surfaced)", () => {
    const r = resolveScannedBarcode("NEW-9", "Pepsi", catalog)
    expect(r.kind).toBe("new")
    if (r.kind === "new") expect(r.nameMatches.map((p) => p.id)).toEqual([1])
  })

  it("primary barcode → existing (not alias)", () => {
    const r = resolveScannedBarcode("PRIMARY-A", "", catalog)
    expect(r.kind).toBe("existing")
    if (r.kind === "existing") { expect(r.product.id).toBe(1); expect(r.matchedAlias).toBe(false) }
  })

  it("alias barcode → existing (matchedAlias true)", () => {
    const r = resolveScannedBarcode("ALIAS-1", "", catalog)
    expect(r.kind).toBe("existing")
    if (r.kind === "existing") expect(r.matchedAlias).toBe(true)
  })
})

describe("POS-FIRST-SETUP-CATALOG-1D — commit into opening inventory", () => {
  it("new product → created at stock 0 + Opening batch (OPENING-*), Opening movement", () => {
    seed([])
    const res = commitScanSetup({ mode: "new", barcode: "NEW-1", name: "Chips", category: "Snacks", cost: 0.3, price: 0.6, openingQty: 8 })
    expect(res).toMatchObject({ ok: true, kind: "created" })

    const created = items(opsFor("product", "create")[0].payload).find((p) => p.barcode === "NEW-1")
    expect(created.stock).toBe(0)
    const batch = items(opsFor("inventory", "receive")[0].payload).find((b) => b.barcode === "NEW-1")
    expect(batch.initialQuantity).toBe(8)
    expect(batch.batchNumber).toMatch(/^OPENING-/)
    expect(batch.opening).toBe(true)

    const mv = movements().find((m) => m.quantity === 8)
    expect(mv.type).toBe("Opening")
    expect(movements().some((m) => m.type === "Receive")).toBe(false)
  })

  it("existing product → adds an Opening batch to it", () => {
    seed([base({ id: 1, name: "Pepsi", barcode: "PRIMARY-A", category: "Bev" })])
    const res = commitScanSetup({ mode: "existing", targetId: 1, barcode: "PRIMARY-A", name: "Pepsi", category: "Bev", cost: 0.4, price: 0.75, openingQty: 12 })
    expect(res).toMatchObject({ ok: true, kind: "restocked", productId: 1 })
    const batch = items(opsFor("inventory", "receive")[0].payload)[0]
    expect(batch.batchNumber).toMatch(/^OPENING-/)
    const mv = movements().find((m) => m.quantity === 12)
    expect(mv.type).toBe("Opening")
  })

  it("name-nudge alias → attaches scanned barcode to the existing product + opening qty", () => {
    seed([base({ id: 1, name: "Pepsi", barcode: "PRIMARY-A", category: "Bev" })])
    const res = commitScanSetup({ mode: "alias", targetId: 1, barcode: "NEW-ALIAS", name: "Pepsi", category: "Bev", cost: 0.4, price: 0.75, openingQty: 3 })
    expect(res).toMatchObject({ ok: true, kind: "aliased", productId: 1 })
    const aliasAdded = opsFor("product", "update").map((o) => o.payload)
      .some((p) => p.id === 1 && (p.barcodeAliases ?? []).includes("NEW-ALIAS"))
    expect(aliasAdded).toBe(true)
    const mv = movements().find((m) => m.quantity === 3)
    expect(mv.type).toBe("Opening")
  })

  it("variant row → child product + Opening batch", () => {
    seed([base({ id: 1, name: "Pepsi", barcode: "PRIMARY-A", category: "Bev" })])
    const res = commitScanSetup({ mode: "new", variantOfId: 1, variantName: "1L", barcode: "VAR-1L", name: "Pepsi 1L", category: "Bev", cost: 0.8, price: 1.5, openingQty: 6 })
    expect(res).toMatchObject({ ok: true, kind: "variant" })
    const child = items(opsFor("product", "create")[0].payload).find((p) => p.barcode === "VAR-1L")
    expect(child.parentId).toBe(1)
    const batch = items(opsFor("inventory", "receive")[0].payload).find((b) => b.barcode === "VAR-1L")
    expect(batch.batchNumber).toMatch(/^OPENING-/)
  })

  it("creates no supplier purchase order or payment, and no Receive movement", () => {
    seed([])
    commitScanSetup({ mode: "new", barcode: "NEW-1", name: "Chips", category: "Snacks", cost: 0.3, price: 0.6, openingQty: 8 })
    const entities = enqueueMock.mock.calls.map((c) => (c[0] as any).entity)
    expect(entities).not.toContain("purchase-order")
    expect(entities).not.toContain("supplier-payment")
    expect(movements().every((m) => m.type !== "Receive")).toBe(true)
  })

  it("rejects a new product whose barcode already exists", () => {
    seed([base({ id: 1, name: "Pepsi", barcode: "PRIMARY-A" })])
    const res = commitScanSetup({ mode: "new", barcode: "PRIMARY-A", name: "Imposter", category: "Bev", cost: 1, price: 2, openingQty: 5 })
    expect(res.ok).toBe(false)
  })
})
