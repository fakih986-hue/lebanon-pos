// Hidden cost: a till without reports.cost receives no cost data (product, lot, sale-line cost,
// sale cost/profit arrive absent). A manager unlocking it may see cost, but the data is still
// missing: it is "unavailable" — never 0, never guessed, never sent — and anything computed from
// it (totals, margin, profit, COGS, value impact) is unavailable too.
import { beforeEach, describe, expect, it } from "vitest"
import { signInCatalogManager } from "./signInHelper"
import { formatCost, isCostAvailable, sumAvailable, typedCost } from "../features/pos/lib/cost"
import { formatLbpCurrency, formatUsdCurrency } from "../features/pos/lib/currency"
import { addScan, createRow, isRowReady, parseDraft, receiveRowsCost, rowProblems, serializeDraft, toReceiveEntry } from "../features/pos/lib/receiveRows"
import { getAccountingSummary } from "../pages/accounting/accounting.helpers"
import { startStockCount, stockCountValueImpact, updateStockCountLine } from "../features/pos/services/stockCount.service"
import { receiveProducts, updateProduct } from "../features/pos/services/product.service"
import { createSupplier, recordReceiveFinance } from "../features/pos/services/supplier.service"
import { getSales, type Sale, type SaleRefund } from "../features/pos/services/sales.service"
import type { Product } from "../features/pos/types/product"

const NA = "Not available"
const PRODUCTS = "lebanonpos.products.v1"
const QUEUE = "lebanonpos.sync-queue.v1"
const queue = (): Array<{ entity: string; action: string; payload: Record<string, unknown> }> => JSON.parse(localStorage.getItem(QUEUE) ?? "[]")
// A product as a till without reports.cost stores it: no `cost` key at all.
const noCost = { id: 1, syncId: "p-1", name: "Hidden Cola", barcode: "HC-1", category: "Drinks", price: 2, stock: 5, accent: "cyan" } as unknown as Product

describe("cost helper", () => {
  it("a cost is available only when it is a finite number", () => {
    expect(isCostAvailable(0)).toBe(true)
    expect(isCostAvailable(1.25)).toBe(true)
    for (const v of [undefined, null, NaN, Infinity, "1"]) expect(isCostAvailable(v)).toBe(false)
  })
  it("a sum with any unavailable part is unavailable (not partial, not 0)", () => {
    expect(sumAvailable([1, 2, 3])).toBe(6)
    expect(sumAvailable([])).toBe(0)
    expect(sumAvailable([1, undefined, 3])).toBeUndefined()
    expect(sumAvailable([1, NaN])).toBeUndefined()
  })
  it("formats an unavailable cost as the given text, never $NaN", () => {
    expect(formatCost(2.5, NA)).toBe(formatUsdCurrency(2.5))
    expect(formatCost(undefined, NA)).toBe(NA)
    expect(formatCost(NaN, NA)).toBe(NA)
    expect(formatUsdCurrency(NaN)).toBe("—")
    expect(formatLbpCurrency(NaN)).toBe("—")
  })
  it("a blank cost field is no cost; a typed 0 is 0", () => {
    expect(typedCost("")).toBeUndefined()
    expect(typedCost("  ")).toBeUndefined()
    expect(typedCost("0")).toBe(0)
    expect(typedCost("1.5")).toBe(1.5)
  })
})

