import type { ExpenseCategory, ExpensePaymentMethod } from "./common"

export type Expense = {
  id: string
  expenseNumber: string
  vendor: string
  category: ExpenseCategory
  amount: number
  paymentMethod: ExpensePaymentMethod
  invoiceNumber: string
  note: string
  recordedBy: string
  shiftNumber?: string
  createdAt: string
}

export type DailyClose = {
  id: string
  dateKey: string
  grossSales: number
  refunds: number
  netSales: number
  costOfGoods: number
  returnedCost: number
  grossMargin: number
  expenses: number
  supplierPayments?: number
  netProfit: number
  cashIn: number
  cashOut: number
  note: string
  closedBy: string
  createdAt: string
}
