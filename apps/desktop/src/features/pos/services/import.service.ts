import {
  createProduct, updateProduct, getProductsSync, receiveProducts,
  productHasBarcode, findProductsByExactName,
} from "./product.service"
import { normalizeBarcode } from "../lib/pos.constants"
import { createSupplier, getSuppliers } from "./supplier.service"
import { addCustomer, getCustomers, cleanMobile } from "./customer.service"
import { assertCanWrite } from "./sync.service"
import type { Product } from "../types/product"

export type ImportRow = Record<string, string>
export type ImportResult = { created: number; updated: number; skipped: number; errors: string[] }

/** Parse CSV text into rows of column -> value */
export function parseCSV(text: string): { headers: string[]; rows: ImportRow[] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0)
  if (lines.length < 2) return { headers: [], rows: [] }
  const headers = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/"/g, ""))
  const rows: ImportRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",").map(v => v.trim().replace(/^"|"$/g, ""))
    const row: ImportRow = {}
    headers.forEach((h, idx) => { row[h] = values[idx] ?? "" })
    rows.push(row)
  }
  return { headers, rows }
}

// ── POS-PRODUCT-ONBOARDING-1: bulk product import (parse → dry-run → commit) ──

export const PRODUCT_IMPORT_HEADERS = [
  "Name", "Primary Barcode", "Extra Barcodes", "Category", "Cost", "Price",
  "Opening Qty", "Reorder Point", "Supplier", "Variant Of", "Variant Name",
] as const

export type ProductImportRow = {
  line: number; raw: string
  name: string; primaryBarcode: string; extraBarcodes: string[]
  category: string; cost: number; price: number; openingQty: number
  reorderPoint?: number; supplier?: string
  variantOf?: string; variantName?: string
}

export type ImportActionKind = "create" | "existing" | "variant" | "conflict" | "invalid"
export type ImportAction = {
  kind: ImportActionKind
  line: number; name: string; primaryBarcode: string
  detail: string; reason?: string
  targetId?: number; aliases?: string[]; row?: ProductImportRow
}
export type ProductImportPlan = {
  actions: ImportAction[]
  counts: { create: number; existing: number; variant: number; conflict: number; invalid: number; aliasAdds: number }
  warnings: Array<{ line: number; message: string }>
}

/** Map a (case-insensitive) header cell to a canonical field marker. */
function headerField(h: string): string | null {
  const k = h.trim().toLowerCase()
  if (["name", "product", "product name"].includes(k)) return "name"
  if (["primary barcode", "barcode", "code"].includes(k)) return "primaryBarcode"
  if (["extra barcodes", "aliases", "barcode aliases", "alt barcodes"].includes(k)) return "extraBarcodes"
  if (["category"].includes(k)) return "category"
  if (["cost", "unit cost"].includes(k)) return "cost"
  if (["price", "sale price"].includes(k)) return "price"
  if (["opening qty", "opening quantity", "qty", "quantity", "stock"].includes(k)) return "openingQty"
  if (["reorder point", "reorder"].includes(k)) return "reorderPoint"
  if (["supplier", "supplier name"].includes(k)) return "supplier"
  if (["variant of", "parent"].includes(k)) return "variantOf"
  if (["variant name"].includes(k)) return "variantName"
  return null
}

const toNum = (s: string) => (s.trim() === "" ? 0 : Number(s))

/** Parse pasted CSV or TSV (Excel paste) into structured product rows. */
export function parseProductImport(text: string): { rows: ProductImportRow[]; error?: string } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length < 2) return { rows: [], error: "Paste a header row plus at least one product row." }
  const split = (line: string) =>
    (line.includes("\t") ? line.split("\t") : line.split(",")).map((c) => c.trim().replace(/^"|"$/g, ""))
  const fields = split(lines[0]).map(headerField)
  if (!fields.includes("name") || !fields.includes("primaryBarcode")) {
    return { rows: [], error: "Header must include Name and Primary Barcode columns." }
  }
  const rows: ProductImportRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const cells = split(lines[i])
    const get = (f: string) => { const idx = fields.indexOf(f); return idx >= 0 ? (cells[idx] ?? "") : "" }
    rows.push({
      line: i + 1, raw: lines[i],
      name: get("name").trim(),
      primaryBarcode: normalizeBarcode(get("primaryBarcode")),
      extraBarcodes: get("extraBarcodes").split(/[|,;\s]+/).map(normalizeBarcode).filter(Boolean),
      category: get("category").trim() || "General",
      cost: toNum(get("cost")),
      price: toNum(get("price")),
      openingQty: Math.floor(toNum(get("openingQty"))),
      reorderPoint: get("reorderPoint").trim() ? Math.floor(toNum(get("reorderPoint"))) : undefined,
      supplier: get("supplier").trim() || undefined,
      variantOf: get("variantOf").trim() || undefined,
      variantName: get("variantName").trim() || undefined,
    })
  }
  return { rows }
}

const normName = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase()

