import type { Product } from "../types/product"
import type { BatchAllocation } from "./inventoryBatch.service"
import { restoreInventoryBatches } from "./inventoryBatch.service"
import { increaseProductStock } from "./product.service"
import { reverseDebtSale } from "./customer.service"
import { getSettings } from "./settings.service"
import {
  getActiveShift,
  getCurrentUser,
  recordAuditEvent,
} from "./security.service"
import { enqueueSyncOperation } from "./sync.service"
import { writeLocalWithIndexedDB } from "./storage.service"

const SALES_KEY = "lebanonpos.sales.v1"
const REFUNDS_KEY = "lebanonpos.refunds.v1"
const SALES_EVENT = "lebanonpos-sales-changed"
const REFUNDS_EVENT = "lebanonpos-refunds-changed"

export type SalePaymentMethod = "Cash" | "Card" | "Wallet" | "Debt"

export type SaleTender = {
  currency: "USD" | "LBP" | "Mixed"
  exchangeRate: number
  paidUsd: number
  paidLbp: number
  paidTotalUsd: number
  paidTotalLbp: number
  changeUsd: number
  changeLbp: number
  changeCurrency: "USD" | "LBP"
}

export type SaleItem = Pick<Product, "id" | "name" | "barcode" | "cost"> & {
  quantity: number
  unitPrice: number
  total: number
  batchAllocations?: BatchAllocation[]
}

export type RefundMethod = "Cash" | "Card" | "Wallet" | "Debt Credit"

export type RefundItem = Pick<Product, "id" | "name" | "barcode"> & {
  quantity: number
  unitPrice: number
  cost?: number
  total: number
  batchAllocations?: BatchAllocation[]
}

export type Sale = {
  id: string
  saleNumber: string
  paymentMethod: SalePaymentMethod
  customerId?: string
  customerName?: string
  subtotal: number
  discountTotal?: number
  tax: number
  total: number
  cost: number
  profit: number
  tender?: SaleTender
  items: SaleItem[]
  cashier: string
  shiftId?: string
  shiftNumber?: string
  status: "Completed" | "Debt" | "Voided"
  createdAt: string
}

export type SaleRefund = {
  id: string
  refundNumber: string
  saleId: string
  saleNumber: string
  customerId?: string
  customerName?: string
  method: RefundMethod
  reason: string
  total: number
  items: RefundItem[]
  cashier: string
  shiftId?: string
  shiftNumber?: string
  createdAt: string
}

export type RecordSaleInput = {
  saleNumber: string
  paymentMethod: SalePaymentMethod
  customerId?: string
  customerName?: string
  subtotal: number
  discountTotal?: number
  tax: number
  total: number
  tender?: SaleTender
  items: SaleItem[]
}

export type RecordRefundInput = {
  saleId: string
  saleNumber: string
  customerId?: string
  customerName?: string
  method: RefundMethod
  reason: string
  total: number
  items: RefundItem[]
}

function canUseStorage() {
  return typeof window !== "undefined" && Boolean(window.localStorage)
}

function readSales() {
  if (!canUseStorage()) {
    return []
  }

  const storedSales = window.localStorage.getItem(SALES_KEY)

  if (!storedSales) {
    return []
  }

  try {
    const parsedSales = JSON.parse(storedSales)

    return Array.isArray(parsedSales) ? (parsedSales as Sale[]) : []
  } catch {
    console.warn(`[sales.service] Failed to parse storage key`)
    return []
  }
}

function writeSales(sales: Sale[]) {
  if (!canUseStorage()) {
    return
  }

  writeLocalWithIndexedDB(SALES_KEY, sales)
  window.dispatchEvent(new Event(SALES_EVENT))
}

function readRefunds() {
  if (!canUseStorage()) {
    return []
  }

  const storedRefunds = window.localStorage.getItem(REFUNDS_KEY)

  if (!storedRefunds) {
    return []
  }

  try {
    const parsedRefunds = JSON.parse(storedRefunds)

    return Array.isArray(parsedRefunds) ? (parsedRefunds as SaleRefund[]) : []
  } catch {
    console.warn(`[sales.service] Failed to parse storage key`)
    return []
  }
}

function writeRefunds(refunds: SaleRefund[]) {
  if (!canUseStorage()) {
    return
  }

  writeLocalWithIndexedDB(REFUNDS_KEY, refunds)
  window.dispatchEvent(new Event(REFUNDS_EVENT))
  window.dispatchEvent(new Event(SALES_EVENT))
}

function isToday(value: string) {
  const date = new Date(value)
  const today = new Date()

  return date.toDateString() === today.toDateString()
}

function getSaleGrossSubtotal(sale: Sale) {
  return sale.items.reduce((sum, item) => sum + item.total, 0)
}

