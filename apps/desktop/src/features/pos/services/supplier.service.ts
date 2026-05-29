import {
  getActiveShift,
  getCurrentUser,
  recordAuditEvent,
} from "./security.service"
import { enqueueSyncOperation } from "./sync.service"
import { writeLocalWithIndexedDB } from "./storage.service"
import { canUseStorage, createId } from "../lib/storage"

const SUPPLIERS_KEY = "lebanonpos.suppliers.v1"
const PURCHASE_ORDERS_KEY = "lebanonpos.purchase-orders.v1"
const SUPPLIER_PAYMENTS_KEY = "lebanonpos.supplier-payments.v1"
const SUPPLIER_EVENT = "lebanonpos-suppliers-changed"

export type Supplier = {
  id: string
  name: string
  mobile: string
  contact: string
  address: string
  notes: string
  createdAt: string
}

export type PurchaseOrderItem = {
  name: string
  barcode: string
  quantity: number
  unitCost: number
  unitPrice: number
  total: number
}

export type SupplierPaymentMethod =
  | "Cash"
  | "Card"
  | "Bank Transfer"
  | "Wallet"

export type PurchasePaymentMethod = SupplierPaymentMethod | "On Account"

export type PurchaseOrder = {
  id: string
  poNumber: string
  supplierId: string
  supplierName: string
  status: "Draft" | "Received" | "Closed"
  paymentStatus: "Unpaid" | "Partial" | "Paid"
  invoiceNumber: string
  note: string
  total: number
  paidTotal: number
  items: PurchaseOrderItem[]
  createdBy: string
  shiftId?: string
  shiftNumber?: string
  createdAt: string
  receivedAt?: string
}

export type SupplierPayment = {
  id: string
  supplierId: string
  supplierName: string
  purchaseOrderId?: string
  purchaseOrderNumber?: string
  amount: number
  method: SupplierPaymentMethod
  reference: string
  recordedBy: string
  shiftId?: string
  shiftNumber?: string
  createdAt: string
}

export type SupplierLedger = Supplier & {
  purchaseTotal: number
  paidTotal: number
  balance: number
  lastActivityAt: string | null
}

export type CreateSupplierInput = {
  name: string
  mobile: string
  contact: string
  address: string
  notes: string
}

export type RecordPurchaseOrderInput = {
  supplierId: string
  supplierName: string
  status?: PurchaseOrder["status"]
  invoiceNumber: string
  note: string
  items: PurchaseOrderItem[]
  paymentMethod: PurchasePaymentMethod
  paidAmount?: number
}

export type RecordSupplierPaymentInput = {
  supplierId: string
  purchaseOrderId?: string
  amount: number
  method: SupplierPaymentMethod
  reference: string
}

function cleanText(value: string) {
  return value.trim().replace(/\s+/g, " ")
}

function readCollection<T>(key: string) {
  if (!canUseStorage()) {
    return []
  }

  const storedValue = window.localStorage.getItem(key)

  if (!storedValue) {
    return []
  }

  try {
    const parsedValue = JSON.parse(storedValue)

    return Array.isArray(parsedValue) ? (parsedValue as T[]) : []
  } catch {
    console.warn(`[supplier.service] Failed to parse storage key`)
    return []
  }
}

function writeCollection<T>(key: string, value: T[]) {
  if (!canUseStorage()) {
    return
  }

  writeLocalWithIndexedDB(key, value)
  window.dispatchEvent(new Event(SUPPLIER_EVENT))
}

export function getSuppliers() {
  return readCollection<Supplier>(SUPPLIERS_KEY)
}

export function getPurchaseOrders() {
  return readCollection<PurchaseOrder>(PURCHASE_ORDERS_KEY)
}

export function getSupplierPayments() {
  return readCollection<SupplierPayment>(SUPPLIER_PAYMENTS_KEY)
}

export function deleteSupplier(supplierId: string) {
  const suppliers = getSuppliers()
  const supplier = suppliers.find((item) => item.id === supplierId)
  if (!supplier) return

  writeCollection(SUPPLIERS_KEY, suppliers.filter((item) => item.id !== supplierId))
  recordAuditEvent({
    action: "supplier.delete",
    entity: "supplier",
    summary: `${supplier.name} supplier deleted.`,
    metadata: { supplierId },
  })
  enqueueSyncOperation({
    entity: "supplier",
    action: "delete",
    summary: `${supplier.name} supplier deleted.`,
    payload: { id: supplierId },
  })
}

