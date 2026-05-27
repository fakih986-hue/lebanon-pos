import { useEffect, useState } from "react"
import { api } from "../app/api"

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
  Cash: "#10b981", Card: "#3b82f6", "Mobile Wallet": "#8b5cf6", Credit: "#f59e0b", Transfer: "#06b6d4",
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function formatCurrency(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function TrendChart({ data }: { data: KpiData["salesTrend"] }) {
  const max = Math.max(...data.map(d => d.total), 1)
  return (
    <div className="flex items-end gap-[2px] h-32">
      {data.map((d, i) => {
        const pct = (d.total / max) * 100
        const day = new Date(d.date).getDay()
        return (
          <div key={d.date} className="flex-1 flex flex-col items-center gap-0.5 group relative">
            <div className="w-full bg-blue-100 rounded-t transition-all duration-300 hover:bg-blue-300 cursor-pointer"
              style={{ height: `${Math.max(pct, 2)}%`, minHeight: d.total > 0 ? undefined : "2px" }} />
            <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-zinc-800 text-white text-[10px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none transition-opacity">
              {formatCurrency(d.total)} ({d.count})
            </div>
            {i % 5 === 0 && <span className="text-[8px] text-zinc-400 mt-0.5">{DAY_NAMES[day]}</span>}
          </div>
        )
      })}
    </div>
  )
}

function StatCard({ icon, label, value, sub, color }: { icon: string; label: string; value: string; sub: string; color: string }) {
  return (
    <div className="rounded-xl p-5 text-white flex items-start gap-4 shadow-lg" style={{ background: color }}>
      <span className="text-3xl">{icon}</span>
      <div className="min-w-0">
        <p className="text-white/80 text-xs uppercase tracking-wider font-medium">{label}</p>
        <p className="text-2xl font-bold mt-0.5 truncate">{value}</p>
        <p className="text-white/70 text-[11px] mt-0.5">{sub}</p>
      </div>
    </div>
  )
}

export function DashboardPage() {
  const [data, setData] = useState<KpiData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    api<KpiData>("/api/dashboard/kpi")
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-zinc-400 flex items-center gap-2">
        <span className="inline-block w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        Loading dashboard...
      </div>
    </div>
  )
  if (error) return <div className="text-red-600 bg-red-50 p-4 rounded-xl border border-red-200">{error}</div>
  if (!data) return null

  const totalRevenue = data.salesTrend.reduce((s, d) => s + d.total, 0)
  const totalTx = data.salesTrend.reduce((s, d) => s + d.count, 0)
  const avgTx = totalTx > 0 ? totalRevenue / totalTx : 0
  const totalProfit30 = data.salesTrend.reduce((s, d) => {
    const ratio = data.today.revenue > 0 ? (d.total / data.today.revenue) * data.today.profit : 0
    return s + (isFinite(ratio) ? ratio : 0)
  }, 0)
  // approximate profit for the last 30 days using trend proportion
  const estProfit = data.month.revenue > 0 ? totalRevenue * (data.month.profit / data.month.revenue) : 0

  const maxHour = Math.max(...data.hourlyDistribution.map(h => h.count), 1)
  const peakHour = data.hourlyDistribution.reduce((best, h) => h.count > best.count ? h : best, { hour: 0, count: 0 })

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Dashboard</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Your business at a glance</p>
        </div>
      </div>

      {/* Big stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon="💰" label="30-Day Revenue" value={formatCurrency(totalRevenue)} sub={`${totalTx} transactions`} color="linear-gradient(135deg, #3b82f6, #1d4ed8)" />
        <StatCard icon="📊" label="Avg Transaction" value={formatCurrency(avgTx)} sub="Per sale" color="linear-gradient(135deg, #8b5cf6, #6d28d9)" />
        <StatCard icon="📈" label="Est. Profit (30d)" value={formatCurrency(estProfit)} sub={`${data.month.count} this month`} color="linear-gradient(135deg, #10b981, #047857)" />
        <StatCard icon="🏪" label="Peak Hour Today" value={`${peakHour.hour}:00`} sub={`${peakHour.count} sales`} color="linear-gradient(135deg, #f59e0b, #d97706)" />
      </div>

      {/* Period summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {(["today", "week", "month"] as const).map(period => {
          const p = data[period]
          const label = period === "today" ? "Today" : period === "week" ? "This Week" : "This Month"
          return (
            <div key={period} className="bg-white p-5 rounded-xl border border-zinc-200 hover:shadow-md transition-shadow">
              <p className="text-xs text-zinc-400 uppercase tracking-wider font-medium">{label}</p>
              <p className="text-xl font-bold mt-1 text-zinc-900">{formatCurrency(p.revenue)}</p>
              <div className="flex items-center gap-3 mt-1.5 text-xs text-zinc-500">
                <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-blue-500" />{p.count} sales</span>
                <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />{formatCurrency(p.profit)} profit</span>
              </div>
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 30-day sales trend */}
        <div className="lg:col-span-2 bg-white p-5 rounded-xl border border-zinc-200">
          <h2 className="font-semibold text-zinc-900 mb-4">30-Day Sales Trend</h2>
          <TrendChart data={data.salesTrend} />
          <div className="flex items-center justify-between mt-3 text-[10px] text-zinc-400">
            <span>{new Date(data.salesTrend[0]?.date ?? "").toLocaleDateString()}</span>
            <span>{new Date(data.salesTrend[data.salesTrend.length - 1]?.date ?? "").toLocaleDateString()}</span>
          </div>
        </div>

        {/* Payment Breakdown */}
        <div className="bg-white p-5 rounded-xl border border-zinc-200">
          <h2 className="font-semibold text-zinc-900 mb-4">Payment Methods</h2>
          <div className="space-y-3">
            {data.paymentBreakdown.map(pm => {
              const color = PAYMENT_COLORS[pm.method] || "#a1a1aa"
              const pct = totalRevenue > 0 ? (pm.total / totalRevenue) * 100 : 0
              return (
                <div key={pm.method}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                      <span className="text-zinc-700 font-medium">{pm.method}</span>
                    </span>
                    <span className="font-semibold text-zinc-900">{formatCurrency(pm.total)}</span>
                  </div>
                  <div className="w-full h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: color }} />
                  </div>
                  <p className="text-[10px] text-zinc-400 mt-0.5">{pm.count} transactions &middot; {pct.toFixed(1)}%</p>
                </div>
              )
            })}
            {data.paymentBreakdown.length === 0 && <p className="text-sm text-zinc-400">No payment data yet.</p>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Hourly distribution */}
        <div className="bg-white p-5 rounded-xl border border-zinc-200">
          <h2 className="font-semibold text-zinc-900 mb-3">Today's Sales by Hour</h2>
          <div className="flex items-end gap-1 h-24">
            {data.hourlyDistribution.map(h => {
              const pct = (h.count / maxHour) * 100
              const isPeak = h.hour === peakHour.hour
              return (
                <div key={h.hour} className="flex-1 flex flex-col items-center gap-0.5 group relative">
                  <div
                    className={`w-full rounded-t transition-all cursor-pointer ${isPeak ? "bg-amber-400" : "bg-blue-200 hover:bg-blue-300"}`}
                    style={{ height: `${Math.max(pct, 2)}%` }}
                  />
                  <span className="text-[7px] text-zinc-400">{h.hour}</span>
                </div>
              )
            })}
          </div>
          <p className="text-xs text-zinc-400 mt-2 text-center">Peak at <strong className="text-zinc-700">{peakHour.hour}:00</strong> ({peakHour.count} sales)</p>
        </div>

        {/* Top Products */}
        <div className="bg-white p-5 rounded-xl border border-zinc-200">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-zinc-900">Top Products</h2>
            <span className="text-[10px] text-zinc-400">by revenue</span>
          </div>
          <div className="space-y-2.5">
            {data.topProducts.slice(0, 6).map((p, i) => {
              const maxTop = Math.max(...data.topProducts.map(x => x.total), 1)
              const pct = (p.total / maxTop) * 100
              return (
                <div key={p.name}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-700 truncate flex items-center gap-1.5">
                      <span className="text-[10px] font-mono text-zinc-400 w-4">#{i + 1}</span>
                      {p.name}
                    </span>
                    <span className="font-medium text-zinc-900 text-xs">{formatCurrency(p.total)}</span>
                  </div>
                  <div className="w-full h-1.5 bg-zinc-100 rounded-full mt-1 overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-purple-500 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-[10px] text-zinc-400 mt-0.5 ml-5">{p.quantity} sold &middot; {p.barcode}</p>
                </div>
              )
            })}
            {data.topProducts.length === 0 && <p className="text-sm text-zinc-400">No sales yet.</p>}
          </div>
        </div>

        {/* Low Stock Alerts */}
        <div className="bg-white p-5 rounded-xl border border-zinc-200">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-zinc-900">Low Stock Alerts</h2>
            {data.lowStock.length > 0 && (
              <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">{data.lowStock.length} items</span>
            )}
          </div>
          {data.lowStock.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 text-zinc-400">
              <span className="text-3xl mb-2">✅</span>
              <p className="text-sm font-medium text-zinc-500">All stocked up!</p>
              <p className="text-xs">No low stock items</p>
            </div>
          ) : (
            <div className="space-y-2">
              {data.lowStock.map(p => (
                <div key={p.barcode} className="flex items-center justify-between text-sm py-1.5 border-b border-zinc-50 last:border-0">
                  <div className="min-w-0">
                    <p className="text-zinc-700 truncate font-medium">{p.name}</p>
                    <p className="text-[10px] text-zinc-400">{p.category} &middot; {p.barcode}</p>
                  </div>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${p.stock === 0 ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                    {p.stock}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Top Customers + Recent Sales */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Customers */}
        <div className="bg-white p-5 rounded-xl border border-zinc-200">
          <h2 className="font-semibold text-zinc-900 mb-3">Top Customers</h2>
          {data.topCustomers.length === 0 ? (
            <p className="text-sm text-zinc-400">No customer data yet. Start adding customer names to sales!</p>
          ) : (
            <div className="space-y-2">
              {data.topCustomers.map((c, i) => (
                <div key={c.name} className="flex items-center justify-between text-sm py-1.5 border-b border-zinc-50 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-zinc-100 flex items-center justify-center text-xs font-bold text-zinc-500">{i + 1}</span>
                    <span className="text-zinc-700 font-medium">{c.name}</span>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-zinc-900">{formatCurrency(c.total)}</p>
                    <p className="text-[10px] text-zinc-400">{c.count} orders</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Sales */}
        <div className="bg-white p-5 rounded-xl border border-zinc-200">
          <h2 className="font-semibold text-zinc-900 mb-3">Recent Sales</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-zinc-400 text-[10px] uppercase tracking-wider border-b border-zinc-100">
                  <th className="text-left py-2 font-medium">Order</th>
                  <th className="text-right py-2 font-medium">Total</th>
                  <th className="text-right py-2 font-medium">Payment</th>
                  <th className="text-right py-2 font-medium">Cashier</th>
                  <th className="text-right py-2 font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {data.recentSales.map(s => (
                  <tr key={s.number} className="border-b border-zinc-50 hover:bg-zinc-50/50 transition-colors">
                    <td className="py-2.5 pr-2 font-medium text-zinc-800 text-xs">{s.number}</td>
                    <td className="py-2.5 px-2 text-right font-semibold">{formatCurrency(s.total)}</td>
                    <td className="py-2.5 px-2 text-right">
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium">{s.paymentMethod}</span>
                    </td>
                    <td className="py-2.5 px-2 text-right text-zinc-500 text-xs">{s.cashier}</td>
                    <td className="py-2.5 pl-2 text-right text-zinc-400 text-[10px] whitespace-nowrap">{new Date(s.time).toLocaleString()}</td>
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
