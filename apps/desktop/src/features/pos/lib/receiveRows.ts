// Receiving rows: the pure rules behind the Receive page (no storage, no React).
//
// POS-RECEIVE-UX-1A: every row carries an explicit decision. `mode` is chosen,
// not inferred from empty fields. `scannedBarcode` preserves the exact code that
// was scanned (which may be an alias of a matched product); `targetProductId` is
// the product an `alias` row attaches its barcode to. Nothing is written until
// the delivery is saved, and a saved row leaves the grid so it can never be
// received twice.
import type { Product, ProductAccent } from "../types/product"
import { createId } from "./storage"
import type { ReceiveRowResult } from "../services/receiveSubmission.service"

export type ReceiveRowMode = "matched" | "new" | "alias" | "variant" | "conflict"
export type BatchRow = {
  id: string; name: string; category: string; quantity: number
  cost: number; price: number; reorderPoint: number; reorderQuantity: number
  expiryDate: string; barcode: string; labels: number; accent: ProductAccent
  mode: ReceiveRowMode; scannedBarcode: string; targetProductId?: number
  decisionConfirmed?: boolean
  /** POS-PRODUCT-IMAGE-1: optional image for NEW-product rows (staged to Save). */
  image?: string
  /** POS-RECEIVE-VARIANT-1B: staged variant of an existing parent product. */
  parentProductId?: number; variantName?: string
  /** Why the last save did not accept this row (it stays in the grid). */
  saveError?: string
}

const accents: ProductAccent[] = ["emerald", "cyan", "amber", "rose", "violet", "indigo"]

export function normalizeCode(value: string) {
  return value.trim().replace(/\s+/g, "")
}

export function createRow(defaults?: Partial<BatchRow>): BatchRow {
  return {
    id: createId(), name: "", category: "", quantity: 0, cost: 0, price: 0, reorderPoint: 10, reorderQuantity: 20,
    expiryDate: "", barcode: "", labels: 1, accent: accents[Math.floor(Math.random() * accents.length)],
    mode: "new", scannedBarcode: "", targetProductId: undefined, decisionConfirmed: false, ...defaults,
  }
}

/** A row nobody has started: it is ignored by Save and never reported as a problem. */
export function isBlankRow(row: BatchRow) {
  return !row.name.trim() && !row.barcode.trim() && !row.scannedBarcode.trim() && !row.quantity
}

export function isRowReady(row: BatchRow) {
  // alias rows are ready once a target is picked + a scanned barcode + qty; the
  // name is mirrored from the target so it is always present.
  if (row.mode === "alias") return !!row.targetProductId && row.scannedBarcode.trim().length > 0 && row.quantity > 0
  // variant rows need a parent, a variant name, its own barcode, and qty.
  if (row.mode === "variant") return !!row.parentProductId && (row.variantName ?? "").trim().length > 0 && row.scannedBarcode.trim().length > 0 && row.quantity > 0
  return row.name.trim().length > 0 && row.barcode.trim().length > 0 && row.quantity > 0
}

export type RowProblem =
  | "needs_decision" | "missing_name" | "missing_barcode" | "missing_quantity"
  | "missing_target" | "missing_variant_name" | "negative_money"
export type RowNotice = "cost_over_price" | "cost_up" | "cost_down"

/** What blocks this row (errors) and what deserves a look (notices). Shown on the row at all times. */
export function rowProblems(row: BatchRow, product?: Product): { problems: RowProblem[]; notices: Array<{ key: RowNotice; pct?: number }> } {
  const problems: RowProblem[] = []
  const notices: Array<{ key: RowNotice; pct?: number }> = []
  if (isBlankRow(row)) return { problems, notices }
  if (row.mode === "new" && row.barcode.trim() && !row.decisionConfirmed && !row.name.trim()) problems.push("needs_decision")
  if (row.mode === "alias" && !row.targetProductId) problems.push("missing_target")
  if (row.mode === "variant") {
    if (!row.parentProductId) problems.push("missing_target")
    if (!(row.variantName ?? "").trim()) problems.push("missing_variant_name")
  }
  if (row.mode !== "alias" && row.mode !== "variant") {
    if (!row.name.trim() && !problems.includes("needs_decision")) problems.push("missing_name")
    if (!row.barcode.trim()) problems.push("missing_barcode")
  } else if (!row.scannedBarcode.trim()) problems.push("missing_barcode")
  if (!(row.quantity > 0)) problems.push("missing_quantity")
  if (row.cost < 0 || row.price < 0) problems.push("negative_money")
  if (row.cost > 0 && row.price > 0 && row.cost > row.price) notices.push({ key: "cost_over_price" })
  if (product && product.cost > 0 && row.cost > 0 && Math.abs(row.cost - product.cost) / product.cost >= 0.05) {
    const pct = Math.round(((row.cost - product.cost) / product.cost) * 100)
    notices.push({ key: pct > 0 ? "cost_up" : "cost_down", pct })
  }
  return { problems, notices }
}

