// 1.0.53 cashier fixes, against the real services (only the network is blocked):
//  A. closing a drawer needs an entered count — blank is "not counted", never the expected cash; 0 is a count;
//     a closed shift with no recorded count (history) reads "not counted", never a counted 0
//  B. Void follows the service rule — a sale with any refund (partial or full) is not voidable, on screen and in
//     the service; a refused void changes nothing; repeated voids apply once
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, createElement as h } from "react"
import { createRoot, type Root } from "react-dom/client"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const USERS_KEY = "lebanonpos.users.v1"
const CURRENT_USER_KEY = "lebanonpos.current-user.v1"
const SALES_KEY = "lebanonpos.sales.v1"
const REFUNDS_KEY = "lebanonpos.refunds.v1"
const PRODUCTS_KEY = "lebanonpos.products.v1"
const BATCHES_KEY = "lebanonpos.inventory-batches.v1"
const QUEUE_KEY = "lebanonpos.sync-queue.v1"
const SHIFTS_KEY = "lebanonpos.shifts.v1"

const read = (key: string) => JSON.parse(window.localStorage.getItem(key) ?? "[]")
const queue = () => read(QUEUE_KEY) as Array<{ entity: string; action: string }>
const stockOf = (id: number) => read(PRODUCTS_KEY).find((p: any) => p.id === id).stock
const lotOf = (id: string) => read(BATCHES_KEY).find((b: any) => b.id === id).quantityRemaining

function seed() {
  window.localStorage.setItem(USERS_KEY, JSON.stringify([{ id: "u1", name: "Owner", role: "Admin", pin: "HASH", code: "OWN", active: true, permissions: [] }]))
  window.localStorage.setItem(CURRENT_USER_KEY, "u1")
  window.localStorage.setItem(PRODUCTS_KEY, JSON.stringify([{ id: 1, name: "Cola", barcode: "111", price: 5, cost: 2, stock: 0, category: "Drinks" }]))
  window.localStorage.setItem(BATCHES_KEY, JSON.stringify([
    { id: "lot-a", batchNumber: "A", productId: 1, productName: "Cola", barcode: "111", initialQuantity: 6, quantityRemaining: 0, unitCost: 2, unitPrice: 5, receivedAt: "2026-01-01T00:00:00.000Z", status: "Consumed" },
  ]))
  window.localStorage.setItem(SALES_KEY, JSON.stringify(["sale-1", "sale-2", "sale-3"].map((id, i) => ({
    id, saleNumber: `S-${i + 1}`, paymentMethod: "Cash", subtotal: 10, tax: 0, total: 10, cost: 4, profit: 6,
    cashier: "Owner", status: "Completed", createdAt: "2026-10-01T10:00:00.000Z",
    items: [{ id: 1, lineId: `L${i + 1}`, name: "Cola", barcode: "111", cost: 2, quantity: 2, unitPrice: 5, total: 10, batchAllocations: [{ batchId: "lot-a", batchNumber: "A", quantity: 2, unitCost: 2 }] }],
  }))))
}

async function services() {
  const sales = await import("../features/pos/services/sales.service")
  const security = await import("../features/pos/services/security.service")
  const shifts = await import("../features/pos/services/shift.service")
  return { sales, security, shifts }
}

beforeEach(() => {
  vi.resetModules()
  window.localStorage.clear()
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network disabled in tests"))))
})
afterEach(() => { vi.unstubAllGlobals() })

describe("B. void eligibility follows the service rule", () => {
  it("clean, partially refunded, fully refunded and voided sales", async () => {
    seed()
    const { sales, security } = await services()
    security.openShift(50)
    sales.processRefund({ saleId: "sale-2", quantities: { L2: 1 }, reason: "" }) // partial
    sales.processRefund({ saleId: "sale-3", quantities: { L3: 2 }, reason: "" }) // full
    const byId = (id: string) => sales.getSales().find((s) => s.id === id)!
    expect(sales.voidBlockedReason(byId("sale-1"))).toBeNull()
    expect(sales.voidBlockedReason(byId("sale-2"))).toBe("refunded")
    expect(sales.voidBlockedReason(byId("sale-3"))).toBe("refunded")

    // a refused void changes nothing: status, stock, lots, queue
    for (const id of ["sale-2", "sale-3"]) {
      const before = { stock: stockOf(1), lot: lotOf("lot-a"), ops: queue().length, refunds: read(REFUNDS_KEY).length }
      expect(() => sales.voidSale(id)).toThrow(/^VOID_HAS_REFUNDS/)
      expect(() => sales.voidSale(id)).toThrow(/^VOID_HAS_REFUNDS/) // a second click
      expect(byId(id).status).toBe("Completed")
      expect({ stock: stockOf(1), lot: lotOf("lot-a"), ops: queue().length, refunds: read(REFUNDS_KEY).length }).toEqual(before)
    }

    // repeated voids of a clean sale: stock and lots restored once, one void operation
    const stock0 = stockOf(1), lot0 = lotOf("lot-a")
    sales.voidSale("sale-1"); sales.voidSale("sale-1"); sales.voidSale("sale-1")
    expect(byId("sale-1").status).toBe("Voided")
    expect(stockOf(1)).toBe(stock0 + 2)
    expect(lotOf("lot-a")).toBe(lot0 + 2)
    expect(queue().filter((op) => op.entity === "sale" && op.action === "void")).toHaveLength(1)
    expect(sales.voidBlockedReason(byId("sale-1"))).toBe("voided")
    // and a voided sale cannot then be refunded
    expect(() => sales.processRefund({ saleId: "sale-1", quantities: { L1: 1 }, reason: "" })).toThrow(/REFUND_SALE_VOIDED/)
    expect(stockOf(1)).toBe(stock0 + 2)
  })
})

