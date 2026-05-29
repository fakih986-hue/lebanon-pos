import type { Product } from "../types/product"
import { enqueueSyncOperation } from "./sync.service"
import { writeLocalWithIndexedDB } from "./storage.service"

const CUSTOMERS_KEY = "lebanonpos.customers.v1"
const DEBT_SALES_KEY = "lebanonpos.debt-sales.v1"
const DEBT_PAYMENTS_KEY = "lebanonpos.debt-payments.v1"
const LEDGER_EVENT = "lebanonpos-ledger-changed"

export type Customer = {
  id: string
  name: string
  mobile: string
  creditLimit: number
  notes: string
  createdAt: string
}

export type DebtSaleItem = Pick<Product, "id" | "name" | "barcode"> & {
  quantity: number
  unitPrice: number
  total: number
}

export type DebtSale = {
  id: string
  customerId: string
  saleNumber: string
  subtotal: number
  discountTotal?: number
  tax: number
  total: number
  items: DebtSaleItem[]
  createdAt: string
}

export type DebtPayment = {
  id: string
  customerId: string
  amount: number
  method: "Cash" | "Card" | "Wallet" | "Bank Transfer" | "Refund Credit"
  reference: string
  createdAt: string
}

export type CustomerLedger = Customer & {
  debtTotal: number
  paidTotal: number
  balance: number
  lastActivityAt: string | null
}

export type CreateCustomerInput = {
  name: string
  mobile: string
  creditLimit: number
  notes: string
}

export type RecordDebtSaleInput = {
  customerId: string
  saleNumber: string
  subtotal: number
  discountTotal?: number
  tax: number
  total: number
  items: DebtSaleItem[]
}

export type RecordDebtPaymentInput = {
  customerId: string
  amount: number
  method: DebtPayment["method"]
  reference: string
}

function canUseStorage() {
  return typeof window !== "undefined" && Boolean(window.localStorage)
}

function readCollection<T>(key: string, fallback: T[]) {
  if (!canUseStorage()) {
    return fallback
  }

  const storedValue = window.localStorage.getItem(key)

  if (!storedValue) {
    return fallback
  }

  try {
    const parsedValue = JSON.parse(storedValue)

    return Array.isArray(parsedValue) ? (parsedValue as T[]) : fallback
  } catch {
    console.warn(`[customer.service] Failed to parse storage key`)
    return fallback
  }
}

function writeCollection<T>(key: string, value: T[]) {
  if (!canUseStorage()) {
    return
  }

  writeLocalWithIndexedDB(key, value)
  window.dispatchEvent(new Event(LEDGER_EVENT))
}

function cleanText(value: string) {
  return value.trim().replace(/\s+/g, " ")
}

function cleanMobile(value: string) {
  return value.trim().replace(/[^\d+]/g, "")
}

export function getCustomers() {
  return readCollection<Customer>(CUSTOMERS_KEY, [])
}

export function getDebtSales() {
  return readCollection<DebtSale>(DEBT_SALES_KEY, [])
}

export function getDebtPayments() {
  return readCollection<DebtPayment>(DEBT_PAYMENTS_KEY, [])
}

export function deleteCustomer(customerId: string) {
  const customers = getCustomers()
  const customer = customers.find((item) => item.id === customerId)
  if (!customer) return

  writeCollection(CUSTOMERS_KEY, customers.filter((item) => item.id !== customerId))
  enqueueSyncOperation({
    entity: "customer",
    action: "delete",
    summary: `${customer.name} deleted.`,
    payload: { id: customerId },
  })
}

export function addCustomer(input: CreateCustomerInput) {
  const customers = getCustomers()
  const customer: Customer = {
    id: crypto.randomUUID(),
    name: cleanText(input.name),
    mobile: cleanMobile(input.mobile),
    creditLimit: Math.max(0, input.creditLimit),
    notes: cleanText(input.notes),
    createdAt: new Date().toISOString(),
  }

  if (!customer.name || !customer.mobile) {
    throw new Error("Customer name and mobile number are required.")
  }

  writeCollection(CUSTOMERS_KEY, [customer, ...customers])
  enqueueSyncOperation({
    entity: "customer",
    action: "create",
    summary: `${customer.name} customer queued for sync.`,
    payload: customer,
  })

  return customer
}

