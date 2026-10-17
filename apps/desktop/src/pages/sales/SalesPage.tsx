import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useSearchParams } from "react-router"
import { AlertTriangle, ArrowDownUp, CheckCircle2, Download, Lock, Printer, ReceiptText, RotateCcw, Search, XCircle } from "lucide-react"
import { useI18n } from "@lebanonpos/shared"

import { useDebounce } from "../../hooks/useDebounce"
import { useHotkeys } from "../../hooks/useHotkey"
import InsightsPanel from "../../features/pos/components/InsightsPanel"
import MoneyConflictsPanel from "../../features/pos/components/MoneyConflictsPanel"
import { Badge, ConfirmLayer, Drawer, EmptyState, FilterChip, PageHeader, PageTabs, StatTile } from "../../features/pos/components/backoffice/BackOffice"
import { formatCurrency, formatLbpCurrency, formatNumber, usdToLbp } from "../../features/pos/lib/currency"
import { printSaleReceipt } from "../../features/pos/lib/printReceipt"
import {
  getRefundMethod, getRefundTotal, getRefundableQuantity, getRefundedQuantity, getSaleExchangeRate, getSaleGrossSubtotal, getSaleQuantity,
  getSaleRefundTotal, getSaleRefunds, parseReturnQuantity,
} from "../../features/pos/lib/salesHelpers"
import {
  getPaymentMix, getRefunds, getSales, getSalesMetrics, previewRefund, processRefund, refundLineKeyOf, subscribeRefunds, subscribeSales, voidSale,
  type RefundItem, type Sale, type SalePaymentMethod, type SaleRefund,
} from "../../features/pos/services/sales.service"
import { userCan } from "../../features/pos/services/security.service"
import { getSettings } from "../../features/pos/services/settings.service"

// Midnight Gold v2 — Receipts (DESIGN-SYSTEM §6–§8, Sell workspace). A filtered receipt table
// (cards on phones) and a receipt drawer with returns and void. Refunds go through the existing
// preview -> confirm -> processRefund path (REFUND-INTEGRITY-1: the amount shown is the amount
// recorded); voids through voidSale. Totals, LBP and rounding are shown exactly as recorded.
type Tab = "receipts" | "insights"
type DateRange = "today" | "week" | "month" | "all"
type SortOrder = "newest" | "oldest" | "highest" | "lowest"
type Status = "All" | "Completed" | "Voided" | "Debt" | "Refunded"
const RANGES: DateRange[] = ["today", "week", "month", "all"]
const PAYMENTS: Array<"All" | SalePaymentMethod> = ["All", "Cash", "Card", "Wallet", "Debt"]
const STATUSES: Status[] = ["All", "Completed", "Debt", "Refunded", "Voided"]

function rangeStart(range: DateRange): Date | null {
  const now = new Date()
  if (range === "today") return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (range === "week") { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate()); d.setDate(d.getDate() - 6); return d }
  if (range === "month") return new Date(now.getFullYear(), now.getMonth(), 1)
  return null
}
const itemName = (item: { name?: string; productName?: string }) => item.name ?? item.productName ?? ""

