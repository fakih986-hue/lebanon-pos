import { Calculator, ReceiptText, TrendingDown, TrendingUp } from "lucide-react"
import { formatCurrency } from "../../../features/pos/lib/currency"
import type { AccountingSummary } from "../accounting.helpers"

type Props = {
  summary: AccountingSummary
  todayExpensesCount: number
  todayClose: unknown
}

export default function AccountingKpiCards({
  summary,
  todayExpensesCount,
  todayClose,
}: Props) {
  return (
    <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-zinc-500">Net sales</p>
          <ReceiptText size={20} className="text-emerald-700" />
        </div>
        <p className="mt-3 text-3xl font-bold text-zinc-950">
          {formatCurrency(summary.netSales)}
        </p>
        <p className="mt-1 text-sm text-zinc-500">
          Gross {formatCurrency(summary.grossSales)} / Returns {formatCurrency(summary.refunds)}
        </p>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-zinc-500">Gross margin</p>
          <TrendingUp size={20} className="text-indigo-700" />
        </div>
        <p className="mt-3 text-3xl font-bold text-zinc-950">
          {formatCurrency(summary.grossMargin)}
        </p>
        <p className="mt-1 text-sm text-zinc-500">
          After returned item cost
        </p>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-zinc-500">Expenses</p>
          <TrendingDown size={20} className="text-rose-700" />
        </div>
        <p className="mt-3 text-3xl font-bold text-rose-700">
          {formatCurrency(summary.expenses)}
        </p>
        <p className="mt-1 text-sm text-zinc-500">
          {todayExpensesCount} entries today
        </p>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-zinc-500">Net profit</p>
          <Calculator size={20} className="text-amber-700" />
        </div>
        <p
          className={`mt-3 text-3xl font-bold ${
            summary.netProfit >= 0 ? "text-emerald-700" : "text-rose-700"
          }`}
        >
          {formatCurrency(summary.netProfit)}
        </p>
        <p className="mt-1 text-sm text-zinc-500">
          {todayClose ? "Day already closed" : "Ready to close today"}
        </p>
      </div>
    </section>
  )
}
