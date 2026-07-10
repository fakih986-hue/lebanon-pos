import { CalendarClock, Copy, MessageCircle, PackageX, Star, Tag, Truck } from "lucide-react"
import { Link } from "react-router"

import { useI18n } from "@lebanonpos/shared"
import { formatCurrency, formatNumber } from "../lib/currency"
import type { DeadStockItem, ExpiryAlert, PromoSuggestion, ReorderSuggestion } from "../services/stock.service"

type SupplierReorderGroup = {
  supplierId?: string
  supplierName: string
  totalCost: number
  items: ReorderSuggestion[]
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-LB", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value))
}

type Props = {
  reorderSuggestions: ReorderSuggestion[]
  reorderGroups: SupplierReorderGroup[]
  expiryAlerts: ExpiryAlert[]
  deadStockItems: DeadStockItem[]
  promoSuggestions: PromoSuggestion[]
  buildSupplierOrderMessage: (group: SupplierReorderGroup) => string
  copySupplierOrder: (group: SupplierReorderGroup) => void
  onWriteOffProduct?: (productId: number) => void
  onViewProduct?: (productId: number) => void
  onReceiveProduct?: (productId: number) => void
}

export default function AlertsPanel({
  reorderSuggestions,
  reorderGroups,
  expiryAlerts,
  deadStockItems,
  promoSuggestions,
  buildSupplierOrderMessage,
  copySupplierOrder,
  onWriteOffProduct,
  onViewProduct,
  onReceiveProduct,
}: Props) {
  const { t } = useI18n()

  return (
    <>
      <section className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="card">
          <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between" style={{ borderBottomColor: "var(--border)" }}>
            <div>
              <h2 className="text-xl font-bold" style={{ color: "var(--text)" }}>
                {t("pos.alerts.stock_title")}
              </h2>
              <p className="text-sm" style={{ color: "var(--text-3)" }}>
                {t("pos.alerts.stock_desc")}
              </p>
            </div>
            <Link
              to="/products/new"
              className="btn-primary btn-md"
            >
              <Truck size={16} />
              {t("pos.receive")}
            </Link>
          </div>

          <div className="grid gap-3 p-4 lg:grid-cols-2">
            {reorderSuggestions.slice(0, 6).map((suggestion) => (
              <article
                key={suggestion.product.id}
                className="rounded-lg border p-3" style={{ borderColor: "var(--border)" }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-bold" style={{ color: "var(--text)" }}>
                        {suggestion.product.name}
                      </p>
                      {suggestion.product.favorite ? (
                        <Star
                          size={15}
                          className="shrink-0"
                          fill="currentColor"
                          style={{ color: "var(--amber)" }}
                        />
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs font-semibold" style={{ color: "var(--text-3)" }}>
                      {suggestion.supplierName}
                    </p>
                    {suggestion.daysUntilStockout !== null && (
                      <p className="mt-1 text-xs font-bold" style={{
                        color: suggestion.daysUntilStockout <= 3 ? "var(--rose-text)"
                          : suggestion.daysUntilStockout <= 7 ? "var(--amber-text)"
                          : "var(--text-3)"
                      }}>
                        {suggestion.product.stock <= 0
                          ? "⚠ Out of stock"
                          : `⏳ Runs out in ~${suggestion.daysUntilStockout} day${suggestion.daysUntilStockout === 1 ? "" : "s"}`}
                      </p>
                    )}
                  </div>
                  <span
                    className={`rounded-lg px-2.5 py-1 text-xs font-bold ${
                      suggestion.urgency === "Critical"
                        ? "bg-rose-100 text-rose-700"
                        : suggestion.urgency === "Low"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-sky-100 text-sky-800"
                    }`}
                  >
                    {suggestion.urgency}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs font-bold">
                  <div className="rounded-lg p-2" style={{ backgroundColor: "var(--surface-2)" }}>
                    <p style={{ color: "var(--text-3)" }}>{t("pos.alerts.stock_label")}</p>
                    <p className="mt-1" style={{ color: "var(--text)" }}>
                      {formatNumber(suggestion.product.stock)}
                    </p>
                  </div>
                  <div className="rounded-lg p-2" style={{ backgroundColor: "var(--surface-2)" }}>
                    <p style={{ color: "var(--text-3)" }}>{t("pos.alerts.sold_label")}</p>
                    <p className="mt-1" style={{ color: "var(--text)" }}>
                      {formatNumber(suggestion.soldLast30Days)}
                    </p>
                  </div>
                  <div className="rounded-lg p-2" style={{ backgroundColor: "var(--surface-2)" }}>
                    <p style={{ color: "var(--text-3)" }}>{t("pos.alerts.reorder_point_label")}</p>
                    <p className="mt-1" style={{ color: "var(--text)" }}>
                      {formatNumber(suggestion.reorderPoint)}
                    </p>
                  </div>
                  <div className="rounded-lg p-2" style={{ backgroundColor: "var(--success-soft)" }}>
                    <p style={{ color: "var(--success-text)" }}>{t("pos.alerts.buy_label")}</p>
                    <p className="mt-1" style={{ color: "var(--success)" }}>
                      {formatNumber(suggestion.suggestedQuantity)}
                    </p>
                  </div>
                </div>
                {onReceiveProduct && (
                  <button type="button" onClick={() => onReceiveProduct(suggestion.product.id)}
                    className="btn-primary btn-md mt-2 w-full">
                    Receive Stock →
                  </button>
                )}
              </article>
            ))}

            {reorderSuggestions.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm font-medium lg:col-span-2" style={{ borderColor: "var(--border)", color: "var(--text-3)" }}>
                {t("pos.alerts.no_reorder_alerts")}
              </div>
            ) : null}
          </div>
        </div>

        <aside className="space-y-5">
          <section className="card p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg" style={{ backgroundColor: "var(--info-soft)", color: "var(--info-text)" }}>
                <Truck size={21} />
              </div>
              <div>
                <h2 className="text-lg font-bold" style={{ color: "var(--text)" }}>
                  {t("pos.alerts.supplier_reorder_title")}
                </h2>
                <p className="text-sm" style={{ color: "var(--text-3)" }}>
                  {t("pos.alerts.supplier_reorder_desc")}
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {reorderGroups.slice(0, 4).map((group) => (
                <div
                  key={group.supplierId ?? "unlinked"}
                  className="rounded-lg border p-3" style={{ borderColor: "var(--border)" }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-bold" style={{ color: "var(--text)" }}>
                      {group.supplierName}
                    </p>
                    <p className="text-sm font-bold" style={{ color: "var(--text-2)" }}>
                      {formatCurrency(group.totalCost)}
                    </p>
                  </div>
                  <p className="mt-1 text-xs font-semibold" style={{ color: "var(--text-3)" }}>
                    {t("pos.alerts.items_units", {
                      items: formatNumber(group.items.length),
                      units: formatNumber(group.items.reduce((sum, item) => sum + item.suggestedQuantity, 0))
                    })}
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => void copySupplierOrder(group)}
                      className="btn-default btn-md"
                    >
                      <Copy size={14} />
                      {t("pos.copy")}
                    </button>
                    <a
                      href={`https://wa.me/?text=${encodeURIComponent(
                        buildSupplierOrderMessage(group)
                      )}`}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-primary btn-md"
                    >
                      <MessageCircle size={14} />
                      {t("pos.whatsapp")}
                    </a>
                  </div>
                </div>
              ))}

              {reorderGroups.length === 0 ? (
                <div className="rounded-lg border border-dashed p-4 text-sm font-medium" style={{ borderColor: "var(--border)", color: "var(--text-3)" }}>
                  {t("pos.alerts.no_supplier_reorder")}
                </div>
              ) : null}
            </div>
          </section>
        </aside>
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-3">
        <section className="card p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg" style={{ backgroundColor: "var(--danger-soft)", color: "var(--danger-text)" }}>
              <CalendarClock size={21} />
            </div>
            <div>
              <h2 className="text-lg font-bold" style={{ color: "var(--text)" }}>
                {t("pos.alerts.expiry_title")}
              </h2>
              <p className="text-sm" style={{ color: "var(--text-3)" }}>
                {t("pos.alerts.expiry_desc")}
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {expiryAlerts.slice(0, 5).map((alert) => (
              <div
                key={alert.product.id}
                className={`rounded-lg border p-3 ${
                  alert.status === "Expired"
                    ? "border-rose-200 bg-rose-50 text-rose-900"
                    : "border-amber-200 bg-amber-50 text-amber-900"
                }`}
              >
                <p className="font-bold">{alert.product.name}</p>
                                <p className="text-sm font-medium opacity-80">
                  {alert.status === "Expired"
                    ? t("pos.alerts.expired")
                    : t("pos.alerts.days_left", { days: alert.daysUntilExpiry })} {" "}
                  {alert.batch?.expiryDate || alert.product.expiryDate
                    ? `- ${formatDate(
                        alert.batch?.expiryDate ?? alert.product.expiryDate ?? ""
                      )}`
                    : ""}
                </p>
            {alert.batch ? (
              <p className="mt-1 text-xs font-bold opacity-75">
                {t("pos.alerts.batch_info", { batch: alert.batch.batchNumber, qty: formatNumber(alert.batch.quantityRemaining) })}
              </p>
            ) : null}
            {onWriteOffProduct && (
              <button type="button" onClick={() => onWriteOffProduct(alert.product.id)}
                className="btn-default btn-sm mt-2">
                Write Off
              </button>
            )}
              </div>
            ))}

            {expiryAlerts.length === 0 ? (
              <div className="rounded-lg border border-dashed p-5 text-center text-sm font-medium" style={{ borderColor: "var(--border)", color: "var(--text-3)" }}>
                {t("pos.alerts.no_expiry_alerts")}
              </div>
            ) : null}
          </div>
        </section>

        <section className="card p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg" style={{ backgroundColor: "var(--surface-3)", color: "var(--text-2)" }}>
              <PackageX size={21} />
            </div>
            <div>
              <h2 className="text-lg font-bold" style={{ color: "var(--text)" }}>{t("pos.alerts.dead_stock_title")}</h2>
              <p className="text-sm" style={{ color: "var(--text-3)" }}>
                {t("pos.alerts.dead_stock_desc")}
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {deadStockItems.slice(0, 5).map((item) => (
              <div
                key={item.product.id}
                className="rounded-lg border p-3" style={{ borderColor: "var(--border)" }}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-bold" style={{ color: "var(--text)" }}>{item.product.name}</p>
                  <p className="font-bold" style={{ color: "var(--text-2)" }}>
                    {formatNumber(item.product.stock)}
                  </p>
                </div>
            <p className="mt-1 text-sm" style={{ color: "var(--text-3)" }}>
              {t("pos.alerts.value", { value: formatCurrency(item.product.stock * item.product.cost) })}
            </p>
            {onViewProduct && (
              <button type="button" onClick={() => onViewProduct(item.product.id)}
                className="btn-default btn-sm mt-2">
                View
              </button>
            )}
              </div>
            ))}

            {deadStockItems.length === 0 ? (
              <div className="rounded-lg border border-dashed p-5 text-center text-sm font-medium" style={{ borderColor: "var(--border)", color: "var(--text-3)" }}>
                {t("pos.alerts.no_dead_stock")}
              </div>
            ) : null}
          </div>
        </section>

        <section className="card p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg" style={{ backgroundColor: "var(--info-soft)", color: "var(--info-text)" }}>
              <Tag size={21} />
            </div>
            <div>
              <h2 className="text-lg font-bold" style={{ color: "var(--text)" }}>
                {t("pos.alerts.promos_title")}
              </h2>
              <p className="text-sm" style={{ color: "var(--text-3)" }}>
                {t("pos.alerts.promos_desc")}
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {promoSuggestions.slice(0, 5).map((promo) => (
              <div
                key={`${promo.reason}-${promo.product.id}`}
                className="rounded-lg border p-3" style={{ borderColor: "var(--info)", backgroundColor: "var(--info-soft)", color: "var(--info-text)" }}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-bold">{promo.product.name}</p>
                  <p className="rounded-lg px-2 py-1 text-xs font-bold" style={{ backgroundColor: "var(--surface)", color: "var(--info-text)" }}>
                    {promo.suggestedDiscountPercent}% off
                  </p>
                </div>
                <p className="mt-1 text-sm font-medium" style={{ color: "var(--info-text)" }}>
                  {promo.reason} - {promo.detail}
                </p>
              </div>
            ))}

            {promoSuggestions.length === 0 ? (
              <div className="rounded-lg border border-dashed p-5 text-center text-sm font-medium" style={{ borderColor: "var(--border)", color: "var(--text-3)" }}>
                {t("pos.alerts.no_promo_pressure")}
              </div>
            ) : null}
          </div>
        </section>
      </section>
    </>
  )
}
