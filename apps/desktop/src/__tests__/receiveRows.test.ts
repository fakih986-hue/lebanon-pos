import { describe, it, expect } from "vitest"
import {
  addScan, applyReceiveResults, createRow, isBlankRow, isRowReady, parseDraft, rowProblems, serializeDraft, toReceiveEntry,
  type BatchRow,
} from "../features/pos/lib/receiveRows"
import type { Product } from "../features/pos/types/product"

const pepsi = { id: 2, name: "Pepsi Can", barcode: "528100100002", category: "Drinks", price: 0.9, cost: 0.5, stock: 10, accent: "cyan" } as Product
const matched = (over: Partial<BatchRow> = {}) => ({ ...addScan([createRow()], pepsi.barcode, pepsi).rows[0], ...over })

describe("receiving rows", () => {
  it("a scan fills a blank row; scanning the same product again adds one to that row", () => {
    const first = addScan([createRow()], pepsi.barcode, pepsi)
    expect(first.rows).toHaveLength(1)
    expect(first.rows[0]).toMatchObject({ mode: "matched", name: "Pepsi Can", quantity: 1 })
    const again = addScan(first.rows, pepsi.barcode, pepsi)
    expect(again.merged).toBe(true)
    expect(again.rows).toHaveLength(1)
    expect(again.rows[0].quantity).toBe(2)
  })

  it("a row with its own expiry is not merged into: a different expiry is a different lot", () => {
    const one = matched({ quantity: 3, expiryDate: "2026-12-01" })
    const next = addScan([one], pepsi.barcode, pepsi)
    expect(next.merged).toBe(false)
    expect(next.rows).toHaveLength(2)
  })

  it("an unknown code is a new product that needs a decision; problems are reported per row", () => {
    const { rows } = addScan([createRow()], "6291041500213", undefined)
    expect(rows[0].mode).toBe("new")
    expect(rowProblems(rows[0]).problems).toContain("needs_decision")
    expect(isRowReady(rows[0])).toBe(false)
  })

  it("blank rows are neither ready nor problems", () => {
    const r = createRow()
    expect(isBlankRow(r)).toBe(true)
    expect(rowProblems(r).problems).toEqual([])
  })

  it("flags cost above price and a cost change of 5% or more versus the product", () => {
    const n = rowProblems(matched({ quantity: 1, cost: 0.6 }), pepsi).notices
    expect(n).toContainEqual({ key: "cost_up", pct: 20 })
    expect(rowProblems(matched({ quantity: 1, cost: 1, price: 0.9 }), pepsi).notices.map((x) => x.key)).toContain("cost_over_price")
  })

  it("after a save, results by row id: accepted rows leave, rejected rows stay with the reason, others are untouched", () => {
    const a = matched({ quantity: 5 })
    const b = { ...createRow(), name: "Kitkat", barcode: "999", quantity: 2, mode: "new" as const, decisionConfirmed: true }
    const c = { ...createRow(), barcode: "123", scannedBarcode: "123" } // not ready, not sent
    const rows = applyReceiveResults([a, b, c], [
      { rowId: a.id, status: "accepted" },
      { rowId: b.id, status: "rejected", reason: '"999" already used by "Other"' },
    ])
    expect(rows.map((x) => x.id)).toEqual([b.id, c.id])
    expect(rows[0].saveError).toContain("already used")
  })

  it("identifies rows structurally: identical-looking rows are told apart by id, never by message text", () => {
    const a = matched({ quantity: 5 }); const b = matched({ id: "b", quantity: 5 })
    const rows = applyReceiveResults([a, b], [{ rowId: a.id, status: "rejected", reason: "Entry #2: odd text" }, { rowId: "b", status: "accepted" }])
    expect(rows.map((x) => x.id)).toEqual([a.id])
    expect(toReceiveEntry(a).rowId).toBe(a.id)
  })

  it("keeps the previous entry mapping (alias and variant rows send the scanned code)", () => {
    const alias = { ...createRow(), mode: "alias" as const, targetProductId: 2, scannedBarcode: "777", barcode: "777", name: "Pepsi Can", quantity: 3 }
    expect(toReceiveEntry(alias)).toMatchObject({ barcode: "777", attachAliasToProductId: 2, quantity: 3 })
    const variant = { ...createRow(), mode: "variant" as const, parentProductId: 2, variantName: " 1L ", scannedBarcode: "888", barcode: "888", name: "Pepsi Can - 1L", quantity: 1 }
    expect(toReceiveEntry(variant)).toMatchObject({ barcode: "888", parentId: 2, variantName: "1L" })
  })

  it("a draft round-trips without images, and malformed or empty drafts are ignored", () => {
    const row = matched({ quantity: 4, image: "data:image/png;base64,AAAA" })
    const d = parseDraft(serializeDraft({ rows: [row], supplierId: "s1", invoiceNumber: "INV-1", paymentMethod: "Cash", note: "" }))
    expect(d?.rows[0]).toMatchObject({ name: "Pepsi Can", quantity: 4 })
    expect(d?.rows[0].image).toBeUndefined()
    expect(parseDraft("{")).toBeNull()
    expect(parseDraft(JSON.stringify({ version: 2, rows: [] }))).toBeNull()
    expect(parseDraft(JSON.stringify({ version: 1, rows: [row] }))).toBeNull()
    // A draft with a save in flight is kept even if its rows look empty: the ledger must settle it.
    const p = parseDraft(serializeDraft({ rows: [createRow()], supplierId: "", invoiceNumber: "", paymentMethod: "On Account", note: "", pending: { submissionId: "s-1", rowIds: ["x"] } }))
    expect(p?.pending).toEqual({ submissionId: "s-1", rowIds: ["x"] })
    expect(parseDraft(serializeDraft({ rows: [createRow()], supplierId: "", invoiceNumber: "", paymentMethod: "On Account", note: "" }))).toBeNull()
  })
})
