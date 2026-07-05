import { useState, useEffect } from "react"
import { api } from "../app/api"
import { getToken } from "../main"
import { useI18n } from "@lebanonpos/shared"

function formatCurrency(n: number) { return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 }) }
function formatPct(n: number) { return n.toFixed(1) + "%" }

type LowStockItem = {
  id: number; name: string; barcode: string; category: string
  stock: number; cost: number; price: number
  reorderPoint: number; reorderQuantity: number; supplierName: string
  deficit: number; suggestedReorder: number
}
type XReportData = {
  type: string
  shift: { number: string; openedAt: string; openedBy: string; openingFloat: number }
  sales: { count: number; total: number; cost: number; profit: number }
  refunds: { count: number; total: number }
  expenses: { count: number; total: number }
  supplierPayments: { total: number }
  paymentBreakdown: { cash: { count: number; total: number }; card: { count: number; total: number }; wallet: { total: number } }
  netCash: number
  generatedAt: string
}
type ZReportData = XReportData & {
  cashReconciliation: { openingFloat: number; cashSales: number; cashRefunds: number; cashExpenses: number; expectedCash: number; closingCash: number; difference: number }
}
type MarginData = {
  period: string
  summary: { totalRevenue: number; totalCost: number; totalMargin: number; marginPct: number }
  byCategory: Array<{ category: string; revenue: number; cost: number; margin: number; marginPct: number }>
  byProduct: Array<{ productId: number; name: string; category: string; quantity: number; revenue: number; cost: number; margin: number; marginPct: number }>
}
type DebtAgingData = {
  totalOutstanding: number
  customers: Array<{ customerId: string; name: string; mobile: string; creditLimit: number; totalDebt: number; totalPaid: number; outstanding: number; current: number; days30: number; days60: number; days90: number; lastSaleDate: string }>
}

function downloadCsv(url: string, filename: string) {
  const token = getToken()
  fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    .then(r => {
      if (!r.ok) throw new Error(`Download failed: ${r.status}`)
      return r.blob()
    })
    .then(blob => {
      const a = document.createElement("a")
      a.href = URL.createObjectURL(blob)
      a.download = filename
      a.click()
      URL.revokeObjectURL(a.href)
    })
    .catch(err => {
      console.error("[downloadCsv] Error:", err)
      alert(`Failed to download: ${err.message}`)
    })
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: "indigo" | "emerald" | "amber" | "rose" | "violet" }) {
  const gradients: Record<string, string> = {
    indigo: "from-indigo-500/20 to-indigo-600/10 border-indigo-500/30",
    emerald: "from-emerald-500/20 to-emerald-600/10 border-emerald-500/30",
    amber: "from-amber-500/20 to-amber-600/10 border-amber-500/30",
    rose: "from-rose-500/20 to-rose-600/10 border-rose-500/30",
    violet: "from-violet-500/20 to-violet-600/10 border-violet-500/30",
  }
  return (
    <div className={`data-card p-5 rounded-xl bg-gradient-to-br border ${gradients[color ?? "indigo"]}`}>
      <p className="text-xs font-medium tracking-wide opacity-60 mb-1">{label}</p>
      <p className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>{value}</p>
      {sub && <p className="text-xs mt-1 opacity-50">{sub}</p>}
    </div>
  )
}

