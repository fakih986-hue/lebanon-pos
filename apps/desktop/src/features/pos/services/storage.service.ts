import { getAll, putMany } from "./db"

const LS_KEY_TO_STORE: Record<string, string | null> = {
  "lebanonpos.products.v1": "products",
  "lebanonpos.sales.v1": "sales",
  "lebanonpos.refunds.v1": "refunds",
  "lebanonpos.customers.v1": "customers",
  "lebanonpos.debt-sales.v1": "debt-sales",
  "lebanonpos.debt-payments.v1": "debt-payments",
  "lebanonpos.suppliers.v1": "suppliers",
  "lebanonpos.purchase-orders.v1": "purchase-orders",
  "lebanonpos.supplier-payments.v1": "supplier-payments",
  "lebanonpos.users.v1": "users",
  "lebanonpos.shifts.v1": "shifts",
  "lebanonpos.audit.v1": "audit",
  "lebanonpos.settings.v1": "settings",
  "lebanonpos.expenses.v1": "expenses",
  "lebanonpos.stock-counts.v1": "stock-counts",
  "lebanonpos.inventory-batches.v1": "inventory-batches",
  "lebanonpos.inventory-adjustments.v1": "inventory-adjustments",
  "lebanonpos.held-sales.v1": "held-sales",
  "lebanonpos.daily-closes.v1": "daily-closes",
  "lebanonpos.delivery-orders.v1": "delivery-orders",
  "lebanonpos.sync-queue.v1": "sync-queue",
  "lebanonpos.session.v1": null,
  "lebanonpos.current-user.v1": null,
}

export function writeLocalWithIndexedDB<T>(lsKey: string, value: T[]): void {
  if (typeof window === "undefined" || !window.localStorage) return
  window.localStorage.setItem(lsKey, JSON.stringify(value))
  const storeName = LS_KEY_TO_STORE[lsKey]
  if (storeName) {
    putMany(storeName, value).catch(() => {})
  }
}

export async function restoreIndexedDBToLocal(): Promise<number> {
  let restored = 0
  for (const [lsKey, storeName] of Object.entries(LS_KEY_TO_STORE)) {
    if (!storeName) continue
    try {
      const data = await getAll<unknown>(storeName)
      if (data.length > 0 && !window.localStorage.getItem(lsKey)) {
        window.localStorage.setItem(lsKey, JSON.stringify(data))
        restored++
      }
    } catch { /* skip */ }
  }
  return restored
}
