import { describe, it, expect, beforeEach, vi } from "vitest"
import { getReceiptPrinter, normalizeReceiptPrinter, receiptPageCss, setReceiptPrinter } from "../features/pos/lib/receiptPrinter"
import { printLastSaleReceipt } from "../features/pos/lib/printReceipt"

describe("receipt printer geometry (per device)", () => {
  beforeEach(() => window.localStorage.clear())

  it("defaults to an 80 mm roll printing 72 mm with a 2 mm safe margin", () => {
    expect(getReceiptPrinter()).toEqual({ paperMm: 80, printableMm: 72, marginMm: 2 })
  })

  it("keeps the printable width within the roll and leaves at least 30 mm of text", () => {
    expect(normalizeReceiptPrinter({ paperMm: 58, printableMm: 70 })).toMatchObject({ paperMm: 58, printableMm: 58 })
    expect(normalizeReceiptPrinter({ paperMm: 58 }).printableMm).toBe(48)
    expect(normalizeReceiptPrinter({ paperMm: 58, printableMm: 48, marginMm: 20 }).marginMm).toBe(9)
    expect(normalizeReceiptPrinter({ printableMm: -5, marginMm: -1 })).toMatchObject({ printableMm: 72, marginMm: 0 })
  })

  it("is stored on this device and drives the printed page width, roll size and margin", () => {
    setReceiptPrinter({ paperMm: 58, printableMm: 48, marginMm: 3 })
    const css = receiptPageCss()
    expect(css).toContain("size: 58mm auto")
    expect(css).toContain("width: 48mm")
    expect(css).toContain("padding: 3mm 3mm")
    let html = ""
    vi.spyOn(window, "open").mockReturnValue({ document: { write: (h: string) => { html += h }, close() {} }, focus() {}, print() {} } as unknown as Window)
    vi.useFakeTimers()
    printLastSaleReceipt({ number: "S-1", paymentMethod: "Cash", grossSubtotal: 1, subtotal: 1, discountTotal: 0, tax: 0, total: 1, totalLbp: 89500, exchangeRate: 89500,
      items: [{ id: 1, name: "مياه معدنية", barcode: "", quantity: 1, price: 1 }] }, { storeName: "S", branchName: "", phone: "", address: "", vatRate: 0.11, receiptFooter: "" } as never)
    vi.useRealTimers()
    expect(html).toContain("width: 48mm")
    expect(html).toMatch(/class="item-name" dir="auto">مياه معدنية/)
    expect(html).not.toMatch(/<table|<td/)
  })
})
