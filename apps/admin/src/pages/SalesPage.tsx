import { useEffect, useMemo, useState, useCallback, lazy, Suspense } from "react"
import { api } from "../app/api"
import { useI18n } from "@lebanonpos/shared"
import type { Sale } from "@lebanonpos/types"

const PAGE_SIZE = 50
type DateRange = "today" | "week" | "month" | "all"

function getDateStart(range: DateRange): Date | null {
  const now = new Date()
  if (range === "today") return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (range === "week") { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate()); d.setDate(d.getDate() - 6); return d }
  if (range === "month") return new Date(now.getFullYear(), now.getMonth(), 1)
  return null
}

function exportCsv(sales: Sale[]) {
  const header = ["Sale#", "Date", "Payment", "Customer", "Cashier", "Subtotal", "Discount", "Tax", "Total", "Profit", "Status"]
  const rows = sales.map((s) => [
    s.saleNumber, new Date(s.createdAt).toLocaleString(), s.paymentMethod,
    s.customerName ?? "", s.cashier, s.subtotal.toFixed(2),
    (s.discountTotal ?? 0).toFixed(2), s.tax.toFixed(2), s.total.toFixed(2),
    (s.profit ?? 0).toFixed(2), s.status,
  ])
  const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n")
  const blob = new Blob([csv], { type: "text/csv" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a"); a.href = url; a.download = `sales-${new Date().toISOString().slice(0, 10)}.csv`; a.click()
  URL.revokeObjectURL(url)
}

const PM_COLORS: Record<string, string> = {
  Cash: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
  Card: "bg-indigo-500/15 text-indigo-300 border-indigo-500/25",
  Wallet: "bg-violet-500/15 text-violet-300 border-violet-500/25",
  Debt: "bg-amber-500/15 text-amber-300 border-amber-500/25",
}

const SaleItemsTable = lazy(() => Promise.resolve({
  default: ({ items, t }: { items: Sale["items"]; t: (k: string) => string }) => (
    <div className="rounded-xl overflow-hidden mt-2" style={{ background: "var(--surface-input)" }}>
      <table className="min-w-full text-xs">
        <thead>
          <tr>
            {[t("admin.col_product"), t("admin.col_qty"), t("admin.col_unit_price"), t("admin.col_total")].map((h) => (
              <th key={h} className="px-3 py-2 text-left font-semibold" style={{ color: "var(--text-secondary)" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td className="px-3 py-2" style={{ color: "var(--text-primary)" }}>{item.productName}</td>
              <td className="px-3 py-2" style={{ color: "var(--text-secondary)" }}>{item.quantity}</td>
              <td className="px-3 py-2" style={{ color: "var(--text-secondary)" }}>${item.unitPrice.toFixed(2)}</td>
              <td className="px-3 py-2 font-semibold" style={{ color: "var(--text-primary)" }}>${item.total.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}))

export function SalesPage() {
  const { t } = useI18n()
  const [sales, setSales] = useState<Sale[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [search, setSearch] = useState("")
  const [dateRange, setDateRange] = useState<DateRange>("today")
  const [payFilter, setPayFilter] = useState("All")
  const [expanded, setExpanded] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams()
    params.set("skip", String((page - 1) * PAGE_SIZE))
    params.set("limit", String(PAGE_SIZE + 1))
    setLoading(true)
    api<Sale[]>(`/api/sales?${params}`)
      .then((data) => {
        if (data.length > PAGE_SIZE) {
          setSales(data.slice(0, PAGE_SIZE))
          setHasMore(true)
        } else {
          setSales(data)
          setHasMore(false)
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [page])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const start = getDateStart(dateRange)
    return sales
      .filter((s) => s.status !== "Voided")
      .filter((s) => !start || new Date(s.createdAt) >= start)
      .filter((s) => payFilter === "All" || s.paymentMethod === payFilter)
      .filter((s) => !q || s.saleNumber.toLowerCase().includes(q) || (s.customerName ?? "").toLowerCase().includes(q) || s.cashier.toLowerCase().includes(q))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [sales, search, dateRange, payFilter])

  const totals = useMemo(() => ({
    revenue: filtered.reduce((s, x) => s + x.total, 0),
    profit: filtered.reduce((s, x) => s + (x.profit ?? 0), 0),
  }), [filtered])

  const rangeLabels = useMemo<Record<DateRange, string>>(() => ({
    today: t("admin.range_today"),
    week: t("admin.range_week"),
    month: t("admin.range_month"),
    all: t("admin.range_all"),
  }), [t])

  const handleToggleExpand = useCallback((id: string) => {
    setExpanded((prev) => prev === id ? null : id)
  }, [])

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-start justify-between mb-8 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>{t("admin.sales_history")}</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
            {t("admin.transactions_revenue_profit", { count: filtered.length, revenue: totals.revenue.toLocaleString("en-US", { minimumFractionDigits: 2 }), profit: totals.profit.toLocaleString("en-US", { minimumFractionDigits: 2 }) })}
          </p>
        </div>
        <button onClick={() => exportCsv(filtered)} disabled={filtered.length === 0}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-semibold transition-all hover:opacity-80 disabled:opacity-40"
          style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}>
          {t("admin.export_csv")}
        </button>
      </div>

      {error && <div className="mb-4 rounded-xl bg-rose-500/10 border border-rose-500/20 px-4 py-3 text-sm text-rose-300">{error}</div>}

      <div className="flex flex-wrap gap-3 mb-6">
        <div className="flex rounded-xl border overflow-hidden text-sm" style={{ borderColor: "var(--border-subtle)" }}>
          {(["today", "week", "month", "all"] as DateRange[]).map((r) => (
            <button key={r} onClick={() => setDateRange(r)}
              className={`px-3 h-10 font-semibold transition-all ${dateRange === r ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white" : "text-secondary hover:opacity-80"}`}>
              {rangeLabels[r]}
            </button>
          ))}
        </div>
        <select value={payFilter} onChange={(e) => setPayFilter(e.target.value)}
          className="h-10 rounded-xl border px-3 text-sm font-semibold outline-none" style={{ background: "var(--surface-input)", borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}>
          <option value="All">{t("admin.all_payments")}</option>
          <option value="Cash">{t("pos.payment.cash")}</option>
          <option value="Wallet">{t("pos.payment.wallet")}</option>
          <option value="Debt">{t("pos.payment.debt")}</option>
        </select>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("admin.search_sales")}
          className="h-10 rounded-xl border px-4 text-sm outline-none focus:ring-2 focus:ring-indigo-500/40 min-w-48"
          style={{ background: "var(--surface-input)", borderColor: "var(--border-subtle)", color: "var(--text-primary)" }} />
      </div>

      {loading ? (
        <div className="space-y-3">{[1,2,3,4,5].map((i) => <div key={i} className="h-14 rounded-2xl animate-pulse" style={{ background: "var(--surface-card)" }} />)}</div>
      ) : (
        <>
          <div className="rounded-2xl border overflow-hidden" style={{ background: "var(--surface-card)", borderColor: "var(--border-subtle)" }}>
            <table className="min-w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  {[t("admin.col_sale"), t("admin.col_payment"), t("admin.col_customer"), t("admin.col_cashier"), t("admin.col_items"), t("admin.col_total"), t("admin.col_profit"), t("admin.col_date"), ""].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-12 text-center text-sm" style={{ color: "var(--text-secondary)" }}>{t("admin.no_sales_period")}</td></tr>
                ) : filtered.map((sale) => (
                  <>
                    <tr key={sale.id} style={{ borderBottom: expanded === sale.id ? "none" : "1px solid var(--border-subtle)" }} className="hover:opacity-90 transition-opacity">
                      <td className="px-4 py-3 font-bold text-indigo-300 font-mono text-xs">{sale.saleNumber}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold border ${PM_COLORS[sale.paymentMethod] ?? "bg-white/5 text-secondary border-white/10"}`}>
                          {sale.paymentMethod}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: "var(--text-secondary)" }}>{sale.customerName ?? "—"}</td>
                      <td className="px-4 py-3 text-xs" style={{ color: "var(--text-secondary)" }}>{sale.cashier}</td>
                      <td className="px-4 py-3 text-xs" style={{ color: "var(--text-secondary)" }}>{sale.items.reduce((s, i) => s + i.quantity, 0)}</td>
                      <td className="px-4 py-3 font-bold" style={{ color: "var(--text-primary)" }}>${sale.total.toFixed(2)}</td>
                      <td className="px-4 py-3 text-xs font-semibold text-emerald-400">${(sale.profit ?? 0).toFixed(2)}</td>
                      <td className="px-4 py-3 text-xs" style={{ color: "var(--text-secondary)" }}>{new Date(sale.createdAt).toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => handleToggleExpand(sale.id)}
                          className="text-xs px-2.5 py-1.5 rounded-lg transition-all hover:opacity-80"
                          style={{ background: "var(--surface-input)", color: "var(--text-secondary)" }}>
                          {expanded === sale.id ? "▲" : "▼"}
                        </button>
                      </td>
                    </tr>
                    {expanded === sale.id && (
                      <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                        <td colSpan={9} className="px-6 pb-4">
                          <Suspense fallback={<div className="h-20 rounded-xl animate-pulse" style={{ background: "var(--surface-input)" }} />}>
                            <SaleItemsTable items={sale.items} t={t} />
                          </Suspense>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between pt-3">
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
              {t("admin.page")} {page}
            </span>
            <div className="flex gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-30 transition-all hover:opacity-80"
                style={{ background: "var(--surface-input)", color: "var(--text-primary)" }}>
                {t("admin.prev")}
              </button>
              <button onClick={() => setPage((p) => p + 1)} disabled={!hasMore}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-30 transition-all hover:opacity-80"
                style={{ background: "var(--surface-input)", color: "var(--text-primary)" }}>
                {t("admin.next")}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
