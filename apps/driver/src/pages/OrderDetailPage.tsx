import { useEffect, useState } from "react"
import { useParams, useNavigate } from "react-router"
import { useI18n, useWebSocket } from "@lebanonpos/shared"
import { getToken } from "../main"
import { api } from "../app/api"

type OrderItem = { id: string; productName: string; quantity: number; unitPrice: number; total: number }
type Order = { id: string; orderNumber: string; status: string; customerName: string; customerPhone: string; address: string; itemsTotal: number; deliveryFee: number; total: number; deliveryNote: string; items: OrderItem[]; createdAt: string; driverId: string | null }

const STATUS_STYLES: Record<string, string> = {
  Preparing: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  OutForDelivery: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  Delivered: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  Cancelled: "bg-slate-500/20 text-slate-400 border-slate-500/30",
}
const STATUS_ICONS: Record<string, string> = {
  Preparing: "🍳", OutForDelivery: "🛵", Delivered: "✅", Cancelled: "❌",
}

function decodeTokenPayload(token: string) {
  try {
    const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")
    return JSON.parse(atob(base64))
  } catch { return null }
}

export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t } = useI18n()
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [actionLoading, setActionLoading] = useState(false)
  const [successMsg, setSuccessMsg] = useState("")

  const token = getToken()
  const payload = token ? decodeTokenPayload(token) : null
  const wsUrl = token ? `${import.meta.env.VITE_API_URL?.replace(/^http/, "ws") || "ws://localhost:3001"}/ws` : ""

  useWebSocket({
    url: wsUrl,
    token,
    tenantId: payload?.tenantId,
    onMessage: {
      "order:updated": (data: { order: Order }) => {
        if (data.order.id === id) {
          setOrder(data.order)
        }
      },
    },
  })

  async function fetchOrder() {
    try {
      setError("")
      const data = await api<Order[]>("/api/delivery/driver/orders")
      const found = data.find(o => o.id === id)
      found ? setOrder(found) : setError(t("driver.order_not_found"))
    } catch (err) {
      if (!getToken()) { navigate("/driver/login"); return }
      setError(err instanceof Error ? err.message : t("driver.failed_load_order"))
    } finally { setLoading(false) }
  }

  useEffect(() => { if (id) fetchOrder() }, [id])

  async function handleStatusUpdate(status: string) {
    setActionLoading(true); setError(""); setSuccessMsg("")
    try {
      await api(`/api/delivery/driver/orders/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) })
      setSuccessMsg(t("driver.status_updated"))
      await fetchOrder()
    } catch (err) {
      setError(err instanceof Error ? err.message : t("driver.failed_update"))
    } finally { setActionLoading(false) }
  }

  if (loading) return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-page">
      <div className="w-12 h-12 rounded-2xl border-2 border-indigo-500/30 border-t-indigo-400 animate-spin" />
    </div>
  )
  if (error && !order) return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-page p-4">
      <div className="text-6xl mb-4">😕</div>
      <p className="text-lg text-secondary mb-6">{error}</p>
      <button onClick={() => navigate("/driver/orders")} className="px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold shadow-lg shadow-indigo-600/20 transition-all duration-200 hover:from-indigo-500 hover:to-violet-500">
        {t("driver.back_to_orders")}
      </button>
    </div>
  )
  if (!order) return null

  const isTerminal = order.status === "Delivered" || order.status === "Cancelled"
  const whatsappUrl = `https://wa.me/${order.customerPhone.replace(/^0+/, "966")}?text=${encodeURIComponent(`Hi ${order.customerName}, your order ${order.orderNumber} is on its way!`)}`

  return (
    <div className="min-h-dvh bg-gradient-page">
      <header className="sticky top-0 z-10 bg-glass border-b border-glass">
        <div className="max-w-lg mx-auto flex items-center gap-3 px-4 py-3">
          <button onClick={() => navigate("/driver/orders")} className="flex items-center justify-center w-9 h-9 rounded-xl bg-glass hover:bg-glass-hover text-secondary transition-all duration-200">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <span className="text-primary font-semibold">{order.orderNumber}</span>
          <span className={`ml-auto inline-flex items-center gap-1 rounded-full px-3 py-1 text-[10px] font-medium border ${STATUS_STYLES[order.status] || 'bg-slate-500/20 text-slate-400 border-slate-500/30'}`}>
            {STATUS_ICONS[order.status] || '•'} {t(`status.${order.status}`)}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-lg p-4 pb-8 space-y-4 animate-fade-in">
        {successMsg && (
          <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 text-sm font-medium text-emerald-300 animate-slide-up">{successMsg}</div>
        )}
        {error && (
          <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 px-4 py-3 text-sm text-rose-300">{error}</div>
        )}

        <div className="rounded-2xl bg-glass border border-glass p-5">
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-secondary mb-4">{t("driver.customer")}</h3>
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-primary">
              <span className="text-lg">👤</span>
              <span className="font-medium">{order.customerName}</span>
            </div>
            <a href={`tel:${order.customerPhone}`} className="flex items-center gap-3 text-secondary hover:text-primary transition-colors">
              <span className="text-lg">📞</span>
              <span className="font-medium">{order.customerPhone}</span>
            </a>
            <a href={whatsappUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-3 text-emerald-400 hover:text-emerald-300 transition-colors">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
              <span className="font-medium">{t("driver.whatsapp_customer")}</span>
            </a>
            <div className="flex items-start gap-3 text-secondary">
              <span className="text-lg">📍</span>
              <span>{order.address}</span>
            </div>
          </div>
        </div>

        {order.deliveryNote && (
          <div className="rounded-2xl bg-amber-500/5 border border-amber-500/15 p-5">
            <h3 className="text-[10px] font-semibold uppercase tracking-widest text-amber-400/70 mb-2">{t("driver.delivery_note")}</h3>
            <p className="text-amber-200/90 text-sm">{order.deliveryNote}</p>
          </div>
        )}

        <div className="rounded-2xl bg-glass border border-glass p-5">
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-secondary mb-4">{t("driver.items")}</h3>
          <div className="divide-y divide-white/[0.04]">
            {order.items.map((item) => (
              <div key={item.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                <div>
                  <p className="text-sm font-medium text-primary">{item.productName}</p>
                  <p className="text-xs text-secondary mt-0.5">{item.quantity} × ${item.unitPrice.toFixed(2)}</p>
                </div>
                <p className="text-sm font-semibold text-secondary">${item.total.toFixed(2)}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-glass space-y-1.5">
            <div className="flex justify-between text-sm text-secondary">
              <span>{t("driver.items_total")}</span>
              <span>${order.itemsTotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm text-secondary">
              <span>{t("driver.delivery_fee")}</span>
              <span>${order.deliveryFee.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-lg font-bold text-primary pt-1">
              <span>{t("driver.total")}</span>
              <span>${order.total.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div className="pt-4 space-y-3">
          {!isTerminal && order.status === "Preparing" && (
            <button onClick={() => handleStatusUpdate("OutForDelivery")} disabled={actionLoading}
              className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-lg font-semibold shadow-lg shadow-indigo-600/20 transition-all duration-200 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50">
              {actionLoading ? (
                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <><span>📦</span> {t("driver.picked_up")}</>
              )}
            </button>
          )}
          {!isTerminal && order.status === "OutForDelivery" && (
            <button onClick={() => handleStatusUpdate("Delivered")} disabled={actionLoading}
              className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-600 to-emerald-500 text-white text-lg font-semibold shadow-lg shadow-emerald-600/20 transition-all duration-200 hover:from-emerald-500 hover:to-emerald-400 disabled:opacity-50">
              {actionLoading ? (
                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <><span>✅</span> {t("driver.delivered")}</>
              )}
            </button>
          )}
          {isTerminal && (
            <div className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-glass border border-glass text-lg font-semibold text-secondary">
              <span>✔</span> {t("driver.completed")}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
