// Cost availability. A till signed in without "See cost & profit" (reports.cost) receives no
// cost from the server: product, lot and sale-line costs arrive absent. A manager unlocking
// that till may see cost, but the data is still missing. Such a cost is "unavailable": it is
// shown as "Not available", never guessed (no 0, no product-cost fallback), and anything
// computed from it (a total, margin, profit, COGS, stock value) is unavailable too.
import { formatUsdCurrency } from "./currency"

/** A cost is available only when it is a finite number (not undefined, null or NaN). */
export function isCostAvailable(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

/** The sum of the given amounts, or undefined when any of them is unavailable. */
export function sumAvailable(values: Iterable<unknown>): number | undefined {
  let total = 0
  for (const v of values) {
    if (!isCostAvailable(v)) return undefined
    total += v
  }
  return total
}

/** A cost as money, or `unavailable` (the localized "Not available") when it is unavailable. */
export function formatCost(value: unknown, unavailable: string): string {
  return isCostAvailable(value) ? formatUsdCurrency(value) : unavailable
}

/** The cost a person typed in a form, or undefined when the field was left blank (nothing to send). */
export function typedCost(text: string): number | undefined {
  if (text.trim() === "") return undefined
  const n = Number(text)
  return Number.isFinite(n) ? n : undefined
}
