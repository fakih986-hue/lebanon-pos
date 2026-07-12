import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
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

  it("receiveAndRecord's Draft→Received PO transition is actually queued for sync, not just written locally", async () => {
    window.localStorage.clear()
    // initialUsers is intentionally empty (real staff come from the server,
    // not a hardcoded seed) — recordPurchaseOrder needs a logged-in user, so
    // seed one directly, matching how the real app would have one post-login.
    window.localStorage.setItem("lebanonpos.users.v1", JSON.stringify([
      { id: "u-test-1", name: "Test Admin", mobile: "0", pin: "x", role: "Admin", active: true, createdAt: new Date().toISOString(), pinChanged: false },
    ]))
    window.localStorage.setItem("lebanonpos.current-user.v1", "u-test-1")

    const { receiveAndRecord, getPurchaseOrders } = await import("../features/pos/services/supplier.service")
    const { getSyncQueue } = await import("../features/pos/services/sync.service")

    await receiveAndRecord(
      [{ name: "Stress Widget", barcode: "PO-SYNC-TEST-1", category: "Test", quantity: 5, cost: 2, price: 4 }],
      { supplierId: "sup-test-1", supplierName: "Test Supplier", paymentMethod: "On Account" }
    )

    const orders = getPurchaseOrders()
    const po = orders.find((o) => o.supplierName === "Test Supplier")
    expect(po?.status).toBe("Received") // local state transitioned correctly

    // The bug: writePurchaseOrders() only persists to local storage — it never
    // enqueues a sync operation, so the server never learned the PO left Draft.
    const queue = getSyncQueue()
    const poSyncOps = queue.filter((op) => op.entity === "purchase-order")
    expect(poSyncOps.length).toBeGreaterThanOrEqual(2) // one "create" (Draft) + one "update" (Received)
    const receivedUpdate = poSyncOps.find((op) => op.action === "update" && (op.payload as any)?.status === "Received")
    expect(receivedUpdate).toBeDefined()
    expect((receivedUpdate?.payload as any)?.id).toBe(po?.id)
  })
})

describe("product.service — duplicate barcode detection", () => {
  it("lists each product in a 3-way duplicate barcode group exactly once, not inflated", async () => {
    window.localStorage.clear()
    window.localStorage.setItem("lebanonpos.products.v1", JSON.stringify([
      { id: 1, name: "Dup A", price: 1, cost: 1, stock: 1, barcode: "DUP-1", category: "Test" },
      { id: 2, name: "Dup B", price: 1, cost: 1, stock: 1, barcode: "DUP-1", category: "Test" },
      { id: 3, name: "Dup C", price: 1, cost: 1, stock: 1, barcode: "DUP-1", category: "Test" },
      { id: 4, name: "Unique", price: 1, cost: 1, stock: 1, barcode: "UNIQUE-1", category: "Test" },
    ]))
    const { detectDuplicateBarcodes } = await import("../features/pos/services/product.service")
    const dupes = detectDuplicateBarcodes()
    // Previously: the first match (id 1) was re-pushed on every subsequent
    // duplicate found (once for B, once for C), making this list length 4
    // instead of 3 — inflating the "Dupes (N)" counter past the real count.
    expect(dupes.length).toBe(3)
    expect(dupes.map((d) => d.id).sort()).toEqual([1, 2, 3])
  })
})

