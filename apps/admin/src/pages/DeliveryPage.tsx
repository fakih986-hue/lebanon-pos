import { useEffect, useState, useRef } from "react"
import { api } from "../app/api"
import { useI18n, useWebSocket } from "@lebanonpos/shared"
import { getToken } from "../main"

type Driver = { id: string; name: string }

type DeliveryOrder = {
  id: string; orderNumber: string; status: string; customerName: string
  customerPhone: string; address: string; itemsTotal: number; deliveryFee: number
  total: number; paymentMethod: string; paidAmount: number
  assignedName: string | null; driverId: string | null; deliveryNote: string
  notes: string; cancelledReason: string; createdAt: string
  items: Array<{ id: string; productName: string; quantity: number; unitPrice: number; total: number }>
}

const STATUS_ORDER = ["Pending", "Confirmed", "Preparing", "OutForDelivery", "Delivered", "Cancelled"]
const STATUS_STYLES: Record<string, string> = {
  Pending: "status-badge-warning", Confirmed: "status-badge-info",
  Preparing: "status-badge-purple", OutForDelivery: "status-badge",
  Delivered: "status-badge-success", Cancelled: "status-badge-danger",
}
const STATUS_ICONS: Record<string, string> = {
  Pending: "⏳", Confirmed: "✅", Preparing: "🍳", OutForDelivery: "🚚", Delivered: "📦", Cancelled: "❌",
}

function decodeTokenPayload(token: string) {
  try {
    const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")
    return JSON.parse(atob(base64))
  } catch { return null }
}

