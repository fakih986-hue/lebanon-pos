import { getAll, put, putMany } from "./db"

const LOCALSTORAGE_KEYS: Record<string, string> = {
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
  "lebanonpos.sync-queue.v1": "sync-queue",
}

const SINGLE_VALUE_KEYS: Record<string, string> = {
  "lebanonpos.session.v1": "session",
  "lebanonpos.current-user.v1": "current-user",
}

const MIGRATION_KEY = "lebanonpos-migration"

export async function runMigration(): Promise<void> {
  try {
    const existing = await getAll<{ key: string; migrated: boolean }>(MIGRATION_KEY)
    if (existing.length > 0 && existing[0]?.migrated) return

    for (const [lsKey, storeName] of Object.entries(LOCALSTORAGE_KEYS)) {
      const raw = localStorage.getItem(lsKey)
      if (raw) {
        try {
          const data = JSON.parse(raw)
          if (Array.isArray(data) && data.length > 0) {
            await putMany(storeName, data)
          }
        } catch { /* skip invalid JSON */ }
      }
    }

    for (const [lsKey, storeName] of Object.entries(SINGLE_VALUE_KEYS)) {
      const raw = localStorage.getItem(lsKey)
      if (raw) {
        try {
          const value = JSON.parse(raw)
          await put(storeName, value)
        } catch { /* skip */ }
      }
    }

    await put(MIGRATION_KEY, { key: "v1", migrated: true })
  } catch { /* migration silently fails, localStorage fallback works */ }
}