/** Pure dry-run: classify every row against the current catalog. No mutation. */
export function analyzeProductImport(rows: ProductImportRow[], products: Product[]): ProductImportPlan {
  const actions: ImportAction[] = []
  const warnings: ProductImportPlan["warnings"] = []
  const seen = new Set<string>()
  const owner = (bc: string) => products.find((p) => productHasBarcode(p, bc))

  for (const row of rows) {
    const base = { line: row.line, name: row.name, primaryBarcode: row.primaryBarcode, row }
    const invalid = (reason: string) => actions.push({ ...base, kind: "invalid", detail: "", reason })
    const conflict = (reason: string) => actions.push({ ...base, kind: "conflict", detail: "", reason })

    if (!row.name) { invalid("Name is required"); continue }
    if (!row.primaryBarcode) { invalid("Primary barcode is required"); continue }
    if (!Number.isFinite(row.cost) || row.cost < 0) { invalid("Invalid cost"); continue }
    if (!Number.isFinite(row.price) || row.price < 0) { invalid("Invalid price"); continue }
    if (!Number.isFinite(row.openingQty) || row.openingQty < 0) { invalid("Invalid opening qty"); continue }
    if (seen.has(row.primaryBarcode)) { conflict(`Barcode "${row.primaryBarcode}" is repeated earlier in the file`); continue }
    seen.add(row.primaryBarcode)

    // Variant of an existing parent → new child product.
    if (row.variantOf) {
      const parent = products.find((p) => normName(p.name) === normName(row.variantOf!) || productHasBarcode(p, normalizeBarcode(row.variantOf!)))
      if (!parent) { conflict(`Variant parent "${row.variantOf}" not found`); continue }
      const bcOwner = owner(row.primaryBarcode)
      if (bcOwner) { conflict(`Barcode "${row.primaryBarcode}" already used by "${bcOwner.name}"`); continue }
      const extraClash = row.extraBarcodes.map(owner).find(Boolean)
      if (extraClash) { conflict(`Extra barcode already used by "${extraClash.name}"`); continue }
      actions.push({ ...base, kind: "variant", targetId: parent.id, aliases: row.extraBarcodes, detail: `variant of ${parent.name}${row.openingQty > 0 ? ` · opening ${row.openingQty}` : ""}` })
      continue
    }

    const match = owner(row.primaryBarcode)
    if (match) {
      if (row.name && normName(match.name) !== normName(row.name)) {
        conflict(`Barcode "${row.primaryBarcode}" belongs to "${match.name}", not "${row.name}"`); continue
      }
      const extraClash = row.extraBarcodes.map(owner).find((o) => o && o.id !== match.id)
      if (extraClash) { conflict(`Extra barcode already used by "${extraClash.name}"`); continue }
      const newAliases = row.extraBarcodes.filter((bc) => !productHasBarcode(match, bc))
      actions.push({
        ...base, kind: "existing", targetId: match.id, aliases: newAliases,
        detail: `${row.openingQty > 0 ? `restock +${row.openingQty}` : "update details"}${newAliases.length ? ` · +${newAliases.length} barcode(s)` : ""}`,
      })
      continue
    }

    // Genuinely new product.
    const extraClash = row.extraBarcodes.map(owner).find(Boolean)
    if (extraClash) { conflict(`Extra barcode already used by "${extraClash.name}"`); continue }
    if (findProductsByExactName(row.name, products).length > 0) {
      warnings.push({ line: row.line, message: `"${row.name}" already exists — importing as a NEW product. Use Extra Barcodes to add a barcode to the existing one, or Variant Of for a size.` })
    }
    actions.push({ ...base, kind: "create", aliases: row.extraBarcodes, detail: `new${row.openingQty > 0 ? ` · opening ${row.openingQty}` : ""}${row.extraBarcodes.length ? ` · ${row.extraBarcodes.length} extra barcode(s)` : ""}` })
  }

  const counts = {
    create: actions.filter((a) => a.kind === "create").length,
    existing: actions.filter((a) => a.kind === "existing").length,
    variant: actions.filter((a) => a.kind === "variant").length,
    conflict: actions.filter((a) => a.kind === "conflict").length,
    invalid: actions.filter((a) => a.kind === "invalid").length,
    aliasAdds: actions.reduce((n, a) => n + (a.aliases?.length ?? 0), 0),
  }
  return { actions, counts, warnings }
}

/** Commit an analyzed plan using the hardened product/receive services.
 *  New products use createProduct (stock:0 create + opening batch — no double
 *  count); restocks use receiveProducts; aliases via updateProduct. */
