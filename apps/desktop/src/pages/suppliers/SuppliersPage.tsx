import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useSearchParams } from "react-router"
import { AlertTriangle, Building2, CheckCircle2, Download, HandCoins, Info, PackagePlus, Phone, Plus, Search, Truck } from "lucide-react"
import { useI18n } from "@lebanonpos/shared"

import { useDebounce } from "../../hooks/useDebounce"
import { useHotkeys } from "../../hooks/useHotkey"
import { Badge, ConfirmLayer, Drawer, EmptyState, Field, FilterChip, PageHeader, PageTabs, SkeletonRows, StatTile, type Tone } from "../../features/pos/components/backoffice/BackOffice"
import { formatCurrency, formatNumber } from "../../features/pos/lib/currency"
import { parseMoney } from "../../features/pos/lib/helpers"
import { userCan } from "../../features/pos/services/security.service"
import {
  archiveSupplier, createSupplier, deleteSupplier, getPurchaseOrders, getSupplierActivity, getSupplierLedger, getSupplierPayments, getSupplierTotals,
  recordSupplierPayment, restoreSupplier, subscribeSuppliers, supplierHasHistory,
  type PurchaseOrder, type SupplierLedger, type SupplierPaymentMethod,
} from "../../features/pos/services/supplier.service"

// Midnight Gold v2 — Suppliers (DESIGN-SYSTEM §6–§8): accounts and purchase orders as tabs, a
// details drawer per supplier and per order, payments against an order or the whole balance.
// Purchase orders come only from Receiving; balances are orders minus payments, never edited here.
type Tab = "accounts" | "orders"
type View = "all" | "owed" | "archived"
const VIEWS: View[] = ["all", "owed", "archived"]
type OrderView = "all" | "Unpaid" | "Partial" | "Paid"
const ORDER_VIEWS: OrderView[] = ["all", "Unpaid", "Partial", "Paid"]
const METHODS: SupplierPaymentMethod[] = ["Cash", "Card", "Bank Transfer", "Wallet"]
const METHOD_KEY: Record<string, string> = { Cash: "cash", Card: "card", "Bank Transfer": "bank_transfer", Wallet: "wallet" }
const STATUS_TONE: Record<PurchaseOrder["paymentStatus"], Tone> = { Paid: "ok", Partial: "warn", Unpaid: "err" }

