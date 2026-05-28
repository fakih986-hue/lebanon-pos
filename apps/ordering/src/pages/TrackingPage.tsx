import { useState, useEffect, useCallback } from "react"
import { useParams, useNavigate } from "react-router"
import { useI18n, useWebSocket } from "@lebanonpos/shared"
import { api } from "../app/api"

type Status = "Pending" | "Confirmed" | "Preparing" | "OutForDelivery" | "Delivered" | "Cancelled"

type OrderDetail = {
  orderNumber: string
  status: Status
  customerName: string
  customerPhone: string
  address: string
  deliveryNote: string
  itemsTotal: number
  deliveryFee: number
  total: number
  paymentMethod: string
  paidAmount: number
  changeRequired: number
  createdAt: string
  deliveredAt?: string
  cancelledAt?: string
  cancelledReason?: string
  driverName?: string
  driverPhone?: string
  items: Array<{ productName: string; quantity: number; unitPrice: number; total: number }>
}

const STEPS: { status: Status; icon: string; labelKey: string; descKey: string }[] = [
  { status: "Pending",        icon: "📋", labelKey: "ordering.order_placed",    descKey: "ordering.step_pending_desc" },
  { status: "Confirmed",      icon: "✅", labelKey: "ordering.confirmed",        descKey: "ordering.step_confirmed_desc" },
  { status: "Preparing",      icon: "🔄", labelKey: "ordering.preparing",        descKey: "ordering.step_preparing_desc" },
  { status: "OutForDelivery", icon: "🛵", labelKey: "ordering.out_for_delivery", descKey: "ordering.step_otd_desc" },
  { status: "Delivered",      icon: "🎉", labelKey: "ordering.delivered",        descKey: "ordering.step_delivered_desc" },
]

const STATUS_ORDER: Status[] = ["Pending", "Confirmed", "Preparing", "OutForDelivery", "Delivered"]

function getStepIndex(status: Status): number {
  if (status === "Cancelled") return -1
  return Math.max(STATUS_ORDER.indexOf(status), 0)
}

