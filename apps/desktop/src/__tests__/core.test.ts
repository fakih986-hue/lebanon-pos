import { describe, it, expect } from "vitest"
import { productHasBarcode, productMatchesSearch, getLowStockProducts, getNoBarcodeProducts, sortProducts, filterByStockStatus, filterByCategory, filterBySupplier, validateReceiveRow, parseSpreadsheetPaste } from "../features/pos/services/product.service"
import { getLocalDateKey } from "../features/pos/services/dailyClose.service"
import { userCan, rolePermissions, type StaffUser, type Permission } from "../features/pos/services/security.service"
import type { Product } from "../features/pos/types/product"

describe("product.service", () => {
  const baseProduct: Product = {
    id: 1,
    name: "Lebanese Coffee",
    price: 1.5,
    cost: 0.55,
    stock: 84,
    barcode: "528100100001",
    category: "Beverages",
    accent: "emerald",
  }

  describe("productHasBarcode", () => {
    it("matches exact barcode", () => {
      expect(productHasBarcode(baseProduct, "528100100001")).toBe(true)
    })

    it("matches after trimming whitespace", () => {
      expect(productHasBarcode(baseProduct, "  528100100001  ")).toBe(true)
    })

    it("returns false for non-matching barcode", () => {
      expect(productHasBarcode(baseProduct, "528100100002")).toBe(false)
    })

    it("matches alias barcodes", () => {
      const product = { ...baseProduct, barcodeAliases: ["alias-1", "alias-2"] }
      expect(productHasBarcode(product, "alias-1")).toBe(true)
      expect(productHasBarcode(product, "alias-2")).toBe(true)
    })

    it("returns false for empty barcode", () => {
      expect(productHasBarcode(baseProduct, "")).toBe(false)
    })

    it("returns false when product has no barcode", () => {
      expect(productHasBarcode({ ...baseProduct, barcode: "" }, "anything")).toBe(false)
    })
  })

  describe("productMatchesSearch", () => {
    it("matches by name", () => {
      expect(productMatchesSearch(baseProduct, "Coffee")).toBe(true)
    })

    it("matches by barcode", () => {
      expect(productMatchesSearch(baseProduct, "528100100001")).toBe(true)
    })

    it("is case insensitive", () => {
      expect(productMatchesSearch(baseProduct, "lebanese coffee")).toBe(true)
    })

    it("returns true for empty query", () => {
      expect(productMatchesSearch(baseProduct, "")).toBe(true)
    })

    it("returns false for no match", () => {
      expect(productMatchesSearch(baseProduct, "Pizza")).toBe(false)
    })
  })

  describe("getLowStockProducts", () => {
    it("returns products at or below reorder point", () => {
      const products: Product[] = [
        { ...baseProduct, id: 1, stock: 5, reorderPoint: 10 },
        { ...baseProduct, id: 2, stock: 20, reorderPoint: 10 },
        { ...baseProduct, id: 3, stock: 0, reorderPoint: 10 },
      ]
      const result = getLowStockProducts(products)
      expect(result.map(p => p.id)).toEqual([1, 3])
    })

    it("excludes archived products", () => {
      const products: Product[] = [
        { ...baseProduct, id: 1, stock: 5, reorderPoint: 10, archived: true },
        { ...baseProduct, id: 2, stock: 5, reorderPoint: 10, archived: false },
      ]
      const result = getLowStockProducts(products)
      expect(result.map(p => p.id)).toEqual([2])
    })
  })

  describe("getNoBarcodeProducts", () => {
    it("returns products without barcode", () => {
      const products: Product[] = [
        { ...baseProduct, id: 1, barcode: "123" },
        { ...baseProduct, id: 2, barcode: "" },
        { ...baseProduct, id: 3, barcode: "" },
      ]
      const result = getNoBarcodeProducts(products)
      expect(result.map(p => p.id)).toEqual([2, 3])
    })
  })

  describe("sortProducts", () => {
    const products: Product[] = [
      { ...baseProduct, id: 1, name: "Apple", stock: 50, category: "Fruit", price: 2, cost: 1 },
      { ...baseProduct, id: 2, name: "Banana", stock: 10, category: "Fruit", price: 1.5, cost: 0.8 },
      { ...baseProduct, id: 3, name: "Croissant", stock: 30, category: "Bakery", price: 3, cost: 1.2 },
    ]

    it("sorts by name ascending", () => {
      const sorted = sortProducts(products, "name", "asc")
      expect(sorted.map(p => p.id)).toEqual([1, 2, 3])
    })

    it("sorts by name descending", () => {
      const sorted = sortProducts(products, "name", "desc")
      expect(sorted.map(p => p.id)).toEqual([3, 2, 1])
    })

    it("sorts by stock ascending", () => {
      const sorted = sortProducts(products, "stock", "asc")
      expect(sorted.map(p => p.id)).toEqual([2, 3, 1])
    })

    it("sorts by margin descending", () => {
      const sorted = sortProducts(products, "margin", "desc")
      const margins = sorted.map(p => p.price - p.cost)
      expect(margins[0]).toBe(1.8) // Croissant
      expect(margins[2]).toBe(0.7) // Banana
    })
  })

  describe("filterByStockStatus", () => {
    const products: Product[] = [
      { ...baseProduct, id: 1, stock: 0, reorderPoint: 10 },
      { ...baseProduct, id: 2, stock: 5, reorderPoint: 10 },
      { ...baseProduct, id: 3, stock: 30, reorderPoint: 10 },
    ]

    it("filters out-of-stock", () => {
      expect(filterByStockStatus(products, "out").map(p => p.id)).toEqual([1])
    })

    it("filters low stock", () => {
      expect(filterByStockStatus(products, "low").map(p => p.id)).toEqual([2])
    })

    it("filters ok stock", () => {
      expect(filterByStockStatus(products, "ok").map(p => p.id)).toEqual([3])
    })

    it("excludes archived", () => {
      const p = [...products, { ...baseProduct, id: 4, stock: 0, reorderPoint: 10, archived: true }]
      expect(filterByStockStatus(p, "out").map(x => x.id)).toEqual([1])
    })
  })

  describe("filterByCategory", () => {
    it("filters by normalized category (whitespace-tolerant, case-sensitive)", () => {
      const products: Product[] = [
        { ...baseProduct, id: 1, category: "Beverages" },
        { ...baseProduct, id: 2, category: "  Beverages  " },
        { ...baseProduct, id: 3, category: "Bakery" },
      ]
      expect(filterByCategory(products, "Beverages").map(p => p.id)).toEqual([1, 2])
    })

    it("does not match different case", () => {
      const products: Product[] = [
        { ...baseProduct, id: 1, category: "Beverages" },
        { ...baseProduct, id: 2, category: "beverages" },
      ]
      expect(filterByCategory(products, "Beverages").map(p => p.id)).toEqual([1])
    })
  })

  describe("validateReceiveRow", () => {
    it("validates complete row", () => {
      const v = validateReceiveRow({ name: "Cola", barcode: "123", quantity: 10, cost: 1, price: 2 })
      expect(v.valid).toBe(true)
      expect(v.errors).toHaveLength(0)
    })

    it("flags missing name", () => {
      const v = validateReceiveRow({ name: "", barcode: "123", quantity: 10 })
      expect(v.valid).toBe(false)
      expect(v.errors).toContain("Name required")
    })

    it("flags missing barcode", () => {
      const v = validateReceiveRow({ name: "Cola", barcode: "", quantity: 10 })
      expect(v.valid).toBe(false)
      expect(v.errors).toContain("Barcode required")
    })

    it("flags zero quantity", () => {
      const v = validateReceiveRow({ name: "Cola", barcode: "123", quantity: 0 })
      expect(v.valid).toBe(false)
      expect(v.errors).toContain("Quantity must be > 0")
    })

    it("warns when cost exceeds price", () => {
      const v = validateReceiveRow({ name: "Cola", barcode: "123", quantity: 10, cost: 5, price: 3 })
      expect(v.valid).toBe(true)
      expect(v.warnings).toContain("Cost exceeds price")
    })
  })

  describe("parseSpreadsheetPaste", () => {
    it("parses tab-separated rows", () => {
      const result = parseSpreadsheetPaste("Cola\t123\tBeverages\t10\t1\t2\nBread\t456\tBakery\t5\t2\t3")
      expect(result.rows).toHaveLength(2)
      expect(result.rejected).toHaveLength(0)
      expect(result.rows[0].name).toBe("Cola")
      expect(result.rows[0].quantity).toBe(10)
    })

    it("parses comma-separated rows", () => {
      const result = parseSpreadsheetPaste("Cola,123,Beverages,10,1,2")
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].barcode).toBe("123")
    })

    it("rejects rows with missing name", () => {
      const result = parseSpreadsheetPaste(",123,Beverages,10,1,2")
      expect(result.rejected).toHaveLength(1)
      expect(result.rows).toHaveLength(0)
    })

    it("rejects rows with invalid quantity", () => {
      const result = parseSpreadsheetPaste("Cola\t123\tBeverages\t0\t1\t2")
      expect(result.rejected).toHaveLength(1)
    })
  })
})

