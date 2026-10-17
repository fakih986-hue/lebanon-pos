import type { Product } from "../types/product"
import { assertCanWrite, commitStagedSyncOperation, enqueueSyncOperation, settleStagedSyncOperation, stageSyncOperation } from "./sync.service"
import { writeLocalWithIndexedDB } from "./storage.service"
import { canUseStorage, createId } from "../lib/storage"

const CUSTOMERS_KEY = "lebanonpos.customers.v1"
const DEBT_SALES_KEY = "lebanonpos.debt-sales.v1"
const DEBT_PAYMENTS_KEY = "lebanonpos.debt-payments.v1"
const LEDGER_EVENT = "lebanonpos-ledger-changed"

export type Customer = {
  id: string
  name: string
  mobile: string
  creditLimit: number
  isWholesale?: boolean
  sellAtCost?: boolean
  notes: string
  archived?: boolean
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
  /** The sale this debt belongs to. Kept locally; not sent (a hub on the
   * previous release would reject the column). The server links it itself. */
  saleId?: string
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
  /** REFUND-INTEGRITY-1: a refund credit shown locally but created on the
   *  server by the refund itself — never pushed as its own operation. */
  localOnly?: boolean
}

export type DebtAging = {
  current: number   // 0–30 days
  days30: number    // 30–60
  days60: number    // 60–90
  days90: number    // 90+
}

export type CustomerLedger = Customer & {
  debtTotal: number
  paidTotal: number
  balance: number
  lastActivityAt: string | null
  aging: DebtAging
  oldestUnpaidDays: number      // age in days of the oldest still-unpaid debt
  overLimit: boolean            // balance exceeds credit limit
  overdue: boolean              // has unpaid debt older than 30 days
}

/**
 * FIFO aging: payments settle the oldest debts first. Returns how much of the
 * outstanding balance falls into each age bucket, plus the oldest unpaid age.
 */
function computeAging(
  sales: { total: number; createdAt: string }[],
  totalPaid: number
): { aging: DebtAging; oldestUnpaidDays: number } {
  const ordered = [...sales].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  let remainingPaid = totalPaid
  const now = Date.now()
  const aging: DebtAging = { current: 0, days30: 0, days60: 0, days90: 0 }
  let oldestUnpaidDays = 0

  for (const sale of ordered) {
    let unpaid = sale.total
    if (remainingPaid > 0) {
      const applied = Math.min(remainingPaid, unpaid)
      unpaid -= applied
      remainingPaid -= applied
    }
    if (unpaid <= 0.001) continue

    const days = Math.floor((now - new Date(sale.createdAt).getTime()) / (24 * 60 * 60 * 1000))
    if (days > oldestUnpaidDays) oldestUnpaidDays = days
    if (days < 30) aging.current += unpaid
    else if (days < 60) aging.days30 += unpaid
    else if (days < 90) aging.days60 += unpaid
    else aging.days90 += unpaid
  }
  return { aging, oldestUnpaidDays }
}

export type CreateCustomerInput = {
  name: string
  mobile: string
  creditLimit: number
  isWholesale?: boolean
  sellAtCost?: boolean
  notes: string
}

