import { products } from "../data/products"
import type { Product, ProductAccent } from "../types/product"
import { receiveInventoryBatches, type ReceiveBatchInput } from "./inventoryBatch.service"
import { enqueueSyncOperation, assertCanWrite } from "./sync.service"
import { recordAuditEvent } from "./security.service"
import { writeLocalWithIndexedDB } from "./storage.service"
import { canUseStorage, createId } from "../lib/storage"

const STORAGE_KEY = "lebanonpos.products.v1"
const PRODUCT_EVENT = "lebanonpos-products-changed"

export type ProductReceiveInput = {
  name: string
  price: number
  cost: number
  stock: number
  barcode: string
  category: string
  accent?: ProductAccent
  reorderPoint?: number
  reorderQuantity?: number
  supplierId?: string
  supplierName?: string
  expiryDate?: string
  // POS-RECEIVE-UX-1A: staged "add barcode to existing product" decision. When
  // set, `barcode` is appended as an alias of this product (conflict-checked)
  // and `stock` is received into that product — NOT matched-or-created. Unset =
  // the existing match-or-create behavior (fully back-compatible).
  attachAliasToProductId?: number
  // POS-PRODUCT-IMAGE-1: optional image for NEW products only. Ignored on
  // restock/alias so an existing product's image is never overwritten.
  image?: string | null
  // POS-RECEIVE-VARIANT-1B: create this row as a VARIANT (separate product with
  // its own barcode/price/stock) linked to an existing parent. Applies only on
  // the create path; the parent is flagged isParent (metadata only — no parent
  // price/stock/barcode change). No pack conversion, no stock sharing.
  parentId?: number
  variantName?: string
}

export type ReceiveResult = {
  acceptedCount: number
  rejectedCount: number
  errors: string[]
  newlyCreated: Product[]
  modifiedExisting: Product[]
  batchesCreated: number
}

export type ProductStockMovement = {
  productId: number
  quantity: number
}

const accents: ProductAccent[] = [
  "emerald",
  "cyan",
  "amber",
  "rose",
  "violet",
  "indigo",
]

function normalizeBarcode(value: string) {
  return value.trim().replace(/\s+/g, "")
}

function normalizeBarcodeList(values?: string[]) {
  return Array.from(
    new Set((values ?? []).map(normalizeBarcode).filter(Boolean))
  )
}

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, " ")
}

function readStoredProducts() {
  if (!canUseStorage()) {
    return null
  }

  const storedProducts = window.localStorage.getItem(STORAGE_KEY)

  if (!storedProducts) {
    return null
  }

  try {
    const parsedProducts = JSON.parse(storedProducts)

    return Array.isArray(parsedProducts)
      ? (parsedProducts as Product[]).map((product) => ({
          ...product,
          barcodeAliases: normalizeBarcodeList(product.barcodeAliases),
        }))
      : null
  } catch {
    console.warn(`[product.service] Failed to parse storage key`)
    return null
  }
}

function writeProducts(nextProducts: Product[]) {
  if (!canUseStorage()) {
    return
  }

  writeLocalWithIndexedDB(STORAGE_KEY, nextProducts)
  window.dispatchEvent(new Event(PRODUCT_EVENT))
}

function chooseAccent(category: string, index: number) {
  const knownCategory = products.find(
    (product) =>
      product.category?.toLowerCase() === category.trim().toLowerCase()
  )

  if (knownCategory) {
    return knownCategory.accent
  }

  return accents[index % accents.length]
}

function cleanProductPatch(patch: Partial<Product>) {
  const cleanPatch: Partial<Product> = {}

  Object.entries(patch).forEach(([key, value]) => {
    if (value !== undefined) {
      ;(cleanPatch as Record<string, unknown>)[key] = value
    }
  })

  if (typeof cleanPatch.category === "string") {
    cleanPatch.category = normalizeName(cleanPatch.category)
  }

  if (typeof cleanPatch.name === "string") {
    cleanPatch.name = normalizeName(cleanPatch.name)
  }

  if (typeof cleanPatch.barcode === "string") {
    cleanPatch.barcode = normalizeBarcode(cleanPatch.barcode)
  }

  if (Array.isArray(cleanPatch.barcodeAliases)) {
    const primaryBarcode =
      typeof cleanPatch.barcode === "string" ? cleanPatch.barcode : undefined
    cleanPatch.barcodeAliases = normalizeBarcodeList(
      cleanPatch.barcodeAliases
    ).filter((barcode) => barcode !== primaryBarcode)
  }

  if (typeof cleanPatch.reorderPoint === "number") {
    cleanPatch.reorderPoint = Math.max(0, cleanPatch.reorderPoint)
  }

  if (typeof cleanPatch.reorderQuantity === "number") {
    cleanPatch.reorderQuantity = Math.max(0, cleanPatch.reorderQuantity)
  }

  return cleanPatch
}

