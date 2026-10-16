import type { Product } from "../types/product"
import type { BatchAllocation } from "./inventoryBatch.service"
import { applyLotRestoration, recordStockMovement } from "./inventoryBatch.service"
import { increaseProductStock, decreaseProductStock } from "./product.service"
import { reverseDebtSale, recordDebtPayment, getDebtPayments } from "./customer.service"
import {
  buildRefundableLines, planRefund, planVoidRestoration, assertRefundAmount, resolveRefundRate,
  refundableQuantity, legacyLineKey, isLegacyLineKey, normalizeAllocations, roundQty,
  type AllocationSlice, type PriorRefundLine, type RefundableLine, type PlannedRefundLine,
} from "../lib/refundAllocation"
import { getSettings } from "./settings.service"
import { canUseStorage, createId } from "../lib/storage"
import {
  getActiveShift,
  getCurrentUser,
  recordAuditEvent,
} from "./security.service"
import { enqueueSyncOperation, assertCanWrite, getDeviceId, getSyncQueue } from "./sync.service"
import { writeLocalWithIndexedDB } from "./storage.service"
import { getRegisterId } from "./settings.service"

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
  /** REFUND-INTEGRITY-1: stable line identity, stamped at checkout. Absent on
   *  sales made before line identity existed (legacy lines, pooled per product). */
  lineId?: string
}

export type RefundMethod = "Cash" | "Card" | "Wallet" | "Debt_Credit"

export type RefundItem = Pick<Product, "id" | "name" | "barcode"> & {
  quantity: number
  unitPrice: number
  cost?: number
  total: number
  /** Lots this refund restored (null/absent = product stock only). */
  batchAllocations?: AllocationSlice[] | null
  /** Sale line refunded: the sale item's lineId, or legacy-product:<id>. */
  saleLineId?: string
}

