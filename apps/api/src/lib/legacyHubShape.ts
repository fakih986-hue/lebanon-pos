/**
 * Pilot acceptance (batch 79): hubs 1.0.49–1.0.51 pull with sync schema 2 and insert pulled rows verbatim
 * (`create: { ...row }`). A column their database lacks fails the whole entity ("Unknown argument sellable"), so
 * after the cloud is upgraded first such a hub received no products or staff at all — a freshly activated one could
 * not even sign in. Their pulls are projected onto the fields those hubs have (lib/legacyHubFields.ts, generated
 * from the v1.0.49 schema), relations included. Values are never changed here; the schema shapers in routes/sync.ts
 * still decide what such a client may see (no recipe drinks, legacy daily closes, no stock policy).
 */
import { LEGACY_HUB_FIELDS } from "./legacyHubFields.js"

/** The pull payload's arrays and the model each holds. */
const PAYLOAD_MODELS: Record<string, string> = {
  products: "Product", sales: "Sale", refunds: "SaleRefund", customers: "Customer", debtSales: "DebtSale", debtPayments: "DebtPayment",
  suppliers: "Supplier", purchaseOrders: "PurchaseOrder", supplierPayments: "SupplierPayment", users: "StaffUser", shifts: "Shift",
  auditEvents: "AuditEvent", settings: "AppSettings", expenses: "Expense", batches: "InventoryBatch", adjustments: "StockAdjustment",
  stockCounts: "StockCountSession", dailyCloses: "DailyClose", deliveryOrders: "DeliveryOrder",
}

/** A hub of this era: the cloud bridge (store key) announcing a sync schema below 3. Registers are never projected. */
export function isLegacyHubPull(auth: { userId?: string } | undefined, schema: number): boolean {
  return auth?.userId === "cloud-bridge" && schema < 3
}

export function projectLegacyRow(model: string, row: unknown): unknown {
  const fields = LEGACY_HUB_FIELDS[model]
  if (!fields || !row || typeof row !== "object" || Array.isArray(row)) return row
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
    if (!(key in fields)) continue
    const related = fields[key]
    out[key] = related && value && typeof value === "object"
      ? (Array.isArray(value) ? value.map((v) => projectLegacyRow(related, v)) : projectLegacyRow(related, value))
      : value
  }
  return out
}

export function projectLegacyRows(model: string, rows: unknown[]): unknown[] {
  return rows.map((r) => projectLegacyRow(model, r))
}

/** Projects every model array of a pull body; other keys (policy, topology, deletions, serverTime) are kept. */
export function projectLegacyPull<T extends Record<string, unknown>>(body: T): T {
  const out: Record<string, unknown> = { ...body }
  for (const [key, model] of Object.entries(PAYLOAD_MODELS)) if (Array.isArray(out[key])) out[key] = projectLegacyRows(model, out[key] as unknown[])
  return out as T
}

/** The model behind a per-entity full pull's Prisma delegate name ("products" -> "product" -> "Product"). */
export function legacyModelOf(delegate: string): string | undefined {
  const model = delegate.charAt(0).toUpperCase() + delegate.slice(1)
  return model in LEGACY_HUB_FIELDS ? model : undefined
}
