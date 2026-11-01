import { CheckCircle2 } from "lucide-react"
import { useI18n } from "@lebanonpos/shared"
import { formatCost } from "../../../features/pos/lib/cost"
import { userCan } from "../../../features/pos/services/security.service"
import { formatDateKey } from "../accounting.helpers"
import type { DailyClose } from "../../../features/pos/services/dailyClose.service"

type Props = {
  dailyCloses: DailyClose[]
  maxItems?: number
}

export default function HistoryPanel({ dailyCloses, maxItems = 20 }: Props) {
  const { t } = useI18n()
  const items = dailyCloses.slice(0, maxItems)
  // Absent when a cost was unavailable at close; pulled rows carry decimals as strings.
  const netProfitOf = (c: DailyClose) => (c.netProfit == null ? undefined : Number(c.netProfit))
  const showCost = userCan("reports.cost")
  // the register's device tells registers apart (they may share the label REG-001); a close from the server
  // names it in its scope
  const deviceOf = (c: DailyClose) => c.deviceId ?? c.scope?.match(/^device:([^|]+)/)?.[1]

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
                <p className="mt-0.5 text-[11px] font-mono text-zinc-400">
                  {dailyClose.registerId && <>Reg: {dailyClose.registerId}</>}
                  {dailyClose.registerId && deviceOf(dailyClose) && <> · </>}
                  {deviceOf(dailyClose) && <>Dev: {deviceOf(dailyClose)}</>}
                </p>
                {/* a corrected close: the report uses this revision; the earlier one is kept */}
                {(dailyClose.revision ?? 1) > 1 && (
                  <p className="mt-0.5 text-[11px] font-semibold" style={{ color: "var(--warning)" }}>
                    {t("pos.accounting.close_revision", { n: dailyClose.revision ?? 1 })}
                  </p>
                )}
              </div>
              {showCost && (
                <div className="text-end">
                  <strong
                    style={{ color: netProfitOf(dailyClose) === undefined ? "var(--text-3)" : netProfitOf(dailyClose)! >= 0 ? "var(--success)" : "var(--rose)" }}
                  >
                    {formatCost(netProfitOf(dailyClose), t("pos.not_available"))}
                  </strong>
                  {/* unknown, not zero: the server could not value every sale and refund of the day */}
                  {dailyClose.costStatus === "incomplete" && (
                    <p className="mt-0.5 text-[11px] font-semibold" style={{ color: "var(--text-3)" }}>{t("pos.accounting.valuation_incomplete")}</p>
                  )}
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
