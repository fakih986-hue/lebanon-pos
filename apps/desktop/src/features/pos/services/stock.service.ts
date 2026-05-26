import type { Product } from "../types/product"
import { getInventoryBatches, type InventoryBatch } from "./inventoryBatch.service"
import { getSales } from "./sales.service"

export type ReorderSuggestion = {
  product: Product
  soldLast30Days: number
  averageDailySales: number
  reorderPoint: number
  targetStock: number
  suggestedQuantity: number
  urgency: "Critical" | "Low" | "Watch"
  supplierId?: string
  supplierName: string
}

export type ExpiryAlert = {
  product: Product
  batch?: InventoryBatch
  daysUntilExpiry: number
  status: "Expired" | "Soon"
}

export type DeadStockItem = {
  product: Product
  soldLast60Days: number
  lastSoldAt: string | null
}

export type PromoSuggestion = {
  product: Product
  reason: "Expiring" | "Dead stock"
  suggestedDiscountPercent: number
  detail: string
}

const LOOKBACK_DAYS = 30
const DEFAULT_REORDER_POINT = 10
const DEFAULT_TARGET_DAYS = 14

function startOfLookback() {
  const date = new Date()

  date.setDate(date.getDate() - LOOKBACK_DAYS)
  date.setHours(0, 0, 0, 0)

  return date
}

function getSalesVelocity(productId: number) {
  const since = startOfLookback()

  return getSales()
    .filter((sale) => new Date(sale.createdAt) >= since)
    .flatMap((sale) => sale.items)
    .filter((item) => item.id === productId)
    .reduce((sum, item) => sum + item.quantity, 0)
}

function getSoldSince(productId: number, days: number) {
  const since = new Date()

  since.setDate(since.getDate() - days)
  since.setHours(0, 0, 0, 0)

  return getSales()
    .filter((sale) => new Date(sale.createdAt) >= since)
    .flatMap((sale) => sale.items)
    .filter((item) => item.id === productId)
    .reduce((sum, item) => sum + item.quantity, 0)
}

function getLastSoldAt(productId: number) {
  const sale = getSales().find((currentSale) =>
    currentSale.items.some((item) => item.id === productId)
  )

  return sale?.createdAt ?? null
}

function getDaysUntil(dateValue: string) {
  const today = new Date()
  const date = new Date(dateValue)

  today.setHours(0, 0, 0, 0)
  date.setHours(0, 0, 0, 0)

  return Math.ceil((date.getTime() - today.getTime()) / 86_400_000)
}

export function getReorderSuggestions(products: Product[]) {
  return products
    .map<ReorderSuggestion>((product) => {
      const soldLast30Days = getSalesVelocity(product.id)
      const averageDailySales = soldLast30Days / LOOKBACK_DAYS
      const velocityReorderPoint = Math.ceil(averageDailySales * 7)
      const reorderPoint =
        product.reorderPoint ?? Math.max(DEFAULT_REORDER_POINT, velocityReorderPoint)
      const targetStock = Math.max(
        product.reorderQuantity ?? 0,
        reorderPoint * 2,
        Math.ceil(averageDailySales * DEFAULT_TARGET_DAYS),
        DEFAULT_REORDER_POINT
      )
      const suggestedQuantity = Math.max(0, targetStock - product.stock)
      const urgency =
        product.stock <= 0
          ? "Critical"
          : product.stock <= reorderPoint
            ? "Low"
            : "Watch"

      return {
        product,
        soldLast30Days,
        averageDailySales,
        reorderPoint,
        targetStock,
        suggestedQuantity,
        urgency,
        supplierId: product.supplierId,
        supplierName: product.supplierName || "No supplier linked",
      }
    })
    .filter(
      (suggestion) =>
        suggestion.urgency !== "Watch" ||
        suggestion.soldLast30Days >= 10 ||
        suggestion.product.favorite
    )
    .sort((a, b) => {
      const urgencyWeight = { Critical: 0, Low: 1, Watch: 2 }

      return (
        urgencyWeight[a.urgency] - urgencyWeight[b.urgency] ||
        b.soldLast30Days - a.soldLast30Days ||
        a.product.stock - b.product.stock
      )
    })
}

