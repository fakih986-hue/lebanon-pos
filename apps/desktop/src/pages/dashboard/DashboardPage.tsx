import { useEffect, useMemo, useState } from "react"
import {
  Activity,
  AlertTriangle,
  Banknote,
  Boxes,
  CircleDollarSign,
  ClipboardList,
  HandCoins,
  PackageSearch,
  ReceiptText,
  TrendingUp,
} from "lucide-react"

import { formatCurrency, formatNumber } from "../../features/pos/lib/currency"
import Spinner from "../../components/ui/Spinner"
import EmptyState from "../../components/ui/EmptyState"
import {
  getCustomerLedger,
  getLedgerTotals,
  subscribeLedger,
} from "../../features/pos/services/customer.service"
import {
  getExpenses,
  subscribeExpenses,
  type Expense,
} from "../../features/pos/services/expense.service"
import {
  getProducts,
  subscribeProducts,
} from "../../features/pos/services/product.service"
import {
  getPaymentMix,
  getSales,
  getSalesMetrics,
  getTopProducts,
  subscribeSales,
  type Sale,
} from "../../features/pos/services/sales.service"
import {
  getSettings,
  subscribeSettings,
  type AppSettings,
} from "../../features/pos/services/settings.service"
import {
  getDeadStockItems,
  getExpiryAlerts,
  getPromoSuggestions,
  getReorderSuggestions,
} from "../../features/pos/services/stock.service"
import type { Product } from "../../features/pos/types/product"
import { useI18n } from "@lebanonpos/shared"

type DateRange = "today" | "week" | "month"

const PAYMENT_COLORS: Record<string, string> = {
  Cash: "#10b981",
  Card: "#6366f1",
  Wallet: "#8b5cf6",
  Debt: "#f59e0b",
}

function getDateStart(range: DateRange) {
  const now = new Date()
  if (range === "today") return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (range === "week") {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    d.setDate(d.getDate() - 6)
    return d
  }
  return new Date(now.getFullYear(), now.getMonth(), 1)
}

