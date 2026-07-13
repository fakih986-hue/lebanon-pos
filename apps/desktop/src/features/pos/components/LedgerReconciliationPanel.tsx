import { useState, useEffect, useCallback } from "react"
import { getApiUrl, getAuthToken } from "../services/sync.service"

/**
 * POS-SYNC-AUTHORITY-2C-1 — read-only ledger reconciliation report.
 * Shows three independent stock views per product (aggregate / open batches /
 * ledger expected) with the differences and a suggested safe action. Repair is
 * NOT here yet (2C-2); the only write is the explicit admin "Initialize ledger"
 * baseline action, which records opening movements (record-only).
 */

type Row = {
  productId: number
  name: string
  barcode: string
  aggregate: number
  openBatchTotal: number
  ledgerExpected: number
  diffAB: number
  diffAL: number
  hasBatches: boolean
  movementCount: number
  severity: "ok" | "warn" | "error"
  classification: string[]
  suggestedAction: string
}
type Report = {
  generatedAt: string
  totalProducts: number
  flagged: number
  summary: { error: number; warn: number; needsBaseline: number }
  rows: Row[]
}

const sevColor = (s: string) =>
  s === "error" ? { bg: "var(--danger-soft)", fg: "var(--danger-text)" }
  : s === "warn" ? { bg: "var(--warning-soft, var(--info-soft))", fg: "var(--warning-text, var(--info-text))" }
  : { bg: "var(--success-soft, var(--info-soft))", fg: "var(--success-text, var(--info-text))" }

export default function LedgerReconciliationPanel() {
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(false)
  const [initializing, setInitializing] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const apiUrl = getApiUrl(), token = getAuthToken()
    if (!apiUrl || !token) { setError("Not connected to a hub."); return }
    setLoading(true); setError(null)
    try {
      const res = await fetch(`${apiUrl}/api/inventory/reconciliation`, { headers: { Authorization: `Bearer ${token}` } })
      if (res.status === 403) { setError("Managers only."); setReport(null); return }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setReport(await res.json())
    } catch (e) {
      setError(`Failed to load reconciliation: ${(e as Error).message}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const initialize = async () => {
    const apiUrl = getApiUrl(), token = getAuthToken()
    if (!apiUrl || !token) return
    setInitializing(true); setStatus(null); setError(null)
    try {
      const res = await fetch(`${apiUrl}/api/inventory/ledger/initialize`, { method: "POST", headers: { Authorization: `Bearer ${token}` } })
      const body = await res.json().catch(() => ({}))
      if (res.status === 403) { setError("Only an Admin can initialize the ledger."); return }
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
      setStatus(`Ledger initialized — seeded ${body.seeded} opening balance${body.seeded === 1 ? "" : "s"} of ${body.totalProducts} products.`)
      await load()
    } catch (e) {
      setError(`Initialize failed: ${(e as Error).message}`)
    } finally {
      setInitializing(false)
    }
  }

  const rows = report?.rows ?? []

  return (
    <section className="card mt-5 overflow-hidden">
      <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
        <div>
          <h2 className="text-[16px] font-bold" style={{ color: "var(--text)" }}>Ledger Reconciliation</h2>
          <p className="text-[12px] mt-0.5" style={{ color: "var(--text-3)" }}>
            Aggregate vs open batches vs stock ledger. Read-only — no stock is changed here.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={initialize} disabled={initializing} className="btn btn-default btn-sm" title="Anchor each product's ledger baseline to its current stock (Admin only)">
            {initializing ? "Initializing…" : "Initialize ledger"}
          </button>
          <button onClick={load} disabled={loading} className="btn btn-default btn-sm">
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {status ? <div className="px-5 py-3 text-[12px]" style={{ color: "var(--success-text, var(--info-text))" }}>{status}</div> : null}
      {error ? <div className="px-5 py-3 text-[12px]" style={{ color: "var(--danger-text)" }}>{error}</div> : null}

      {report ? (
        <div className="px-5 py-2 text-[12px] font-medium" style={{ color: "var(--text-3)" }}>
          {report.flagged} of {report.totalProducts} products flagged · {report.summary.error} error · {report.summary.warn} warn
          {report.summary.needsBaseline > 0 ? ` · ${report.summary.needsBaseline} need a baseline (run Initialize ledger)` : ""}
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0 text-[13px]">
            <thead>
              <tr>
                {["Product", "Aggregate", "Open batches", "Ledger", "Diff (agg−batch)", "Severity", "Suggested action"].map(h => (
                  <th key={h} className="border-b px-4 py-3 text-start text-[10px] font-bold uppercase tracking-[0.14em]"
                    style={{ borderColor: "var(--border)", color: "var(--text-3)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const c = sevColor(r.severity)
                return (
                  <tr key={r.productId}>
                    <td className="border-b px-4 py-3 font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>
                      {r.name}<div className="text-[11px] font-normal" style={{ color: "var(--text-3)" }}>{r.barcode}</div>
                    </td>
                    <td className="border-b px-4 py-3 tabular-nums" style={{ borderColor: "var(--border)", color: "var(--text-2)" }}>{r.aggregate}</td>
                    <td className="border-b px-4 py-3 tabular-nums" style={{ borderColor: "var(--border)", color: "var(--text-2)" }}>{r.hasBatches ? r.openBatchTotal : "—"}</td>
                    <td className="border-b px-4 py-3 tabular-nums" style={{ borderColor: "var(--border)", color: "var(--text-2)" }}>{r.ledgerExpected}</td>
                    <td className="border-b px-4 py-3 tabular-nums font-semibold" style={{ borderColor: "var(--border)", color: Math.abs(r.diffAB) > 0.001 ? "var(--danger-text)" : "var(--text-3)" }}>{r.hasBatches ? r.diffAB : "—"}</td>
                    <td className="border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
                      <span className="rounded px-2 py-0.5 text-[11px] font-bold uppercase" style={{ backgroundColor: c.bg, color: c.fg }}>{r.severity}</span>
                    </td>
                    <td className="border-b px-4 py-3 text-[12px]" style={{ borderColor: "var(--border)", color: "var(--text-3)" }}>{r.suggestedAction}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : report && !loading ? (
        <div className="px-5 py-12 text-center text-[13px] font-medium" style={{ color: "var(--text-3)" }}>
          No discrepancies — aggregate, batches, and ledger all agree. ✅
        </div>
      ) : null}
    </section>
  )
}
