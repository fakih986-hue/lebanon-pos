import { createProduct, updateProduct, getProductsSync, normalizeBarcode } from "./product.service"
import { createSupplier, getSuppliers } from "./supplier.service"
import { addCustomer, getCustomers, cleanMobile } from "./customer.service"
import { assertCanWrite } from "./sync.service"

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

/** Validate and import product rows */
export function importProducts(rows: ImportRow[]): ImportResult {
  assertCanWrite("import products")
  const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] }
  const existing = getProductsSync()
  const seenBarcodes = new Set<string>()

  rows.forEach((row, idx) => {
    const line = idx + 1
    const name = (row.name || row.product || row.productname || "").trim()
    const barcode = normalizeBarcode(row.barcode || row.code || "")
    const price = parseFloat(row.price || row.saleprice || "0")
    const cost = parseFloat(row.cost || row.unitcost || "0")
    const stock = parseInt(row.stock || row.quantity || "0", 10) || 0
    const category = (row.category || "").trim()

    if (!name) { result.errors.push(`Row ${line}: name is required`); return }
    if (!barcode) { result.errors.push(`Row ${line}: barcode is required`); return }
    if (isNaN(price) || price < 0) { result.errors.push(`Row ${line}: invalid price`); return }
    if (isNaN(cost) || cost < 0) { result.errors.push(`Row ${line}: invalid cost`); return }
    if (seenBarcodes.has(barcode)) { result.errors.push(`Row ${line}: duplicate barcode "${barcode}" in import`); return }
    seenBarcodes.add(barcode)

    // Check against existing products
    const existingProduct = existing.find(p => p.barcode === barcode)
    if (existingProduct) {
      updateProduct(existingProduct.id, { name: name || existingProduct.name, price, cost, stock: existingProduct.stock + stock, category: category || existingProduct.category })
      result.updated++
    } else {
      createProduct({ name, price, cost, stock, barcode, category })
      result.created++
    }
  })
  return result
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