export function getProductsSync(): Product[] {
  return (readStoredProducts() ?? products).map((product) => ({
    ...product,
    barcodeAliases: normalizeBarcodeList(product.barcodeAliases),
  }))
}

export async function getProducts(): Promise<Product[]> {
  return getProductsSync()
}

/** Products eligible to sell in POS — excludes archived (discontinued) items.
 *  Management/inventory views use the unfiltered accessors and still see
 *  archived products (to restore/report them). */
export function getSellableProducts(list: Product[]): Product[] {
  return list.filter((p) => !p.archived)
}

export function subscribeProducts(callback: (products: Product[]) => void) {
  if (!canUseStorage()) {
    return () => undefined
  }

  function handleProductsChanged() {
    callback(getProductsSync())
  }

  window.addEventListener(PRODUCT_EVENT, handleProductsChanged)
  window.addEventListener("storage", handleProductsChanged)

  return () => {
    window.removeEventListener(PRODUCT_EVENT, handleProductsChanged)
    window.removeEventListener("storage", handleProductsChanged)
  }
}

export function receiveProducts(entries: ProductReceiveInput[]) {
  assertCanWrite("receive products")
  const currentProducts = getProductsSync()
  const nextProducts = [...currentProducts]
  let nextId =
    nextProducts.reduce((maxId, product) => Math.max(maxId, product.id), 0) + 1

  let rejectedCount = 0
  const errors: string[] = []
  const batchInputs: ReceiveBatchInput[] = []

  entries.forEach((entry, index) => {
    const barcode = normalizeBarcode(entry.barcode)
    const name = normalizeName(entry.name)
    const category = normalizeName(entry.category)

    // ── POS-RECEIVE-UX-1A: staged alias decision ──────────────────────────
    // Attach `barcode` as an alias of an existing product and receive `stock`
    // into it. Stock still flows only through the batch (inventory/receive);
    // the target's price/cost are NOT changed (aliases share the one price).
    if (entry.attachAliasToProductId != null) {
      if (!barcode) {
        rejectedCount++
        errors.push(`Entry #${index + 1}: barcode is missing`)
        return
      }
      if (entry.stock <= 0) {
        rejectedCount++
        errors.push(`Entry #${index + 1}: quantity must be greater than 0`)
        return
      }
      const targetIndex = nextProducts.findIndex(
        (p) => p.id === entry.attachAliasToProductId
      )
      if (targetIndex < 0) {
        rejectedCount++
        errors.push(`Entry #${index + 1}: target product not found`)
        return
      }
      // Conflict: the barcode already belongs to a DIFFERENT product.
      const other = nextProducts.find(
        (p) => p.id !== entry.attachAliasToProductId && productHasBarcode(p, barcode)
      )
      if (other) {
        rejectedCount++
        errors.push(`"${barcode}" already used by "${other.name}"`)
        return
      }
      const target = nextProducts[targetIndex]
      // Append the alias only if it isn't already the primary or an alias.
      if (
        barcode !== target.barcode &&
        !normalizeBarcodeList(target.barcodeAliases).includes(barcode)
      ) {
        nextProducts[targetIndex] = {
          ...target,
          barcodeAliases: [...normalizeBarcodeList(target.barcodeAliases), barcode],
        }
      }
      const updatedTarget = nextProducts[targetIndex]
      batchInputs.push({
        productId: updatedTarget.id,
        productSyncId: updatedTarget.syncId ?? undefined,
        productName: updatedTarget.name,
        barcode: updatedTarget.barcode,
        quantity: entry.stock,
        unitCost: entry.cost,
        unitPrice: entry.price,
        expiryDate: entry.expiryDate,
        supplierId: entry.supplierId,
        supplierName: entry.supplierName,
      })
      return
    }

    if (!barcode) {
      rejectedCount++
      errors.push(`Entry #${index + 1}: barcode is missing`)
      return
    }
    if (!name) {
      rejectedCount++
      errors.push(`Entry #${index + 1}: product name is missing`)
      return
    }
    if (entry.stock <= 0) {
      rejectedCount++
      errors.push(`Entry #${index + 1}: quantity must be greater than 0`)
      return
    }

    // Check for duplicate barcodes across ALL products (not just current batch)
    const allProducts = nextProducts.filter((p) => !p.id || p.id > 0)
    const barcodeConflict = allProducts.find(
      (p) => productHasBarcode(p, barcode) && 
        (p.name !== name || p.category !== category)
    )
    if (barcodeConflict) {
      rejectedCount++
      errors.push(`"${barcode}" already used by "${barcodeConflict.name}"`)
      return
    }

    const existingIndex = nextProducts.findIndex((product) =>
      productHasBarcode(product, barcode)
    )

    if (existingIndex >= 0) {
      const existingProduct = nextProducts[existingIndex]

      nextProducts[existingIndex] = {
        ...existingProduct,
        price: entry.price,
        cost: entry.cost,
        stock: existingProduct.stock + entry.stock,
        barcodeAliases: normalizeBarcodeList(existingProduct.barcodeAliases),
        reorderPoint: entry.reorderPoint ?? existingProduct.reorderPoint,
        reorderQuantity:
          entry.reorderQuantity ?? existingProduct.reorderQuantity,
        supplierId: entry.supplierId ?? existingProduct.supplierId,
        supplierName: entry.supplierName ?? existingProduct.supplierName,
        expiryDate: entry.expiryDate || existingProduct.expiryDate,
      }
      const updatedProduct = nextProducts[existingIndex]

      batchInputs.push({
        productId: updatedProduct.id,
        productSyncId: updatedProduct.syncId ?? undefined,
        productName: updatedProduct.name,
        barcode: updatedProduct.barcode,
        quantity: entry.stock,
        unitCost: entry.cost,
        unitPrice: entry.price,
        expiryDate: entry.expiryDate,
        supplierId: entry.supplierId,
        supplierName: entry.supplierName,
      })

      return
    }

    const product: Product = {
      id: nextId,
      syncId: createId(),
      name,
      price: entry.price,
      cost: entry.cost,
      stock: entry.stock,
      barcode,
      category,
      accent: entry.accent ?? chooseAccent(category, nextId + index),
      reorderPoint: entry.reorderPoint,
      reorderQuantity: entry.reorderQuantity,
      supplierId: entry.supplierId,
      supplierName: entry.supplierName,
      expiryDate: entry.expiryDate,
      barcodeAliases: [],
      image: entry.image || undefined,
      // POS-RECEIVE-VARIANT-1B: link as a variant of an existing parent (own
      // barcode/price/stock; no stock sharing with the parent).
      parentId: entry.parentId ?? null,
      variantName: entry.variantName || undefined,
    }

    nextProducts.push(product)
    // POS-RECEIVE-VARIANT-1B: flag the parent as a grouping parent so POS shows
    // the variant picker. Metadata only — the parent's price/stock/barcode are
    // never touched here.
    if (entry.parentId != null) {
      const parentIndex = nextProducts.findIndex((p) => p.id === entry.parentId)
      if (parentIndex >= 0 && !nextProducts[parentIndex].isParent) {
        nextProducts[parentIndex] = { ...nextProducts[parentIndex], isParent: true }
      }
    }
    batchInputs.push({
      productId: product.id,
      productSyncId: product.syncId ?? undefined,
      productName: product.name,
      barcode: product.barcode,
      quantity: entry.stock,
      unitCost: product.cost,
      unitPrice: product.price,
      expiryDate: product.expiryDate,
      supplierId: product.supplierId,
      supplierName: product.supplierName,
    })
    nextId += 1
  })

  writeProducts(nextProducts)

  const newlyCreated = nextProducts.filter(
    (p) => !currentProducts.find((c) => c.id === p.id)
  )
  if (newlyCreated.length > 0) {
    enqueueSyncOperation({
      entity: "product",
      action: "create",
      summary: `${newlyCreated.length} receiving line${
        newlyCreated.length === 1 ? "" : "s"
      } queued for sync.`,
      // POS-SYNC-RECEIVE-1: create the product at stock 0; the inventory/receive
      // op below adds the received quantity server-side (authoritative). The local
      // cache keeps the real stock (set above) for immediate display.
      payload: newlyCreated.map((p) => ({ ...p, stock: 0 })),
    })
  }

  const modifiedExisting = nextProducts.filter(
    (p) => currentProducts.find((c) => c.id === p.id && JSON.stringify(c) !== JSON.stringify(p))
  )
  for (const mod of modifiedExisting) {
    // POS-SYNC-RECEIVE-1: metadata-only update (price/cost/reorder/supplier/
    // expiry). The received quantity is applied by the inventory/receive handler,
    // NOT here — no `stock`, no `_stockUpdate` marker. The server strips stock
    // from every product.update unconditionally.
    const { stock: _stock, ...meta } = mod
    enqueueSyncOperation({
      entity: "product",
      action: "update",
      summary: `${mod.name} details updated.`,
      payload: meta,
    })
  }

  // Enqueue inventory receives AFTER product creates/updates
  let batchesCreated = 0
  if (batchInputs.length > 0) {
    const batches = receiveInventoryBatches(batchInputs)
    batchesCreated = batches.length
  }

  const acceptedCount = newlyCreated.length + modifiedExisting.length
  return { acceptedCount, rejectedCount, errors, newlyCreated, modifiedExisting, batchesCreated }
}