export function TrackingPage() {
  const { tenantSubdomain, orderNumber } = useParams<{ tenantSubdomain: string; orderNumber: string }>()
  const navigate = useNavigate()
  const { t } = useI18n()
  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tenantId, setTenantId] = useState("")
  const [storeWhatsApp, setStoreWhatsApp] = useState("")
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())

  const wsUrl = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`

  useWebSocket({
    url: wsUrl,
    tenantId,
    onMessage: {
      "order:updated": (data: { order: Partial<OrderDetail> & { orderNumber: string } }) => {
        if (data.order.orderNumber === orderNumber) {
          setOrder((prev) => prev ? { ...prev, ...data.order } as OrderDetail : null)
          setLastUpdated(new Date())
        }
      },
    },
  })

  useEffect(() => {
    if (!tenantSubdomain) return
    api<{ id: string }>(`/api/delivery/tenant?subdomain=${tenantSubdomain}`)
      .then((t) => {
        setTenantId(t.id)
        api<{ whatsAppAdmin?: string }>(`/api/delivery/settings?tenantId=${t.id}`)
          .then((s) => setStoreWhatsApp(s.whatsAppAdmin || ""))
          .catch(() => {})
      })
      .catch(() => {})
  }, [tenantSubdomain])

  const fetchOrder = useCallback(async () => {
    if (!orderNumber) return
    try {
      const data = await api<OrderDetail>(`/api/delivery/order/${orderNumber}/status`)
      setOrder(data)
      setLastUpdated(new Date())
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [orderNumber])

  useEffect(() => {
    fetchOrder()
    const interval = setInterval(fetchOrder, 30_000)
    return () => clearInterval(interval)
  }, [fetchOrder])

  if (loading) return (
    <div className="min-h-dvh bg-gradient-page flex items-center justify-center">
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-4xl shadow-xl shadow-emerald-600/20 mb-5 animate-pulse">🛵</div>
        <p className="text-secondary text-sm">{t("ordering.loading_order")}</p>
      </div>
    </div>
  )

  if (error && !order) return (
    <div className="min-h-dvh bg-gradient-page flex items-center justify-center p-6">
      <div className="bg-glass border border-glass rounded-2xl p-8 text-center shadow-2xl max-w-sm w-full animate-fade-in">
        <div className="text-4xl mb-3">😕</div>
        <p className="text-secondary mb-5">{error}</p>
        <button onClick={() => navigate(`/order/${tenantSubdomain}`)}
          className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 text-white font-semibold">
          {t("ordering.back_to_menu")}
        </button>
      </div>
    </div>
  )

  if (!order) return null

  const currentIdx = getStepIndex(order.status)
  const isCancelled = order.status === "Cancelled"
  const isDelivered = order.status === "Delivered"
  const isCashOnDelivery = order.paymentMethod === "CashOnDelivery"

  return (
    <div className="min-h-dvh bg-gradient-page">
      <div className="max-w-lg mx-auto px-4 py-8 space-y-4 animate-fade-in">

        {/* Header */}
        <div className="text-center mb-2">
          {isDelivered ? (
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-4xl shadow-xl shadow-emerald-600/20 mb-4">🎉</div>
          ) : isCancelled ? (
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-rose-500/20 text-4xl mb-4">❌</div>
          ) : (
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-400 to-violet-600 text-4xl shadow-xl shadow-indigo-600/20 mb-4 animate-pulse">🛵</div>
          )}
          <h1 className="text-xl font-bold text-primary">{t("ordering.order")} <span className="text-emerald-400">{order.orderNumber}</span></h1>
          <p className="text-sm text-secondary mt-1">{order.customerName}</p>
          <p className="text-[11px] text-muted mt-1">
            {t("ordering.last_updated") || "Updated"} {lastUpdated.toLocaleTimeString("en-LB", { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>

        {/* Progress tracker */}
        <div className="bg-glass border border-glass rounded-2xl p-5 shadow-lg">
          {isCancelled ? (
            <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 p-5 text-center">
              <p className="text-2xl mb-2">❌</p>
              <p className="font-semibold text-rose-400">{t("ordering.cancelled")}</p>
              {order.cancelledReason && (
                <p className="text-sm text-secondary mt-1">{order.cancelledReason}</p>
              )}
            </div>
          ) : (
            <div className="space-y-0">
              {STEPS.map((step, idx) => {
                const isCompleted = currentIdx >= idx
                const isActive = currentIdx === idx
                return (
                  <div key={step.status} className="flex items-start gap-4">
                    <div className="flex flex-col items-center shrink-0">
                      <div className={`flex h-11 w-11 items-center justify-center rounded-2xl text-lg transition-all duration-500 ${
                        isCompleted
                          ? "bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-lg shadow-emerald-600/25"
                          : "bg-glass border border-glass"
                      }`}>
                        <span className={isCompleted ? "" : "opacity-25"}>{step.icon}</span>
                      </div>
                      {idx < STEPS.length - 1 && (
                        <div className={`mt-1 h-8 w-0.5 rounded-full transition-all duration-500 ${
                          currentIdx > idx ? "bg-gradient-to-b from-emerald-500 to-emerald-600" : "bg-white/[0.06]"
                        }`} />
                      )}
                    </div>
                    <div className="pb-4 pt-2 flex-1">
                      <p className={`text-sm font-semibold transition-all duration-300 ${
                        isActive ? "text-emerald-400" : isCompleted ? "text-primary" : "text-muted"
                      }`}>
                        {t(step.labelKey)}
                      </p>
                      {isActive && (
                        <p className="text-xs text-emerald-400/70 mt-0.5 animate-pulse">
                          {t(step.descKey) || t("ordering.in_progress")}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Driver info (when assigned) */}
        {order.driverName && !isDelivered && !isCancelled && (
          <div className="bg-glass border border-indigo-500/20 rounded-2xl p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-secondary mb-3">{t("ordering.your_driver") || "Your Driver"}</p>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-400 to-violet-600 flex items-center justify-center text-white text-lg">🧑‍✈️</div>
                <div>
                  <p className="font-semibold text-primary">{order.driverName}</p>
                  <p className="text-xs text-secondary">{t("ordering.on_the_way") || "On the way to you"}</p>
                </div>
              </div>
              {order.driverPhone && (
                <a href={`tel:${order.driverPhone}`}
                  className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/25 transition-all">
                  📞
                </a>
              )}
            </div>
          </div>
        )}

        {/* Order items */}
        <div className="bg-glass border border-glass rounded-2xl p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-secondary mb-3">{t("ordering.order_summary") || "Order Summary"}</p>
          <div className="space-y-2">
            {order.items.map((item, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/[0.06] text-[11px] font-bold text-secondary">{item.quantity}</span>
                  <span className="text-sm text-primary">{item.productName}</span>
                </div>
                <span className="text-sm font-semibold text-secondary">${item.total.toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-white/[0.06] space-y-1">
            <div className="flex justify-between text-sm text-secondary">
              <span>{t("ordering.subtotal") || "Subtotal"}</span>
              <span>${order.itemsTotal.toFixed(2)}</span>
            </div>
            {order.deliveryFee > 0 && (
              <div className="flex justify-between text-sm text-secondary">
                <span>{t("ordering.delivery_fee")}</span>
                <span>${order.deliveryFee.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-base font-bold text-primary pt-1">
              <span>{t("ordering.total")}</span>
              <span>${order.total.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Payment info */}
        <div className={`rounded-2xl border p-4 ${
          isCashOnDelivery
            ? "bg-amber-500/8 border-amber-500/20"
            : "bg-glass border-glass"
        }`}>
          <p className="text-[10px] font-bold uppercase tracking-widest text-secondary mb-2">{t("ordering.payment") || "Payment"}</p>
          {isCashOnDelivery ? (
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg">💵</span>
                <span className="text-sm font-semibold text-amber-300">{t("ordering.cash_on_delivery") || "Cash on Delivery"}</span>
              </div>
              <p className="text-2xl font-black text-primary mt-2">${order.total.toFixed(2)}</p>
              <p className="text-xs text-secondary">{t("ordering.prepare_cash") || "Please prepare this amount for the driver"}</p>
              {isDelivered && order.paidAmount > 0 && order.changeRequired > 0 && (
                <div className="mt-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-sm font-semibold text-emerald-400">
                  Change: ${order.changeRequired.toFixed(2)}
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-lg">💳</span>
              <span className="text-sm font-semibold text-primary">{order.paymentMethod}</span>
              {isDelivered && <span className="ml-auto text-xs px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-400 font-semibold">✓ Paid</span>}
            </div>
          )}
        </div>

        {/* Delivery address */}
        <div className="bg-glass border border-glass rounded-2xl p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-secondary mb-2">{t("ordering.delivering_to") || "Delivering to"}</p>
          <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.address)}`}
            target="_blank" rel="noopener noreferrer"
            className="flex items-start gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors">
            <span className="text-base shrink-0 mt-0.5">📍</span>
            <span className="underline underline-offset-2">{order.address}</span>
          </a>
          {order.deliveryNote && (
            <p className="mt-2 text-xs text-secondary italic">"{order.deliveryNote}"</p>
          )}
        </div>

        {/* Contact store */}
        {!isCancelled && storeWhatsApp && (
          <a href={`https://wa.me/${storeWhatsApp.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(`Hi, I'm asking about my order #${orderNumber}`)}`}
            target="_blank" rel="noopener noreferrer"
            className="flex w-full items-center justify-center gap-2 py-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm font-semibold transition-all hover:bg-emerald-500/20">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
            {t("ordering.contact_store") || "Contact Store via WhatsApp"}
          </a>
        )}

        <button onClick={() => navigate(`/order/${tenantSubdomain}`)}
          className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-emerald-600 to-emerald-500 text-white font-semibold shadow-lg shadow-emerald-600/20 transition-all hover:from-emerald-500 hover:to-emerald-400 active:scale-[0.98]">
          {t("ordering.order_again")}
        </button>
      </div>
    </div>
  )
}
