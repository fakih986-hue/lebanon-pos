import { useEffect, useMemo, useRef, useState } from "react"
import { useDebounce } from "../../hooks/useDebounce"
import { useHotkeys } from "../../hooks/useHotkey"
import { useSearchParams } from "react-router"
import {
  ArrowDownUp,
  BarChart3,
  Calendar,
  ChevronDown,
  Download,
  Filter,
  ReceiptText,
  Search,
  X,
} from "lucide-react"

import { formatCurrency } from "../../features/pos/lib/currency"
import { getSettings } from "../../features/pos/services/settings.service"
import {
  getPaymentMix,
  getRefunds,
  getSales,
  getSalesMetrics,
  recordRefund,
  subscribeRefunds,
  subscribeSales,
  voidSale,
  type Sale,
  type SalePaymentMethod,
  type SaleRefund,
} from "../../features/pos/services/sales.service"
import { recordDebtPayment } from "../../features/pos/services/customer.service"
import { restoreInventoryBatches } from "../../features/pos/services/inventoryBatch.service"
import { increaseProductStock } from "../../features/pos/services/product.service"
import { userCan } from "../../features/pos/services/security.service"
import {
  getRefundMethod,
  getRefundTotal,
  getRefundableQuantity,
  getSaleRefunds,
  parseReturnQuantity,
} from "../../features/pos/lib/salesHelpers"
import { printSaleReceipt } from "../../features/pos/lib/printReceipt"
import InsightsPanel from "../../features/pos/components/InsightsPanel"
import ReceiptList from "../../features/pos/components/ReceiptList"
import ReceiptPreview from "../../features/pos/components/ReceiptPreview"
import SalesKpiCards from "../../features/pos/components/SalesKpiCards"
import ConfirmDialog from "../../components/ConfirmDialog"
import WorkspaceTabs from "../../components/ui/WorkspaceTabs"
import { useI18n } from "@lebanonpos/shared"

type SalesTab = "Receipts" | "Insights"
type DateRange = "today" | "week" | "month" | "all"
type SortOrder = "newest" | "oldest" | "highest" | "lowest"

function getDateRangeStart(range: DateRange): Date | null {
  const now = new Date()
  if (range === "today") return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (range === "week") {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    d.setDate(d.getDate() - 6)
    return d
  }
  if (range === "month") return new Date(now.getFullYear(), now.getMonth(), 1)
  return null
}

function getItemName(item: any): string {
  return item.name ?? item.productName ?? ""
}

