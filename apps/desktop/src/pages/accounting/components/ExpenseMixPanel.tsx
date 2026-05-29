import { Building2 } from "lucide-react"
import { formatCurrency } from "../../../features/pos/lib/currency"
import type { ExpenseCategory } from "../../../features/pos/services/expense.service"

type Props = {
  categoryTotals: { category: ExpenseCategory; total: number }[]
  categoryLabels: Record<ExpenseCategory, string>
}

export default function ExpenseMixPanel({ categoryTotals, categoryLabels }: Props) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
          <Building2 size={21} />
        </div>
        <div>
          <h2 className="text-lg font-bold text-zinc-950">
            Expense mix
          </h2>
          <p className="text-sm text-zinc-500">Today by category.</p>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {categoryTotals.map((item) => (
          <div
            key={item.category}
            className="flex items-center justify-between rounded-lg bg-zinc-50 p-3 text-sm"
          >
            <span className="font-semibold text-zinc-700">
              {categoryLabels[item.category]}
            </span>
            <strong className="text-zinc-950">
              {formatCurrency(item.total)}
            </strong>
          </div>
        ))}
      </div>
    </section>
  )
}