export function createSupplier(input: CreateSupplierInput) {
  const supplier: Supplier = {
    id: createId("supplier"),
    name: cleanText(input.name),
    mobile: cleanText(input.mobile),
    contact: cleanText(input.contact),
    address: cleanText(input.address),
    notes: cleanText(input.notes),
    createdAt: new Date().toISOString(),
  }

  if (!supplier.name) {
    throw new Error("Supplier name is required.")
  }

  writeCollection(SUPPLIERS_KEY, [supplier, ...getSuppliers()])
  recordAuditEvent({
    action: "supplier.create",
    entity: "supplier",
    summary: `${supplier.name} supplier account created.`,
    metadata: {
      supplierId: supplier.id,
    },
  })
  enqueueSyncOperation({
    entity: "supplier",
    action: "create",
    summary: `${supplier.name} supplier queued for sync.`,
    payload: supplier,
  })

  return supplier
}

function buildPaymentStatus(total: number, paidTotal: number) {
  if (paidTotal <= 0) {
    return "Unpaid" as const
  }

  if (paidTotal + 0.005 >= total) {
    return "Paid" as const
  }

  return "Partial" as const
}

function writePurchaseOrders(purchaseOrders: PurchaseOrder[]) {
  writeCollection(PURCHASE_ORDERS_KEY, purchaseOrders)
}

function writeSupplierPayments(payments: SupplierPayment[]) {
  writeCollection(SUPPLIER_PAYMENTS_KEY, payments)
}

function updatePurchaseOrderPaidTotal(purchaseOrderId: string) {
  const purchaseOrders = getPurchaseOrders()
  const payments = getSupplierPayments()
  const nextPurchaseOrders = purchaseOrders.map((purchaseOrder) => {
    if (purchaseOrder.id !== purchaseOrderId) {
      return purchaseOrder
    }

    const paidTotal = payments
      .filter((payment) => payment.purchaseOrderId === purchaseOrder.id)
      .reduce((sum, payment) => sum + payment.amount, 0)

    return {
      ...purchaseOrder,
      paidTotal,
      paymentStatus: buildPaymentStatus(purchaseOrder.total, paidTotal),
      status:
        paidTotal + 0.005 >= purchaseOrder.total && purchaseOrder.status === "Received"
          ? "Closed"
          : purchaseOrder.status,
    }
  })

  writePurchaseOrders(nextPurchaseOrders)
}

export function recordSupplierPayment(input: RecordSupplierPaymentInput) {
  const supplier = getSuppliers().find(
    (currentSupplier) => currentSupplier.id === input.supplierId
  )

  if (!supplier) {
    throw new Error("Choose a supplier before recording payment.")
  }

  const purchaseOrder = input.purchaseOrderId
    ? getPurchaseOrders().find(
        (currentOrder) => currentOrder.id === input.purchaseOrderId
      )
    : undefined
  const shift = getActiveShift()
  const user = getCurrentUser()
  const payment: SupplierPayment = {
    id: createId("supplier-payment"),
    supplierId: supplier.id,
    supplierName: supplier.name,
    purchaseOrderId: purchaseOrder?.id,
    purchaseOrderNumber: purchaseOrder?.poNumber,
    amount: Math.max(0, input.amount),
    method: input.method,
    reference: cleanText(input.reference),
    recordedBy: user.name,
    shiftId: shift?.id,
    shiftNumber: shift?.shiftNumber,
    createdAt: new Date().toISOString(),
  }

  if (payment.amount <= 0) {
    throw new Error("Payment amount must be greater than zero.")
  }

  writeSupplierPayments([payment, ...getSupplierPayments()])

  if (purchaseOrder?.id) {
    updatePurchaseOrderPaidTotal(purchaseOrder.id)
  }

  recordAuditEvent({
    action: "supplier.payment",
    entity: "supplier",
    summary: `${payment.supplierName} paid $${payment.amount.toFixed(2)}.`,
    metadata: {
      supplierId: payment.supplierId,
      purchaseOrderId: payment.purchaseOrderId,
      amount: payment.amount,
      method: payment.method,
      shiftId: payment.shiftId,
      shiftNumber: payment.shiftNumber,
    },
  })
  enqueueSyncOperation({
    entity: "supplier-payment",
    action: "payment",
    summary: `${payment.supplierName} payment queued for sync.`,
    payload: payment,
  })

  return payment
}

