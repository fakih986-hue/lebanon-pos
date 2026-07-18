import { useEffect, useMemo, useState } from "react"
import { Download, PackageOpen } from "lucide-react"

import { getStockMovements, getInventoryBatches, subscribeInventoryBatches } from "../services/inventoryBatch.service"
import { getProductsSync } from "../services/product.service"
import {
  buildOpeningInventoryReport,
  openingReportToCsv,
  type OpeningReportFilters,
} from "../lib/openingInventoryReport"

// POS-FIRST-SETUP-CATALOG-1F: reporting-only view of opening inventory. Reads
// the ledger/batches/catalog; never mutates. Lives in Stock & Batches.

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }))
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export default function OpeningInventoryPanel() {
  const [tick, setTick] = useState(0)
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [category, setCategory] = useState("")

  useEffect(() => subscribeInventoryBatches(() => setTick((t) => t + 1)), [])

  const filters = useMemo<OpeningReportFilters>(
    () => ({ from: from || undefined, to: to || undefined, category: category || undefined }),
    [from, to, category],
  )

  const report = useMemo(
    () => buildOpeningInventoryReport(getStockMovements(), getInventoryBatches(), getProductsSync(), filters),
    [filters, tick],
  )

  const money = (n: number) => n.toFixed(2)

  return (
    <section className="card mt-5 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-2">
          <PackageOpen size={18} style={{ color: "var(--brand)" }} />
          <div>
            <h2 className="text-[16px] font-bold" style={{ color: "var(--text)" }}>Opening inventory</h2>
            <p className="text-[12px] mt-0.5" style={{ color: "var(--text-3)" }}>
              Starting stock recorded during first-time setup. Separate from daily receiving — these lines create no supplier purchase.
            </p>
          </div>
        </div>
        <button type="button" onClick={() => download(`titan-opening-inventory-${new Date().toISOString().slice(0, 10)}.csv`, openingReportToCsv(report))}
          disabled={report.rows.length === 0}
          className="btn btn-default btn-sm gap-1.5 disabled:opacity-40"><Download size={14} /> Export CSV</button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3 px-5 py-4">
        {[
          ["Products", String(report.summary.products)],
          ["Opening units", String(report.summary.units)],
          ["Opening value", money(report.summary.value)],
        ].map(([label, val]) => (
          <div key={label} className="rounded-xl border p-3" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
            <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-3)" }}>{label}</p>
            <p className="text-[18px] font-bold mt-0.5" style={{ color: "var(--text)" }}>{val}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 px-5 pb-4">
        <label className="block">
          <span className="text-[11px] font-semibold" style={{ color: "var(--text-3)" }}>From</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input" aria-label="From date" />
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold" style={{ color: "var(--text-3)" }}>To</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input" aria-label="To date" />
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold" style={{ color: "var(--text-3)" }}>Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="input" aria-label="Category">
            <option value="">All categories</option>
            {report.categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        {(from || to || category) && (
          <button type="button" onClick={() => { setFrom(""); setTo(""); setCategory("") }} className="btn btn-ghost btn-sm">Clear</button>
        )}
      </div>

      {report.rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0 text-[13px]">
            <thead>
              <tr>
                {["Date", "Product", "Barcode", "Category", "Qty", "Unit cost", "Value", "Batch"].map((h) => (
                  <th key={h} className="border-b px-4 py-3 text-start text-[10px] font-bold uppercase tracking-[0.14em]"
                    style={{ borderColor: "var(--border)", color: "var(--text-3)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r, i) => (
                <tr key={`${r.batchNumber}-${i}`} className="t-row">
                  <td className="border-b px-4 py-2.5" style={{ borderColor: "var(--border)", color: "var(--text-3)" }}>{r.date.slice(0, 10)}</td>
                  <td className="border-b px-4 py-2.5 font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>{r.productName}</td>
                  <td className="border-b px-4 py-2.5 font-mono text-[12px]" style={{ borderColor: "var(--border)", color: "var(--text-2)" }}>{r.barcode || "—"}</td>
                  <td className="border-b px-4 py-2.5" style={{ borderColor: "var(--border)", color: "var(--text-2)" }}>{r.category || "—"}</td>
                  <td className="border-b px-4 py-2.5 font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>{r.quantity}</td>
                  <td className="border-b px-4 py-2.5" style={{ borderColor: "var(--border)", color: "var(--text-2)" }}>{money(r.unitCost)}</td>
                  <td className="border-b px-4 py-2.5" style={{ borderColor: "var(--border)", color: "var(--text-2)" }}>{money(r.value)}</td>
                  <td className="border-b px-4 py-2.5 font-mono text-[11px]" style={{ borderColor: "var(--border)", color: "var(--text-3)" }}>{r.batchNumber}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-5 py-12 text-center text-[13px] font-medium" style={{ color: "var(--text-3)" }}>
          No opening inventory recorded{(from || to || category) ? " for this filter" : " yet"}. Use Settings → First-time catalog setup to import or scan a starting catalog.
        </div>
      )}
    </section>
  )
}
