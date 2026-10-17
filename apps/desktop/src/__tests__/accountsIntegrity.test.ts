// ACCOUNTS-1 — customers, suppliers and receipts keep their money history:
//  - archived customers / suppliers can be listed (and so restored);
//  - one with any sale, purchase order or payment cannot be deleted (only archived);
//  - a payment pressed twice is recorded once (customer and supplier pages);
//  - a refund confirmed twice is recorded once (Sales page).
// Real services and the real pages (jsdom); no network.
import { act, createElement, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const K = {
  users: "lebanonpos.users.v1", current: "lebanonpos.current-user.v1", customers: "lebanonpos.customers.v1",
  debtSales: "lebanonpos.debt-sales.v1", debtPayments: "lebanonpos.debt-payments.v1", suppliers: "lebanonpos.suppliers.v1",
  pos: "lebanonpos.purchase-orders.v1", supplierPayments: "lebanonpos.supplier-payments.v1", sales: "lebanonpos.sales.v1",
  refunds: "lebanonpos.refunds.v1", products: "lebanonpos.products.v1", batches: "lebanonpos.inventory-batches.v1",
}
const read = <T = Record<string, unknown>>(k: string): T[] => { try { const v = JSON.parse(localStorage.getItem(k) ?? "[]"); return Array.isArray(v) ? v : [] } catch { return [] } }
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function seed() {
  localStorage.setItem(K.users, JSON.stringify([{ id: "u1", name: "Owner", role: "Admin", pin: "HASH", code: "OWN", active: true, permissions: [] }]))
  localStorage.setItem(K.current, "u1")
  localStorage.setItem(K.customers, JSON.stringify([
    { id: "cust-1", name: "Nour", mobile: "70111222", creditLimit: 500, notes: "", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "cust-2", name: "Rami", mobile: "70333444", creditLimit: 0, notes: "", createdAt: "2026-01-02T00:00:00.000Z" },
  ]))
  localStorage.setItem(K.debtSales, JSON.stringify([
    { id: "debt-s1", customerId: "cust-1", saleNumber: "S-1", subtotal: 30, tax: 0, total: 30, items: [], createdAt: "2026-10-01T10:00:00.000Z" },
  ]))
  localStorage.setItem(K.suppliers, JSON.stringify([
    { id: "sup-1", name: "Malia Group", mobile: "01222333", contact: "Hadi", address: "", notes: "", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "sup-2", name: "Empty Co", mobile: "01444555", contact: "", address: "", notes: "", createdAt: "2026-01-01T00:00:00.000Z" },
  ]))
  localStorage.setItem(K.pos, JSON.stringify([
    { id: "po-1", poNumber: "PO-1", supplierId: "sup-1", supplierName: "Malia Group", status: "Received", paymentStatus: "Unpaid", paymentMethod: "On Account", total: 40, paidTotal: 0, items: [], createdAt: "2026-10-01T10:00:00.000Z" },
  ]))
  localStorage.setItem(K.products, JSON.stringify([{ id: 1, name: "Cola", barcode: "111", price: 5, cost: 2, stock: 0, category: "Drinks" }]))
  localStorage.setItem(K.batches, JSON.stringify([
    { id: "lot-a", batchNumber: "A", productId: 1, productName: "Cola", barcode: "111", initialQuantity: 10, quantityRemaining: 0, unitCost: 2, unitPrice: 5, receivedAt: "2026-01-01T00:00:00.000Z", status: "Consumed" },
  ]))
  localStorage.setItem(K.sales, JSON.stringify([{
    id: "sale-1", saleNumber: "S-1", paymentMethod: "Cash", subtotal: 50, tax: 0, total: 50, cost: 20, profit: 30,
    cashier: "Owner", status: "Completed", createdAt: "2026-10-01T10:00:00.000Z",
    tender: { currency: "USD", exchangeRate: 89500, paidUsd: 50, paidLbp: 0, paidTotalUsd: 50, paidTotalLbp: 4475000, changeUsd: 0, changeLbp: 0, changeCurrency: "USD" },
    items: [{ id: 1, lineId: "L1", name: "Cola", barcode: "111", cost: 2, quantity: 10, unitPrice: 5, total: 50, batchAllocations: [{ batchId: "lot-a", batchNumber: "A", quantity: 10, unitCost: 2 }] }],
  }]))
}

let root: Root | null = null
let host: HTMLDivElement | null = null
/** Providers from the same (reset) module graph as the page under test. */
async function wrap(node: ReactNode) {
  const { I18nProvider } = await import("@lebanonpos/shared")
  const { MemoryRouter } = await import("react-router")
  return createElement(I18nProvider, null, createElement(MemoryRouter, null, node))
}
async function render(node: ReactNode) {
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
  const tree = await wrap(node)
  await act(async () => { root!.render(tree) })
}
const all = (sel = "button, a") => [...document.querySelectorAll<HTMLElement>(sel)]
const nameOf = (e: Element) => (e.getAttribute("aria-label") || e.textContent || "").replace(/\s+/g, " ").trim()
const button = (re: RegExp, pick: "first" | "last" = "first") => {
  const found = all("button").filter((b) => re.test(nameOf(b)) && !(b as HTMLButtonElement).disabled)
  const b = pick === "last" ? found.at(-1) : found[0]
  if (!b) throw new Error(`no button ${re}: ${all("button").map(nameOf).join(" | ")}`)
  return b
}
/** An input found by its label, aria-label or placeholder. */
function field(re: RegExp) {
  const inputs = [...document.querySelectorAll<HTMLInputElement>("input, textarea, select")]
  const label = (i: HTMLElement) => [i.getAttribute("aria-label"), i.getAttribute("placeholder"), i.closest("label")?.textContent, i.id ? document.querySelector(`label[for="${i.id}"]`)?.textContent : ""].join(" ")
  const f = inputs.find((i) => re.test(label(i)))
  if (!f) throw new Error(`no field ${re}`)
  return f
}
function type(el: HTMLInputElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value)
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }))
}
const click = async (el: HTMLElement) => { await act(async () => { el.click() }) }

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline in this test"))))
  seed()
})
afterEach(async () => {
  if (root) await act(async () => { root!.unmount() })
  host?.remove(); root = null; host = null
  document.body.innerHTML = ""
  vi.unstubAllGlobals()
})

