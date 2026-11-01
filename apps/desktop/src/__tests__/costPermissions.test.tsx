// Cost visibility on rendered screens. Cost and profit are internal data (reports.cost); the unit
// cost a receiver types is this delivery's purchase price (inventory.receive) and stays theirs to
// enter. An unknown cost is shown as unknown, never as 0; a real 0 stays 0.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, createElement as h, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { MemoryRouter } from "react-router"
import { I18nProvider } from "@lebanonpos/shared"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let seeCost = false
vi.mock("../features/pos/services/security.service", async (original) => ({
  ...(await original<typeof import("../features/pos/services/security.service")>()),
  userCan: (permission: string) => (permission === "reports.cost" ? seeCost : true),
}))
// jsdom has no IndexedDB; the mirror is not under test here.
vi.mock("../features/pos/services/db", () => ({
  getAll: async () => [], getById: async () => undefined, put: async () => {}, putMany: async () => {},
  del: async () => {}, clear: async () => {}, count: async () => 0,
}))

import HistoryPanel from "../pages/accounting/components/HistoryPanel"
import OpeningInventoryPanel from "../features/pos/components/OpeningInventoryPanel"
import StockControlPanel from "../features/pos/components/StockControlPanel"
import SalesPage from "../pages/sales/SalesPage"
import ProductReceivePage from "../pages/products/ProductReceivePage"
import { buildOpeningInventoryReport, openingReportToCsv } from "../features/pos/lib/openingInventoryReport"
import type { DailyClose } from "../features/pos/services/dailyClose.service"
import type { StockCountSession } from "../features/pos/services/stockCount.service"

let container: HTMLDivElement
let root: Root
async function render(node: ReactNode) {
  await act(async () => { root.render(h(I18nProvider, null, h(MemoryRouter, null, node))) })
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
}
const text = () => container.textContent ?? ""
function setInput(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem("lebanonpos.language", "en")
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe("receiving: the purchase price is entered, stored cost is not shown", () => {
  const product = { id: 1, syncId: "p-1", name: "Rice 1kg", price: 5, cost: 3, stock: 10, barcode: "R-1", category: "Pantry" }
  async function scanRow() {
    localStorage.setItem("lebanonpos.products.v1", JSON.stringify([product]))
    await render(h(ProductReceivePage))
    const scan = container.querySelector<HTMLInputElement>("input[aria-label^='Scan items']")!
    await act(async () => { setInput(scan, "R-1") })
    await act(async () => { scan.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })) })
    return container.querySelector<HTMLInputElement>("input[aria-label='Unit cost of Rice 1kg']")!
  }

  it("without reports.cost: no pre-filled stored cost; the typed price is used", async () => {
    seeCost = false
    const cost = await scanRow()
    expect(cost).toBeTruthy()
    expect(cost.value).toBe("")
    expect(text()).not.toMatch(/\$3\.00/)
    await act(async () => { setInput(cost, "4") })
    expect(cost.value).toBe("4")
  })

  it("with reports.cost: the stored cost is offered", async () => {
    seeCost = true
    const cost = await scanRow()
    expect(cost.value).toBe("3")
  })
})

describe("sales list profit footer", () => {
  const sale = { id: "s1", saleNumber: "S-1", createdAt: new Date().toISOString(), paymentMethod: "Cash", subtotal: 10, tax: 0, total: 10, cost: 4, profit: 6, cashier: "IT", status: "Completed", items: [{ id: 1, name: "Rice", barcode: "R-1", quantity: 2, unitPrice: 5, total: 10, cost: 2 }] }
  it("is shown only with reports.cost", async () => {
    localStorage.setItem("lebanonpos.sales.v1", JSON.stringify([sale]))
    seeCost = false
    await render(h(SalesPage))
    expect(text()).not.toMatch(/profit/i)
    await act(async () => root.unmount())
    root = createRoot(container)
    seeCost = true
    await render(h(SalesPage))
    expect(text()).toMatch(/\$6\.00 profit/)
  })
})

describe("stock count value impact", () => {
  const noop = () => undefined
  const count = { id: "c1", countNumber: "COUNT-1", status: "Open", lines: [], totalVariance: -1, totalValueImpact: -3, createdAt: new Date().toISOString() } as unknown as StockCountSession
  const props = {
    products: [], adjustmentProduct: undefined, adjustmentProductId: null, onAdjustmentProductIdChange: noop, adjustmentMode: "Add" as const,
    onAdjustmentModeChange: noop, adjustmentQuantity: "", onAdjustmentQuantityChange: noop, adjustmentReason: "Count Correction" as never,
    onAdjustmentReasonChange: noop, adjustmentBatchId: "", onAdjustmentBatchIdChange: noop, adjustmentNote: "", onAdjustmentNoteChange: noop,
    selectedProductBatches: [], recentAdjustments: [], activeStockCount: count, countProductId: null, onCountProductIdChange: noop,
    countedQuantity: "", onCountedQuantityChange: noop, countSearch: "", onCountSearchChange: noop, countLines: [],
    onSaveStockAdjustment: noop, onBeginStockCount: noop, onSaveCountLine: noop, onPostStockCount: noop,
  }
  it("is shown only with reports.cost", async () => {
    seeCost = false
    await render(h(StockControlPanel, props))
    expect(text()).toContain("COUNT-1")
    expect(text()).not.toMatch(/\$3\.00/)
    await act(async () => root.unmount())
    root = createRoot(container)
    seeCost = true
    await render(h(StockControlPanel, props))
    expect(text()).toMatch(/\$3\.00/)
  })
})

