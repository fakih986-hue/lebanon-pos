import { useEffect, useMemo, useState } from "react"
import {
  Activity, AlertTriangle, ArrowUpRight, Banknote,
  Boxes, CheckCircle2, CircleDollarSign, HandCoins, PackageSearch,
  ReceiptText, TrendingUp, WifiOff,
} from "lucide-react"
import { Link } from "react-router"

import { formatCurrency, formatNumber } from "../../features/pos/lib/currency"
import Spinner from "../../components/ui/Spinner"
import { getLedgerTotals, subscribeLedger } from "../../features/pos/services/customer.service"
import { getExpenses, subscribeExpenses, type Expense } from "../../features/pos/services/expense.service"
import { getProducts, subscribeProducts } from "../../features/pos/services/product.service"
import { getSales, getSalesMetrics, getTopProducts, getOperationalAlerts, subscribeSales, type Sale } from "../../features/pos/services/sales.service"
import { getSettings, subscribeSettings, type AppSettings } from "../../features/pos/services/settings.service"
import { getDeadStockItems, getExpiryAlerts, getReorderSuggestions } from "../../features/pos/services/stock.service"
import type { Product } from "../../features/pos/types/product"
import { buildActionQueue } from "../../features/pos/lib/actionQueue"
import { shouldShowFirstRunPrompt, dismissSetupPrompt } from "../../features/pos/lib/storeSetup"
import { useI18n } from "@lebanonpos/shared"

type DateRange = "today" | "week" | "month"

import { paymentColor } from "../../features/pos/lib/paymentColors"

function getDateStart(range: DateRange) {
  const now = new Date()
  if (range === "today") return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (range === "week") { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate()); d.setDate(d.getDate() - 6); return d }
  return new Date(now.getFullYear(), now.getMonth(), 1)
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-LB", { hour: "2-digit", minute: "2-digit" }).format(new Date(value))
}

