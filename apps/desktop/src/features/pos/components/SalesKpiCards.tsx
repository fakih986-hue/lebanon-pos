import { useI18n } from "@lebanonpos/shared"
import { formatCurrency, formatLbpCurrency, formatNumber, usdToLbp } from "../lib/currency"
import { getSettings } from "../services/settings.service"

export default function SalesKpiCards({
  metrics,
}: {
  metrics: {
    todayGross: number
    todayNetRevenue: number
    todayRefunds: number
    todayTransactions: number
  }
}) {
  const { t } = useI18n()
  const rate = getSettings().usdToLbpRate
  return (
    <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <div className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm sm:p-4">
        <p className="text-sm font-medium text-zinc-500">{t("pos.sales_kpi.gross_sales")}</p>
        <p className="mt-2 text-xl font-bold text-zinc-950 sm:text-2xl">
          {formatCurrency(metrics.todayGross)}
        </p>
        <p className="mt-0.5 text-xs" style={{ color: "var(--text-3)" }}>
          {formatLbpCurrency(usdToLbp(metrics.todayGross, rate))}
        </p>
      </div>
      <div className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm sm:p-4">
        <p className="text-sm font-medium text-zinc-500">{t("pos.sales_kpi.net_paid")}</p>
        <p className="mt-2 text-xl font-bold sm:text-2xl" style={{ color: "var(--success)" }}>
          {formatCurrency(metrics.todayNetRevenue)}
        </p>
        <p className="mt-0.5 text-xs" style={{ color: "var(--text-3)" }}>
          {formatLbpCurrency(usdToLbp(metrics.todayNetRevenue, rate))}
        </p>
      </div>
      <div className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm sm:p-4">
        <p className="text-sm font-medium text-zinc-500">{t("pos.sales_kpi.refunds")}</p>
        <p className="mt-2 text-xl font-bold text-rose-700 sm:text-2xl">
          {formatCurrency(metrics.todayRefunds)}
        </p>
        <p className="mt-0.5 text-xs" style={{ color: "var(--text-3)" }}>
          {formatLbpCurrency(usdToLbp(metrics.todayRefunds, rate))}
        </p>
      </div>
      <div className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm sm:p-4">
        <p className="text-sm font-medium text-zinc-500">{t("pos.sales_kpi.transactions")}</p>
        <p className="mt-2 text-xl font-bold text-zinc-950 sm:text-2xl">
          {formatNumber(metrics.todayTransactions)}
        </p>
      </div>
    </section>
  )
}
