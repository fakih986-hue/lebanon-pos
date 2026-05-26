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
