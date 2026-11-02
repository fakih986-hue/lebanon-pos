// Pilot acceptance (batch 79): hubs 1.0.49–1.0.51 (sync schema 2) insert pulled rows verbatim; a column their database
// lacks failed the whole entity, so a hub activated against the upgraded cloud received no products or staff.
import { describe, expect, it } from "vitest"
import { isLegacyHubPull, projectLegacyPull, projectLegacyRow, legacyModelOf } from "../src/lib/legacyHubShape.js"
import { LEGACY_HUB_FIELDS } from "../src/lib/legacyHubFields.js"

describe("pulls for hubs 1.0.49–1.0.51", () => {
  it("only the cloud bridge announcing schema < 3 is projected (registers and current hubs get every field)", () => {
    expect(isLegacyHubPull({ userId: "cloud-bridge" }, 2)).toBe(true)
    expect(isLegacyHubPull({ userId: "cloud-bridge" }, 1)).toBe(true)
    expect(isLegacyHubPull({ userId: "cloud-bridge" }, 6)).toBe(false)
    expect(isLegacyHubPull({ userId: "staff-1" }, 2)).toBe(false)
    expect(isLegacyHubPull(undefined, 2)).toBe(false)
  })

  it("products, staff, sales (with lines and tender) and lots keep only the fields such a hub has; values unchanged", () => {
    const body = projectLegacyPull({
      serverTime: "t", topology: { mode: "unset" }, deletions: [],
      products: [{ id: 1, syncId: "s1", name: "Water", price: 1, barcode: "5281", sellable: true, stockUnit: "unit", modifierGroupIds: [], recipeRev: null, purchaseUnit: null }],
      users: [{ id: "u1", name: "Rana", role: "Cashier", tokenVersion: 3, roleVersion: 2, pin: "$2-withheld" }],
      sales: [{ id: "x", total: 3, attribution: { kind: "claimed" }, voidedById: null, items: [{ id: 9, productId: 1, quantity: 1, unitPrice: 3, modifiers: [], note: "hot", basePrice: 3, consumption: [], costStatus: "known" }], tender: [] }],
      batches: [{ id: "b", productId: 1, quantityRemaining: 5, purchaseUnit: "kg", purchasePrice: 2, attribution: null }],
      modifierGroups: [{ id: "g" }],
    } as Record<string, unknown>) as any
    expect(body.products[0]).toEqual({ id: 1, syncId: "s1", name: "Water", price: 1, barcode: "5281" })
    expect(body.users[0]).toEqual({ id: "u1", name: "Rana", role: "Cashier", tokenVersion: 3, pin: "$2-withheld" })
    expect(body.sales[0]).toEqual({ id: "x", total: 3, items: [{ id: 9, productId: 1, quantity: 1, unitPrice: 3 }], tender: [] })
    expect(body.batches[0]).toEqual({ id: "b", productId: 1, quantityRemaining: 5 })
    // keys that are not model arrays are left alone (older hubs ignore what they do not know)
    expect([body.serverTime, body.topology, body.deletions, body.modifierGroups]).toEqual(["t", { mode: "unset" }, [], [{ id: "g" }]])
  })

  it("every model a pull carries is in the generated map, from the oldest published hub's schema", () => {
    for (const m of ["Product", "Sale", "SaleItem", "SaleTender", "SaleRefund", "Customer", "DebtSale", "DebtPayment", "Supplier", "PurchaseOrder", "SupplierPayment", "StaffUser", "Shift", "AuditEvent", "AppSettings", "Expense", "InventoryBatch", "StockAdjustment", "StockCountSession", "DailyClose", "DeliveryOrder"]) expect(Object.keys(LEGACY_HUB_FIELDS)).toContain(m)
    expect("roleVersion" in LEGACY_HUB_FIELDS.StaffUser).toBe(false) // added in 1.0.50: the 1.0.49 hub lacks it
    expect(legacyModelOf("inventoryBatch")).toBe("InventoryBatch")
    expect(legacyModelOf("modifierGroup")).toBeUndefined()
    expect(projectLegacyRow("Unknown", { a: 1 })).toEqual({ a: 1 })
  })
})
