import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Product } from "../features/pos/types/product"
import {
  parseProductImport,
  analyzeProductImport,
  commitProductImport,
  buildProductImportTemplateCsv,
  PRODUCT_IMPORT_HEADERS,
} from "../features/pos/services/import.service"

// POS-PRODUCT-ONBOARDING-1

// Capture enqueued sync ops for the commit tests.
const { enqueueMock } = vi.hoisted(() => ({ enqueueMock: vi.fn() }))
vi.mock("../features/pos/services/sync.service", () => ({
  enqueueSyncOperation: (op: unknown) => enqueueMock(op),
  assertCanWrite: () => {},
}))

const base = (over: Partial<Product>): Product => ({
  id: 0, name: "X", price: 1, cost: 0.5, stock: 5, barcode: "",
  category: "Test", accent: "emerald", barcodeAliases: [], ...over,
})
const items = (payload: unknown): any[] => (Array.isArray(payload) ? payload : [payload])
const opsFor = (entity: string, action: string) =>
  enqueueMock.mock.calls.map((c) => c[0] as any).filter((o) => o.entity === entity && o.action === action)

const HEADER = PRODUCT_IMPORT_HEADERS.join(",")

describe("POS-PRODUCT-ONBOARDING-1 — parse", () => {
  it("parses CSV with the full column set", () => {
    const { rows, error } = parseProductImport(`${HEADER}\nPepsi,A1,A2|A3,Bev,0.4,0.75,24,10,Acme,,`)
    expect(error).toBeUndefined()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ name: "Pepsi", primaryBarcode: "A1", category: "Bev", cost: 0.4, price: 0.75, openingQty: 24, reorderPoint: 10, supplier: "Acme" })
    expect(rows[0].extraBarcodes).toEqual(["A2", "A3"])
  })

  it("parses tab-separated (Excel) paste", () => {
    const { rows } = parseProductImport("Name\tPrimary Barcode\tPrice\nCola\tB1\t2")
    expect(rows[0]).toMatchObject({ name: "Cola", primaryBarcode: "B1", price: 2 })
  })

  it("errors when the header lacks required columns", () => {
    expect(parseProductImport("Foo,Bar\n1,2").error).toBeTruthy()
    expect(parseProductImport("").error).toBeTruthy()
  })
})