export function updateProduct(productId: number, patch: Partial<Product>) {
  assertCanWrite("update product")
  const cleanPatch = cleanProductPatch(patch)

  // Block direct stock edits — stock must change through receiving/sale/adjustment
  if ("stock" in cleanPatch) {
    console.warn(`[updateProduct] Direct stock edit blocked for product ${productId}. Use receiving or stock adjustment.`)
    return undefined
  }

  // Validate barcode/alias uniqueness against other products
  if (typeof cleanPatch.barcode === "string" && cleanPatch.barcode.length > 0) {
    const conflict = getProductsSync().find(
      (p) => p.id !== productId && ((p.barcode ?? "") === cleanPatch.barcode || (p.barcodeAliases ?? []).includes(cleanPatch.barcode!))
    )
    if (conflict) {
      console.warn(`[updateProduct] Barcode ${cleanPatch.barcode} already used by "${conflict.name}"`)
      return undefined
    }
  }
  // Also check that new aliases don't conflict with other products' primary barcodes
  if (Array.isArray(cleanPatch.barcodeAliases)) {
    const allProducts = getProductsSync()
    for (const alias of cleanPatch.barcodeAliases) {
      if (!alias) continue
      const conflict = allProducts.find(p =>
        p.id !== productId && ((p.barcode ?? "") === alias || (p.barcodeAliases ?? []).includes(alias))
      )
      if (conflict) {
        console.warn(`[updateProduct] Alias ${alias} already used by "${conflict.name}"`)
        return undefined
      }
    }
  }

  let updatedProduct: Product | undefined
  const nextProducts = getProductsSync().map((product) => {
    if (product.id !== productId) {
      return product
    }

    updatedProduct = {
      ...product,
      ...cleanPatch,
      id: product.id,
    }
    updatedProduct.barcodeAliases = normalizeBarcodeList(
      updatedProduct.barcodeAliases
    ).filter((barcode) => barcode !== updatedProduct?.barcode)

    return updatedProduct
  })

  writeProducts(nextProducts)

  if (updatedProduct) {
    enqueueSyncOperation({
      entity: "product",
      action: "update",
      summary: `${updatedProduct.name} product settings queued for sync.`,
      payload: updatedProduct,
    })
  }

  return updatedProduct
}

