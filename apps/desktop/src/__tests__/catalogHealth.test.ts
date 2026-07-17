import { describe, it, expect } from "vitest"
import { analyzeCatalog } from "../features/pos/lib/catalogHealth"
import type { Product } from "../features/pos/types/product"

// POS-PRODUCT-CATALOG-CLEANUP-1
const base = (over: Partial<Product>): Product => ({
  id: 0, name: "X", price: 1, cost: 0.5, stock: 5, barcode: "B" + Math.random(),
  category: "Test", accent: "emerald", barcodeAliases: [], image: "img", ...over,
})

describe("POS-PRODUCT-CATALOG-CLEANUP-1 — analyzeCatalog", () => {
  it("detects duplicate names and flags same-price groups as alias candidates", () => {
    const h = analyzeCatalog([
      base({ id: 1, name: "Pepsi", price: 0.75, barcode: "A" }),
      base({ id: 2, name: "pepsi ", price: 0.75, barcode: "B" }), // case/space-insensitive
    ])
    expect(h.counts.duplicateNames).toBe(1)
    expect(h.duplicateNames[0].samePrice).toBe(true)
    expect(h.duplicateNames[0].suggestion).toBe("alias")
    expect(h.counts.possibleAliases).toBe(1)
    expect(h.counts.possibleVariants).toBe(0)
  })

  it("flags same-name different-price groups as variant candidates", () => {
    const h = analyzeCatalog([
      base({ id: 1, name: "Pepsi", price: 0.75, barcode: "A" }),
      base({ id: 2, name: "Pepsi", price: 1.5, barcode: "B" }),
    ])
    expect(h.duplicateNames[0].samePrice).toBe(false)
    expect(h.duplicateNames[0].suggestion).toBe("variant")
    expect(h.counts.possibleVariants).toBe(1)
  })

  it("does not treat legitimate variants (parentId set) as duplicate names", () => {
    const h = analyzeCatalog([
      base({ id: 1, name: "Pepsi", isParent: true, barcode: "A" }),
      base({ id: 2, name: "Pepsi", parentId: 1, variantName: "1L", barcode: "B" }),
      base({ id: 3, name: "Pepsi", parentId: 1, variantName: "330ml", barcode: "C" }),
    ])
    expect(h.counts.duplicateNames).toBe(0)
  })

  it("detects barcode conflicts across primary and aliases", () => {
    const h = analyzeCatalog([
      base({ id: 1, name: "A", barcode: "SHARED" }),
      base({ id: 2, name: "B", barcode: "B-PRIM", barcodeAliases: ["SHARED"] }),
      base({ id: 3, name: "C", barcode: "C-ONLY" }),
    ])
    expect(h.counts.barcodeConflicts).toBe(2)
    expect(h.barcodeConflicts.map((x) => x.id).sort()).toEqual([1, 2])
  })

  it("counts missing barcode / image / category (active only)", () => {
    const h = analyzeCatalog([
      base({ id: 1, name: "NoImg", barcode: "A", image: undefined }),
      base({ id: 2, name: "NoBc", barcode: "" }),
      base({ id: 3, name: "NoCat", barcode: "C", category: "" }),
      base({ id: 4, name: "Archived", barcode: "", image: undefined, category: "", archived: true }),
    ])
    expect(h.counts.missingImage).toBe(1)
    expect(h.counts.missingBarcode).toBe(1)
    expect(h.counts.uncategorized).toBe(1)
  })

  it("detects orphan variants (missing or archived parent)", () => {
    const h = analyzeCatalog([
      base({ id: 1, name: "Parent", archived: true, barcode: "A" }),
      base({ id: 2, name: "ChildOfArchived", parentId: 1, barcode: "B" }),
      base({ id: 3, name: "ChildOfMissing", parentId: 999, barcode: "C" }),
    ])
    expect(h.counts.orphanVariants).toBe(2)
    expect(h.orphanVariants.map((o) => o.reason).sort()).toEqual(["archived", "missing"])
  })

  it("does not mutate the input during analysis", () => {
    const input = [
      base({ id: 1, name: "Pepsi", price: 0.75, barcode: "A" }),
      base({ id: 2, name: "Pepsi", price: 0.75, barcode: "B" }),
    ]
    const snapshot = JSON.parse(JSON.stringify(input))
    analyzeCatalog(input)
    expect(input).toEqual(snapshot)
  })
})
