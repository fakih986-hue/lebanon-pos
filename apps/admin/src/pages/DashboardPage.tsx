import { useEffect, useState } from "react"
import { api } from "../app/api"
import { useI18n } from "@lebanonpos/shared"

type KpiData = {
  today: { count: number; revenue: number; profit: number }
  week: { count: number; revenue: number; profit: number }
  month: { count: number; revenue: number; profit: number }
  paymentBreakdown: Array<{ method: string; total: number; count: number }>
  topProducts: Array<{ name: string; barcode: string; quantity: number; total: number }>
  recentSales: Array<{ number: string; total: number; paymentMethod: string; cashier: string; time: string; items: number }>
  salesTrend: Array<{ date: string; total: number; count: number }>
  lowStock: Array<{ name: string; barcode: string; stock: number; category: string }>
  topCustomers: Array<{ name: string; total: number; count: number }>
  hourlyDistribution: Array<{ hour: number; count: number }>
}

const PAYMENT_COLORS: Record<string, string> = {
  Cash: "#10b981", Card: "#6366f1", "Mobile Wallet": "#8b5cf6", Credit: "#f59e0b", Transfer: "#06b6d4",
}

function formatCurrency(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function TrendChart({ data }: { data: KpiData["salesTrend"] }) {
  const max = Math.max(...data.map(d => d.total), 1)
  return (
    <div className="flex items-end gap-[3px] h-36 mt-2">
      {data.map((d, i) => {
        const pct = (d.total / max) * 100
        const day = new Date(d.date).getDay()
        return (
          <div key={d.date} className="flex-1 flex flex-col items-center gap-0.5 group relative">
            <div className="w-full rounded-t-lg relative overflow-hidden cursor-pointer transition-all duration-300 hover:scale-y-110 hover:origin-bottom"
              style={{ height: `${Math.max(pct, 3)}%`, background: `linear-gradient(180deg, #818cf8 0%, #6366f1 50%, #4f46e5 100%)` }}>
              <div className="absolute inset-0 bg-gradient-to-t from-white/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <div className="absolute -top-9 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[10px] font-medium px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none transition-all duration-200 shadow-lg z-10">
              {formatCurrency(d.total)} · {d.count} sales
            </div>
            {i % 5 === 0 && <span className="text-[8px] text-slate-400 mt-0.5 font-medium">{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][day]}</span>}
          </div>
        )
      })}
    </div>
  )
}

function StatCard({ icon, label, value, sub, gradient, delay }: { icon: React.ReactNode; label: string; value: string; sub: string; gradient: string; delay?: string }) {
  return (
    <div className="stat-card animate-slide-up" style={{ background: gradient, animationDelay: delay || "0s" }}>
      <div className="relative z-10 flex items-start gap-4">
        <div className="w-12 h-12 rounded-2xl bg-white/15 flex items-center justify-center backdrop-blur-sm shrink-0">{icon}</div>
        <div className="min-w-0">
          <p className="text-white/70 text-[11px] uppercase tracking-widest font-semibold">{label}</p>
          <p className="text-2xl font-bold mt-1 tracking-tight">{value}</p>
          <p className="text-white/60 text-[11px] mt-1">{sub}</p>
        </div>
      </div>
    </div>
  )
}

function Skeleton({ className }: { className?: string }) {
  return <div className={`loading-skeleton ${className || ""}`} />
}

function LoadingDashboard() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1,2,3,4].map(i => <Skeleton key={i} className="h-32 rounded-2xl" />)}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1,2,3].map(i => <Skeleton key={i} className="h-24 rounded-2xl" />)}
      </div>
    </div>
  )
}

