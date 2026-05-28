import { useEffect, useState } from "react"
import { useNavigate } from "react-router"
import { useI18n, useTheme, useWebSocket } from "@lebanonpos/shared"
import { clearToken, getToken } from "../main"
import { api } from "../app/api"

type Order = { id: string; orderNumber: string; status: string; customerName: string; customerPhone: string; address: string; total: number; createdAt: string; driverId: string | null }

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

export function OrdersPage() {
  const navigate = useNavigate()
  const { t, locale, setLocale } = useI18n()
  const { theme, toggleTheme } = useTheme()
  const [assigned, setAssigned] = useState<Order[]>([])
  const [available, setAvailable] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [acceptingId, setAcceptingId] = useState<string | null>(null)
  const [takenIds, setTakenIds] = useState<Set<string>>(new Set())

  const token = getToken()
  const payload = token ? decodeTokenPayload(token) : null
  const wsUrl = token ? `${import.meta.env.VITE_API_URL?.replace(/^http/, "ws") || "ws://localhost:3001"}/ws` : ""

  const { isConnected } = useWebSocket({
    url: wsUrl,
    token,
    tenantId: payload?.tenantId,
    onMessage: {
      "order:available": (data: { order: Order }) => {
        setAvailable(prev => {
          if (prev.some(o => o.id === data.order.id)) return prev
          return [data.order, ...prev]
        })
      },
      "order:assigned": (data: { orderId: string; driverId: string }) => {
        setAvailable(prev => prev.filter(o => o.id !== data.orderId))
        setTakenIds(prev => new Set(prev).add(data.orderId))
      },
      "order:updated": (data: { order: Order }) => {
        setAssigned(prev => {
          const idx = prev.findIndex(o => o.id === data.order.id)
          if (idx >= 0) {
            const next = [...prev]
            next[idx] = data.order
            return next
          }
          if (data.order.driverId === payload?.userId) {
            return [data.order, ...prev]
          }
          return prev
        })
        setAvailable(prev => prev.filter(o => o.id !== data.order.id))
      },
    },
    onConnect: () => fetchAvailable(),
  })

  async function fetchAssigned() {
    try {
      const data = await api<Order[]>("/api/delivery/driver/orders")
      setAssigned(data)
    } catch (err) {
      if (!getToken()) { navigate("/driver/login"); return }
      setError(err instanceof Error ? err.message : t("driver.failed_load"))
    }
  }

  async function fetchAvailable() {
    try {
      const data = await api<Order[]>("/api/delivery/driver/orders/available")
      setAvailable(prev => {
        const existing = new Map(prev.map(o => [o.id, o]))
        for (const o of data) { if (!existing.has(o.id)) existing.set(o.id, o) }
        return Array.from(existing.values())
      })
    } catch { }
  }

  useEffect(() => {
    Promise.all([fetchAssigned(), fetchAvailable()]).finally(() => setLoading(false))
    const interval = setInterval(() => { fetchAssigned(); fetchAvailable() }, 30000)
    return () => clearInterval(interval)
  }, [])

  async function handleAccept(orderId: string) {
    setAcceptingId(orderId)
    setError("")
    try {
      const updated = await api<Order>(`/api/delivery/driver/orders/${orderId}/accept`, { method: "POST" })
      setAssigned(prev => [updated, ...prev])
      setAvailable(prev => prev.filter(o => o.id !== orderId))
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("driver.failed_load")
      if (msg.includes("already assigned") || msg.includes("409")) {
        setTakenIds(prev => new Set(prev).add(orderId))
      } else {
        setError(msg)
      }
    } finally { setAcceptingId(null) }
  }

  function handleLogout() { clearToken(); navigate("/driver/login") }

  return (
    <div className="min-h-dvh bg-gradient-page">
      <header className="sticky top-0 z-10 bg-glass border-b border-glass px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-400 to-violet-600 flex items-center justify-center text-white text-sm shadow-lg shadow-indigo-600/20">
              🚚
            </div>
            <div>
              <span className="text-primary font-semibold text-sm">{t("driver.my_deliveries")}</span>
              {!loading && <span className="text-[10px] text-secondary ml-2">{assigned.length} {t("driver.orders_count")}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg ${isConnected ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? "bg-emerald-400" : "bg-rose-400"}`} />
              {isConnected ? t("driver.online") : t("driver.offline")}
            </span>
            <button onClick={() => setLocale(locale === "en" ? "ar" : "en")}
              className="text-[10px] text-secondary hover:text-primary bg-glass px-2 py-1.5 rounded-lg transition-all">
              {locale === "en" ? "ع" : "EN"}
            </button>
            <button onClick={toggleTheme}
              className="text-[10px] text-secondary hover:text-primary bg-glass px-2 py-1.5 rounded-lg transition-all">
              {theme === "dark" ? "☀️" : "🌙"}
            </button>
            <button onClick={handleLogout} className="text-xs text-secondary hover:text-primary bg-glass hover:bg-glass-hover px-3 py-1.5 rounded-xl transition-all duration-200">
              {t("driver.logout")}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-lg p-4 pb-24">
        {loading && assigned.length === 0 && available.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24">
            <div className="w-12 h-12 rounded-2xl border-2 border-indigo-500/30 border-t-indigo-400 animate-spin mb-4" />
            <p className="text-sm text-secondary">{t("driver.loading")}</p>
          </div>
        )}
        {error && (
          <div className="mb-4 rounded-xl bg-rose-500/10 border border-rose-500/20 px-4 py-3 text-sm text-rose-300 animate-slide-up">{error}</div>
        )}

        {available.length > 0 && (
          <>
            <h3 className="text-xs font-semibold text-secondary uppercase tracking-wider mb-3">{t("driver.available_orders")}</h3>
            <div className="space-y-3 mb-6">
              {available.map((order, i) => (
                <div key={order.id}
                  className="rounded-2xl bg-glass border border-indigo-500/20 p-4 transition-all duration-200 hover:shadow-lg animate-slide-up"
                  style={{ animationDelay: `${i * 0.05}s` }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-base font-bold text-primary">{order.orderNumber}</span>
                        <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-medium border bg-amber-500/20 text-amber-300 border-amber-500/30">
                          ● {t("status.Pending")}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center gap-1.5 text-sm text-secondary">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                        {order.customerName}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-sm text-secondary">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                        {order.address}
                      </div>
                    </div>
                    <div className="text-end shrink-0">
                      <div className="text-lg font-bold" style={{ color: "var(--accent-from)" }}>${order.total.toFixed(2)}</div>
                      <div className="text-[10px] text-muted mt-0.5">{new Date(order.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                    </div>
                  </div>
                  <div className="mt-3">
                    {takenIds.has(order.id) ? (
                      <div className="flex items-center justify-center gap-2 rounded-xl bg-rose-500/10 border border-rose-500/20 px-4 py-2.5 text-sm font-medium text-rose-400">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        {t("driver.already_taken")}
                      </div>
                    ) : (
                      <button onClick={() => handleAccept(order.id)} disabled={acceptingId === order.id}
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-sm font-semibold px-4 py-2.5 shadow-lg shadow-indigo-600/20 transition-all duration-200 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50">
                        {acceptingId === order.id ? (
                          <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> {t("driver.accepting")}</>
                        ) : (
                          <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg> {t("driver.accept")}</>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <h3 className="text-xs font-semibold text-secondary uppercase tracking-wider mb-3">{t("driver.my_deliveries")}</h3>
        {!loading && assigned.length === 0 && available.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-24 text-center animate-fade-in">
            <div className="w-20 h-20 rounded-3xl bg-glass border border-glass flex items-center justify-center mb-5">
              <span className="text-4xl">📭</span>
            </div>
            <p className="text-lg font-semibold text-primary">{t("driver.no_orders")}</p>
            <p className="text-sm text-secondary mt-1">{t("driver.no_orders_sub")}</p>
          </div>
        )}
        {assigned.length > 0 && (
          <div className="space-y-3">
            {assigned.map((order, i) => (
              <button key={order.id} onClick={() => navigate(`/driver/orders/${order.id}`)}
                className="w-full text-start rounded-2xl bg-glass border border-glass p-4 transition-all duration-200 hover:bg-glass-hover hover:shadow-lg animate-slide-up group"
                style={{ animationDelay: `${i * 0.05}s` }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-bold text-primary">{order.orderNumber}</span>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-medium border ${STATUS_STYLES[order.status] || 'bg-slate-500/20 text-slate-400 border-slate-500/30'}`}>
                        {STATUS_ICONS[order.status] || '•'} {t(`status.${order.status}`)}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-1.5 text-sm text-secondary">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                      {order.customerName}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-sm text-secondary">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                      {order.address}
                    </div>
                  </div>
                  <div className="text-end shrink-0">
                    <div className="text-lg font-bold" style={{ color: "var(--accent-from)" }}>${order.total.toFixed(2)}</div>
                    <div className="text-[10px] text-muted mt-0.5">{new Date(order.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-1.5 text-[11px] text-secondary group-hover:text-primary transition-colors">
                  <span>{t("driver.view_details")}</span>
                  <svg className="w-3 h-3 rtl:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