export function commitProductImport(plan: ProductImportPlan): ImportResult {
  assertCanWrite("import products")
  const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] }
  const suppliers = getSuppliers()
  const resolveSupplier = (name?: string) => {
    if (!name) return { supplierId: undefined, supplierName: undefined }
    const s = suppliers.find((x) => normName(x.name) === normName(name))
    return { supplierId: s?.id, supplierName: s?.name ?? name }
  }

  for (const a of plan.actions) {
    if (a.kind === "conflict" || a.kind === "invalid" || !a.row) { if (a.kind !== "create" && a.kind !== "existing" && a.kind !== "variant") result.skipped++; continue }
    const row = a.row
    const sup = resolveSupplier(row.supplier)
    try {
      if (a.kind === "create") {
        const p = createProduct({
          name: row.name, price: row.price, cost: row.cost, stock: row.openingQty,
          barcode: row.primaryBarcode, category: row.category,
          reorderPoint: row.reorderPoint, supplierId: sup.supplierId, supplierName: sup.supplierName,
          barcodeAliases: a.aliases,
        })
        if (p) result.created++
        else result.errors.push(`Line ${a.line}: could not create "${row.name}"`)
      } else if (a.kind === "variant") {
        const parent = getProductsSync().find((p) => p.id === a.targetId)
        const vname = row.variantName || row.name
        const p = createProduct({
          name: parent ? `${parent.name} - ${vname}` : row.name,
          price: row.price, cost: row.cost, stock: row.openingQty,
          barcode: row.primaryBarcode, category: row.category,
          parentId: a.targetId, variantName: vname,
          reorderPoint: row.reorderPoint, supplierId: sup.supplierId, supplierName: sup.supplierName,
          barcodeAliases: a.aliases,
        })
        if (p) {
          if (a.targetId != null && parent && !parent.isParent) updateProduct(a.targetId, { isParent: true })
          result.created++
        } else result.errors.push(`Line ${a.line}: could not create variant "${row.name}"`)
      } else if (a.kind === "existing" && a.targetId != null) {
        const target = getProductsSync().find((p) => p.id === a.targetId)
        if (row.openingQty > 0 && target) {
          receiveProducts([{
            name: target.name, barcode: target.barcode ?? row.primaryBarcode, category: row.category,
            stock: row.openingQty, cost: row.cost, price: row.price,
            reorderPoint: row.reorderPoint, supplierId: sup.supplierId, supplierName: sup.supplierName,
          }])
        }
        if (a.aliases?.length && target) {
          updateProduct(a.targetId, { barcodeAliases: [...(target.barcodeAliases ?? []), ...a.aliases] })
        }
        result.updated++
      }
    } catch (err) {
      result.errors.push(`Line ${a.line}: ${(err as Error).message}`)
    }
  }
  return result
}

/** Downloadable CSV template with two worked example rows. */
export function buildProductImportTemplateCsv(): string {
  return [
    PRODUCT_IMPORT_HEADERS.join(","),
    "Pepsi 330ml,5449000000996,5449000111111|5449000222222,Beverages,0.40,0.75,24,10,Coca-Cola Co,,",
    "Pepsi 1L,5449000333333,,Beverages,0.80,1.50,12,6,Coca-Cola Co,Pepsi 330ml,1L",
  ].join("\n")
}

/** Export the active catalog in the import format (for cleanup + reimport). */
export function productsToCsv(products: Product[]): string {
  const esc = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const rows = products.filter((p) => !p.archived).map((p) => [
    p.name, p.barcode ?? "", (p.barcodeAliases ?? []).join("|"), p.category, p.cost, p.price,
    p.stock, p.reorderPoint ?? "", p.supplierName ?? "",
    p.parentId ? (products.find((x) => x.id === p.parentId)?.name ?? "") : "", p.variantName ?? "",
  ].map(esc).join(","))
  return [PRODUCT_IMPORT_HEADERS.join(","), ...rows].join("\n")
}

/** Validate and import customer rows */
export function importCustomers(rows: ImportRow[]): ImportResult {
  assertCanWrite("import customers")
  const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] }
  const existing = getCustomers()
  const seenMobiles = new Set<string>()

  rows.forEach((row, idx) => {
    const line = idx + 1
    const name = (row.name || row.customername || "").trim()
    const mobile = cleanMobile(row.mobile || row.phone || "")
    if (!name) { result.errors.push(`Row ${line}: name is required`); return }
    if (!mobile) { result.errors.push(`Row ${line}: mobile is required`); return }
    if (seenMobiles.has(mobile)) { result.errors.push(`Row ${line}: duplicate mobile "${mobile}" in import`); return }
    seenMobiles.add(mobile)

    const exists = existing.find(c => c.mobile === mobile)
    if (exists) {
      result.skipped++
    } else {
      const creditLimit = parseFloat(row.creditlimit || "0") || 0
      addCustomer({ name, mobile, creditLimit, notes: row.notes || "" })
      result.created++
    }
  })
  return result
}

/** Validate and import supplier rows */
export function importSuppliers(rows: ImportRow[]): ImportResult {
  assertCanWrite("import suppliers")
  const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] }
  const existing = getSuppliers()
  const seenNames = new Set<string>()

  rows.forEach((row, idx) => {
    const line = idx + 1
    const name = (row.name || row.suppliername || "").trim()
    if (!name) { result.errors.push(`Row ${line}: name is required`); return }
    if (seenNames.has(name.toLowerCase())) { result.errors.push(`Row ${line}: duplicate name "${name}" in import`); return }
    seenNames.add(name.toLowerCase())

    const exists = existing.find(s => s.name.toLowerCase() === name.toLowerCase())
    if (exists) {
      result.skipped++
    } else {
      createSupplier({ name, mobile: row.mobile || "", contact: row.contact || "", address: row.address || "", notes: row.notes || "" })
      result.created++
    }
  })
  return result
}
