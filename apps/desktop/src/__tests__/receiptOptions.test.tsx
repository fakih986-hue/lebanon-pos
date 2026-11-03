// Batch 82: the on-screen receipt (Sales › receipt) shows a drink's options under its name, as the printed
// receipt and the cart do; a packaged line shows none. Two Lattes with different options are told apart in
// the return list too.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, createElement as h, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { MemoryRouter } from "react-router"
import { I18nProvider } from "@lebanonpos/shared"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("../features/pos/services/security.service", async (original) => ({
  ...(await original<typeof import("../features/pos/services/security.service")>()),
  userCan: () => true,
}))
// jsdom has no IndexedDB; the mirror is not under test here.
vi.mock("../features/pos/services/db", () => ({
  getAll: async () => [], getById: async () => undefined, put: async () => {}, putMany: async () => {},
  del: async () => {}, clear: async () => {}, count: async () => 0,
}))

import SalesPage from "../pages/sales/SalesPage"

let container: HTMLDivElement
let root: Root
async function render(node: ReactNode) {
  await act(async () => { root.render(h(I18nProvider, null, h(MemoryRouter, null, node))) })
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
}
const mod = (groupName: string, name: string, nameAr: string, priceDelta: number) => ({ groupId: `g-${groupName}`, groupName, groupNameAr: "", optionId: `o-${name}`, name, nameAr, priceDelta })
const sale = {
  id: "s-cafe", saleNumber: "S-CAFE-1", createdAt: new Date().toISOString(), paymentMethod: "Cash", subtotal: 8.5, tax: 0, total: 8.5, cashier: "IT", status: "Completed",
  items: [
    { id: 1, lineId: "L1", name: "Latte", barcode: "", quantity: 1, unitPrice: 4.5, total: 4.5, basePrice: 3, stockPolicy: "recipe", modifiers: [mod("Size", "Large", "كبير", 0.5), mod("Milk", "Oat milk", "حليب الشوفان", 0.5), mod("Extra shot", "Extra shot", "شوت إضافي", 0.5)] },
    { id: 1, lineId: "L2", name: "Latte", barcode: "", quantity: 1, unitPrice: 3, total: 3, basePrice: 3, stockPolicy: "recipe", modifiers: [mod("Size", "Regular", "عادي", 0), mod("Milk", "Full-fat milk", "حليب كامل الدسم", 0)] },
    { id: 2, lineId: "L3", name: "Pepsi 330 ml", barcode: "990082000001", quantity: 1, unitPrice: 1, total: 1, stockPolicy: "tracked" },
  ],
}

