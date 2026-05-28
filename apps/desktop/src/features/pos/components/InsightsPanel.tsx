import { useMemo } from "react"
import { Eye, ReceiptText } from "lucide-react"

import { useI18n } from "@lebanonpos/shared"
import { formatCurrency, formatNumber } from "../lib/currency"
import {
  formatDate,
  getSaleQuantity,
  paymentIcons,
} from "../lib/salesHelpers"
import type { Sale } from "../services/sales.service"

const PAYMENT_COLORS: Record<string, string> = {
  Cash: "#10b981",
  Card: "#6366f1",
  Wallet: "#8b5cf6",
  Debt: "#f59e0b",
}

function MiniBarChart({ data }: { data: Array<{ label: string; value: number }> }) {
  const max = Math.max(...data.map((d) => d.value), 1)
  return (
    <div className="flex items-end gap-[3px] h-28 mt-3">
      {data.map((d) => {
        const pct = (d.value / max) * 100
        return (
          <div key={d.label} className="flex-1 flex flex-col items-center gap-0.5 group relative">
            <div
              className="w-full rounded-t transition-all duration-300 hover:opacity-80 cursor-default"
              style={{ height: `${Math.max(pct, 3)}%`, background: "linear-gradient(180deg,#818cf8,#4f46e5)" }}
            />
            <div className="absolute -top-9 left-1/2 -translate-x-1/2 bg-zinc-900 text-white text-[10px] font-medium px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-10 shadow-lg">
              {formatCurrency(d.value)}
            </div>
            <span className="text-[8px] text-zinc-400 mt-0.5 truncate max-w-full px-0.5 font-medium">{d.label}</span>
          </div>
        )
      })}
    </div>
  )
}