/** One id per payment attempt: a double tap or a retry of the same attempt records it once. */
const newPaymentAttempt = () => `pay-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
const owedOn = (o: PurchaseOrder) => Math.max(0, o.total - o.paidTotal)

function useDate() {
  const { locale } = useI18n()
  const tag = locale === "ar" ? "ar-LB" : "en-GB"
  return {
    day: (v: string) => new Intl.DateTimeFormat(tag, { day: "2-digit", month: "short", year: "numeric" }).format(new Date(v)),
    stamp: (v: string) => new Intl.DateTimeFormat(tag, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(v)),
  }
}

export default function SuppliersPage() {
  const { t } = useI18n()
  const date = useDate()
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get("tab") === "orders" ? "orders" : "accounts"
  const loading = false // ledgers are read synchronously from this device
  const [suppliers, setSuppliers] = useState<SupplierLedger[]>(() => getSupplierLedger({ includeArchived: true }))
  const [orders, setOrders] = useState<PurchaseOrder[]>(() => getPurchaseOrders())
  const [totals, setTotals] = useState(getSupplierTotals())
  const [search, setSearch] = useState("")
  const q = useDebounce(search, 150)
  const searchRef = useRef<HTMLInputElement>(null)
  useHotkeys([{ key: "f", modifiers: ["ctrl"], handler: () => searchRef.current?.focus() }])
  const [view, setView] = useState<View>("all")
  const [orderView, setOrderView] = useState<OrderView>("all")
  const detailId = params.get("supplier")
  const orderId = params.get("order")
  const [adding, setAdding] = useState(false)
  const [paying, setPaying] = useState<{ supplierId: string; orderId?: string } | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: "ok" | "err"; text: string } | null>(null)
  const canReceive = userCan("inventory.receive")

  function refresh() {
    setSuppliers(getSupplierLedger({ includeArchived: true }))
    setOrders(getPurchaseOrders())
    setTotals(getSupplierTotals())
  }
  useEffect(() => subscribeSuppliers(refresh), [])

  const inView = (s: SupplierLedger, v: View) => (v === "archived" ? !!s.archived : s.archived ? false : v === "all" ? true : s.balance > 0.001)
  const counts = Object.fromEntries(VIEWS.map((v) => [v, suppliers.filter((s) => inView(s, v)).length])) as Record<View, number>
  const orderCounts = Object.fromEntries(ORDER_VIEWS.map((v) => [v, orders.filter((o) => v === "all" || o.paymentStatus === v).length])) as Record<OrderView, number>
  const query = q.trim().toLowerCase()
  const list = suppliers.filter((s) => inView(s, view) && (!query || s.name.toLowerCase().includes(query) || s.mobile.includes(query) || s.contact.toLowerCase().includes(query)))
    .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name))
  const orderList = orders.filter((o) => (orderView === "all" || o.paymentStatus === orderView) &&
    (!query || o.poNumber.toLowerCase().includes(query) || o.supplierName.toLowerCase().includes(query) || (o.invoiceNumber ?? "").toLowerCase().includes(query)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const detail = detailId ? suppliers.find((s) => s.id === detailId) : undefined
  const order = orderId ? orders.find((o) => o.id === orderId) : undefined
  const firstOwed = suppliers.find((s) => !s.archived && s.balance > 0.001)

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key)
    setParams(next, { replace: true })
  }
  function exportCsv() {
    const rows = tab === "orders"
      ? [["PO", "Supplier", "Invoice", "Date", "Items", "Total", "Paid", "Owed", "Payment status"], ...orderList.map((o) => [o.poNumber, o.supplierName, o.invoiceNumber ?? "", o.createdAt.slice(0, 10), o.items?.length ?? 0, o.total, o.paidTotal, owedOn(o), o.paymentStatus])]
      : [["Supplier", "Contact", "Mobile", "Purchases", "Paid", "Owed", "Archived"], ...list.map((s) => [s.name, s.contact, s.mobile, s.purchaseTotal, s.paidTotal, s.balance, s.archived ? "yes" : ""])]
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n")
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }))
    const a = document.createElement("a"); a.href = url; a.download = `${tab === "orders" ? "purchase-orders" : "suppliers"}-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url)
  }
  const statusBadge = (o: PurchaseOrder) => <Badge tone={STATUS_TONE[o.paymentStatus]}>{t(`acct.s.status.${o.paymentStatus}`)}</Badge>

  return (
    <main className="mg2 mg2-bo min-h-0 flex-1 overflow-y-auto">
      <div className="mg2-wrap">
        <PageHeader eyebrow={t("acct.stock")} title={t("acct.s.title")} actions={<>
          <button type="button" className="mg2-btn" onClick={exportCsv} aria-label={t("acct.export")}><Download size={16} /><span className="hidden sm:inline">{t("acct.export")}</span></button>
          {canReceive && <Link to="/products/new" className="mg2-btn" style={{ textDecoration: "none" }} aria-label={t("acct.s.receive")}><PackagePlus size={16} /><span className="hidden sm:inline">{t("acct.s.receive")}</span></Link>}
          <button type="button" className="mg2-btn" onClick={() => setAdding(true)}><Plus size={16} />{t("acct.s.add")}</button>
          <button type="button" className="mg2-btn mg2-btn-primary" disabled={!firstOwed} aria-describedby={firstOwed ? undefined : "sup-pay-why"}
            onClick={() => firstOwed && setPaying({ supplierId: detail && detail.balance > 0.001 && !detail.archived ? detail.id : firstOwed.id })}>
            <HandCoins size={16} />{t("acct.s.pay")}
          </button>
        </>} />
        {!firstOwed && !loading && <p className="mg2-cap" id="sup-pay-why" style={{ marginTop: 8 }}>{t("acct.s.nothing_owed_any")}</p>}
        <PageTabs label={t("acct.s.tabs")} current={tab} items={[
          { value: "accounts", label: t("acct.s.tab.accounts"), count: counts.all },
          { value: "orders", label: t("acct.s.tab.orders"), count: orders.length },
        ]} />

        <div className="mg2-stats" style={{ marginBottom: 16 }}>
          <StatTile label={t("acct.s.kpi.suppliers")} value={formatNumber(totals.suppliers)} />
          <StatTile label={t("acct.s.kpi.purchases")} value={formatCurrency(totals.purchaseTotal)} />
          <StatTile label={t("acct.paid")} value={formatCurrency(totals.paidTotal)} />
          <StatTile label={t("acct.s.kpi.owed")} value={<span className={totals.outstanding > 0.001 ? "t-pos" : undefined}>{formatCurrency(totals.outstanding)}</span>} />
        </div>

        {notice && (
          <div className={`mg2-banner ${notice.tone === "ok" ? "mg2-t-ok" : "mg2-t-err"}`} role={notice.tone === "ok" ? "status" : "alert"} style={{ marginBottom: 12 }}>
            {notice.tone === "ok" ? <CheckCircle2 size={18} aria-hidden="true" /> : <AlertTriangle size={18} aria-hidden="true" />}
            <span style={{ flex: 1, color: "var(--text)" }}>{notice.text}</span>
            <button type="button" className="mg2-btn mg2-btn-ghost" onClick={() => setNotice(null)}>{t("acct.dismiss")}</button>
          </div>
        )}

        <div className="mg2-toolbar">
          <div className="mg2-search">
            <Search size={16} aria-hidden="true" />
            <input ref={searchRef} className="mg2-input" type="search" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder={t(tab === "orders" ? "acct.s.search_orders" : "acct.s.search")} aria-label={t(tab === "orders" ? "acct.s.search_orders" : "acct.s.search")} />
          </div>
        </div>
        <div className="mg2-chips" role="group" aria-label={t("acct.views")} style={{ marginBottom: 12 }}>
          {tab === "accounts"
            ? VIEWS.map((v) => <FilterChip key={v} pressed={view === v} onClick={() => setView(v)} label={t(`acct.s.view.${v}`)} count={counts[v]} tone={v === "owed" ? "warn" : undefined} />)
            : ORDER_VIEWS.map((v) => <FilterChip key={v} pressed={orderView === v} onClick={() => setOrderView(v)} label={v === "all" ? t("acct.s.view.all_orders") : t(`acct.s.status.${v}`)} count={orderCounts[v]} tone={v === "Unpaid" ? "err" : v === "Partial" ? "warn" : undefined} />)}
        </div>

        {loading ? <SkeletonRows /> : tab === "accounts" ? (
          suppliers.length === 0 ? (
            <div className="mg2-card"><EmptyState icon={<Building2 size={28} aria-hidden="true" />} title={t("acct.s.empty_title")} text={t("acct.s.empty_text")}
              action={<button type="button" className="mg2-btn mg2-btn-primary" onClick={() => setAdding(true)}><Plus size={16} />{t("acct.s.add")}</button>} /></div>
          ) : list.length === 0 ? (
            <div className="mg2-card"><EmptyState title={t("acct.no_match")} text={t("acct.no_match_text")}
              action={<button type="button" className="mg2-btn" onClick={() => { setSearch(""); setView("all") }}>{t("acct.clear_filters")}</button>} /></div>
          ) : (
            <div className="mg2-table-wrap">
              <table className="mg2-table" aria-label={t("acct.s.table")}>
                <thead><tr>
                  <th>{t("acct.s.col.supplier")}</th><th className="p3">{t("acct.s.col.contact")}</th>
                  <th className="num p4">{t("acct.s.kpi.purchases")}</th><th className="num p4">{t("acct.paid")}</th>
                  <th className="num">{t("acct.s.kpi.owed")}</th><th className="p3">{t("acct.col.last_activity")}</th>
                </tr></thead>
                <tbody>
                  {list.map((s) => (
                    <tr key={s.id} aria-selected={detailId === s.id} onClick={() => setParam("supplier", s.id)}>
                      <td>
                        <button type="button" className="mg2-sort" style={{ fontWeight: 600, textAlign: "start" }} onClick={(e) => { e.stopPropagation(); setParam("supplier", s.id) }}>{s.name}</button>
                        <span className="sub" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                          <span className="num-ltr phone-only">{s.mobile}</span>{s.archived && <Badge tone="muted">{t("acct.archived")}</Badge>}
                        </span>
                      </td>
                      <td className="p3">{s.contact || <span style={{ color: "var(--text-3)" }}>—</span>}{s.mobile && <span className="sub num-ltr">{s.mobile}</span>}</td>
                      <td className="num p4">{formatCurrency(s.purchaseTotal)}</td>
                      <td className="num p4" style={{ color: "var(--text-2)" }}>{formatCurrency(s.paidTotal)}</td>
                      <td className={`num ${s.balance > 0.001 ? "t-pos" : ""}`} style={{ fontWeight: 700 }}>{formatCurrency(s.balance)}</td>
                      <td className="p3" style={{ color: "var(--text-2)" }}>{s.lastActivityAt ? date.stamp(s.lastActivityAt) : t("acct.no_activity")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : orders.length === 0 ? (
          <div className="mg2-card"><EmptyState icon={<Truck size={28} aria-hidden="true" />} title={t("acct.s.no_orders_title")} text={t("acct.s.no_orders_text")}
            action={canReceive ? <Link to="/products/new" className="mg2-btn mg2-btn-primary" style={{ textDecoration: "none" }}><PackagePlus size={16} />{t("acct.s.receive")}</Link> : undefined} /></div>
        ) : orderList.length === 0 ? (
          <div className="mg2-card"><EmptyState title={t("acct.no_match")} text={t("acct.no_match_text")}
            action={<button type="button" className="mg2-btn" onClick={() => { setSearch(""); setOrderView("all") }}>{t("acct.clear_filters")}</button>} /></div>
        ) : (
          <div className="mg2-table-wrap">
            <table className="mg2-table" aria-label={t("acct.s.tab.orders")}>
              <thead><tr>
                <th>{t("acct.s.col.order")}</th><th className="p3">{t("acct.col.date")}</th><th className="num p4">{t("acct.s.col.items")}</th>
                <th className="num p4">{t("acct.col.total")}</th><th className="num">{t("acct.s.kpi.owed")}</th><th>{t("acct.col.status")}</th>
              </tr></thead>
              <tbody>
                {orderList.map((o) => (
                  <tr key={o.id} aria-selected={orderId === o.id} onClick={() => setParam("order", o.id)}>
                    <td>
                      <button type="button" className="mg2-sort num-ltr" style={{ fontWeight: 600 }} onClick={(e) => { e.stopPropagation(); setParam("order", o.id) }}>{o.poNumber}</button>
                      <span className="sub">{o.supplierName}<span className="phone-only">{date.day(o.createdAt)}</span></span>
                    </td>
                    <td className="p3" style={{ color: "var(--text-2)" }}>{date.day(o.createdAt)}</td>
                    <td className="num p4">{formatNumber(o.items?.length ?? 0)}</td>
                    <td className="num p4">{formatCurrency(o.total)}</td>
                    <td className={`num ${owedOn(o) > 0.001 ? "t-pos" : ""}`} style={{ fontWeight: 700 }}>{formatCurrency(owedOn(o))}</td>
                    <td>{statusBadge(o)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detail && (
        <SupplierDrawer key={detail.id} supplier={detail} orders={orders.filter((o) => o.supplierId === detail.id)} onClose={() => setParam("supplier", null)}
          onPay={(oid) => setPaying({ supplierId: detail.id, orderId: oid })} onOpenOrder={(oid) => setParam("order", oid)}
          onDelete={() => setDeleteId(detail.id)} onNotice={(n) => { setNotice(n); refresh() }} />
      )}
      {order && (
        <OrderDrawer order={order} onClose={() => setParam("order", null)}
          onPay={() => setPaying({ supplierId: order.supplierId, orderId: order.id })}
          onOpenSupplier={() => { const next = new URLSearchParams(params); next.delete("order"); next.set("supplier", order.supplierId); setParams(next, { replace: true }) }} />
      )}
      {adding && <SupplierEditor onClose={() => setAdding(false)} onSaved={(id, text) => { setAdding(false); refresh(); setParam("supplier", id); setNotice({ tone: "ok", text }) }} />}
      {paying && (
        <SupplierPaymentDrawer suppliers={suppliers.filter((s) => !s.archived)} orders={orders} initial={paying} onClose={() => setPaying(null)}
          onRecorded={(text) => { setPaying(null); refresh(); setNotice({ tone: "ok", text }) }} />
      )}
      <ConfirmLayer open={deleteId !== null} title={t("acct.s.delete_title")} confirmLabel={t("acct.delete")} confirmDestructive
        onConfirm={() => {
          const s = suppliers.find((x) => x.id === deleteId)
          try { if (deleteId) deleteSupplier(deleteId); setParam("supplier", null); if (s) setNotice({ tone: "ok", text: t("acct.s.deleted", { name: s.name }) }) }
          catch (error) { setNotice({ tone: "err", text: message(error) }) }
          setDeleteId(null); refresh()
        }}
        onCancel={() => setDeleteId(null)}>
        <p>{t("acct.s.delete_text", { name: suppliers.find((x) => x.id === deleteId)?.name ?? "" })}</p>
      </ConfirmLayer>
    </main>
  )
}

/** Supplier details: owed / purchases / paid, contact, open orders, statement and payments. */
function SupplierDrawer({ supplier: s, orders, onClose, onPay, onOpenOrder, onDelete, onNotice }: {
  supplier: SupplierLedger; orders: PurchaseOrder[]; onClose: () => void; onPay: (orderId?: string) => void; onOpenOrder: (id: string) => void
  onDelete: () => void; onNotice: (n: { tone: "ok" | "err"; text: string }) => void
}) {
  const { t } = useI18n()
  const date = useDate()
  const [tab, setTab] = useState<"statement" | "payments">("statement")
  const [error, setError] = useState("")
  const activity = getSupplierActivity(s.id)
  // Running balance, oldest first: a purchase order adds, a payment subtracts.
  const statement = activity.reduceRight<Array<(typeof activity)[number] & { running: number }>>((acc, a) => {
    const prev = acc.length ? acc[0].running : 0
    return [{ ...a, running: prev + (a.type === "Payment" ? -a.amount : a.amount) }, ...acc]
  }, [])
  const payments = getSupplierPayments().filter((p) => p.supplierId === s.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const open = orders.filter((o) => o.paymentStatus !== "Paid").sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const hasHistory = supplierHasHistory(s.id)
  function act(fn: () => void, ok: string) {
    setError("")
    try { fn(); onNotice({ tone: "ok", text: ok }) } catch (e) { setError(message(e)) }
  }
  return (
    <Drawer open wide title={s.name} onClose={onClose}
      subtitle={<span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>{s.contact && <span>{s.contact}</span>}{s.mobile && <span className="num-ltr">{s.mobile}</span>}{s.archived && <Badge tone="muted">{t("acct.archived")}</Badge>}</span>}
      footer={<>
        <button type="button" className="mg2-btn mg2-btn-primary" disabled={s.balance <= 0.001 || !!s.archived} aria-describedby={s.balance <= 0.001 ? "sd-pay-why" : undefined} onClick={() => onPay()} data-autofocus><HandCoins size={16} />{t("acct.s.pay")}</button>
        {s.archived
          ? <button type="button" className="mg2-btn" onClick={() => act(() => restoreSupplier(s.id), t("acct.restored", { name: s.name }))}>{t("acct.restore")}</button>
          : <button type="button" className="mg2-btn" onClick={() => act(() => archiveSupplier(s.id), t("acct.archived_done", { name: s.name }))}>{t("acct.archive")}</button>}
        {!hasHistory && <button type="button" className="mg2-btn mg2-btn-danger" onClick={onDelete}>{t("acct.delete")}</button>}
      </>}>
      {s.balance <= 0.001 && <p className="mg2-cap" id="sd-pay-why" style={{ margin: 0 }}>{t("acct.s.nothing_owed")}</p>}
      {error && <div className="mg2-banner mg2-t-err" role="alert"><AlertTriangle size={18} aria-hidden="true" /><span style={{ flex: 1, color: "var(--text)" }}>{error}</span></div>}
      <div className="mg2-stats">
        <StatTile label={t("acct.s.kpi.owed")} value={<span className={s.balance > 0.001 ? "t-pos" : undefined}>{formatCurrency(s.balance)}</span>} />
        <StatTile label={t("acct.s.kpi.purchases")} value={formatCurrency(s.purchaseTotal)} />
        <StatTile label={t("acct.paid")} value={formatCurrency(s.paidTotal)} />
      </div>
      {(s.mobile || s.address || s.notes) && (
        <dl className="mg2-kv">
          {s.mobile && <div><dt>{t("acct.s.f.mobile")}</dt><dd><a href={`tel:${s.mobile}`} className="num-ltr" style={{ color: "inherit", display: "inline-flex", gap: 6, alignItems: "center" }}><Phone size={14} aria-hidden="true" />{s.mobile}</a></dd></div>}
          {s.address && <div><dt>{t("acct.s.f.address")}</dt><dd>{s.address}</dd></div>}
          {s.notes && <div><dt>{t("acct.s.f.notes")}</dt><dd>{s.notes}</dd></div>}
        </dl>
      )}
      <section aria-label={t("acct.s.open_orders")}>
        <h3 className="mg2-section-title" style={{ marginBottom: 8 }}>{t("acct.s.open_orders")} <span className="mg2-count num">{open.length}</span></h3>
        {open.length === 0 ? <p className="mg2-cap" style={{ margin: 0 }}>{t("acct.s.no_open_orders")}</p> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {open.map((o) => (
              <div key={o.id} className="mg2-lot">
                <div className="top">
                  <button type="button" className="mg2-sort num-ltr" style={{ fontWeight: 700 }} onClick={() => onOpenOrder(o.id)}>{o.poNumber}</button>
                  <Badge tone={STATUS_TONE[o.paymentStatus]}>{t(`acct.s.status.${o.paymentStatus}`)}</Badge>
                </div>
                <div className="top">
                  <span className="mg2-cap">{t("acct.s.order_line", { date: date.day(o.createdAt), total: formatCurrency(o.total), paid: formatCurrency(o.paidTotal) })}</span>
                  <button type="button" className="mg2-btn" disabled={!!s.archived} onClick={() => onPay(o.id)}>{t("acct.s.pay_amount", { amount: formatCurrency(owedOn(o)) })}</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <div className="mg2-chips" role="group" aria-label={t("acct.c.history")}>
        {(["statement", "payments"] as const).map((k) => (
          <FilterChip key={k} pressed={tab === k} onClick={() => setTab(k)} label={t(`acct.c.tab.${k}`)} count={k === "statement" ? statement.length : payments.length} />
        ))}
      </div>
      {(tab === "statement" ? statement.length : payments.length) === 0 ? (
        <EmptyState title={t(tab === "statement" ? "acct.s.no_statement" : "acct.c.no_payments")} text={t("acct.s.no_history_text")} />
      ) : tab === "statement" ? (
        <div className="mg2-table-wrap">
          <table className="mg2-table mg2-trace" aria-label={t("acct.c.tab.statement")}>
            <thead><tr><th>{t("acct.col.date")}</th><th>{t("acct.col.what")}</th><th className="num">{t("acct.s.col.purchase")}</th><th className="num">{t("acct.c.col.payment")}</th><th className="num">{t("acct.s.kpi.owed")}</th></tr></thead>
            <tbody>
              {statement.map((a) => (
                <tr key={`${a.type}-${a.id}`} className="mg2-static">
                  <td style={{ whiteSpace: "nowrap" }}>{date.day(a.createdAt)}</td>
                  <td>{a.type === "Purchase" ? <span className="num-ltr" style={{ fontWeight: 600 }}>{a.label}</span> : <>{t(`acct.pay.${METHOD_KEY[a.status] ?? "cash"}`)}{a.label !== a.status && <span className="sub">{a.label}</span>}</>}</td>
                  <td className="num">{a.type === "Purchase" ? formatCurrency(a.amount) : ""}</td>
                  <td className="num t-neg">{a.type === "Payment" ? formatCurrency(a.amount) : ""}</td>
                  <td className="num" style={{ fontWeight: 600 }}>{formatCurrency(a.running)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mg2-table-wrap">
          <table className="mg2-table" aria-label={t("acct.c.tab.payments")}>
            <thead><tr><th>{t("acct.col.date")}</th><th>{t("acct.col.method")}</th><th className="p3">{t("acct.s.col.order")}</th><th className="p4">{t("acct.col.reference")}</th><th className="num">{t("acct.col.amount")}</th></tr></thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="mg2-static">
                  <td style={{ whiteSpace: "nowrap" }}>{date.stamp(p.createdAt)}<span className="sub">{p.recordedBy}</span></td>
                  <td>{t(`acct.pay.${METHOD_KEY[p.method] ?? "cash"}`)}</td>
                  <td className="p3 num-ltr">{p.purchaseOrderNumber ?? <span style={{ color: "var(--text-3)" }}>{t("acct.s.balance_payment")}</span>}</td>
                  <td className="p4" style={{ color: "var(--text-2)" }}>{p.reference || "—"}</td>
                  <td className="num t-neg" style={{ fontWeight: 600 }}>{formatCurrency(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Drawer>
  )
}

/** A purchase order (from Receiving): its lines, totals and payments. */
function OrderDrawer({ order: o, onClose, onPay, onOpenSupplier }: { order: PurchaseOrder; onClose: () => void; onPay: () => void; onOpenSupplier: () => void }) {
  const { t } = useI18n()
  const date = useDate()
  const payments = getSupplierPayments().filter((p) => p.purchaseOrderId === o.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return (
    <Drawer open wide title={t("acct.s.order_title", { number: o.poNumber })} onClose={onClose}
      subtitle={<span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>{o.supplierName} · {date.day(o.createdAt)}<Badge tone={STATUS_TONE[o.paymentStatus]}>{t(`acct.s.status.${o.paymentStatus}`)}</Badge></span>}
      footer={<>
        <button type="button" className="mg2-btn mg2-btn-primary" disabled={owedOn(o) <= 0.001} onClick={onPay} data-autofocus><HandCoins size={16} />{t("acct.s.pay_amount", { amount: formatCurrency(owedOn(o)) })}</button>
        <button type="button" className="mg2-btn" onClick={onOpenSupplier}>{t("acct.s.open_supplier")}</button>
      </>}>
      <div className="mg2-stats">
        <StatTile label={t("acct.col.total")} value={formatCurrency(o.total)} />
        <StatTile label={t("acct.paid")} value={formatCurrency(o.paidTotal)} />
        <StatTile label={t("acct.s.kpi.owed")} value={<span className={owedOn(o) > 0.001 ? "t-pos" : undefined}>{formatCurrency(owedOn(o))}</span>} />
      </div>
      <dl className="mg2-kv">
        <div><dt>{t("acct.s.f.invoice")}</dt><dd className="num-ltr">{o.invoiceNumber || "—"}</dd></div>
        <div><dt>{t("acct.s.f.received_by")}</dt><dd>{o.createdBy || "—"}</dd></div>
        {o.note && <div><dt>{t("acct.s.f.notes")}</dt><dd>{o.note}</dd></div>}
      </dl>
      <div className="mg2-table-wrap">
        <table className="mg2-table" aria-label={t("acct.s.lines")}>
          <thead><tr><th>{t("acct.s.col.item")}</th><th className="num">{t("acct.col.qty")}</th><th className="num p3">{t("acct.s.col.unit_cost")}</th><th className="num">{t("acct.col.total")}</th></tr></thead>
          <tbody>
            {(o.items ?? []).map((i, n) => (
              <tr key={`${i.barcode}-${n}`} className="mg2-static">
                <td style={{ fontWeight: 600 }}>{i.name}<span className="sub code">{i.barcode}</span></td>
                <td className="num">{formatNumber(i.quantity)}</td>
                <td className="num p3">{formatCurrency(i.unitCost)}</td>
                <td className="num">{formatCurrency(i.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section aria-label={t("acct.c.tab.payments")}>
        <h3 className="mg2-section-title" style={{ marginBottom: 8 }}>{t("acct.c.tab.payments")} <span className="mg2-count num">{payments.length}</span></h3>
        {payments.length === 0 ? <p className="mg2-cap" style={{ margin: 0 }}>{t("acct.s.order_unpaid")}</p> : payments.map((p) => (
          <div key={p.id} className="mg2-sum"><span>{date.stamp(p.createdAt)} · {t(`acct.pay.${METHOD_KEY[p.method] ?? "cash"}`)}{p.reference ? ` · ${p.reference}` : ""}</span><strong className="t-neg">{formatCurrency(p.amount)}</strong></div>
        ))}
      </section>
    </Drawer>
  )
}

function SupplierEditor({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string, text: string) => void }) {
  const { t } = useI18n()
  const [form, setForm] = useState({ name: "", mobile: "", contact: "", address: "", notes: "" })
  const [errors, setErrors] = useState<{ name?: string; mobile?: string }>({})
  const [failure, setFailure] = useState("")
  const formRef = useRef<HTMLFormElement>(null)
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))
  function save() {
    const e: typeof errors = {}
    if (!form.name.trim()) e.name = t("acct.s.err.name")
    if (!form.mobile.trim()) e.mobile = t("acct.c.err.mobile")
    setErrors(e)
    if (Object.keys(e).length) { requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus()); return }
    setFailure("")
    try { const s = createSupplier(form); onSaved(s.id, t("acct.s.added", { name: s.name })) } catch (err) { setFailure(message(err)) }
  }
  return (
    <Drawer open title={t("acct.s.add")} onClose={onClose}
      footer={<><button type="button" className="mg2-btn mg2-btn-primary" onClick={save}>{t("acct.save")}</button><button type="button" className="mg2-btn mg2-btn-ghost" onClick={onClose}>{t("acct.cancel")}</button></>}>
      <form ref={formRef} onSubmit={(e) => { e.preventDefault(); save() }} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {failure && <div className="mg2-banner mg2-t-err" role="alert"><AlertTriangle size={18} aria-hidden="true" /><span style={{ flex: 1, color: "var(--text)" }}>{failure}</span></div>}
        <Field label={t("acct.s.f.name")} error={errors.name}>{(a) => <input {...a} className="mg2-input" value={form.name} onChange={set("name")} autoComplete="off" />}</Field>
        <Field label={t("acct.s.f.mobile")} error={errors.mobile}>{(a) => <input {...a} className="mg2-input" dir="ltr" inputMode="tel" value={form.mobile} onChange={set("mobile")} />}</Field>
        <Field label={t("acct.s.f.contact")}>{(a) => <input {...a} className="mg2-input" value={form.contact} onChange={set("contact")} />}</Field>
        <Field label={t("acct.s.f.address")}>{(a) => <input {...a} className="mg2-input" value={form.address} onChange={set("address")} />}</Field>
        <Field label={t("acct.s.f.notes")}>{(a) => <textarea {...a} className="mg2-input" rows={2} style={{ paddingBlock: 8 }} value={form.notes} onChange={set("notes")} />}</Field>
        <button type="submit" hidden />
      </form>
    </Drawer>
  )
}

/** Pay a supplier: against one purchase order or the payable balance; never more than is owed. */
function SupplierPaymentDrawer({ suppliers, orders, initial, onClose, onRecorded }: {
  suppliers: SupplierLedger[]; orders: PurchaseOrder[]; initial: { supplierId: string; orderId?: string }; onClose: () => void; onRecorded: (text: string) => void
}) {
  const { t } = useI18n()
  const [supplierId, setSupplierId] = useState(initial.supplierId)
  const [orderId, setOrderId] = useState(initial.orderId ?? "")
  const [amount, setAmount] = useState("")
  const [method, setMethod] = useState<SupplierPaymentMethod>("Cash")
  const [reference, setReference] = useState("")
  const [error, setError] = useState("")
  const [failure, setFailure] = useState("")
  const attempt = useRef(newPaymentAttempt())
  // A changed form is a new attempt; pressing again without a change is the same one.
  useEffect(() => { attempt.current = newPaymentAttempt() }, [supplierId, orderId, amount, method, reference])
  const supplier = suppliers.find((s) => s.id === supplierId)
  const open = useMemo(() => orders.filter((o) => o.supplierId === supplierId && o.paymentStatus !== "Paid"), [orders, supplierId])
  const order = orders.find((o) => o.id === orderId)
  const max = order ? owedOn(order) : supplier?.balance ?? 0
  const value = parseMoney(amount)
  const over = value > max + 0.001
  const full = String(Math.round(max * 100) / 100)

  function record() {
    setFailure("")
    if (!supplier || max <= 0.001) { setError(t("acct.s.err.choose")); return }
    if (!amount.trim() || !(value > 0)) { setError(t("acct.err.amount")); return }
    if (over) { setError(t("acct.err.over", { amount: formatCurrency(max) })); return }
    setError("")
    try {
      const p = recordSupplierPayment({ id: attempt.current, syncOpId: `op-${attempt.current}`, supplierId: supplier.id, purchaseOrderId: orderId || undefined, amount: Math.min(value, max), method, reference })
      onRecorded(t("acct.s.paid_done", { amount: formatCurrency(p.amount), name: p.supplierName }))
    } catch (err) { setFailure(message(err)) }
  }
  return (
    <Drawer open title={t("acct.s.pay")} subtitle={supplier ? t("acct.s.owed_to", { name: supplier.name, amount: formatCurrency(supplier.balance) }) : undefined} onClose={onClose}
      footer={<><button type="button" className="mg2-btn mg2-btn-primary" onClick={record}>{t("acct.c.record_payment")}</button><button type="button" className="mg2-btn mg2-btn-ghost" onClick={onClose}>{t("acct.cancel")}</button></>}>
      <form onSubmit={(e) => { e.preventDefault(); record() }} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {failure && <div className="mg2-banner mg2-t-err" role="alert"><AlertTriangle size={18} aria-hidden="true" /><span style={{ flex: 1, color: "var(--text)" }}>{failure}</span></div>}
        <Field label={t("acct.s.f.supplier")}>
          {(a) => <select {...a} className="mg2-select" value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setOrderId(""); setError("") }}>
            {suppliers.filter((s) => s.balance > 0.001 || s.id === supplierId).map((s) => <option key={s.id} value={s.id}>{s.name} · {formatCurrency(s.balance)}</option>)}
          </select>}
        </Field>
        <Field label={t("acct.s.f.against")}>
          {(a) => <select {...a} className="mg2-select" value={orderId} onChange={(e) => { setOrderId(e.target.value); setError("") }}>
            <option value="">{t("acct.s.any_balance")}</option>
            {open.map((o) => <option key={o.id} value={o.id}>{o.poNumber} · {formatCurrency(owedOn(o))}</option>)}
          </select>}
        </Field>
        <Field label={t("acct.f.amount")} help={t("acct.f.amount_max", { amount: formatCurrency(max) })} error={error || undefined}>
          {(a) => <span className="mg2-money"><span className="mg2-adorn">$</span><input {...a} type="number" min="0" step="0.01" inputMode="decimal" dir="ltr" value={amount} onChange={(e) => { setAmount(e.target.value); setError("") }} /></span>}
        </Field>
        <div className="mg2-actions">
          <button type="button" className="mg2-btn" onClick={() => { setAmount(full); setError("") }}>{over ? t("acct.record_instead", { amount: formatCurrency(max) }) : t("acct.full_balance", { amount: formatCurrency(max) })}</button>
        </div>
        <div>
          <span className="mg2-label" id="sup-pay-method">{t("acct.f.method")}</span>
          <div className="mg2-seg" role="radiogroup" aria-labelledby="sup-pay-method" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(112px, 1fr))" }}>
            {METHODS.map((m) => (
              <label key={m}><input type="radio" name="sup-pay-method" checked={method === m} onChange={() => setMethod(m)} /><CheckCircle2 size={14} className="mg2-chk" aria-hidden="true" />{t(`acct.pay.${METHOD_KEY[m]}`)}</label>
            ))}
          </div>
        </div>
        <Field label={t("acct.f.reference")}>{(a) => <input {...a} className="mg2-input" value={reference} onChange={(e) => setReference(e.target.value)} />}</Field>
        <p className="mg2-cap" style={{ margin: 0, display: "flex", gap: 6, alignItems: "center" }}><Info size={14} aria-hidden="true" />{t("acct.s.pay_note")}</p>
        <button type="submit" hidden />
      </form>
    </Drawer>
  )
}