export function ReportsPage() {
  const { t } = useI18n()
  const [activeTab, setActiveTab] = useState<"low-stock" | "x-report" | "margin" | "debt">("low-stock")

  // Low stock
  const [lowStock, setLowStock] = useState<LowStockItem[]>([])
  const [lowStockLoading, setLowStockLoading] = useState(false)
  const [lowStockError, setLowStockError] = useState<string | null>(null)

  // X report
  const [xReport, setXReport] = useState<XReportData | null>(null)
  const [xLoading, setXLoading] = useState(false)
  const [xError, setXError] = useState<string | null>(null)

  // Z report
  const [zReport, setZReport] = useState<ZReportData | null>(null)
  const [zLoading, setZLoading] = useState(false)
  const [zError, setZError] = useState<string | null>(null)
  const [closingCash, setClosingCash] = useState("")
  const [zNotes, setZNotes] = useState("")

  // Margin
  const [margin, setMargin] = useState<MarginData | null>(null)
  const [marginDays, setMarginDays] = useState(30)
  const [marginLoading, setMarginLoading] = useState(false)
  const [marginError, setMarginError] = useState<string | null>(null)

  // Debt aging
  const [debt, setDebt] = useState<DebtAgingData | null>(null)
  const [debtLoading, setDebtLoading] = useState(false)
  const [debtError, setDebtError] = useState<string | null>(null)

  useEffect(() => {
    if (activeTab === "low-stock" && lowStock.length === 0) loadLowStock()
    if (activeTab === "debt" && !debt) loadDebtAging()
  }, [activeTab])

  async function loadLowStock() {
    setLowStockLoading(true); setLowStockError(null)
    try {
      const data = await api<{ items: LowStockItem[] }>("/api/reports/low-stock")
      setLowStock(data.items)
    } catch (e) { setLowStockError(e instanceof Error ? e.message : "Failed to load") }
    setLowStockLoading(false)
  }

  async function loadXReport() {
    setXLoading(true); setXError(null)
    try {
      const data = await api<XReportData>("/api/reports/x-report")
      setXReport(data)
    } catch (e: any) { setXError(e.message ?? "Failed to load X report") }
    setXLoading(false)
  }

  async function loadZReport() {
    const cash = parseFloat(closingCash)
    if (isNaN(cash) || cash < 0) return
    setZLoading(true); setZError(null)
    try {
      const body: Record<string, unknown> = { closingCash: cash }
      if (zNotes) body.notes = zNotes
      const data = await api<ZReportData>("/api/reports/z-report", { method: "POST", body: JSON.stringify(body) })
      setZReport(data)
    } catch (e) { setZError(e instanceof Error ? e.message : "Failed to close shift") }
    setZLoading(false)
  }

  async function loadMargin() {
    setMarginLoading(true); setMarginError(null)
    try {
      const data = await api<MarginData>(`/api/reports/margin?days=${marginDays}`)
      setMargin(data)
    } catch (e) { setMarginError(e instanceof Error ? e.message : "Failed to load") }
    setMarginLoading(false)
  }

  async function loadDebtAging() {
    setDebtLoading(true); setDebtError(null)
    try {
      const data = await api<DebtAgingData>("/api/reports/debt-aging")
      setDebt(data)
    } catch (e) { setDebtError(e instanceof Error ? e.message : "Failed to load") }
    setDebtLoading(false)
  }

  const tabs = [
    { key: "low-stock" as const, label: t("admin.low_stock") },
    { key: "x-report" as const, label: t("admin.x_report") },
    { key: "margin" as const, label: t("admin.margin") },
    { key: "debt" as const, label: t("admin.debt_aging") },
  ]

  return (
    <div className="animate-slide-up">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>{t("admin.reports")}</h1>
          <p className="text-sm opacity-60">{t("admin.reports_subtitle")}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-white/5 rounded-xl p-1 w-fit">
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${activeTab === tab.key ? "bg-white/10 text-white" : "text-white/40 hover:text-white/70"}`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Low Stock Tab */}
      {activeTab === "low-stock" && (
        <div>
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <button onClick={loadLowStock} disabled={lowStockLoading}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-all duration-200 disabled:opacity-50">
              {lowStockLoading ? t("admin.loading") : t("admin.refresh")}
            </button>
            <button onClick={() => downloadCsv("/api/reports/export/low-stock", `low-stock-${new Date().toISOString().slice(0, 10)}.csv`)}
              className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-sm font-medium transition-all duration-200">
              {t("admin.export_csv")}
            </button>
          </div>
          {lowStockError && (
            <div className="mb-4 p-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-300 text-sm rounded-xl">{lowStockError} <button onClick={loadLowStock} className="underline ml-2">{t("admin.retry")}</button></div>
          )}
          {lowStock.length === 0 && !lowStockLoading && !lowStockError ? (
            <p className="text-sm opacity-50 py-8 text-center">{t("admin.no_low_stock")}</p>
          ) : (
            <div className="grid gap-3">
              {lowStock.map(item => (
                <div key={item.id} className="data-card p-4 rounded-xl flex items-center gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold" style={{ color: "var(--text-primary)" }}>{item.name}</p>
                    <p className="text-xs opacity-50">{item.barcode} &middot; {item.category} {item.supplierName ? `· ${item.supplierName}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-rose-400 font-bold">{t("admin.stock_left", { stock: item.stock })}</span>
                    <span className="opacity-50">{t("admin.reorder_at", { point: item.reorderPoint })}</span>
                    <span className="bg-amber-500/20 text-amber-300 px-2 py-1 rounded-lg font-medium">{t("admin.need", { qty: item.suggestedReorder })}</span>
                    <span className="opacity-40">{formatCurrency(item.price)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* X Report Tab */}
      {activeTab === "x-report" && (
        <div>
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <button onClick={loadXReport} disabled={xLoading}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-all duration-200 disabled:opacity-50">
              {xLoading ? t("admin.loading") : t("admin.generate_x_report")}
            </button>
            <button onClick={() => downloadCsv("/api/reports/export/x-report", `x-report.csv`)}
              className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-sm font-medium transition-all duration-200">
              {t("admin.export_csv")}
            </button>
          </div>
          {xError && <p className="text-rose-400 text-sm mb-4">{xError}</p>}
          {xReport && (
            <div className="space-y-4">
              <div className="data-card p-5 rounded-xl">
                <p className="font-bold mb-2">{t("admin.shift_num", { num: xReport.shift.number })}</p>
                <p className="text-sm opacity-60">{t("admin.opened_by", { date: new Date(xReport.shift.openedAt).toLocaleString(), name: xReport.shift.openedBy })}</p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label={t("admin.sales_label")} value={xReport.sales.count.toString()} sub={formatCurrency(xReport.sales.total)} color="emerald" />
                <StatCard label={t("admin.refunds_label")} value={xReport.refunds.count.toString()} sub={formatCurrency(xReport.refunds.total)} color="rose" />
                <StatCard label={t("admin.expenses_label")} value={xReport.expenses.count.toString()} sub={formatCurrency(xReport.expenses.total)} color="amber" />
                <StatCard label={t("admin.net_cash")} value={formatCurrency(xReport.netCash)} color="indigo" />
              </div>
              <div className="data-card p-5 rounded-xl">
                <p className="font-semibold mb-2">{t("admin.payment_breakdown")}</p>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div><span className="opacity-50">{t("admin.cash_label")}</span> {xReport.paymentBreakdown.cash.count} · {formatCurrency(xReport.paymentBreakdown.cash.total)}</div>
                  <div><span className="opacity-50">{t("admin.card_label")}</span> {xReport.paymentBreakdown.card.count} · {formatCurrency(xReport.paymentBreakdown.card.total)}</div>
                  <div><span className="opacity-50">{t("admin.wallet_label")}</span> {formatCurrency(xReport.paymentBreakdown.wallet.total)}</div>
                </div>
              </div>

              {/* Z Report (close shift) */}
              <div className="data-card p-5 rounded-xl border border-rose-500/20">
                <p className="font-bold mb-3 text-rose-400">{t("admin.close_shift")}</p>
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label className="block text-xs opacity-50 mb-1">{t("admin.closing_cash")}</label>
                    <input value={closingCash} onChange={e => setClosingCash(e.target.value)} type="number" min="0" step="0.01"
                      className="px-3 py-2 rounded-lg bg-white/10 border border-white/10 text-sm w-32" placeholder="0.00" />
                  </div>
                  <div>
                    <label className="block text-xs opacity-50 mb-1">{t("admin.notes")}</label>
                    <input value={zNotes} onChange={e => setZNotes(e.target.value)}
                      className="px-3 py-2 rounded-lg bg-white/10 border border-white/10 text-sm w-48" placeholder={t("admin.optional")} />
                  </div>
                  <button onClick={loadZReport} disabled={zLoading || !closingCash}
                    className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-bold transition-all duration-200 disabled:opacity-50">
                    {zLoading ? t("admin.closing") : t("admin.close_shift_print")}
                  </button>
                </div>
                {zError && (
                  <div className="mt-3 p-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-300 text-sm rounded-xl">{zError}</div>
                )}
                {zReport && (
                  <div className="mt-4 pt-4 border-t border-white/10">
                    <p className="font-bold text-emerald-400 mb-2">{t("admin.shift_closed")}</p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                      <div><span className="opacity-50">{t("admin.expected_cash")}</span><br/>{formatCurrency(zReport.cashReconciliation.expectedCash)}</div>
                      <div><span className="opacity-50">{t("admin.closing_cash")}</span><br/>{formatCurrency(zReport.cashReconciliation.closingCash)}</div>
                      <div><span className="opacity-50">{t("admin.difference")}</span><br/><span className={zReport.cashReconciliation.difference !== 0 ? "text-rose-400" : "text-emerald-400"}>{formatCurrency(zReport.cashReconciliation.difference)}</span></div>
                      <div><span className="opacity-50">{t("admin.profit_label")}</span><br/>{formatCurrency(zReport.sales.profit)}</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          {!xReport && !xError && !xLoading && <p className="text-sm opacity-50 py-8 text-center">{t("admin.generate_hint")}</p>}
        </div>
      )}

      {/* Margin Tab */}
      {activeTab === "margin" && (
        <div>
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <select value={marginDays} onChange={e => setMarginDays(Number(e.target.value))}
              className="px-3 py-2 rounded-lg bg-white/10 border border-white/10 text-sm">
              <option value={7}>{t("admin.period_7d")}</option>
              <option value={30}>{t("admin.period_30d")}</option>
              <option value={60}>{t("admin.period_60d")}</option>
              <option value={90}>{t("admin.period_90d")}</option>
            </select>
            <button onClick={loadMargin} disabled={marginLoading}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-all duration-200 disabled:opacity-50">
              {marginLoading ? t("admin.loading") : t("admin.generate")}
            </button>
            <button onClick={() => downloadCsv("/api/reports/export/margin", `margin-report.csv`)}
              className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-sm font-medium transition-all duration-200">
              {t("admin.export_csv")}
            </button>
          </div>
          {marginError && (
            <div className="mb-4 p-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-300 text-sm rounded-xl">{marginError} <button onClick={loadMargin} className="underline ml-2">{t("admin.retry")}</button></div>
          )}
          {margin && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label={t("admin.revenue")} value={formatCurrency(margin.summary.totalRevenue)} color="emerald" />
                <StatCard label={t("admin.cost")} value={formatCurrency(margin.summary.totalCost)} color="rose" />
                <StatCard label={t("admin.margin")} value={formatCurrency(margin.summary.totalMargin)} color="indigo" />
                <StatCard label={t("admin.margin_pct")} value={formatPct(margin.summary.marginPct)} color="violet" />
              </div>
              <div className="data-card p-5 rounded-xl">
                <p className="font-semibold mb-3">{t("admin.by_category")}</p>
                <div className="space-y-2">
                  {margin.byCategory.map(c => (
                    <div key={c.category} className="flex items-center justify-between text-sm">
                      <span className="font-medium">{c.category}</span>
                      <div className="flex gap-4">
                        <span className="opacity-50">{formatCurrency(c.revenue)}</span>
                        <span className={c.margin >= 0 ? "text-emerald-400" : "text-rose-400"}>{formatCurrency(c.margin)} ({formatPct(c.marginPct)})</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="data-card p-5 rounded-xl overflow-auto">
                <p className="font-semibold mb-3">{t("admin.by_product")}</p>
                <table className="w-full text-sm">
                  <thead><tr className="text-left opacity-50">
                    <th className="pb-2 pr-4">{t("admin.product_col")}</th><th className="pb-2 pr-4">{t("admin.category_col")}</th><th className="pb-2 pr-4">{t("admin.qty_col")}</th>
                    <th className="pb-2 pr-4">{t("admin.revenue_col")}</th><th className="pb-2 pr-4">{t("admin.cost_col")}</th><th className="pb-2 pr-4">{t("admin.margin_col")}</th><th className="pb-2">{t("admin.pct_col")}</th>
                  </tr></thead>
                  <tbody>
                    {margin.byProduct.slice(0, 50).map(p => (
                      <tr key={p.productId} className="border-t border-white/5">
                        <td className="py-2 pr-4">{p.name}</td>
                        <td className="py-2 pr-4 opacity-50">{p.category}</td>
                        <td className="py-2 pr-4">{p.quantity}</td>
                        <td className="py-2 pr-4">{formatCurrency(p.revenue)}</td>
                        <td className="py-2 pr-4">{formatCurrency(p.cost)}</td>
                        <td className={`py-2 pr-4 ${p.margin >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{formatCurrency(p.margin)}</td>
                        <td className="py-2">{formatPct(p.marginPct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {!margin && !marginLoading && <p className="text-sm opacity-50 py-8 text-center">{t("admin.select_period")}</p>}
        </div>
      )}

      {/* Debt Aging Tab */}
      {activeTab === "debt" && (
        <div>
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <button onClick={loadDebtAging} disabled={debtLoading}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-all duration-200 disabled:opacity-50">
              {debtLoading ? t("admin.loading") : t("admin.refresh")}
            </button>
            <button onClick={() => downloadCsv("/api/reports/export/debt-aging", `debt-aging-${new Date().toISOString().slice(0, 10)}.csv`)}
              className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-sm font-medium transition-all duration-200">
              {t("admin.export_csv")}
            </button>
          </div>
          {debtError && (
            <div className="mb-4 p-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-300 text-sm rounded-xl">{debtError} <button onClick={loadDebtAging} className="underline ml-2">{t("admin.retry")}</button></div>
          )}
          {debt && (
            <div className="space-y-4">
              <StatCard label={t("admin.total_outstanding")} value={formatCurrency(debt.totalOutstanding)} color={debt.totalOutstanding > 0 ? "rose" : "emerald"} />
              {debt.customers.length === 0 ? (
                <p className="text-sm opacity-50 py-4 text-center">{t("admin.no_outstanding")}</p>
              ) : (
                <div className="data-card p-5 rounded-xl overflow-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left opacity-50">
                      <th className="pb-2 pr-4">{t("admin.customer_col")}</th><th className="pb-2 pr-4">{t("admin.mobile_col")}</th><th className="pb-2 pr-4">{t("admin.outstanding_col")}</th>
                      <th className="pb-2 pr-4">{t("admin.credit_limit_col")}</th><th className="pb-2 pr-4">{t("admin.current_col")}</th><th className="pb-2 pr-4">{t("admin.days_31_60")}</th>
                      <th className="pb-2 pr-4">{t("admin.days_61_90")}</th><th className="pb-2">{t("admin.days_90_plus")}</th>
                    </tr></thead>
                    <tbody>
                      {debt.customers.map(c => (
                        <tr key={c.customerId} className="border-t border-white/5">
                          <td className="py-2 pr-4 font-medium">{c.name}</td>
                          <td className="py-2 pr-4 opacity-50">{c.mobile || "-"}</td>
                          <td className={`py-2 pr-4 font-bold ${c.outstanding > (c.creditLimit || 99999) ? "text-rose-400" : "text-emerald-400"}`}>{formatCurrency(c.outstanding)}</td>
                          <td className="py-2 pr-4">{formatCurrency(c.creditLimit)}</td>
                          <td className="py-2 pr-4">{formatCurrency(c.current)}</td>
                          <td className="py-2 pr-4 text-amber-400">{formatCurrency(c.days30)}</td>
                          <td className="py-2 pr-4 text-orange-400">{formatCurrency(c.days60)}</td>
                          <td className="py-2 text-rose-400">{formatCurrency(c.days90)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          {!debt && !debtLoading && <p className="text-sm opacity-50 py-8 text-center">{t("admin.select_refresh")}</p>}
        </div>
      )}
    </div>
  )
}