export function createProduct(input: {
  name: string
  price: number
  cost: number
  stock: number
  barcode: string
  category: string
  accent?: ProductAccent
  parentId?: number | null
  variantName?: string
  // POS-PRODUCT-IMAGE-1: optional product image (compressed JPEG data URL).
  // Persisted locally and carried in the product.create sync payload.
  image?: string | null
}): Product | undefined {
  assertCanWrite("create product")
  const currentProducts = getProductsSync()
  const normalizedBarcode = normalizeBarcode(input.barcode)

  // Check for barcode conflicts — primary AND aliases
  if (normalizedBarcode) {
    const conflict = currentProducts.find(p =>
      (p.barcode ?? "") === normalizedBarcode || (p.barcodeAliases ?? []).includes(normalizedBarcode)
    )
    if (conflict) {
      // Barcode exists → restock through receiving, not direct stock merge
      console.warn(`[createProduct] Barcode ${normalizedBarcode} already used by "${conflict.name}" — receive stock instead`)
      return undefined
    }
  }

  const nextId = currentProducts.reduce((max, p) => Math.max(max, p.id), 0) + 1
  const product: Product = {
    id: nextId,
    // Stable cross-system sync identity, generated once here at creation. The
    // numeric `id` above is local-only; `syncId` is what matches this product
    // across hub/clients/cloud regardless of each database's own numeric id.
    syncId: createId(),
    name: normalizeName(input.name),
    price: input.price,
    cost: input.cost,
    stock: input.stock,
    barcode: normalizedBarcode,
    category: normalizeName(input.category),
    accent: input.accent ?? chooseAccent(input.category, nextId),
    parentId: input.parentId ?? null,
    variantName: input.variantName ?? undefined,
    barcodeAliases: [],
    image: input.image || undefined,
  }
  const nextProducts = [...currentProducts, product]
  writeProducts(nextProducts)

  // Queue product create FIRST so server has the product before receiving batch.
  // POS-PRODUCT-CREATE-STOCK-1: send stock 0 to the server. The inventory/receive
  // op below is the single authoritative source of the opening quantity (mirrors
  // POS-SYNC-RECEIVE-1 in receiveProducts). Sending the real stock here AND a
  // receive batch double-counted on the server/cloud (24 → 48) and also produced
  // a duplicate Opening + Receive ledger movement. The local cache keeps the
  // entered stock (set on `product` above) for immediate display.
  enqueueSyncOperation({
    entity: "product",
    action: "create",
    summary: `${product.name} created.`,
    payload: { ...product, stock: 0 },
  })

  // Create initial batch for opening stock
  if (input.stock > 0) {
    receiveInventoryBatches([{
      productId: product.id,
      productSyncId: product.syncId ?? undefined,
      productName: product.name,
      barcode: product.barcode ?? "",
      quantity: input.stock,
      unitCost: input.cost,
      unitPrice: input.price,
    }])
  }

  return product
}