export type RecordDebtSaleInput = {
  customerId: string
  saleNumber: string
  saleId?: string
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
  /** Caller-chosen id (idempotent refund credits / settlements). */
  id?: string
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

export function cleanMobile(value: string) {
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

export function archiveCustomer(customerId: string) {
  assertCanWrite("delete customer")
  const customers = getCustomers()
  const customer = customers.find((item) => item.id === customerId)
  if (!customer) return

  writeCollection(CUSTOMERS_KEY, customers.map((item) =>
    item.id === customerId ? { ...item, archived: true } : item
  ))
  enqueueSyncOperation({
    entity: "customer",
    action: "update",
    summary: `${customer.name} archived.`,
    payload: { id: customerId, archived: true },
  })
}

export function restoreCustomer(customerId: string) {
  assertCanWrite("delete customer")
  const customers = getCustomers()
  const customer = customers.find((item) => item.id === customerId)
  if (!customer) return

  writeCollection(CUSTOMERS_KEY, customers.map((item) =>
    item.id === customerId ? { ...item, archived: false } : item
  ))
  enqueueSyncOperation({
    entity: "customer",
    action: "update",
    summary: `${customer.name} restored.`,
    payload: { id: customerId, archived: false },
  })
}

/** True when the customer has any debt sale or payment: their balance and history must be kept. */
export function customerHasHistory(customerId: string) {
  return getDebtSales().some((d) => d.customerId === customerId) || getDebtPayments().some((p) => p.customerId === customerId)
}

// Delete only a customer with no money history; one with history is archived instead
// (deleting would erase their balance and payments here and on the server).
export function deleteCustomer(customerId: string) {
  assertCanWrite("delete customer")
  const customers = getCustomers()
  const customer = customers.find((item) => item.id === customerId)
  if (!customer) return
  if (customerHasHistory(customerId)) {
    throw new Error(`CUSTOMER_HAS_HISTORY: ${customer.name} has sales or payments on account; archive the customer instead.`)
  }

  writeCollection(CUSTOMERS_KEY, customers.filter((item) => item.id !== customerId))
  // Clean up orphan debt records
  const debtSales = getDebtSales().filter((d) => d.customerId !== customerId)
  const debtPayments = getDebtPayments().filter((d) => d.customerId !== customerId)
  writeCollection(DEBT_SALES_KEY, debtSales)
  writeCollection(DEBT_PAYMENTS_KEY, debtPayments)
  enqueueSyncOperation({
    entity: "customer",
    action: "delete",
    summary: `${customer.name} deleted.`,
    payload: { id: customerId },
  })
  // Enqueue debt deletions for server sync
  enqueueSyncOperation({
    entity: "debt",
    action: "delete",
    summary: `Debt sales for deleted customer ${customer.name}`,
    payload: { customerId },
  })
}

export function addCustomer(input: CreateCustomerInput) {
  assertCanWrite("create customer")
  const customers = getCustomers()
  const customer: Customer = {
    id: createId(),
    name: cleanText(input.name),
    mobile: cleanMobile(input.mobile),
    creditLimit: Math.max(0, input.creditLimit),
    isWholesale: input.isWholesale ?? false,
    sellAtCost: input.sellAtCost ?? false,
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

export function updateCustomer(customerId: string, patch: Partial<Customer>) {
  assertCanWrite("update customer")
  const customers = getCustomers()
  let updated: Customer | undefined
  const next = customers.map((c) => {
    if (c.id !== customerId) return c
    updated = { ...c, ...patch, id: c.id }
    return updated
  })
  if (!updated) return undefined
  writeCollection(CUSTOMERS_KEY, next)
  window.dispatchEvent(new Event(LEDGER_EVENT))
  enqueueSyncOperation({
    entity: "customer",
    action: "update",
    summary: `${updated.name} customer updated.`,
    payload: updated,
  })
  return updated
}

/** The debt of a sale has an id derived from the sale: recording it again (a retry, a recovery)
 *  finds it instead of adding a second debt. */
export function debtIdForSale(saleId: string) {
  return `debt-${saleId}`
}

export function recordDebtSale(input: RecordDebtSaleInput) {
  assertCanWrite("record debt sale")
  const id = input.saleId ? debtIdForSale(input.saleId) : createId()
  const existing = getDebtSales().find((d) => d.id === id)
  if (existing) return existing
  const sale: DebtSale = {
    id,
    customerId: input.customerId,
    saleNumber: input.saleNumber,
    ...(input.saleId ? { saleId: input.saleId } : {}),
    subtotal: input.subtotal,
    discountTotal: input.discountTotal,
    tax: input.tax,
    total: input.total,
    items: input.items,
    createdAt: new Date().toISOString(),
  }

  // Durability: the operation is saved before the debt (SyncStorageError -> nothing written).
  const staged = stageSyncOperation({
    id: `op-${sale.id}`,
    entity: "debt",
    action: "create",
    summary: `${sale.saleNumber} debt sale queued for sync.`,
    payload: debtWirePayload(sale),
  })
  try {
    writeCollection(DEBT_SALES_KEY, [sale, ...getDebtSales()])
  } catch (error) {
    settleStagedSyncOperation(staged.id)
    throw error
  }
  commitStagedSyncOperation(staged.id)

  return sale
}

function debtWirePayload(debt: DebtSale) {
  const { saleId: _saleId, ...wire } = debt
  return wire
}

/**
 * Reverse a debt sale when its underlying sale is voided.
 * Removes THIS sale's DebtSale entry so the customer balance drops back: by
 * sale id; an unlinked (older) row only when exactly one matches the number
 * and customer. Never "the first debt with that number".
 */
export function reverseDebtSale(sale: { id: string; saleNumber: string; customerId?: string }) {
  const debtSales = getDebtSales()
  const unlinked = debtSales.filter((d) => !d.saleId && d.saleNumber === sale.saleNumber && (!sale.customerId || d.customerId === sale.customerId))
  const match = debtSales.find((d) => d.saleId === sale.id) ?? (unlinked.length === 1 ? unlinked[0] : undefined)
  if (!match) return undefined
  const saleNumber = sale.saleNumber

  const staged = stageSyncOperation({
    id: `op-del-${match.id}`,
    entity: "debt",
    action: "delete",
    summary: `Debt sale ${saleNumber} reversed (sale voided).`,
    payload: { id: match.id, saleNumber },
  })
  try {
    writeCollection(DEBT_SALES_KEY, debtSales.filter((d) => d.id !== match.id))
  } catch (error) {
    settleStagedSyncOperation(staged.id)
    throw error
  }
  commitStagedSyncOperation(staged.id)
  return match
}

/** Remove a local-only debt payment (a refund credit the server never received). */
export function removeLocalDebtPayment(id: string) {
  const payments = getDebtPayments()
  const target = payments.find((payment) => payment.id === id)
  if (!target || !target.localOnly) return false
  writeCollection(DEBT_PAYMENTS_KEY, payments.filter((payment) => payment.id !== id))
  return true
}

export function recordDebtPayment(input: RecordDebtPaymentInput, opts?: { localOnly?: boolean }) {
  assertCanWrite("record debt payment")
  const payment: DebtPayment = {
    id: input.id ?? createId(),
    customerId: input.customerId,
    amount: Math.max(0, input.amount),
    method: input.method,
    reference: cleanText(input.reference),
    createdAt: new Date().toISOString(),
  }

  if (!payment.customerId || payment.amount <= 0) {
    throw new Error("Choose a customer and enter a payment amount.")
  }

  if (opts?.localOnly) payment.localOnly = true
  // Recorded before (a retried settlement or refund credit with the same id): never twice.
  const existing = getDebtPayments().find((p) => p.id === payment.id)
  if (existing) return existing
  if (opts?.localOnly) {
    writeCollection(DEBT_PAYMENTS_KEY, [payment, ...getDebtPayments()])
    return payment
  }
  // Durability: the operation is saved before the payment (SyncStorageError -> nothing written).
  const staged = stageSyncOperation({
    id: `op-${payment.id}`,
    entity: "debt",
    action: "payment",
    summary: `${payment.amount.toFixed(2)} debt payment queued for sync.`,
    payload: payment,
  })
  try {
    writeCollection(DEBT_PAYMENTS_KEY, [payment, ...getDebtPayments()])
  } catch (error) {
    settleStagedSyncOperation(staged.id)
    throw error
  }
  commitStagedSyncOperation(staged.id)

  return payment
}

/** Active customers; with includeArchived, archived ones too (so they can be found and restored). */
export function getCustomerLedger(opts?: { includeArchived?: boolean }) {
  const customers = getCustomers().filter((c) => opts?.includeArchived || !c.archived)
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

    const balance = Math.max(0, debtTotal - paidTotal)
    const { aging, oldestUnpaidDays } = computeAging(customerSales, paidTotal)

    return {
      ...customer,
      debtTotal,
      paidTotal,
      balance,
      lastActivityAt: activityDates[0] ?? null,
      aging,
      oldestUnpaidDays,
      overLimit: customer.creditLimit > 0 && balance > customer.creditLimit,
      overdue: aging.days30 + aging.days60 + aging.days90 > 0.001,
    }
  })
}

/** Build a plain-text statement for a customer (for printing or WhatsApp). */
export function buildCustomerStatement(customerId: string, storeName = "Titan POS"): string {
  const ledger = getCustomerLedger().find((c) => c.id === customerId)
  if (!ledger) return ""
  const activity = getCustomerActivity(customerId)
  const lines = [
    `${storeName} — Account Statement`,
    `Customer: ${ledger.name}${ledger.mobile ? ` (${ledger.mobile})` : ""}`,
    `Date: ${new Date().toLocaleDateString()}`,
    "",
    "Activity:",
    ...activity.slice(0, 40).map((a) => {
      const sign = a.type === "Payment" ? "-" : "+"
      return `  ${new Date(a.createdAt).toLocaleDateString()}  ${a.type.padEnd(8)} ${sign}$${a.amount.toFixed(2)}  ${a.title}`
    }),
    "",
    `Total charged:  $${ledger.debtTotal.toFixed(2)}`,
    `Total paid:     $${ledger.paidTotal.toFixed(2)}`,
    `BALANCE DUE:    $${ledger.balance.toFixed(2)}`,
  ]
  return lines.join("\n")
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
