import { useEffect, useState } from "react"
import { api } from "../app/api"

type KpiData = {
  today: { grossSales: number; netSales: number; transactions: number }
  week: { grossSales: number; netSales: number; transactions: number }
  month: { grossSales: number; netSales: number; transactions: number }
  paymentBreakdown: Array<{ method: string; total: number; count: number }>
  topProducts: Array<{ productName: string; total: number; quantity: number }>
  recentSales: Array<{ orderNumber: string; total: number; paymentMethod: string; createdAt: string }>
  trend: Array<{ date: string; grossSales: number; netSales: number }>
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

  if (loading) return <div className="text-zinc-500">Loading dashboard...</div>
  if (error) return <div className="text-red-600">Error: {error}</div>
  if (!data) return null

  const periods = [
    { label: "Today", ...data.today },
    { label: "This Week", ...data.week },
    { label: "This Month", ...data.month },
  ]

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {periods.map(p => (
          <div key={p.label} className="bg-white p-5 rounded-xl border border-zinc-200">
            <p className="text-sm text-zinc-500">{p.label}</p>
            <p className="text-2xl font-bold mt-1">${p.grossSales.toFixed(2)}</p>
            <p className="text-xs text-zinc-400">{p.transactions} transactions · ${p.netSales.toFixed(2)} net</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-5 rounded-xl border border-zinc-200">
          <h2 className="font-semibold mb-3">Payment Breakdown</h2>
          <div className="space-y-2">
            {data.paymentBreakdown.map(pm => (
              <div key={pm.method} className="flex items-center justify-between text-sm">
                <span className="text-zinc-600">{pm.method}</span>
                <span className="font-medium">${pm.total.toFixed(2)} ({pm.count})</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-zinc-200">
          <h2 className="font-semibold mb-3">Top Products</h2>
          <div className="space-y-2">
            {data.topProducts.slice(0, 5).map(p => (
              <div key={p.productName} className="flex items-center justify-between text-sm">
                <span className="text-zinc-600 truncate">{p.productName}</span>
                <span className="font-medium">${p.total.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-white p-5 rounded-xl border border-zinc-200">
        <h2 className="font-semibold mb-3">Recent Sales</h2>
        <table className="w-full text-sm">
          <thead><tr className="text-zinc-500 border-b"><th className="text-left py-2">Order</th><th className="text-right py-2">Total</th><th className="text-right py-2">Payment</th><th className="text-right py-2">Time</th></tr></thead>
          <tbody>
            {data.recentSales.map(s => (
              <tr key={s.orderNumber} className="border-b border-zinc-50">
                <td className="py-2">{s.orderNumber}</td>
                <td className="text-right py-2">${s.total.toFixed(2)}</td>
                <td className="text-right py-2">{s.paymentMethod}</td>
                <td className="text-right py-2 text-zinc-400">{new Date(s.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
