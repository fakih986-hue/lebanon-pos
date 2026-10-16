import { describe, it, expect, vi } from "vitest"

// The register's "Print receipt" (printLastSaleReceipt) must show the cash
// rounding and the cash payable, like the Sales-page reprint, so that
// total + rounding = paid − change on paper.
import { printLastSaleReceipt, type LastSaleSummary } from "../features/pos/lib/printReceipt"

function capture(summary: LastSaleSummary) {
  let html = ""
  vi.spyOn(window, "open").mockReturnValue({ document: { write: (h: string) => { html += h }, close() {} }, focus() {}, print() {} } as unknown as Window)
  vi.useFakeTimers()
  printLastSaleReceipt(summary, { vatRate: 11, receiptFooter: "" } as never)
  vi.useRealTimers()
  return html
}

const base: LastSaleSummary = {
  number: "S-TEST-1", paymentMethod: "Cash", grossSubtotal: 6.05, subtotal: 6.05, discountTotal: 0, tax: 0.67, total: 6.72,
  totalLbp: 601_440, exchangeRate: 89_500, items: [],
}

describe("register receipt (printLastSaleReceipt)", () => {
  it("prints the cash rounding and the cash payable when the sale was rounded", () => {
    const html = capture({ ...base, payableLbp: 605_000, payableUsd: 6.76 })
    expect(html).toContain("Cash rounding")
    expect(html).toMatch(/\+3,560/)
    expect(html).toContain("Cash payable")
    expect(html).toMatch(/605,000/)
    expect(html).toMatch(/\$6\.76/)
  })

  it("prints no rounding lines when nothing was rounded (or the sale was not cash)", () => {
    expect(capture({ ...base, payableLbp: 601_440 })).not.toContain("Cash rounding")
    expect(capture({ ...base, paymentMethod: "Card" })).not.toContain("Cash payable")
  })
})
