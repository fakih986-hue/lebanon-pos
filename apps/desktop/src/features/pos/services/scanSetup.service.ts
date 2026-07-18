import {
  createProduct, receiveProducts, updateProduct,
  getProductsSync, productHasBarcode, findProductsByExactName,
} from "./product.service"
import { normalizeBarcode } from "../lib/pos.constants"
import type { Product } from "../types/product"

// POS-FIRST-SETUP-CATALOG-1D: guided one-by-one scan into OPENING inventory.
// Same opening semantics as 1C's import: products create at stock 0, opening
// quantities flow through openingInventoryBatches() (Opening movement, no
// supplier PO / payment). This module owns only the resolve + commit logic so
// it is testable without the wizard UI.

/** How a scanned/typed barcode relates to the current catalog (pure). */
export type ScanResolution =
  | { kind: "new"; nameMatches: Product[] }
  | { kind: "existing"; product: Product; matchedAlias: boolean }

/** Classify a scanned barcode. If it isn't known, surface any exact name
 *  matches so the wizard can nudge "add this barcode to the existing product?".
 *  No mutation. */
export function resolveScannedBarcode(barcode: string, name: string, products?: Product[]): ScanResolution {
  const list = products ?? getProductsSync()
  const bc = normalizeBarcode(barcode)
  if (bc) {
    const owner = list.find((p) => productHasBarcode(p, bc))
    if (owner) {
      return { kind: "existing", product: owner, matchedAlias: normalizeBarcode(owner.barcode ?? "") !== bc }
    }
  }
  return { kind: "new", nameMatches: name.trim() ? findProductsByExactName(name, list) : [] }
}

export type ScanCommitMode = "new" | "existing" | "alias"

export type ScanSetupInput = {
  mode: ScanCommitMode
  barcode: string
  name: string
  category: string
  cost: number
  price: number
  openingQty: number
  extraBarcodes?: string[]
  image?: string | null
  /** parent product id for existing (restock) or alias (name-nudge) modes */
  targetId?: number
  /** POS-FIRST-SETUP-CATALOG-1D: create as a variant child of this product id */
  variantOfId?: number
  variantName?: string
}

export type ScanCommitResult = {
  ok: boolean
  kind: "created" | "variant" | "restocked" | "aliased"
  productId?: number
  error?: string
}

const clean = (arr?: string[]) => (arr ?? []).map(normalizeBarcode).filter(Boolean)

/** Commit one scan-setup row into opening inventory. Never creates a PO/payment
 *  and never books a Receive movement (createProduct/receiveProducts are called
 *  with { opening: true }). */
export function commitScanSetup(input: ScanSetupInput): ScanCommitResult {
  const qty = Math.max(0, Math.floor(input.openingQty))
  const extras = clean(input.extraBarcodes)

  // ── New standalone product (optionally a variant child) ──────────────────
  if (input.mode === "new") {
    const isVariant = input.variantOfId != null
    const parent = isVariant ? getProductsSync().find((p) => p.id === input.variantOfId) : undefined
    const p = createProduct({
      name: parent ? `${parent.name} - ${input.variantName || input.name}` : input.name,
      price: input.price, cost: input.cost, stock: qty,
      barcode: input.barcode, category: input.category,
      barcodeAliases: extras, image: input.image ?? undefined,
      parentId: isVariant ? input.variantOfId : undefined,
      variantName: isVariant ? (input.variantName || input.name) : undefined,
      opening: true,
    })
    if (!p) return { ok: false, kind: isVariant ? "variant" : "created", error: `Could not create "${input.name}" (barcode may already exist).` }
    if (isVariant && parent && !parent.isParent) updateProduct(input.variantOfId!, { isParent: true })
    return { ok: true, kind: isVariant ? "variant" : "created", productId: p.id }
  }

  // ── Existing product: add opening qty (+ optional extra barcodes) ────────
  const target = getProductsSync().find((p) => p.id === input.targetId)
  if (!target) return { ok: false, kind: "restocked", error: "Target product not found." }

  // alias mode: attach the scanned barcode (name-nudge) plus any extras.
  const aliasesToAdd = input.mode === "alias"
    ? clean([input.barcode, ...(input.extraBarcodes ?? [])]).filter((bc) => !productHasBarcode(target, bc))
    : extras.filter((bc) => !productHasBarcode(target, bc))

  if (aliasesToAdd.length) {
    updateProduct(target.id, { barcodeAliases: [...(target.barcodeAliases ?? []), ...aliasesToAdd] })
  }

  if (qty > 0) {
    // Use the target's identity/category so receiveProducts matches cleanly and
    // never trips its name/category conflict guard; opening flag → Opening batch.
    receiveProducts([{
      name: target.name, barcode: target.barcode ?? input.barcode, category: target.category,
      stock: qty, cost: input.cost, price: input.price,
    }], { opening: true })
  }

  return { ok: true, kind: input.mode === "alias" ? "aliased" : "restocked", productId: target.id }
}
