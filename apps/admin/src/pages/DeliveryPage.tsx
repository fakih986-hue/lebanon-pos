import { useEffect, useState } from "react"
import { api } from "../app/api"

type DeliveryOrder = {
  id: string
  orderNumber: string
  status: string
  customerName: string
  customerPhone: string
  address: string
  itemsTotal: number
  deliveryFee: number
  total: number
  paymentMethod: string
  paidAmount: number
  assignedName: string | null
  deliveryNote: string
  notes: string
  cancelledReason: string
  createdAt: string
  items: Array<{ id: string; productName: string; quantity: number; unitPrice: number; total: number }>
}

const STATUS_ORDER = ["Pending", "Confirmed", "Preparing", "OutForDelivery", "Delivered", "Cancelled"]
const STATUS_COLORS: Record<string, string> = {
  Pending: "bg-yellow-100 text-yellow-800",
  Confirmed: "bg-blue-100 text-blue-800",
  Preparing: "bg-indigo-100 text-indigo-800",
  OutForDelivery: "bg-purple-100 text-purple-800",
  Delivered: "bg-green-100 text-green-800",
  Cancelled: "bg-red-100 text-red-800",
}

export function DeliveryPage() {
  const [orders, setOrders] = useState<DeliveryOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState("All")
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [assignInputs, setAssignInputs] = useState<Record<string, string>>({})

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const params = statusFilter !== "All" ? `?status=${statusFilter}` : ""
      const data = await api<DeliveryOrder[]>(`/api/delivery/orders${params}`)
      setOrders(data)
    } catch { /* ignore */ }
    setLoading(false)
  }

  async function updateStatus(id: string, status: string) {
    try {
      const updated = await api<DeliveryOrder>(`/api/delivery/orders/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      })
      setOrders(orders.map(o => o.id === id ? updated : o))
    } catch { /* ignore */ }
  }

  async function assignDriver(id: string) {
    const name = assignInputs[id]?.trim()
    if (!name) return
    try {
      const updated = await api<DeliveryOrder>(`/api/delivery/orders/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ assignedName: name }),
      })
      setOrders(orders.map(o => o.id === id ? updated : o))
      setAssignInputs(prev => ({ ...prev, [id]: "" }))
    } catch { /* ignore */ }
  }

  const nextStatus = (current: string) => {
    const idx = STATUS_ORDER.indexOf(current)
    if (idx >= STATUS_ORDER.length - 2) return null
    return STATUS_ORDER[idx + 1]
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Delivery Orders</h1>
        <div className="flex gap-2 items-center">
          <a href="/driver" target="_blank"
            className="text-xs px-3 py-1.5 bg-emerald-100 text-emerald-700 rounded-lg hover:bg-emerald-200 font-medium no-underline">
            Driver App ↗
          </a>
          <a href="/order" target="_blank"
            className="text-xs px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 font-medium no-underline">
            Customer Order ↗
          </a>
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); load() }}
            className="text-sm border border-zinc-300 rounded-lg px-2 py-1.5">
            <option value="All">All</option>
            {STATUS_ORDER.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={load} className="text-sm px-3 py-1.5 bg-zinc-100 rounded-lg hover:bg-zinc-200">Refresh</button>
        </div>
      </div>

      {loading ? <p className="text-zinc-500">Loading...</p> : orders.length === 0 ? (
        <p className="text-zinc-400">No delivery orders found.</p>
      ) : (
        <div className="space-y-2">
          {orders.map(order => (
            <div key={order.id} className="bg-white rounded-lg border border-zinc-200 overflow-hidden">
              <div className="p-4 flex items-center gap-4 cursor-pointer" onClick={() => setExpandedId(expandedId === order.id ? null : order.id)}>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{order.orderNumber}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[order.status] || ""}`}>{order.status}</span>
                  </div>
                  <p className="text-sm text-zinc-500 mt-0.5">{order.customerName} · {order.customerPhone} · {order.address}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold">${order.total.toFixed(2)}</p>
                  <p className="text-xs text-zinc-400">{new Date(order.createdAt).toLocaleDateString()}</p>
                </div>
              </div>

              {expandedId === order.id && (
                <div className="border-t border-zinc-100 p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <span className="text-zinc-500">Items: {order.items.length}</span>
                    <span className="text-zinc-500">Delivery Fee: ${order.deliveryFee.toFixed(2)}</span>
                    <span className="text-zinc-500">Payment: {order.paymentMethod}</span>
                    <span className="text-zinc-500">Paid: ${order.paidAmount.toFixed(2)}</span>
                    {order.assignedName && <span className="text-zinc-500">Driver: <strong>{order.assignedName}</strong></span>}
                    {order.deliveryNote && <span className="col-span-2 text-zinc-500">Note: {order.deliveryNote}</span>}
                  </div>

                  {/* Assign driver */}
                  {order.status !== "Delivered" && order.status !== "Cancelled" && (
                    <div className="flex gap-2 items-center">
                      <input
                        value={assignInputs[order.id] ?? ""}
                        onChange={e => setAssignInputs(prev => ({ ...prev, [order.id]: e.target.value }))}
                        placeholder="Driver name..."
                        className="flex-1 px-3 py-1.5 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        onClick={() => assignDriver(order.id)}
                        disabled={!assignInputs[order.id]?.trim()}
                        className="text-sm px-3 py-1.5 bg-zinc-800 text-white rounded-lg hover:bg-zinc-700 disabled:opacity-50 whitespace-nowrap"
                      >
                        Assign Driver
                      </button>
                    </div>
                  )}

                  <table className="w-full text-sm">
                    <thead><tr className="text-zinc-500 border-b"><th className="text-left py-1">Item</th><th className="text-right py-1">Qty</th><th className="text-right py-1">Price</th><th className="text-right py-1">Total</th></tr></thead>
                    <tbody>
                      {order.items.map(item => (
                        <tr key={item.id} className="border-b border-zinc-50">
                          <td className="py-1">{item.productName}</td>
                          <td className="text-right py-1">{item.quantity}</td>
                          <td className="text-right py-1">${item.unitPrice.toFixed(2)}</td>
                          <td className="text-right py-1">${item.total.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {order.status !== "Delivered" && order.status !== "Cancelled" && (
                    <div className="flex gap-2">
                      {nextStatus(order.status) && (
                        <button onClick={() => updateStatus(order.id, nextStatus(order.status)!)}
                          className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                          Mark {nextStatus(order.status)}
                        </button>
                      )}
                      <button onClick={() => updateStatus(order.id, "Cancelled")}
                        className="text-sm px-3 py-1.5 bg-red-100 text-red-700 rounded-lg hover:bg-red-200">
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
