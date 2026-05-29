import { useEffect, useState } from "react"
import { RefreshCw, TrendingUp, X } from "lucide-react"
import { useI18n } from "@lebanonpos/shared"

import { formatLbpCurrency, formatNumber } from "../lib/currency"
import {
  fetchRateFromSource,
  getCurrentRate,
  getRateMeta,
  isRateStale,
  rateAgeLabel,
  rateChangePercent,
  subscribeRate,
  updateRate,
} from "../services/currencyRate.service"
import { showToast } from "../services/toast.service"

/**
 * Full rate-management panel for Settings.
 */
export function RatePanel() {
  const { t } = useI18n()
  const [, setVersion] = useState(0)
  const [input, setInput] = useState(String(getCurrentRate()))
  const meta = getRateMeta()
  const current = getCurrentRate()

  useEffect(() => subscribeRate(() => { setVersion((v) => v + 1); setInput(String(getCurrentRate())) }), [])

  const newRate = parseFloat(input)
  const validNew = Number.isFinite(newRate) && newRate >= 1
  const pct = validNew ? rateChangePercent(newRate) : 0
  const changed = validNew && Math.round(newRate) !== current

  function apply() {
    if (!validNew) return
    updateRate(newRate, "manual")
    showToast(`Rate set to ${formatNumber(Math.round(newRate))} LBP/USD.`)
  }

  async function autoFetch() {
    const r = await fetchRateFromSource()
    if (r) showToast(`Rate auto-fetched: ${formatNumber(r)} LBP/USD.`)
    else showToast("No rate source configured (set one below) or fetch failed.", "error")
  }

  return (
    <div className="rounded-xl border p-4" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
      <div className="flex items-center gap-3 mb-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: "var(--brand-soft)" }}>
          <TrendingUp size={18} style={{ color: "var(--brand)" }} />
        </div>
        <div>
          <h3 className="text-[15px] font-bold" style={{ color: "var(--text)" }}>Exchange rate (USD → LBP)</h3>
          <p className="text-[12px]" style={{ color: isRateStale() ? "var(--amber-text)" : "var(--text-3)" }}>
            {isRateStale() ? `⚠ Stale — ${rateAgeLabel()}` : rateAgeLabel()}
          </p>
        </div>
      </div>

      <div className="rounded-lg p-3 mb-3 flex items-baseline justify-between" style={{ background: "var(--surface-2)" }}>
        <span className="text-[12px] font-semibold" style={{ color: "var(--text-3)" }}>Current rate</span>
        <span className="text-[20px] font-black tabular-nums" style={{ color: "var(--text)" }}>{formatNumber(current)} <span className="text-[12px] font-semibold" style={{ color: "var(--text-3)" }}>LBP</span></span>
      </div>

      <label className="block mb-1">
        <span className="block text-[12px] font-bold mb-1.5" style={{ color: "var(--text-2)" }}>Set new rate</span>
        <div className="flex gap-2">
          <input
            type="number" min="1" step="100"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") apply() }}
            className="input flex-1 text-right font-bold"
            style={{ height: 44, fontSize: 16 }}
          />
          <button type="button" onClick={apply} disabled={!changed}
            className="btn btn-primary px-4" style={{ height: 44 }}>
            Update
          </button>
        </div>
      </label>

      {/* Impact preview */}
      {changed && (
        <div className="mt-2 rounded-lg px-3 py-2 text-[13px] font-semibold"
          style={pct > 0 ? { background: "var(--brand-soft)", color: "var(--brand-text)" } : { background: "var(--amber-soft)", color: "var(--amber-text)" }}>
          {pct > 0 ? "↑" : "↓"} LBP prices will change by {Math.abs(pct).toFixed(2)}%
          {" "}— a $10 item goes {formatLbpCurrency(current * 10)} → {formatLbpCurrency(Math.round(newRate) * 10)}
        </div>
      )}

      {/* Auto-fetch */}
      <div className="mt-4 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
        <button type="button" onClick={autoFetch}
          className="flex items-center gap-2 text-[12px] font-semibold transition hover:opacity-80" style={{ color: "var(--accent-text)" }}>
          <RefreshCw size={13} />
          Auto-fetch from source
        </button>
      </div>

      {/* History */}
      {meta.history.length > 1 && (
        <div className="mt-3">
          <p className="text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--text-3)" }}>Recent changes</p>
          <div className="space-y-1">
            {meta.history.slice(0, 5).map((h, i) => (
              <div key={i} className="flex items-center justify-between text-[12px]" style={{ color: "var(--text-2)" }}>
                <span>{new Date(h.at).toLocaleDateString()} · {h.source}</span>
                <span className="font-semibold tabular-nums" style={{ color: "var(--text)" }}>{formatNumber(h.rate)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Compact dismissible banner for the POS page when the rate is stale.
 */
export function StaleRateBanner() {
  const [dismissed, setDismissed] = useState(false)
  const [, setVersion] = useState(0)
  const [editing, setEditing] = useState(false)
  const [input, setInput] = useState(String(getCurrentRate()))

  useEffect(() => subscribeRate(() => setVersion((v) => v + 1)), [])

  if (dismissed || !isRateStale()) return null

  function apply() {
    const r = parseFloat(input)
    if (Number.isFinite(r) && r >= 1) {
      updateRate(r, "manual")
      showToast(`Rate updated to ${formatNumber(Math.round(r))} LBP/USD.`)
      setEditing(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between"
      style={{ background: "var(--amber-soft)", borderColor: "rgba(245,158,11,0.3)" }}>
      <div className="flex items-center gap-2">
        <TrendingUp size={16} style={{ color: "var(--amber)" }} />
        <span className="text-[13px] font-semibold" style={{ color: "var(--amber-text)" }}>
          Exchange rate {rateAgeLabel()} — currently {formatNumber(getCurrentRate())} LBP/USD. Still correct?
        </span>
      </div>
      <div className="flex items-center gap-2">
        {editing ? (
          <>
            <input type="number" value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") apply() }}
              className="input w-28 text-right font-bold" style={{ height: 34, fontSize: 13 }} autoFocus />
            <button type="button" onClick={apply} className="btn btn-primary h-8 px-3 text-[12px]">Save</button>
          </>
        ) : (
          <button type="button" onClick={() => { setInput(String(getCurrentRate())); setEditing(true) }}
            className="btn h-8 px-3 text-[12px] font-bold" style={{ background: "var(--amber)", color: "#fff" }}>
            Update rate
          </button>
        )}
        <button type="button" onClick={() => { updateRate(getCurrentRate(), "manual"); setDismissed(true) }}
          className="h-8 px-3 text-[12px] font-semibold rounded-lg transition hover:opacity-70" style={{ color: "var(--amber-text)" }}>
          Still correct
        </button>
        <button type="button" onClick={() => setDismissed(true)} style={{ color: "var(--amber-text)" }}><X size={16} /></button>
      </div>
    </div>
  )
}
