// Café batch — the register's side of modifiers, recipes and ingredient stock: the shared rules file is the server's,
// a configured drink's line (options snapshot, price, recipe revision, what it consumes), the cart's ingredient check,
// approvals and fingerprints that bind to the options, receiving ingredients in purchase units, and the checkout
// journal giving an interrupted checkout's ingredient lots back exactly once. Real services, jsdom storage.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const K = {
  users: "lebanonpos.users.v1", current: "lebanonpos.current-user.v1", products: "lebanonpos.products.v1",
  batches: "lebanonpos.inventory-batches.v1", sales: "lebanonpos.sales.v1", queue: "lebanonpos.sync-queue.v1",
  groups: "lebanonpos.modifier-groups.v1", recipes: "lebanonpos.recipe-revisions.v1",
}
const read = <T = Record<string, unknown>>(k: string): T[] => { try { const v = JSON.parse(localStorage.getItem(k) ?? "[]"); return Array.isArray(v) ? v : [] } catch { return [] } }
const stockOf = (id: number) => read<{ id: number; stock: number }>(K.products).find((p) => p.id === id)?.stock
const lotLeft = (id: string) => read<{ id: string; quantityRemaining: number }>(K.batches).find((b) => b.id === id)?.quantityRemaining

const SIZE = { id: "g-size", name: "Size", nameAr: "الحجم", required: true, minSelect: 1, maxSelect: 1, options: [
  { id: "o-m", name: "Medium", nameAr: "وسط", priceDelta: 0, isDefault: true, sortOrder: 1 }, { id: "o-l", name: "Large", nameAr: "كبير", priceDelta: 0.75, sortOrder: 2 }] }
const MILK = { id: "g-milk", name: "Milk", required: true, maxSelect: 1, options: [{ id: "o-whole", name: "Whole", priceDelta: 0, isDefault: true }, { id: "o-oat", name: "Oat", priceDelta: 0.5 }] }
function seed() {
  localStorage.setItem(K.users, JSON.stringify([{ id: "u1", name: "Owner", role: "Admin", pin: "HASH", code: "OWN", active: true, permissions: [] }]))
  localStorage.setItem(K.current, "u1")
  localStorage.setItem(K.products, JSON.stringify([
    { id: 1, syncId: "capp", name: "Cappuccino", barcode: null, price: 3, cost: 0, stock: 0, category: "Coffee", stockPolicy: "recipe", modifierGroupIds: ["g-size", "g-milk"], recipeRev: "rcp-1" },
    { id: 2, syncId: "beans", name: "Beans", barcode: null, price: 0, cost: 0.02, stock: 40, category: "Ingredients", stockPolicy: "tracked", sellable: false, stockUnit: "g" },
    { id: 3, syncId: "milk", name: "Milk", barcode: null, price: 0, cost: 0.001, stock: 1000, category: "Ingredients", stockPolicy: "tracked", sellable: false, stockUnit: "ml" },
    { id: 4, syncId: "oat", name: "Oat milk", barcode: null, price: 0, cost: 0.002, stock: 250, category: "Ingredients", stockPolicy: "tracked", sellable: false, stockUnit: "ml" },
    { id: 5, syncId: "pepsi", name: "Pepsi", barcode: "111", price: 1, cost: 0.4, stock: 10, category: "Drinks" },
  ]))
  localStorage.setItem(K.batches, JSON.stringify([
    { id: "lot-beans", batchNumber: "B", productId: 2, productName: "Beans", barcode: "", initialQuantity: 40, quantityRemaining: 40, unitCost: 0.02, unitPrice: 0, receivedAt: "2026-01-01T00:00:00.000Z", status: "Open" },
    { id: "lot-milk", batchNumber: "M", productId: 3, productName: "Milk", barcode: "", initialQuantity: 1000, quantityRemaining: 1000, unitCost: 0.001, unitPrice: 0, receivedAt: "2026-01-01T00:00:00.000Z", status: "Open" },
  ]))
  localStorage.setItem(K.groups, JSON.stringify([SIZE, MILK]))
  localStorage.setItem(K.recipes, JSON.stringify([{ id: "rcp-1", productSyncId: "capp", yield: 1, lines: [
    { ingredientSyncId: "beans", quantity: "18" },
    { ingredientSyncId: "milk", quantity: "200", when: ["o-m"], unless: ["o-oat"] }, { ingredientSyncId: "milk", quantity: "250", when: ["o-l"], unless: ["o-oat"] },
    { ingredientSyncId: "oat", quantity: "200", when: ["o-m", "o-oat"] }, { ingredientSyncId: "oat", quantity: "250", when: ["o-l", "o-oat"] }] }]))
}
async function svc() {
  return {
    menu: await import("../features/pos/services/menu.service"),
    sales: await import("../features/pos/services/sales.service"),
    security: await import("../features/pos/services/security.service"),
    batches: await import("../features/pos/services/inventoryBatch.service"),
    products: await import("../features/pos/services/product.service"),
    sync: await import("../features/pos/services/sync.service"),
  }
}

