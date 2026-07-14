import { useEffect, useMemo, useState } from "react"
import { Search } from "lucide-react"

import { formatCurrency, formatNumber } from "../lib/currency"
import {
  getInventoryBatches,
  subscribeInventoryBatches,
} from "../services/inventoryBatch.service"

// POS-UX-IA-2B.3: Self-contained Batch / Lot inventory table. This is the same
// view rendered inside ProductsPage's "Batches" tab, extracted so the new
// /stock workspace can mount it too. It owns only its own search/filter state
// and reads the inventory-batch store directly — no ProductsPage state needed.
// ProductsPage keeps its own inline copy for now (unchanged this sprint).

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-LB", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value))
}

function getExpiryChip(batch: { expiryDate?: string; status: string }) {
  if (!batch.expiryDate) return null
  const now = new Date()
  const exp = new Date(batch.expiryDate)
  const diffMs = exp.getTime() - now.getTime()
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
  if (diffMs < 0) return { label: "Expired", bg: "var(--danger-soft)", fg: "var(--danger-text)" }
  if (diffDays === 0) return { label: "Today", bg: "var(--danger-soft)", fg: "var(--danger-text)" }
  if (diffDays <= 7) return { label: `${diffDays}d`, bg: "var(--danger-soft)", fg: "var(--danger-text)" }
  if (diffDays <= 30) return { label: `${diffDays}d`, bg: "var(--warning-soft)", fg: "var(--warning-text)" }
  return { label: `${diffDays}d`, bg: "var(--success-soft)", fg: "var(--success-text)" }
}

export default function BatchesPanel() {
  const [lotSearch, setLotSearch] = useState("")
  const [lotFilter, setLotFilter] = useState<"all" | "open" | "consumed" | "expired">("open")
  const [batchVersion, setBatchVersion] = useState(0)

  useEffect(
    () => subscribeInventoryBatches(() => setBatchVersion((version) => version + 1)),
    []
  )

  const filteredLots = useMemo(() => {
    const all = getInventoryBatches()
    let list = all
    if (lotFilter === "open") list = list.filter(b => b.quantityRemaining > 0)
    else if (lotFilter === "consumed") list = list.filter(b => b.quantityRemaining <= 0)
    else if (lotFilter === "expired") list = list.filter(b => b.expiryDate && new Date(b.expiryDate) < new Date())
    if (lotSearch.trim()) {
      const q = lotSearch.trim().toLowerCase()
      list = list.filter(b =>
        b.productName.toLowerCase().includes(q) ||
        b.barcode.toLowerCase().includes(q) ||
        b.batchNumber.toLowerCase().includes(q) ||
        (b.supplierName ?? "").toLowerCase().includes(q)
      )
    }
    return list.sort((a, b) => {
      // FEFO: soonest expiry first, expired first if applicable
      const aExp = a.expiryDate || "9999-12-31"
      const bExp = b.expiryDate || "9999-12-31"
      return aExp.localeCompare(bExp)
    })
  }, [lotSearch, lotFilter, batchVersion])

  return (
    <section className="card mt-5 overflow-hidden">
      <div className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: "var(--border)" }}>
        <div>
          <h2 className="text-[16px] font-bold" style={{ color: "var(--text)" }}>Batch / Lot Inventory</h2>
          <p className="text-[12px] mt-0.5" style={{ color: "var(--text-3)" }}>
            Stock tracked by received lot, cost, expiry and remaining quantity.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 px-5 pt-4">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-3)" }} />
          <input placeholder="Search batches by product, barcode, batch, supplier..."
            value={lotSearch} onChange={e => setLotSearch(e.target.value)}
            className="input w-full pl-8 text-[13px]" />
        </div>
        <div className="flex rounded-lg p-0.5 gap-0.5" style={{ background: "var(--surface-2)" }}>
          {(["all", "open", "consumed", "expired"] as const).map(s => (
            <button key={s} onClick={() => setLotFilter(s)}
              aria-pressed={lotFilter === s}
              aria-label={`Filter: ${s} lots`}
              className="px-3 py-1 text-[11px] font-semibold rounded-md capitalize"
              style={{
                background: lotFilter === s ? "var(--brand)" : "transparent",
                color: lotFilter === s ? "var(--brand-contrast)" : "var(--text-2)",
              }}>
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0 text-[13px]">
          <thead>
            <tr>
              {["Lot", "Barcode", "Product", "Supplier", "Remain", "Initial", "Cost", "Value", "Received", "Status"].map((h, i) => (
                <th key={h} className="border-b px-3 py-3 text-start text-[10px] font-bold uppercase tracking-[0.14em]"
                  style={{ borderColor: "var(--border)", color: "var(--text-3)", textAlign: i >= 4 && i <= 7 ? "right" : "left" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredLots.slice(0, 50).map((batch) => (
              <tr key={batch.id} className="t-row">
                <td className="border-b px-3 py-3 font-bold tabular-nums" style={{ borderColor: "var(--border)", color: "var(--brand)" }}>
                  <span className="text-[11px]">{batch.batchNumber}</span>
                </td>
                <td className="border-b px-3 py-3 font-mono text-[11px]" style={{ borderColor: "var(--border)", color: "var(--text-3)" }}>{batch.barcode}</td>
                <td className="border-b px-3 py-3 font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>{batch.productName}</td>
                <td className="border-b px-3 py-3" style={{ borderColor: "var(--border)", color: "var(--text-3)" }}>{batch.supplierName ?? "—"}</td>
                <td className="border-b px-3 py-3 text-end font-bold tabular-nums" style={{ borderColor: "var(--border)", color: batch.quantityRemaining > 0 ? "var(--text)" : "var(--text-3)" }}>
                  {formatNumber(batch.quantityRemaining)}
                </td>
                <td className="border-b px-3 py-3 text-end tabular-nums" style={{ borderColor: "var(--border)", color: "var(--text-2)" }}>{formatNumber(batch.initialQuantity)}</td>
                <td className="border-b px-3 py-3 text-end tabular-nums" style={{ borderColor: "var(--border)", color: "var(--text-2)" }}>{formatCurrency(batch.unitCost)}</td>
                <td className="border-b px-3 py-3 text-end font-semibold tabular-nums" style={{ borderColor: "var(--border)", color: "var(--text)" }}>
                  {formatCurrency(batch.unitCost * batch.quantityRemaining)}
                </td>
                <td className="border-b px-3 py-3 tabular-nums" style={{ borderColor: "var(--border)", color: "var(--text-3)" }}>
                  {batch.receivedAt ? formatDate(batch.receivedAt) : "—"}
                </td>
                <td className="border-b px-3 py-3">
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="chip text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{
                      background: batch.status === "Open" ? "var(--success-soft)" : batch.status === "Consumed" ? "var(--surface-3)" : "var(--danger-soft)",
                      color: batch.status === "Open" ? "var(--success-text)" : batch.status === "Consumed" ? "var(--text-2)" : "var(--danger-text)",
                    }}>{batch.status}</span>
                    {(() => {
                      const chip = getExpiryChip(batch)
                      if (!chip) return null
                      return (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold"
                          style={{ background: chip.bg, color: chip.fg }}>{chip.label}</span>
                      )
                    })()}
                  </div>
                </td>
              </tr>
            ))}
            {filteredLots.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center text-[13px] font-medium" style={{ color: "var(--text-3)" }}>
                  {lotFilter !== "all" ? `No ${lotFilter} lots found.` : "No lots found. Receiving stock will create batches here."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
