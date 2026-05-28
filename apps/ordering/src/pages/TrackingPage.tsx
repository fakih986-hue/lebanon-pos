import { useState, useEffect, useCallback } from "react"
import { useParams, useNavigate } from "react-router"
import { useI18n, useWebSocket } from "@lebanonpos/shared"
import { api } from "../app/api"

type Status = "Pending" | "Confirmed" | "Preparing" | "OutForDelivery" | "Delivered" | "Cancelled"
type OrderStatus = { orderNumber: string; customerName: string; status: Status }

const STEPS: { status: Status; emoji: string; key: string }[] = [
  { status: "Pending", emoji: "📋", key: "ordering.order_placed" },
  { status: "Confirmed", emoji: "✅", key: "ordering.confirmed" },
  { status: "Preparing", emoji: "🔄", key: "ordering.preparing" },
  { status: "OutForDelivery", emoji: "🚚", key: "ordering.out_for_delivery" },
  { status: "Delivered", emoji: "🎉", key: "ordering.delivered" },
]

const STATUS_ORDER: Status[] = ["Pending", "Confirmed", "Preparing", "OutForDelivery", "Delivered"]

function getStepIndex(status: Status): number {
  if (status === "Cancelled") return -1
  const idx = STATUS_ORDER.indexOf(status)
  return idx >= 0 ? idx : 0
}

export function TrackingPage() {
  const { tenantSubdomain, orderNumber } = useParams<{ tenantSubdomain: string; orderNumber: string }>()
  const navigate = useNavigate()
  const { t } = useI18n()
  const [order, setOrder] = useState<OrderStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tenantId, setTenantId] = useState<string>("")
  const [storeWhatsApp, setStoreWhatsApp] = useState<string>("")

  const wsUrl = `wss://${window.location.hostname === "localhost" ? "localhost:3001" : window.location.host}/ws`

  useWebSocket({
    url: wsUrl,
    tenantId,
    onMessage: {
      "order:updated": (data: { order: { orderNumber: string; status: string; customerName: string } }) => {
        if (data.order.orderNumber === orderNumber) {
          setOrder({ orderNumber: data.order.orderNumber, status: data.order.status as Status, customerName: data.order.customerName })
        }
      },
    },
  })

  useEffect(() => {
    if (!tenantSubdomain) return
    api<{ id: string }>(`/api/delivery/tenant?subdomain=${tenantSubdomain}`)
      .then(t => {
        setTenantId(t.id)
        api<{ whatsAppAdmin?: string }>(`/api/delivery/settings?tenantId=${t.id}`)
          .then(s => setStoreWhatsApp(s.whatsAppAdmin || ""))
          .catch(() => {})
      })
      .catch(() => {})
  }, [tenantSubdomain])

  useEffect(() => {
    if (!orderNumber) return
    let cancelled = false
    async function fetchStatus() {
      try {
        const data = await api<OrderStatus>(`/api/delivery/order/${orderNumber}/status`)
        if (!cancelled) { setOrder(data); setLoading(false) }
      } catch (err: any) {
        if (!cancelled) { setError(err.message); setLoading(false) }
      }
    }
    fetchStatus()
    const interval = setInterval(fetchStatus, 30000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [orderNumber])

  if (loading) return (
    <div className="min-h-dvh bg-gradient-page flex items-center justify-center">
      <div className="text-center animate-pulse">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-4xl shadow-xl shadow-emerald-600/20 mb-5">🛵</div>
        <p className="text-secondary text-sm">{t("ordering.loading_order")}</p>
      </div>
    </div>
  )

  if (error) return (
    <div className="min-h-dvh bg-gradient-page flex items-center justify-center p-6">
      <div className="bg-glass border border-glass rounded-2xl p-8 text-center shadow-2xl max-w-sm w-full animate-fade-in">
        <div className="text-4xl mb-2">😕</div>
        <p className="text-secondary mb-4">{error}</p>
        <button onClick={() => navigate(`/order/${tenantSubdomain}`)}
          className="px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 text-white font-semibold shadow-lg shadow-emerald-600/20 transition-all duration-200 hover:from-emerald-500 hover:to-emerald-400">
          {t("ordering.back_to_menu")}
        </button>
      </div>
    </div>
  )

  if (!order) return null

  const currentIdx = getStepIndex(order.status)
  const isCancelled = order.status === "Cancelled"

  return (
    <div className="min-h-dvh bg-gradient-page flex items-center justify-center p-6">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-4xl shadow-xl shadow-emerald-600/20 mb-5">🛵</div>
          <h1 className="text-2xl font-bold text-primary tracking-tight">{t("ordering.order")} #{order.orderNumber}</h1>
          <p className="text-sm text-secondary mt-1">{order.customerName}</p>
        </div>

        <div className="bg-glass border border-glass rounded-2xl p-6 shadow-2xl">
          {isCancelled ? (
            <div className="rounded-2xl bg-red-500/10 border border-red-500/20 p-6 text-center">
              <div className="text-4xl mb-2">❌</div>
              <p className="font-semibold text-red-400">{t("ordering.cancelled")}</p>
            </div>
          ) : (
            <div className="space-y-0">
              {STEPS.map((step, idx) => {
                const isCompleted = currentIdx >= idx
                const isActive = currentIdx === idx
                return (
                  <div key={step.status} className="flex items-start gap-4">
                    <div className="flex flex-col items-center">
                      <div className={`flex h-11 w-11 items-center justify-center rounded-2xl text-lg transition-all duration-300 ${isCompleted ? "bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-lg shadow-emerald-600/20" : "bg-glass border border-glass"}`}>
                        <span className={isCompleted ? "" : "opacity-30"}>{step.emoji}</span>
                      </div>
                      {idx < STEPS.length - 1 && (
                        <div className={`mt-1 h-8 w-0.5 rounded-full transition-all duration-300 ${currentIdx > idx ? "bg-gradient-to-b from-emerald-500 to-emerald-600" : "bg-glass"}`} />
                      )}
                    </div>
                    <div className="pb-6 pt-2">
                      <p className={`font-medium text-sm transition-all duration-300 ${isActive ? "text-emerald-400" : isCompleted ? "text-primary" : "text-muted"}`}>
                        {t(step.key)}
                      </p>
                      {isActive && <p className="text-xs text-emerald-400/60 mt-0.5 animate-pulse">{t("ordering.in_progress")}</p>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <div className="mt-4 text-center">
            <p className="text-[10px] text-muted">{t("ordering.auto_refresh")}</p>
          </div>

          {order.status !== "Cancelled" && (
            <a href={`https://wa.me/${storeWhatsApp}?text=${encodeURIComponent(`Hi, I'm asking about my order #${orderNumber}`)}`}
              target="_blank" rel="noopener noreferrer"
              className="mt-3 flex w-full items-center justify-center gap-2 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm font-semibold transition-all duration-200 hover:bg-emerald-500/20">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
              Contact via WhatsApp
            </a>
          )}

          <button onClick={() => navigate(`/order/${tenantSubdomain}`)}
            className="mt-3 w-full py-3.5 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 text-white font-semibold shadow-lg shadow-emerald-600/20 transition-all duration-200 hover:from-emerald-500 hover:to-emerald-400 active:scale-[0.98]">
            {t("ordering.order_again")}
          </button>
        </div>
      </div>
    </div>
  )
}
