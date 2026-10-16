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
  if (r.mode === "alias") {
    return { name: r.name, barcode: r.scannedBarcode, category: r.category, quantity: r.quantity, cost: r.cost, price: r.price, reorderPoint: r.reorderPoint, reorderQuantity: r.reorderQuantity, expiryDate: r.expiryDate, attachAliasToProductId: r.targetProductId }
  }
  if (r.mode === "variant") {
    return { name: r.name, barcode: r.scannedBarcode, category: r.category, quantity: r.quantity, cost: r.cost, price: r.price, reorderPoint: r.reorderPoint, reorderQuantity: r.reorderQuantity, expiryDate: r.expiryDate, image: r.image, parentId: r.parentProductId, variantName: (r.variantName ?? "").trim() }
  }
  return { name: r.name, barcode: r.barcode, category: r.category, quantity: r.quantity, cost: r.cost, price: r.price, reorderPoint: r.reorderPoint, reorderQuantity: r.reorderQuantity, expiryDate: r.expiryDate, image: r.mode === "new" ? r.image : undefined }
}

/**
 * After a save: the rows that were sent and accepted leave the grid; rows the
 * save rejected stay, with the reason; rows that were not ready stay as they
 * were. The receive service reports rejections as "Entry #N: …" (N = position
 * in what was sent) or "\"<barcode>\" already used by …".
 */
export function applySaveResult(rows: BatchRow[], sent: BatchRow[], errors: string[]): { rows: BatchRow[]; unmatchedErrors: string[] } {
  const rejected = new Map<string, string>()
  const unmatchedErrors: string[] = []
  for (const err of errors) {
    const byIndex = /^Entry #(\d+):\s*(.*)$/.exec(err)
    if (byIndex && sent[Number(byIndex[1]) - 1]) { rejected.set(sent[Number(byIndex[1]) - 1].id, byIndex[2] || err); continue }
    const byCode = /^"([^"]+)"/.exec(err)
    const row = byCode ? sent.find((r) => normalizeCode(r.scannedBarcode || r.barcode) === byCode[1] || r.barcode === byCode[1]) : undefined
    if (row) rejected.set(row.id, err)
    else unmatchedErrors.push(err)
  }
  const sentIds = new Set(sent.map((r) => r.id))
  // A sent row leaves the grid unless it is positively identified as rejected. An error that names
  // no row is shown to the operator instead: keeping rows that may already be in would let the same
  // delivery be received twice, which is worse than asking someone to re-add one line.
  const next = rows
    .filter((r) => !sentIds.has(r.id) || rejected.has(r.id))
    .map((r) => (rejected.has(r.id) ? { ...r, saveError: rejected.get(r.id) } : r))
  return { rows: next.length > 0 ? next : [createRow()], unmatchedErrors }
}

// ── Draft: the delivery being entered survives leaving the page or a reload ──
export const RECEIVE_DRAFT_KEY = "lebanonpos.receive-draft.v1"
export type ReceiveDraft = {
  version: 1
  rows: BatchRow[]
  supplierId: string
  invoiceNumber: string
  paymentMethod: string
  note: string
  savedAt: string
}

export function serializeDraft(d: Omit<ReceiveDraft, "version" | "savedAt">): string {
  // Images can be large data URLs; they are dropped from the draft (re-add after restoring).
  return JSON.stringify({ version: 1, ...d, rows: d.rows.map((r) => ({ ...r, image: undefined })), savedAt: new Date().toISOString() })
}

/** A draft worth restoring: right version and at least one started row. Anything malformed is ignored. */
export function parseDraft(raw: string | null): ReceiveDraft | null {
  if (!raw) return null
  try {
    const d = JSON.parse(raw)
    if (d?.version !== 1 || !Array.isArray(d.rows)) return null
    const rows = (d.rows as BatchRow[]).filter((r) => r && typeof r.id === "string" && typeof r.mode === "string")
    if (!rows.some((r) => !isBlankRow({ ...createRow(), ...r }))) return null
    return { ...d, rows: rows.map((r) => ({ ...createRow(), ...r })) }
  } catch {
    return null
  }
}