describe("accounting summary with missing cost", () => {
  const today = new Date().toISOString()
  const sale = (over: Partial<Sale>): Sale => ({
    id: "s-1", saleNumber: "S-1", paymentMethod: "Cash", subtotal: 10, tax: 0, total: 10, cost: 4, profit: 6,
    items: [{ id: 1, name: "A", barcode: "A", cost: 4, quantity: 1, unitPrice: 10, total: 10 }],
    cashier: "x", status: "Completed", createdAt: today, ...over,
  } as Sale)

  it("computes COGS, margin and profit when every cost is known", () => {
    const s = getAccountingSummary([sale({})], [], [], [])
    expect(s).toMatchObject({ costOfGoods: 4, grossMargin: 6, netProfit: 6, netSales: 10 })
  })
  it("a sale whose cost/profit was withheld makes COGS, margin and profit unavailable (not $0.00)", () => {
    const hidden = sale({ id: "s-2", cost: undefined as unknown as number, profit: undefined as unknown as number, items: [{ id: 1, name: "A", barcode: "A", cost: undefined as unknown as number, quantity: 1, unitPrice: 10, total: 10 }] })
    const s = getAccountingSummary([sale({}), hidden], [], [], [])
    expect(s.costOfGoods).toBeUndefined()
    expect(s.grossMargin).toBeUndefined()
    expect(s.netProfit).toBeUndefined()
    expect(s.netSales).toBe(20) // money that does not depend on cost is unaffected
  })
  it("a refund with no available cost makes the returned cost and margin unavailable", () => {
    const hiddenLine = sale({ items: [{ id: 1, name: "A", barcode: "A", cost: undefined as unknown as number, quantity: 1, unitPrice: 10, total: 10 }] })
    const refund = { id: "r-1", refundNumber: "R-1", saleId: "s-1", saleNumber: "S-1", method: "Cash", reason: "x", total: 10, items: [{ id: 1, name: "A", barcode: "A", quantity: 1, unitPrice: 10, total: 10 }], cashier: "x", createdAt: today } as unknown as SaleRefund
    const s = getAccountingSummary([hiddenLine], [refund], [], [])
    expect(s.returnedCost).toBeUndefined()
    expect(s.grossMargin).toBeUndefined()
  })
})

describe("receiving rows without a cost", () => {
  it("a product whose cost is unavailable starts its row with an empty cost (not 0, not NaN)", () => {
    const row = addScan([createRow()], "HC-1", noCost).rows[0]
    expect(row.cost).toBeUndefined()
    expect(createRow().cost).toBeUndefined()
  })
  it("a row with no typed cost sends no cost at all; a typed 0 is sent as 0", () => {
    const row = { ...addScan([createRow()], "HC-1", noCost).rows[0], quantity: 3 }
    expect("cost" in toReceiveEntry(row)).toBe(false)
    expect(toReceiveEntry({ ...row, cost: 0 }).cost).toBe(0)
    expect(toReceiveEntry({ ...row, cost: 1.2 }).cost).toBe(1.2)
  })
  it("with a supplier every ready row needs a unit cost (cost_missing blocks it)", () => {
    const row = { ...addScan([createRow()], "HC-1", noCost).rows[0], quantity: 3 }
    expect(isRowReady(row)).toBe(true)
    expect(rowProblems(row, noCost).problems).toEqual([])
    expect(isRowReady(row, { costRequired: true })).toBe(false)
    expect(rowProblems(row, noCost, { costRequired: true }).problems).toEqual(["cost_missing"])
    expect(isRowReady({ ...row, cost: 0 }, { costRequired: true })).toBe(true)
  })
  it("the delivery total is unavailable when a ready row has no cost", () => {
    const a = { ...createRow(), quantity: 2, cost: 1.5 }
    const b = { ...createRow(), quantity: 1, cost: undefined }
    expect(receiveRowsCost([a])).toBe(3)
    expect(receiveRowsCost([a, b])).toBeUndefined()
  })
  it("a draft keeps an empty cost empty", () => {
    const row = { ...createRow(), name: "X", barcode: "X", quantity: 1 }
    const back = parseDraft(serializeDraft({ rows: [row], supplierId: "", invoiceNumber: "", paymentMethod: "Cash", note: "" }))
    expect(back?.rows[0].cost).toBeUndefined()
  })
})

