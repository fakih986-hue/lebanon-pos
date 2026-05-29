import type {
  Expense,
  ExpenseCategory,
  ExpensePaymentMethod,
} from "../../features/pos/services/expense.service"
import type {
  Sale,
  SaleRefund,
} from "../../features/pos/services/sales.service"
import type { SupplierPayment } from "../../features/pos/services/supplier.service"
import { getLocalDateKey } from "../../features/pos/services/dailyClose.service"

export type ExpenseForm = {
  vendor: string
  category: ExpenseCategory
  amount: string
  paymentMethod: ExpensePaymentMethod
  invoiceNumber: string
  note: string
}

export type AccountingSummary = {
  dateKey: string
  grossSales: number
  refunds: number
  netSales: number
  costOfGoods: number
  returnedCost: number
  grossMargin: number
  expenses: number
  supplierPayments: number
  netProfit: number
  cashIn: number
  cashOut: number
  cashNet: number
}

export type AccountingWorkspace = "Close day" | "Expenses" | "Cash flow" | "History"

export const expenseCategories: ExpenseCategory[] = [
  "Supplier", "Rent", "Utilities", "Payroll", "Delivery", "Maintenance", "Other",
]

export const expensePaymentMethods: ExpensePaymentMethod[] = [
  "Cash", "Card", "Bank Transfer", "Wallet", "On Account",
]

export const emptyExpenseForm: ExpenseForm = {
  vendor: "",
  category: "Supplier",
  amount: "",
  paymentMethod: "Cash",
  invoiceNumber: "",
  note: "",
}

export function formatDateKey(value: string) {
  return new Intl.DateTimeFormat("en-LB", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`))
}

export function isToday(value: string, todayKey = getLocalDateKey()) {
  return getLocalDateKey(new Date(value)) === todayKey
}

export function getSaleGrossSubtotal(sale: Sale) {
  return sale.items.reduce((sum, item) => sum + item.total, 0)
}

export function getRefundPreTax(refund: SaleRefund, sales: Sale[]) {
  const sale = sales.find((currentSale) => currentSale.id === refund.saleId)
  if (!sale) return refund.total
  const grossSubtotal = getSaleGrossSubtotal(sale)
  if (grossSubtotal <= 0) return refund.total
  const refundGrossSubtotal = refund.items.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity, 0
  )
  return refundGrossSubtotal * (sale.subtotal / grossSubtotal)
}

export function getRefundCost(refund: SaleRefund, sales: Sale[]) {
  const sale = sales.find((currentSale) => currentSale.id === refund.saleId)
  return refund.items.reduce((sum, item) => {
    const saleItem = sale?.items.find((currentItem) => currentItem.id === item.id)
    const unitCost = item.cost ?? saleItem?.cost ?? 0
    return sum + unitCost * item.quantity
  }, 0)
}

export function getAccountingSummary(
  sales: Sale[],
  refunds: SaleRefund[],
  expenses: Expense[],
  supplierPayments: SupplierPayment[]
): AccountingSummary {
  const dateKey = getLocalDateKey()
  const todaySales = sales.filter((sale) => isToday(sale.createdAt, dateKey))
  const todayRefunds = refunds.filter((refund) =>
    isToday(refund.createdAt, dateKey)
  )
  const todayExpenses = expenses.filter((expense) =>
    isToday(expense.createdAt, dateKey)
  )
  const todaySupplierPayments = supplierPayments.filter((payment) =>
    isToday(payment.createdAt, dateKey)
  )
  const grossSales = todaySales.reduce((sum, sale) => sum + sale.total, 0)
  const refundsTotal = todayRefunds.reduce((sum, refund) => sum + refund.total, 0)
  const soldCost = todaySales.reduce(
    (sum, sale) =>
      sum + sale.items.reduce((itemSum, item) => itemSum + item.cost * item.quantity, 0),
    0
  )
  const returnedCost = todayRefunds.reduce(
    (sum, refund) => sum + getRefundCost(refund, sales), 0
  )
  const salesMargin = todaySales.reduce((sum, sale) => sum + sale.profit, 0)
  const refundMarginImpact = todayRefunds.reduce(
    (sum, refund) =>
      sum + getRefundPreTax(refund, sales) - getRefundCost(refund, sales),
    0
  )
  const expensesTotal = todayExpenses.reduce((sum, expense) => sum + expense.amount, 0)
  const cashIn = todaySales
    .filter((sale) => sale.paymentMethod === "Cash")
    .reduce((sum, sale) => sum + sale.total, 0)
  const cashRefunds = todayRefunds
    .filter((refund) => refund.method === "Cash")
    .reduce((sum, refund) => sum + refund.total, 0)
  const cashExpenses = todayExpenses
    .filter((expense) => expense.paymentMethod === "Cash")
    .reduce((sum, expense) => sum + expense.amount, 0)
  const cashSupplierPayments = todaySupplierPayments
    .filter((payment) => payment.method === "Cash")
    .reduce((sum, payment) => sum + payment.amount, 0)
  const supplierPaymentsTotal = todaySupplierPayments.reduce(
    (sum, payment) => sum + payment.amount, 0
  )

  return {
    dateKey,
    grossSales,
    refunds: refundsTotal,
    netSales: grossSales - refundsTotal,
    costOfGoods: Math.max(0, soldCost - returnedCost),
    returnedCost,
    grossMargin: salesMargin - refundMarginImpact,
    expenses: expensesTotal,
    supplierPayments: supplierPaymentsTotal,
    netProfit: salesMargin - refundMarginImpact - expensesTotal,
    cashIn,
    cashOut: cashRefunds + cashExpenses + cashSupplierPayments,
    cashNet: cashIn - cashRefunds - cashExpenses - cashSupplierPayments,
  }
}
