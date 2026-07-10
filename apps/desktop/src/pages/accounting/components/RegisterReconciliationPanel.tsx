import { AlertTriangle, CheckCircle2, MonitorSmartphone } from "lucide-react"
import { useMemo, useState } from "react"
import { formatCurrency } from "../../../features/pos/lib/currency"
import { getSettings } from "../../../features/pos/services/settings.service"
import type { RegisterCashTotals, RegisterShiftSummary } from "../../../features/pos/services/shift.service"

type Props = {
  summaries: RegisterShiftSummary[]
  totals: RegisterCashTotals
}

function shortDeviceId(deviceId: string) {
  if (!deviceId || deviceId === "unknown") return "unknown"
  return deviceId.length > 14 ? `${deviceId.slice(0, 8)}...${deviceId.slice(-4)}` : deviceId
}

function registerLabel(registerId: string) {
  const settings = getSettings()
  if (settings.registerId === registerId && settings.registerName) {
    return `${settings.registerName} (${registerId})`
  }
  return registerId
}

export default function RegisterReconciliationPanel({ summaries, totals }: Props) {
  const [registerFilter, setRegisterFilter] = useState("ALL")
  const registerOptions = useMemo(
    () => Array.from(new Set(summaries.map((summary) => summary.registerId))).sort(),
    [summaries]
  )
  const visibleSummaries = registerFilter === "ALL"
    ? summaries
    : summaries.filter((summary) => summary.registerId === registerFilter)

  return (
    <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
            <MonitorSmartphone size={21} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-zinc-950">Register reconciliation</h2>
            <p className="text-sm text-zinc-500">Per-device cash position before daily close.</p>
          </div>
        </div>
        {registerOptions.length > 1 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setRegisterFilter("ALL")}
              aria-pressed={registerFilter === "ALL"}
              className={`rounded-lg border px-3 py-1.5 text-xs font-black ${registerFilter === "ALL" ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-200 text-zinc-600"}`}
            >
              All registers
            </button>
            {registerOptions.map((registerId) => (
              <button
                key={registerId}
                type="button"
                onClick={() => setRegisterFilter(registerId)}
                aria-pressed={registerFilter === registerId}
                className={`rounded-lg border px-3 py-1.5 text-xs font-black ${registerFilter === registerId ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-200 text-zinc-600"}`}
              >
                {registerLabel(registerId)}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="grid gap-2 border-b border-zinc-200 p-4 sm:grid-cols-3">
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
          <p className="text-xs font-bold uppercase text-zinc-500">Expected</p>
          <p className="text-lg font-black text-zinc-950">{formatCurrency(totals.expectedCash)}</p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
          <p className="text-xs font-bold uppercase text-zinc-500">Counted</p>
          <p className="text-lg font-black text-zinc-950">{formatCurrency(totals.countedCash)}</p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
          <p className="text-xs font-bold uppercase text-zinc-500">Variance</p>
          <p className={totals.variance === 0 ? "text-lg font-black text-emerald-700" : "text-lg font-black text-rose-700"}>
            {totals.variance > 0 ? "+" : ""}{formatCurrency(totals.variance)}
          </p>
        </div>
      </div>

      <div className="grid gap-2 border-b border-zinc-200 p-4 sm:grid-cols-2 xl:grid-cols-3">
        <div className="text-sm"><span className="text-zinc-500">Cash sales</span><strong className="float-right">{formatCurrency(totals.cashSales)}</strong></div>
        <div className="text-sm"><span className="text-zinc-500">Cash refunds</span><strong className="float-right text-rose-700">-{formatCurrency(totals.cashRefunds)}</strong></div>
        <div className="text-sm"><span className="text-zinc-500">Cash expenses</span><strong className="float-right text-rose-700">-{formatCurrency(totals.cashExpenses)}</strong></div>
        <div className="text-sm"><span className="text-zinc-500">Supplier payments</span><strong className="float-right text-rose-700">-{formatCurrency(totals.cashSupplierPayments)}</strong></div>
        <div className="text-sm"><span className="text-zinc-500">Owner draws</span><strong className="float-right text-rose-700">-{formatCurrency(totals.ownerDraws)}</strong></div>
        <div className="text-sm"><span className="text-zinc-500">Cash in/out</span><strong className="float-right">{formatCurrency(totals.cashIn - totals.cashOut)}</strong></div>
      </div>

      <div className="space-y-3 p-4">
        {visibleSummaries.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm font-medium text-zinc-500">
            No shifts opened today.
          </div>
        ) : null}

        {visibleSummaries.map((summary) => (
          <article key={summary.shiftId} className="rounded-lg border border-zinc-200 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-bold text-zinc-950">{registerLabel(summary.registerId)}</p>
                <p className="mt-1 text-xs font-semibold text-zinc-500">
                  {summary.shiftNumber} / {summary.cashierName} / Dev {shortDeviceId(summary.deviceId)}
                </p>
              </div>
              <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-black uppercase ${
                summary.status === "Open"
                  ? "bg-amber-100 text-amber-800"
                  : summary.needsReview
                  ? "bg-rose-100 text-rose-800"
                  : "bg-emerald-100 text-emerald-800"
              }`}>
                {summary.status === "Open" || summary.needsReview ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />}
                {summary.status === "Open" ? "Open" : summary.needsReview ? "Needs review" : "Closed"}
              </span>
            </div>
            <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
              <div><span className="text-zinc-500">Expected</span><strong className="block">{formatCurrency(summary.expectedCash)}</strong></div>
              <div><span className="text-zinc-500">Counted</span><strong className="block">{summary.countedCash === undefined ? "-" : formatCurrency(summary.countedCash)}</strong></div>
              <div><span className="text-zinc-500">Difference</span><strong className={summary.difference && summary.difference !== 0 ? "block text-rose-700" : "block text-emerald-700"}>{summary.difference === undefined ? "-" : `${summary.difference > 0 ? "+" : ""}${formatCurrency(summary.difference)}`}</strong></div>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
