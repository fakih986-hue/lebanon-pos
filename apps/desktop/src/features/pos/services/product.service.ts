import { products } from "../data/products"
import type { Product, ProductAccent } from "../types/product"
import { receiveInventoryBatches } from "./inventoryBatch.service"
import { enqueueSyncOperation } from "./sync.service"
import { writeLocalWithIndexedDB } from "./storage.service"
import { canUseStorage } from "../lib/storage"

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
      product.category.toLowerCase() === category.trim().toLowerCase()
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
  const currentProducts = getProductsSync()
  const nextProducts = [...currentProducts]
  let nextId =
    nextProducts.reduce((maxId, product) => Math.max(maxId, product.id), 0) + 1

  entries.forEach((entry, index) => {
    const barcode = normalizeBarcode(entry.barcode)
    const name = normalizeName(entry.name)
    const category = normalizeName(entry.category)

    if (!barcode || !name || !category || entry.stock <= 0) {
      return
    }

    const existingIndex = nextProducts.findIndex((product) =>
      productHasBarcode(product, barcode)
    )

    if (existingIndex >= 0) {
      const existingProduct = nextProducts[existingIndex]

      nextProducts[existingIndex] = {
        ...existingProduct,
        name,
        category,
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

      receiveInventoryBatches([
        {
          productId: updatedProduct.id,
          productName: updatedProduct.name,
          barcode: updatedProduct.barcode,
          quantity: entry.stock,
          unitCost: entry.cost,
          unitPrice: entry.price,
          expiryDate: entry.expiryDate,
          supplierId: entry.supplierId,
          supplierName: entry.supplierName,
        },
      ])

      return
    }

    const product: Product = {
      id: nextId,
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
    }

    nextProducts.push(product)
    receiveInventoryBatches([
      {
        productId: product.id,
        productName: product.name,
        barcode: product.barcode,
        quantity: entry.stock,
        unitCost: product.cost,
        unitPrice: product.price,
        expiryDate: product.expiryDate,
        supplierId: product.supplierId,
        supplierName: product.supplierName,
      },
    ])
    nextId += 1
  })

  writeProducts(nextProducts)
  enqueueSyncOperation({
    entity: "product",
    action: "create",
    summary: `${entries.length} receiving line${
      entries.length === 1 ? "" : "s"
    } queued for sync.`,
    payload: entries,
  })

  return nextProducts
}

export function updateProduct(productId: number, patch: Partial<Product>) {
  const cleanPatch = cleanProductPatch(patch)
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
}): Product {
  const currentProducts = getProductsSync()
  const nextId = currentProducts.reduce((max, p) => Math.max(max, p.id), 0) + 1
  const product: Product = {
    id: nextId,
    name: normalizeName(input.name),
    price: input.price,
    cost: input.cost,
    stock: input.stock,
    barcode: normalizeBarcode(input.barcode),
    category: normalizeName(input.category),
    accent: input.accent ?? chooseAccent(input.category, nextId),
    parentId: input.parentId ?? null,
    variantName: input.variantName ?? undefined,
    barcodeAliases: [],
  }
  const nextProducts = [...currentProducts, product]
  writeProducts(nextProducts)
  return product
}

export function deleteProduct(productId: number) {
  const products = getProductsSync()
  const product = products.find((item) => item.id === productId)
  if (!product) return

  const idsToDelete = [productId, ...products.filter(p => p.parentId === productId).map(p => p.id)]
  writeProducts(products.filter((item) => !idsToDelete.includes(item.id)))
  idsToDelete.forEach(id => {
    enqueueSyncOperation({
      entity: "product",
      action: "delete",
      summary: `Product ${id} deleted.`,
      payload: { id },
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
  enqueueSyncOperation({
    entity: "product",
    action: "update",
    summary: `${from} category renamed to ${to}.`,
    payload: {
      oldCategory: from,
      nextCategory: to,
    },
  })

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
    product.name.toLowerCase().includes(cleanQuery) ||
    product.barcode.includes(barcodeQuery) ||
    normalizeBarcodeList(product.barcodeAliases).some((barcode) =>
      barcode.includes(barcodeQuery)
    )
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
