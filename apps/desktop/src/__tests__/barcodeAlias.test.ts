import { describe, it, expect, beforeEach } from "vitest"
import {
  detectDuplicateBarcodes,
  findProductByBarcode,
  findProductsByExactName,
  updateProduct,
  receiveProducts,
} from "../features/pos/services/product.service"
import type { Product } from "../features/pos/types/product"

// POS-BARCODE-ALIAS-1 — a product has one primary barcode plus any number of
// aliases; every matching / duplicate-detection path must respect aliases.

const STORAGE_KEY = "lebanonpos.products.v1"

function seed(products: Product[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(products))
}

const base = (over: Partial<Product>): Product => ({
  id: 0,
  name: "X",
  price: 1,
  cost: 0.5,
  stock: 5,
  barcode: "",
  category: "Test",
  accent: "emerald",
  ...over,
})

describe("POS-BARCODE-ALIAS-1 — barcode matching", () => {
  beforeEach(() => {
    try {
      window.localStorage.clear()
    } catch {
      /* jsdom always has localStorage */
    }
  })

  describe("POS scan resolution", () => {
    it("resolves a scan of the primary barcode", () => {
      seed([base({ id: 1, name: "Pepsi", barcode: "PRIMARY-A", barcodeAliases: ["ALIAS-B"] })])
      expect(findProductByBarcode("PRIMARY-A")?.name).toBe("Pepsi")
    })

    it("resolves a scan of an alias barcode", () => {
      seed([base({ id: 1, name: "Pepsi", barcode: "PRIMARY-A", barcodeAliases: ["ALIAS-B"] })])
      expect(findProductByBarcode("ALIAS-B")?.name).toBe("Pepsi")
    })
  })

  describe("detectDuplicateBarcodes", () => {
    it("flags a primary-vs-alias conflict (both products, once each)", () => {
      seed([
        base({ id: 1, name: "A", barcode: "SHARED" }),
        base({ id: 2, name: "B", barcode: "B-PRIM", barcodeAliases: ["SHARED"] }),
      ])
      expect(detectDuplicateBarcodes().map((d) => d.id).sort()).toEqual([1, 2])
    })

    it("flags an alias-vs-alias conflict", () => {
      seed([
        base({ id: 1, name: "A", barcode: "A-PRIM", barcodeAliases: ["SHARED"] }),
        base({ id: 2, name: "B", barcode: "B-PRIM", barcodeAliases: ["SHARED"] }),
      ])
      expect(detectDuplicateBarcodes().map((d) => d.id).sort()).toEqual([1, 2])
    })

    it("does not inflate counts for a 3-way primary conflict", () => {
      seed([
        base({ id: 1, name: "A", barcode: "SHARED" }),
        base({ id: 2, name: "B", barcode: "SHARED" }),
        base({ id: 3, name: "C", barcode: "SHARED" }),
      ])
      const dupes = detectDuplicateBarcodes()
      expect(dupes).toHaveLength(3)
      expect(new Set(dupes.map((d) => d.id)).size).toBe(3)
    })

    it("returns nothing when all barcodes (primary + alias) are distinct", () => {
      seed([
        base({ id: 1, name: "A", barcode: "A1", barcodeAliases: ["A2"] }),
        base({ id: 2, name: "B", barcode: "B1" }),
      ])
      expect(detectDuplicateBarcodes()).toHaveLength(0)
    })

    it("does not treat a product's own primary==alias as a conflict", () => {
      seed([base({ id: 1, name: "A", barcode: "SELF", barcodeAliases: ["SELF"] })])
      expect(detectDuplicateBarcodes()).toHaveLength(0)
    })
  })

  describe("write guards respect aliases", () => {
    it("updateProduct rejects an alias that collides with another product's alias", () => {
      seed([
        base({ id: 1, name: "Owner", barcode: "OWN", barcodeAliases: ["TAKEN"] }),
        base({ id: 2, name: "Other", barcode: "OTH" }),
      ])
      expect(updateProduct(2, { barcodeAliases: ["TAKEN"] })).toBeUndefined()
    })

    it("receiveProducts rejects a barcode already used as an ALIAS by a different product", () => {
      seed([base({ id: 1, name: "Pepsi", barcode: "PRIMARY-A", barcodeAliases: ["ALIAS-B"] })])
      const r = receiveProducts([
        { name: "Totally Different", barcode: "ALIAS-B", category: "Other", stock: 3, price: 1, cost: 0.5 },
      ])
      expect(r.rejectedCount).toBe(1)
      expect(r.errors[0]).toContain("ALIAS-B")
    })
  })

  // POS-RECEIVE-UX-1C — name-collision detection (nudge source; detection only)
  describe("findProductsByExactName", () => {
    const catalog = [
      base({ id: 1, name: "Pepsi", barcode: "A", price: 0.75 }),
      base({ id: 2, name: "Water", barcode: "B" }),
      base({ id: 3, name: "Pepsi", barcode: "C", archived: true }),
    ]

    it("matches an existing product by exact name (case/space-insensitive)", () => {
      const m = findProductsByExactName("  pepsi ", catalog)
      expect(m.map((p) => p.id)).toEqual([1]) // #3 is archived, excluded
    })

    it("returns nothing for a different name", () => {
      expect(findProductsByExactName("Cola", catalog)).toHaveLength(0)
    })

    it("excludes archived products", () => {
      const m = findProductsByExactName("Pepsi", catalog)
      expect(m.every((p) => !p.archived)).toBe(true)
      expect(m.map((p) => p.id)).toEqual([1])
    })

    it("returns nothing for an empty name", () => {
      expect(findProductsByExactName("   ", catalog)).toHaveLength(0)
    })
  })
})