export function recordDebtSale(input: RecordDebtSaleInput) {
  const sale: DebtSale = {
    id: crypto.randomUUID(),
    customerId: input.customerId,
    saleNumber: input.saleNumber,
    subtotal: input.subtotal,
    discountTotal: input.discountTotal,
    tax: input.tax,
    total: input.total,
    items: input.items,
    createdAt: new Date().toISOString(),
  }

  writeCollection(DEBT_SALES_KEY, [sale, ...getDebtSales()])
  enqueueSyncOperation({
    entity: "debt",
    action: "create",
    summary: `${sale.saleNumber} debt sale queued for sync.`,
    payload: sale,
  })

  return sale
}

/**
 * Reverse a debt sale when its underlying sale is voided.
 * Removes the matching DebtSale entry so the customer balance drops back.
 */
export function reverseDebtSale(saleNumber: string) {
  const debtSales = getDebtSales()
  const match = debtSales.find((d) => d.saleNumber === saleNumber)
  if (!match) return undefined

  writeCollection(DEBT_SALES_KEY, debtSales.filter((d) => d.id !== match.id))
  enqueueSyncOperation({
    entity: "debt",
    action: "delete",
    summary: `Debt sale ${saleNumber} reversed (sale voided).`,
    payload: { id: match.id, saleNumber },
  })
  return match
}

export function recordDebtPayment(input: RecordDebtPaymentInput) {
  const payment: DebtPayment = {
    id: crypto.randomUUID(),
    customerId: input.customerId,
    amount: Math.max(0, input.amount),
    method: input.method,
    reference: cleanText(input.reference),
    createdAt: new Date().toISOString(),
  }

  if (!payment.customerId || payment.amount <= 0) {
    throw new Error("Choose a customer and enter a payment amount.")
  }

  writeCollection(DEBT_PAYMENTS_KEY, [payment, ...getDebtPayments()])
  enqueueSyncOperation({
    entity: "debt",
    action: "payment",
    summary: `$${payment.amount.toFixed(2)} debt payment queued for sync.`,
    payload: payment,
  })

  return payment
}

export function getCustomerLedger() {
  const customers = getCustomers()
  const sales = getDebtSales()
  const payments = getDebtPayments()

  return customers.map<CustomerLedger>((customer) => {
    const customerSales = sales.filter((sale) => sale.customerId === customer.id)
    const customerPayments = payments.filter(
      (payment) => payment.customerId === customer.id
    )
    const debtTotal = customerSales.reduce((sum, sale) => sum + sale.total, 0)
    const paidTotal = customerPayments.reduce(
      (sum, payment) => sum + payment.amount,
      0
    )
    const activityDates = [
      ...customerSales.map((sale) => sale.createdAt),
      ...customerPayments.map((payment) => payment.createdAt),
    ].sort((a, b) => b.localeCompare(a))

    return {
      ...customer,
      debtTotal,
      paidTotal,
      balance: Math.max(0, debtTotal - paidTotal),
      lastActivityAt: activityDates[0] ?? null,
    }
  })
}

export function getLedgerTotals() {
  const ledgers = getCustomerLedger()
  const sales = getDebtSales()
  const payments = getDebtPayments()

  return {
    customers: ledgers.length,
    outstanding: ledgers.reduce((sum, customer) => sum + customer.balance, 0),
    debtTotal: sales.reduce((sum, sale) => sum + sale.total, 0),
    paidTotal: payments.reduce((sum, payment) => sum + payment.amount, 0),
  }
}

export function getCustomerActivity(customerId: string) {
  const sales = getDebtSales()
    .filter((sale) => sale.customerId === customerId)
    .map((sale) => ({
      id: sale.id,
      type: "Sale" as const,
      title: sale.saleNumber,
      amount: sale.total,
      createdAt: sale.createdAt,
      detail: `${sale.items?.length ?? 0} line items`,
    }))
  const payments = getDebtPayments()
    .filter((payment) => payment.customerId === customerId)
    .map((payment) => ({
      id: payment.id,
      type: "Payment" as const,
      title: payment.method,
      amount: payment.amount,
      createdAt: payment.createdAt,
      detail: payment.reference || "Debt payment",
    }))

  return [...sales, ...payments].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  )
}

export function subscribeLedger(callback: () => void) {
  if (!canUseStorage()) {
    return () => undefined
  }

  window.addEventListener(LEDGER_EVENT, callback)
  window.addEventListener("storage", callback)

  return () => {
    window.removeEventListener(LEDGER_EVENT, callback)
    window.removeEventListener("storage", callback)
  }
}
