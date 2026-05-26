import type { LucideIcon } from "lucide-react"
import { Banknote, CreditCard, HandCoins, WalletCards } from "lucide-react"

import type { Sale, SaleItem, SaleRefund, SalePaymentMethod } from "../services/sales.service"

export const paymentIcons: Record<SalePaymentMethod, LucideIcon> = {
  Cash: Banknote,
  Card: CreditCard,
  Wallet: WalletCards,
  Debt: HandCoins,
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-LB", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}

export function formatReceiptDate(value: string) {
  return new Intl.DateTimeFormat("en-LB", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}

export function getSaleQuantity(sale: Sale) {
  return sale.items.reduce((sum, item) => sum + item.quantity, 0)
}

export function getSaleGrossSubtotal(sale: Sale) {
  return sale.items.reduce((sum, item) => sum + item.total, 0)
}

export function parseReturnQuantity(value: string) {
  const parsedValue = Number(value)

  return Number.isFinite(parsedValue) ? Math.max(0, Math.floor(parsedValue)) : 0
}

export function getSaleRefunds(refunds: SaleRefund[], saleId: string) {
  return refunds.filter((refund) => refund.saleId === saleId)
}

export function getSaleRefundTotal(refunds: SaleRefund[], saleId: string) {
  return getSaleRefunds(refunds, saleId).reduce(
    (sum, refund) => sum + refund.total,
    0
  )
}

export function getRefundedQuantity(
  refunds: SaleRefund[],
  saleId: string,
  itemId: number
) {
  return getSaleRefunds(refunds, saleId).reduce((sum, refund) => {
    const refundedItem = refund.items.find((item) => item.id === itemId)

    return sum + (refundedItem?.quantity ?? 0)
  }, 0)
}

export function getRefundableQuantity(
  sale: Sale,
  item: SaleItem,
  refunds: SaleRefund[]
) {
  return Math.max(
    0,
    item.quantity - getRefundedQuantity(refunds, sale.id, item.id)
  )
}

export function getRefundMethod(sale: Sale): "Cash" | "Card" | "Wallet" | "Debt Credit" {
  return sale.paymentMethod === "Debt" ? "Debt Credit" : sale.paymentMethod
}

export function getRefundTotal(sale: Sale, refundItems: SaleItem[]) {
  const grossSubtotal = getSaleGrossSubtotal(sale)
  const refundGrossSubtotal = refundItems.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity,
    0
  )

  if (grossSubtotal <= 0) {
    return 0
  }

  return refundGrossSubtotal * (sale.total / grossSubtotal)
}

export function getSaleExchangeRate(sale: Sale, fallbackRate: number) {
  return sale.tender?.exchangeRate ?? fallbackRate
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}
