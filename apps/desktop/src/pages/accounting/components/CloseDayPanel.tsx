import { useState } from "react"
import { CheckCircle2, ClipboardList, MessageCircle } from "lucide-react"
import { formatCurrency } from "../../../features/pos/lib/currency"
import { getSettings } from "../../../features/pos/services/settings.service"
import { getLedgerTotals } from "../../../features/pos/services/customer.service"
import { openWhatsApp, openWhatsAppShare, dailySummaryMessage } from "../../../features/pos/lib/whatsapp"
import { formatDateKey, type AccountingSummary } from "../accounting.helpers"

type Props = {
  summary: AccountingSummary
  todayClose: boolean
  onCloseDay: () => void
  canManageAccounting: boolean
}

export default function CloseDayPanel({
  summary,
  todayClose,
  onCloseDay,
  canManageAccounting,
}: Props) {
  const [closeNote, setCloseNote] = useState("")
  const [countedCash, setCountedCash] = useState("")

  return (
    <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-zinc-950 text-white">
            <ClipboardList size={21} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-zinc-950">
              Daily closing statement
            </h2>
            <p className="text-sm text-zinc-500">
              {formatDateKey(summary.dateKey)}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <div className="space-y-2 rounded-lg border border-zinc-200 p-4 text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-zinc-500">Gross sales</span>
            <strong>{formatCurrency(summary.grossSales)}</strong>
          </div>
          <div className="flex justify-between gap-3 text-rose-700">
            <span>Refunds</span>
            <strong>-{formatCurrency(summary.refunds)}</strong>
          </div>
          <div className="flex justify-between gap-3 border-t border-zinc-200 pt-2">
            <span className="text-zinc-500">Net sales</span>
            <strong>{formatCurrency(summary.netSales)}</strong>
          </div>
          <div className="flex justify-between gap-3 text-zinc-500">
            <span>Cost of goods</span>
            <strong className="text-zinc-900">
              -{formatCurrency(summary.costOfGoods)}
            </strong>
          </div>
          <div className="flex justify-between gap-3 border-t border-zinc-200 pt-2 font-bold text-zinc-950">
            <span>Gross margin</span>
            <span>{formatCurrency(summary.grossMargin)}</span>
          </div>
        </div>

        <div className="space-y-2 rounded-lg border border-zinc-200 p-4 text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-zinc-500">Operating expenses</span>
            <strong className="text-rose-700">
              -{formatCurrency(summary.expenses)}
            </strong>
          </div>
          <div className="flex justify-between gap-3 border-t border-zinc-200 pt-2 text-lg font-bold">
            <span>Net profit</span>
            <span
              className={
                summary.netProfit >= 0 ? "text-emerald-700" : "text-rose-700"
              }
            >
              {formatCurrency(summary.netProfit)}
            </span>
          </div>
          <div className="mt-3 rounded-lg bg-zinc-50 p-3">
            <div className="flex justify-between gap-3">
              <span className="text-zinc-500">Cash in</span>
              <strong>{formatCurrency(summary.cashIn)}</strong>
            </div>
            <div className="mt-2 flex justify-between gap-3 text-rose-700">
              <span>Cash out</span>
              <strong>-{formatCurrency(summary.cashOut)}</strong>
            </div>
            <div className="mt-2 flex justify-between gap-3 text-zinc-500">
              <span>Supplier payments</span>
              <strong className="text-zinc-900">
                {formatCurrency(summary.supplierPayments)}
              </strong>
            </div>
            <div className="mt-2 flex justify-between gap-3 border-t border-zinc-200 pt-2 font-bold">
              <span>Cash movement</span>
              <span>{formatCurrency(summary.cashNet)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-zinc-200 p-4">
        {(() => {
          const expected = summary.cashNet
          const counted = parseFloat(countedCash)
          const hasCount = countedCash.trim() !== "" && !isNaN(counted)
          const variance = hasCount ? counted - expected : 0
          const matched = Math.abs(variance) < 0.01
          return (
            <div className="mb-3 rounded-lg border p-4" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
              <p className="text-[13px] font-bold mb-3" style={{ color: "var(--text)" }}>Cash reconciliation</p>
              <div className="flex items-center justify-between mb-2 text-sm">
                <span style={{ color: "var(--text-2)" }}>Expected in drawer</span>
                <strong style={{ color: "var(--text)" }}>{formatCurrency(expected)}</strong>
              </div>
              <label className="block">
                <span className="block text-[12px] font-semibold mb-1.5" style={{ color: "var(--text-2)" }}>
                  Counted cash (actual in drawer)
                </span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={countedCash}
                  onChange={(e) => setCountedCash(e.target.value)}
                  placeholder={expected.toFixed(2)}
                  className="input w-full text-right font-bold"
                  style={{ height: 44, fontSize: 16 }}
                />
              </label>
              {hasCount && (
                <div
                  className="mt-3 flex items-center justify-between rounded-lg px-3 py-2.5"
                  style={matched
                    ? { background: "var(--brand-soft)", color: "var(--brand-text)" }
                    : { background: "var(--rose-soft)", color: "var(--rose-text)" }
                  }
                >
                  <span className="text-[13px] font-bold">
                    {matched ? "✓ Balanced" : variance > 0 ? "Over (extra cash)" : "Short (missing cash)"}
                  </span>
                  <strong className="text-[15px]">
                    {variance > 0 ? "+" : ""}{formatCurrency(variance)}
                  </strong>
                </div>
              )}
            </div>
          )
        })()}

        <textarea
          value={closeNote}
          onChange={(event) => setCloseNote(event.target.value)}
          rows={3}
          placeholder="Closing note"
          className="w-full resize-none rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 text-sm font-medium outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
        />
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-semibold text-zinc-500">Daily profit and expense summary.</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                const s = getSettings()
                const msg = dailySummaryMessage({
                  storeName: s.storeName,
                  date: formatDateKey(summary.dateKey),
                  netSales: summary.netSales,
                  grossMargin: summary.grossMargin,
                  expenses: summary.expenses,
                  netProfit: summary.netProfit,
                  cashIn: summary.cashIn,
                  outstanding: getLedgerTotals().outstanding,
                })
                if (s.whatsAppAdmin) openWhatsApp(s.whatsAppAdmin, msg)
                else openWhatsAppShare(msg)
              }}
              className="flex h-11 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-bold transition hover:opacity-80"
              style={{ borderColor: "var(--border)", color: "#25D366" }}
            >
              <MessageCircle size={16} />
              WhatsApp summary
            </button>
            <button
              type="button"
              onClick={() => onCloseDay()}
              disabled={!canManageAccounting}
              className="flex h-11 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-4 text-sm font-bold text-white transition hover:bg-zinc-800 disabled:bg-zinc-200 disabled:text-zinc-400"
            >
              <CheckCircle2 size={17} />
              {todayClose ? "Reclose Today" : "Close Today"}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