function exportSalesCsv(sales: Sale[]) {
  const rate = getSettings().usdToLbpRate
  const header = ["Sale #", "Date", "Payment", "Customer", "Cashier", "Items", "Subtotal", "Discount", "Tax", "Total", "Total (LBP)", "Cash Payable (LBP)", "Profit", "Profit (LBP)", "Status"]
  const rows = sales.map((s) => [
    s.saleNumber ?? "", s.createdAt ? new Date(s.createdAt).toLocaleString() : "", s.paymentMethod ?? "", s.customerName ?? "", s.cashier ?? "",
    Array.isArray(s.items) ? s.items.reduce((sum, i) => sum + (i.quantity ?? 0), 0) : 0,
    (s.subtotal ?? 0).toFixed(2), (s.discountTotal ?? 0).toFixed(2), (s.tax ?? 0).toFixed(2), (s.total ?? 0).toFixed(2),
    Math.round((s.total ?? 0) * (rate ?? 0)).toString(), s.payableLbp ? Math.round(s.payableLbp).toString() : "",
    (s.profit ?? 0).toFixed(2), Math.round((s.profit ?? 0) * (rate ?? 0)).toString(), s.status ?? "",
  ])
  const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n")
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }))
  const a = document.createElement("a"); a.href = url; a.download = `sales-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url)
}

function useDate() {
  const { locale } = useI18n()
  const tag = locale === "ar" ? "ar-LB" : "en-GB"
  return {
    stamp: (v: string) => new Intl.DateTimeFormat(tag, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(v)),
    full: (v: string) => new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeStyle: "short" }).format(new Date(v)),
    dayHead: (v: string) => new Intl.DateTimeFormat(tag, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(v)),
    time: (v: string) => new Intl.DateTimeFormat(tag, { hour: "2-digit", minute: "2-digit" }).format(new Date(v)),
  }
}

export default function SalesPage() {
  const { t } = useI18n()
  const date = useDate()
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get("tab") === "insights" ? "insights" : "receipts"
  const [sales, setSales] = useState<Sale[]>(getSales())
  const [refunds, setRefunds] = useState<SaleRefund[]>(getRefunds())
  const [search, setSearch] = useState("")
  const q = useDebounce(search, 150)
  const searchRef = useRef<HTMLInputElement>(null)
  useHotkeys([{ key: "f", modifiers: ["ctrl"], handler: () => searchRef.current?.focus() }])
  const [payment, setPayment] = useState<"All" | SalePaymentMethod>("All")
  const [status, setStatus] = useState<Status>("All")
  const [cashier, setCashier] = useState("All")
  const [range, setRange] = useState<DateRange>("all")
  const [sort, setSort] = useState<SortOrder>("newest")
  const [groupByDay, setGroupByDay] = useState(false)
  const receiptId = params.get("receipt")
  const [refundQuantities, setRefundQuantities] = useState<Record<string, string>>({})
  const [refundReason, setRefundReason] = useState("")
  const [refundStatus, setRefundStatus] = useState<{ tone: "ok" | "err" | "info"; text: string } | null>(null)
  const [pendingRefund, setPendingRefund] = useState<{ sale: Sale; refundTotal: number; refundItems: RefundItem[]; refundReason: string; quantities: Record<string, number> } | null>(null)
  const [voidSaleId, setVoidSaleId] = useState<string | null>(null)
  // Confirm can be pressed twice before the dialog closes: the ref is the lock (state updates late).
  const refundingRef = useRef(false)

  useEffect(() => subscribeSales(setSales), [])
  useEffect(() => subscribeRefunds(setRefunds), [])
  const settings = getSettings()
  const metrics = useMemo(() => getSalesMetrics(), [sales, refunds])
  const paymentMix = useMemo(() => getPaymentMix(), [sales, refunds])
  const cashiers = useMemo(() => Array.from(new Set(sales.map((s) => s.cashier).filter((c): c is string => typeof c === "string" && c.length > 0))).sort(), [sales])
  const canRefund = userCan("sales.refund")
  const canReprint = userCan("sales.reprint")
  const canVoid = userCan("sales.void")

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    const start = rangeStart(range)
    const result = sales.filter((s) => {
      if (payment !== "All" && s.paymentMethod !== payment) return false
      if (status === "Refunded" ? getSaleRefundTotal(refunds, s.id) <= 0 : status !== "All" && s.status !== status) return false
      if (cashier !== "All" && s.cashier !== cashier) return false
      if (start && new Date(s.createdAt) < start) return false
      if (query && !((s.saleNumber ?? "").toLowerCase().includes(query) || (s.customerName ?? "").toLowerCase().includes(query) ||
        (s.cashier ?? "").toLowerCase().includes(query) || (s.shiftNumber ?? "").toLowerCase().includes(query) ||
        (Array.isArray(s.items) && s.items.some((i) => itemName(i).toLowerCase().includes(query))))) return false
      return true
    })
    const by: Record<SortOrder, (a: Sale, b: Sale) => number> = {
      newest: (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      oldest: (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      highest: (a, b) => b.total - a.total,
      lowest: (a, b) => a.total - b.total,
    }
    return result.sort(by[sort])
  }, [sales, refunds, q, payment, status, cashier, range, sort])
  const revenue = filtered.filter((s) => s.status !== "Voided").reduce((sum, s) => sum + s.total, 0)
  const profit = filtered.filter((s) => s.status !== "Voided").reduce((sum, s) => sum + (s.profit ?? 0), 0)
  const filtersOn = payment !== "All" || status !== "All" || cashier !== "All" || range !== "all" || !!search
  const statusCount = (s: Status) => sales.filter((x) => (s === "All" ? true : s === "Refunded" ? getSaleRefundTotal(refunds, x.id) > 0 : x.status === s)).length
  const receipt = receiptId ? sales.find((s) => s.id === receiptId) : undefined

  /** Open (or close) a receipt; a different receipt starts with an empty return form. */
  function openReceipt(id: string | null) {
    if (id !== receiptId) { setRefundQuantities({}); setRefundReason(""); setRefundStatus(null) }
    const next = new URLSearchParams(params); if (id) next.set("receipt", id); else next.delete("receipt")
    setParams(next, { replace: true })
  }
  function clearFilters() { setSearch(""); setPayment("All"); setStatus("All"); setCashier("All"); setRange("all") }
  function handlePrint(sale: Sale) { if (canReprint) printSaleReceipt(sale, settings.usdToLbpRate, refunds) }
  function describeError(error: unknown) {
    const m = error instanceof Error ? error.message : String(error)
    if (m.startsWith("VOID_HAS_REFUNDS")) return t("pos.refund.error_void_has_refunds")
    if (m.startsWith("REFUND_EXCEEDS")) return t("pos.refund.error_exceeds")
    if (m.startsWith("REFUND_SALE_VOIDED")) return t("pos.refund.error_sale_voided")
    return m
  }
  /** Requested quantities per sale-line key, capped at what remains refundable. */
  function requestedQuantities(sale: Sale) {
    const quantities: Record<string, number> = {}
    for (const item of sale.items) {
      const key = refundLineKeyOf(item)
      if (key in quantities) continue // legacy lines of one product share a pooled key
      const qty = Math.min(parseReturnQuantity(refundQuantities[key] ?? ""), getRefundableQuantity(sale, item, refunds))
      if (qty > 0) quantities[key] = qty
    }
    return quantities
  }
  function handleRecordRefund(sale: Sale) {
    if (!canRefund) { setRefundStatus({ tone: "err", text: t("pos.permission_required") }); return }
    const quantities = requestedQuantities(sale)
    if (Object.keys(quantities).length === 0) { setRefundStatus({ tone: "err", text: t("pos.sales.choose_item_qty") }); return }
    try {
      // REFUND-INTEGRITY-1: the amount shown is exactly what will be recorded.
      const preview = previewRefund({ saleId: sale.id, quantities, reason: refundReason })
      if (preview.total <= 0) { setRefundStatus({ tone: "err", text: t("pos.sales.no_refundable_balance") }); return }
      const refundItems: RefundItem[] = preview.planned.map((line) => {
        const item = preview.itemFor(line.key)!
        return { id: line.productId, name: item.name, barcode: item.barcode, quantity: line.quantity, unitPrice: item.unitPrice, total: item.unitPrice * line.quantity, saleLineId: line.key }
      })
      refundingRef.current = false // a new confirmation: the next Confirm may record it (once)
      setPendingRefund({ sale, refundTotal: preview.total, refundItems, refundReason, quantities })
    } catch (error) {
      setRefundStatus({ tone: "err", text: describeError(error) })
    }
  }
  function executeRefund() {
    if (!pendingRefund || refundingRef.current) return
    refundingRef.current = true
    const { sale, refundReason: reason, quantities } = pendingRefund
    try {
      const refund = processRefund({ saleId: sale.id, quantities, reason })
      setRefunds(getRefunds())
      setRefundQuantities({})
      setRefundReason("")
      setRefundStatus({ tone: "ok", text: t("pos.sales.refund_recorded", { refund: refund.refundNumber }) })
    } catch (error) {
      // Nothing was issued: the refund rolled back, so no money should change hands.
      setRefundStatus({ tone: "err", text: describeError(error) })
    } finally {
      setPendingRefund(null)
    }
  }
  function executeVoid(saleId: string) {
    try { voidSale(saleId); setRefundStatus({ tone: "ok", text: t("rcpt.voided") }) } catch (error) { setRefundStatus({ tone: "err", text: describeError(error) }) }
    setVoidSaleId(null)
  }

  const rate = settings.usdToLbpRate
  const statusBadges = (s: Sale) => {
    const refunded = getSaleRefundTotal(refunds, s.id)
    const exact = usdToLbp(s.total, getSaleExchangeRate(s, rate))
    return (
      <>
        {s.status === "Voided" && <Badge tone="err" icon={<XCircle size={13} aria-hidden="true" />}>{t("pos.sales.status_voided")}</Badge>}
        {s.status === "Debt" && <Badge tone="warn">{t("rcpt.on_account")}</Badge>}
        {refunded > 0 && <Badge tone="info" icon={<RotateCcw size={13} aria-hidden="true" />}>{t("rcpt.refunded_amount", { amount: formatCurrency(refunded) })}</Badge>}
        {Boolean(s.payableLbp) && s.payableLbp !== exact && <Badge tone="muted">{t("rcpt.rounded")}</Badge>}
        {s.soldAtCost && <Badge tone="muted">{t("rcpt.at_cost")}</Badge>}
      </>
    )
  }
  const groups = useMemo(() => {
    if (!groupByDay) return [{ key: "all", label: "", items: filtered }]
    const m = new Map<string, Sale[]>()
    for (const s of filtered) { const d = new Date(s.createdAt); const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; m.set(k, [...(m.get(k) ?? []), s]) }
    return [...m.entries()].map(([key, items]) => ({ key, label: date.dayHead(items[0].createdAt), items }))
  }, [filtered, groupByDay, date])

  return (
    <main className="mg2 mg2-bo min-h-0 flex-1 overflow-y-auto">
      <div className="mg2-wrap">
        <PageHeader eyebrow={t("rcpt.sell")} title={t("rcpt.title")} actions={
          <button type="button" className="mg2-btn" onClick={() => exportSalesCsv(filtered)} disabled={filtered.length === 0}><Download size={16} />{t("rcpt.export")}</button>
        } />
        <PageTabs label={t("rcpt.tabs")} current={tab} items={[{ value: "receipts", label: t("pos.sales.tab_receipts"), count: sales.length }, { value: "insights", label: t("pos.sales.tab_insights") }]} />

        {/* REFUND-INTEGRITY-1: server-rejected refunds stay visible until settled */}
        <MoneyConflictsPanel />

        <div className="mg2-stats" style={{ marginBlock: 16 }}>
          <StatTile label={t("rcpt.kpi.gross")} value={<>{formatCurrency(metrics.todayGross)}<span className="mg2-cap" style={{ display: "block", fontSize: 13, fontWeight: 500 }}>{formatLbpCurrency(usdToLbp(metrics.todayGross, rate))}</span></>} />
          <StatTile label={t("rcpt.kpi.net")} value={<>{formatCurrency(metrics.todayNetRevenue)}<span className="mg2-cap" style={{ display: "block", fontSize: 13, fontWeight: 500 }}>{formatLbpCurrency(usdToLbp(metrics.todayNetRevenue, rate))}</span></>} />
          <StatTile label={t("rcpt.kpi.refunds")} value={<span className={metrics.todayRefunds > 0 ? "t-pos" : undefined}>{formatCurrency(metrics.todayRefunds)}</span>} />
          <StatTile label={t("rcpt.kpi.count")} value={formatNumber(metrics.todayTransactions)} />
        </div>

        <div className="mg2-toolbar">
          <div className="mg2-search">
            <Search size={16} aria-hidden="true" />
            <input ref={searchRef} className="mg2-input" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("rcpt.search")} aria-label={t("rcpt.search")} />
          </div>
          <select className="mg2-select" value={payment} onChange={(e) => setPayment(e.target.value as "All" | SalePaymentMethod)} aria-label={t("rcpt.payment")}>
            {PAYMENTS.map((p) => <option key={p} value={p}>{p === "All" ? t("pos.sales.all_payments") : t(`pos.payment.${p.toLowerCase()}`)}</option>)}
          </select>
          {cashiers.length > 1 && (
            <select className="mg2-select" value={cashier} onChange={(e) => setCashier(e.target.value)} aria-label={t("rcpt.cashier")}>
              <option value="All">{t("pos.sales.filter_cashier")}</option>
              {cashiers.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <label className="mg2-select" style={{ display: "inline-flex", alignItems: "center", gap: 6, paddingInlineEnd: 4 }}>
            <ArrowDownUp size={14} aria-hidden="true" style={{ color: "var(--text-3)" }} />
            <select value={sort} onChange={(e) => setSort(e.target.value as SortOrder)} aria-label={t("rcpt.sort")} style={{ background: "transparent", border: 0, color: "inherit", font: "inherit", minHeight: "calc(var(--mg2-ctl) - 2px)" }}>
              {(["newest", "oldest", "highest", "lowest"] as const).map((k) => <option key={k} value={k}>{t(`pos.sales.sort_${k}`)}</option>)}
            </select>
          </label>
        </div>
        <div className="mg2-chips" role="group" aria-label={t("rcpt.when")} style={{ marginBottom: 8 }}>
          {RANGES.map((r) => <FilterChip key={r} pressed={range === r} onClick={() => setRange(r)} label={t(`rcpt.range.${r}`)} />)}
          <span aria-hidden="true" style={{ width: 1, background: "var(--border)", marginInline: 4 }} />
          <FilterChip pressed={groupByDay} onClick={() => setGroupByDay((g) => !g)} label={t("pos.sales.group_by_day")} />
        </div>
        <div className="mg2-chips" role="group" aria-label={t("rcpt.status")} style={{ marginBottom: 12 }}>
          {STATUSES.map((s) => <FilterChip key={s} pressed={status === s} onClick={() => setStatus(s)} label={t(`rcpt.status.${s}`)} count={statusCount(s)} tone={s === "Voided" ? "err" : s === "Debt" ? "warn" : undefined} />)}
        </div>

        {tab === "insights" ? (
          <InsightsPanel filteredSales={filtered} paymentMix={paymentMix} onViewSale={(s) => openReceipt(s.id)} onExportCsv={() => exportSalesCsv(filtered)} />
        ) : sales.length === 0 ? (
          <div className="mg2-card"><EmptyState icon={<ReceiptText size={28} aria-hidden="true" />} title={t("rcpt.empty_title")} text={t("rcpt.empty_text")} /></div>
        ) : filtered.length === 0 ? (
          <div className="mg2-card"><EmptyState title={t("acct.no_match")} text={t("rcpt.no_match_text")} action={<button type="button" className="mg2-btn" onClick={clearFilters}>{t("acct.clear_filters")}</button>} /></div>
        ) : (
          <>
            <div className="mg2-table-wrap wide-only">
              <table className="mg2-table" aria-label={t("rcpt.table")}>
                <thead><tr>
                  <th>{t("rcpt.col.receipt")}</th><th>{t("acct.col.date")}</th><th className="p3">{t("rcpt.col.customer")}</th>
                  <th>{t("rcpt.payment")}</th><th className="p4">{t("rcpt.cashier")}</th><th className="num">{t("acct.col.total")}</th>
                </tr></thead>
                <tbody>
                  {groups.map((g) => (
                    <GroupRows key={g.key} label={g.label} summary={g.label ? t("rcpt.day_summary", { n: g.items.length, total: formatCurrency(g.items.filter((s) => s.status !== "Voided").reduce((x, s) => x + s.total, 0)) }) : ""}>
                      {g.items.map((s) => (
                        <tr key={s.id} aria-selected={receiptId === s.id} onClick={() => openReceipt(s.id)}>
                          <td>
                            <button type="button" className="mg2-sort num-ltr" style={{ fontWeight: 600 }} onClick={(e) => { e.stopPropagation(); openReceipt(s.id) }}>{s.saleNumber}</button>
                            <span className="sub" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                              <span style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.items.map(itemName).filter(Boolean).join(", ")}</span>{statusBadges(s)}
                            </span>
                          </td>
                          <td style={{ color: "var(--text-2)", whiteSpace: "nowrap" }}>{groupByDay ? date.time(s.createdAt) : date.stamp(s.createdAt)}</td>
                          <td className="p3">{s.customerName || <span style={{ color: "var(--text-3)" }}>{t("pos.walk_in")}</span>}</td>
                          <td><Badge tone="muted">{t(`pos.payment.${s.paymentMethod.toLowerCase()}`)}</Badge></td>
                          <td className="p4" style={{ color: "var(--text-2)" }}>{s.cashier}</td>
                          <td className="num" style={{ fontWeight: 700, textDecoration: s.status === "Voided" ? "line-through" : undefined }}>{formatCurrency(s.total)}</td>
                        </tr>
                      ))}
                    </GroupRows>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="phone-only">
              {groups.map((g) => (
                <section key={g.key} aria-label={g.label || t("rcpt.table")} style={{ marginBottom: 12 }}>
                  {g.label && <h3 className="mg2-cap" style={{ margin: "0 0 6px", fontWeight: 600 }}>{g.label}</h3>}
                  <div className="mg2-rowcards" role="list">
                    {g.items.map((s) => (
                      <button key={s.id} type="button" role="listitem" className="mg2-rowcard" aria-current={receiptId === s.id || undefined} onClick={() => openReceipt(s.id)}>
                        <span className="top"><span className="name num-ltr">{s.saleNumber}</span><span className="amt" style={{ textDecoration: s.status === "Voided" ? "line-through" : undefined }}>{formatCurrency(s.total)}</span></span>
                        <span className="meta"><span>{date.stamp(s.createdAt)}</span><span>{t(`pos.payment.${s.paymentMethod.toLowerCase()}`)}</span><span>{s.customerName || t("pos.walk_in")}</span><span>{t("rcpt.items_n", { n: formatNumber(getSaleQuantity(s)) })}</span></span>
                        {(s.status !== "Completed" || getSaleRefundTotal(refunds, s.id) > 0 || s.soldAtCost || Boolean(s.payableLbp)) && <span className="meta">{statusBadges(s)}</span>}
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
            <p className="mg2-cap" style={{ marginTop: 8 }}>
              {t("rcpt.footer", { n: filtered.length, revenue: formatCurrency(revenue) })}{profit > 0 && <> · {t("rcpt.footer_profit", { profit: formatCurrency(profit) })}</>}
              {filtersOn && <> · <button type="button" className="mg2-sort" style={{ color: "var(--text)", textDecoration: "underline" }} onClick={clearFilters}>{t("acct.clear_filters")}</button></>}
            </p>
          </>
        )}
      </div>

      {receipt && (
        <ReceiptDrawer key={receipt.id} sale={receipt} refunds={refunds} rate={rate} canRefund={canRefund} canReprint={canReprint} canVoid={canVoid}
          quantities={refundQuantities} reason={refundReason} status={refundStatus}
          onClose={() => openReceipt(null)} onPrint={() => handlePrint(receipt)}
          onQuantity={(key, v) => setRefundQuantities((x) => ({ ...x, [key]: v }))} onReason={setRefundReason}
          onRefund={() => handleRecordRefund(receipt)} onVoid={() => setVoidSaleId(receipt.id)} />
      )}

      <ConfirmLayer open={!!pendingRefund} title={t("pos.record_return")} confirmLabel={t("pos.record_return")} confirmDestructive
        onConfirm={executeRefund} onCancel={() => setPendingRefund(null)}>
        <p>{t("rcpt.confirm_refund", { number: pendingRefund?.sale.saleNumber ?? "", count: pendingRefund?.refundItems.reduce((n, i) => n + i.quantity, 0) ?? 0, total: formatCurrency(pendingRefund?.refundTotal ?? 0) })}</p>
        {pendingRefund?.refundReason && <p className="mt-1 text-xs" style={{ color: "var(--text-3)" }}>{t("rcpt.reason_is", { reason: pendingRefund.refundReason })}</p>}
        <p className="mt-2 text-xs font-semibold" style={{ color: "var(--text-2)" }}>
          {pendingRefund?.sale.paymentMethod === "Debt" ? t("rcpt.refund_effect_debt") : t("rcpt.refund_effect", { method: t(`rcpt.refund_method.${pendingRefund ? getRefundMethod(pendingRefund.sale) : "Cash"}`) })}
        </p>
      </ConfirmLayer>
      <ConfirmLayer open={voidSaleId !== null} title={t("pos.sales.void_sale_title")} confirmLabel={t("pos.void")} confirmDestructive
        onConfirm={() => { if (voidSaleId) executeVoid(voidSaleId) }} onCancel={() => setVoidSaleId(null)}>
        {(() => { const s = sales.find((x) => x.id === voidSaleId); return <p>{t("rcpt.void_text", { number: s?.saleNumber ?? "", total: formatCurrency(s?.total ?? 0) })}</p> })()}
        <p className="mt-2 text-xs font-semibold" style={{ color: "var(--rose-text)" }}>{t("rcpt.void_effect")}</p>
      </ConfirmLayer>
    </main>
  )
}

function GroupRows({ label, summary, children }: { label: string; summary: string; children: ReactNode }) {
  return (
    <>
      {label && <tr className="mg2-dayrow"><td colSpan={6}><span style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><span>{label}</span><span>{summary}</span></span></td></tr>}
      {children}
    </>
  )
}

/** One receipt: lines, totals (USD, LBP at the sale's own rate, cash rounding as recorded), tender, refunds, returns and void. */
function ReceiptDrawer({ sale, refunds, rate, canRefund, canReprint, canVoid, quantities, reason, status, onClose, onPrint, onQuantity, onReason, onRefund, onVoid }: {
  sale: Sale; refunds: SaleRefund[]; rate: number; canRefund: boolean; canReprint: boolean; canVoid: boolean
  quantities: Record<string, string>; reason: string; status: { tone: "ok" | "err" | "info"; text: string } | null
  onClose: () => void; onPrint: () => void; onQuantity: (key: string, v: string) => void; onReason: (v: string) => void; onRefund: () => void; onVoid: () => void
}) {
  const { t } = useI18n()
  const date = useDate()
  const [returning, setReturning] = useState(false)
  const saleRate = getSaleExchangeRate(sale, rate)
  const totalLbp = usdToLbp(sale.total, saleRate)
  const rounded = Boolean(sale.payableLbp) && sale.payableLbp !== totalLbp
  const discount = sale.discountTotal ?? 0
  const saleRefunds = getSaleRefunds(refunds, sale.id)
  const refunded = getSaleRefundTotal(refunds, sale.id)
  const refundable = sale.status !== "Voided" && sale.items.some((i) => getRefundableQuantity(sale, i, refunds) > 0)
  const draft = sale.items.map((i) => {
    const qty = Math.min(parseReturnQuantity(quantities[refundLineKeyOf(i)] ?? ""), getRefundableQuantity(sale, i, refunds))
    return { ...i, quantity: qty, total: i.unitPrice * qty }
  }).filter((i) => i.quantity > 0)
  const draftTotal = Math.min(Math.max(0, sale.total - refunded), getRefundTotal(sale, draft))
  const refundBlocked = !canRefund ? t("rcpt.needs_refund") : !refundable ? t(sale.status === "Voided" ? "pos.refund.error_sale_voided" : "pos.sales.no_refundable_balance") : ""
  return (
    <Drawer open wide title={t("rcpt.receipt_title", { number: sale.saleNumber })} onClose={onClose}
      subtitle={<span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>{date.full(sale.createdAt)}
        {sale.status === "Voided" && <Badge tone="err">{t("pos.sales.status_voided")}</Badge>}
        {sale.status === "Debt" && <Badge tone="warn">{t("rcpt.on_account")}</Badge>}
        {sale.soldAtCost && <Badge tone="muted">{t("rcpt.at_cost")}</Badge>}</span>}
      footer={<>
        {canReprint ? <button type="button" className="mg2-btn" onClick={onPrint} data-autofocus><Printer size={16} />{t("pos.print")}</button> : null}
        <button type="button" className="mg2-btn" disabled={!!refundBlocked} aria-describedby={refundBlocked ? "rc-refund-why" : undefined} aria-expanded={returning} onClick={() => setReturning((r) => !r)}><RotateCcw size={16} />{t("rcpt.return_items")}</button>
        {sale.status !== "Voided" && (canVoid
          ? <button type="button" className="mg2-btn mg2-btn-danger" onClick={onVoid}><XCircle size={16} />{t("pos.void")}</button>
          : <span className="mg2-cap" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><Lock size={14} aria-hidden="true" />{t("rcpt.needs_void")}</span>)}
      </>}>
      {refundBlocked && <p className="mg2-cap" id="rc-refund-why" style={{ margin: 0, display: "flex", gap: 6, alignItems: "center" }}>{!canRefund && <Lock size={14} aria-hidden="true" />}{refundBlocked}</p>}
      {status && (
        <div className={`mg2-banner ${status.tone === "ok" ? "mg2-t-ok" : status.tone === "err" ? "mg2-t-err" : "mg2-t-info"}`} role={status.tone === "err" ? "alert" : "status"}>
          {status.tone === "ok" ? <CheckCircle2 size={18} aria-hidden="true" /> : <AlertTriangle size={18} aria-hidden="true" />}<span style={{ flex: 1, color: "var(--text)" }}>{status.text}</span>
        </div>
      )}
      <dl className="mg2-kv">
        <div><dt>{t("rcpt.payment")}</dt><dd>{t(`pos.payment.${sale.paymentMethod.toLowerCase()}`)}</dd></div>
        <div><dt>{t("rcpt.col.customer")}</dt><dd>{sale.customerName ?? t("pos.walk_in")}</dd></div>
        <div><dt>{t("rcpt.cashier")}</dt><dd>{sale.cashier}</dd></div>
        {sale.shiftNumber && <div><dt>{t("rcpt.shift")}</dt><dd className="num-ltr">{sale.shiftNumber}</dd></div>}
      </dl>
      <div className="mg2-table-wrap">
        <table className="mg2-table" aria-label={t("rcpt.lines")}>
          <thead><tr><th>{t("acct.s.col.item")}</th><th className="num">{t("acct.col.qty")}</th><th className="num p3">{t("rcpt.col.unit")}</th><th className="num">{t("acct.col.total")}</th></tr></thead>
          <tbody>
            {sale.items.map((i, n) => {
              const back = getRefundedQuantity(refunds, sale.id, i)
              return (
                <tr key={`${i.lineId ?? i.id}-${n}`} className="mg2-static">
                  <td style={{ fontWeight: 600 }}>{itemName(i) || "—"}{back > 0 && <span className="sub">{t("rcpt.returned_n", { n: formatNumber(back) })}</span>}</td>
                  <td className="num">{formatNumber(i.quantity)}</td>
                  <td className="num p3">{formatCurrency(i.unitPrice)}</td>
                  <td className="num">{formatCurrency(i.total)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="mg2-card" style={{ padding: 12 }}>
        {discount > 0 && <>
          <div className="mg2-sum"><span>{t("pos.items_subtotal")}</span><strong>{formatCurrency(getSaleGrossSubtotal(sale))}</strong></div>
          <div className="mg2-sum"><span>{t("pos.discount")}</span><strong>−{formatCurrency(discount)}</strong></div>
        </>}
        <div className="mg2-sum"><span>{t("pos.subtotal")}</span><strong>{formatCurrency(sale.subtotal)}</strong></div>
        <div className="mg2-sum"><span>{t("pos.vat")}</span><strong>{formatCurrency(sale.tax)}</strong></div>
        <div className="mg2-sum" style={{ fontSize: 18, borderTop: "1px solid var(--border)", marginTop: 4, paddingTop: 8 }}><span style={{ fontWeight: 700 }}>{t("pos.total_usd")}</span><strong>{formatCurrency(sale.total)}</strong></div>
        <div className="mg2-sum"><span>{t("pos.total_lbp")}</span><strong>{formatLbpCurrency(totalLbp)}</strong></div>
        <p className="mg2-cap" style={{ margin: 0, fontSize: 13 }}>{t("rcpt.at_rate", { rate: formatNumber(saleRate) })}</p>
        {rounded && <div className="mg2-sum"><span>{t("rcpt.cash_payable")}</span><strong>{formatLbpCurrency(sale.payableLbp!)}</strong></div>}
        {refunded > 0 && <>
          <div className="mg2-sum"><span>{t("pos.refunded")}</span><strong className="t-pos">−{formatCurrency(refunded)}</strong></div>
          <div className="mg2-sum" style={{ borderTop: "1px solid var(--border)", marginTop: 4, paddingTop: 8 }}><span style={{ fontWeight: 700 }}>{t("pos.net_receipt")}</span><strong>{formatCurrency(Math.max(0, sale.total - refunded))}</strong></div>
        </>}
      </div>
      {sale.tender && (
        <dl className="mg2-kv">
          <div><dt>{t("pos.paid_total")}</dt><dd>{formatCurrency(sale.tender.paidTotalUsd)} · {formatLbpCurrency(sale.tender.paidTotalLbp)}</dd></div>
          <div><dt>{t("pos.change_usd")}</dt><dd>{formatCurrency(sale.tender.changeUsd)}</dd></div>
          <div><dt>{t("pos.change_lbp")}</dt><dd>{formatLbpCurrency(sale.tender.changeLbp)}</dd></div>
        </dl>
      )}
      {saleRefunds.length > 0 && (
        <section aria-label={t("rcpt.refunds")}>
          <h3 className="mg2-section-title" style={{ marginBottom: 8 }}>{t("rcpt.refunds")} <span className="mg2-count num">{saleRefunds.length}</span></h3>
          {saleRefunds.map((r) => (
            <div key={r.id} className="mg2-sum"><span><span className="num-ltr" style={{ fontWeight: 600 }}>{r.refundNumber}</span> · {date.stamp(r.createdAt)}{r.reason ? ` · ${r.reason}` : ""}</span><strong className="t-pos">−{formatCurrency(r.total)}</strong></div>
          ))}
        </section>
      )}
      {returning && !refundBlocked && (
        <section className="mg2-card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }} aria-label={t("rcpt.return_items")}>
          <div className="mg2-sum"><h3 className="mg2-section-title">{t("rcpt.return_items")}</h3><Badge tone="muted">{t("rcpt.refund_to", { method: t(`rcpt.refund_method.${getRefundMethod(sale)}`) })}</Badge></div>
          {sale.items.map((i, n) => {
            const left = getRefundableQuantity(sale, i, refunds)
            const id = `rq-${sale.id}-${n}`
            return (
              <div key={`${refundLineKeyOf(i)}-${n}`} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 96px", gap: 8, alignItems: "center" }}>
                <label htmlFor={id} style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 600, display: "block", overflowWrap: "anywhere" }}>{itemName(i)}</span>
                  <span className="mg2-cap" style={{ fontSize: 13 }}>{t("rcpt.can_return", { n: formatNumber(left), sold: formatNumber(i.quantity) })}</span>
                </label>
                <input id={id} className="mg2-input num" type="number" min="0" max={left} step="1" inputMode="numeric" dir="ltr" disabled={left === 0}
                  value={quantities[refundLineKeyOf(i)] ?? ""} onChange={(e) => onQuantity(refundLineKeyOf(i), e.target.value)} />
              </div>
            )
          })}
          <label className="mg2-field"><span className="lbl">{t("pos.return_reason")}</span><input className="mg2-input" value={reason} onChange={(e) => onReason(e.target.value)} /></label>
          <div className="mg2-sum" style={{ fontSize: 16 }}><span>{t("pos.refund_amount")}</span><strong className="t-pos">{formatCurrency(draftTotal)}</strong></div>
          <button type="button" className="mg2-btn mg2-btn-danger" onClick={onRefund}><RotateCcw size={16} />{t("pos.record_return")}</button>
        </section>
      )}
    </Drawer>
  )
}
