import type { HeldSale } from "../services/heldSale.service"

export function parseMoney(value: string) {
  const parsedValue = Number(value.replace(/,/g, "").trim())
  return Number.isFinite(parsedValue) ? Math.max(0, parsedValue) : 0
}

export function formatVatRate(value: number) {
  const rate = value * 100
  return Number.isInteger(rate) ? `${rate}%` : `${rate.toFixed(2)}%`
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-LB", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}

export function getHeldSaleItemCount(heldSale: HeldSale) {
  return heldSale.items.reduce((sum, item) => sum + item.quantity, 0)
}

export function getHeldSaleGrossSubtotal(heldSale: HeldSale) {
  return heldSale.items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  )
}

export function getHeldSaleDiscountTotal(heldSale: HeldSale) {
  const grossSubtotal = getHeldSaleGrossSubtotal(heldSale)
  const discountValue = parseMoney(heldSale.discountValue)

  return Math.min(
    grossSubtotal,
    heldSale.discountMode === "Percent"
      ? grossSubtotal * (Math.min(100, discountValue) / 100)
      : discountValue
  )
}

export function getHeldSaleTotal(heldSale: HeldSale, vatRate: number) {
  const subtotal = Math.max(
    0,
    getHeldSaleGrossSubtotal(heldSale) - getHeldSaleDiscountTotal(heldSale)
  )
  return subtotal + subtotal * vatRate
}
