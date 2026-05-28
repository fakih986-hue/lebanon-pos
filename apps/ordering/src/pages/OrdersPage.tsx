import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router"
import { useI18n } from "@lebanonpos/shared"

type OrderItem = { productName: string; quantity: number; unitPrice: number; total: number }
type Order = { id: string; orderNumber: string; status: string; total: number; customerName: string; address: string; createdAt: string; items: OrderItem[] }

export function OrdersPage() {
  const { tenantSubdomain } = useParams()
  const navigate = useNavigate()
  const { t } = useI18n()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const token = localStorage.getItem("customer_token")

  useEffect(() => {
    if (!token) { navigate(`/order/${tenantSubdomain}`); return }
    fetch("/api/delivery/customer/orders", {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json()).then(data => {
      setOrders(Array.isArray(data) ? data : [])
    }).catch(() => {}).finally(() => setLoading(false))
  }, [token])

  return (
    <div className="min-h-dvh bg-gradient-page p-4">
      <div className="max-w-lg mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate(`/order/${tenantSubdomain}`)}
            className="text-sm text-secondary hover:text-primary">&larr; {t("ordering.menu")}</button>
          <h1 className="text-xl font-bold">{t("ordering.my_orders")}</h1>
        </div>
        {loading ? (
          <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 bg-white/5 rounded-xl animate-pulse" />)}</div>
        ) : orders.length === 0 ? (
          <div className="text-center py-16 text-secondary">
            <p className="text-lg font-semibold">{t("ordering.no_orders_yet")}</p>
            <p className="text-sm mt-1">{t("ordering.no_orders_yet_sub")}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map(order => (
              <div key={order.id} className="bg-glass border border-glass rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold">{order.orderNumber}</span>
                  <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${
                    order.status === "Delivered" ? "bg-emerald-500/20 text-emerald-300" :
                    order.status === "Cancelled" ? "bg-rose-500/20 text-rose-300" :
                    "bg-amber-500/20 text-amber-300"
                  }`}>{t(`status.${order.status}`)}</span>
                </div>
                <p className="text-sm text-secondary">{order.items?.length || 0} {t("ordering.items")} &middot; ${order.total?.toFixed(2)}</p>
                <div className="flex gap-2 mt-2">
                  <button onClick={() => navigate(`/order/${tenantSubdomain}/track/${order.orderNumber}`)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30">
                      {t("ordering.track")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
