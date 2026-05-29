import {
  getActiveShift,
  getCurrentUser,
  recordAuditEvent,
} from "./security.service"
import { enqueueSyncOperation } from "./sync.service"
import { writeLocalWithIndexedDB } from "./storage.service"
import { canUseStorage } from "../lib/storage"

const EXPENSES_KEY = "lebanonpos.expenses.v1"
const EXPENSES_EVENT = "lebanonpos-expenses-changed"

export type ExpenseCategory =
  | "Supplier"
  | "Rent"
  | "Utilities"
  | "Payroll"
  | "Delivery"
  | "Maintenance"
  | "Other"

export type ExpensePaymentMethod =
  | "Cash"
  | "Card"
  | "Bank Transfer"
  | "Wallet"
  | "On Account"

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
  shiftId?: string
  shiftNumber?: string
  createdAt: string
}

export type CreateExpenseInput = {
  vendor: string
  category: ExpenseCategory
  amount: number
  paymentMethod: ExpensePaymentMethod
  invoiceNumber: string
  note: string
}


function cleanText(value: string) {
  return value.trim().replace(/\s+/g, " ")
}

function readExpenses() {
  if (!canUseStorage()) {
    return []
  }

  const storedValue = window.localStorage.getItem(EXPENSES_KEY)

  if (!storedValue) {
    return []
  }

  try {
    const parsedValue = JSON.parse(storedValue)

    return Array.isArray(parsedValue) ? (parsedValue as Expense[]) : []
  } catch {
    console.warn(`[expense.service] Failed to parse storage key`)
    return []
  }
}

function writeExpenses(expenses: Expense[]) {
  if (!canUseStorage()) {
    return
  }

  writeLocalWithIndexedDB(EXPENSES_KEY, expenses)
  window.dispatchEvent(new Event(EXPENSES_EVENT))
}

export function getExpenses() {
  return readExpenses()
}

export function createExpense(input: CreateExpenseInput) {
  const user = getCurrentUser()
  const shift = getActiveShift()
  const amount = Math.max(0, input.amount)
  const expense: Expense = {
    id: crypto.randomUUID(),
    expenseNumber: `EXP-${Date.now().toString().slice(-6)}`,
    vendor: cleanText(input.vendor) || "Unknown vendor",
    category: input.category,
    amount,
    paymentMethod: input.paymentMethod,
    invoiceNumber: cleanText(input.invoiceNumber),
    note: cleanText(input.note),
    recordedBy: user.name,
    shiftId: shift?.id,
    shiftNumber: shift?.shiftNumber,
    createdAt: new Date().toISOString(),
  }

  if (expense.amount <= 0) {
    throw new Error("Expense amount must be greater than zero.")
  }

  writeExpenses([expense, ...getExpenses()])
  recordAuditEvent({
    action: "expense.create",
    entity: "expense",
    summary: `${expense.expenseNumber} recorded for ${expense.vendor}.`,
    metadata: {
      expenseId: expense.id,
      amount: expense.amount,
      category: expense.category,
      paymentMethod: expense.paymentMethod,
      shiftId: expense.shiftId,
      shiftNumber: expense.shiftNumber,
    },
  })
  enqueueSyncOperation({
    entity: "expense",
    action: "create",
    summary: `${expense.expenseNumber} expense queued for sync.`,
    payload: expense,
  })

  return expense
}

export function getExpenseTotals(expenses = getExpenses()) {
  const today = new Date().toDateString()
  const todayExpenses = expenses.filter(
    (expense) => new Date(expense.createdAt).toDateString() === today
  )

  return {
    today: todayExpenses.reduce((sum, expense) => sum + expense.amount, 0),
    cashToday: todayExpenses
      .filter((expense) => expense.paymentMethod === "Cash")
      .reduce((sum, expense) => sum + expense.amount, 0),
    allTime: expenses.reduce((sum, expense) => sum + expense.amount, 0),
  }
}

export function subscribeExpenses(callback: (expenses: Expense[]) => void) {
  if (!canUseStorage()) {
    return () => undefined
  }

  function handleExpensesChanged() {
    callback(getExpenses())
  }

  window.addEventListener(EXPENSES_EVENT, handleExpensesChanged)
  window.addEventListener("storage", handleExpensesChanged)

  return () => {
    window.removeEventListener(EXPENSES_EVENT, handleExpensesChanged)
    window.removeEventListener("storage", handleExpensesChanged)
  }
}