describe("services: nothing fabricated is sent", () => {
  beforeEach(() => {
    localStorage.clear()
    signInCatalogManager()
    localStorage.setItem(PRODUCTS, JSON.stringify([noCost]))
  })

  it("receiving without a typed cost: the lot and product updates carry no cost", () => {
    let lots: Array<Record<string, unknown>> = []
    const r = receiveProducts([{ name: "Hidden Cola", barcode: "HC-1", category: "Drinks", stock: 3, price: 2 }], { onProductsWritten: (w) => { lots = w.batchInputs } })
    expect(r.results[0].accepted).toBe(true)
    expect(lots).toHaveLength(1)
    expect("unitCost" in lots[0]).toBe(false)
    const receiveOp = queue().find((o) => o.entity === "inventory" && o.action === "receive")!
    expect(JSON.stringify(receiveOp.payload)).not.toContain("unitCost")
    const updateOp = queue().find((o) => o.entity === "product" && o.action === "update")
    if (updateOp) expect("cost" in updateOp.payload).toBe(false)
  })

  it("a typed receive cost is sent as entered", () => {
    let lots: Array<Record<string, unknown>> = []
    receiveProducts([{ name: "Hidden Cola", barcode: "HC-1", category: "Drinks", stock: 3, price: 2, cost: 0.75 }], { onProductsWritten: (w) => { lots = w.batchInputs } })
    expect(lots[0].unitCost).toBe(0.75)
  })

  it("editing other fields of a product whose cost is unavailable saves and sends no cost", () => {
    const updated = updateProduct(1, { name: "Hidden Cola Zero", price: 2.5 })
    expect(updated?.name).toBe("Hidden Cola Zero")
    const op = queue().find((o) => o.entity === "product" && o.action === "update")!
    expect(op.payload.name).toBe("Hidden Cola Zero")
    expect("cost" in op.payload).toBe(false)
    // A non-number cost in a patch is dropped, never written as null/0.
    updateProduct(1, { cost: NaN })
    expect(JSON.parse(localStorage.getItem(PRODUCTS)!)[0].cost).toBeUndefined()
    // A typed cost is sent.
    updateProduct(1, { cost: 0.9 })
    expect(queue().filter((o) => o.entity === "product" && o.action === "update")[0].payload.cost).toBe(0.9) // the queue is newest first
  })

  it("a stock count of a product without a cost has an unavailable value impact and total", () => {
    const session = startStockCount()
    const after = updateStockCountLine(session.id, 1, 3)!
    expect(after.lines[0].variance).toBe(-2)
    expect(after.lines[0].valueImpact).toBeUndefined()
    expect(after.totalValueImpact).toBeUndefined()
  })

  it("receive finance refuses to record a purchase order with a missing cost", () => {
    const s = createSupplier({ name: "Malia", mobile: "0", contact: "K", address: "D", notes: "" })
    const ctx = { supplierId: s.id, supplierName: s.name, paymentMethod: "On Account" as const }
    const f = recordReceiveFinance("rcv-nan", ctx, [
      { name: "A", barcode: "A", quantity: 2, cost: 1, price: 2 },
      { name: "B", barcode: "B", quantity: 1, price: 2 },
    ])
    expect(f.purchaseOrder.status).toBe("failed")
    expect(f.purchaseOrder.error).toMatch(/no unit cost/)
    expect(JSON.parse(localStorage.getItem("lebanonpos.purchase-orders.v1") ?? "[]")).toEqual([])
    expect(JSON.parse(localStorage.getItem("lebanonpos.supplier-payments.v1") ?? "[]")).toEqual([])
    // Without a supplier nothing is needed.
    expect(recordReceiveFinance(undefined, undefined, [{ name: "B", barcode: "B", quantity: 1, price: 2 }]).purchaseOrder.status).toBe("not_needed")
  })
})

describe("sales read without cost", () => {
  it("a withheld sale cost/profit and line cost stay unavailable, not 0; known ones are kept", () => {
    localStorage.clear()
    localStorage.setItem("lebanonpos.sales.v1", JSON.stringify([
      { id: "s-h", saleNumber: "S-H", paymentMethod: "Cash", subtotal: 5, tax: 0, total: 5, items: [{ productId: 1, productName: "A", quantity: 1, unitPrice: 5, total: 5 }], cashier: "x", status: "Completed", createdAt: new Date().toISOString() },
      { id: "s-k", saleNumber: "S-K", paymentMethod: "Cash", subtotal: 5, tax: 0, total: 5, cost: "2.0000", profit: "3.0000", items: [{ productId: 1, productName: "A", cost: "2", quantity: 1, unitPrice: 5, total: 5 }], cashier: "x", status: "Completed", createdAt: new Date().toISOString() },
    ]))
    const [hidden, known] = getSales()
    expect(hidden.cost).toBeUndefined()
    expect(hidden.profit).toBeUndefined()
    expect(hidden.items[0].cost).toBeUndefined()
    expect(known).toMatchObject({ cost: 2, profit: 3 })
    expect(known.items[0].cost).toBe(2)
  })
})

describe("stock count value impact", () => {
  it("a line whose product cost is unavailable has an unavailable value impact", () => {
    expect(stockCountValueImpact(-2, undefined)).toBeUndefined()
    expect(stockCountValueImpact(-2, NaN)).toBeUndefined()
    expect(stockCountValueImpact(-2, 1.5)).toBe(-3)
    expect(stockCountValueImpact(0, undefined)).toBe(0) // no variance moves no value
  })
})
