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
import { isCostAvailable, sumAvailable } from "../../features/pos/lib/cost"

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
  /** Cost figures are undefined (unavailable) when any cost they depend on is unavailable. */
  costOfGoods: number | undefined
  returnedCost: number | undefined
  grossMargin: number | undefined
  expenses: number
  supplierPayments: number
  netProfit: number | undefined
  cashIn: number
  cashOut: number
  cashNet: number
  /** The sales and refunds counted (sent with a close: the server values the day from them). */
  saleIds: string[]
  refundIds: string[]
}

export type AccountingWorkspace = "Close day" | "Expenses" | "Cash flow" | "History" | "Shift"

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

/** Undefined (unavailable) when any refunded line's cost is unavailable. */
export function getRefundCost(refund: SaleRefund, sales: Sale[]) {
  const sale = sales.find((currentSale) => currentSale.id === refund.saleId)
  return sumAvailable(refund.items.map((item) => {
    const saleItem = sale?.items.find((currentItem) => currentItem.id === item.id)
    const unitCost = isCostAvailable(item.cost) ? item.cost : saleItem?.cost
    return isCostAvailable(unitCost) ? unitCost * item.quantity : undefined
  }))
}

export function getAccountingSummary(
  sales: Sale[],
  refunds: SaleRefund[],
  expenses: Expense[],
  supplierPayments: SupplierPayment[],
  /** batch 83: only the records of the drawer this register closes (another register closes its own) */
  inDrawer: (record: { shiftId?: string | null }) => boolean = () => true,
): AccountingSummary {
  const dateKey = getLocalDateKey()
  const todaySales = sales.filter((sale) => isToday(sale.createdAt, dateKey) && inDrawer(sale))
  const todayRefunds = refunds.filter((refund) =>
    isToday(refund.createdAt, dateKey) && inDrawer(refund)
  )
  const todayExpenses = expenses.filter((expense) =>
    isToday(expense.createdAt, dateKey) && inDrawer(expense)
  )
  const todaySupplierPayments = supplierPayments.filter((payment) =>
    isToday(payment.createdAt, dateKey) && inDrawer(payment)
  )
  const grossSales = todaySales.reduce((sum, sale) => sum + sale.total, 0)
  const refundsTotal = todayRefunds.reduce((sum, refund) => sum + refund.total, 0)
  const soldCost = sumAvailable(todaySales.flatMap((sale) =>
    sale.items.map((item) => (isCostAvailable(item.cost) ? item.cost * item.quantity : undefined))
  ))
  const returnedCost = sumAvailable(todayRefunds.map((refund) => getRefundCost(refund, sales)))
  const salesMargin = sumAvailable(todaySales.map((sale) => sale.profit))
  const refundMarginImpact = sumAvailable(todayRefunds.map((refund) => {
    const cost = getRefundCost(refund, sales)
    return cost === undefined ? undefined : getRefundPreTax(refund, sales) - cost
  }))
  const grossMargin = salesMargin === undefined || refundMarginImpact === undefined ? undefined : salesMargin - refundMarginImpact
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
    costOfGoods: soldCost === undefined || returnedCost === undefined ? undefined : Math.max(0, soldCost - returnedCost),
    returnedCost,
    grossMargin,
    expenses: expensesTotal,
    supplierPayments: supplierPaymentsTotal,
    netProfit: grossMargin === undefined ? undefined : grossMargin - expensesTotal,
    cashIn,
    cashOut: cashRefunds + cashExpenses + cashSupplierPayments,
    cashNet: cashIn - cashRefunds - cashExpenses - cashSupplierPayments,
    saleIds: todaySales.map((sale) => sale.id),
    refundIds: todayRefunds.map((refund) => refund.id),
  }
}
