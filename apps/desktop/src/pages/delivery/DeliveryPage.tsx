import { useEffect, useState } from "react"
import { Search, Truck, MapPin, Phone, User, ChevronDown, ChevronUp } from "lucide-react"
import { useDebounce } from "../../hooks/useDebounce"
import { useHotkeys } from "../../hooks/useHotkey"
import Spinner from "../../components/ui/Spinner"
import EmptyState from "../../components/ui/EmptyState"
import { formatCurrency } from "../../features/pos/lib/currency"
import { showToast } from "../../features/pos/services/toast.service"

type DeliveryOrder = {
  id: string
  orderNumber: string
  status: "Pending" | "Confirmed" | "Preparing" | "OutForDelivery" | "Delivered" | "Cancelled"
  customerName: string
  customerPhone: string
  address: string
  itemsTotal: number
  deliveryFee: number
  total: number
  paymentMethod: string
  paidAmount: number
  assignedTo: string | null
  assignedName: string | null
  deliveryNote: string
  notes: string
  cancelledReason: string
  createdAt: string
  items: Array<{
    id: string
    productName: string
    quantity: number
    unitPrice: number
    total: number
  }>
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

export default function DeliveryPage() {
  const [orders, setOrders] = useState<DeliveryOrder[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("All")
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const debouncedSearch = useDebounce(search, 200)

  useHotkeys("Ctrl+f", (e) => { e.preventDefault(); document.getElementById("deliverySearch")?.focus() })

  useEffect(() => { loadOrders() }, [])

  async function loadOrders() {
    try {
      setIsLoading(true)
      const token = localStorage.getItem("lebanonpos.auth.token")
      const res = await fetch("/api/delivery/orders", {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) setOrders(await res.json())
    } catch { /* offline */ }
    setIsLoading(false)
  }

  async function updateStatus(id: string, status: string) {
    const token = localStorage.getItem("lebanonpos.auth.token")
    try {
      const res = await fetch(`/api/delivery/orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status }),
      })
      if (res.ok) {
        const updated = await res.json()
        setOrders(orders.map(o => o.id === id ? updated : o))
        showToast(`Order marked as ${status}`, "success")
      }
    } catch { showToast("Failed to update order", "error") }
  }

  const nextStatus = (current: string) => {
    const idx = STATUS_ORDER.indexOf(current)
    if (idx >= STATUS_ORDER.length - 2) return null
    return STATUS_ORDER[idx + 1]
  }

  const filtered = orders.filter(o => {
    if (statusFilter !== "All" && o.status !== statusFilter) return false
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase()
      return o.orderNumber.toLowerCase().includes(q) || o.customerName.toLowerCase().includes(q) || o.customerPhone.includes(q)
    }
    return true
  })

  if (isLoading) return <div className="flex items-center justify-center h-64"><Spinner /></div>

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
        <h1 className="text-xl font-bold flex items-center gap-2"><Truck className="w-5 h-5" /> Delivery Orders</h1>
        <div className="flex gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-initial">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input id="deliverySearch" type="text" placeholder="Search orders..." value={search} onChange={e => setSearch(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-sm border border-zinc-300 rounded-lg w-full sm:w-48 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="text-sm border border-zinc-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="All">All Status</option>
            {STATUS_ORDER.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={loadOrders} className="text-sm px-3 py-1.5 bg-zinc-100 rounded-lg hover:bg-zinc-200">Refresh</button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Truck} title="No delivery orders" message={debouncedSearch ? "No orders match your search" : "No orders yet"} />
      ) : (
        <div className="space-y-2">
          {filtered.map(order => (
            <div key={order.id} className="bg-white rounded-lg border border-zinc-200 overflow-hidden">
              <div className="p-3 flex flex-col sm:flex-row sm:items-center gap-2 cursor-pointer" onClick={() => setExpandedId(expandedId === order.id ? null : order.id)}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{order.orderNumber}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[order.status] || ""}`}>{order.status}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-zinc-500">
                    <span className="flex items-center gap-1"><User className="w-3 h-3" />{order.customerName}</span>
                    <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{order.customerPhone}</span>
                    <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{order.address}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-bold text-sm">{formatCurrency(order.total)}</span>
                  {expandedId === order.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </div>
              </div>

              {expandedId === order.id && (
                <div className="border-t border-zinc-100 p-3 space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div><span className="text-zinc-500">Items:</span> {order.items.length}</div>
                    <div><span className="text-zinc-500">Total:</span> {formatCurrency(order.total)}</div>
                    <div><span className="text-zinc-500">Delivery Fee:</span> {formatCurrency(order.deliveryFee)}</div>
                    <div><span className="text-zinc-500">Payment:</span> Cash on Delivery</div>
                    {order.deliveryNote && <div className="col-span-2"><span className="text-zinc-500">Note:</span> {order.deliveryNote}</div>}
                    <div className="col-span-2 text-xs text-zinc-400">Created: {new Date(order.createdAt).toLocaleString()}</div>
                  </div>

                  <table className="w-full text-xs border-collapse">
                    <thead><tr className="text-zinc-500 border-b"><th className="text-left py-1">Item</th><th className="text-right py-1">Qty</th><th className="text-right py-1">Price</th><th className="text-right py-1">Total</th></tr></thead>
                    <tbody>
                      {order.items.map(item => (
                        <tr key={item.id} className="border-b border-zinc-50">
                          <td className="py-1">{item.productName}</td>
                          <td className="text-right py-1">{item.quantity}</td>
                          <td className="text-right py-1">{formatCurrency(item.unitPrice)}</td>
                          <td className="text-right py-1">{formatCurrency(item.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {order.status !== "Delivered" && order.status !== "Cancelled" && (
                    <div className="flex gap-2 pt-1">
                      {nextStatus(order.status) && (
                        <button onClick={() => updateStatus(order.id, nextStatus(order.status)!)}
                          className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                          Mark as {nextStatus(order.status)}
                        </button>
                      )}
                      <button onClick={() => updateStatus(order.id, "Cancelled")}
                        className="text-xs px-3 py-1.5 bg-red-100 text-red-700 rounded-lg hover:bg-red-200">
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
