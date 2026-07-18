import type { StockMovement, InventoryBatch } from "../services/inventoryBatch.service"
import type { Product } from "../types/product"

// POS-FIRST-SETUP-CATALOG-1F: opening-inventory report. Pure derivation over the
// existing stock-movement ledger + batches + catalog — no mutation. Keyed on
// "Opening" movements (daily "Receive" movements are excluded), enriched with
// barcode/cost from the matching OPENING-* batch and category from the product.

export type OpeningReportRow = {
  productId: number
  productName: string
  barcode: string
  category: string
  quantity: number
  unitCost: number
  value: number
  batchNumber: string
  date: string
}

export type OpeningReport = {
  rows: OpeningReportRow[]
  summary: { products: number; units: number; value: number }
  categories: string[]
}

export type OpeningReportFilters = {
  /** inclusive ISO date (yyyy-mm-dd) lower bound on the movement date */
  from?: string
  /** inclusive ISO date (yyyy-mm-dd) upper bound on the movement date */
  to?: string
  category?: string
}

/** Build the opening-inventory report from the raw ledger. Opening movements
 *  only; Receive/Sale/Adjustment/etc. are ignored. */
export function buildOpeningInventoryReport(
  movements: StockMovement[],
  batches: InventoryBatch[],
  products: Product[],
  filters?: OpeningReportFilters,
): OpeningReport {
  const batchByNumber = new Map(batches.map((b) => [b.batchNumber, b]))
  const productById = new Map(products.map((p) => [p.id, p]))

  let rows: OpeningReportRow[] = movements
    .filter((m) => m.type === "Opening")
    .map((m) => {
      const batch = batchByNumber.get(m.reference)
      const product = productById.get(m.productId)
      const unitCost = batch?.unitCost ?? product?.cost ?? 0
      const quantity = m.quantity
      return {
        productId: m.productId,
        productName: m.productName || product?.name || `Product #${m.productId}`,
        barcode: batch?.barcode || product?.barcode || "",
        category: product?.category || "",
        quantity,
        unitCost,
        value: quantity * unitCost,
        batchNumber: m.reference || (batch?.batchNumber ?? ""),
        date: m.createdAt,
      }
    })

  const categories = Array.from(new Set(rows.map((r) => r.category).filter(Boolean))).sort()

  if (filters?.from) rows = rows.filter((r) => r.date.slice(0, 10) >= filters.from!)
  if (filters?.to) rows = rows.filter((r) => r.date.slice(0, 10) <= filters.to!)
  if (filters?.category) rows = rows.filter((r) => r.category === filters.category)

  // Newest first for display.
  rows.sort((a, b) => b.date.localeCompare(a.date))

  const summary = {
    products: new Set(rows.map((r) => r.productId)).size,
    units: rows.reduce((n, r) => n + r.quantity, 0),
    value: rows.reduce((n, r) => n + r.value, 0),
  }

  return { rows, summary, categories }
}

const OPENING_REPORT_HEADERS = ["Date", "Product", "Barcode", "Category", "Quantity", "Unit Cost", "Value", "Batch"] as const

/** Export the (already filtered) report rows as CSV. */
export function openingReportToCsv(report: OpeningReport): string {
  const esc = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const rows = report.rows.map((r) => [
    r.date.slice(0, 10), r.productName, r.barcode, r.category,
    r.quantity, r.unitCost, r.value.toFixed(2), r.batchNumber,
  ].map(esc).join(","))
  return [OPENING_REPORT_HEADERS.join(","), ...rows].join("\n")
}