export function DashboardPage() {
  const { t } = useI18n()
  const [data, setData] = useState<KpiData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    api<KpiData>("/api/dashboard/kpi")
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <LoadingDashboard />
  if (error) return (
    <div className="flex items-center justify-center h-64">
      <div className="bg-rose-50 border border-rose-200 rounded-2xl p-6 text-center max-w-md">
        <div className="text-4xl mb-3">⚠️</div>
        <p className="text-rose-700 font-medium mb-1">{t("dashboard.failed_to_load")}</p>
        <p className="text-rose-500 text-sm">{error}</p>
      </div>
    </div>
  )
  if (!data) return null

  const totalRevenue = data.salesTrend.reduce((s, d) => s + d.total, 0)
  const totalTx = data.salesTrend.reduce((s, d) => s + d.count, 0)
  const avgTx = totalTx > 0 ? totalRevenue / totalTx : 0
  const estProfit = data.month.revenue > 0 ? totalRevenue * (data.month.profit / data.month.revenue) : 0
  const maxHour = Math.max(...data.hourlyDistribution.map(h => h.count), 1)
  const peakHour = data.hourlyDistribution.reduce((best, h) => h.count > best.count ? h : best, { hour: 0, count: 0 })

  const statCards = [
    { icon: <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>, label: t("dashboard.revenue_30d"), value: formatCurrency(totalRevenue), sub: `${totalTx} ${t("dashboard.transactions")}`, gradient: "linear-gradient(135deg, #4f46e5, #7c3aed)", delay: "0s" },
    { icon: <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>, label: t("dashboard.avg_transaction"), value: formatCurrency(avgTx), sub: t("dashboard.per_sale"), gradient: "linear-gradient(135deg, #0891b2, #6366f1)", delay: "0.1s" },
    { icon: <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>, label: t("dashboard.est_profit"), value: formatCurrency(estProfit), sub: `${data.month.count} ${t("dashboard.this_month")}`, gradient: "linear-gradient(135deg, #059669, #10b981)", delay: "0.2s" },
    { icon: <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>, label: t("dashboard.peak_hour"), value: `${peakHour.hour}:00`, sub: `${peakHour.count} ${t("dashboard.sales_at_peak")}`, gradient: "linear-gradient(135deg, #d97706, #f59e0b)", delay: "0.3s" },
  ]

  return (
    <div className="space-y-8 pb-12">
      <div className="flex items-center justify-between">
        <div className="animate-fade-in">
          <h1 className="text-3xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>{t("dashboard.title")}</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>{t("dashboard.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-glow" />
          {t("dashboard.live")}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {statCards.map((card, i) => <StatCard key={i} {...card} />)}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {(["today", "week", "month"] as const).map((period, i) => {
          const p = data[period]
          const label = period === "today" ? t("dashboard.today") : period === "week" ? t("dashboard.this_week") : t("dashboard.this_month_title")
          return (
            <div key={period} className="data-card animate-slide-up flex items-center gap-5" style={{ animationDelay: `${i * 0.05}s` }}>
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${period === "today" ? "bg-indigo-50 text-indigo-600" : period === "week" ? "bg-violet-50 text-violet-600" : "bg-emerald-50 text-emerald-600"}`}>
                {period === "today" ? (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 4v12l-4-2-4 2V4M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                ) : period === "week" ? (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                ) : (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                )}
              </div>
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wider font-semibold" style={{ color: "var(--text-muted)" }}>{label}</p>
                <p className="text-xl font-bold mt-0.5" style={{ color: "var(--text-primary)" }}>{formatCurrency(p.revenue)}</p>
                <div className="flex items-center gap-3 mt-1">
                  <span className="flex items-center gap-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" /> {p.count} {t("dashboard.sales")}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-emerald-600">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> {formatCurrency(p.profit)} {t("dashboard.profit")}
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 data-card">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold" style={{ color: "var(--text-primary)" }}>{t("dashboard.sales_trend")}</h2>
            <div className="flex items-center gap-2 text-[10px]" style={{ color: "var(--text-muted)" }}>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-indigo-500" /> {t("dashboard.revenue")}</span>
            </div>
          </div>
          <TrendChart data={data.salesTrend} />
          <div className="flex items-center justify-between mt-4 text-[10px]" style={{ color: "var(--text-muted)" }}>
            <span className="font-medium">{new Date(data.salesTrend[0]?.date ?? "").toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
            <span className="font-medium">{new Date(data.salesTrend[data.salesTrend.length - 1]?.date ?? "").toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
          </div>
        </div>

        <div className="data-card">
          <h2 className="font-semibold mb-5" style={{ color: "var(--text-primary)" }}>{t("dashboard.payment_methods")}</h2>
          <div className="space-y-4">
            {data.paymentBreakdown.map(pm => {
              const color = PAYMENT_COLORS[pm.method] || "#94a3b8"
              const pct = totalRevenue > 0 ? (pm.total / totalRevenue) * 100 : 0
              return (
                <div key={pm.method}>
                  <div className="flex items-center justify-between text-sm mb-1.5">
                    <span className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                      <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>{pm.method}</span>
                    </span>
                    <span className="font-semibold" style={{ color: "var(--text-primary)" }}>{formatCurrency(pm.total)}</span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 dark:bg-white/[0.06] rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-700 ease-out" style={{ width: `${Math.min(pct, 100)}%`, background: `linear-gradient(90deg, ${color}, ${color}88)` }} />
                  </div>
                  <p className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>{pm.count} {t("dashboard.transactions_count")} · {pct.toFixed(1)}%</p>
                </div>
              )
            })}
            {data.paymentBreakdown.length === 0 && <p className="text-sm" style={{ color: "var(--text-muted)" }}>{t("dashboard.no_payment_data")}</p>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="data-card">
          <h2 className="font-semibold mb-4" style={{ color: "var(--text-primary)" }}>{t("dashboard.hourly_sales")}</h2>
          <div className="flex items-end gap-1 h-28">
            {data.hourlyDistribution.map(h => {
              const pct = (h.count / maxHour) * 100
              const isPeak = h.hour === peakHour.hour
              return (
                <div key={h.hour} className="flex-1 flex flex-col items-center gap-0.5 group relative">
                  <div className={`w-full rounded-t-lg transition-all duration-300 cursor-pointer ${isPeak ? "bg-amber-400" : "bg-indigo-200 dark:bg-indigo-500/30 hover:bg-indigo-300 dark:hover:bg-indigo-500/50"}`}
                    style={{ height: `${Math.max(pct, 2)}%` }}>
                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-slate-900 dark:bg-slate-800 text-white text-[9px] px-1.5 py-0.5 rounded-lg opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none transition-opacity z-10">
                      {h.count} {t("dashboard.sales")}
                    </div>
                  </div>
                  <span className="text-[7px] font-medium" style={{ color: "var(--text-muted)" }}>{h.hour}</span>
                </div>
              )
            })}
          </div>
          <div className="mt-4 pt-4 border-t" style={{ borderColor: "var(--border-card)" }}>
            <p className="text-xs text-center" style={{ color: "var(--text-secondary)" }}>
              {t("dashboard.peak_at")} <span className="font-bold" style={{ color: "var(--text-primary)" }}>{peakHour.hour}:00</span> · {peakHour.count} {t("dashboard.sales")}
            </p>
          </div>
        </div>

        <div className="data-card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold" style={{ color: "var(--text-primary)" }}>{t("dashboard.top_products")}</h2>
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{t("dashboard.by_revenue")}</span>
          </div>
          <div className="space-y-3">
            {data.topProducts.slice(0, 6).map((p, i) => {
              const maxTop = Math.max(...data.topProducts.map(x => x.total), 1)
              const pct = (p.total / maxTop) * 100
              return (
                <div key={p.name}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="truncate flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
                      <span className={`w-5 h-5 rounded-lg flex items-center justify-center text-[10px] font-bold ${i < 3 ? 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300' : 'bg-slate-100 dark:bg-white/[0.06] text-slate-500 dark:text-slate-400'}`}>{i + 1}</span>
                      {p.name}
                    </span>
                    <span className="font-semibold text-xs" style={{ color: "var(--text-primary)" }}>{formatCurrency(p.total)}</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-100 dark:bg-white/[0.06] rounded-full mt-1.5 overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-700" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-[10px] mt-0.5 ml-7" style={{ color: "var(--text-muted)" }}>{p.quantity} {t("dashboard.sold")} · {p.barcode}</p>
                </div>
              )
            })}
            {data.topProducts.length === 0 && <p className="text-sm" style={{ color: "var(--text-muted)" }}>{t("dashboard.no_sales")}</p>}
          </div>
        </div>

        <div className="data-card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold" style={{ color: "var(--text-primary)" }}>{t("dashboard.stock_alerts")}</h2>
            {data.lowStock.length > 0 && (
              <span className="text-[10px] bg-rose-100 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300 px-2.5 py-0.5 rounded-full font-semibold">{data.lowStock.length} {t("dashboard.low")}</span>
            )}
          </div>
          {data.lowStock.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10" style={{ color: "var(--text-muted)" }}>
              <div className="w-16 h-16 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <p className="text-sm font-semibold" style={{ color: "var(--text-secondary)" }}>{t("dashboard.all_stocked")}</p>
              <p className="text-xs mt-1">{t("dashboard.no_low_stock")}</p>
            </div>
          ) : (
            <div className="space-y-1">
              {data.lowStock.map(p => (
                <div key={p.barcode} className="flex items-center justify-between py-2.5 px-3 rounded-xl hover:bg-rose-50/50 dark:hover:bg-rose-500/5 transition-colors -mx-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>{p.name}</p>
                    <p className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>{p.category} · {p.barcode}</p>
                  </div>
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-lg shrink-0 ${p.stock === 0 ? "bg-rose-100 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300" : "bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}>
                    {p.stock}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="data-card">
          <h2 className="font-semibold mb-5" style={{ color: "var(--text-primary)" }}>{t("dashboard.top_customers")}</h2>
          {data.topCustomers.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>{t("dashboard.no_customer_data")}</p>
          ) : (
            <div className="space-y-3">
              {data.topCustomers.map((c, i) => {
                const initials = c.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
                const colors = ['bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300', 'bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300', 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300', 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300', 'bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300']
                return (
                  <div key={c.name} className="flex items-center justify-between py-2.5 px-3 rounded-xl hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors -mx-3">
                    <div className="flex items-center gap-3">
                      <span className={`w-9 h-9 rounded-xl ${colors[i % 5]} flex items-center justify-center text-xs font-bold shrink-0`}>{initials}</span>
                      <div>
                        <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{c.name}</p>
                        <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{c.count} {t("dashboard.orders")}</p>
                      </div>
                    </div>
                    <span className="font-semibold" style={{ color: "var(--text-primary)" }}>{formatCurrency(c.total)}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="data-card">
          <h2 className="font-semibold mb-5" style={{ color: "var(--text-primary)" }}>{t("dashboard.recent_sales")}</h2>
          <div className="overflow-x-auto -mx-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                  <th className="text-start ps-6 pb-3 font-semibold">{t("dashboard.order")}</th>
                  <th className="text-end pb-3 font-semibold">{t("dashboard.total")}</th>
                  <th className="text-end pb-3 font-semibold">{t("dashboard.payment")}</th>
                  <th className="text-end pb-3 font-semibold">{t("dashboard.cashier")}</th>
                  <th className="text-end pe-6 pb-3 font-semibold">{t("dashboard.time")}</th>
                </tr>
              </thead>
              <tbody>
                {data.recentSales.map(s => (
                  <tr key={s.number} className="table-row">
                    <td className="ps-6 py-3 font-medium text-xs" style={{ color: "var(--text-primary)" }}>{s.number}</td>
                    <td className="py-3 text-end font-semibold" style={{ color: "var(--text-primary)" }}>{formatCurrency(s.total)}</td>
                    <td className="py-3 text-end">
                      <span className={`status-badge ${s.paymentMethod === 'Cash' ? 'status-badge-success' : 'status-badge-info'}`}>
                        {s.paymentMethod}
                      </span>
                    </td>
                    <td className="py-3 text-end text-xs" style={{ color: "var(--text-secondary)" }}>{s.cashier}</td>
                    <td className="pe-6 py-3 text-end text-[10px] whitespace-nowrap" style={{ color: "var(--text-muted)" }}>{new Date(s.time).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