export function archiveProduct(productId: number) {
  assertCanWrite("delete product")
  const product = getProductsSync().find((item) => item.id === productId)
  if (!product) return

  const idsToArchive = [productId, ...getProductsSync().filter(p => p.parentId === productId).map(p => p.id)]
  const nextProducts = getProductsSync().map(p =>
    idsToArchive.includes(p.id) ? { ...p, archived: true } : p
  )
  writeProducts(nextProducts)
  const archiveSyncById = new Map(nextProducts.map(p => [p.id, p.syncId]))
  idsToArchive.forEach(id => {
    enqueueSyncOperation({
      entity: "product",
      action: "update",
      summary: `Product ${id} archived.`,
      // Include syncId so the update matches the correct row cross-system
      // (numeric id differs between hub and cloud for hub-created products).
      payload: { id, syncId: archiveSyncById.get(id), archived: true },
    })
  })
  recordAuditEvent({
    action: "product.archive", entity: "product",
    summary: `${product.name} archived${idsToArchive.length > 1 ? ` with ${idsToArchive.length - 1} variants` : ""}`,
    metadata: { productId, archivedIds: idsToArchive.join(",") },
  })
}

export function restoreProduct(productId: number) {
  assertCanWrite("delete product")
  const product = getProductsSync().find((item) => item.id === productId)
  if (!product) return

  const idsToRestore = [productId, ...getProductsSync().filter(p => p.parentId === productId).map(p => p.id)]
  const nextProducts = getProductsSync().map(p =>
    idsToRestore.includes(p.id) ? { ...p, archived: false } : p
  )
  writeProducts(nextProducts)
  const restoreSyncById = new Map(nextProducts.map(p => [p.id, p.syncId]))
  idsToRestore.forEach(id => {
    enqueueSyncOperation({
      entity: "product",
      action: "update",
      summary: `Product ${id} restored.`,
      payload: { id, syncId: restoreSyncById.get(id), archived: false },
    })
  })
  recordAuditEvent({
    action: "product.restore", entity: "product",
    summary: `${product.name} restored`,
    metadata: { productId },
  })
}

export function deleteProduct(productId: number) {
  assertCanWrite("delete product")
  const products = getProductsSync()
  const product = products.find((item) => item.id === productId)
  if (!product) return

  const idsToDelete = [productId, ...products.filter(p => p.parentId === productId).map(p => p.id)]
  const deleteSyncById = new Map(products.map(p => [p.id, p.syncId]))
  writeProducts(products.filter((item) => !idsToDelete.includes(item.id)))
  idsToDelete.forEach(id => {
    enqueueSyncOperation({
      entity: "product",
      action: "delete",
      summary: `Product ${id} deleted.`,
      payload: { id, syncId: deleteSyncById.get(id) },
    })
  })
}

export function toggleProductFavorite(productId: number) {
  const product = getProductsSync().find((item) => item.id === productId)

  if (!product) {
    return undefined
  }

  return updateProduct(productId, {
    favorite: !product.favorite,
  })
}

export function renameCategory(oldCategory: string, nextCategory: string) {
  const from = normalizeName(oldCategory)
  const to = normalizeName(nextCategory)

  if (!from || !to || from === to) {
    return getProductsSync()
  }

  const nextProducts = getProductsSync().map((product) =>
    product.category === from
      ? {
          ...product,
          category: to,
        }
      : product
  )

  writeProducts(nextProducts)

  // Sync each affected product individually so the server handler works
  for (const product of nextProducts) {
    if (product.category === to && from !== to) {
      enqueueSyncOperation({
        entity: "product",
        action: "update",
        summary: `${product.name} category: ${from} → ${to}.`,
        payload: product,
      })
    }
  }

  return nextProducts
}

export function decreaseProductStock(items: ProductStockMovement[]) {
  const nextProducts = getProductsSync().map((product) => {
    const movement = items.find((item) => item.productId === product.id)

    if (!movement) {
      return product
    }

    return {
      ...product,
      stock: Math.max(0, product.stock - movement.quantity),
    }
  })

  writeProducts(nextProducts)

  return nextProducts
}

export function increaseProductStock(items: ProductStockMovement[]) {
  const nextProducts = getProductsSync().map((product) => {
    const movement = items.find((item) => item.productId === product.id)

    if (!movement) {
      return product
    }

    return {
      ...product,
      stock: product.stock + movement.quantity,
    }
  })

  writeProducts(nextProducts)

  return nextProducts
}

export function findProductByBarcode(barcode: string) {
  const normalizedBarcode = normalizeBarcode(barcode)

  return getProductsSync().find((product) =>
    productHasBarcode(product, normalizedBarcode)
  )
}

export function productHasBarcode(product: Product, barcode: string) {
  const normalizedBarcode = normalizeBarcode(barcode)

  return (
    product.barcode === normalizedBarcode ||
    normalizeBarcodeList(product.barcodeAliases).includes(normalizedBarcode)
  )
}

