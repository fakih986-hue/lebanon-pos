import type { Product } from "../types/product"

// POS-PRODUCT-CATALOG-CLEANUP-1: pure catalog-quality analysis. No mutation —
// it only classifies the current catalog so the cleanup panel can show counts,
// lists, and non-destructive suggestions. Stock/batches/sales/ledger untouched.

const normName = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase()
const normBarcode = (s: string) => s.trim().replace(/\s+/g, "")

export type DuplicateNameGroup = {
  name: string
  products: Product[]
  samePrice: boolean
  /** same price → items are interchangeable (alias/merge candidate);
   *  different price → likely different sizes (variant candidate). */
  suggestion: "alias" | "variant"
}

export type CatalogHealth = {
  counts: {
    duplicateNames: number       // number of duplicate-name GROUPS
    possibleAliases: number      // same-name + same-price groups
    possibleVariants: number     // same-name + different-price groups
    barcodeConflicts: number     // products sharing a barcode (primary or alias)
    missingBarcode: number
    missingImage: number
    uncategorized: number
    orphanVariants: number
  }
  duplicateNames: DuplicateNameGroup[]
  barcodeConflicts: Array<{ id: number; name: string; barcode: string }>
  missingBarcode: Product[]
  missingImage: Product[]
  uncategorized: Product[]
  orphanVariants: Array<{ child: Product; reason: "missing" | "archived" }>
}

export function analyzeCatalog(products: Product[]): CatalogHealth {
  const active = products.filter((p) => !p.archived)

  // ── Duplicate names (active, non-variant rows grouped by normalized name) ──
  const byName = new Map<string, Product[]>()
  for (const p of active) {
    if (p.parentId != null) continue // variants legitimately share a family name
    const key = normName(p.name)
    if (!key) continue
    const arr = byName.get(key) ?? []
    arr.push(p)
    byName.set(key, arr)
  }
  const duplicateNames: DuplicateNameGroup[] = []
  for (const group of byName.values()) {
    if (group.length < 2) continue
    const samePrice = group.every((p) => p.price === group[0].price)
    duplicateNames.push({
      name: group[0].name,
      products: group,
      samePrice,
      suggestion: samePrice ? "alias" : "variant",
    })
  }

  // ── Barcode conflicts across primary + aliases (each product once) ──
  const idsByBarcode = new Map<string, Set<number>>()
  const register = (bc: string | undefined, id: number) => {
    const b = normBarcode(bc ?? "")
    if (!b) return
    const set = idsByBarcode.get(b) ?? new Set<number>()
    set.add(id)
    idsByBarcode.set(b, set)
  }
  for (const p of products) {
    register(p.barcode, p.id)
    for (const a of p.barcodeAliases ?? []) register(a, p.id)
  }
  const conflictedIds = new Set<number>()
  for (const ids of idsByBarcode.values()) {
    if (ids.size > 1) for (const id of ids) conflictedIds.add(id)
  }
  const barcodeConflicts = products
    .filter((p) => conflictedIds.has(p.id))
    .map((p) => ({ id: p.id, name: p.name, barcode: p.barcode ?? "" }))

  // ── Field gaps ──
  const missingBarcode = active.filter((p) => !p.barcode || p.barcode.trim() === "")
  const missingImage = active.filter((p) => !p.image)
  const uncategorized = active.filter((p) => !p.category || p.category.trim() === "")

  // ── Orphan variants ──
  const byId = new Map(products.map((p) => [p.id, p]))
  const orphanVariants: CatalogHealth["orphanVariants"] = []
  for (const p of active) {
    if (p.parentId == null) continue
    const parent = byId.get(p.parentId)
    if (!parent) orphanVariants.push({ child: p, reason: "missing" })
    else if (parent.archived) orphanVariants.push({ child: p, reason: "archived" })
  }

  const possibleAliases = duplicateNames.filter((g) => g.samePrice).length
  const possibleVariants = duplicateNames.filter((g) => !g.samePrice).length

  return {
    counts: {
      duplicateNames: duplicateNames.length,
      possibleAliases,
      possibleVariants,
      barcodeConflicts: barcodeConflicts.length,
      missingBarcode: missingBarcode.length,
      missingImage: missingImage.length,
      uncategorized: uncategorized.length,
      orphanVariants: orphanVariants.length,
    },
    duplicateNames,
    barcodeConflicts,
    missingBarcode,
    missingImage,
    uncategorized,
    orphanVariants,
  }
}