describe("customers and suppliers keep their history", () => {
  it("archived customers and suppliers can be listed for restore", async () => {
    const customer = await import("../features/pos/services/customer.service")
    const supplier = await import("../features/pos/services/supplier.service")
    customer.archiveCustomer("cust-2")
    supplier.archiveSupplier("sup-2")
    expect(customer.getCustomerLedger().map((c) => c.id)).toEqual(["cust-1"])
    expect(customer.getCustomerLedger({ includeArchived: true }).find((c) => c.id === "cust-2")?.archived).toBe(true)
    expect(supplier.getSupplierLedger({ includeArchived: true }).find((s) => s.id === "sup-2")?.archived).toBe(true)
    customer.restoreCustomer("cust-2")
    expect(customer.getCustomerLedger().map((c) => c.id).sort()).toEqual(["cust-1", "cust-2"])
  })

  it("a customer or supplier with money history cannot be deleted; one without can", async () => {
    const customer = await import("../features/pos/services/customer.service")
    const supplier = await import("../features/pos/services/supplier.service")
    expect(() => customer.deleteCustomer("cust-1")).toThrow(/CUSTOMER_HAS_HISTORY/)
    expect(read(K.debtSales)).toHaveLength(1)
    expect(customer.getCustomerLedger().find((c) => c.id === "cust-1")?.balance).toBe(30)
    expect(() => supplier.deleteSupplier("sup-1")).toThrow(/SUPPLIER_HAS_HISTORY/)
    expect(read(K.pos)).toHaveLength(1)
    customer.deleteCustomer("cust-2")
    supplier.deleteSupplier("sup-2")
    expect(read(K.customers).map((c) => c.id)).toEqual(["cust-1"])
    expect(read(K.suppliers).map((s) => s.id)).toEqual(["sup-1"])
  })
})

describe("pages: a second press records nothing more", () => {
  it("customer payment pressed twice: one payment", async () => {
    const { default: CustomersPage } = await import("../pages/customers/CustomersPage")
    await render(createElement(CustomersPage))
    await click(button(/^pay debt|^record a payment|^receive payment/i))
    const amount = field(/amount/i) as HTMLInputElement
    await act(async () => { type(amount, "10") })
    const pay = button(/record payment|^receive /i, "last")
    await act(async () => { pay.click(); pay.click() })
    expect(read<{ customerId: string; amount: number }>(K.debtPayments).filter((p) => p.customerId === "cust-1")).toHaveLength(1)
  })

  it("supplier payment pressed twice: one payment", async () => {
    const { default: SuppliersPage } = await import("../pages/suppliers/SuppliersPage")
    await render(createElement(SuppliersPage))
    await click(button(/^pay supplier|^record a payment|^pay /i))
    const amount = field(/amount/i) as HTMLInputElement
    await act(async () => { type(amount, "10") })
    const pay = button(/record payment|^pay \$/i, "last")
    await act(async () => { pay.click(); pay.click() })
    expect(read<{ supplierId: string }>(K.supplierPayments).filter((p) => p.supplierId === "sup-1")).toHaveLength(1)
  })

  it("refund confirmed twice: one refund", async () => {
    const security = await import("../features/pos/services/security.service")
    security.openShift(100)
    const { default: SalesPage } = await import("../pages/sales/SalesPage")
    await render(createElement(SalesPage))
    const open = all("button").find((b) => /^returns|^refund/i.test(nameOf(b)))
    if (open) await click(open)
    const qty = [...document.querySelectorAll<HTMLInputElement>("input[type=number]")].find((i) => !i.disabled)!
    await act(async () => { type(qty, "2") })
    await click(button(/record return|^refund \$/i))
    const confirm = button(/record return|^refund \$/i, "last")
    await act(async () => { confirm.click(); confirm.click() })
    expect(read(K.refunds)).toHaveLength(1)
  })
})