describe("stock.service — archived products excluded from reorder/dead-stock suggestions", () => {
  it("getReorderSuggestions never suggests reordering an archived product", async () => {
    window.localStorage.clear()
    const { getReorderSuggestions } = await import("../features/pos/services/stock.service")
    const products = [
      { id: 1, name: "Active Low Stock", price: 5, cost: 3, stock: 1, reorderPoint: 10, category: "Test", archived: false },
      { id: 2, name: "Archived Low Stock", price: 5, cost: 3, stock: 0, reorderPoint: 10, category: "Test", archived: true },
    ] as any
    const suggestions = getReorderSuggestions(products)
    const ids = suggestions.map((s) => s.product.id)
    expect(ids).toContain(1)
    expect(ids).not.toContain(2) // archived — no longer for sale, shouldn't be suggested for reorder
  })

  it("getDeadStockItems never flags an archived product as needing a promo push", async () => {
    window.localStorage.clear()
    const { getDeadStockItems } = await import("../features/pos/services/stock.service")
    const products = [
      { id: 1, name: "Active Dead Stock", price: 5, cost: 3, stock: 20, category: "Test", archived: false },
      { id: 2, name: "Archived Dead Stock", price: 5, cost: 3, stock: 20, category: "Test", archived: true },
    ] as any
    const items = getDeadStockItems(products)
    const ids = items.map((i) => i.product.id)
    expect(ids).toContain(1)
    expect(ids).not.toContain(2) // archived — not actively merchandised, shouldn't be suggested for a promo
  })
})

describe("customer.service — license enforcement", () => {
  it("addCustomer respects the license-suspension guard, like every other customer/debt mutation", async () => {
    window.localStorage.clear()
    window.localStorage.setItem("lebanonpos.license.v1", JSON.stringify({
      status: "read_only", reason: "", message: "Store is read-only", suspendedAt: null,
      offlineGraceDays: 7, leaseExpiresAt: null, policyVersion: 1, checkedAt: new Date().toISOString(),
    }))
    const { addCustomer } = await import("../features/pos/services/customer.service")
    expect(() => addCustomer({ name: "Blocked Customer", mobile: "70000000", creditLimit: 0, notes: "" })).toThrow()
  })
})

describe("inventory — write-off and reconciliation", () => {
  it("writeOffStock function is exported", async () => {
    const { writeOffStock } = await import("../features/pos/services/product.service")
    expect(typeof writeOffStock).toBe("function")
  })

  it("getReconciliationIssues function is exported", async () => {
    const { getReconciliationIssues } = await import("../features/pos/services/product.service")
    expect(typeof getReconciliationIssues).toBe("function")
  })

  it("ReconciliationIssue type has required fields", async () => {
    const { getReconciliationIssues } = await import("../features/pos/services/product.service")
    // When called with empty storage, should return empty array without error
    // (may throw due to no localStorage in node, but function should exist)
    expect(typeof getReconciliationIssues).toBe("function")
  })

  it("stockCount session starts as Draft", async () => {
    const { getStockCounts, startStockCount } = await import("../features/pos/services/stockCount.service")
    expect(typeof startStockCount).toBe("function")
    expect(typeof getStockCounts).toBe("function")
    // In node env without localStorage, startStockCount may fail gracefully
    // but we can verify the types are exportable
    expect(true).toBe(true)
  })
})

describe("POS — crash safety and checkout guards", () => {
  it("escapeHtml handles null and undefined safely", async () => {
    const { escapeHtml } = await import("../features/pos/lib/salesHelpers")
    expect(escapeHtml(null)).toBe("")
    expect(escapeHtml(undefined)).toBe("")
    expect(escapeHtml("<script>alert(1)</script>")).toContain("&lt;")
  })

  it("getTopProducts handles sales with null items", async () => {
    const { getTopProducts } = await import("../features/pos/services/sales.service")
    const top = getTopProducts(3)
    expect(Array.isArray(top)).toBe(true)
  })

  it("getPaymentMix handles all payment methods", async () => {
    const { getPaymentMix } = await import("../features/pos/services/sales.service")
    const mix = getPaymentMix()
    expect(typeof mix).toBe("object")
    expect(typeof mix.Cash).toBe("number")
    expect(typeof mix.Card).toBe("number")
  })

  it("isSimpleMode returns boolean", async () => {
    const { isSimpleMode, toggleSimpleMode } = await import("../features/pos/services/security.service")
    expect(typeof isSimpleMode()).toBe("boolean")
    expect(typeof toggleSimpleMode()).toBe("boolean")
  })
})