/** ── Revenue bar chart ─────────────────────────────────── */
function TrendChart({ sales, range }: { sales: Sale[]; range: DateRange }) {
  const data = useMemo(() => {
    const days = range === "today" ? 1 : range === "week" ? 7 : 30
    const map = new Map<string, { total: number; count: number }>()
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      map.set(key, { total: 0, count: 0 })
    }
    for (const sale of sales) {
      const key = new Date(sale.createdAt).toISOString().slice(0, 10)
      const entry = map.get(key)
      if (entry) { entry.total += sale.total; entry.count++ }
    }
    const today = new Date().toISOString().slice(0, 10)
    return Array.from(map.entries()).map(([date, d]) => ({
      label: new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      isToday: date === today,
      ...d,
    }))
  }, [sales, range])

  const max = Math.max(...data.map((d) => d.total), 1)
  const totalRevenue = data.reduce((s, d) => s + d.total, 0)

  return (
    <div>
      <div className={`flex items-stretch gap-[3px] h-36 mt-4 ${data.length === 1 ? "justify-center" : ""}`}>
        {data.map((d, i) => {
          const pct = (d.total / max) * 100
          return (
            <div key={i} className={`flex flex-col items-center justify-end gap-0.5 group relative ${data.length === 1 ? "w-32" : "flex-1"}`}>
              {/* Tooltip */}
              {d.total > 0 && (
                <div
                  className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 rounded-xl px-2.5 py-1.5 text-[11px] font-bold opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-20 transition-opacity"
                  style={{ background: "var(--surface-3)", color: "var(--text)", boxShadow: "var(--shadow-sm)", border: "1px solid var(--border)" }}
                >
                  {formatCurrency(d.total)}
                  <span className="ms-1.5 font-normal" style={{ color: "var(--text-3)" }}>{d.count}×</span>
                </div>
              )}

              {/* Bar */}
              <div
                className="w-full rounded-t-lg transition-all duration-500"
                style={{
                  height: `${Math.max(pct, 2)}%`,
                  background: d.isToday
                    ? `linear-gradient(180deg, var(--brand-hover), var(--brand))`
                    : `linear-gradient(180deg, rgba(212,168,67,0.55), rgba(212,168,67,0.30))`,
                  opacity: d.total === 0 ? 0.25 : 1,
                  boxShadow: d.isToday && d.total > 0 ? `0 -4px 16px var(--brand-soft)` : "none",
                }}
              />

              {/* Label */}
              {(i === 0 || i === Math.floor(data.length / 2) || i === data.length - 1) && (
                <span className="text-[8px] mt-0.5 truncate max-w-full font-semibold" style={{ color: "var(--text-3)" }}>
                  {d.label}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* Chart footer */}
      <div className="mt-3 flex items-center justify-between text-[11px]" style={{ color: "var(--text-3)" }}>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: "var(--brand)" }} />
          Today
          <span className="h-2 w-2 rounded-full ms-2" style={{ background: "rgba(212,168,67,0.45)" }} />
          Past
        </span>
        <span className="font-bold tabular-nums" style={{ color: "var(--text-2)" }}>{formatCurrency(totalRevenue)} total</span>
      </div>
    </div>
  )
}

/** ── Mini horizontal bar ───────────────────────────────── */
function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--surface-3)" }}>
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${Math.max((value / max) * 100, 2)}%`, background: color }}
      />
    </div>
  )
}

export default function DashboardPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [sales, setSales] = useState<Sale[]>(getSales())
  const [expenses, setExpenses] = useState<Expense[]>(getExpenses())
  const [settings, setSettings] = useState<AppSettings>(getSettings())
  const [ledgerVersion, setLedgerVersion] = useState(0)
  const [dateRange, setDateRange] = useState<DateRange>("today")
  const [showSetupPrompt, setShowSetupPrompt] = useState(false)
  const { t } = useI18n()

  useEffect(() => {
    let active = true
    getProducts().then((data) => { if (active) { setProducts(data); setIsLoading(false); setShowSetupPrompt(shouldShowFirstRunPrompt()) } }).catch(() => { if (active) setIsLoading(false) })
    const u1 = subscribeProducts((d) => { if (active) setProducts(d) })
    const u2 = subscribeSales((d) => { if (active) setSales(d) })
    const u3 = subscribeExpenses((d) => { if (active) setExpenses(d) })
    const u4 = subscribeLedger(() => { if (active) setLedgerVersion((v) => v + 1) })
    const u5 = subscribeSettings((d) => { if (active) setSettings(d) })
    return () => { active = false; u1(); u2(); u3(); u4(); u5() }
  }, [])

  const rangeStart = useMemo(() => getDateStart(dateRange), [dateRange])
  const rangeSales = useMemo(() => sales.filter((s) => new Date(s.createdAt) >= rangeStart && s.status !== "Voided"), [sales, rangeStart])
  const rangeExpenses = useMemo(() => expenses.filter((e) => new Date(e.createdAt) >= rangeStart), [expenses, rangeStart])

  const paidSales        = rangeSales.filter((s) => s.paymentMethod !== "Debt")
  const debtSales        = rangeSales.filter((s) => s.paymentMethod === "Debt")
  const rangeRevenue     = paidSales.reduce((s, x) => s + x.total, 0)
  const rangeDebtIssued  = debtSales.reduce((s, x) => s + x.total, 0)
  const rangeProfit      = rangeSales.reduce((s, x) => s + (x.profit ?? 0), 0)
  const rangeExpenseTotal = rangeExpenses.reduce((s, e) => s + e.amount, 0)
  const rangeOpProfit    = rangeProfit - rangeExpenseTotal
  const rangeTransactions = rangeSales.length
  const avgTicket        = rangeTransactions > 0 ? rangeRevenue / rangeTransactions : 0

  const paymentMix = useMemo(() => {
    const mix: Record<string, number> = {}
    for (const s of rangeSales) mix[s.paymentMethod] = (mix[s.paymentMethod] ?? 0) + s.total
    return mix
  }, [rangeSales])
  const paymentTotal = Object.values(paymentMix).reduce((s, v) => s + v, 0)

  const topProducts   = useMemo(() => getTopProducts(5), [sales])
  const topMax        = topProducts[0]?.total ?? 1
  const ledgerTotals  = useMemo(() => getLedgerTotals(), [ledgerVersion])
  const stockValue    = products.reduce((sum, p) => sum + p.cost * p.stock, 0)
  const recentSales   = rangeSales.slice(0, 8)
  const lowStockProducts = products.filter((p) => p.stock <= settings.lowStockThreshold).sort((a, b) => a.stock - b.stock).slice(0, 5)
  const reorderSuggestions = useMemo(() => getReorderSuggestions(products), [products])
  const expiryAlerts       = useMemo(() => getExpiryAlerts(products, 30), [products])
  const deadStockItems     = useMemo(() => getDeadStockItems(products, 60).slice(0, 3), [products])
  const operationalAlerts  = useMemo(() => getOperationalAlerts(), [ledgerVersion])
  // POS-OWNER-DASHBOARD-POLISH-1: action-verb labels, correct links, and a
  // critical-first / money-at-risk order (pure helper — no calculation change).
  const actionQueue = useMemo(() => buildActionQueue({
    outstanding: ledgerTotals.outstanding,
    debtCustomers: ledgerTotals.customers,
    lowStock: lowStockProducts.map((p) => ({ name: p.name, stock: p.stock, cost: p.cost })),
    deadStock: deadStockItems.map((d) => ({ name: d.product.name, stock: d.product.stock, cost: d.product.cost })),
    operationalAlerts,
    fmtMoney: formatCurrency,
    fmtNum: formatNumber,
  }), [ledgerTotals, lowStockProducts, deadStockItems, operationalAlerts])
  const actionCount = actionQueue.length

  const rangeLabel: Record<DateRange, string> = {
    today: t("desktop.dashboard.range_today"),
    week:  t("desktop.dashboard.range_week"),
    month: t("desktop.dashboard.range_month"),
  }

  if (isLoading) return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-page p-4 sm:p-6">
      <div className="mx-auto max-w-[1400px] space-y-5">
        <div className="skeleton h-10 w-48 rounded-lg" style={{ background: "var(--surface-3)", animation: "pulse 1.5s infinite" }} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {[1,2,3,4,5].map(i => (
            <div key={i} className="skeleton h-28 rounded-2xl" style={{ background: "var(--surface-3)", animation: "pulse 1.5s infinite" }} />
          ))}
        </div>
        <div className="skeleton h-3 w-full rounded" style={{ background: "var(--surface-3)", animation: "pulse 1.5s infinite" }} />
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]">
          <div className="skeleton h-64 rounded-2xl" style={{ background: "var(--surface-3)", animation: "pulse 1.5s infinite" }} />
          <div className="skeleton h-64 rounded-2xl" style={{ background: "var(--surface-3)", animation: "pulse 1.5s infinite" }} />
        </div>
      </div>
    </main>
  )

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-page">
      <div className="mx-auto max-w-[1400px] p-4 sm:p-6 space-y-5">

        {/* ── Header ──────────────────────────────────────── */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-[24px] font-bold tracking-tight" style={{ color: "var(--text)" }}>
              {settings.storeName || t("desktop.dashboard.owner_digest")}
            </h1>
            <p className="text-[13px] mt-0.5" style={{ color: "var(--text-3)" }}>
              {t("desktop.dashboard.owner_subtitle")}
            </p>
          </div>

          {/* Date range */}
          <div className="flex overflow-hidden rounded-xl border p-1 gap-1" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
            {(["today", "week", "month"] as DateRange[]).map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={dateRange === r}
                onClick={() => setDateRange(r)}
                className="rounded-lg px-4 h-9 text-[13px] font-bold transition-all"
                style={dateRange === r
                  ? { background: "var(--brand)", color: "#fff", boxShadow: "0 2px 8px var(--brand-soft)" }
                  : { color: "var(--text-3)" }
                }
              >
                {rangeLabel[r]}
              </button>
            ))}
          </div>
        </div>

        {/* POS-FIRST-SETUP-CATALOG-1B: non-blocking first-run prompt (fresh store only) */}
        {showSetupPrompt && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border p-4" style={{ background: "var(--brand-soft)", borderColor: "var(--brand-border)" }}>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-bold" style={{ color: "var(--brand-text)" }}>Set up your product catalog</p>
              <p className="text-[12px] mt-0.5" style={{ color: "var(--text-2)" }}>Import your product list or add items to start selling. Opening stock is recorded separately from purchases.</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Link to="/settings" className="btn btn-primary btn-sm">Set up catalog</Link>
              <button type="button" onClick={() => { dismissSetupPrompt(); setShowSetupPrompt(false) }}
                className="btn btn-ghost btn-sm" aria-label="Dismiss setup prompt">Dismiss</button>
            </div>
          </div>
        )}

        {/* ── KPI row ─────────────────────────────────────── */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {[
            {
              label: t("desktop.dashboard.net_paid"),
              value: formatCurrency(rangeRevenue),
              sub: `${formatNumber(rangeTransactions)} sales · avg ${formatCurrency(avgTicket)}`,
              icon: CircleDollarSign,
              bg: "var(--success-soft)",
              fg: "var(--success)",
              badge: rangeDebtIssued > 0 ? `+${formatCurrency(rangeDebtIssued)} debt` : null,
            },
            {
              label: t("desktop.dashboard.operating_profit"),
              value: formatCurrency(rangeOpProfit),
              sub: `${formatCurrency(rangeExpenseTotal)} expenses deducted`,
              icon: TrendingUp,
              bg: "var(--info-soft)",
              fg: "var(--info)",
              badge: rangeRevenue > 0 ? `${((rangeOpProfit / rangeRevenue) * 100).toFixed(1)}% margin` : null,
            },
            {
              label: t("desktop.dashboard.outstanding"),
              value: formatCurrency(ledgerTotals.outstanding),
              sub: `${formatNumber(ledgerTotals.customers)} customer accounts`,
              icon: HandCoins,
              bg: "var(--warning-soft)",
              fg: "var(--warning)",
              alert: ledgerTotals.outstanding > 0,
            },
            {
              label: t("desktop.dashboard.stock_value"),
              value: formatCurrency(stockValue),
              sub: `${formatNumber(lowStockProducts.length)} low-stock alerts`,
              icon: Boxes,
              bg: "var(--brand-soft)",
              fg: "var(--brand)",
              badge: reorderSuggestions.filter((r) => r.suggestedQuantity > 0).length > 0
                ? `${reorderSuggestions.filter((r) => r.suggestedQuantity > 0).length} to reorder`
                : null,
            },
            // Day close card removed — available in Reports → Daily Close
          ].map((card) => {
            const Icon = card.icon
            return (
              <div
                key={card.label}
                aria-label={`${card.label}: ${card.value}`}
                className="flex flex-col gap-3 rounded-2xl border p-4"
                style={{ background: "var(--surface)", borderColor: "var(--border)", boxShadow: "var(--shadow-xs)" }}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--text-3)" }}>
                    {card.label}
                  </p>
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                    style={{ background: card.bg }}
                  >
                    <Icon size={17} strokeWidth={2} style={{ color: card.fg }} />
                  </span>
                </div>

                <div>
                  <p
                    className="text-[26px] font-bold tabular-nums leading-none"
                    style={{ color: card.alert ? "var(--rose)" : "var(--text)" }}
                  >
                    {card.value}
                  </p>
                  <p className="mt-1 text-[11px]" style={{ color: "var(--text-3)" }}>{card.sub}</p>
                </div>

                {card.badge && (
                  <span
                    className="w-fit rounded-lg px-2 py-0.5 text-[10px] font-bold"
                    style={{ background: "var(--brand-soft)", color: "var(--brand-text)", border: "1px solid var(--brand-border)" }}
                  >
                    <ArrowUpRight size={10} className="inline me-0.5" />
                    {card.badge}
                  </span>
                )}
              </div>
            )
          })}
        </section>

        {/* Payment mix bar — compact under KPIs */}
        {Object.keys(paymentMix).length > 0 && (
          <div className="flex flex-wrap items-center gap-2 px-1">
            <span className="text-[10px] font-bold uppercase tracking-wide shrink-0" style={{ color: "var(--text-3)" }}>Revenue mix</span>
            <div className="flex items-center h-2.5 rounded-full overflow-hidden min-w-24 flex-1" style={{ background: "var(--surface-3)" }}>
              {Object.entries(paymentMix).sort(([, a], [, b]) => b - a).map(([method, total]) => {
                const pct = paymentTotal > 0 ? (total / paymentTotal) * 100 : 0
                return (
                  <span key={method} className="h-full transition-all shrink-0" title={`${method}: ${formatCurrency(total)}`}
                    style={{ width: `${pct}%`, background: paymentColor(method).solid }} />
                )
              })}
            </div>
            {Object.entries(paymentMix).slice(0, 4).map(([method, total]) => (
              <span key={method} className="text-[10px] font-semibold tabular-nums" style={{ color: "var(--text-2)" }}>
                {method} {paymentTotal > 0 ? Math.round((total / paymentTotal) * 100) : 0}%
              </span>
            ))}
          </div>
        )}

        {/* ── Main grid ───────────────────────────────────── */}
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]">

          {/* LEFT column */}
          <div className="space-y-5">

            {/* Revenue trend */}
            <div className="rounded-2xl border p-5" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-[15px] font-bold" style={{ color: "var(--text)" }}>
                    {t("desktop.dashboard.revenue_trend")}
                  </h2>
                  <p className="text-[12px] mt-0.5" style={{ color: "var(--text-3)" }}>{rangeLabel[dateRange]}</p>
                </div>
                <span className="text-[22px] font-bold tabular-nums" style={{ color: "var(--brand)" }}>
                  {formatCurrency(rangeRevenue)}
                </span>
              </div>
              <TrendChart sales={rangeSales} range={dateRange} />
            </div>

            {/* Payment mix + Top products */}
            <div className="grid gap-5 lg:grid-cols-2">

              {/* Payment mix */}
              <div className="rounded-2xl border p-4" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
                <div className="flex items-center gap-2 mb-4">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: "var(--success-soft)" }}>
                    <Banknote size={14} strokeWidth={2} style={{ color: "var(--success)" }} />
                  </span>
                  <h3 className="text-[13px] font-bold" style={{ color: "var(--text)" }}>{t("desktop.dashboard.payment_mix")}</h3>
                </div>

                {Object.keys(paymentMix).length === 0 ? (
                  <div className="py-4 text-center">
                    <p className="text-[13px] font-bold" style={{ color: "var(--text-2)" }}>No sales yet</p>
                    <p className="mt-0.5 text-[12px]" style={{ color: "var(--text-3)" }}>Payment mix appears after the first sale.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Stacked bar */}
                    <div className="flex h-3 overflow-hidden rounded-full gap-0.5">
                      {Object.entries(paymentMix).map(([method, amount]) => {
                        const pct = paymentTotal > 0 ? (amount / paymentTotal) * 100 : 0
                        const col = paymentColor(method).solid
                        return <div key={method} className="rounded-full transition-all" style={{ width: `${pct}%`, background: col }} />
                      })}
                    </div>

                    {Object.entries(paymentMix).map(([method, amount]) => {
                      const pct = paymentTotal > 0 ? (amount / paymentTotal) * 100 : 0
                      const col = paymentColor(method)
                      return (
                        <div key={method} className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: col.solid }} />
                            <span className="text-[12px] font-semibold truncate" style={{ color: "var(--text-2)" }}>{method}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[11px]" style={{ color: "var(--text-3)" }}>{pct.toFixed(0)}%</span>
                            <span className="text-[13px] font-bold tabular-nums" style={{ color: "var(--text)" }}>{formatCurrency(amount)}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Top products */}
              <div className="rounded-2xl border p-4" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
                <div className="flex items-center gap-2 mb-4">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: "var(--info-soft)" }}>
                    <PackageSearch size={14} strokeWidth={2} style={{ color: "var(--info)" }} />
                  </span>
                  <h3 className="text-[13px] font-bold" style={{ color: "var(--text)" }}>{t("desktop.dashboard.top_products")}</h3>
                </div>

                {topProducts.length === 0 ? (
                  <p className="text-[13px] py-4 text-center" style={{ color: "var(--text-3)" }}>Sales will appear here</p>
                ) : (
                  <div className="space-y-3">
                    {topProducts.map((product, i) => (
                      <div key={product.name}>
                        <div className="flex items-center gap-2.5 mb-1">
                          <span
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                            style={i === 0
                              ? { background: "var(--brand)", color: "#fff" }
                              : { background: "var(--surface-2)", color: "var(--text-3)" }
                            }
                          >{i + 1}</span>
                          <span className="min-w-0 flex-1 truncate text-[12px] font-semibold" style={{ color: "var(--text)" }}>{product.name}</span>
                          <div className="shrink-0 text-end">
                            <span className="block text-[13px] font-bold tabular-nums" style={{ color: "var(--text)" }}>{formatCurrency(product.total)}</span>
                            <span className="block text-[10px] tabular-nums" style={{ color: "var(--text-3)" }}>{formatNumber(product.quantity)} sold</span>
                          </div>
                        </div>
                        <MiniBar value={product.total} max={topMax} color={i === 0 ? "var(--brand)" : "var(--surface-3)"} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT column */}
          <div className="space-y-5">

            {/* Action queue */}
            <div className="rounded-2xl border overflow-hidden" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
              <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: actionCount > 0 ? "var(--danger-soft)" : "var(--success-soft)" }}>
                    <AlertTriangle size={13} strokeWidth={2} style={{ color: actionCount > 0 ? "var(--danger)" : "var(--success)" }} />
                  </span>
                  <h3 className="text-[13px] font-bold" style={{ color: "var(--text)" }}>{t("desktop.dashboard.action_queue")}</h3>
                </div>
                {actionCount > 0 && (
                  <span className="flex h-6 min-w-[24px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold text-white"
                    style={{ background: "var(--danger)" }}>
                    {actionCount}
                  </span>
                )}
              </div>

              <div className="max-h-[280px] overflow-y-auto p-3 space-y-2">
                {actionQueue.length === 0 && (
                  <div className="py-8 text-center">
                    <CheckCircle2 size={28} className="mx-auto mb-2" style={{ color: "var(--success)" }} />
                    <p className="text-[13px] font-bold" style={{ color: "var(--success)" }}>All clear</p>
                    <p className="text-[11px] mt-0.5" style={{ color: "var(--text-3)" }}>No urgent items need attention</p>
                  </div>
                )}

                {actionQueue.map((item) => {
                  const color = item.severity === "critical" ? "var(--rose)" : "var(--amber)"
                  const bg = item.severity === "critical" ? "var(--rose-soft)" : "var(--amber-soft)"
                  return (
                    <Link
                      key={item.key}
                      to={item.link}
                      className="flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 transition hover:opacity-80 cursor-pointer"
                      style={{ background: bg, border: `1px solid ${color}20` }}
                      aria-label={`${item.label} — ${item.sub}`}
                    >
                      <div className="min-w-0">
                        <p className="text-[12px] font-bold truncate" style={{ color }}>{item.label}</p>
                        <p className="text-[10px] truncate" style={{ color, opacity: 0.7 }}>{item.sub}</p>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg shrink-0" style={{ background: color, color: "#fff" }}>
                        {item.tag}
                      </span>
                    </Link>
                  )
                })}
              </div>
            </div>

            {/* Recent sales */}
            <div className="rounded-2xl border overflow-hidden" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
              <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
                <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: "var(--info-soft)" }}>
                  <Activity size={13} strokeWidth={2} style={{ color: "var(--info)" }} />
                </span>
                <h3 className="text-[13px] font-bold" style={{ color: "var(--text)" }}>{t("desktop.dashboard.recent_sales")}</h3>
                <span className="ms-auto text-[11px] font-semibold tabular-nums" style={{ color: "var(--text-3)" }}>
                  {formatNumber(rangeTransactions)} total
                </span>
              </div>

              <div className="divide-y" style={{ borderColor: "var(--border)" }}>
                {recentSales.length === 0 && (
                  <div className="px-4 py-8 text-center">
                    <ReceiptText size={22} className="mx-auto" style={{ color: "var(--text-3)" }} />
                    <p className="mt-2 text-[13px] font-bold" style={{ color: "var(--text-2)" }}>No sales yet</p>
                    <p className="mt-0.5 text-[12px]" style={{ color: "var(--text-3)" }}>Recent sales will appear here as you sell.</p>
                  </div>
                )}
                {recentSales.map((sale) => {
                  const col = paymentColor(sale.paymentMethod)
                  return (
                    <div key={sale.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--surface-hover)] transition-colors">
                      <ReceiptText size={14} style={{ color: "var(--text-3)", flexShrink: 0 }} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-bold tabular-nums" style={{ color: "var(--text)" }}>{sale.saleNumber}</p>
                        <p className="text-[10px]" style={{ color: "var(--text-3)" }}>{formatTime(sale.createdAt)}</p>
                      </div>
                      <span
                        className="shrink-0 rounded-lg px-2 py-0.5 text-[10px] font-bold"
                        style={{ background: col.soft, color: col.text }}
                      >
                        {sale.paymentMethod}
                      </span>
                      <span className="shrink-0 text-[13px] font-bold tabular-nums" style={{ color: "var(--text)" }}>
                        {formatCurrency(sale.total)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>

          </div>
        </div>

      </div>
    </main>
  )
}