export function productMatchesSearch(product: Product, query: string) {
  const cleanQuery = query.trim().toLowerCase()
  const barcodeQuery = normalizeBarcode(query)

  if (!cleanQuery) {
    return true
  }

  return (
    product.name?.toLowerCase()?.includes(cleanQuery) ||
    product.barcode?.includes(barcodeQuery) ||
    normalizeBarcodeList(product.barcodeAliases).some((barcode) =>
      barcode.includes(barcodeQuery)
    )
  )
}

/** POS-RECEIVE-UX-1C: active (non-archived) products whose name matches `name`
 *  after case-insensitive whitespace normalization. Used by receiving to nudge
 *  ("Pepsi already exists — add this barcode to it?") — detection only; it never
 *  merges or writes. */
export function findProductsByExactName(name: string, list?: Product[]): Product[] {
  const target = name.trim().replace(/\s+/g, " ").toLowerCase()
  if (!target) return []
  const products = list ?? getProductsSync()
  return products.filter(
    (p) => !p.archived && p.name.trim().replace(/\s+/g, " ").toLowerCase() === target
  )
}

export function generateProductBarcode() {
  const existingBarcodes = new Set(
    getProductsSync().flatMap((product) => [
      product.barcode,
      ...(product.barcodeAliases ?? []),
    ])
  )
  const prefix = "528"
  let attempt = 0

  while (attempt < 50) {
    const timestamp = Date.now().toString().slice(-8)
    const randomPart = Math.floor(Math.random() * 100)
      .toString()
      .padStart(2, "0")
    const barcode = `${prefix}${timestamp}${randomPart}`.slice(0, 13)

    if (!existingBarcodes.has(barcode)) {
      return barcode
    }

    attempt += 1
  }

  return `${prefix}${Date.now().toString().slice(-10)}`.slice(0, 13)
}

// ── Batch receiving helpers ──────────────────────────────────────
const BATCH_DEFAULTS_KEY = "lebanonpos.receive-defaults.v1"

export type ReceiveDefaults = {
  supplierId?: string; supplierName?: string
  purchaseOrderNumber?: string
  category?: string; cost?: number; price?: number
  reorderPoint?: number; reorderQuantity?: number
}