export default function InsightsPanel({
  filteredSales,
  paymentMix,
  onViewSale,
  onExportCsv,
}: {
  filteredSales: Sale[]
  paymentMix: Record<string, number>
  onViewSale: (sale: Sale) => void
  onExportCsv?: () => void
}) {
  const { t } = useI18n()

  // Revenue trend by day (last 14 days shown from current filtered set)
  const trendData = useMemo(() => {
    const map = new Map<string, number>()
    for (const sale of filteredSales) {
      const day = new Date(sale.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      map.set(day, (map.get(day) ?? 0) + sale.total)
    }
    return Array.from(map.entries())
      .slice(-14)
      .map(([label, value]) => ({ label, value }))
  }, [filteredSales])

  // Top products by revenue
  const topProducts = useMemo(() => {
    const map = new Map<string, number>()
    for (const sale of filteredSales) {
      for (const item of sale.items) {
        map.set(item.name, (map.get(item.name) ?? 0) + item.total)
      }
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([label, value]) => ({ label, value }))
  }, [filteredSales])

  const totalRevenue = filteredSales.reduce((s, sale) => s + sale.total, 0)
  const avgTicket = filteredSales.length > 0 ? totalRevenue / filteredSales.length : 0

  return (
    <section className="mt-4 space-y-4">
      {/* Summary KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: t("pos.insights.total_sales"), value: filteredSales.length },
          { label: t("pos.insights.total_revenue"), value: formatCurrency(totalRevenue) },
          { label: t("pos.insights.avg_ticket"), value: formatCurrency(avgTicket) },
          { label: t("pos.insights.payment_methods"), value: Object.keys(paymentMix).length },
        ].map((kpi) => (
          <div key={kpi.label} className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{kpi.label}</p>
            <p className="mt-2 text-2xl font-bold text-zinc-950">{kpi.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* Revenue trend chart */}
        <div className="xl:col-span-2 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-bold text-zinc-950">{t("pos.insights.revenue_trend")}</h2>
          {trendData.length > 0 ? (
            <MiniBarChart data={trendData} />
          ) : (
            <p className="mt-6 text-center text-sm text-zinc-400">{t("pos.insights.no_sales")}</p>
          )}
        </div>

        {/* Payment mix */}
        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-bold text-zinc-950">{t("pos.insights.payment_mix")}</h2>
          <div className="mt-3 space-y-2">
            {Object.entries(paymentMix).map(([method, amount]) => {
              const pct = totalRevenue > 0 ? (amount / totalRevenue) * 100 : 0
              return (
                <div key={method}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-zinc-700">{method}</span>
                    <span className="text-sm font-bold text-zinc-950">{formatCurrency(amount)}</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-zinc-100">
                    <div
                      className="h-2 rounded-full transition-all"
                      style={{ width: `${pct}%`, backgroundColor: PAYMENT_COLORS[method] ?? "#6b7280" }}
                    />
                  </div>
                </div>
              )
            })}
            {Object.keys(paymentMix).length === 0 && (
              <p className="text-sm text-zinc-400">{t("pos.insights.no_sales")}</p>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* Top products */}
        <div className="xl:col-span-1 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-bold text-zinc-950">{t("pos.insights.top_products")}</h2>
          <div className="mt-3 space-y-2">
            {topProducts.map(({ label, value }, i) => (
              <div key={label} className="flex items-center gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-800">{label}</span>
                <span className="text-sm font-bold text-zinc-950">{formatCurrency(value)}</span>
              </div>
            ))}
            {topProducts.length === 0 && <p className="text-sm text-zinc-400">{t("pos.insights.no_sales")}</p>}
          </div>
        </div>

        {/* Sales table */}
        <div className="xl:col-span-2 rounded-lg border border-zinc-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
            <h2 className="text-base font-bold text-zinc-950">{t("pos.insights.all_transactions")}</h2>
            {onExportCsv && (
              <button
                type="button"
                onClick={onExportCsv}
                className="flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-xs font-bold text-zinc-700 transition hover:bg-zinc-50"
              >
                ↓ {t("pos.insights.export_csv")}
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="text-left text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">
                  <th className="border-b border-zinc-200 px-4 py-3">{t("pos.insights.receipt")}</th>
                  <th className="border-b border-zinc-200 px-4 py-3">{t("pos.insights.payment")}</th>
                  <th className="border-b border-zinc-200 px-4 py-3 hidden sm:table-cell">{t("pos.insights.customer")}</th>
                  <th className="border-b border-zinc-200 px-4 py-3 text-right">{t("pos.insights.items")}</th>
                  <th className="border-b border-zinc-200 px-4 py-3 text-right">{t("pos.insights.total")}</th>
                  <th className="border-b border-zinc-200 px-4 py-3 hidden sm:table-cell">{t("pos.insights.time")}</th>
                  <th className="border-b border-zinc-200 px-4 py-3 text-right">{t("pos.insights.action")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredSales.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-sm font-medium text-zinc-500">
                      {t("pos.insights.no_sales")}
                    </td>
                  </tr>
                ) : null}
                {filteredSales.map((sale) => {
                  const Icon = paymentIcons[sale.paymentMethod]
                  return (
                    <tr key={sale.id} className="hover:bg-zinc-50">
                      <td className="border-b border-zinc-100 px-4 py-3">
                        <span className="inline-flex items-center gap-2 font-bold text-zinc-950">
                          <ReceiptText size={15} />
                          {sale.saleNumber}
                        </span>
                      </td>
                      <td className="border-b border-zinc-100 px-4 py-3">
                        <span className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-2 py-1 text-xs font-bold text-zinc-700">
                          <Icon size={14} />
                          {sale.paymentMethod}
                        </span>
                      </td>
                      <td className="border-b border-zinc-100 px-4 py-3 text-zinc-600 hidden sm:table-cell">
                        {sale.customerName ?? "-"}
                      </td>
                      <td className="border-b border-zinc-100 px-4 py-3 text-right font-semibold text-zinc-800">
                        {formatNumber(getSaleQuantity(sale))}
                      </td>
                      <td className="border-b border-zinc-100 px-4 py-3 text-right font-bold text-zinc-950">
                        {formatCurrency(sale.total)}
                      </td>
                      <td className="border-b border-zinc-100 px-4 py-3 text-zinc-500 hidden sm:table-cell">
                        {formatDate(sale.createdAt)}
                      </td>
                      <td className="border-b border-zinc-100 px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => onViewSale(sale)}
                          className="inline-flex h-9 items-center gap-2 rounded-lg bg-zinc-950 px-3 text-xs font-bold text-white transition hover:bg-zinc-800"
                        >
                          <Eye size={14} />
                          {t("pos.insights.receipt")}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  )
}
