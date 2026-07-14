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
  // 2C-2 repair modal state
  const [repairTarget, setRepairTarget] = useState<Row | null>(null)
  const [repairReason, setRepairReason] = useState("")
  const [repairing, setRepairing] = useState(false)
  const [repairError, setRepairError] = useState<string | null>(null)

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

  // Repair is offered ONLY when the aggregate is strictly above the open-batch
  // total for a batch-tracked product (the one safe, narrow direction).
  const canRepair = (r: Row) => r.hasBatches && r.diffAB > 0.001

  const doRepair = async () => {
    if (!repairTarget) return
    const reason = repairReason.trim()
    if (!reason) { setRepairError("A reason is required."); return }
    const apiUrl = getApiUrl(), token = getAuthToken()
    if (!apiUrl || !token) { setRepairError("Not connected to a hub."); return }
    setRepairing(true); setRepairError(null)
    try {
      const res = await fetch(`${apiUrl}/api/inventory/reconciliation/repair`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ productId: repairTarget.productId, reason }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
      setStatus(`Repaired "${repairTarget.name}": stock ${body.aggregateBefore} → ${body.aggregateAfter} (adjustment ${body.adjustmentId?.slice(0, 8)}).`)
      setRepairTarget(null); setRepairReason("")
      await load()
    } catch (e) {
      setRepairError((e as Error).message)
    } finally {
      setRepairing(false)
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
                {["Product", "Aggregate", "Open batches", "Ledger", "Diff (agg−batch)", "Severity", "Suggested action", "Repair"].map(h => (
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
                    <td className="border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
                      {canRepair(r) ? (
                        <button className="btn btn-default btn-sm whitespace-nowrap" onClick={() => { setRepairTarget(r); setRepairReason(""); setRepairError(null) }}>
                          Lower aggregate to batch total
                        </button>
                      ) : <span className="text-[11px]" style={{ color: "var(--text-3)" }}>—</span>}
                    </td>
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

      {repairTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }} role="dialog" aria-modal="true">
          <div className="card w-full max-w-md p-5" style={{ background: "var(--surface)" }}>
            <h3 className="text-[15px] font-bold" style={{ color: "var(--text)" }}>Lower aggregate to batch total</h3>
            <p className="mt-2 text-[13px]" style={{ color: "var(--text-2)" }}>
              This will reduce <b>{repairTarget.name}</b> stock from <b>{repairTarget.aggregate}</b> to <b>{repairTarget.openBatchTotal}</b> to match open batch stock. It will <b>not</b> change batches.
            </p>
            <label className="mt-4 block text-[12px] font-semibold" style={{ color: "var(--text-3)" }}>Reason (required)</label>
            <textarea value={repairReason} onChange={e => setRepairReason(e.target.value)} rows={2}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--text)" }}
              placeholder="e.g. Batches confirmed as truth after physical check" />
            {repairError ? <div className="mt-2 text-[12px]" style={{ color: "var(--danger-text)" }}>{repairError}</div> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn btn-default btn-sm" onClick={() => { setRepairTarget(null); setRepairError(null) }} disabled={repairing}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={doRepair} disabled={repairing || !repairReason.trim()}>
                {repairing ? "Repairing…" : "Confirm repair"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