function getRefundCost(refund: SaleRefund, sales: Sale[]) {
  const sale = sales.find((currentSale) => currentSale.id === refund.saleId)

  return refund.items.reduce((sum, item) => {
    const saleItem = sale?.items.find((currentItem) => currentItem.id === item.id)
    const unitCost = item.cost ?? saleItem?.cost ?? 0

    return sum + unitCost * item.quantity
  }, 0)
}

function getRefundPreTax(refund: SaleRefund, sales: Sale[]) {
  const sale = sales.find((currentSale) => currentSale.id === refund.saleId)

  if (!sale) {
    return refund.total
  }

  const grossSubtotal = getSaleGrossSubtotal(sale)

  if (grossSubtotal <= 0) {
    return refund.total
  }

  const refundGrossSubtotal = refund.items.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity,
    0
  )

  return refundGrossSubtotal * (sale.subtotal / grossSubtotal)
}

export function getSales() {
  return readSales()
}

export function getRefunds() {
  return readRefunds()
}

export function getRefundsForSale(saleId: string) {
  return getRefunds().filter((refund) => refund.saleId === saleId)
}

export function recordSale(input: RecordSaleInput) {
  const cost = input.items.reduce(
    (sum, item) => sum + item.cost * item.quantity,
    0
  )
  const currentUser = getCurrentUser()
  const activeShift = getActiveShift()
  const sale: Sale = {
    id: crypto.randomUUID(),
    saleNumber: input.saleNumber,
    paymentMethod: input.paymentMethod,
    customerId: input.customerId,
    customerName: input.customerName,
    subtotal: input.subtotal,
    discountTotal: input.discountTotal,
    tax: input.tax,
    total: input.total,
    cost,
    profit: input.subtotal - cost,
    tender: input.tender,
    items: input.items,
    cashier: currentUser.name,
    shiftId: activeShift?.id,
    shiftNumber: activeShift?.shiftNumber,
    status: input.paymentMethod === "Debt" ? "Debt" : "Completed",
    createdAt: new Date().toISOString(),
  }

  writeSales([sale, ...getSales()])
  recordAuditEvent({
    action: "sale.complete",
    entity: "sale",
    summary: `${sale.saleNumber} completed by ${sale.cashier} for $${sale.total.toFixed(
      2
    )}.`,
    metadata: {
      saleId: sale.id,
      paymentMethod: sale.paymentMethod,
      discountTotal: sale.discountTotal ?? 0,
      total: sale.total,
      shiftId: sale.shiftId,
      shiftNumber: sale.shiftNumber,
    },
  })
  enqueueSyncOperation({
    entity: "sale",
    action: "create",
    summary: `${sale.saleNumber} sale queued for sync.`,
    payload: sale,
  })

  return sale
}

export function recordRefund(input: RecordRefundInput) {
  const currentUser = getCurrentUser()
  const activeShift = getActiveShift()
  const refund: SaleRefund = {
    id: crypto.randomUUID(),
    refundNumber: `R-${Date.now().toString().slice(-6)}`,
    saleId: input.saleId,
    saleNumber: input.saleNumber,
    customerId: input.customerId,
    customerName: input.customerName,
    method: input.method,
    reason: input.reason.trim() || "Customer return",
    total: input.total,
    items: input.items,
    cashier: currentUser.name,
    shiftId: activeShift?.id,
    shiftNumber: activeShift?.shiftNumber,
    createdAt: new Date().toISOString(),
  }

  writeRefunds([refund, ...getRefunds()])
  recordAuditEvent({
    action: "sale.refund",
    entity: "sale",
    summary: `${refund.refundNumber} refunded ${input.saleNumber} for $${refund.total.toFixed(
      2
    )}.`,
    metadata: {
      refundId: refund.id,
      saleId: refund.saleId,
      saleNumber: refund.saleNumber,
      method: refund.method,
      total: refund.total,
      shiftId: refund.shiftId,
      shiftNumber: refund.shiftNumber,
    },
  })
  enqueueSyncOperation({
    entity: "refund",
    action: "create",
    summary: `${refund.refundNumber} refund queued for sync.`,
    payload: refund,
  })

  return refund
}