describe("A. closing a drawer needs a count", () => {
  it("blank (missing or not a number) is refused; 0 is recorded as a count of nothing", async () => {
    seed()
    const { security } = await services()
    const shift = security.openShift(50)!
    for (const bad of [undefined, Number.NaN, -1]) {
      expect(security.closeShift({ shiftId: shift.id, expectedCashUsd: 50, closingCashUsd: bad as unknown as number })).toBeNull()
      expect(security.getActiveShift()?.id).toBe(shift.id)
    }
    const closed = security.closeShift({ shiftId: shift.id, expectedCashUsd: 50, closingCashUsd: 0 })!
    expect(closed.closingCashUsd).toBe(0)
    expect(closed.differenceUsd).toBe(-50)
  })

  it("a closed shift with no recorded count is 'not counted' and needs review; a counted 0 is a count", async () => {
    seed()
    window.localStorage.setItem(SHIFTS_KEY, JSON.stringify([
      { id: "sh-old", shiftNumber: "SH-1", status: "Closed", openedAt: "2026-10-01T08:00:00.000Z", closedAt: "2026-10-01T18:00:00.000Z", openingFloatUsd: 20, openedById: "u1", openedByName: "Owner" },
      { id: "sh-zero", shiftNumber: "SH-2", status: "Closed", openedAt: "2026-10-02T08:00:00.000Z", closedAt: "2026-10-02T18:00:00.000Z", openingFloatUsd: 20, closingCashUsd: 0, differenceUsd: -20, openedById: "u1", openedByName: "Owner" },
    ]))
    const { shifts } = await services()
    const [old, zero] = ["sh-old", "sh-zero"].map((id) => shifts.getRegisterShiftSummaries().find((s) => s.shiftId === id)!)
    expect(old.countedCash).toBeUndefined()
    expect(old.difference).toBeUndefined()
    expect(old.needsReview).toBe(true)
    expect(zero.countedCash).toBe(0)
    expect(zero.difference).toBe(-20)
    expect(zero.needsReview).toBe(true)
    // the stored history is left exactly as it was
    expect(read(SHIFTS_KEY)[0].closingCashUsd).toBeUndefined()
  })
})

describe("A. the drawer panel (rendered)", () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => { document.body.innerHTML = ""; container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container) })
  afterEach(async () => { await act(async () => root.unmount()) })
  const setValue = (input: HTMLInputElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  }

  for (const lang of ["en", "ar"]) it(`blank cannot close; a typed 0 closes with 0 counted (${lang})`, async () => {
    seed()
    localStorage.setItem("lebanonpos.locale", lang)
    const { security } = await services()
    const shift = security.openShift(30)!
    const { default: CashDrawerPanel } = await import("../features/pos/components/CashDrawerPanel")
    const { I18nProvider } = await import("@lebanonpos/shared") // the same module instance as the panel's
    await act(async () => { root.render(h(I18nProvider, null, h(CashDrawerPanel, { expanded: true, onToggle: () => {} }))) })
    const counted = container.querySelectorAll<HTMLInputElement>("input[type=number]")[0]
    const close = [...container.querySelectorAll("button")].find((b) => b.getAttribute("aria-describedby") === "drawer-count-why")!
    expect(close).toBeTruthy()
    expect(close.disabled).toBe(true)
    expect(counted.placeholder).not.toMatch(/\d/) // the expected amount is not shown as if already counted
    expect(container.querySelector("#drawer-count-why")?.textContent).toBeTruthy()
    await act(async () => { close.click() })
    expect(security.getActiveShift()?.id).toBe(shift.id)

    await act(async () => { setValue(counted, "0") })
    expect(close.disabled).toBe(false)
    await act(async () => { close.click() })
    expect(security.getActiveShift()).toBeUndefined()
    const stored = read(SHIFTS_KEY).find((s: any) => s.id === shift.id)
    expect(stored.status).toBe("Closed")
    expect(stored.closingCashUsd).toBe(0)
    expect(stored.differenceUsd).toBe(-30)
  })
})
