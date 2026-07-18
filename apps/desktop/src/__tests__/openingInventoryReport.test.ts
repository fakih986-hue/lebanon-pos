import { describe, it, expect } from "vitest"
import type { Product } from "../features/pos/types/product"
import type { StockMovement, InventoryBatch } from "../features/pos/services/inventoryBatch.service"
import {
  buildOpeningInventoryReport,
  openingReportToCsv,
} from "../features/pos/lib/openingInventoryReport"

// POS-FIRST-SETUP-CATALOG-1F — opening-inventory report (pure).

const mv = (over: Partial<StockMovement>): StockMovement => ({
  id: "m", productId: 1, productName: "Pepsi", type: "Opening", quantity: 10,
  balance: 10, reference: "OPENING-1", note: "", createdAt: "2026-07-10T09:00:00.000Z", ...over,
})
const batch = (over: Partial<InventoryBatch>): InventoryBatch => ({
  id: "b", batchNumber: "OPENING-1", productId: 1, productName: "Pepsi", barcode: "PB-1",
  initialQuantity: 10, quantityRemaining: 10, unitCost: 0.4, unitPrice: 0.75,
  receivedAt: "2026-07-10T09:00:00.000Z", status: "Open", ...over,
})
const prod = (over: Partial<Product>): Product => ({
  id: 1, name: "Pepsi", price: 0.75, cost: 0.4, stock: 10, barcode: "PB-1",
  category: "Beverages", accent: "emerald", barcodeAliases: [], ...over,
})

describe("POS-FIRST-SETUP-CATALOG-1F — buildOpeningInventoryReport", () => {
  it("includes only Opening movements; Receive/Sale/Adjustment excluded", () => {
    const movements = [
      mv({ id: "m1", reference: "OPENING-1", quantity: 10 }),
      mv({ id: "m2", type: "Receive", reference: "LOT-9", quantity: 50 }),
      mv({ id: "m3", type: "Sale", quantity: -3 }),
      mv({ id: "m4", type: "Adjustment", quantity: 2 }),
    ]
    const report = buildOpeningInventoryReport(movements, [batch({})], [prod({})])
    expect(report.rows).toHaveLength(1)
    expect(report.rows[0].batchNumber).toBe("OPENING-1")
  })

  it("enriches rows with barcode/cost from the batch and category from the product", () => {
    const report = buildOpeningInventoryReport([mv({})], [batch({})], [prod({})])
    expect(report.rows[0]).toMatchObject({
      productName: "Pepsi", barcode: "PB-1", category: "Beverages", quantity: 10, unitCost: 0.4, value: 4,
    })
  })

  it("computes totals: distinct products, units, value", () => {
    const movements = [
      mv({ id: "m1", productId: 1, reference: "OPENING-1", quantity: 10 }),
      mv({ id: "m2", productId: 2, productName: "Water", reference: "OPENING-2", quantity: 5 }),
      mv({ id: "m3", productId: 1, reference: "OPENING-3", quantity: 4 }),
    ]
    const batches = [
      batch({ batchNumber: "OPENING-1", productId: 1, unitCost: 0.4 }),
      batch({ batchNumber: "OPENING-2", productId: 2, barcode: "W-1", unitCost: 0.2 }),
      batch({ batchNumber: "OPENING-3", productId: 1, unitCost: 0.4 }),
    ]
    const products = [prod({}), prod({ id: 2, name: "Water", barcode: "W-1", category: "Beverages" })]
    const report = buildOpeningInventoryReport(movements, batches, products)
    expect(report.summary.products).toBe(2)
    expect(report.summary.units).toBe(19)
    expect(report.summary.value).toBeCloseTo(10 * 0.4 + 5 * 0.2 + 4 * 0.4)
  })

  it("filters by date range and category", () => {
    const movements = [
      mv({ id: "m1", productId: 1, reference: "OPENING-1", createdAt: "2026-07-01T00:00:00.000Z" }),
      mv({ id: "m2", productId: 2, productName: "Chips", reference: "OPENING-2", createdAt: "2026-07-15T00:00:00.000Z" }),
    ]
    const batches = [batch({ batchNumber: "OPENING-1" }), batch({ batchNumber: "OPENING-2", productId: 2 })]
    const products = [prod({}), prod({ id: 2, name: "Chips", category: "Snacks" })]

    const byDate = buildOpeningInventoryReport(movements, batches, products, { from: "2026-07-10" })
    expect(byDate.rows.map((r) => r.productName)).toEqual(["Chips"])

    const byCat = buildOpeningInventoryReport(movements, batches, products, { category: "Beverages" })
    expect(byCat.rows.map((r) => r.productName)).toEqual(["Pepsi"])
    // Categories list reflects the full (unfiltered) opening set.
    expect(byCat.categories).toEqual(["Beverages", "Snacks"])
  })

  it("exports filtered rows to CSV with a header", () => {
    const csv = openingReportToCsv(buildOpeningInventoryReport([mv({})], [batch({})], [prod({})]))
    const lines = csv.split("\n")
    expect(lines[0]).toBe("Date,Product,Barcode,Category,Quantity,Unit Cost,Value,Batch")
    expect(lines[1]).toBe("2026-07-10,Pepsi,PB-1,Beverages,10,0.4,4.00,OPENING-1")
  })

  it("returns an empty report when there are no opening movements", () => {
    const report = buildOpeningInventoryReport([mv({ type: "Receive" })], [], [])
    expect(report.rows).toHaveLength(0)
    expect(report.summary).toEqual({ products: 0, units: 0, value: 0 })
  })
})
