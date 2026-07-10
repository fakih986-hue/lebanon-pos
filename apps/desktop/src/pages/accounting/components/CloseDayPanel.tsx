import { useState } from "react"
import { CheckCircle2, ClipboardList, CloudOff, MessageCircle, Printer } from "lucide-react"
import { formatCurrency, formatLbpCurrency, usdToLbp } from "../../../features/pos/lib/currency"
import { getSettings } from "../../../features/pos/services/settings.service"
import { getLedgerTotals } from "../../../features/pos/services/customer.service"
import { openWhatsApp, openWhatsAppShare, dailySummaryMessage } from "../../../features/pos/lib/whatsapp"
import { formatDateKey, type AccountingSummary } from "../accounting.helpers"
import { getUnsyncedCount } from "../../../features/pos/services/sync.service"

type Props = {
  summary: AccountingSummary
  todayClose: boolean
  onCloseDay: (note: string) => void
  canManageAccounting: boolean
  closeWarnings?: string[]
}

export default function CloseDayPanel({
  summary,
  todayClose,
  onCloseDay,
  canManageAccounting,
  closeWarnings = [],
}: Props) {
  const [closeNote, setCloseNote] = useState("")
  const [countedCash, setCountedCash] = useState("")
  const rate = getSettings().usdToLbpRate
  const unsyncedCount = getUnsyncedCount()
  const lbp = (v: number) => formatLbpCurrency(usdToLbp(v, rate))

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
          {todayClose && (
            <span
              className="ms-auto inline-flex rotate-[-4deg] items-center gap-1.5 rounded-lg border-2 px-3 py-1.5 text-[12px] font-black uppercase tracking-[0.14em]"
              style={{ borderColor: "var(--success)", color: "var(--success-text)", background: "var(--success-soft)" }}
            >
              <CheckCircle2 size={14} />
              Day sealed
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <div className="space-y-2 rounded-lg border border-zinc-200 p-4 text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-zinc-500">Gross sales</span>
            <div className="text-end"><strong>{formatCurrency(summary.grossSales)}</strong><div className="text-[10px] text-zinc-400">{lbp(summary.grossSales)}</div></div>
          </div>
          <div className="flex justify-between gap-3 text-rose-700">
            <span>Refunds</span>
            <div className="text-end"><strong>-{formatCurrency(summary.refunds)}</strong><div className="text-[10px] text-rose-400">{lbp(summary.refunds)}</div></div>
           </div>
           <div className="flex justify-between gap-3 border-t border-zinc-200 pt-2">
             <span className="text-zinc-500">Net sales</span>
             <div className="text-end"><strong>{formatCurrency(summary.netSales)}</strong><div className="text-[10px] text-zinc-400">{lbp(summary.netSales)}</div></div>
          </div>
          <div className="flex justify-between gap-3 text-zinc-500">
            <span>Cost of goods</span>
            <strong className="text-zinc-900">
              -{formatCurrency(summary.costOfGoods)}
            </strong>
          </div>
          <div className="flex justify-between gap-3 border-t border-zinc-200 pt-2 font-bold text-zinc-950">
            <span>Gross margin</span>
            <div className="text-end"><span>{formatCurrency(summary.grossMargin)}</span><div className="text-[10px] text-zinc-400">{lbp(summary.grossMargin)}</div></div>
          </div>
        </div>

        <div className="space-y-2 rounded-lg border border-zinc-200 p-4 text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-zinc-500">Operating expenses</span>
            <div className="text-end">
              <strong className="text-rose-700">-{formatCurrency(summary.expenses)}</strong>
              <div className="text-[10px] text-rose-400">{lbp(summary.expenses)}</div>
            </div>
          </div>
          <div className="flex justify-between gap-3 border-t border-zinc-200 pt-2 text-lg font-bold">
            <span>Net profit</span>
            <div className="text-end"><span
              className={
                summary.netProfit >= 0 ? "text-[var(--success)]" : "text-rose-700"
              }
            >
              {formatCurrency(summary.netProfit)}
            </span>
            <div className="text-[10px] text-zinc-400">{lbp(summary.netProfit)}</div></div>
          </div>
          <div className="mt-3 rounded-lg bg-zinc-50 p-3">
            <div className="flex justify-between gap-3">
              <span className="text-zinc-500">Cash in</span>
              <div className="text-end">
                <strong>{formatCurrency(summary.cashIn)}</strong>
                <div className="text-[10px] text-zinc-400">{lbp(summary.cashIn)}</div>
              </div>
            </div>
            <div className="mt-2 flex justify-between gap-3 text-rose-700">
              <span>Cash out</span>
              <div className="text-end">
                <strong>-{formatCurrency(summary.cashOut)}</strong>
                <div className="text-[10px] text-rose-400">{lbp(summary.cashOut)}</div>
              </div>
            </div>
            <div className="mt-2 flex justify-between gap-3 text-zinc-500">
              <span>Supplier payments</span>
              <div className="text-end">
                <strong className="text-zinc-900">{formatCurrency(summary.supplierPayments)}</strong>
                <div className="text-[10px] text-zinc-400">{lbp(summary.supplierPayments)}</div>
              </div>
            </div>
            <div className="mt-2 flex justify-between gap-3 border-t border-zinc-200 pt-2 font-bold">
              <span>Cash movement</span>
              <div className="text-end">
                <span>{formatCurrency(summary.cashNet)}</span>
                <div className="text-[10px] text-zinc-400 font-normal">{lbp(summary.cashNet)}</div>
              </div>
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
                <div className="text-end">
                  <strong style={{ color: "var(--text)" }}>{formatCurrency(expected)}</strong>
                  <div className="text-[10px] text-zinc-400">{lbp(expected)}</div>
                </div>
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
                    className="input w-full text-end font-bold"
                    style={{ height: 44, fontSize: 16 }}
                    aria-label="Counted cash in drawer"
                  />
              </label>
              {hasCount && (
                <div
                  className="mt-3 flex items-center justify-between rounded-lg px-3 py-2.5"
                  role="status"
                  aria-live="polite"
                  style={matched
                    ? { background: "var(--success-soft)", color: "var(--success-text)", border: "1px solid var(--success)" }
                    : { background: "var(--danger-soft)", color: "var(--danger-text)", border: "1px solid var(--danger)" }
                  }
                >
                  <span className="text-[13px] font-bold">
                    {matched ? "✓ Balanced" : variance > 0 ? "Over (extra cash)" : "Short (missing cash)"}
                  </span>
                  <strong className="text-[15px]">
                    {variance > 0 ? "+" : ""}{formatCurrency(variance)}
                  </strong>
                  <span className="text-[10px] ms-1.5">{lbp(variance)}</span>
                </div>
              )}
            </div>
          )
        })()}

        {unsyncedCount > 0 && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border px-4 py-3 text-[13px] font-bold"
            role="alert"
            style={{ borderColor: "var(--amber)", background: "var(--amber-soft)", color: "var(--amber-text)" }}>
            <CloudOff size={16} />
            <span>{unsyncedCount} unsynced operation{unsyncedCount > 1 ? "s" : ""} — close will record this count but data won't reach the cloud until synced.</span>
          </div>
        )}

        {closeWarnings.length > 0 && (
          <div className="mb-3 rounded-lg border px-4 py-3 text-[13px] font-bold"
            role="alert"
            style={{ borderColor: "var(--amber)", background: "var(--amber-soft)", color: "var(--amber-text)" }}>
            <div className="mb-1 flex items-center gap-2">
              <CloudOff size={16} />
              Close review needed
            </div>
            <ul className="list-disc space-y-1 ps-5 font-semibold">
              {closeWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        )}

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
              aria-label="Share daily summary via WhatsApp"
            >
              <MessageCircle size={16} />
              WhatsApp summary
            </button>
            <button
              type="button"
              onClick={() => {
                const w = window.open("", "_blank", "width=600,height=800")
                if (!w) return
                const s = getSettings()
                const lines = [
                  `<h1>${s.storeName}</h1><p>${s.branchName} · ${formatDateKey(summary.dateKey)}</p><hr>`,
                  `<table><tr><td>Gross sales</td><td>${formatCurrency(summary.grossSales)}</td></tr>`,
                  `<tr><td>Refunds</td><td>-${formatCurrency(summary.refunds)}</td></tr>`,
                  `<tr><td>Net sales</td><td>${formatCurrency(summary.netSales)}</td></tr>`,
                  `<tr><td>Gross margin</td><td>${formatCurrency(summary.grossMargin)}</td></tr>`,
                  `<tr><td>Expenses</td><td>-${formatCurrency(summary.expenses)}</td></tr>`,
                  `<tr><td>Net profit</td><td>${formatCurrency(summary.netProfit)}</td></tr>`,
                  `<tr><td>Cash movement</td><td>${formatCurrency(summary.cashNet)}</td></tr>`,
                  `</table><hr><p>Thank you — شكراً</p>`,
                ].join("")
                w.document.write(`<html><head><title>Daily Close</title><style>body{font-family:Arial;padding:20px;max-width:600px;margin:auto}h1{margin:0}table{width:100%;border-collapse:collapse}td{padding:6px 4px;border-bottom:1px solid #ddd}td:last-child{text-align:right;font-weight:700}hr{border:none;border-top:1px solid #ddd;margin:12px 0}</style></head><body>${lines}</body></html>`)
                w.document.close(); w.focus(); setTimeout(() => w.print(), 250)
              }}
              className="flex h-11 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-bold transition hover:opacity-80"
              style={{ borderColor: "var(--border)", color: "var(--text-2)" }}
              aria-label="Print daily report"
            >
              <Printer size={16} />
              Print Report
            </button>
              <button
                type="button"
                onClick={() => onCloseDay(closeNote)}
                disabled={!canManageAccounting}
                className="btn-primary btn-md h-11 px-5"
                aria-label={todayClose ? "Reclose today" : "Close today"}
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
