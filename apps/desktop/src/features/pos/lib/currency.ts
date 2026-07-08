const usdCurrencyFormatter = new Intl.NumberFormat("en-LB", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const numberFormatter = new Intl.NumberFormat("en-LB")

export function formatCurrency(value: number) {
  return formatUsdCurrency(value)
}

export function formatUsdCurrency(value: number) {
  return usdCurrencyFormatter.format(value)
}

export function formatLbpCurrency(value: number) {
  return `${numberFormatter.format(Math.round(value))} LBP`
}

export function formatNumber(value: number) {
  return numberFormatter.format(value)
}

/**
 * Round a USD money value to 2 decimal places using "round half away from zero".
 * Apply at every calculation boundary (tax, discount, total, change, profit, cost)
 * to prevent IEEE 754 float accumulation errors.
 * e.g. roundMoney(10.50 * 0.11) → 1.16  (not 1.1550000000000001)
 */
export function roundMoney(value: number): number {
  return Math.round((value + (value >= 0 ? Number.EPSILON : -Number.EPSILON)) * 100) / 100
}

export function usdToLbp(value: number, exchangeRate: number) {
  return value * Math.max(1, exchangeRate)
}

export function lbpToUsd(value: number, exchangeRate: number) {
  return roundMoney(value / Math.max(1, exchangeRate))
}

/**
 * Round an LBP amount to the nearest banknote-friendly increment so cashiers
 * never have to make awkward change. Default nearest 5,000 LBP.
 */
export function roundLbp(value: number, nearest = 5000) {
  if (nearest <= 0) return Math.round(value)
  return Math.round(value / nearest) * nearest
}

/** Convert USD → LBP and round to a clean banknote increment. */
export function usdToLbpRounded(value: number, exchangeRate: number, nearest = 5000) {
  return roundLbp(usdToLbp(value, exchangeRate), nearest)
}

export function formatLbpRounded(value: number, nearest = 5000) {
  return formatLbpCurrency(roundLbp(value, nearest))
}

/**
 * Cash change for a sale, tender-mode aware.
 *
 * Pure-LBP tenders compute the LBP change directly (paidLbp − totalLbp) so the
 * displayed change matches banknote arithmetic exactly. Converting through USD
 * first loses up to half a cent to 2-decimal rounding, which shows up as a
 * few-hundred-LBP drift (e.g. 250,000 paid on 1,790 due must give 248,210,
 * not 247,915). USD and mixed tenders keep the USD-canonical path.
 */
export function computeCashChange(input: {
  paidUsd: number
  paidLbp: number
  totalUsd: number
  totalLbp: number
  exchangeRate: number
}): { changeUsd: number; changeLbp: number } {
  const { paidUsd, paidLbp, totalUsd, totalLbp, exchangeRate } = input
  const paidTotalUsd = roundMoney(paidUsd + lbpToUsd(paidLbp, exchangeRate))
  const changeUsd = roundMoney(Math.max(0, paidTotalUsd - totalUsd))

  if (paidUsd === 0 && paidLbp > 0) {
    return { changeUsd, changeLbp: Math.max(0, paidLbp - totalLbp) }
  }
  return { changeUsd, changeLbp: usdToLbp(changeUsd, exchangeRate) }
}