beforeEach(() => {
  localStorage.clear()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe("the on-screen receipt shows each drink's options", () => {
  for (const lang of ["en", "ar"] as const) it(`receipt lines and the return list (${lang})`, async () => {
    localStorage.setItem("lebanonpos.language", lang)
    localStorage.setItem("lebanonpos.locale", lang)
    localStorage.setItem("lebanonpos.sales.v1", JSON.stringify([sale]))
    await render(h(SalesPage))
    const row = [...container.querySelectorAll("button, [role=button], tr, li, div")].find((e) => e.textContent?.trim().startsWith("S-CAFE-1")) as HTMLElement
    expect(row).toBeTruthy()
    await act(async () => { row.click() })
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    const lines = [...document.querySelectorAll("[data-testid=rcpt-line-options]")].map((e) => e.textContent)
    expect(lines).toEqual(lang === "ar" ? ["كبير، حليب الشوفان، شوت إضافي", "عادي، حليب كامل الدسم"] : ["Large, Oat milk, Extra shot", "Regular, Full-fat milk"])
    // the return list tells the two Lattes apart
    const ret = [...document.querySelectorAll("button")].find((b) => /Return items|إرجاع/.test(b.textContent ?? ""))
    if (ret) {
      await act(async () => { ret.click() })
      const labels = [...document.querySelectorAll("section label")].map((l) => l.textContent ?? "")
      expect(labels.filter((l) => /Latte/.test(l)).length).toBe(2)
      expect(labels.some((l) => l.includes(lines[0]!))).toBe(true)
      expect(labels.some((l) => l.includes(lines[1]!))).toBe(true)
    }
  })
})

// ── printed receipt, reprint, the completed-sale panel and the WhatsApp text (batch 83) ──
const printed = async (print: () => void) => {
  let html = ""
  const win = { document: { write: (h: string) => { html += h }, close: () => undefined }, focus: () => undefined, print: () => undefined, close: () => undefined, addEventListener: () => undefined, onload: null as unknown }
  const open = vi.spyOn(window, "open").mockReturnValue(win as unknown as Window)
  print()
  open.mockRestore()
  return html
}
const settings = { storeName: "IT Café", branchName: "", address: "", phone: "", receiptFooter: "", usdToLbpRate: 89500 } as any

describe("printed receipts and reprints carry each line's sale-time options", () => {
  for (const lang of ["en", "ar"] as const) it(`sales reprint and POS print, ${lang}; a legacy line shows none; long names wrap`, async () => {
    localStorage.setItem("lebanonpos.locale", lang)
    const { printSaleReceipt, printLastSaleReceipt } = await import("../features/pos/lib/printReceipt")
    const long = { id: 3, lineId: "L4", name: "Extra-long seasonal hazelnut caramel oat-milk latte with cinnamon dusting", barcode: "", quantity: 1, unitPrice: 5, total: 5, stockPolicy: "recipe", modifiers: [mod("Size", "Large", "كبير", 0.5)] }
    const withLong = { ...sale, items: [...sale.items, long] }
    const reprint = await printed(() => printSaleReceipt(withLong as any, 89500, [], settings))
    const pos = await printed(() => printLastSaleReceipt({ number: "S-CAFE-1", paymentMethod: "Cash", grossSubtotal: 8.5, subtotal: 8.5, discountTotal: 0, tax: 0, total: 8.5, totalLbp: 760750, exchangeRate: 89500,
      items: sale.items.map((i: any) => ({ ...i, price: i.unitPrice })) } as any, settings))
    const want = lang === "ar" ? ["كبير، حليب الشوفان، شوت إضافي", "عادي، حليب كامل الدسم"] : ["Large, Oat milk, Extra shot", "Regular, Full-fat milk"]
    for (const html of [reprint, pos]) {
      for (const w of want) expect(html).toContain(w)
      // Pepsi (no options, an older line): its block has no options row
      const at = html.indexOf("Pepsi 330 ml"), next = html.indexOf('class="item"', at)
      const pepsi = html.slice(at, next === -1 ? at + 400 : next)
      expect(pepsi).not.toMatch(/Large|Oat|كبير/)
    }
    expect(reprint).toContain("Extra-long seasonal hazelnut caramel oat-milk latte with cinnamon dusting")
    expect(reprint).toMatch(/overflow-wrap: anywhere/)
  })

  it("58 mm and 80 mm rolls: the printable width is used, and text wraps", async () => {
    const { printSaleReceipt } = await import("../features/pos/lib/printReceipt")
    for (const [paperMm, printableMm] of [[58, 48], [80, 72]] as const) {
      localStorage.setItem("lebanonpos.receipt-printer.v1", JSON.stringify({ paperMm, printableMm, marginMm: 2 }))
      const html = await printed(() => printSaleReceipt(sale as any, 89500, [], settings))
      expect(html).toContain(`width: ${printableMm}mm`)
      expect(html).toContain("Large, Oat milk, Extra shot")
    }
  })

  it("a receipt keeps the options as sold when the menu option is renamed later", async () => {
    localStorage.setItem("lebanonpos.locale", "en")
    // the menu's option is renamed (Oat milk → Oat drink); the sale line keeps its own snapshot
    localStorage.setItem("lebanonpos.modifier-groups.v1", JSON.stringify([{ id: "g-Milk", name: "Milk", options: [{ id: "o-Oat milk", name: "Oat drink", priceDelta: 0.5 }] }]))
    const { printSaleReceipt } = await import("../features/pos/lib/printReceipt")
    const html = await printed(() => printSaleReceipt(sale as any, 89500, [], settings))
    expect(html).toContain("Large, Oat milk, Extra shot")
    expect(html).not.toContain("Oat drink")
  })
})

describe("the completed-sale panel and the WhatsApp receipt", () => {
  it("the panel lists the lines with their options; a line without options shows none", async () => {
    localStorage.setItem("lebanonpos.locale", "en")
    const { default: SaleCompleteOverlay } = await import("../features/pos/components/SaleCompleteOverlay")
    await render(h(SaleCompleteOverlay, { sale: { number: "S-CAFE-1", total: 8.5, totalLbp: 760750, paymentMethod: "Card", items: sale.items as any } }))
    const opts = [...container.querySelectorAll("[data-testid=sale-complete-options]")].map((e) => e.textContent)
    expect(opts).toEqual(["Large, Oat milk, Extra shot", "Regular, Full-fat milk"])
    expect(container.textContent).toContain("Pepsi 330 ml")
  })

  it("the WhatsApp text names each line's options", async () => {
    const { receiptMessage } = await import("../features/pos/lib/whatsapp")
    const text = receiptMessage({ storeName: "IT Café", saleNumber: "S-CAFE-1", total: 5.5, totalLbp: 492250, items: [{ name: "Latte", quantity: 1, total: 4.5, options: "Large, Oat milk" }, { name: "Pepsi 330 ml", quantity: 1, total: 1 }] })
    expect(text).toContain("1× Latte (Large, Oat milk) — $4.50")
    expect(text).toContain("1× Pepsi 330 ml — $1.00")
  })
})