describe("POS-PRODUCT-ONBOARDING-1 — analyze (pure dry-run)", () => {
  const catalog = [
    base({ id: 1, name: "Pepsi", barcode: "PRIMARY-A", price: 0.75 }),
    base({ id: 2, name: "Water", barcode: "W1" }),
  ]
  const parse = (body: string) => parseProductImport(`${HEADER}\n${body}`).rows

  it("classifies a new product as create", () => {
    const plan = analyzeProductImport(parse("Chips,NEW-1,,Snacks,0.3,0.6,10,,,,"), catalog)
    expect(plan.counts.create).toBe(1)
    expect(plan.actions[0]).toMatchObject({ kind: "create", primaryBarcode: "NEW-1" })
  })

  it("classifies an existing barcode (same name) as restock/update", () => {
    const plan = analyzeProductImport(parse("Pepsi,PRIMARY-A,,Bev,0.4,0.75,12,,,,"), catalog)
    expect(plan.actions[0]).toMatchObject({ kind: "existing", targetId: 1 })
  })

  it("rejects an existing barcode with a different name as a conflict", () => {
    const plan = analyzeProductImport(parse("Totally Different,PRIMARY-A,,Bev,0.4,0.75,12,,,,"), catalog)
    expect(plan.actions[0].kind).toBe("conflict")
    expect(plan.actions[0].reason).toContain("Pepsi")
  })

  it("adds extra barcodes to an existing product as aliases", () => {
    const plan = analyzeProductImport(parse("Pepsi,PRIMARY-A,EXTRA-9,Bev,0.4,0.75,0,,,,"), catalog)
    expect(plan.actions[0]).toMatchObject({ kind: "existing", targetId: 1 })
    expect(plan.actions[0].aliases).toEqual(["EXTRA-9"])
  })

  it("rejects an extra barcode already used by another product", () => {
    const plan = analyzeProductImport(parse("Chips,NEW-2,W1,Snacks,0.3,0.6,5,,,,"), catalog)
    expect(plan.actions[0].kind).toBe("conflict")
  })

  it("creates a variant of an existing parent", () => {
    const plan = analyzeProductImport(parse("Pepsi 1L,VAR-1L,,Bev,0.8,1.5,6,,,Pepsi,1L"), catalog)
    expect(plan.actions[0]).toMatchObject({ kind: "variant", targetId: 1 })
  })

  it("rejects a variant whose parent is not found", () => {
    const plan = analyzeProductImport(parse("Fanta 1L,VAR-F,,Bev,0.8,1.5,6,,,Nonexistent,1L"), catalog)
    expect(plan.actions[0].kind).toBe("conflict")
    expect(plan.actions[0].reason).toContain("not found")
  })

  it("rejects a barcode repeated within the file", () => {
    const plan = analyzeProductImport(parse("A,DUP,,C,1,2,1,,,,\nB,DUP,,C,1,2,1,,,,"), catalog)
    expect(plan.actions[0].kind).toBe("create")
    expect(plan.actions[1].kind).toBe("conflict")
  })

  it("reports invalid rows instead of silently skipping", () => {
    const plan = analyzeProductImport(parse("NoBarcode,,,C,1,2,1,,,,\nBadCost,X1,,C,abc,2,1,,,,"), catalog)
    expect(plan.counts.invalid).toBe(2)
    expect(plan.actions.every((a) => a.kind === "invalid")).toBe(true)
  })

  it("warns (but still creates) when a new product's name already exists", () => {
    const plan = analyzeProductImport(parse("Pepsi,NEW-P,,Bev,0.4,0.75,5,,,,"), catalog)
    expect(plan.actions[0].kind).toBe("create")
    expect(plan.warnings.some((w) => w.message.includes("already exists"))).toBe(true)
  })
})

describe("POS-PRODUCT-ONBOARDING-1 — commit", () => {
  beforeEach(() => {
    enqueueMock.mockClear()
    try {
      window.localStorage.clear()
      window.localStorage.setItem("lebanonpos.suppliers.v1", "[]")
    } catch { /* jsdom */ }
  })

  const runImport = async (seed: Product[], body: string) => {
    window.localStorage.setItem("lebanonpos.products.v1", JSON.stringify(seed))
    const { rows } = parseProductImport(`${HEADER}\n${body}`)
    const plan = analyzeProductImport(rows, seed)
    return commitProductImport(plan)
  }

  it("creates a new product with opening qty without double-counting stock", async () => {
    const r = await runImport([], "Chips,NEW-1,,Snacks,0.3,0.6,10,,,,")
    expect(r.created).toBe(1)
    const created = items(opsFor("product", "create")[0].payload).find((p) => p.barcode === "NEW-1")
    expect(created.stock).toBe(0) // create at 0…
    const batch = items(opsFor("inventory", "receive")[0].payload).find((b) => b.barcode === "NEW-1")
    expect(batch.initialQuantity).toBe(10) // …receive adds the qty once
  })

  it("adds an extra barcode to an existing product via a metadata update", async () => {
    const r = await runImport([base({ id: 1, name: "Pepsi", barcode: "PRIMARY-A" })], "Pepsi,PRIMARY-A,EXTRA-9,Bev,0.4,0.75,0,,,,")
    expect(r.updated).toBe(1)
    const upd = opsFor("product", "update").map((o) => o.payload).find((p) => p.id === 1)
    expect(upd.barcodeAliases).toContain("EXTRA-9")
    // updateProduct enqueues the full product; the server strips `stock` from
    // product.update (HARDEN-2), and the alias-add never touches stock locally.
    expect(upd.stock).toBe(5)
  })
})