export function voidSale(saleId: string) {
  const sales = getSales()
  const sale = sales.find((item) => item.id === saleId)
  if (!sale) return

  // Guard: already voided — do nothing (prevents double-restock)
  if (sale.status === "Voided") return

  const nextSales = sales.map((item) =>
    item.id === saleId ? { ...item, status: "Voided" as const } : item
  )
  writeSales(nextSales)

  // 1. Restore product stock for every line item
  increaseProductStock(
    sale.items.map((item) => ({ productId: item.id, quantity: item.quantity }))
  )

  // 2. Return consumed inventory batches (FIFO restore)
  restoreInventoryBatches(
    sale.items.map((item) => ({
      productId: item.id,
      productName: item.name,
      barcode: item.barcode,
      quantity: item.quantity,
      fallbackUnitCost: item.cost,
    }))
  )

  // 3. If it was a debt sale, reverse the customer's outstanding balance
  if (sale.paymentMethod === "Debt" || sale.status === "Debt") {
    reverseDebtSale(sale.saleNumber)
  }

  recordAuditEvent({
    action: "sale.void",
    entity: "sale",
    summary: `${sale.saleNumber} voided — stock and debt restored.`,
    metadata: {
      saleId,
      total: sale.total,
      itemsRestored: sale.items.length,
      wasDebt: sale.paymentMethod === "Debt",
    },
  })
  enqueueSyncOperation({
    entity: "sale",
    action: "void",
    summary: `${sale.saleNumber} void queued for sync.`,
    payload: { id: saleId },
  })
}

export function getSalesMetrics() {
  const sales = getSales()
  const refunds = getRefunds()
  const todaySales = sales.filter((sale) => isToday(sale.createdAt))
  const todayRefunds = refunds.filter((refund) => isToday(refund.createdAt))
  const paidTodaySales = todaySales.filter((sale) => sale.paymentMethod !== "Debt")
  const settings = getSettings()
  const todayRefundTotal = todayRefunds.reduce(
    (sum, refund) => sum + refund.total,
    0
  )
  const todayRefundMarginImpact = todayRefunds.reduce(
    (sum, refund) =>
      sum + getRefundPreTax(refund, sales) - getRefundCost(refund, sales),
    0
  )

  return {
    todayRevenue: paidTodaySales.reduce((sum, sale) => sum + sale.total, 0),
    todayGross: todaySales.reduce((sum, sale) => sum + sale.total, 0),
    todayRefunds: todayRefundTotal,
    todayNetRevenue:
      paidTodaySales.reduce((sum, sale) => sum + sale.total, 0) -
      todayRefunds
        .filter((refund) => refund.method !== "Debt Credit")
        .reduce((sum, refund) => sum + refund.total, 0),
    todayTax: todaySales.reduce((sum, sale) => sum + sale.tax, 0),
    todayProfit:
      todaySales.reduce((sum, sale) => sum + sale.profit, 0) -
      todayRefundMarginImpact,
    todayTransactions: todaySales.length,
    averageTicket:
      todaySales.length > 0
        ? todaySales.reduce((sum, sale) => sum + sale.total, 0) /
          todaySales.length
        : 0,
    vatRate: settings.vatRate,
  }
}

export function getPaymentMix() {
  const totals = getSales().reduce<Record<SalePaymentMethod, number>>(
    (totals, sale) => ({
      ...totals,
      [sale.paymentMethod]: totals[sale.paymentMethod] + sale.total,
    }),
    {
      Cash: 0,
      Card: 0,
      Wallet: 0,
      Debt: 0,
    }
  )

  getRefunds().forEach((refund) => {
    const method = refund.method === "Debt Credit" ? "Debt" : refund.method

    totals[method] -= refund.total
  })

  return totals
}

export function getTopProducts(limit = 5) {
  const productTotals = new Map<
    string,
    { name: string; quantity: number; total: number }
  >()

  getSales().forEach((sale) => {
    sale.items.forEach((item) => {
      const currentTotal = productTotals.get(String(item.id)) ?? {
        name: item.name,
        quantity: 0,
        total: 0,
      }

      productTotals.set(String(item.id), {
        name: item.name,
        quantity: currentTotal.quantity + item.quantity,
        total: currentTotal.total + item.total,
      })
    })
  })

  return Array.from(productTotals.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, limit)
}

export function subscribeSales(callback: (sales: Sale[]) => void) {
  if (!canUseStorage()) {
    return () => undefined
  }

  function handleSalesChanged() {
    callback(getSales())
  }

  window.addEventListener(SALES_EVENT, handleSalesChanged)
  window.addEventListener("storage", handleSalesChanged)

  return () => {
    window.removeEventListener(SALES_EVENT, handleSalesChanged)
    window.removeEventListener("storage", handleSalesChanged)
  }
}

export function subscribeRefunds(callback: (refunds: SaleRefund[]) => void) {
  if (!canUseStorage()) {
    return () => undefined
  }

  function handleRefundsChanged() {
    callback(getRefunds())
  }

  window.addEventListener(REFUNDS_EVENT, handleRefundsChanged)
  window.addEventListener("storage", handleRefundsChanged)

  return () => {
    window.removeEventListener(REFUNDS_EVENT, handleRefundsChanged)
    window.removeEventListener("storage", handleRefundsChanged)
  }
}