export function recordPurchaseOrder(input: RecordPurchaseOrderInput) {
  const shift = getActiveShift()
  const user = getCurrentUser()
  const total = input.items.reduce((sum, item) => sum + item.total, 0)
  const paidTotal =
    input.paymentMethod === "On Account"
      ? 0
      : Math.min(total, Math.max(0, input.paidAmount ?? total))
  const purchaseOrder: PurchaseOrder = {
    id: createId("purchase-order"),
    poNumber: `PO-${Date.now().toString().slice(-6)}`,
    supplierId: input.supplierId,
    supplierName: input.supplierName,
    status: input.status ?? "Received",
    paymentStatus: buildPaymentStatus(total, paidTotal),
    invoiceNumber: cleanText(input.invoiceNumber),
    note: cleanText(input.note),
    total,
    paidTotal,
    items: input.items,
    createdBy: user.name,
    shiftId: shift?.id,
    shiftNumber: shift?.shiftNumber,
    createdAt: new Date().toISOString(),
    receivedAt: input.status === "Draft" ? undefined : new Date().toISOString(),
  }

  if (!purchaseOrder.supplierId) {
    throw new Error("Choose a supplier before recording a purchase.")
  }

  if (purchaseOrder.items.length === 0 || purchaseOrder.total <= 0) {
    throw new Error("Purchase order needs at least one item with cost.")
  }

  writePurchaseOrders([purchaseOrder, ...getPurchaseOrders()])

  if (paidTotal > 0 && input.paymentMethod !== "On Account") {
    recordSupplierPayment({
      supplierId: purchaseOrder.supplierId,
      purchaseOrderId: purchaseOrder.id,
      amount: paidTotal,
      method: input.paymentMethod,
      reference:
        purchaseOrder.invoiceNumber || `Payment for ${purchaseOrder.poNumber}`,
    })
  }

  recordAuditEvent({
    action: "purchase.receive",
    entity: "supplier",
    summary: `${purchaseOrder.poNumber} recorded for ${purchaseOrder.supplierName}.`,
    metadata: {
      purchaseOrderId: purchaseOrder.id,
      supplierId: purchaseOrder.supplierId,
      total: purchaseOrder.total,
      paidTotal: purchaseOrder.paidTotal,
      paymentStatus: purchaseOrder.paymentStatus,
    },
  })
  enqueueSyncOperation({
    entity: "purchase-order",
    action: "create",
    summary: `${purchaseOrder.poNumber} purchase order queued for sync.`,
    payload: purchaseOrder,
  })

  return purchaseOrder
}

export function getSupplierLedger() {
  const suppliers = getSuppliers()
  const purchaseOrders = getPurchaseOrders()
  const payments = getSupplierPayments()

  return suppliers.map<SupplierLedger>((supplier) => {
    const supplierOrders = purchaseOrders.filter(
      (purchaseOrder) => purchaseOrder.supplierId === supplier.id
    )
    const supplierPayments = payments.filter(
      (payment) => payment.supplierId === supplier.id
    )
    const purchaseTotal = supplierOrders.reduce(
      (sum, purchaseOrder) => sum + purchaseOrder.total,
      0
    )
    const paidTotal = supplierPayments.reduce(
      (sum, payment) => sum + payment.amount,
      0
    )
    const activityDates = [
      ...supplierOrders.map((purchaseOrder) => purchaseOrder.createdAt),
      ...supplierPayments.map((payment) => payment.createdAt),
    ].sort((a, b) => b.localeCompare(a))

    return {
      ...supplier,
      purchaseTotal,
      paidTotal,
      balance: Math.max(0, purchaseTotal - paidTotal),
      lastActivityAt: activityDates[0] ?? null,
    }
  })
}

export function getSupplierTotals() {
  const ledger = getSupplierLedger()

  return {
    suppliers: ledger.length,
    purchaseTotal: ledger.reduce((sum, supplier) => sum + supplier.purchaseTotal, 0),
    paidTotal: ledger.reduce((sum, supplier) => sum + supplier.paidTotal, 0),
    outstanding: ledger.reduce((sum, supplier) => sum + supplier.balance, 0),
  }
}

export function getSupplierActivity(supplierId: string) {
  const purchaseOrders = getPurchaseOrders()
    .filter((purchaseOrder) => purchaseOrder.supplierId === supplierId)
    .map((purchaseOrder) => ({
      id: purchaseOrder.id,
      type: "Purchase" as const,
      label: purchaseOrder.poNumber,
      amount: purchaseOrder.total,
      status: purchaseOrder.paymentStatus,
      createdAt: purchaseOrder.createdAt,
    }))
  const payments = getSupplierPayments()
    .filter((payment) => payment.supplierId === supplierId)
    .map((payment) => ({
      id: payment.id,
      type: "Payment" as const,
      label: payment.reference || payment.method,
      amount: payment.amount,
      status: payment.method,
      createdAt: payment.createdAt,
    }))

  return [...purchaseOrders, ...payments].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  )
}

export function subscribeSuppliers(callback: () => void) {
  if (!canUseStorage()) {
    return () => undefined
  }

  function handleSuppliersChanged() {
    callback()
  }

  window.addEventListener(SUPPLIER_EVENT, handleSuppliersChanged)
  window.addEventListener("storage", handleSuppliersChanged)

  return () => {
    window.removeEventListener(SUPPLIER_EVENT, handleSuppliersChanged)
    window.removeEventListener("storage", handleSuppliersChanged)
  }
}