/** How a refund the server rejected was settled (it is never silently dropped). */
export type RefundConflictResolution = {
  code: string
  message: string
  resolution: "loss" | "recovered" | "not_paid"
  note: string
  resolvedAt: string
  resolvedBy: string
  expenseId?: string
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
  soldAtCost?: boolean
  tender?: SaleTender
  /** Rounded LBP total actually payable in cash (nearest 5,000 LBP banknote),
   *  when it differs from the exact totalLbp — the cash-rounding disclosure
   *  shown at checkout. Persisted so reprints/CSV exports can still show it;
   *  previously only ever existed in the live checkout screen's local state. */
  payableLbp?: number
  items: SaleItem[]
  cashier: string
  shiftId?: string
  shiftNumber?: string
  registerId?: string
  deviceId?: string
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
  registerId?: string
  deviceId?: string
  createdAt: string
  /** Original sale's rate; null with rateSource "unavailable" when the sale recorded none. */
  exchangeRate?: number | null
  rateSource?: "sale_tender" | "unavailable"
  /** Set once a server-rejected refund has been settled by a manager. */
  conflict?: RefundConflictResolution
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
  soldAtCost?: boolean
  tender?: SaleTender
  payableLbp?: number
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


// ── Read-boundary normalization (REFUND-INTEGRITY-1) ─────────────────────
// Rows pulled from the server are raw Prisma rows: item `id` is the SaleItem
// UUID (the product is `productId`), the name is `productName`, and Decimal
// columns arrive as strings. Locally created rows use `id` = product id.
// Normalize both into the client shape so refunds of a sale made on another
// device restore the right product. Idempotent for already-normal rows.
function toNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}
function optionalNumber(value: unknown): number | undefined {
  return value === null || value === undefined || value === "" ? undefined : toNumber(value)
}
function productIdOf(raw: Record<string, unknown>): number {
  if (raw.productId !== undefined && raw.productId !== null && Number.isFinite(Number(raw.productId))) {
    return Number(raw.productId)
  }
  return toNumber(raw.id)
}
function normalizeSaleItem(raw: any): SaleItem {
  const item: SaleItem = {
    id: productIdOf(raw ?? {}),
    name: String(raw?.name ?? raw?.productName ?? ""),
    barcode: String(raw?.barcode ?? ""),
    cost: toNumber(raw?.cost),
    quantity: toNumber(raw?.quantity),
    unitPrice: toNumber(raw?.unitPrice),
    total: toNumber(raw?.total),
  }
  if (typeof raw?.productSyncId === "string") (item as any).productSyncId = raw.productSyncId
  if (typeof raw?.lineId === "string" && raw.lineId) item.lineId = raw.lineId
  if (Array.isArray(raw?.batchAllocations)) {
    item.batchAllocations = raw.batchAllocations.map((a: any) => ({
      batchId: a?.batchId ?? "legacy-stock",
      batchNumber: String(a?.batchNumber ?? a?.batchId ?? "Legacy stock"),
      quantity: toNumber(a?.quantity),
      unitCost: toNumber(a?.unitCost),
      ...(a?.expiryDate ? { expiryDate: a.expiryDate } : {}),
    }))
  }
  return item
}
function normalizeSale(raw: any): Sale {
  const sale = { ...raw } as Sale
  sale.subtotal = toNumber(raw?.subtotal)
  sale.discountTotal = optionalNumber(raw?.discountTotal)
  sale.tax = toNumber(raw?.tax)
  sale.total = toNumber(raw?.total)
  sale.cost = toNumber(raw?.cost)
  sale.profit = toNumber(raw?.profit)
  sale.payableLbp = optionalNumber(raw?.payableLbp)
  sale.items = Array.isArray(raw?.items) ? raw.items.map(normalizeSaleItem) : []
  if (raw?.tender) {
    const t = raw.tender
    sale.tender = {
      currency: t.currency, exchangeRate: toNumber(t.exchangeRate), paidUsd: toNumber(t.paidUsd), paidLbp: toNumber(t.paidLbp),
      paidTotalUsd: toNumber(t.paidTotalUsd), paidTotalLbp: toNumber(t.paidTotalLbp), changeUsd: toNumber(t.changeUsd),
      changeLbp: toNumber(t.changeLbp), changeCurrency: t.changeCurrency,
    }
  } else {
    delete (sale as any).tender
  }
  delete (sale as any).refundVersion
  return sale
}
function normalizeRefundItem(raw: any): RefundItem {
  const item: RefundItem = {
    id: productIdOf(raw ?? {}),
    name: String(raw?.name ?? raw?.productName ?? ""),
    barcode: String(raw?.barcode ?? ""),
    quantity: toNumber(raw?.quantity),
    unitPrice: toNumber(raw?.unitPrice),
    total: toNumber(raw?.total),
  }
  const cost = optionalNumber(raw?.cost)
  if (cost !== undefined) item.cost = cost
  if (typeof raw?.saleLineId === "string" && raw.saleLineId) item.saleLineId = raw.saleLineId
  const allocations = normalizeAllocations(raw?.batchAllocations)
  if (allocations) item.batchAllocations = allocations
  return item
}
function normalizeRefund(raw: any): SaleRefund {
  const refund = { ...raw } as SaleRefund
  refund.total = toNumber(raw?.total)
  refund.items = Array.isArray(raw?.items) ? raw.items.map(normalizeRefundItem) : []
  if (raw?.exchangeRate !== undefined) refund.exchangeRate = raw.exchangeRate === null ? null : toNumber(raw.exchangeRate)
  if (refund.method === ("Debt Credit" as RefundMethod) || refund.method === ("Refund Credit" as RefundMethod)) refund.method = "Debt_Credit"
  return refund
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

    return Array.isArray(parsedSales) ? parsedSales.map(normalizeSale) : []
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

    return Array.isArray(parsedRefunds) ? parsedRefunds.map(normalizeRefund) : []
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
  return (sale.items ?? []).reduce((sum, item) => sum + item.total, 0)
}