describe("dailyClose.service", () => {
  describe("getLocalDateKey", () => {
    it("formats date as yyyy-MM-dd", () => {
      const date = new Date(2026, 4, 15)
      expect(getLocalDateKey(date)).toBe("2026-05-15")
    })

    it("zero-pads month and day", () => {
      const date = new Date(2026, 0, 5)
      expect(getLocalDateKey(date)).toBe("2026-01-05")
    })

    it("uses current date when no argument", () => {
      // Build expected from LOCAL date parts — toISOString() is UTC and
      // mismatches after local midnight in UTC+ timezones (e.g. Beirut).
      const today = new Date()
      const expected = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`
      expect(getLocalDateKey()).toBe(expected)
    })
  })
})

describe("security.service", () => {
  describe("rolePermissions", () => {
    it("Admin has all permissions", () => {
      expect(rolePermissions.Admin).toEqual(
        expect.arrayContaining(["sales.checkout", "sales.discount", "sales.refund", "sales.void", "inventory.manage", "customers.manage", "reports.view", "accounting.manage", "settings.manage", "staff.manage", "shifts.manage", "delivery.manage"])
      )
    })

    it("Manager has subset excluding staff.manage and settings.manage", () => {
      expect(rolePermissions.Manager).toContain("sales.checkout")
      expect(rolePermissions.Manager).toContain("inventory.manage")
      expect(rolePermissions.Manager).not.toContain("staff.manage")
      expect(rolePermissions.Manager).not.toContain("settings.manage")
    })

    it("Cashier has minimal permissions", () => {
      // Sprint 5 tightened Cashier to checkout-only (customers.manage removed)
      expect(rolePermissions.Cashier).toEqual(["sales.checkout"])
    })
  })

  describe("userCan", () => {
    const adminUser: StaffUser = {
      id: "u1", name: "Admin", mobile: "000", pin: "...", role: "Admin",
      active: true, createdAt: "2026-01-01",
    }
    const cashierUser: StaffUser = {
      id: "u2", name: "Cashier", mobile: "111", pin: "...", role: "Cashier",
      active: true, createdAt: "2026-01-01",
    }

    it("admin can checkout", () => {
      expect(userCan("sales.checkout", adminUser)).toBe(true)
    })

    it("admin can manage staff", () => {
      expect(userCan("staff.manage", adminUser)).toBe(true)
    })

    it("cashier can checkout", () => {
      expect(userCan("sales.checkout", cashierUser)).toBe(true)
    })

    it("cashier cannot manage inventory", () => {
      expect(userCan("inventory.manage", cashierUser)).toBe(false)
    })

    it("cashier cannot manage settings", () => {
      expect(userCan("settings.manage", cashierUser)).toBe(false)
    })
  })
})

describe("sales.service (pure)", () => {
  it("getPaymentMix categorizes sales by payment method", async () => {
    const { getPaymentMix } = await import("../features/pos/services/sales.service")
    const mix = getPaymentMix()
    expect(typeof mix).toBe("object")
    Object.entries(mix).forEach(([method, total]) => {
      expect(typeof total).toBe("number")
      expect(["Cash", "Card", "Debt", "Wallet"]).toContain(method)
    })
  })

  it("getTopProducts returns sorted products with correct shape", async () => {
    const { getTopProducts } = await import("../features/pos/services/sales.service")
    const top = getTopProducts(3)
    expect(Array.isArray(top)).toBe(true)
    top.forEach((item) => {
      expect(item).toHaveProperty("name")
      expect(item).toHaveProperty("quantity")
      expect(item).toHaveProperty("total")
    })
    if (top.length > 1) {
      for (let i = 1; i < top.length; i++) {
        expect(top[i - 1].quantity).toBeGreaterThanOrEqual(top[i].quantity)
      }
    }
  })
})

describe("supplier.service — types and safety", () => {
  it("ReceiveResult has correct shape", async () => {
    const { receiveProducts } = await import("../features/pos/services/product.service")
    // verify the type exports and function signature
    expect(typeof receiveProducts).toBe("function")
    const result = receiveProducts([])
    expect(result).toBeDefined()
    expect(result).toHaveProperty("acceptedCount")
    expect(result).toHaveProperty("rejectedCount")
    expect(result).toHaveProperty("errors")
    expect(result).toHaveProperty("newlyCreated")
    expect(result).toHaveProperty("modifiedExisting")
    expect(result).toHaveProperty("batchesCreated")
    expect(result.acceptedCount).toBe(0)
    expect(result.rejectedCount).toBe(0)
    expect(result.batchesCreated).toBe(0)
  })

  it("validateReceiveRow catches invalid receiving entries", async () => {
    const { validateReceiveRow } = await import("../features/pos/services/product.service")
    const v = validateReceiveRow({ name: "", barcode: "", quantity: 0 })
    expect(v.valid).toBe(false)
    expect(v.errors.length).toBeGreaterThanOrEqual(2)
  })

  it("ReceivingContext type exports from supplier service", async () => {
    const mod = await import("../features/pos/services/supplier.service")
    expect(typeof mod.receiveAndRecord).toBe("function")
    expect(typeof mod.recordSupplierPayment).toBe("function")
    expect(typeof mod.recordPurchaseOrder).toBe("function")
    expect(typeof mod.getSupplierLedger).toBe("function")
  })
})
