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

export function usdToLbp(value: number, exchangeRate: number) {
  return value * Math.max(1, exchangeRate)
}

export function lbpToUsd(value: number, exchangeRate: number) {
  return value / Math.max(1, exchangeRate)
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
