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
