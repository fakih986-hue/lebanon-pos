import { formatCurrency, formatNumber } from "../lib/currency"

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
  return (
    <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <div className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm sm:p-4">
        <p className="text-sm font-medium text-zinc-500">Gross sales</p>
        <p className="mt-2 text-xl font-bold text-zinc-950 sm:text-2xl">
          {formatCurrency(metrics.todayGross)}
        </p>
      </div>
      <div className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm sm:p-4">
        <p className="text-sm font-medium text-zinc-500">Net paid</p>
        <p className="mt-2 text-xl font-bold text-emerald-700 sm:text-2xl">
          {formatCurrency(metrics.todayNetRevenue)}
        </p>
      </div>
      <div className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm sm:p-4">
        <p className="text-sm font-medium text-zinc-500">Refunds</p>
        <p className="mt-2 text-xl font-bold text-rose-700 sm:text-2xl">
          {formatCurrency(metrics.todayRefunds)}
        </p>
      </div>
      <div className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm sm:p-4">
        <p className="text-sm font-medium text-zinc-500">Transactions</p>
        <p className="mt-2 text-xl font-bold text-zinc-950 sm:text-2xl">
          {formatNumber(metrics.todayTransactions)}
        </p>
      </div>
    </section>
  )
}