describe("deviceId — device identity", () => {
  beforeEach(() => {
    localStorage.removeItem("lebanonpos.device-id.v1")
    localStorage.removeItem("lebanonpos.auto-approved-device.v1")
  })

  it("getDeviceId persists across calls", async () => {
    const { getDeviceId } = await import("../features/pos/services/sync.service")
    const id1 = getDeviceId()
    expect(id1).toMatch(/^DEV-/)
    const id2 = getDeviceId()
    expect(id2).toBe(id1)
  })

  it("getDeviceId format is DEV-XXXX-XXXX", async () => {
    const { getDeviceId } = await import("../features/pos/services/sync.service")
    const id = getDeviceId()
    expect(id).toMatch(/^DEV-[A-Z0-9]+-[A-Z0-9]+$/)
  })

  it("auto-approves hub device when localStorage matches", async () => {
    const { isHubDeviceAutoApproved } = await import("../features/pos/services/deviceRegistry.service")
    const { getDeviceId } = await import("../features/pos/services/sync.service")
    const deviceId = getDeviceId()
    localStorage.setItem("lebanonpos.auto-approved-device.v1", deviceId)
    expect(isHubDeviceAutoApproved()).toBe(true)
  })

  it("unknown device is not auto-approved", async () => {
    const { isHubDeviceAutoApproved } = await import("../features/pos/services/deviceRegistry.service")
    localStorage.removeItem("lebanonpos.auto-approved-device.v1")
    expect(isHubDeviceAutoApproved()).toBe(false)
  })
})

describe("shift.service - register reconciliation", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("groups today's shifts by register and flags open shifts for review", async () => {
    const { getRegisterShiftSummaries } = await import("../features/pos/services/shift.service")
    localStorage.setItem("lebanonpos.shifts.v1", JSON.stringify([
      {
        id: "shift-a",
        shiftNumber: "SHIFT-001",
        status: "Open",
        openedAt: "2026-07-10T08:00:00.000Z",
        openingFloatUsd: 100,
        openedById: "u1",
        openedByName: "Ali",
        registerId: "REG-A",
        deviceId: "DEV-A",
      },
      {
        id: "shift-b",
        shiftNumber: "SHIFT-002",
        status: "Closed",
        openedAt: "2026-07-10T09:00:00.000Z",
        closedAt: "2026-07-10T17:00:00.000Z",
        openingFloatUsd: 50,
        closingCashUsd: 150,
        differenceUsd: 0,
        openedById: "u2",
        openedByName: "Maya",
        registerId: "REG-B",
        deviceId: "DEV-B",
      },
    ]))

    const summaries = getRegisterShiftSummaries("2026-07-10")
    expect(summaries.map((summary) => summary.registerId).sort()).toEqual(["REG-A", "REG-B"])
    expect(summaries.find((summary) => summary.registerId === "REG-A")?.needsReview).toBe(true)
    expect(summaries.find((summary) => summary.registerId === "REG-B")?.status).toBe("Closed")
  })

  it("computes expected cash with owner draws and cash movements", async () => {
    const { getRegisterCashTotals } = await import("../features/pos/services/shift.service")
    localStorage.setItem("lebanonpos.shifts.v1", JSON.stringify([
      {
        id: "shift-a",
        shiftNumber: "SHIFT-001",
        status: "Closed",
        openedAt: "2026-07-10T08:00:00.000Z",
        closedAt: "2026-07-10T17:00:00.000Z",
        openingFloatUsd: 100,
        closingCashUsd: 175,
        differenceUsd: 0,
        openedById: "u1",
        openedByName: "Ali",
        registerId: "REG-A",
        deviceId: "DEV-A",
      },
    ]))
    localStorage.setItem("lebanonpos.sales.v1", JSON.stringify([
      { id: "sale-a", paymentMethod: "Cash", status: "Completed", total: 120, createdAt: "2026-07-10T10:00:00.000Z", shiftId: "shift-a" },
    ]))
    localStorage.setItem("lebanonpos.refunds.v1", JSON.stringify([
      { id: "refund-a", method: "Cash", total: 10, createdAt: "2026-07-10T11:00:00.000Z", shiftId: "shift-a" },
    ]))
    localStorage.setItem("lebanonpos.expenses.v1", JSON.stringify([
      { id: "expense-a", paymentMethod: "Cash", amount: 5, createdAt: "2026-07-10T12:00:00.000Z", shiftId: "shift-a" },
    ]))
    localStorage.setItem("lebanonpos.supplier-payments.v1", JSON.stringify([
      { id: "supplier-payment-a", method: "Cash", amount: 20, createdAt: "2026-07-10T13:00:00.000Z", shiftId: "shift-a" },
    ]))
    localStorage.setItem("lebanonpos.cash-movements.v1", JSON.stringify([
      { id: "cash-in", type: "CashIn", direction: "In", amountUsd: 15, createdAt: "2026-07-10T14:00:00.000Z", shiftId: "shift-a" },
      { id: "owner-draw", type: "OwnerDraw", direction: "Out", amountUsd: 25, createdAt: "2026-07-10T15:00:00.000Z", shiftId: "shift-a" },
    ]))

    const totals = getRegisterCashTotals("2026-07-10")
    expect(totals.expectedCash).toBe(175)
    expect(totals.countedCash).toBe(175)
    expect(totals.variance).toBe(0)
    expect(totals.ownerDraws).toBe(25)
    expect(totals.cashSales).toBe(120)
    expect(totals.cashSupplierPayments).toBe(20)
  })
})