function TrendChart({ sales, range }: { sales: Sale[]; range: DateRange }) {
  const data = useMemo(() => {
    const days = range === "today" ? 1 : range === "week" ? 7 : 30
    const map = new Map<string, { total: number; count: number }>()
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      map.set(key, { total: 0, count: 0 })
    }
    for (const sale of sales) {
      const key = new Date(sale.createdAt).toISOString().slice(0, 10)
      const entry = map.get(key)
      if (entry) { entry.total += sale.total; entry.count++ }
    }
    return Array.from(map.entries()).map(([date, d]) => ({
      label: new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      ...d,
    }))
  }, [sales, range])

  const max = Math.max(...data.map((d) => d.total), 1)
  return (
    <div className="flex items-end gap-[3px] h-32 mt-3">
      {data.map((d, i) => {
        const pct = (d.total / max) * 100
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-0.5 group relative">
            <div
              className="w-full rounded-t transition-all duration-300 hover:opacity-80 cursor-default"
              style={{ height: `${Math.max(pct, 3)}%`, background: "linear-gradient(180deg,#818cf8,#4f46e5)" }}
            />
            {d.total > 0 && (
              <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-zinc-900 text-white text-[10px] font-medium px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-10 shadow-lg">
                {formatCurrency(d.total)} · {d.count}×
              </div>
            )}
            {(i === 0 || i === Math.floor(data.length / 2) || i === data.length - 1) && (
              <span className="text-[8px] text-zinc-400 mt-0.5 truncate max-w-full font-medium">{d.label}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-LB", { hour: "2-digit", minute: "2-digit" }).format(new Date(value))
}

export default function DashboardPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [sales, setSales] = useState<Sale[]>(getSales())
  const [expenses, setExpenses] = useState<Expense[]>(getExpenses())
  const [settings, setSettings] = useState<AppSettings>(getSettings())
  const [ledgerVersion, setLedgerVersion] = useState(0)
  const [dateRange, setDateRange] = useState<DateRange>("today")
  const { t } = useI18n()

  useEffect(() => {
    let active = true
    getProducts().then((data) => { if (active) { setProducts(data); setIsLoading(false) } }).catch(() => { if (active) setIsLoading(false) })
    const unsubscribeProducts = subscribeProducts((data) => { if (active) setProducts(data) })
    const unsubscribeSales = subscribeSales((data) => { if (active) setSales(data) })
    const unsubscribeExpenses = subscribeExpenses((data) => { if (active) setExpenses(data) })
    const unsubscribeLedger = subscribeLedger(() => { if (active) setLedgerVersion((v) => v + 1) })
    const unsubscribeSettings = subscribeSettings((data) => { if (active) setSettings(data) })
    return () => { active = false; unsubscribeProducts(); unsubscribeSales(); unsubscribeExpenses(); unsubscribeLedger(); unsubscribeSettings() }
  }, [])

  const rangeStart = useMemo(() => getDateStart(dateRange), [dateRange])

  const rangeSales = useMemo(
    () => sales.filter((s) => new Date(s.createdAt) >= rangeStart),
    [sales, rangeStart]
  )
  const rangeExpenses = useMemo(
    () => expenses.filter((e) => new Date(e.createdAt) >= rangeStart),
    [expenses, rangeStart]
  )

  const metrics = useMemo(() => getSalesMetrics(), [sales, settings])
  const rangeRevenue = rangeSales.reduce((s, x) => s + x.total, 0)
  const rangeProfit = rangeSales.reduce((s, x) => s + (x.profit ?? 0), 0)
  const rangeExpenseTotal = rangeExpenses.reduce((s, e) => s + e.amount, 0)
  const rangeOpProfit = rangeProfit - rangeExpenseTotal
  const rangeTransactions = rangeSales.length

  const paymentMix = useMemo(() => {
    const mix: Record<string, number> = {}
    for (const sale of rangeSales) {
      mix[sale.paymentMethod] = (mix[sale.paymentMethod] ?? 0) + sale.total
    }
    return mix
  }, [rangeSales])

  const topProducts = useMemo(() => getTopProducts(5), [sales])
  const ledgerTotals = useMemo(() => getLedgerTotals(), [ledgerVersion])
  const customerLedger = useMemo(() => getCustomerLedger(), [ledgerVersion])
  const lowStockProducts = products
    .filter((p) => p.stock <= settings.lowStockThreshold)
    .sort((a, b) => a.stock - b.stock)
    .slice(0, 6)
  const stockValue = products.reduce((sum, p) => sum + p.cost * p.stock, 0)
  const recentSales = rangeSales.slice(0, 6)
  const riskyCustomers = customerLedger.filter((c) => c.balance > 0).sort((a, b) => b.balance - a.balance).slice(0, 5)
  const reorderSuggestions = useMemo(() => getReorderSuggestions(products), [products, sales])
  const expiryAlerts = useMemo(() => getExpiryAlerts(products, 30), [products])
  const deadStockItems = useMemo(() => getDeadStockItems(products, 60), [products, sales])
  const promoSuggestions = useMemo(() => getPromoSuggestions(products), [products, sales])

  const rangeLabel: Record<DateRange, string> = {
    today: t("desktop.dashboard.range_today"),
    week: t("desktop.dashboard.range_week"),
    month: t("desktop.dashboard.range_month"),
  }

  if (isLoading) {
    return (
      <main className="flex min-h-0 flex-1 items-center justify-center bg-page p-6">
        <Spinner label={t("desktop.dashboard.loading")} />
      </main>
    )
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-page p-3 sm:p-5 xl:p-6">
      {/* Header + date range picker */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-zinc-950 text-white">
            <ClipboardList size={21} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-zinc-950">{t("desktop.dashboard.owner_digest")}</h1>
            <p className="text-sm text-zinc-500">{t("desktop.dashboard.owner_subtitle")}</p>
          </div>
        </div>
        <div className="flex rounded-lg border border-zinc-200 bg-white overflow-hidden text-sm font-semibold">
          {(["today", "week", "month"] as DateRange[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setDateRange(r)}
              className={`px-4 h-10 transition ${dateRange === r ? "bg-zinc-950 text-white" : "text-zinc-600 hover:bg-zinc-50"}`}
            >
              {rangeLabel[r]}
            </button>
          ))}
        </div>
      </div>

      {/* KPI stat cards */}
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4 mb-5">
        {[
          { label: t("desktop.dashboard.net_paid"), value: formatCurrency(rangeRevenue), sub: `${formatNumber(rangeTransactions)} ${t("desktop.dashboard.transactions")}`, icon: CircleDollarSign, color: "text-emerald-700", bg: "bg-emerald-50" },
          { label: t("desktop.dashboard.operating_profit"), value: formatCurrency(rangeOpProfit), sub: `${formatCurrency(rangeExpenseTotal)} ${t("desktop.dashboard.expenses_today")}`, icon: TrendingUp, color: "text-indigo-700", bg: "bg-indigo-50" },
          { label: t("desktop.dashboard.outstanding"), value: formatCurrency(ledgerTotals.outstanding), sub: `${formatNumber(ledgerTotals.customers)} ${t("desktop.dashboard.customer_accounts")}`, icon: HandCoins, color: "text-rose-700", bg: "bg-rose-50", valueColor: "text-rose-700" },
          { label: t("desktop.dashboard.stock_value"), value: formatCurrency(stockValue), sub: `${formatNumber(lowStockProducts.length)} ${t("desktop.dashboard.low_stock_products")}`, icon: Boxes, color: "text-amber-700", bg: "bg-amber-50" },
        ].map((card) => {
          const Icon = card.icon
          return (
            <div key={card.label} className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{card.label}</p>
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${card.bg}`}>
                  <Icon size={18} className={card.color} />
                </div>
              </div>
              <p className={`mt-3 text-2xl font-bold ${card.valueColor ?? "text-zinc-950"}`}>{card.value}</p>
              <p className="mt-1 text-xs text-zinc-500">{card.sub}</p>
            </div>
          )
        })}
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(340px,0.5fr)]">
        <div className="space-y-5">
          {/* Revenue trend chart */}
          <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-zinc-950">{t("desktop.dashboard.revenue_trend")} — {rangeLabel[dateRange]}</h2>
              <span className="text-sm font-bold text-zinc-500">{formatCurrency(rangeRevenue)}</span>
            </div>
            <TrendChart sales={rangeSales} range={dateRange} />
          </div>

          {/* Command center: payment mix + top products */}
          <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
            <div className="border-b border-zinc-200 p-4">
              <h2 className="text-base font-bold text-zinc-950">{t("desktop.dashboard.command_center")}</h2>
              <p className="text-sm text-zinc-500">{t("desktop.dashboard.command_center_subtitle")}</p>
            </div>
            <div className="grid gap-4 p-4 lg:grid-cols-2">
              <div className="rounded-lg border border-zinc-200 p-4">
                <div className="mb-3 flex items-center gap-2 font-bold text-zinc-950">
                  <Banknote size={18} className="text-emerald-700" />
                  {t("desktop.dashboard.payment_mix")}
                </div>
                {Object.entries(paymentMix).length === 0 ? (
                  <p className="text-sm text-zinc-400">{t("desktop.dashboard.no_sales_yet")}</p>
                ) : Object.entries(paymentMix).map(([method, amount]) => {
                  const total = Object.values(paymentMix).reduce((s, v) => s + v, 0)
                  const pct = total > 0 ? (amount / total) * 100 : 0
                  return (
                    <div key={method} className="mb-3 last:mb-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-zinc-600">{method}</span>
                        <span className="text-sm font-bold text-zinc-950">{formatCurrency(amount)}</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-zinc-100">
                        <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, backgroundColor: PAYMENT_COLORS[method] ?? "#6b7280" }} />
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="rounded-lg border border-zinc-200 p-4">
                <div className="mb-3 flex items-center gap-2 font-bold text-zinc-950">
                  <PackageSearch size={18} className="text-indigo-700" />
                  {t("desktop.dashboard.top_products")}
                </div>
                {topProducts.length === 0 ? (
                  <EmptyState icon={PackageSearch} title={t("desktop.dashboard.sales_will_appear")} className="border-0 bg-transparent py-6" />
                ) : topProducts.map((product, i) => (
                  <div key={product.name} className="flex items-center gap-3 border-b border-zinc-100 py-2 last:border-0">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-zinc-950">{product.name}</p>
                      <p className="text-xs text-zinc-500">{formatNumber(product.quantity)} {t("desktop.dashboard.sold")}</p>
                    </div>
                    <span className="font-bold text-zinc-950">{formatCurrency(product.total)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-5">
          {/* Action queue */}
          <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
            <div className="border-b border-zinc-200 p-4">
              <div className="flex items-center gap-2">
                <AlertTriangle size={18} className="text-amber-700" />
                <h2 className="text-base font-bold text-zinc-950">{t("desktop.dashboard.action_queue")}</h2>
                <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">
                  {lowStockProducts.length + riskyCustomers.length}
                </span>
              </div>
            </div>
            <div className="space-y-2 p-4 max-h-80 overflow-y-auto">
              {lowStockProducts.length === 0 && riskyCustomers.length === 0 ? (
                <EmptyState icon={AlertTriangle} title={t("desktop.dashboard.no_urgent_work")} className="border-0 bg-transparent py-6" />
              ) : null}
              {lowStockProducts.map((product) => (
                <div key={product.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="font-bold text-amber-900">{product.name}</p>
                  <p className="text-xs text-amber-700">{formatNumber(product.stock)} {t("desktop.dashboard.units_left")}</p>
                </div>
              ))}
              {riskyCustomers.map((customer) => (
                <div key={customer.id} className="rounded-lg border border-rose-200 bg-rose-50 p-3">
                  <p className="font-bold text-rose-900">{customer.name}</p>
                  <p className="text-xs text-rose-700">{t("desktop.dashboard.owes")} {formatCurrency(customer.balance)}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Inventory alerts */}
          {(expiryAlerts.length > 0 || reorderSuggestions.filter((r) => r.suggestedQuantity > 0).length > 0) && (
            <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
              <div className="border-b border-zinc-200 p-4">
                <div className="flex items-center gap-2">
                  <Boxes size={18} className="text-indigo-700" />
                  <h2 className="text-base font-bold text-zinc-950">{t("desktop.dashboard.inventory_work")}</h2>
                </div>
              </div>
              <div className="space-y-2 p-4 max-h-60 overflow-y-auto">
                {expiryAlerts.slice(0, 4).map((p) => (
                  <div key={p.id} className="flex justify-between rounded-lg border border-orange-200 bg-orange-50 p-3">
                    <p className="text-sm font-bold text-orange-900">{p.name}</p>
                    <p className="text-xs text-orange-700">{t("desktop.dashboard.expires")} {p.expiryDate}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent sales */}
          <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
            <div className="border-b border-zinc-200 p-4">
              <div className="flex items-center gap-2">
                <Activity size={18} className="text-zinc-700" />
                <h2 className="text-base font-bold text-zinc-950">{t("desktop.dashboard.recent_sales")}</h2>
              </div>
            </div>
            <div className="space-y-2 p-4">
              {recentSales.length === 0 ? (
                <EmptyState icon={ReceiptText} title={t("desktop.dashboard.no_sales_yet")} className="border-0 bg-transparent py-6" />
              ) : null}
              {recentSales.map((sale) => (
                <div key={sale.id} className="flex items-center justify-between rounded-lg border border-zinc-200 p-3">
                  <div className="flex items-center gap-2">
                    <ReceiptText size={17} className="text-zinc-500" />
                    <div>
                      <p className="font-bold text-zinc-950">{sale.saleNumber}</p>
                      <p className="text-xs text-zinc-500">{sale.paymentMethod} — {formatTime(sale.createdAt)}</p>
                    </div>
                  </div>
                  <span className="font-bold text-zinc-950">{formatCurrency(sale.total)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