/** Fill a row from a scanned code: a known code (primary or alias) restocks that product; an unknown one is a new product until decided. */
export function fillRowFromBarcode(row: BatchRow, barcode: string, product: Product | undefined): BatchRow {
  if (!product) {
    return { ...row, barcode, scannedBarcode: barcode, mode: "new", targetProductId: undefined, decisionConfirmed: false, name: "", category: row.category || "Pantry", price: 0, cost: 0, reorderPoint: 10, reorderQuantity: 20, expiryDate: "" }
  }
  return {
    ...row, mode: "matched", targetProductId: undefined, scannedBarcode: barcode, name: product.name, category: product.category,
    price: product.price, cost: product.cost, reorderPoint: product.reorderPoint ?? 10, reorderQuantity: product.reorderQuantity ?? 20,
    expiryDate: row.expiryDate || "", barcode: product.barcode, accent: product.accent,
  }
}

/**
 * A scan into the delivery: the same product scanned again adds one to its
 * row (when that row has no expiry of its own yet); otherwise a new row is
 * filled from the code. Blank rows are reused instead of piling up.
 */
export function addScan(rows: BatchRow[], code: string, product: Product | undefined): { rows: BatchRow[]; rowId: string; merged: boolean } {
  const clean = normalizeCode(code)
  const existing = rows.find((r) => !r.expiryDate && (
    (product && r.mode === "matched" && r.barcode === product.barcode) ||
    (!product && normalizeCode(r.scannedBarcode || r.barcode) === clean)
  ))
  if (existing) {
    return { rows: rows.map((r) => (r.id === existing.id ? { ...r, quantity: (r.quantity || 0) + 1, saveError: undefined } : r)), rowId: existing.id, merged: true }
  }
  const blank = rows.find(isBlankRow)
  const base = blank ?? createRow()
  const filled = { ...fillRowFromBarcode(base, clean, product), quantity: 1 }
  return { rows: blank ? rows.map((r) => (r.id === blank.id ? filled : r)) : [...rows, filled], rowId: filled.id, merged: false }
}

/** The receiveAndRecord entry for a ready row (identical to the page's previous mapping). */
export function toReceiveEntry(r: BatchRow) {
  return { ...toReceiveFields(r), rowId: r.id }
}
function toReceiveFields(r: BatchRow) {
  if (r.mode === "alias") {
    return { name: r.name, barcode: r.scannedBarcode, category: r.category, quantity: r.quantity, cost: r.cost, price: r.price, reorderPoint: r.reorderPoint, reorderQuantity: r.reorderQuantity, expiryDate: r.expiryDate, attachAliasToProductId: r.targetProductId }
  }
  if (r.mode === "variant") {
    return { name: r.name, barcode: r.scannedBarcode, category: r.category, quantity: r.quantity, cost: r.cost, price: r.price, reorderPoint: r.reorderPoint, reorderQuantity: r.reorderQuantity, expiryDate: r.expiryDate, image: r.image, parentId: r.parentProductId, variantName: (r.variantName ?? "").trim() }
  }
  return { name: r.name, barcode: r.barcode, category: r.category, quantity: r.quantity, cost: r.cost, price: r.price, reorderPoint: r.reorderPoint, reorderQuantity: r.reorderQuantity, expiryDate: r.expiryDate, image: r.mode === "new" ? r.image : undefined }
}
/** A save's per-row results, by row id: accepted rows leave the grid, rejected rows stay with
 *  their reason. Rows the results do not mention were not part of the save and are untouched. */
export function applyReceiveResults(rows: BatchRow[], results: ReceiveRowResult[]): BatchRow[] {
  const byId = new Map(results.map((r) => [r.rowId, r]))
  const next = rows
    .filter((r) => byId.get(r.id)?.status !== "accepted")
    .map((r) => {
      const res = byId.get(r.id)
      return res?.status === "rejected" ? { ...r, saveError: res.reason || "rejected" } : r
    })
  return next.length > 0 ? next : [createRow()]
}

// ── Draft: the delivery being entered survives leaving the page, a reload or a crash ──
// Stored per tenant by receiveSubmission.service; this is only the (de)serialization.
export type ReceiveDraft = {
  version: 2
  rows: BatchRow[]
  supplierId: string
  invoiceNumber: string
  paymentMethod: string
  note: string
  /** A save that was in flight for these rows (see receiveSubmission.service). */
  pending?: { submissionId: string; rowIds: string[] }
  savedAt: string
}

export function serializeDraft(d: Omit<ReceiveDraft, "version" | "savedAt">): string {
  // Images can be large data URLs; they are dropped from the draft (re-add after restoring).
  return JSON.stringify({ version: 2, ...d, rows: d.rows.map((r) => ({ ...r, image: undefined })), savedAt: new Date().toISOString() })
}

/** A draft worth restoring: right version and at least one started row, or a pending save to
 *  account for. Anything malformed is ignored. */
export function parseDraft(raw: string | null): ReceiveDraft | null {
  if (!raw) return null
  try {
    const d = JSON.parse(raw)
    if (d?.version !== 2 || !Array.isArray(d.rows)) return null
    const rows = (d.rows as BatchRow[]).filter((r) => r && typeof r.id === "string" && typeof r.mode === "string")
    const pending = d.pending && typeof d.pending.submissionId === "string" && Array.isArray(d.pending.rowIds) ? d.pending : undefined
    if (!pending && !rows.some((r) => !isBlankRow({ ...createRow(), ...r }))) return null
    return { ...d, pending, rows: rows.map((r) => ({ ...createRow(), ...r })) }
  } catch {
    return null
  }
}
