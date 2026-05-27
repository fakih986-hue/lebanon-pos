import { useEffect, useState } from "react"
import { api } from "../app/api"

type Customer = {
  id: string
  name: string
  mobile: string
  totalSpent: number
  debtBalance: number
  createdAt: string
}

type PullResponse = {
  customers: Customer[]
  products: unknown[]
}

export function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api<PullResponse>("/api/sync/pull?since=")
      .then(data => setCustomers(data.customers ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <p className="text-zinc-500">Loading...</p>

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Customers</h1>
      {customers.length === 0 ? <p className="text-zinc-400">No customers yet.</p> : (
        <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="text-zinc-500 border-b bg-zinc-50"><th className="text-left p-3">Name</th><th className="text-left p-3">Mobile</th><th className="text-right p-3">Spent</th><th className="text-right p-3">Debt</th><th className="text-right p-3">Since</th></tr></thead>
            <tbody>
              {customers.map(c => (
                <tr key={c.id} className="border-b border-zinc-100 hover:bg-zinc-50">
                  <td className="p-3 font-medium">{c.name}</td>
                  <td className="p-3 text-zinc-500">{c.mobile}</td>
                  <td className="p-3 text-right">${c.totalSpent?.toFixed(2)}</td>
                  <td className="p-3 text-right">{c.debtBalance > 0 ? <span className="text-red-600">${c.debtBalance.toFixed(2)}</span> : "-"}</td>
                  <td className="p-3 text-right text-zinc-400">{new Date(c.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
