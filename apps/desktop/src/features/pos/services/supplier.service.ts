import {
  getActiveShift,
  getCurrentUser,
  PermissionError,
  recordAuditEvent,
  userCan,
} from "./security.service"
import {
  assertCanWrite, commitStagedSyncOperation, enqueueSyncOperation, getDeviceId, isSyncOperationRecorded, nextDocumentReference,
  settleStagedSyncOperation, stageSyncOperation,
} from "./sync.service"
import { writeLocalWithIndexedDB } from "./storage.service"
import { canUseStorage, createId } from "../lib/storage"
import { getRegisterId } from "./settings.service"
import {
  beginReceiveSubmission, commitReceiveSubmission, getReceiveSubmission, markReceiveStep, noteReceiveFailure,
  ReceiveOutcomeUnknownError, type PaymentOutcome, type PurchaseOrderOutcome, type ReceiveFinance, type ReceivePlan, type ReceiveRowResult,
  type ReceiveSubmission,
} from "./receiveSubmission.service"

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
  archived?: boolean
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
  registerId?: string
  deviceId?: string
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
  registerId?: string
  deviceId?: string
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
  /** Fixed ids (receiving submissions): the purchase order and its sync operation are written once. */
  id?: string
  syncOpId?: string
}

export type RecordSupplierPaymentInput = {
  supplierId: string
  purchaseOrderId?: string
  amount: number
  method: SupplierPaymentMethod
  reference: string
  /** Fixed ids (receiving submissions): the payment and its sync operation are written once. */
  id?: string
  syncOpId?: string
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

export function archiveSupplier(supplierId: string) {
  assertCanWrite("delete supplier")
  if (!userCan("suppliers.manage")) throw new PermissionError("Changing suppliers needs the Suppliers permission.")
  const suppliers = getSuppliers()
  const supplier = suppliers.find((item) => item.id === supplierId)
  if (!supplier) return

  writeCollection(SUPPLIERS_KEY, suppliers.map((item) =>
    item.id === supplierId ? { ...item, archived: true } : item
  ))
  enqueueSyncOperation({
    entity: "supplier",
    action: "update",
    summary: `${supplier.name} archived.`,
    payload: { id: supplierId, archived: true },
  })
}

export function restoreSupplier(supplierId: string) {
  assertCanWrite("delete supplier")
  if (!userCan("suppliers.manage")) throw new PermissionError("Changing suppliers needs the Suppliers permission.")
  const suppliers = getSuppliers()
  const supplier = suppliers.find((item) => item.id === supplierId)
  if (!supplier) return

  writeCollection(SUPPLIERS_KEY, suppliers.map((item) =>
    item.id === supplierId ? { ...item, archived: false } : item
  ))
  enqueueSyncOperation({
    entity: "supplier",
    action: "update",
    summary: `${supplier.name} restored.`,
    payload: { id: supplierId, archived: false },
  })
}

export type SupplierEdit = Pick<Supplier, "name" | "mobile" | "contact" | "address" | "notes">

/**
 * Edit a supplier's details. The id stays, so purchase orders, payments and the balance stay
 * attached (orders and payments keep the name they were recorded under). The operation is saved
 * before the change; opId (one per edit attempt) makes a repeated press or a retry record it once.
 */
export function updateSupplier(supplierId: string, edit: SupplierEdit, opts?: { opId?: string }) {
  assertCanWrite("update supplier")
  if (!userCan("suppliers.manage")) throw new PermissionError("Changing suppliers needs the Suppliers permission.")
  const suppliers = getSuppliers()
  const current = suppliers.find((item) => item.id === supplierId)
  if (!current) throw new Error("Supplier not found.")
  const next: Supplier = {
    ...current,
    name: cleanText(edit.name),
    mobile: cleanText(edit.mobile),
    contact: cleanText(edit.contact),
    address: cleanText(edit.address),
    notes: cleanText(edit.notes),
  }
  if (!next.name) throw new Error("Supplier name is required.")
  if (opts?.opId && isSyncOperationRecorded(opts.opId)) return getSuppliers().find((s) => s.id === supplierId) ?? next
  const staged = stageSyncOperation({
    id: opts?.opId,
    entity: "supplier",
    action: "update",
    summary: `${next.name} supplier updated.`,
    payload: { id: next.id, name: next.name, mobile: next.mobile, contact: next.contact, address: next.address, notes: next.notes },
  })
  try {
    writeCollection(SUPPLIERS_KEY, getSuppliers().map((item) => (item.id === supplierId ? next : item)))
  } catch (error) {
    settleStagedSyncOperation(staged.id)
    throw error
  }
  commitStagedSyncOperation(staged.id)
  try { recordAuditEvent({ action: "supplier.update", entity: "supplier", summary: `${current.name} supplier details updated.`, metadata: { supplierId } }) }
  catch (error) { console.error("[supplier] update audit write failed:", error) }
  return next
}

// Legacy delete — prefer archiveSupplier() unless no history exists
/** True when the supplier has any purchase order or payment: what is owed and paid must be kept. */
export function supplierHasHistory(supplierId: string) {
  return getPurchaseOrders().some((o) => o.supplierId === supplierId) || getSupplierPayments().some((p) => p.supplierId === supplierId)
}

// Delete only a supplier with no purchase orders or payments; one with history is archived instead.
export function deleteSupplier(supplierId: string) {
  assertCanWrite("delete supplier")
  if (!userCan("suppliers.manage")) throw new PermissionError("Changing suppliers needs the Suppliers permission.")
  const suppliers = getSuppliers()
  const supplier = suppliers.find((item) => item.id === supplierId)
  if (!supplier) return
  if (supplierHasHistory(supplierId)) {
    throw new Error(`SUPPLIER_HAS_HISTORY: ${supplier.name} has purchase orders or payments; archive the supplier instead.`)
  }

  const removedOrders = getPurchaseOrders().filter((o) => o.supplierId === supplierId)
  const removedPayments = getSupplierPayments().filter((p) => p.supplierId === supplierId)

  writeCollection(SUPPLIERS_KEY, suppliers.filter((item) => item.id !== supplierId))
  // Clean up orphan purchase orders and payments
  const orders = getPurchaseOrders().filter((o) => o.supplierId !== supplierId)
  const payments = getSupplierPayments().filter((p) => p.supplierId !== supplierId)
  writeCollection(PURCHASE_ORDERS_KEY, orders)
  writeCollection(SUPPLIER_PAYMENTS_KEY, payments)

  for (const po of removedOrders) {
    enqueueSyncOperation({
      entity: "purchase-order",
      action: "delete",
      summary: `PO ${po.poNumber} removed with supplier.`,
      payload: { id: po.id },
    })
  }
  for (const p of removedPayments) {
    enqueueSyncOperation({
      entity: "supplier-payment",
      action: "delete",
      summary: `Supplier payment removed with supplier.`,
      payload: { id: p.id },
    })
  }

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
  assertCanWrite("create supplier")
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

  const changed = nextPurchaseOrders.filter((po) => {
    const original = purchaseOrders.find(p => p.id === po.id)
    return !!original && (original.paidTotal !== po.paidTotal || original.status !== po.status)
  })
  // Staged before the write; an update is released only if the stored order matches it.
  const staged = changed.map((po) => stageSyncOperation({
    entity: "purchase-order",
    action: "update",
    summary: `${po.poNumber} payment status updated.`,
    payload: po,
  }))
  try {
    writePurchaseOrders(nextPurchaseOrders)
  } catch (error) {
    for (const op of staged) settleStagedSyncOperation(op.id)
    throw error
  }
  for (const op of staged) commitStagedSyncOperation(op.id)
}

export function recordSupplierPayment(input: RecordSupplierPaymentInput) {
  assertCanWrite("record supplier payment")
  const supplier = getSuppliers().find(
    (currentSupplier) => currentSupplier.id === input.supplierId
  )

  if (!supplier) {
    throw new Error("Choose a supplier before recording payment.")
  }

  const existingPayments = getSupplierPayments()
  if (input.id) {
    const mine = existingPayments.find((p) => p.id === input.id)
    if (mine) {
      enqueueSyncOperation({ id: input.syncOpId, entity: "supplier-payment", action: "payment", summary: `${mine.supplierName} payment queued for sync.`, payload: mine })
      return mine
    }
  }
  // Idempotency: skip duplicate payment for same PO/supplier with same amount and reference
  // (a heuristic for callers without an id; a fixed id is exact and takes precedence).
  const duplicate = input.id ? undefined : existingPayments.find(p =>
    p.supplierId === input.supplierId &&
    Math.abs(p.amount - input.amount) < 0.005 &&
    p.reference === cleanText(input.reference) &&
    (p.createdAt && (Date.now() - new Date(p.createdAt).getTime()) < 30000) // within 30 seconds
  )
  if (duplicate) return duplicate

  const purchaseOrder = input.purchaseOrderId
    ? getPurchaseOrders().find(
        (currentOrder) => currentOrder.id === input.purchaseOrderId
      )
    : undefined
  const shift = getActiveShift()
  const user = getCurrentUser()
  const payment: SupplierPayment = {
    id: input.id ?? createId("supplier-payment"),
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
    registerId: getRegisterId(),
    deviceId: getDeviceId(),
    createdAt: new Date().toISOString(),
  }

  if (payment.amount <= 0) {
    throw new Error("Payment amount must be greater than zero.")
  }

  // Durability: the payment operation is saved before the payment (SyncStorageError -> nothing written).
  const staged = stageSyncOperation({
    id: input.syncOpId,
    entity: "supplier-payment",
    action: "payment",
    summary: `${payment.supplierName} payment queued for sync.`,
    payload: payment,
  })
  try {
    writeSupplierPayments([payment, ...getSupplierPayments()])
  } catch (error) {
    settleStagedSyncOperation(staged.id)
    throw error
  }
  commitStagedSyncOperation(staged.id)

  if (purchaseOrder?.id) {
    updatePurchaseOrderPaidTotal(purchaseOrder.id)
  }

  try { recordAuditEvent({
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
  }) } catch (error) { console.error("[supplier] payment audit write failed:", error) }

  return payment
}

export function recordPurchaseOrder(input: RecordPurchaseOrderInput) {
  assertCanWrite("record purchase order")
  if (input.id) {
    const existing = getPurchaseOrders().find((o) => o.id === input.id)
    if (existing) {
      // Written before (a retried receive): make sure its create operation is queued, nothing else.
      enqueueSyncOperation({ id: input.syncOpId, entity: "purchase-order", action: "create", summary: `${existing.poNumber} purchase order queued for sync.`, payload: existing })
      return existing
    }
  }
  const shift = getActiveShift()
  const user = getCurrentUser()
  const total = input.items.reduce((sum, item) => sum + item.total, 0)
  // What is to be paid now. The order itself is written Unpaid: only a recorded payment marks it
  // paid (updatePurchaseOrderPaidTotal), so a failed payment can never leave a "Paid" order.
  const paidTotal =
    input.paymentMethod === "On Account"
      ? 0
      : Math.min(total, Math.max(0, input.paidAmount ?? total))
  const purchaseOrder: PurchaseOrder = {
    id: input.id ?? createId("purchase-order"),
    poNumber: nextDocumentReference("PO", 5, () => getPurchaseOrders().map((p) => p.poNumber)),
    supplierId: input.supplierId,
    supplierName: input.supplierName,
    status: input.status ?? "Received",
    paymentStatus: buildPaymentStatus(total, 0),
    invoiceNumber: cleanText(input.invoiceNumber),
    note: cleanText(input.note),
    total,
    paidTotal: 0,
    items: input.items,
    createdBy: user.name,
    shiftId: shift?.id,
    shiftNumber: shift?.shiftNumber,
    registerId: getRegisterId(),
    deviceId: getDeviceId(),
    createdAt: new Date().toISOString(),
    receivedAt: input.status === "Draft" ? undefined : new Date().toISOString(),
  }

  if (!purchaseOrder.supplierId) {
    throw new Error("Choose a supplier before recording a purchase.")
  }

  if (purchaseOrder.items.length === 0 || purchaseOrder.total <= 0) {
    throw new Error("Purchase order needs at least one item with cost.")
  }

  // Durability: the create operation is saved before the order (SyncStorageError -> nothing written).
  const staged = stageSyncOperation({
    id: input.syncOpId,
    entity: "purchase-order",
    action: "create",
    summary: `${purchaseOrder.poNumber} purchase order queued for sync.`,
    payload: purchaseOrder,
  })
  try {
    writePurchaseOrders([purchaseOrder, ...getPurchaseOrders()])
  } catch (error) {
    settleStagedSyncOperation(staged.id)
    throw error
  }
  commitStagedSyncOperation(staged.id)

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

  try {
    recordAuditEvent({
      action: "purchase.receive",
      entity: "supplier",
      summary: `${purchaseOrder.poNumber} recorded for ${purchaseOrder.supplierName}.`,
      metadata: {
        purchaseOrderId: purchaseOrder.id,
        supplierId: purchaseOrder.supplierId,
        total: purchaseOrder.total,
        paidTotal,
        paymentStatus: purchaseOrder.paymentStatus,
      },
    })
  } catch (error) { console.error("[purchase] audit write failed:", error) }

  return getPurchaseOrders().find((o) => o.id === purchaseOrder.id) ?? purchaseOrder
}

/** Active suppliers; with includeArchived, archived ones too (so they can be found and restored). */
export function getSupplierLedger(opts?: { includeArchived?: boolean }) {
  const suppliers = getSuppliers().filter((s) => opts?.includeArchived || !s.archived)
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

// ── Received receiving orchestration ───────────────────────────────

export type ReceivingContext = {
  supplierId?: string
  supplierName?: string
  invoiceNumber?: string
  paymentMethod?: SupplierPaymentMethod | "On Account"
  note?: string
}

export type ReceivingSummary = {
  /** Rows received / rejected (by row, see `results`). */
  acceptedCount: number
  rejectedCount: number
  errors: string[]
  productsCreated: number
  productsUpdated: number
  batchesCreated: number
  units: number
  totalValue: number
  /** Per-entry outcome by row id (entry.rowId, or the entry's position when none was given). */
  results: ReceiveRowResult[]
  /** The purchase order and the payment are separate outcomes: stock can be received while
   *  either failed, and each can be retried on its own (idempotently). */
  purchaseOrder: PurchaseOrderOutcome
  payment: PaymentOutcome
  /** Kept for existing callers: the saved purchase order's number / whether a payment was recorded. */
  poNumber?: string
  paymentRecorded: boolean
  submissionId?: string
  /** True when this submission had already been received: nothing was written again. */
  replayed?: boolean
}

export type ReceiveEntry = {
  /** Stable identity of the row this entry came from; results are reported by it. */
  rowId?: string
  name: string; barcode: string; category: string; quantity: number
  cost: number; price: number; reorderPoint?: number; reorderQuantity?: number
  expiryDate?: string
  // POS-RECEIVE-UX-1A: staged "add barcode to existing product" decision.
  attachAliasToProductId?: number
  // POS-PRODUCT-IMAGE-1: optional image for new-product rows.
  image?: string | null
  // POS-RECEIVE-VARIANT-1B: create as a variant linked to this parent.
  parentId?: number
  variantName?: string
}

/** Fixed ids of a submission's finance effects (absent without a submission: fresh ids). */
export function receiveFinanceIds(submissionId: string) {
  return {
    po: `${submissionId}-po`, poOp: `${submissionId}-op-po`, poReceivedOp: `${submissionId}-op-po-received`,
    pay: `${submissionId}-pay`, payOp: `${submissionId}-op-pay`,
  }
}

/**
 * The purchase order, then the payment, for the entries that were received. Never throws: each
 * outcome is reported on its own. With a submission id both are idempotent (fixed ids), so a retry
 * completes what is missing and can never add a second order, liability or payment.
 * The order is written Unpaid; only a recorded payment marks it paid.
 */
export function recordReceiveFinance(
  submissionId: string | undefined,
  context: ReceivingContext | undefined,
  received: Array<Pick<ReceiveEntry, "name" | "barcode" | "quantity" | "cost" | "price">>,
): ReceiveFinance {
  const totalCost = received.reduce((sum, e) => sum + e.quantity * e.cost, 0)
  const method = context?.paymentMethod ?? "On Account"
  if (!context?.supplierId || totalCost <= 0) {
    return { purchaseOrder: { status: "not_needed" }, payment: { status: "not_needed", amount: 0 } }
  }
  const k = submissionId ? receiveFinanceIds(submissionId) : undefined
  let po: PurchaseOrder
  try {
    po = recordPurchaseOrder({
      id: k?.po, syncOpId: k?.poOp,
      supplierId: context.supplierId,
      supplierName: context.supplierName ?? "",
      status: "Draft",
      invoiceNumber: context.invoiceNumber ?? "",
      note: context.note ?? "",
      paymentMethod: method,
      paidAmount: 0,
      items: received.map(e => ({
        name: e.name, barcode: e.barcode, quantity: e.quantity,
        unitCost: e.cost, unitPrice: e.price, total: e.quantity * e.cost,
      })),
    })
    const orders = getPurchaseOrders()
    const createdPo = orders.find(o => o.id === po.id)
    if (createdPo && createdPo.status === "Draft") {
      // writePurchaseOrders() only writes local storage — it does not sync. Without the update
      // the server never learns the PO left Draft. Staged before the write (fixed id: once).
      const received = { ...createdPo, status: "Received" as const, receivedAt: new Date().toISOString() }
      const staged = stageSyncOperation({ id: k?.poReceivedOp, entity: "purchase-order", action: "update", summary: `${createdPo.poNumber} marked Received.`, payload: received })
      try {
        writePurchaseOrders(orders.map((o) => (o.id === createdPo.id ? received : o)))
      } catch (error) {
        settleStagedSyncOperation(staged.id)
        throw error
      }
      commitStagedSyncOperation(staged.id)
      po = received
    } else if (createdPo) {
      // Received earlier (a retry): make sure its update is recorded, once.
      if (k && !isSyncOperationRecorded(k.poReceivedOp)) {
        enqueueSyncOperation({ id: k.poReceivedOp, entity: "purchase-order", action: "update", summary: `${createdPo.poNumber} marked Received.`, payload: createdPo })
      }
      po = createdPo
    }
  } catch (err) {
    const error = String((err as Error)?.message ?? err)
    return {
      purchaseOrder: { status: "failed", id: k?.po, error },
      payment: method === "On Account" ? { status: "on_account", amount: 0, method } : { status: "waiting", amount: totalCost, method },
    }
  }
  if (k && !isSyncOperationRecorded(k.poOp)) {
    // Recorded here but not queued: the server would never learn of this liability. Retry re-queues it.
    return {
      purchaseOrder: { status: "failed", id: po.id, number: po.poNumber, total: po.total, error: "recorded on this device but not queued for sync" },
      payment: method === "On Account" ? { status: "on_account", amount: 0, method } : { status: "waiting", amount: totalCost, method },
    }
  }
  const purchaseOrder: PurchaseOrderOutcome = { status: "recorded", id: po.id, number: po.poNumber, total: po.total }
  if (method === "On Account") return { purchaseOrder, payment: { status: "on_account", amount: 0, method } }
  try {
    const payment = recordSupplierPayment({
      id: k?.pay, syncOpId: k?.payOp,
      supplierId: context.supplierId,
      purchaseOrderId: po.id,
      amount: totalCost,
      method,
      reference: po.invoiceNumber || `Payment for ${po.poNumber}`,
    })
    if (k && !isSyncOperationRecorded(k.payOp)) {
      return { purchaseOrder, payment: { status: "failed", id: payment.id, amount: payment.amount, method, error: "recorded on this device but not queued for sync" } }
    }
    return { purchaseOrder, payment: { status: "recorded", id: payment.id, amount: payment.amount, method } }
  } catch (err) {
    // The order stays recorded and Unpaid; the supplier balance shows it owed until the retry.
    return { purchaseOrder, payment: { status: "failed", id: k?.pay, amount: totalCost, method, error: String((err as Error)?.message ?? err) } }
  }
}

const rowIdOf = (e: { rowId?: string }, i: number) => e.rowId ?? String(i)

function summaryFromRecord(rec: ReceiveSubmission, replayed: boolean): ReceivingSummary {
  const results = rec.results ?? []
  const finance = rec.finance ?? { purchaseOrder: { status: "not_needed" as const }, payment: { status: "not_needed" as const, amount: 0 } }
  const sum = rec.summary
  return {
    acceptedCount: results.filter((r) => r.status === "accepted").length,
    rejectedCount: results.filter((r) => r.status === "rejected").length,
    errors: results.filter((r) => r.status === "rejected").map((r) => r.reason ?? "rejected"),
    productsCreated: sum?.productsCreated ?? 0, productsUpdated: sum?.productsUpdated ?? 0, batchesCreated: sum?.batchesCreated ?? 0,
    units: sum?.units ?? 0, totalValue: sum?.totalValue ?? 0,
    results, purchaseOrder: finance.purchaseOrder, payment: finance.payment,
    poNumber: finance.purchaseOrder.number, paymentRecorded: finance.payment.status === "recorded",
    submissionId: rec.id, replayed,
  }
}

/**
 * Receive a delivery: stock and lots for each accepted entry, then (with a supplier) the
 * purchase order and payment for exactly the entries that were received.
 *
 * With `opts.submissionId` the save is idempotent and recoverable (receiveSubmission.service):
 * - already committed  -> returns the recorded outcome, writes nothing (`replayed: true`);
 * - started, never committed (an exception mid-write) -> ReceiveOutcomeUnknownError, writes
 *   nothing: the effects must be reviewed and completed or undone (receiveRecovery.service).
 */
export async function receiveAndRecord(
  entries: ReceiveEntry[],
  context?: ReceivingContext,
  opts?: { submissionId?: string }
): Promise<ReceivingSummary> {
  const products = await import("./product.service")
  const sub = opts?.submissionId
  if (sub) {
    const prior = getReceiveSubmission(sub)
    if (prior?.status === "committed") return summaryFromRecord(prior, true)
    if (prior) throw new ReceiveOutcomeUnknownError(prior.id)
    // Checks that write nothing run before the ledger entry, so a refusal is not an "unknown".
    assertCanWrite("receive products")
    beginReceiveSubmission(sub, entries.map(rowIdOf), {
      // Images (large data URLs) are not kept in the ledger.
      entries: entries.map((e, i) => { const rec = { ...e, rowId: rowIdOf(e, i) }; delete rec.image; return rec }),
      context: context ? { ...context } : undefined,
      stockBefore: snapshotStockBefore(entries, products),
    })
  }
  try {
    return runReceiveSteps(entries, context, sub, products)
  } catch (err) {
    if (!sub) throw err
    // Products, lots or movements may be partly written: never report "nothing happened".
    try { noteReceiveFailure(sub, String((err as Error)?.message ?? err)) } catch { /* the started entry stands */ }
    throw new ReceiveOutcomeUnknownError(sub, err)
  }
}

/** Stock of the existing products the entries will touch, read before anything is written. */
export function snapshotStockBefore(entries: ReceiveEntry[], products: typeof import("./product.service")) {
  const all = products.getProductsSync()
  const out: Record<string, number> = {}
  for (const e of entries) {
    const p = e.attachAliasToProductId != null ? all.find((x) => x.id === e.attachAliasToProductId) : products.findProductByBarcode(e.barcode)
    if (p) out[String(p.id)] = p.stock
  }
  return out
}

/**
 * A failed sync-queue write is logged, not thrown (sync.service writeQueue), so a receive checks
 * that the operations the server needs are really queued before it calls its follow-ups done:
 * the new products' create and the lots' receive (the server adds stock only through it).
 */
function assertFollowUpsQueued(sub: string, plan: ReceivePlan) {
  const rec = getReceiveSubmission(sub)
  if (rec?.steps?.followUps) return
  // Queued, staged or already acknowledged all count: an operation flushed and acknowledged at once
  // may have left the queue, and its absence is not a failure.
  const missing = [
    ...(plan.createdProductIds.length > 0 ? [`${sub}-op-products`] : []),
    ...(plan.lots.length > 0 ? [`${sub}-op-receive`] : []),
  ].filter((id) => !isSyncOperationRecorded(id))
  if (missing.length > 0) throw new Error(`Could not queue ${missing.join(", ")} for sync (storage full?).`)
  markReceiveStep(sub, "followUps")
}

/**
 * The receive, step by step. With a submission id each step is journaled when it completes and
 * is idempotent (fixed ids), so a resumed run (receiveRecovery) completes only what is missing:
 * products (catalog + stock, one write) -> follow-ups (product sync, lots, movements, receive
 * operation) -> finance (purchase order, payment) -> commit.
 */
export function runReceiveSteps(
  entries: ReceiveEntry[],
  context: ReceivingContext | undefined,
  sub: string | undefined,
  products: typeof import("./product.service"),
  opts?: { recovered?: boolean },
): ReceivingSummary {
  const rec = sub ? getReceiveSubmission(sub) : undefined
  let plan = rec?.plan
  if (!rec?.steps?.products) {
    const r = products.receiveProducts(
      entries.map(e => ({
        name: e.name, barcode: e.barcode, category: e.category,
        stock: e.quantity, cost: e.cost, price: e.price,
        reorderPoint: e.reorderPoint, reorderQuantity: e.reorderQuantity,
        expiryDate: e.expiryDate,
        supplierId: context?.supplierId, supplierName: context?.supplierName,
        attachAliasToProductId: e.attachAliasToProductId,
        image: e.image,
        parentId: e.parentId,
        variantName: e.variantName,
      })),
      {
        submissionId: sub,
        // Journaled right after the one products write, before any lot or operation.
        onProductsWritten: (w) => {
          plan = { results: w.results, lots: w.batchInputs, createdProductIds: w.createdProductIds, modifiedProductIds: w.modifiedProductIds }
          if (sub) markReceiveStep(sub, "products", { plan })
        },
      },
    )
    plan = plan ?? { results: r.results, lots: [], createdProductIds: r.newlyCreated.map((p) => p.id), modifiedProductIds: r.modifiedExisting.map((p) => p.id) }
    } else if (!rec.steps.followUps && plan) {
    const all = products.getProductsSync()
    const syncIdOf = new Map(plan.lots.map((l) => [l.productId, l.productSyncId]))
    const pick = (ids: number[]) => ids.map((id) => {
      const p = all.find((x) => x.id === id && (!syncIdOf.get(id) || x.syncId === syncIdOf.get(id)))
      if (!p) throw new Error(`Product #${id} written by this delivery is no longer on this device.`)
      return p
    })
    products.applyReceiveFollowUps({ newlyCreated: pick(plan.createdProductIds), modifiedExisting: pick(plan.modifiedProductIds), batchInputs: plan.lots, submissionId: sub })
  }
  if (!plan) throw new Error("The delivery's products step has no recorded plan.")
  if (sub) assertFollowUpsQueued(sub, plan)
  const results: ReceiveRowResult[] = entries.map((e, i) => {
    const r = plan!.results[i]
    return r?.accepted === false ? { rowId: rowIdOf(e, i), status: "rejected", reason: r.error } : { rowId: rowIdOf(e, i), status: "accepted" }
  })
  // The purchase order (and any payment) covers only what was actually received: a rejected
  // row is fixed and saved again later, and must not be billed twice.
  const received = entries.filter((_, i) => results[i].status === "accepted")
  const finance = recordReceiveFinance(sub, context, received)
  if (sub) markReceiveStep(sub, "finance")
  const summaryRecord = {
    acceptedCount: received.length,
    rejectedCount: results.length - received.length,
    productsCreated: plan.createdProductIds.length,
    productsUpdated: plan.modifiedProductIds.length,
    batchesCreated: plan.lots.length,
    poNumber: finance.purchaseOrder.number,
    paymentRecorded: finance.payment.status === "recorded",
    totalValue: received.reduce((s, e) => s + e.quantity * e.cost, 0),
    units: received.reduce((s, e) => s + e.quantity, 0),
  }
  if (sub) commitReceiveSubmission(sub, results, summaryRecord, finance, opts?.recovered ? { recovered: true } : undefined)
  return {
    ...summaryRecord,
    errors: results.filter((r) => r.status === "rejected").map((r) => r.reason ?? "rejected"),
    results, purchaseOrder: finance.purchaseOrder, payment: finance.payment, submissionId: sub,
  }
}
