import type { LucideIcon } from "lucide-react"
import { Banknote, CreditCard, HandCoins, WalletCards } from "lucide-react"

import type { Sale, SaleItem, SaleRefund, SalePaymentMethod } from "../services/sales.service"
import { getLineRefundableQuantity, priorRefundLinesOf, refundLineKeyOf } from "../services/sales.service"
import { refundedQuantity } from "./refundAllocation"

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

/**
 * Quantity already refunded on this sale line (REFUND-INTEGRITY-1: per line,
 * not per product — two lines of the same product are tracked separately;
 * legacy lines without a line id are pooled per product).
 */
export function getRefundedQuantity(
  refunds: SaleRefund[],
  saleId: string,
  item: Pick<SaleItem, "id" | "lineId">
) {
  return refundedQuantity(refundLineKeyOf(item), priorRefundLinesOf(refunds, saleId))
}

export function getRefundableQuantity(
  sale: Sale,
  item: SaleItem,
  refunds: SaleRefund[]
) {
  return getLineRefundableQuantity(sale, item, refunds)
}

export function getRefundMethod(sale: Sale): "Cash" | "Card" | "Wallet" | "Debt_Credit" {
  return sale.paymentMethod === "Debt" ? "Debt_Credit" : sale.paymentMethod
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

export function escapeHtml(value: string | undefined | null) {
  const s = value ?? ""
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}
