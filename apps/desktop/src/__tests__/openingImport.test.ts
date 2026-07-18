import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Product } from "../features/pos/types/product"
import {
  parseProductImport,
  analyzeProductImport,
  commitProductImport,
  summarizeOpeningStock,
  PRODUCT_IMPORT_HEADERS,
} from "../features/pos/services/import.service"

// POS-FIRST-SETUP-CATALOG-1C — guided import into Opening inventory.
const { enqueueMock } = vi.hoisted(() => ({ enqueueMock: vi.fn() }))
vi.mock("../features/pos/services/sync.service", () => ({
  enqueueSyncOperation: (op: unknown) => enqueueMock(op),
  assertCanWrite: () => {},
}))

const MOVEMENTS_KEY = "lebanonpos.stock-movements.v1"
const HEADER = PRODUCT_IMPORT_HEADERS.join(",")

const base = (over: Partial<Product>): Product => ({
  id: 0, name: "X", price: 1, cost: 0.5, stock: 5, barcode: "",
  category: "Test", accent: "emerald", barcodeAliases: [], ...over,
})
const items = (payload: unknown): any[] => (Array.isArray(payload) ? payload : [payload])
const opsFor = (entity: string, action: string) =>
  enqueueMock.mock.calls.map((c) => c[0] as any).filter((o) => o.entity === entity && o.action === action)
const movements = (): any[] => { try { return JSON.parse(window.localStorage.getItem(MOVEMENTS_KEY) ?? "[]") } catch { return [] } }

beforeEach(() => {
  enqueueMock.mockClear()
  try {
    window.localStorage.clear()
    window.localStorage.setItem("lebanonpos.suppliers.v1", "[]")
  } catch { /* jsdom */ }
})

const planFrom = (seed: Product[], body: string) => {
  window.localStorage.setItem("lebanonpos.products.v1", JSON.stringify(seed))
  const { rows } = parseProductImport(`${HEADER}\n${body}`)
  return analyzeProductImport(rows, seed)
}

describe("POS-FIRST-SETUP-CATALOG-1C — preview is a pure dry-run", () => {
  it("analyze + summarizeOpeningStock do not mutate storage or enqueue", () => {
    const plan = planFrom([], "Chips,NEW-1,,Snacks,0.3,0.6,10,,,,\nCola,NEW-2,,Bev,0.5,1,4,,,,")
    const before = enqueueMock.mock.calls.length
    const s = summarizeOpeningStock(plan)
    expect(s.units).toBe(14)
    expect(s.lines).toBe(2)
    expect(s.value).toBeCloseTo(10 * 0.3 + 4 * 0.5)
    // No batches / movements written by preview.
    expect(window.localStorage.getItem("lebanonpos.inventory-batches.v1")).toBeNull()
    expect(movements()).toHaveLength(0)
    expect(enqueueMock.mock.calls.length).toBe(before)
  })
})

describe("POS-FIRST-SETUP-CATALOG-1C — opening commit", () => {
  it("new product with opening qty → product created at 0 + Opening batch (OPENING-*), no double count", () => {
    const plan = planFrom([], "Chips,NEW-1,,Snacks,0.3,0.6,10,,,,")
    const r = commitProductImport(plan, { opening: true })
    expect(r.created).toBe(1)

    const created = items(opsFor("product", "create")[0].payload).find((p) => p.barcode === "NEW-1")
    expect(created.stock).toBe(0)

    const batch = items(opsFor("inventory", "receive")[0].payload).find((b) => b.barcode === "NEW-1")
    expect(batch.initialQuantity).toBe(10)
    expect(batch.batchNumber).toMatch(/^OPENING-/)
    expect(batch.opening).toBe(true)
  })

  it("movement type is Opening, not Receive", () => {
    const plan = planFrom([], "Chips,NEW-1,,Snacks,0.3,0.6,10,,,,")
    commitProductImport(plan, { opening: true })
    const mv = movements().find((m) => m.quantity === 10)
    expect(mv.type).toBe("Opening")
    expect(movements().some((m) => m.type === "Receive")).toBe(false)
  })

  it("variant row creates a child + Opening batch", () => {
    const plan = planFrom([base({ id: 1, name: "Pepsi", barcode: "PRIMARY-A" })], "Pepsi 1L,VAR-1L,,Bev,0.8,1.5,6,,,Pepsi,1L")
    const r = commitProductImport(plan, { opening: true })
    expect(r.created).toBe(1)
    const child = items(opsFor("product", "create")[0].payload).find((p) => p.barcode === "VAR-1L")
    expect(child.parentId).toBe(1)
    const batch = items(opsFor("inventory", "receive")[0].payload).find((b) => b.barcode === "VAR-1L")
    expect(batch.batchNumber).toMatch(/^OPENING-/)
    const mv = movements().find((m) => m.quantity === 6)
    expect(mv.type).toBe("Opening")
  })

  it("existing barcode row adds an alias and books opening qty as an Opening movement", () => {
    const plan = planFrom([base({ id: 1, name: "Pepsi", barcode: "PRIMARY-A", category: "Bev" })], "Pepsi,PRIMARY-A,EXTRA-9,Bev,0.4,0.75,12,,,,")
    expect(plan.actions[0]).toMatchObject({ kind: "existing", targetId: 1, aliases: ["EXTRA-9"] })
    commitProductImport(plan, { opening: true })
    const aliasAdded = opsFor("product", "update").map((o) => o.payload)
      .some((p) => p.id === 1 && (p.barcodeAliases ?? []).includes("EXTRA-9"))
    expect(aliasAdded).toBe(true)
    const mv = movements().find((m) => m.quantity === 12)
    expect(mv.type).toBe("Opening")
  })

  it("conflicts and invalid rows never commit", () => {
    const plan = planFrom(
      [base({ id: 1, name: "Pepsi", barcode: "PRIMARY-A" })],
      "Totally Different,PRIMARY-A,,Bev,0.4,0.75,12,,,,\nNoBarcode,,,C,1,2,1,,,,",
    )
    const r = commitProductImport(plan, { opening: true })
    expect(r.created).toBe(0)
    expect(r.updated).toBe(0)
    expect(opsFor("inventory", "receive")).toHaveLength(0)
    expect(movements()).toHaveLength(0)
  })

  it("creates no supplier purchase order or payment", () => {
    const plan = planFrom([], "Chips,NEW-1,,Snacks,0.3,0.6,10,,Acme Distributors,,")
    commitProductImport(plan, { opening: true })
    expect(opsFor("purchase-order", "create")).toHaveLength(0)
    expect(enqueueMock.mock.calls.map((c) => c[0] as any).some((o) => o.entity === "purchase-order")).toBe(false)
    expect(enqueueMock.mock.calls.map((c) => c[0] as any).some((o) => o.entity === "supplier-payment")).toBe(false)
  })
})

describe("POS-FIRST-SETUP-CATALOG-1C — daily import path unchanged", () => {
  it("default commit (no opening flag) still books a Receive movement with a LOT-* batch", () => {
    const plan = planFrom([], "Chips,NEW-1,,Snacks,0.3,0.6,10,,,,")
    commitProductImport(plan) // no opts → daily behavior
    const batch = items(opsFor("inventory", "receive")[0].payload).find((b) => b.barcode === "NEW-1")
    expect(batch.batchNumber).toMatch(/^LOT-/)
    expect(batch.opening).toBeUndefined()
    const mv = movements().find((m) => m.quantity === 10)
    expect(mv.type).toBe("Receive")
  })
})