export function getReceiveDefaults(): ReceiveDefaults {
  try {
    const raw = localStorage.getItem(BATCH_DEFAULTS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

export function saveReceiveDefaults(input: ReceiveDefaults) {
  const existing = getReceiveDefaults()
  const updated: ReceiveDefaults = { ...existing, ...input }
  localStorage.setItem(BATCH_DEFAULTS_KEY, JSON.stringify(updated))
}

// ── Data cleanup tools ───────────────────────────────────────────
export type CleanupResult = { changed: number; message: string }

/** Merge all matching categories into one (case-insensitive) */
export function mergeCategories(from: string, to: string): CleanupResult {
  const products = getProductsSync()
  const fromNorm = normalizeName(from)
  const toNorm = normalizeName(to)
  let changed = 0
  const updated = products.map(p => {
    if (normalizeName(p.category) === fromNorm) {
      changed++
      return { ...p, category: toNorm }
    }
    return p
  })
  if (changed > 0) writeProducts(updated)
  return { changed, message: `Merged ${changed} products from "${from}" to "${to}"` }
}

/** Detect products with duplicate barcodes.
 *
 * POS-BARCODE-ALIAS-1: a barcode collision is counted across BOTH the primary
 * `barcode` and every entry in `barcodeAliases`. A barcode is a conflict when
 * more than one DISTINCT product uses it — as primary on one and alias on
 * another, as an alias on two products, or as primary on two products. Each
 * conflicting product is returned exactly once (a Set of ids per barcode makes
 * self-references and 3+-way groups immune to count inflation). */
export function detectDuplicateBarcodes() {
  const products = getProductsSync()

  // Map every barcode (primary + aliases) → the set of product ids using it.
  const productIdsByBarcode = new Map<string, Set<number>>()
  const register = (barcode: string | undefined, id: number) => {
    const normalized = normalizeBarcode(barcode ?? "")
    if (!normalized) return
    const ids = productIdsByBarcode.get(normalized) ?? new Set<number>()
    ids.add(id)
    productIdsByBarcode.set(normalized, ids)
  }
  for (const p of products) {
    register(p.barcode, p.id)
    for (const alias of normalizeBarcodeList(p.barcodeAliases)) register(alias, p.id)
  }

  // Any barcode shared by 2+ distinct products marks all of them as conflicting.
  const conflictedIds = new Set<number>()
  for (const ids of productIdsByBarcode.values()) {
    if (ids.size > 1) for (const id of ids) conflictedIds.add(id)
  }

  return products
    .filter((p) => conflictedIds.has(p.id))
    .map((p) => ({ id: p.id, name: p.name, barcode: p.barcode ?? "" }))
}

/** Detect products missing required fields */
export function detectIncompleteProducts() {
  return getProductsSync().filter(p =>
    !p.name || !p.barcode || p.price <= 0 || !p.category
  ).map(p => ({
    id: p.id, name: p.name,
    missing: [
      !p.name && "name", !p.barcode && "barcode",
      p.price <= 0 && "price", !p.category && "category",
    ].filter(Boolean).join(", "),
  }))
}

// ── Product views / quick filters ────────────────────────────────

export function getLowStockProducts(products?: Product[]) {
  const list = products ?? getProductsSync()
  return list.filter(p => !p.archived && p.stock <= (p.reorderPoint ?? 10) && p.stock >= 0)
}

export function getNoBarcodeProducts(products?: Product[]) {
  const list = products ?? getProductsSync()
  return list.filter(p => !p.archived && (!p.barcode || p.barcode.trim() === ""))
}

export type ProductSortKey = "name" | "stock" | "category" | "price" | "cost" | "margin"
export type SortDir = "asc" | "desc"

export function sortProducts(list: Product[], key: ProductSortKey, dir: SortDir): Product[] {
  const sorted = [...list]
  const cmp = (a: number, b: number) => dir === "asc" ? a - b : b - a
  const strCmp = (a: string, b: string) => dir === "asc" ? a.localeCompare(b) : b.localeCompare(a)

  switch (key) {
    case "name":     sorted.sort((a, b) => strCmp(a.name, b.name)); break
    case "stock":    sorted.sort((a, b) => cmp(a.stock, b.stock)); break
    case "category": sorted.sort((a, b) => strCmp(a.category, b.category)); break
    case "price":    sorted.sort((a, b) => cmp(a.price, b.price)); break
    case "cost":     sorted.sort((a, b) => cmp(a.cost, b.cost)); break
    case "margin":   sorted.sort((a, b) => cmp(a.price - a.cost, b.price - b.cost)); break
  }
  return sorted
}

export function filterByStockStatus(list: Product[], status: "ok" | "low" | "out"): Product[] {
  return list.filter(p => {
    if (p.archived) return false
    if (status === "out") return p.stock <= 0
    if (status === "low") return p.stock > 0 && p.stock <= (p.reorderPoint ?? 10)
    return p.stock > (p.reorderPoint ?? 10)
  })
}

export function filterByCategory(list: Product[], category: string): Product[] {
  const norm = normalizeName(category)
  return list.filter(p => normalizeName(p.category) === norm)
}

export function filterBySupplier(list: Product[], supplierId: string): Product[] {
  return list.filter(p => p.supplierId === supplierId)
}

// ── Receiving helpers ────────────────────────────────────────────

export type ReceiveRowValidation = {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export function validateReceiveRow(row: {
  name?: string; barcode?: string; quantity: number; cost?: number; price?: number
}): ReceiveRowValidation {
  const errors: string[] = []
  const warnings: string[] = []

  if (!row.name?.trim()) errors.push("Name required")
  if (!row.barcode?.trim()) errors.push("Barcode required")
  if (!row.quantity || row.quantity <= 0) errors.push("Quantity must be > 0")
  if (row.price !== undefined && row.price < 0) errors.push("Price cannot be negative")
  if (row.cost !== undefined && row.cost < 0) errors.push("Cost cannot be negative")
  if (row.price !== undefined && row.cost !== undefined && row.price > 0 && row.cost > 0 && row.cost > row.price) {
    warnings.push("Cost exceeds price")
  }

  return { valid: errors.length === 0, errors, warnings }
}

export type SpreadsheetRowResult = {
  rows: Array<{
    name: string; barcode: string; category: string; quantity: number
    cost: number; price: number
  }>
  rejected: Array<{ index: number; reason: string; raw: string }>
}

export function parseSpreadsheetPaste(text: string): SpreadsheetRowResult {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim())
  const rows: SpreadsheetRowResult["rows"] = []
  const rejected: SpreadsheetRowResult["rejected"] = []

  lines.forEach((line, i) => {
    const cols = line.split(/\t|,|;/).map(c => c.trim().replace(/^"|"$/g, ""))
    const name = cols[0] || ""
    const barcode = cols[1] || ""
    const category = cols[2] || "General"
    const qty = Number(cols[3])
    const cost = Number(cols[4]) || 0
    const price = Number(cols[5]) || 0

    if (!name || !barcode || !qty || qty <= 0) {
      rejected.push({ index: i + 1, reason: `Missing ${!name ? "name" : !barcode ? "barcode" : "valid quantity"}`, raw: line })
      return
    }

    rows.push({ name, barcode, category, quantity: qty, cost, price })
  })

  return { rows, rejected }
}

// ── Write-off ─────────────────────────────────────────────────────

export type WriteOffInput = {
  productId: number
  quantity: number
  reason: "Damage" | "Expired" | "Theft" | "Manual Correction"
  batchId?: string
  note?: string
}

export async function writeOffStock(input: WriteOffInput) {
  const { recordStockAdjustment } = await import("./inventoryAdjustment.service")
  return recordStockAdjustment({
    productId: input.productId,
    quantityChange: -Math.abs(input.quantity),
    reason: input.reason,
    note: input.note || `Write-off: ${input.reason}`,
    batchId: input.batchId,
  })
}

// ── Reconciliation ─────────────────────────────────────────────────

export type ReconciliationIssue = {
  type: "stock_batch_mismatch" | "negative_batch" | "consumed_with_remaining" | "open_with_zero" | "stock_no_lots" | "orphan_batch"
  severity: "error" | "warn"
  productId: number
  productName: string
  barcode: string
  detail: string
  batchId?: string
  stockOnHand: number
  batchTotal: number
  suggestedAction: string
}

export async function getReconciliationIssues(): Promise<ReconciliationIssue[]> {
  const { getInventoryBatches } = await import("./inventoryBatch.service")
  const issues: ReconciliationIssue[] = []
  const products = getProductsSync()
  const batches = getInventoryBatches()

  const batchSumByProduct = new Map<number, number>()
  for (const b of batches) {
    const sum = batchSumByProduct.get(b.productId) || 0
    batchSumByProduct.set(b.productId, sum + b.quantityRemaining)
  }

  // Stock vs batch mismatch
  for (const p of products) {
    if (p.archived) continue
    const batchTotal = batchSumByProduct.get(p.id) || 0
    if (Math.abs(p.stock - batchTotal) > 0.5) {
      issues.push({
        type: "stock_batch_mismatch",
        severity: "warn",
        productId: p.id, productName: p.name, barcode: p.barcode ?? "",
        detail: `Product stock=${p.stock}, batch total=${batchTotal}, diff=${p.stock - batchTotal}`,
        stockOnHand: p.stock, batchTotal,
        suggestedAction: "Run a stock count or adjust the difference via Control panel.",
      })
    }
  }

  // Negative batch quantities
  for (const b of batches) {
    if (b.quantityRemaining < 0) {
      issues.push({
        type: "negative_batch", severity: "error",
        productId: b.productId, productName: b.productName, barcode: b.barcode,
        detail: `Batch ${b.batchNumber} has negative remaining: ${b.quantityRemaining}`,
        batchId: b.id, stockOnHand: products.find(p => p.id === b.productId)?.stock ?? 0,
        batchTotal: b.quantityRemaining,
        suggestedAction: "Adjust or repair this batch via Control panel.",
      })
    }
  }

  // Consumed lots with remaining quantity
  for (const b of batches) {
    if (b.status === "Consumed" && b.quantityRemaining > 0) {
      issues.push({
        type: "consumed_with_remaining", severity: "error",
        productId: b.productId, productName: b.productName, barcode: b.barcode,
        detail: `Batch ${b.batchNumber} is Consumed but has ${b.quantityRemaining} remaining`,
        batchId: b.id, stockOnHand: products.find(p => p.id === b.productId)?.stock ?? 0,
        batchTotal: b.quantityRemaining,
        suggestedAction: "Set this batch to Open if stock still exists.",
      })
    }
  }

  // Open lots with zero quantity
  for (const b of batches) {
    if (b.status === "Open" && b.quantityRemaining <= 0 && b.initialQuantity > 0) {
      issues.push({
        type: "open_with_zero", severity: "warn",
        productId: b.productId, productName: b.productName, barcode: b.barcode,
        detail: `Batch ${b.batchNumber} is Open but has ${b.quantityRemaining} remaining`,
        batchId: b.id, stockOnHand: products.find(p => p.id === b.productId)?.stock ?? 0,
        batchTotal: b.quantityRemaining,
        suggestedAction: "Mark this batch as Consumed.",
      })
    }
  }

  // Products with stock but no lots
  for (const p of products) {
    if (p.archived) continue
    if (p.stock > 0 && !batchSumByProduct.has(p.id)) {
      issues.push({
        type: "stock_no_lots", severity: "warn",
        productId: p.id, productName: p.name, barcode: p.barcode ?? "",
        detail: `Product has ${p.stock} units but no inventory batches`,
        stockOnHand: p.stock, batchTotal: 0,
        suggestedAction: "Receive this product to create an opening batch.",
      })
    }
  }

  // Orphan batches — product missing or archived
  for (const b of batches) {
    const product = products.find(p => p.id === b.productId)
    if (!product || product.archived) {
      issues.push({
        type: "orphan_batch", severity: "warn",
        productId: b.productId, productName: b.productName, barcode: b.barcode,
        detail: `Batch ${b.batchNumber} belongs to ${product?.archived ? "archived" : "missing"} product`,
        batchId: b.id, stockOnHand: 0, batchTotal: b.quantityRemaining,
        suggestedAction: product?.archived ? "Restore the product or write off this batch." : "The product no longer exists — write off this batch.",
      })
    }
  }

  return issues.sort((a, b) => a.severity === "error" ? -1 : 1)
}