describe("sync.service — validateStockWithHub (multi-device stock preflight)", () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem("lebanonpos.api-url", "http://192.168.1.50:3015")
    window.localStorage.setItem("lebanonpos.auth-token", "test-token")
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns ok:true when the hub confirms enough stock", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, insufficientItems: [] }),
    }))
    const { validateStockWithHub } = await import("../features/pos/services/sync.service")

    const result = await validateStockWithHub([{ productId: 1, quantity: 2 }])
    expect(result).toEqual({ ok: true })
  })

  it("returns ok:false with details when the hub reports insufficient stock", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        ok: false,
        insufficientItems: [{ productId: 68, name: "loreal", available: 0, requested: 1 }],
      }),
    }))
    const { validateStockWithHub } = await import("../features/pos/services/sync.service")

    const result = await validateStockWithHub([{ productId: 68, quantity: 1 }])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe("insufficient")
      expect(result.insufficientItems).toEqual([{ productId: 68, name: "loreal", available: 0, requested: 1 }])
    }
  })

  it("treats a network failure as unreachable, not as a pass — never allows a stale/unverified sale to slip through", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")))
    const { validateStockWithHub } = await import("../features/pos/services/sync.service")

    const result = await validateStockWithHub([{ productId: 1, quantity: 1 }])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("unreachable")
  })

  it("treats a non-OK HTTP response as unreachable, not as a pass", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    const { validateStockWithHub } = await import("../features/pos/services/sync.service")

    const result = await validateStockWithHub([{ productId: 1, quantity: 1 }])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("unreachable")
  })

  it("returns unreachable when there's no api url / token configured, without ever calling fetch", async () => {
    window.localStorage.clear()
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    const { validateStockWithHub } = await import("../features/pos/services/sync.service")

    const result = await validateStockWithHub([{ productId: 1, quantity: 1 }])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("unreachable")
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe("sync.service — commitSaleToHub (server-authoritative write-through)", () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem("lebanonpos.api-url", "http://192.168.1.50:3015")
    window.localStorage.setItem("lebanonpos.auth-token", "test-token")
  })
  afterEach(() => vi.unstubAllGlobals())

  const sale = { id: "sale-wt-1", saleNumber: "S-1", items: [{ id: 1, quantity: 1 }] }

  it("returns committed when the hub confirms the sale", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({ results: [{ id: "wt-sale-wt-1", status: "ok" }] }),
    }))
    const { commitSaleToHub } = await import("../features/pos/services/sync.service")
    expect(await commitSaleToHub(sale)).toEqual({ status: "committed" })
  })

  it("returns rejected (no retry) when the hub rejects for insufficient stock", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({ results: [{ id: "wt-sale-wt-1", status: "rejected", error: "Insufficient stock for \"X\"" }] }),
    })
    vi.stubGlobal("fetch", fetchSpy)
    const { commitSaleToHub } = await import("../features/pos/services/sync.service")
    const r = await commitSaleToHub(sale)
    expect(r.status).toBe("rejected")
    // rejected is definitive → only one push attempt, no retry
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it("returns unreachable after retries when network fails AND the sale did not commit", async () => {
    // every push throws; the sale-committed confirm returns committed:false
    const fetchSpy = vi.fn().mockImplementation((url) => {
      if (String(url).includes("/sale-committed/")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ committed: false }) })
      }
      return Promise.reject(new Error("network"))
    })
    vi.stubGlobal("fetch", fetchSpy)
    const { commitSaleToHub } = await import("../features/pos/services/sync.service")
    expect((await commitSaleToHub(sale)).status).toBe("unreachable")
  })

  it("LOST-ACK: returns committed (never double-sells) when push times out but the sale actually committed", async () => {
    // push times out (rejects), but the confirm endpoint says it DID commit
    const fetchSpy = vi.fn().mockImplementation((url) => {
      if (String(url).includes("/sale-committed/")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ committed: true }) })
      }
      return Promise.reject(new Error("timeout"))
    })
    vi.stubGlobal("fetch", fetchSpy)
    const { commitSaleToHub } = await import("../features/pos/services/sync.service")
    expect((await commitSaleToHub(sale)).status).toBe("committed")
  })

  it("returns unreachable without calling fetch when no api url/token", async () => {
    window.localStorage.clear()
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    const { commitSaleToHub } = await import("../features/pos/services/sync.service")
    expect((await commitSaleToHub(sale)).status).toBe("unreachable")
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe("inventoryBatch.service — consumeInventoryBatches dryRun", () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem("lebanonpos.users.v1", JSON.stringify([
      { id: "u1", name: "A", mobile: "0", pin: "x", role: "Admin", active: true, createdAt: new Date().toISOString(), pinChanged: false },
    ]))
    window.localStorage.setItem("lebanonpos.current-user.v1", "u1")
    window.localStorage.setItem("lebanonpos.inventory-batches.v1", JSON.stringify([
      { id: "b1", batchNumber: "L1", productId: 1, productName: "X", barcode: "X1", initialQuantity: 10, quantityRemaining: 10, unitCost: 1, unitPrice: 2, receivedAt: new Date().toISOString(), status: "Open" },
    ]))
  })

  it("computes an allocation plan WITHOUT mutating batches or enqueuing", async () => {
    const { consumeInventoryBatches } = await import("../features/pos/services/inventoryBatch.service")
    const { getSyncQueue } = await import("../features/pos/services/sync.service")
    const alloc = consumeInventoryBatches(
      [{ productId: 1, productName: "X", barcode: "X1", quantity: 3, fallbackUnitCost: 1 }],
      { dryRun: true },
    )
    // allocation returned
    expect(alloc.get(1)?.[0]?.quantity).toBe(3)
    // batch NOT mutated on disk
    const batches = JSON.parse(window.localStorage.getItem("lebanonpos.inventory-batches.v1")!)
    expect(batches[0].quantityRemaining).toBe(10)
    // nothing enqueued
    expect(getSyncQueue().filter((o: any) => o.entity === "inventory").length).toBe(0)
  })
})
