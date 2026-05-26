import type { Product } from "../types/product"
import {
  getDeadStockItems,
  getExpiryAlerts,
  getPromoSuggestions,
  getReorderSuggestions,
} from "./stock.service"

export type AppNotification = {
  id: string
  title: string
  detail: string
  severity: "Critical" | "Warning" | "Info"
  actionLabel: string
  actionPath: string
}

export function getInventoryNotifications(products: Product[]) {
  const suggestions = getReorderSuggestions(products)
  const notifications: AppNotification[] = []

  suggestions.forEach((suggestion) => {
    if (suggestion.product.stock <= 0) {
      notifications.push({
        id: `out-${suggestion.product.id}`,
        title: `${suggestion.product.name} is out of stock`,
        detail: `Suggested order: ${suggestion.suggestedQuantity} units${
          suggestion.supplierName ? ` from ${suggestion.supplierName}` : ""
        }.`,
        severity: "Critical",
        actionLabel: "Receive stock",
        actionPath: "/products/new",
      })

      return
    }

    if (suggestion.product.stock <= suggestion.reorderPoint) {
      notifications.push({
        id: `low-${suggestion.product.id}`,
        title: `${suggestion.product.name} is low`,
        detail: `${suggestion.product.stock} left, alert point ${suggestion.reorderPoint}. Suggested order: ${suggestion.suggestedQuantity} units.`,
        severity: "Warning",
        actionLabel: "Review reorder",
        actionPath: "/products",
      })
    } else if (suggestion.soldLast30Days >= 10) {
      notifications.push({
        id: `fast-${suggestion.product.id}`,
        title: `${suggestion.product.name} is moving fast`,
        detail: `${suggestion.soldLast30Days} sold in 30 days. Keep enough stock for rush periods.`,
        severity: "Info",
        actionLabel: "Review stock",
        actionPath: "/products",
      })
    }

    if (
      suggestion.suggestedQuantity > 0 &&
      (!suggestion.product.supplierId || !suggestion.product.supplierName)
    ) {
      notifications.push({
        id: `supplier-${suggestion.product.id}`,
        title: `${suggestion.product.name} needs a supplier link`,
        detail:
          "Linking a supplier makes the reorder list ready for purchasing.",
        severity: "Info",
        actionLabel: "Link supplier",
        actionPath: "/products",
      })
    }
  })

  getExpiryAlerts(products, 14).forEach((alert) => {
    notifications.push({
      id: `expiry-${alert.product.id}`,
      title:
        alert.status === "Expired"
          ? `${alert.product.name} expired`
          : `${alert.product.name} expires soon`,
      detail:
        alert.status === "Expired"
          ? "Remove, return, or discount only if allowed."
          : `${alert.daysUntilExpiry} days left. Consider promo pricing.`,
      severity: alert.status === "Expired" ? "Critical" : "Warning",
      actionLabel: "Review promos",
      actionPath: "/products",
    })
  })

  getDeadStockItems(products, 60)
    .slice(0, 3)
    .forEach((item) => {
      notifications.push({
        id: `dead-${item.product.id}`,
        title: `${item.product.name} is not selling`,
        detail: `${item.product.stock} units sitting in stock for 60 days.`,
        severity: "Info",
        actionLabel: "Review promo",
        actionPath: "/products",
      })
    })

  getPromoSuggestions(products)
    .slice(0, 3)
    .forEach((promo) => {
      notifications.push({
        id: `promo-${promo.reason}-${promo.product.id}`,
        title: `Promo idea: ${promo.product.name}`,
        detail: `${promo.suggestedDiscountPercent}% suggested. ${promo.detail}`,
        severity: "Info",
        actionLabel: "Open products",
        actionPath: "/products",
      })
    })

  return notifications.sort((a, b) => {
    const weight = { Critical: 0, Warning: 1, Info: 2 }

    return weight[a.severity] - weight[b.severity]
  })
}
