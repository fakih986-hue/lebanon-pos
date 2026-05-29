import { Building2 } from "lucide-react"
import { formatCurrency } from "../../../features/pos/lib/currency"
import { formatDateKey, type AccountingSummary } from "../accounting.helpers"
import type { ExpenseCategory } from "../../../features/pos/services/expense.service"

type Props = {
  summary: AccountingSummary
  categoryTotals: { category: ExpenseCategory; total: number }[]
  categoryLabels: Record<ExpenseCategory, string>
}

export default function CashFlowPanel({
  summary,
  categoryTotals,
  categoryLabels,
}: Props) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
            <Building2 size={21} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-zinc-950">
              Cash flow
            </h2>
            <p className="text-sm text-zinc-500">
              {formatDateKey(summary.dateKey)}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3 p-4">
        <div className="rounded-lg bg-zinc-50 p-4">
          <div className="flex justify-between gap-3">
            <span className="text-zinc-500">Cash in</span>
            <strong className="text-lg">{formatCurrency(summary.cashIn)}</strong>
          </div>
          <div className="mt-3 flex justify-between gap-3 text-rose-700">
            <span>Cash out</span>
            <strong className="text-lg">-{formatCurrency(summary.cashOut)}</strong>
          </div>
          <div className="mt-3 flex justify-between gap-3 text-zinc-500">
            <span>Supplier payments</span>
            <strong className="text-lg text-zinc-900">{formatCurrency(summary.supplierPayments)}</strong>
          </div>
          <div className="mt-3 flex justify-between gap-3 border-t border-zinc-200 pt-3 font-bold">
            <span>Net cash movement</span>
            <span className="text-lg">{formatCurrency(summary.cashNet)}</span>
          </div>
        </div>

        <div className="rounded-lg border border-zinc-200 p-4">
          <h3 className="font-bold text-zinc-950">Expense mix today</h3>
          <div className="mt-3 space-y-2">
            {categoryTotals.map((item) => (
              <div key={item.category} className="flex items-center justify-between text-sm">
                <span className="font-semibold text-zinc-700">{categoryLabels[item.category]}</span>
                <strong className="text-zinc-950">{formatCurrency(item.total)}</strong>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
