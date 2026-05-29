import { CheckCircle2 } from "lucide-react"
import { formatCurrency } from "../../../features/pos/lib/currency"
import { formatDateKey } from "../accounting.helpers"
import type { DailyClose } from "../../../features/pos/services/dailyClose.service"

type Props = {
  dailyCloses: DailyClose[]
  maxItems?: number
}

export default function HistoryPanel({ dailyCloses, maxItems = 20 }: Props) {
  const items = dailyCloses.slice(0, maxItems)

  return (
    <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
            <CheckCircle2 size={21} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-zinc-950">
              Close history
            </h2>
            <p className="text-sm text-zinc-500">Daily profit snapshots.</p>
          </div>
        </div>
      </div>

      <div className="space-y-3 p-4">
        {items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm font-medium text-zinc-500">
            No closed days yet.
          </p>
        ) : null}

        {items.map((dailyClose) => (
          <article
            key={dailyClose.id}
            className="rounded-lg border border-zinc-200 p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-bold text-zinc-950">
                  {formatDateKey(dailyClose.dateKey)}
                </p>
                <p className="mt-1 text-xs font-semibold text-zinc-500">
                  {dailyClose.closedBy}
                </p>
              </div>
              <strong
                className={
                  dailyClose.netProfit >= 0
                    ? "text-emerald-700"
                    : "text-rose-700"
                }
              >
                {formatCurrency(dailyClose.netProfit)}
              </strong>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