describe("daily close history: unknown is not zero", () => {
  const close = (id: string, netProfit: number | null, costStatus?: DailyClose["costStatus"]) => ({
    id, dateKey: "2026-10-31", grossSales: 10, refunds: 0, netSales: 10, expenses: 0, cashIn: 10, cashOut: 0, note: "", closedBy: "IT",
    createdAt: new Date().toISOString(), netProfit, costStatus,
  }) as unknown as DailyClose

  it("with reports.cost: an incomplete close says so; a true zero shows $0.00", async () => {
    seeCost = true
    await render(h(HistoryPanel, { dailyCloses: [close("a", null, "incomplete"), close("b", 0, "server")] }))
    expect(text()).toContain("Not available")
    expect(text()).toContain("Valuation incomplete")
    expect(text()).toContain("$0.00")
  })

  it("without reports.cost: no profit at all", async () => {
    seeCost = false
    await render(h(HistoryPanel, { dailyCloses: [close("b", 12, "server")] }))
    expect(text()).not.toMatch(/\$12\.00|Not available/)
  })
})

describe("opening inventory valuation", () => {
  const movement = (id: string, productId: number, reference: string, quantity: number) => ({ id, productId, productName: `P${productId}`, type: "Opening", quantity, reference, createdAt: "2026-10-01T10:00:00.000Z" })
  const lot = (batchNumber: string, productId: number, unitCost?: number) => ({ id: batchNumber, batchNumber, productId, productName: `P${productId}`, barcode: `B${productId}`, initialQuantity: 5, quantityRemaining: 5, ...(unitCost === undefined ? {} : { unitCost }), unitPrice: 1, receivedAt: "2026-10-01T10:00:00.000Z", status: "Open" })
  const products = [1, 2, 3].map((id) => ({ id, name: `P${id}`, price: 1, cost: 9, stock: 5, barcode: `B${id}`, category: "C" }))

  it("an unknown cost is not 0 nor the product's cost; a real 0 is kept; the total is incomplete", () => {
    const report = buildOpeningInventoryReport(
      [movement("m1", 1, "OPENING-1", 5), movement("m2", 2, "OPENING-2", 5), movement("m3", 3, "OPENING-3", 5)] as never,
      [lot("OPENING-1", 1, 0.5), lot("OPENING-2", 2, 0), lot("OPENING-3", 3)] as never,
      products as never,
    )
    const byProduct = Object.fromEntries(report.rows.map((r) => [r.productId, r]))
    expect(byProduct[1]).toMatchObject({ unitCost: 0.5, value: 2.5 })
    expect(byProduct[2]).toMatchObject({ unitCost: 0, value: 0 })
    expect(byProduct[3].unitCost).toBeUndefined()
    expect(byProduct[3].value).toBeUndefined()
    expect(report.summary).toMatchObject({ value: undefined, unvalued: 1, units: 15 })
    expect(openingReportToCsv(report).split("\n").find((l) => l.includes("P3"))).toMatch(/,5,,,OPENING-3$/)
  })

  it("renders incomplete valuation explicitly, and no cost without reports.cost", async () => {
    localStorage.setItem("lebanonpos.stock-movements.v1", JSON.stringify([movement("m1", 1, "OPENING-1", 5), movement("m3", 3, "OPENING-3", 5)]))
    localStorage.setItem("lebanonpos.inventory-batches.v1", JSON.stringify([lot("OPENING-1", 1, 0.5), lot("OPENING-3", 3)]))
    localStorage.setItem("lebanonpos.products.v1", JSON.stringify(products))
    seeCost = true
    await render(h(OpeningInventoryPanel))
    expect(text()).toContain("Valuation incomplete: 1")
    expect(text()).toContain("Not available")
    expect(text()).not.toContain("45.00") // never the product cost (9 × 5)
    await act(async () => root.unmount())
    root = createRoot(container)
    seeCost = false
    await render(h(OpeningInventoryPanel))
    expect(text()).not.toMatch(/Opening value|Unit cost|Valuation incomplete/)
  })
})