function getRefundCost(refund: SaleRefund, sales: Sale[]) {
  const sale = sales.find((currentSale) => currentSale.id === refund.saleId)

  return (refund.items ?? []).reduce((sum, item) => {
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

/**
 * Refunds that count: everything except server-rejected refunds a manager has
 * settled (those never reached the server's books — the settlement records
 * the money instead, e.g. as a loss expense). Used by metrics, reports and
 * refundable-quantity math so local numbers converge with the server's.
 */
export function getRefunds() {
  return readRefunds().filter((refund) => !refund.conflict)
}

/** Every refund on this device, including settled server-rejected ones (history views). */
export function getAllRefunds() {
  return readRefunds()
}

export function getRefundsForSale(saleId: string) {
  return getRefunds().filter((refund) => refund.saleId === saleId)
}

/**
 * Pure constructor — builds the canonical Sale object WITHOUT persisting it.
 * Used both by recordSale (local-first path) and by the server-authoritative
 * write-through path, which must have the exact sale object (with its
 * client-generated id) to send to the hub BEFORE anything is written locally.
 * Does not touch tender/tax math — it copies the already-computed input values.
 */
export function buildSale(input: RecordSaleInput, id: string): Sale {
  assertCanWrite("record sale")
  const cost = input.items.reduce((sum, item) => sum + item.cost * item.quantity, 0)
  const currentUser = getCurrentUser()
  const activeShift = getActiveShift()
  // Shift gate — every sale requires an open register shift
  if (!activeShift) {
    throw new Error("No open shift. Please open a shift before recording a sale.")
  }
  return {
    id,
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
    soldAtCost: input.soldAtCost,
    tender: input.tender,
    payableLbp: input.payableLbp,
    // REFUND-INTEGRITY-1: every line gets a stable identity so refunds track
    // each line (not just each product) on this device and on the server.
    items: input.items.map((item) => (item.lineId ? item : { ...item, lineId: createId("line") })),
    cashier: currentUser.name,
    shiftId: activeShift.id,
    shiftNumber: activeShift.shiftNumber,
    registerId: getRegisterId(),
    deviceId: getDeviceId(),
    status: input.paymentMethod === "Debt" ? "Debt" : "Completed",
    createdAt: new Date().toISOString(),
  }
}

/** Persist a built sale locally (+ audit). Enqueues a sync op unless skipSync
 *  — the write-through path passes skipSync because the hub already committed
 *  the sale authoritatively, so re-enqueuing it would be redundant. */
function persistSaleRecord(sale: Sale, opts?: { skipSync?: boolean }) {
  writeSales([sale, ...getSales()])
  recordAuditEvent({
    action: "sale.complete",
    entity: "sale",
    summary: `${sale.saleNumber} completed by ${sale.cashier} for $${sale.total.toFixed(2)}.`,
    metadata: {
      saleId: sale.id,
      paymentMethod: sale.paymentMethod,
      discountTotal: sale.discountTotal ?? 0,
      total: sale.total,
      shiftId: sale.shiftId,
      shiftNumber: sale.shiftNumber,
    },
  })
  if (!opts?.skipSync) {
    enqueueSyncOperation({
      entity: "sale",
      action: "create",
      summary: `${sale.saleNumber} sale queued for sync.`,
      payload: sale,
    })
  }
}

export function recordSale(input: RecordSaleInput, opts?: { id?: string; skipSync?: boolean }) {
  const sale = buildSale(input, opts?.id ?? createId())
  persistSaleRecord(sale, opts)
  return sale
}

/** Finalize a sale the hub has already committed (server-authoritative
 *  write-through): persist it locally for receipt/history WITHOUT re-enqueuing.
 *  The hub owns the authoritative stock/batch decrement; the next pull
 *  reconciles local stock. */
export function finalizeCommittedSale(sale: Sale) {
  persistSaleRecord(sale, { skipSync: true })
  return sale
}

// ── Refunds & voids (REFUND-INTEGRITY-1) ──────────────────────────────────
// The till and the server apply the same rules (lib/refundAllocation.ts):
// cumulative per-line refundable quantities, lots restored from the sale's
// recorded allocations in original order net of earlier refunds, legacy lines
// pooled per product with product-stock-only restoration, and the original
// sale's exchange rate. See docs/REFUND-INTEGRITY.md.

/** Id of a debt refund's customer credit — identical on the till and the server. */
export function refundCreditId(refundId: string) {
  return `refund-credit:${refundId}`
}

/** The key a sale line is refunded under: its lineId, or the legacy per-product pool. */
export function refundLineKeyOf(item: Pick<SaleItem, "id" | "lineId">): string {
  return item.lineId ? item.lineId : legacyLineKey(item.id)
}

/** Refundable lines of a sale. Lot data is only used for lines with a line id. */
export function refundableLinesOf(sale: Sale): RefundableLine[] {
  return buildRefundableLines(
    (sale.items ?? []).map((item) => ({
      lineId: item.lineId ?? null,
      productId: item.id,
      quantity: item.quantity,
      allocations: item.lineId ? item.batchAllocations ?? [] : null,
    }))
  )
}

/** Prior refund lines of a sale, from the refunds that count (see getRefunds). */
export function priorRefundLinesOf(refunds: SaleRefund[], saleId: string): PriorRefundLine[] {
  return refunds
    .filter((refund) => refund.saleId === saleId)
    .flatMap((refund) =>
      (refund.items ?? []).map((item) => {
        const key = item.saleLineId || legacyLineKey(item.id)
        return {
          key,
          quantity: item.quantity,
          allocations: isLegacyLineKey(key) ? null : normalizeAllocations(item.batchAllocations),
        }
      })
    )
}

/** Remaining refundable quantity of one sale line (pooled per product for legacy lines). */
export function getLineRefundableQuantity(sale: Sale, item: SaleItem, refunds: SaleRefund[]): number {
  const key = refundLineKeyOf(item)
  const line = refundableLinesOf(sale).find((candidate) => candidate.key === key)
  return line ? refundableQuantity(line, priorRefundLinesOf(refunds, sale.id)) : 0
}

const REFUND_JOURNAL_KEY = "lebanonpos.refund-journal.v1"

type RefundJournalEntry = {
  refundId: string
  startedAt: string
  refund: SaleRefund
  plan: Array<{ productId: number; productName: string; barcode: string; quantity: number; allocations: AllocationSlice[] | null }>
  debt?: { customerId: string; amount: number; reference: string }
  steps: { lots: boolean; stock: boolean; committed: boolean; debt: boolean; ledger: boolean }
}

function readRefundJournal(): RefundJournalEntry[] {
  if (!canUseStorage()) return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(REFUND_JOURNAL_KEY) ?? "[]")
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
function saveJournalEntry(entry: RefundJournalEntry) {
  const others = readRefundJournal().filter((e) => e.refundId !== entry.refundId)
  window.localStorage.setItem(REFUND_JOURNAL_KEY, JSON.stringify([...others, entry]))
}
function dropJournalEntry(refundId: string) {
  window.localStorage.setItem(
    REFUND_JOURNAL_KEY,
    JSON.stringify(readRefundJournal().filter((e) => e.refundId !== refundId))
  )
}

/** Refund operations not yet confirmed by the server, for diagnostics/tests. */
export function getPendingRefundJournal() {
  return readRefundJournal()
}

function planSlices(entry: RefundJournalEntry): AllocationSlice[] {
  return entry.plan.flatMap((line) => line.allocations ?? [])
}

function refundOpEnqueued(refundId: string): boolean {
  return getSyncQueue().some(
    (op) => op.entity === "refund" && op.action === "create" && (op.payload as { id?: string } | undefined)?.id === refundId
  )
}

/** Commit point: the refund record and its sync operation. Idempotent. */
function commitRefundEntry(entry: RefundJournalEntry) {
  const all = readRefunds()
  if (!all.some((refund) => refund.id === entry.refundId)) writeRefunds([entry.refund, ...all])
  if (!refundOpEnqueued(entry.refundId)) {
    enqueueSyncOperation({
      entity: "refund",
      action: "create",
      summary: `${entry.refund.refundNumber} refund queued for sync.`,
      payload: entry.refund,
    })
  }
  entry.steps.committed = true
  saveJournalEntry(entry)
}

/** Undo the reversible pre-commit effects (stock, lots). */
function rollbackRefundEntry(entry: RefundJournalEntry) {
  if (entry.steps.stock) {
    decreaseProductStock(entry.plan.map((line) => ({ productId: line.productId, quantity: line.quantity })))
    entry.steps.stock = false
  }
  if (entry.steps.lots) {
    applyLotRestoration(planSlices(entry), -1)
    entry.steps.lots = false
  }
}

/** Post-commit effects; each is idempotent so a restart can safely resume. */
function finishRefundEntry(entry: RefundJournalEntry) {
  if (entry.debt && !entry.steps.debt) {
    // The server creates this credit itself as part of the refund (same
    // transaction, id refund-credit:<refundId>), so a refund the server
    // rejects can never leave its credit behind. Locally it is shown at once
    // under the same id and never pushed as its own operation; the next pull
    // replaces it with the server's copy.
    const creditId = refundCreditId(entry.refundId)
    if (!getDebtPayments().some((payment) => payment.id === creditId)) {
      recordDebtPayment(
        { id: creditId, customerId: entry.debt.customerId, amount: entry.debt.amount, method: "Refund Credit", reference: entry.debt.reference },
        { localOnly: true }
      )
    }
    entry.steps.debt = true
    saveJournalEntry(entry)
  }
  if (!entry.steps.ledger) {
    for (const line of entry.plan) {
      recordStockMovement({
        productId: line.productId, productName: line.productName, type: "Refund", quantity: line.quantity,
        reference: entry.refund.refundNumber, note: `Refund of ${entry.refund.saleNumber}`,
      })
    }
    recordAuditEvent({
      action: "sale.refund",
      entity: "sale",
      summary: `${entry.refund.refundNumber} refunded ${entry.refund.saleNumber} for $${entry.refund.total.toFixed(2)}.`,
      metadata: {
        refundId: entry.refund.id,
        saleId: entry.refund.saleId,
        saleNumber: entry.refund.saleNumber,
        method: entry.refund.method,
        total: entry.refund.total,
        exchangeRate: entry.refund.exchangeRate ?? null,
        rateSource: entry.refund.rateSource,
        shiftId: entry.refund.shiftId,
        shiftNumber: entry.refund.shiftNumber,
      },
    })
    entry.steps.ledger = true
    saveJournalEntry(entry)
  }
  dropJournalEntry(entry.refundId)
}

export type ProcessRefundInput = {
  saleId: string
  /** Requested quantity per sale-line key (see refundLineKeyOf). */
  quantities: Record<string, number>
  reason: string
}

/** Test hook: lets a test simulate a crash between two refund steps. */
export const refundFaults: { afterStep?: (step: "lots" | "stock" | "commit") => void } = {}

/**
 * Record a refund. Validates cumulative refundable quantities with the shared
 * rules, restores stock and lots, and commits the refund + its sync operation.
 * A failure before the commit rolls everything back (nothing to hand the
 * customer); after the commit, recoverRefundJournal() completes it on restart.
 */
/**
 * Side-effect-free plan of a refund, with the money it will return. Used by
 * the confirm step so the amount shown is exactly what processRefund records.
 * Throws a RefundRuleError (code-prefixed message) when the request is not allowed.
 */
export function previewRefund(input: ProcessRefundInput) {
  const sale = readSales().find((candidate) => candidate.id === input.saleId)
  if (!sale) throw new Error("Sale not found on this device.")
  if (sale.status === "Voided") throw new Error("REFUND_SALE_VOIDED: This sale was voided and cannot be refunded.")
  const lines = refundableLinesOf(sale)
  const countable = getRefunds()
  const planned: PlannedRefundLine[] = planRefund(
    lines,
    priorRefundLinesOf(countable, sale.id),
    Object.entries(input.quantities).map(([key, quantity]) => ({
      key,
      productId: lines.find((line) => line.key === key)?.productId ?? -1,
      quantity,
    }))
  )

  const itemFor = (key: string) => sale.items.find((item) => refundLineKeyOf(item) === key)
  const grossSubtotal = getSaleGrossSubtotal(sale)
  const refundGross = planned.reduce((sum, line) => sum + (itemFor(line.key)?.unitPrice ?? 0) * line.quantity, 0)
  const priorTotals = countable.filter((refund) => refund.saleId === sale.id).map((refund) => refund.total)
  const remaining = Math.max(0, sale.total - priorTotals.reduce((sum, value) => sum + value, 0))
  const total = Math.round(Math.min(remaining, grossSubtotal > 0 ? refundGross * (sale.total / grossSubtotal) : 0) * 10000) / 10000
  assertRefundAmount(sale.total, priorTotals, total)
  const rate = resolveRefundRate(sale.tender?.exchangeRate ?? null)
  const method: RefundMethod = sale.paymentMethod === "Debt" ? "Debt_Credit" : sale.paymentMethod
  return { sale, planned, total, rate, method, itemFor }
}

export function processRefund(input: ProcessRefundInput): SaleRefund {
  assertCanWrite("record refund")
  const currentUser = getCurrentUser()
  const activeShift = getActiveShift()
  // Pilot policy: all refunds require an open shift.
  if (!activeShift) {
    throw new Error("No open shift. Please open a shift before processing a refund.")
  }
  const { sale, planned, total, rate, method, itemFor } = previewRefund(input)

  const refund: SaleRefund = {
    id: createId(),
    refundNumber: `R-${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`,
    saleId: sale.id,
    saleNumber: sale.saleNumber,
    customerId: sale.customerId,
    customerName: sale.customerName,
    method,
    reason: input.reason.trim() || "Customer return",
    total,
    items: planned.map((line) => {
      const saleItem = itemFor(line.key)!
      return {
        id: line.productId,
        name: saleItem.name,
        barcode: saleItem.barcode,
        quantity: line.quantity,
        unitPrice: saleItem.unitPrice,
        cost: saleItem.cost,
        total: roundQty(saleItem.unitPrice * line.quantity),
        saleLineId: line.key,
        ...(line.allocations ? { batchAllocations: line.allocations } : {}),
      }
    }),
    cashier: currentUser.name,
    shiftId: activeShift.id,
    shiftNumber: activeShift.shiftNumber,
    registerId: getRegisterId(),
    deviceId: getDeviceId(),
    createdAt: new Date().toISOString(),
    exchangeRate: rate.exchangeRate,
    rateSource: rate.rateSource,
  }

  const entry: RefundJournalEntry = {
    refundId: refund.id,
    startedAt: refund.createdAt,
    refund,
    plan: planned.map((line) => {
      const saleItem = itemFor(line.key)!
      return { productId: line.productId, productName: saleItem.name, barcode: saleItem.barcode, quantity: line.quantity, allocations: line.allocations }
    }),
    ...(sale.paymentMethod === "Debt" && sale.customerId
      ? { debt: { customerId: sale.customerId, amount: total, reference: `${refund.refundNumber} return for ${sale.saleNumber}` } }
      : {}),
    steps: { lots: false, stock: false, committed: false, debt: false, ledger: false },
  }

  saveJournalEntry(entry)
  try {
    applyLotRestoration(planSlices(entry), 1)
    entry.steps.lots = true
    saveJournalEntry(entry)
    refundFaults.afterStep?.("lots")

    increaseProductStock(entry.plan.map((line) => ({ productId: line.productId, quantity: line.quantity })))
    entry.steps.stock = true
    saveJournalEntry(entry)
    refundFaults.afterStep?.("stock")

    commitRefundEntry(entry)
  } catch (error) {
    if (!readRefunds().some((existing) => existing.id === refund.id)) {
      rollbackRefundEntry(entry)
      dropJournalEntry(refund.id)
      throw error
    }
    // The refund record exists: it is issued. Make sure it is queued, then
    // leave the rest to recovery rather than undoing an issued refund.
    try { commitRefundEntry(entry) } catch { /* recovered on restart */ }
    console.error("[refund] post-commit step failed; will complete on restart:", error)
    return refund
  }
  refundFaults.afterStep?.("commit")
  try {
    finishRefundEntry(entry)
  } catch (error) {
    console.error("[refund] post-commit step failed; will complete on restart:", error)
  }
  return refund
}

/**
 * Run once at startup. Refunds interrupted before their commit point are rolled
 * back (no refund was issued); committed ones are completed (queued for sync,
 * debt credit and ledger entries recorded). Returns what was done.
 */
export function recoverRefundJournal(): { rolledBack: number; completed: number } {
  const result = { rolledBack: 0, completed: 0 }
  if (!canUseStorage()) return result
  for (const entry of readRefundJournal()) {
    try {
      const issued = readRefunds().some((refund) => refund.id === entry.refundId)
      if (!issued) {
        rollbackRefundEntry(entry)
        dropJournalEntry(entry.refundId)
        recordAuditEvent({
          action: "sale.refund.aborted",
          entity: "sale",
          summary: `Interrupted refund ${entry.refund.refundNumber} for ${entry.refund.saleNumber} was rolled back (it was never issued).`,
          metadata: { refundId: entry.refundId, saleId: entry.refund.saleId },
        })
        result.rolledBack++
      } else {
        commitRefundEntry(entry)
        finishRefundEntry(entry)
        result.completed++
      }
    } catch (error) {
      console.error("[refund] journal recovery failed for", entry.refundId, error)
    }
  }
  return result
}

/**
 * Void a sale. Refused once the sale has any refund (refund the remaining
 * items instead) — a void would otherwise restore the refunded quantity a
 * second time. Restores lots from the sale's recorded allocations.
 */
export function voidSale(saleId: string, restoreStock = true) {
  assertCanWrite("void sale")
  const sales = readSales()
  const sale = sales.find((item) => item.id === saleId)
  if (!sale) return

  // Guard: already voided — do nothing (prevents double-restock)
  if (sale.status === "Voided") return

  const plan = planVoidRestoration(refundableLinesOf(sale), priorRefundLinesOf(getRefunds(), sale.id))

  const nextSales = sales.map((item) =>
    item.id === saleId ? { ...item, status: "Voided" as const } : item
  )
  writeSales(nextSales)

  // 1. Restore product stock for every line item (unless the caller
  //    knows stock was never decremented, e.g. partial error recovery)
  if (restoreStock) {
    increaseProductStock(plan.map((line) => ({ productId: line.productId, quantity: line.quantity })))
  }

  // 2. Return the consumed lots recorded on the sale (local only — the
  //    server restores its own lots when the void syncs).
  applyLotRestoration(plan.flatMap((line) => line.allocations ?? []), 1)

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
    payload: { id: saleId, saleNumber: sale.saleNumber },
  })
}

/** Settle a server-rejected refund locally (see refundConflict.service). */
export function markRefundConflictResolved(refundId: string, resolution: RefundConflictResolution) {
  const all = readRefunds()
  if (!all.some((refund) => refund.id === refundId)) return false
  writeRefunds(all.map((refund) => (refund.id === refundId ? { ...refund, conflict: resolution } : refund)))
  return true
}

export function getSalesMetrics() {
  const sales = getSales()
  const refunds = getRefunds()
  const todaySales = sales.filter(
    (sale) => isToday(sale.createdAt) && sale.status !== "Voided"
  )
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
        .filter((refund) => refund.method !== "Debt_Credit")
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
  const totals = getSales()
    .filter((sale) => sale.status !== "Voided")
    .reduce<Record<SalePaymentMethod, number>>(
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
    const method = refund.method === "Debt_Credit" ? "Debt" : refund.method

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
    (sale.items ?? []).forEach((item) => {
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

export type OpAlert = { type: "warning" | "danger" | "info"; message: string; action?: string }

export function getOperationalAlerts(): OpAlert[] {
  const alerts: OpAlert[] = []

  // License-based alerts
  try {
    const licenseRaw = localStorage.getItem("lebanonpos.license.v1")
    if (licenseRaw) {
      const license = JSON.parse(licenseRaw)
      if (license.status === "grace") {
        alerts.push({
          type: "warning",
          message: `License grace period — ${license.message || "Contact support to renew."}`,
        })
      }
      if (license.status === "suspended") {
        alerts.push({
          type: "danger",
          message: `Store suspended — ${license.message || "Contact support."}`,
        })
      }
    }
  } catch { /* ignore corrupt license data */ }

  // Failed sync alert
  try {
    const queueRaw = localStorage.getItem("lebanonpos.sync-queue.v1")
    if (queueRaw) {
      const queue = JSON.parse(queueRaw)
      const failed = (Array.isArray(queue) ? queue : []).filter((o: any) => o.status === "Failed").length
      if (failed > 0) {
        alerts.push({
          type: "warning",
          message: `${failed} sync operation${failed > 1 ? "s" : ""} failed. Check Settings.`,
          action: "retry-sync",
        })
      }
    }
  } catch { /* ignore corrupt queue */ }

  return alerts
}