export function DeliveryPage() {
  const { t } = useI18n()
  const [orders, setOrders] = useState<DeliveryOrder[]>([])
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [onlineDrivers, setOnlineDrivers] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState("All")
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [driverSearch, setDriverSearch] = useState<Record<string, string>>({})
  const [showDropdown, setShowDropdown] = useState<Record<string, boolean>>({})
  const searchRef = useRef<Record<string, HTMLDivElement | null>>({})

  const token = getToken()
  const payload = token ? decodeTokenPayload(token) : null
  const wsUrl = token ? `${import.meta.env.VITE_API_URL?.replace(/^http/, "ws") || "ws://localhost:3001"}/ws` : ""

  useWebSocket({
    url: wsUrl,
    token,
    tenantId: payload?.tenantId,
    onMessage: {
      "order:new": (data: { order: DeliveryOrder }) => {
        setOrders(prev => [data.order, ...prev])
      },
      "order:updated": (data: { order: DeliveryOrder }) => {
        setOrders(prev => prev.map(o => o.id === data.order.id ? data.order : o))
      },
    },
  })

  useEffect(() => { load(); loadDrivers(); fetchOnlineDrivers() }, [])
  useEffect(() => {
    const interval = setInterval(fetchOnlineDrivers, 10000)
    return () => clearInterval(interval)
  }, [])

  async function fetchOnlineDrivers() {
    try { setOnlineDrivers(await api<string[]>("/api/delivery/drivers/online")) } catch { }
  }

  async function loadDrivers() {
    try { setDrivers(await api<Driver[]>("/api/delivery/drivers")) } catch { }
  }

  async function load() {
    setLoading(true)
    try {
      const params = statusFilter !== "All" ? `?status=${statusFilter}` : ""
      setOrders(await api<DeliveryOrder[]>(`/api/delivery/orders${params}`))
    } catch { }
    setLoading(false)
  }

  async function updateStatus(id: string, status: string) {
    try {
      const updated = await api<DeliveryOrder>(`/api/delivery/orders/${id}`, { method: "PATCH", body: JSON.stringify({ status }) })
      setOrders(orders.map(o => o.id === id ? updated : o))
    } catch { }
  }

  async function assignDriver(orderId: string, driverId: string) {
    try {
      const updated = await api<DeliveryOrder>(`/api/delivery/orders/${orderId}`, { method: "PATCH", body: JSON.stringify({ driverId: driverId || null }) })
      setOrders(orders.map(o => o.id === orderId ? updated : o))
    } catch { }
  }

  const nextStatus = (current: string) => {
    const idx = STATUS_ORDER.indexOf(current)
    if (idx >= STATUS_ORDER.length - 2) return null
    return STATUS_ORDER[idx + 1]
  }

  return (
    <div className="space-y-6 pb-12">
      <div className="flex items-center justify-between flex-wrap gap-4 animate-fade-in">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>{t("delivery.title")}</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>{t("delivery.subtitle")}</p>
        </div>
        <div className="flex gap-2 items-center">
          <a href="/driver" target="_blank" className="btn-secondary text-xs py-2 px-3 no-underline">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            {t("delivery.driver_app")}
          </a>
          <a href="/order" target="_blank" className="btn-secondary text-xs py-2 px-3 no-underline">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" /></svg>
            {t("delivery.customer_order")}
          </a>
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); load() }} className="select-field text-xs py-2 w-32">
            <option value="All">{t("delivery.all_orders")}</option>
            {STATUS_ORDER.map(s => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
          </select>
          <button onClick={load} className="btn-ghost text-xs">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            {t("delivery.refresh")}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="loading-skeleton h-24 rounded-2xl" />)}
        </div>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20" style={{ color: "var(--text-muted)" }}>
          <div className="w-20 h-20 rounded-3xl bg-slate-100 dark:bg-white/[0.04] flex items-center justify-center mb-5">
            <svg className="w-10 h-10" style={{ color: "var(--text-muted)" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
          </div>
          <p className="text-lg font-semibold" style={{ color: "var(--text-secondary)" }}>{t("delivery.no_orders")}</p>
          <p className="text-sm mt-1">{t("delivery.no_orders_sub")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((order, idx) => (
            <div key={order.id} className="data-card p-0 overflow-hidden animate-slide-up" style={{ animationDelay: `${idx * 0.03}s` }}>
              <div className="p-5 cursor-pointer" onClick={() => setExpandedId(expandedId === order.id ? null : order.id)}>
                <div className="flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2.5">
                      <span className="font-bold text-sm" style={{ color: "var(--text-primary)" }}>{order.orderNumber}</span>
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[order.status] || 'bg-slate-100 dark:bg-white/[0.06] text-slate-600 dark:text-slate-400'}`}>
                        {STATUS_ICONS[order.status] || '•'} {t(`status.${order.status}`)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-sm" style={{ color: "var(--text-secondary)" }}>
                      <span className="flex items-center gap-1">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                        {order.customerName}
                      </span>
                      <span>·</span>
                      <span className="flex items-center gap-1">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
                        {order.address}
                      </span>
                    </div>
                  </div>
                  <div className="text-end shrink-0">
                    <p className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>${order.total.toFixed(2)}</p>
                    <p className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>{new Date(order.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                  <svg className={`w-5 h-5 transition-transform duration-300 ${expandedId === order.id ? 'rotate-180' : ''}`} style={{ color: "var(--text-muted)" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>

              {expandedId === order.id && (
                <div className="border-t px-5 py-4 space-y-4 animate-slide-up" style={{ borderColor: "var(--border-card)", background: "var(--row-hover)" }}>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                    <div className="data-card">
                      <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: "var(--text-muted)" }}>{t("delivery.items")}</p>
                      <p className="font-semibold mt-0.5" style={{ color: "var(--text-primary)" }}>{order.items.length} {t("delivery.items_count")}</p>
                    </div>
                    <div className="data-card">
                      <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: "var(--text-muted)" }}>{t("delivery.delivery_fee")}</p>
                      <p className="font-semibold mt-0.5" style={{ color: "var(--text-primary)" }}>${order.deliveryFee.toFixed(2)}</p>
                    </div>
                    <div className="data-card">
                      <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: "var(--text-muted)" }}>{t("delivery.payment")}</p>
                      <p className="font-semibold mt-0.5" style={{ color: "var(--text-primary)" }}>{order.paymentMethod || "N/A"}</p>
                    </div>
                    <div className="data-card">
                      <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: "var(--text-muted)" }}>{t("delivery.paid")}</p>
                      <p className="font-semibold mt-0.5" style={{ color: "var(--text-primary)" }}>${order.paidAmount?.toFixed(2) || "0.00"}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-sm flex-wrap">
                    <span style={{ color: "var(--text-secondary)" }}>{t("delivery.driver")}:</span>
                    {order.assignedName ? (
                      <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${onlineDrivers.includes(order.driverId || "") ? "status-badge-success" : "bg-slate-100 dark:bg-white/[0.06] text-slate-500"}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${onlineDrivers.includes(order.driverId || "") ? "bg-emerald-500" : "bg-slate-400"}`} />
                        {order.assignedName}
                      </span>
                    ) : (
                      <span style={{ color: "var(--text-muted)" }}>{t("delivery.unassigned")}</span>
                    )}
                    {order.customerPhone && (
                      <a href={`https://wa.me/${order.customerPhone.replace(/^0+/, "966")}?text=${encodeURIComponent(`Hi ${order.customerName}, your order ${order.orderNumber} status: ${order.status}`)}`}
                        target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition-all">
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                        WhatsApp
                      </a>
                    )}
                  </div>

                  {order.deliveryNote && (
                    <div className="bg-amber-50 dark:bg-amber-500/5 border border-amber-100 dark:border-amber-500/15 rounded-xl p-3 text-sm text-amber-800 dark:text-amber-200 flex items-start gap-2">
                      <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" /></svg>
                      <span>{order.deliveryNote}</span>
                    </div>
                  )}

                  <div className="overflow-x-auto -mx-5">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-[10px] uppercase tracking-wider border-y" style={{ color: "var(--text-muted)", borderColor: "var(--border-card)" }}>
                          <th className="px-5 py-2 text-start font-semibold">{t("delivery.item")}</th>
                          <th className="py-2 text-end font-semibold">{t("delivery.qty")}</th>
                          <th className="py-2 text-end font-semibold">{t("delivery.price")}</th>
                          <th className="px-5 py-2 text-end font-semibold">{t("delivery.total")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {order.items.map(item => (
                          <tr key={item.id} className="border-b" style={{ borderColor: "var(--border-subtle)" }}>
                            <td className="px-5 py-2" style={{ color: "var(--text-primary)" }}>{item.productName}</td>
                            <td className="py-2 text-end" style={{ color: "var(--text-secondary)" }}>{item.quantity}</td>
                            <td className="py-2 text-end" style={{ color: "var(--text-secondary)" }}>${item.unitPrice.toFixed(2)}</td>
                            <td className="px-5 py-2 text-end font-medium" style={{ color: "var(--text-primary)" }}>${item.total.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 pt-2">
                    {order.status !== "Delivered" && order.status !== "Cancelled" && (
                      <>
                        <div className="flex items-center gap-2">
                          <svg className="w-4 h-4" style={{ color: "var(--text-muted)" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                          <div className="relative" ref={el => searchRef.current[order.id] = el}>
                            <input value={driverSearch[order.id] ?? (order.assignedName || "")}
                              onChange={e => {
                                setDriverSearch(p => ({ ...p, [order.id]: e.target.value }))
                                setShowDropdown(p => ({ ...p, [order.id]: true }))
                              }}
                              onFocus={() => setShowDropdown(p => ({ ...p, [order.id]: true }))}
                              onBlur={() => setTimeout(() => setShowDropdown(p => ({ ...p, [order.id]: false })), 200)}
                              placeholder={t("delivery.search_driver") || "Search driver..."}
                              className="w-44 text-xs h-8 rounded-lg border bg-white/5 border-white/10 text-primary px-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/40" />
                            {showDropdown[order.id] && (() => {
                              const q = (driverSearch[order.id] || "").toLowerCase()
                              const filtered = drivers.filter(d => !q || d.name.toLowerCase().includes(q) || d.code?.toLowerCase().includes(q))
                              return (
                                <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-xl max-h-40 overflow-y-auto">
                                  <button onMouseDown={() => { assignDriver(order.id, ""); setDriverSearch(p => ({ ...p, [order.id]: "" })) }}
                                    className="w-full text-left px-3 py-2 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-700 border-b border-zinc-100 dark:border-zinc-700"
                                    style={{ color: "var(--text-muted)" }}>{t("delivery.unassigned")}</button>
                                  {filtered.map(d => (
                                    <button key={d.id} onMouseDown={() => { assignDriver(order.id, d.id); setDriverSearch(p => ({ ...p, [order.id]: d.name })) }}
                                      className="w-full text-left px-3 py-2 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-700 flex items-center gap-2"
                                      style={{ color: "var(--text-primary)" }}>
                                      <span className={`w-1.5 h-1.5 rounded-full ${onlineDrivers.includes(d.id) ? "bg-emerald-500" : "bg-zinc-400"}`} />
                                      {d.name}
                                    </button>
                                  ))}
                                </div>
                              )
                            })()}
                          </div>
                        </div>
                        {nextStatus(order.status) && (
                          <button onClick={() => updateStatus(order.id, nextStatus(order.status)!)}
                            className="btn-primary text-xs py-2 px-4">
                            {t("delivery.mark_as")} {t(`status.${nextStatus(order.status)}`)}
                          </button>
                        )}
                        <button onClick={() => updateStatus(order.id, "Cancelled")}
                          className="btn-danger text-xs py-2 px-4">
                          {t("delivery.cancel_order")}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
