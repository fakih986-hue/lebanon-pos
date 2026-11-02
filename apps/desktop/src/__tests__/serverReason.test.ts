// Release batch — what a cashier reads: a server's known reason codes as sentences (with the product it named) in the
// cashier's language, unknown errors as sent; option lists with the Arabic comma in Arabic.
import { describe, expect, it } from "vitest"
import { serverReason } from "../features/pos/lib/serverReason"
import { lineOptionsText } from "../features/pos/lib/lineOptions"
import { en } from "../../../../packages/shared/src/i18n/en"
import { ar } from "../../../../packages/shared/src/i18n/ar"

const tOf = (dict: Record<string, string>) => (key: string, params: Record<string, string | number> = {}) =>
  key in dict ? dict[key].replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? "")) : key

describe("server reasons", () => {
  it("known codes are sentences in English and Arabic, naming the product", () => {
    const err = 'INGREDIENT_SHORT: Not enough "Oat milk" for "Cappuccino" (needs 750 ml, 500 ml in stock).'
    expect(serverReason(tOf(en), err)).toBe("Not enough ingredients for Oat milk.")
    expect(serverReason(tOf(ar), err)).toBe("المكونات لا تكفي لـ Oat milk.")
    expect(serverReason(tOf(ar), 'PRODUCT_PENDING: "Beans" has not reached this server yet')).toMatch(/^بانتظار وصول Beans/)
    expect(serverReason(tOf(ar), "TOPOLOGY_USE_HUB: this register should connect to the store hub")).toMatch(/الخادم المحلي/)
  })
  it("an unknown code or a plain message is shown as sent (a safe fallback)", () => {
    expect(serverReason(tOf(ar), "SOMETHING_NEW: a detail")).toBe("SOMETHING_NEW: a detail")
    expect(serverReason(tOf(ar), "Server error")).toBe("Server error")
    expect(serverReason(tOf(ar), undefined)).toBe("")
  })
})

describe("option lists", () => {
  it("joined with the Arabic comma in Arabic, the Latin comma otherwise", () => {
    const item = { modifiers: [{ name: "Large", nameAr: "كبير" }, { name: "Oat milk", nameAr: "حليب الشوفان" }], note: "" }
    expect(lineOptionsText(item, "ar")).toBe("كبير، حليب الشوفان")
    expect(lineOptionsText(item, "en")).toBe("Large, Oat milk")
  })
})