export function groupReorderSuggestionsBySupplier(
  suggestions: ReorderSuggestion[]
) {
  const groups = new Map<
    string,
    {
      supplierId?: string
      supplierName: string
      totalCost: number
      items: ReorderSuggestion[]
    }
  >()

  suggestions.forEach((suggestion) => {
    const key = suggestion.supplierId ?? "unlinked"
    const currentGroup = groups.get(key) ?? {
      supplierId: suggestion.supplierId,
      supplierName: suggestion.supplierName,
      totalCost: 0,
      items: [],
    }

    currentGroup.items.push(suggestion)
    currentGroup.totalCost +=
      suggestion.suggestedQuantity * suggestion.product.cost
    groups.set(key, currentGroup)
  })

  return Array.from(groups.values()).sort(
    (a, b) => b.totalCost - a.totalCost || a.supplierName.localeCompare(b.supplierName)
  )
}

export function getExpiryAlerts(products: Product[], horizonDays = 30) {
  const productMap = new Map(products.map((product) => [product.id, product]))
  const batchAlerts = getInventoryBatches()
    .filter((batch) => batch.quantityRemaining > 0 && Boolean(batch.expiryDate))
    .map<ExpiryAlert>((batch) => {
      const product = productMap.get(batch.productId)
      const daysUntilExpiry = getDaysUntil(batch.expiryDate ?? "")

      return {
        product: product ?? {
          id: batch.productId,
          name: batch.productName,
          price: batch.unitPrice,
          cost: batch.unitCost,
          stock: batch.quantityRemaining,
          barcode: batch.barcode,
          category: "Unlinked",
          accent: "emerald",
        },
        batch,
        daysUntilExpiry,
        status: daysUntilExpiry < 0 ? "Expired" : "Soon",
      }
    })
  const productFallbackAlerts = products
    .filter((product) => product.stock > 0 && Boolean(product.expiryDate))
    .map<ExpiryAlert>((product) => ({
      product,
      daysUntilExpiry: getDaysUntil(product.expiryDate ?? ""),
      status: getDaysUntil(product.expiryDate ?? "") < 0 ? "Expired" : "Soon",
    }))

  return [...batchAlerts, ...productFallbackAlerts]
    .filter((alert) => alert.daysUntilExpiry <= horizonDays)
    .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry)
}

export function getDeadStockItems(products: Product[], days = 60) {
  return products
    .map<DeadStockItem>((product) => ({
      product,
      soldLast60Days: getSoldSince(product.id, days),
      lastSoldAt: getLastSoldAt(product.id),
    }))
    .filter((item) => item.product.stock > 0 && item.soldLast60Days === 0)
    .sort((a, b) => b.product.stock * b.product.cost - a.product.stock * a.product.cost)
}

export function getPromoSuggestions(products: Product[]) {
  const expiryPromos = getExpiryAlerts(products, 14).map<PromoSuggestion>(
    (alert) => ({
      product: alert.product,
      reason: "Expiring",
      suggestedDiscountPercent: alert.daysUntilExpiry <= 3 ? 30 : 15,
      detail:
        alert.daysUntilExpiry < 0
          ? "Expired stock needs immediate review."
          : `${alert.daysUntilExpiry} days to expiry.`,
    })
  )
  const deadStockPromos = getDeadStockItems(products, 60)
    .slice(0, 8)
    .map<PromoSuggestion>((item) => ({
      product: item.product,
      reason: "Dead stock",
      suggestedDiscountPercent: 10,
      detail: item.lastSoldAt
        ? `Last sold ${new Date(item.lastSoldAt).toLocaleDateString("en-LB")}.`
        : "No recorded sales yet.",
    }))

  return [...expiryPromos, ...deadStockPromos].slice(0, 12)
}