beforeEach(async () => {
  vi.restoreAllMocks()
  vi.resetModules()
  localStorage.clear()
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline in this test"))))
  seed()
  const m = await svc()
  m.security.openShift(100)
})
afterEach(() => { vi.unstubAllGlobals() })

describe("café menu on the register", () => {
  it("the register's cafeMenu.ts is the server's, byte for byte", () => {
    const root = resolve(__dirname, "../../../..")
    expect(readFileSync(resolve(root, "apps/desktop/src/features/pos/lib/cafeMenu.ts"), "utf8")).toBe(readFileSync(resolve(root, "apps/api/src/lib/cafeMenu.ts"), "utf8"))
  })

  it("a configured drink: options snapshot in the menu's order, price with options, its revision and consumption; ingredients are never for sale", async () => {
    const m = await svc()
    const capp = m.products.getProductsSync().find((p) => p.id === 1)!
    const line = m.menu.configuredLine(capp, [{ groupId: "g-milk", optionId: "o-oat" }, { groupId: "g-size", optionId: "o-l" }], " extra hot ", 2)
    expect(line.modifiers.map((x) => x.optionId)).toEqual(["o-l", "o-oat"])
    expect([line.unitPrice, line.basePrice, line.note, line.recipeRev]).toEqual([4.25, 3, "extra hot", "rcp-1"])
    expect(m.menu.consumptionPayload(line.consumption)).toEqual([{ ingredientSyncId: "beans", quantity: 36 }, { ingredientSyncId: "oat", quantity: 500 }])
    expect(m.products.getSellableProducts(m.products.getProductsSync()).map((p) => p.name)).toEqual(["Cappuccino", "Pepsi"])
    // availability from ingredients: 40 g beans make 2; oat milk (250 ml) one medium oat
    expect(m.menu.servingsFor(capp)).toBe(2)
    expect(m.menu.servingsFor(capp, ["o-m", "o-oat"])).toBe(1)
    expect(m.menu.servingsFor(capp, ["o-l", "o-oat"])).toBe(1)
  })

  it("the whole cart's ingredients are checked: a second drink that the beans cannot make is refused here", async () => {
    const m = await svc()
    const lines = [{ productId: 1, quantity: 2, stockPolicy: "recipe", recipeRev: "rcp-1", modifiers: [{ optionId: "o-m" }, { optionId: "o-whole" }] }]
    expect(m.menu.cartShortage(lines)).toBeNull()
    expect(m.menu.cartShortage([...lines, { productId: 1, quantity: 1, stockPolicy: "recipe", recipeRev: "rcp-1", modifiers: [{ optionId: "o-l" }, { optionId: "o-whole" }] }]))
      .toEqual({ ingredient: "Beans", needed: 54, inStock: 40, unit: "g" })
    const io = m.menu.ingredientCheckoutLines(lines)
    expect(io.stock).toEqual([{ productId: 2, quantity: 36 }, { productId: 3, quantity: 400 }])
  })

  it("a checkout interrupted before the sale is written gives the ingredient lots back exactly once; a committed one keeps them taken", async () => {
    const m = await svc()
    const lines = [{ productId: 1, quantity: 2, stockPolicy: "recipe", recipeRev: "rcp-1", modifiers: [{ optionId: "o-m" }, { optionId: "o-whole" }] }]
    const io = m.menu.ingredientCheckoutLines(lines)
    const capp = m.products.getProductsSync().find((p) => p.id === 1)!
    const made = m.menu.configuredLine(capp, [{ groupId: "g-size", optionId: "o-m" }, { groupId: "g-milk", optionId: "o-whole" }], "", 2)
    const build = (id: string) => m.sales.buildSale({ saleNumber: `S-${id}`, paymentMethod: "Cash", subtotal: 6, tax: 0, total: 6,
      items: [{ id: 1, name: "Cappuccino", barcode: "", cost: 0.56, quantity: 2, unitPrice: 3, total: 6, stockPolicy: "recipe", batchAllocations: [], modifiers: made.modifiers, basePrice: 3, recipeRev: "rcp-1", consumption: m.menu.consumptionPayload(made.consumption) }] }, id)
    // the sale write fails: the ingredient lots and stock are put back exactly, nothing is queued
    const setItem = Storage.prototype.setItem
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
      if (k === K.sales) throw new DOMException("quota", "QuotaExceededError")
      return setItem.call(this, k, v)
    })
    expect(() => m.sales.checkoutLocalSale({ sale: build("sale-x"), lots: io.lots, stock: io.stock })).toThrow()
    spy.mockRestore()
    expect([lotLeft("lot-beans"), lotLeft("lot-milk"), stockOf(2), stockOf(3)]).toEqual([40, 1000, 40, 1000])
    expect(read<{ entity: string; payload: { id?: string } }>(K.queue).some((o) => o.entity === "sale")).toBe(false)
    // committed: the drink's ingredients are taken once, the sale queued with its snapshot
    const r = m.sales.checkoutLocalSale({ sale: build("sale-y"), lots: io.lots, stock: io.stock })
    expect(r.status).toBe("completed")
    expect([lotLeft("lot-beans"), lotLeft("lot-milk"), stockOf(2), stockOf(3), stockOf(1)]).toEqual([4, 600, 4, 600, 0])
    const op = read<{ entity: string; payload: { id?: string; items?: Array<Record<string, unknown>> } }>(K.queue).find((o) => o.entity === "sale")!
    expect(op.payload.items?.[0]).toMatchObject({ stockPolicy: "recipe", recipeRev: "rcp-1", basePrice: 3, consumption: [{ ingredientSyncId: "beans", quantity: 36 }, { ingredientSyncId: "milk", quantity: 400 }] })
  })

  it("an approval and a pending hub sale bind to the options: a missing option charge needs a price override", async () => {
    const { checkoutApprovalNeeded, checkoutFingerprint } = await import("../features/pos/lib/checkoutApproval")
    const { cartFingerprint } = await import("../features/pos/services/hubCheckout.service")
    const products = [{ id: 1, price: 3 }]
    const oat = [{ optionId: "o-oat", priceDelta: 0.5 }]
    expect(checkoutApprovalNeeded({ discountTotal: 0, canDiscount: false, canOverridePrice: false, sellAtCost: false, items: [{ id: 1, quantity: 1, price: 3.5, modifiers: oat }], products, hasCustomer: false })).toEqual([])
    expect(checkoutApprovalNeeded({ discountTotal: 0, canDiscount: false, canOverridePrice: false, sellAtCost: false, items: [{ id: 1, quantity: 1, price: 3, modifiers: oat }], products, hasCustomer: false })).toEqual(["sales.price_override"])
    const base = { discountTotal: 0, subtotal: 3.5, tax: 0, total: 3.5, sellAtCost: false, paymentMethod: "Cash", customerId: null, paidUsd: 5, paidLbp: 0 }
    expect(checkoutFingerprint({ ...base, items: [{ id: 1, quantity: 1, price: 3.5, modifiers: oat }] })).not.toBe(checkoutFingerprint({ ...base, items: [{ id: 1, quantity: 1, price: 3.5, modifiers: [{ optionId: "o-l", priceDelta: 0.5 }] }] }))
    expect(cartFingerprint({ items: [{ id: 1, quantity: 1, unitPrice: 3.5, options: "o-oat," }], paymentMethod: "Cash", total: 3.5 })).not.toBe(cartFingerprint({ items: [{ id: 1, quantity: 1, unitPrice: 3.5, options: "o-l," }], paymentMethod: "Cash", total: 3.5 }))
  })

  it("receiving an ingredient in purchase units: exact stock, invoice price kept, valuation derived; incompatible units are a row problem", async () => {
    const rows = await import("../features/pos/lib/receiveRows")
    const row = rows.createRow({ mode: "ingredient", ingredientProductId: 2, name: "Beans", stockUnit: "g", purchaseUnit: "kg", purchaseQuantity: 2, purchasePrice: 18.37, supplierReference: "INV-9" })
    expect(rows.isRowReady(row)).toBe(true)
    expect(rows.toReceiveEntry(row)).toMatchObject({ receiveIntoProductId: 2, quantity: 2000, cost: 0.0184, purchaseUnit: "kg", purchaseQuantity: 2, unitsPerPurchase: 1000, purchasePrice: 18.37, supplierReference: "INV-9" })
    expect(rows.receiveRowsCost([row])).toBe(36.74)
    const bad = { ...row, purchaseUnit: "L" }
    expect(rows.isRowReady(bad)).toBe(false)
    expect(rows.rowProblems(bad).problems).toEqual(["unit_incompatible"])
    expect(rows.rowProblems({ ...row, purchaseQuantity: 1.23456 }).problems).toEqual(["missing_quantity"])
    expect(rows.rowProblems({ ...row, purchasePrice: undefined }, undefined, { costRequired: true }).problems).toEqual(["cost_missing"])
    // the products write: stock in grams, a lot carrying the invoice
    const m = await svc()
    const r = m.products.receiveProducts([{ ...rows.toReceiveEntry(row), stock: 2000, price: 0 } as never])
    expect(r.results).toEqual([{ accepted: true }])
    expect(stockOf(2)).toBe(2040)
    const lot = read<Record<string, unknown>>(K.batches).find((b) => b.productId === 2 && b.id !== "lot-beans")!
    expect(lot).toMatchObject({ initialQuantity: 2000, unitCost: 0.0184, purchaseUnit: "kg", purchaseQuantity: 2, unitsPerPurchase: 1000, purchasePrice: 18.37, supplierReference: "INV-9" })
  })

  it("counts and adjustments name the product by its stable id (the numeric id is this device's: another product at the cloud)", async () => {
    const adj = await import("../features/pos/services/inventoryAdjustment.service")
    const count = await import("../features/pos/services/stockCount.service")
    adj.recordStockAdjustment({ productId: 3, quantityChange: -30, reason: "Count Correction", note: "ml" })
    const op = read<{ entity: string; action: string; payload: Record<string, unknown> }>(K.queue).find((o) => o.entity === "inventory" && o.action === "adjust")!
    expect(op.payload).toMatchObject({ productId: 3, productSyncId: "milk", quantityChange: -30 })
    expect(stockOf(3)).toBe(970)
    const session = count.startStockCount()
    expect(session.lines.find((l) => l.productId === 2)).toMatchObject({ productSyncId: "beans" })
    // a decimal count variance in grams stays exact
    count.updateStockCountLine(session.id, 2, 35.5)
    count.completeStockCount(session.id)
    expect(stockOf(2)).toBe(35.5)
    const counted = read<{ entity: string; action: string; payload: Record<string, unknown> }>(K.queue).find((o) => o.entity === "inventory" && o.action === "adjust" && o.payload.productId === 2)!
    expect(counted.payload).toMatchObject({ productSyncId: "beans", quantityChange: -4.5 })
  })

  it("a drink sold with a recipe the server never received: a manager's decision travels with the same sale", async () => {
    const m = await svc()
    m.sync.enqueueSyncOperation({ entity: "sale", action: "create", summary: "s", payload: { id: "s-held", saleNumber: "S-H", total: 3, items: [{ name: "Cappuccino", stockPolicy: "recipe", recipeRev: "rcp-gone", quantity: 1 }] } })
    const q = read<{ id: string; entity: string; error?: string; status?: string }>(K.queue)
    const op = q.find((o) => o.entity === "sale")!
    localStorage.setItem(K.queue, JSON.stringify(q.map((o) => (o.id === op.id ? { ...o, status: "Failed", error: `RECIPE_HELD: "Cappuccino" was made with a recipe (rcp-gone) this server does not know yet. The sale is kept and retried; nothing was applied.` } : o))))
    const held = m.sync.getPolicyHeldSales()
    expect(held.map((h) => [h.kind, h.productName])).toEqual([["recipe", "Cappuccino"]])
    expect(m.sync.resolveRecipeHeldSale(op.id, "recorded", "till broke", { id: "u1", name: "Owner" })).toBe(true)
    const after = read<{ id: string; payload: { items: Array<{ recipeResolution?: Record<string, unknown> }> }; error?: string }>(K.queue).find((o) => o.id === op.id)!
    expect(after.error).toBeUndefined()
    expect(after.payload.items[0].recipeResolution).toMatchObject({ mode: "recorded", resolvedBy: "u1", note: "till broke" })
  })
})
