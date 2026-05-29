import { formatCurrency } from "../../../features/pos/lib/currency"
import { formatDateTime } from "../../../features/pos/lib/helpers"
import type {
  Expense,
  ExpenseCategory,
  ExpensePaymentMethod,
} from "../../../features/pos/services/expense.service"

type Props = {
  expenses: Expense[]
  categoryLabels: Record<ExpenseCategory, string>
  paymentMethodLabels: Record<ExpensePaymentMethod, string>
}

export default function ExpensesPanel({
  expenses,
  categoryLabels,
  paymentMethodLabels,
}: Props) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 p-4">
        <h2 className="text-xl font-bold text-zinc-950">
          Recent expenses
        </h2>
        <p className="text-sm text-zinc-500">
          Supplier bills and operating costs.
        </p>
      </div>
      <div className="space-y-3 p-4">
        {expenses.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm font-medium text-zinc-500">
            No expenses recorded yet.
          </p>
        ) : null}

        {expenses.map((expense) => (
          <article
            key={expense.id}
            className="rounded-lg border border-zinc-200 bg-white p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-bold text-zinc-950">
                  {expense.vendor}
                </p>
                <p className="mt-1 text-sm text-zinc-500">
                  {categoryLabels[expense.category]} - {formatDateTime(expense.createdAt)}
                </p>
              </div>
              <strong className="shrink-0 text-rose-700">
                {formatCurrency(expense.amount)}
              </strong>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
              <span className="rounded-lg bg-zinc-100 px-2 py-1 text-zinc-700">
                {paymentMethodLabels[expense.paymentMethod]}
              </span>
              {expense.invoiceNumber ? (
                <span className="rounded-lg bg-zinc-100 px-2 py-1 text-zinc-700">
                  {expense.invoiceNumber}
                </span>
              ) : null}
              {expense.shiftNumber ? (
                <span className="rounded-lg bg-zinc-100 px-2 py-1 text-zinc-700">
                  {expense.shiftNumber}
                </span>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