function exportSalesCsv(sales: Sale[]) {
  const header = ["Sale #", "Date", "Payment", "Customer", "Cashier", "Items", "Subtotal", "Discount", "Tax", "Total", "Profit", "Status"]
  const rows = sales.map((s) => [
    s.saleNumber,
    new Date(s.createdAt).toLocaleString(),
    s.paymentMethod,
    s.customerName ?? "",
    s.cashier,
    s.items.reduce((sum, i) => sum + i.quantity, 0),
    s.subtotal.toFixed(2),
    (s.discountTotal ?? 0).toFixed(2),
    s.tax.toFixed(2),
    s.total.toFixed(2),
    (s.profit ?? 0).toFixed(2),
    s.status,
  ])
  const csv = [header, ...rows]
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n")
  const blob = new Blob([csv], { type: "text/csv" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `sales-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function groupSalesByDay(sales: Sale[]) {
  const groups = new Map<string, Sale[]>()
  for (const sale of sales) {
    const day = new Date(sale.createdAt).toLocaleDateString("en-LB", { weekday: "long", year: "numeric", month: "long", day: "numeric" })
    if (!groups.has(day)) groups.set(day, [])
    groups.get(day)!.push(sale)
  }
  return Array.from(groups.entries()).map(([date, items]) => ({ date, items }))
}

const PM_COLORS: Record<string, string> = {
  Cash:   "bg-emerald-100 text-emerald-700",
  Card:   "bg-indigo-100 text-indigo-700",
  Wallet: "bg-violet-100 text-violet-700",
  Debt:   "bg-amber-100 text-amber-700",
}
const STATUS_COLORS: Record<string, string> = {
  Completed: "bg-emerald-100 text-emerald-700",
  Voided:    "bg-zinc-100 text-zinc-500 line-through",
  Debt:      "bg-amber-100 text-amber-700",
}

export default function SalesPage() {
  const { t } = useI18n()
  const [searchParams, setSearchParams] = useSearchParams()
  const [sales, setSales] = useState<Sale[]>(getSales())
  const [refunds, setRefunds] = useState<SaleRefund[]>(getRefunds())
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebounce(search, 200)
  const [paymentFilter, setPaymentFilter] = useState<"All" | SalePaymentMethod>("All")
  const [statusFilter, setStatusFilter] = useState<"All" | "Completed" | "Voided" | "Debt">("All")
  const [cashierFilter, setCashierFilter] = useState("All")
  const [dateRange, setDateRange] = useState<DateRange>("all")
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest")
  const [groupByDay, setGroupByDay] = useState(false)
  const [activeTab, setActiveTab] = useState<SalesTab>(
    searchParams.get("tab") === "insights" ? "Insights" : "Receipts"
  )
  const [selectedSaleId, setSelectedSaleId] = useState("")
  const [drawerSaleId, setDrawerSaleId] = useState<string | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [refundQuantities, setRefundQuantities] = useState<Record<string, string>>({})
  const [refundReason, setRefundReason] = useState("")
  const [refundStatus, setRefundStatus] = useState(t("pos.sales.refund_status_default"))
  const [pendingRefund, setPendingRefund] = useState<{
    sale: Sale
    refundTotal: number
    refundItems: Array<{ id: number; name: string; barcode: string; quantity: number; unitPrice: number; cost: number; total: number }>
    refundReason: string
  } | null>(null)
  const [voidSaleId, setVoidSaleId] = useState<string | null>(null)

  useEffect(() => subscribeSales(setSales), [])
  useEffect(() => subscribeRefunds(setRefunds), [])
  useEffect(() => {
    setActiveTab(searchParams.get("tab") === "insights" ? "Insights" : "Receipts")
  }, [searchParams])

  const searchRef = useRef<HTMLInputElement>(null)
  useHotkeys([{ key: "f", modifiers: ["ctrl"], handler: () => searchRef.current?.focus() }])

  const settings = getSettings()
  const metrics = useMemo(() => getSalesMetrics(), [sales, refunds])
  const paymentMix = useMemo(() => getPaymentMix(), [sales, refunds])

  // All unique cashiers for filter
  const cashiers = useMemo(() => {
    const names = new Set(sales.map((s) => s.cashier).filter(Boolean))
    return Array.from(names).sort()
  }, [sales])

  const filteredSales = useMemo(() => {
    const query = debouncedSearch.trim().toLowerCase()
    const rangeStart = getDateRangeStart(dateRange)

    let result = sales.filter((sale) => {
      if (paymentFilter !== "All" && sale.paymentMethod !== paymentFilter) return false
      if (statusFilter !== "All" && sale.status !== statusFilter) return false
      if (cashierFilter !== "All" && sale.cashier !== cashierFilter) return false
      if (rangeStart && new Date(sale.createdAt) < rangeStart) return false
      if (query) {
        const matchesSearch =
          sale.saleNumber.toLowerCase().includes(query) ||
          (sale.customerName ?? "").toLowerCase().includes(query) ||
          sale.cashier.toLowerCase().includes(query) ||
          (sale.shiftNumber ?? "").toLowerCase().includes(query) ||
          sale.items.some((item) => getItemName(item).toLowerCase().includes(query))
        if (!matchesSearch) return false
      }
      return true
    })

    switch (sortOrder) {
      case "newest":  result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()); break
      case "oldest":  result.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()); break
      case "highest": result.sort((a, b) => b.total - a.total); break
      case "lowest":  result.sort((a, b) => a.total - b.total); break
    }

    return result
  }, [sales, debouncedSearch, paymentFilter, statusFilter, cashierFilter, dateRange, sortOrder])

  const filteredRevenue = filteredSales.filter((s) => s.status !== "Voided").reduce((s, x) => s + x.total, 0)
  const filteredProfit = filteredSales.filter((s) => s.status !== "Voided").reduce((s, x) => s + (x.profit ?? 0), 0)

  const activeFilterCount = [
    paymentFilter !== "All",
    statusFilter !== "All",
    cashierFilter !== "All",
    dateRange !== "all",
  ].filter(Boolean).length

  const selectedSale = sales.find((s) => s.id === selectedSaleId) ?? filteredSales[0]
  const drawerSale = sales.find((s) => s.id === drawerSaleId)
  const canRefund = userCan("sales.refund")

  useEffect(() => {
    if (!selectedSale && filteredSales[0]) setSelectedSaleId(filteredSales[0].id)
  }, [filteredSales, selectedSale])

  useEffect(() => {
    setRefundQuantities({})
    setRefundReason("")
    setRefundStatus(t("pos.sales.refund_status_default"))
  }, [drawerSaleId, selectedSale?.id])

  function selectTab(tab: SalesTab) {
    setActiveTab(tab)
    setSearchParams({ tab: tab === "Insights" ? "insights" : "receipts" })
  }

  function handlePrint(sale: Sale) {
    printSaleReceipt(sale, settings.usdToLbpRate, refunds)
  }

  function handleRefundQuantityChange(itemId: number, value: string) {
    setRefundQuantities((q) => ({ ...q, [String(itemId)]: value }))
  }

  function handleRecordRefund(sale: Sale) {
    if (!canRefund) { setRefundStatus(t("pos.permission_required")); return }
    const saleRefunds = getSaleRefunds(refunds, sale.id)
    const refundItems = sale.items.map((item) => {
      const available = getRefundableQuantity(sale, item, refunds)
      const qty = Math.min(parseReturnQuantity(refundQuantities[String(item.id)] ?? ""), available)
      return { ...item, quantity: qty, total: item.unitPrice * qty }
    }).filter((item) => item.quantity > 0)

    if (refundItems.length === 0) { setRefundStatus(t("pos.sales.choose_item_qty")); return }
    const alreadyRefunded = saleRefunds.reduce((s, r) => s + r.total, 0)
    const refundTotal = Math.min(Math.max(0, sale.total - alreadyRefunded), getRefundTotal(sale, refundItems))
    if (refundTotal <= 0) { setRefundStatus(t("pos.sales.no_refundable_balance")); return }
    setPendingRefund({ sale, refundTotal, refundItems: refundItems.map((i) => ({ id: i.id, name: i.name, barcode: i.barcode, quantity: i.quantity, unitPrice: i.unitPrice, cost: i.cost, total: i.total })), refundReason })
  }

  function executeRefund() {
    if (!pendingRefund) return
    const { sale, refundTotal, refundItems, refundReason } = pendingRefund
    const refund = recordRefund({ saleId: sale.id, saleNumber: sale.saleNumber, customerId: sale.customerId, customerName: sale.customerName, method: getRefundMethod(sale), reason: refundReason, total: refundTotal, items: refundItems })
    increaseProductStock(refundItems.map((i) => ({ productId: i.id, quantity: i.quantity })))
    restoreInventoryBatches(refundItems.map((i) => ({ productId: i.id, productName: i.name, barcode: i.barcode, quantity: i.quantity, fallbackUnitCost: i.cost })))
    if (sale.paymentMethod === "Debt" && sale.customerId) {
      recordDebtPayment({ customerId: sale.customerId, amount: refundTotal, method: "Refund Credit", reference: `${refund.refundNumber} return for ${sale.saleNumber}` })
    }
    setRefunds(getRefunds())
    setRefundQuantities({})
    setRefundReason("")
    setPendingRefund(null)
    setRefundStatus(t("pos.sales.refund_recorded", { refund: refund.refundNumber }))
  }

  const dateRangeOptions: { key: DateRange; label: string }[] = [
    { key: "today", label: t("pos.sales.today") },
    { key: "week",  label: t("pos.sales.this_week") },
    { key: "month", label: t("pos.sales.this_month") },
    { key: "all",   label: t("pos.sales.all_time") },
  ]

  const sortOptions: { key: SortOrder; label: string }[] = [
    { key: "newest",  label: t("pos.sales.sort_newest") },
    { key: "oldest",  label: t("pos.sales.sort_oldest") },
    { key: "highest", label: t("pos.sales.sort_highest") },
    { key: "lowest",  label: t("pos.sales.sort_lowest") },
  ]

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-page p-3 sm:p-5 xl:p-6">
      <SalesKpiCards metrics={metrics} />

      {/* ── Tab bar + search row ── */}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <WorkspaceTabs<SalesTab>
          active={activeTab}
          onChange={selectTab}
          tabs={[
            { label: t("pos.sales.tab_receipts") as SalesTab, icon: <ReceiptText size={15} />, count: filteredSales.length },
            { label: t("pos.sales.tab_insights") as SalesTab, icon: <BarChart3 size={15} /> },
          ]}
        />

        <div className="flex flex-wrap gap-2">
          {/* Search */}
          <label className="relative min-w-[200px] flex-1 sm:flex-none sm:w-56">
            <Search size={14} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-3)" }} />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("pos.sales.search_placeholder")}
              className="input w-full ps-9"
              style={{ height: 36 }}
            />
            {search && (
              <button type="button" onClick={() => setSearch("")} className="absolute end-2.5 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100">
                <X size={14} style={{ color: "var(--text-3)" }} />
              </button>
            )}
          </label>

          {/* Sort */}
          <div className="relative">
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as SortOrder)}
              className="input appearance-none pe-8 ps-9"
              style={{ height: 36, fontSize: 13, fontWeight: 600 }}
            >
              {sortOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
            <ArrowDownUp size={14} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-3)" }} />
          </div>

          {/* Filters toggle */}
          <button
            type="button"
            onClick={() => setFiltersOpen(!filtersOpen)}
            className={`btn btn-default h-9 gap-2 relative ${filtersOpen ? "ring-2 ring-[var(--brand)]" : ""}`}
          >
            <Filter size={14} />
            Filters
            {activeFilterCount > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--brand)] text-[10px] font-bold text-white">
                {activeFilterCount}
              </span>
            )}
          </button>

          {/* Export */}
          <button
            type="button"
            onClick={() => exportSalesCsv(filteredSales)}
            disabled={filteredSales.length === 0}
            className="btn btn-default h-9 gap-2"
          >
            <Download size={14} />
            {t("pos.sales.export_csv")}
          </button>
        </div>
      </div>

      {/* ── Filter panel ── */}
      {filtersOpen && (
        <div
          className="mt-3 rounded-xl border p-4 animate-fade-in"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        >
          <div className="flex flex-wrap gap-4">
            {/* Date range */}
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-3)" }}>
                <Calendar size={11} className="inline mr-1" />
                Date Range
              </p>
              <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: "var(--border)" }}>
                {dateRangeOptions.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => setDateRange(o.key)}
                    className="px-3 h-8 text-[12px] font-semibold transition"
                    style={dateRange === o.key
                      ? { background: "var(--text)", color: "var(--surface)" }
                      : { color: "var(--text-2)" }
                    }
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Payment method */}
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-3)" }}>Payment</p>
              <div className="flex flex-wrap gap-1.5">
                {(["All", "Cash", "Card", "Wallet", "Debt"] as const).map((pm) => (
                  <button
                    key={pm}
                    type="button"
                    onClick={() => setPaymentFilter(pm)}
                    className="h-8 rounded-lg border px-3 text-[12px] font-semibold transition"
                    style={paymentFilter === pm
                      ? { background: "var(--text)", borderColor: "var(--text)", color: "var(--surface)" }
                      : { borderColor: "var(--border)", color: "var(--text-2)" }
                    }
                  >
                    {pm === "All" ? t("pos.sales.all_payments") : t(`pos.payment.${pm.toLowerCase()}`)}
                  </button>
                ))}
              </div>
            </div>

            {/* Status */}
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-3)" }}>Status</p>
              <div className="flex flex-wrap gap-1.5">
                {(["All", "Completed", "Voided", "Debt"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatusFilter(s)}
                    className="h-8 rounded-lg border px-3 text-[12px] font-semibold transition"
                    style={statusFilter === s
                      ? { background: "var(--text)", borderColor: "var(--text)", color: "var(--surface)" }
                      : { borderColor: "var(--border)", color: "var(--text-2)" }
                    }
                  >
                    {s === "All" ? "All" : t(`pos.sales.status_${s.toLowerCase()}`)}
                  </button>
                ))}
              </div>
            </div>

            {/* Cashier */}
            {cashiers.length > 1 && (
              <div>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-3)" }}>Cashier</p>
                <select
                  value={cashierFilter}
                  onChange={(e) => setCashierFilter(e.target.value)}
                  className="input h-8"
                  style={{ fontSize: 12, fontWeight: 600, minWidth: 140 }}
                >
                  <option value="All">{t("pos.sales.filter_cashier")}</option>
                  {cashiers.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}

            {/* Group by day toggle */}
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-3)" }}>View</p>
              <button
                type="button"
                onClick={() => setGroupByDay(!groupByDay)}
                className="h-8 rounded-lg border px-3 text-[12px] font-semibold transition gap-2 flex items-center"
                style={groupByDay
                  ? { background: "var(--accent-soft)", borderColor: "var(--accent)", color: "var(--accent-text)" }
                  : { borderColor: "var(--border)", color: "var(--text-2)" }
                }
              >
                {t("pos.sales.group_by_day")}
              </button>
            </div>

            {/* Clear */}
            {activeFilterCount > 0 && (
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => { setPaymentFilter("All"); setStatusFilter("All"); setCashierFilter("All"); setDateRange("all") }}
                  className="h-8 rounded-lg px-3 text-[12px] font-semibold transition hover:opacity-80"
                  style={{ color: "var(--rose)", background: "var(--rose-soft)" }}
                >
                  Clear filters
                </button>
              </div>
            )}
          </div>

          {/* Results summary */}
          <div
            className="mt-3 rounded-lg px-3 py-2 text-[12px] font-semibold flex items-center justify-between"
            style={{ background: "var(--surface-2)", color: "var(--text-2)" }}
          >
            <span>
              <span style={{ color: "var(--text)" }}>{filteredSales.length}</span> sales
              {" · "}
              <span style={{ color: "var(--brand-text)" }}>{formatCurrency(filteredRevenue)}</span> revenue
              {filteredProfit > 0 && (
                <> · <span style={{ color: "var(--brand-text)" }}>{formatCurrency(filteredProfit)}</span> profit</>
              )}
            </span>
            {search && (
              <span style={{ color: "var(--text-3)" }}>matching "{search}"</span>
            )}
          </div>
        </div>
      )}

      {/* ── Content ── */}
      {activeTab === "Receipts" ? (
        <section className="mt-4">
          {groupByDay && activeTab === "Receipts" ? (
            // Grouped by day view
            <div className="space-y-4">
              {groupSalesByDay(filteredSales).map(({ date, items: daySales }) => (
                <div key={date}>
                  <div className="flex items-center justify-between mb-2 px-1">
                    <p className="text-[12px] font-bold uppercase tracking-wide" style={{ color: "var(--text-3)" }}>{date}</p>
                    <p className="text-[12px] font-semibold" style={{ color: "var(--text-3)" }}>
                      {daySales.length} sales · {formatCurrency(daySales.filter((s) => s.status !== "Voided").reduce((sum, s) => sum + s.total, 0))}
                    </p>
                  </div>
                  <div className="grid gap-4 xl:grid-cols-[minmax(320px,430px)_minmax(0,1fr)]">
                    <div className="space-y-2">
                      {daySales.map((sale) => (
                        <SaleRow
                          key={sale.id}
                          sale={sale}
                          selected={selectedSaleId === sale.id}
                          refunds={refunds}
                          onSelect={() => setSelectedSaleId(sale.id)}
                          onView={() => { setSelectedSaleId(sale.id); setDrawerSaleId(sale.id) }}
                          onPrint={() => handlePrint(sale)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              ))}
              {filteredSales.length === 0 && <EmptyResult />}
            </div>
          ) : (
            // Standard two-pane view
            <div className="grid gap-4 xl:grid-cols-[minmax(320px,430px)_minmax(0,1fr)]">
              <ReceiptList
                filteredSales={filteredSales}
                selectedSaleId={selectedSaleId}
                refunds={refunds}
                onSelectSale={setSelectedSaleId}
                handlePrint={handlePrint}
                onViewSale={(sale) => { setSelectedSaleId(sale.id); setDrawerSaleId(sale.id) }}
              />
              <div className="hidden xl:block">
                <div className="sticky top-4">
                  <ReceiptPreview
                    sale={selectedSale}
                    fallbackExchangeRate={settings.usdToLbpRate}
                    refunds={refunds}
                    refundQuantities={refundQuantities}
                    refundReason={refundReason}
                    refundStatus={refundStatus}
                    canRefund={canRefund}
                    onPrint={handlePrint}
                    onRefundQuantityChange={handleRefundQuantityChange}
                    onRefundReasonChange={setRefundReason}
                    onRecordRefund={handleRecordRefund}
                    onVoid={setVoidSaleId}
                  />
                </div>
              </div>
            </div>
          )}
        </section>
      ) : (
        <InsightsPanel
          filteredSales={filteredSales}
          paymentMix={paymentMix}
          onViewSale={(sale) => setDrawerSaleId(sale.id)}
          onExportCsv={() => exportSalesCsv(filteredSales)}
        />
      )}

      {/* Mobile receipt drawer */}
      {drawerSale && (
        <div
          className="fixed inset-0 z-50 flex justify-end"
          onKeyDown={(e) => { if (e.key === "Escape") setDrawerSaleId(null) }}
          tabIndex={0}
        >
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setDrawerSaleId(null)} />
          <aside
            role="dialog"
            aria-modal="true"
            className="relative z-10 flex h-full w-full max-w-2xl flex-col overflow-hidden shadow-2xl sm:rounded-xl animate-fade-in"
            style={{ background: "var(--surface)" }}
          >
            <div className="flex-1 overflow-y-auto">
              <ReceiptPreview
                sale={drawerSale}
                fallbackExchangeRate={settings.usdToLbpRate}
                refunds={refunds}
                refundQuantities={refundQuantities}
                refundReason={refundReason}
                refundStatus={refundStatus}
                canRefund={canRefund}
                onClose={() => setDrawerSaleId(null)}
                onPrint={handlePrint}
                onRefundQuantityChange={handleRefundQuantityChange}
                onRefundReasonChange={setRefundReason}
                onRecordRefund={handleRecordRefund}
                onVoid={setVoidSaleId}
              />
            </div>
          </aside>
        </div>
      )}

      <ConfirmDialog
        open={!!pendingRefund}
        title={t("pos.record_return")}
        confirmLabel={t("pos.record_return")}
        confirmDestructive
        onConfirm={executeRefund}
        onCancel={() => setPendingRefund(null)}
      >
        <p>{t("pos.sales.confirm_refund", { count: pendingRefund?.refundItems.length ?? 0, total: formatCurrency(pendingRefund?.refundTotal ?? 0) })}</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={voidSaleId !== null}
        title={t("pos.sales.void_sale_title")}
        confirmLabel={t("pos.void")}
        confirmDestructive
        onConfirm={() => { if (voidSaleId) { voidSale(voidSaleId); setVoidSaleId(null) } }}
        onCancel={() => setVoidSaleId(null)}
      >
        <p>{t("pos.sales.void_sale_message")}</p>
      </ConfirmDialog>
    </main>
  )
}

// ── Compact sale row for grouped view ──
function SaleRow({ sale, selected, refunds, onSelect, onView, onPrint }: {
  sale: Sale; selected: boolean; refunds: SaleRefund[]
  onSelect: () => void; onView: () => void; onPrint: () => void
}) {
  const saleRefunds = refunds.filter((r) => r.saleId === sale.id)
  return (
    <button
      type="button"
      onClick={onSelect}
      onDoubleClick={onView}
      className="w-full rounded-xl border px-4 py-3 text-left transition"
      style={selected
        ? { borderColor: "var(--brand)", background: "var(--brand-soft)" }
        : { borderColor: "var(--border)", background: "var(--surface)" }
      }
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${PM_COLORS[sale.paymentMethod] ?? "bg-zinc-100 text-zinc-600"}`}>
            {sale.paymentMethod}
          </span>
          <span className="text-[13px] font-bold truncate" style={{ color: "var(--text)" }}>{sale.saleNumber}</span>
          {saleRefunds.length > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">↩ {saleRefunds.length}</span>
          )}
        </div>
        <span className="text-[14px] font-black tabular-nums shrink-0" style={{ color: "var(--text)" }}>
          {formatCurrency(sale.total)}
        </span>
      </div>
      {(sale.customerName || sale.cashier) && (
        <div className="mt-1 flex gap-3 text-[11px]" style={{ color: "var(--text-3)" }}>
          {sale.customerName && <span>{sale.customerName}</span>}
          {sale.cashier && <span>{sale.cashier}</span>}
          <span className="ml-auto">{new Date(sale.createdAt).toLocaleTimeString("en-LB", { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
      )}
    </button>
  )
}

function EmptyResult() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <ReceiptText size={40} style={{ color: "var(--text-3)" }} className="mb-4" />
      <p className="text-[15px] font-semibold" style={{ color: "var(--text-2)" }}>No sales match your filters</p>
      <p className="text-[13px] mt-1" style={{ color: "var(--text-3)" }}>Try adjusting the date range or clearing filters</p>
    </div>
  )
}
