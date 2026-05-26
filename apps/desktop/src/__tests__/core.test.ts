import { describe, it, expect } from "vitest"
import { productHasBarcode, productMatchesSearch } from "../features/pos/services/product.service"
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
      const today = new Date()
      const expected = today.toISOString().slice(0, 10)
      expect(getLocalDateKey()).toBe(expected)
    })
  })
})

describe("security.service", () => {
  describe("rolePermissions", () => {
    it("Admin has all permissions", () => {
      const allPermissions: Permission[] = [
        "sales.checkout",
        "sales.discount",
        "sales.refund",
        "sales.void",
        "inventory.manage",
        "customers.manage",
        "reports.view",
        "accounting.manage",
        "settings.manage",
        "staff.manage",
        "shifts.manage",
      ]
      expect(rolePermissions.Admin.sort()).toEqual(allPermissions.sort())
    })

    it("Manager has subset excluding staff.manage and settings.manage", () => {
      expect(rolePermissions.Manager).toContain("sales.checkout")
      expect(rolePermissions.Manager).toContain("inventory.manage")
      expect(rolePermissions.Manager).not.toContain("staff.manage")
      expect(rolePermissions.Manager).not.toContain("settings.manage")
    })

    it("Cashier has minimal permissions", () => {
      expect(rolePermissions.Cashier).toEqual(["sales.checkout", "customers.manage"])
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
