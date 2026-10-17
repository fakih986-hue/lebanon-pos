import { useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "react-router"
import {
  AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, Download, HandCoins, Info, MessageCircle, Pencil, Phone, Plus, Printer, Search, UsersRound,
} from "lucide-react"
import { useI18n } from "@lebanonpos/shared"

import { useDebounce } from "../../hooks/useDebounce"
import { useHotkeys } from "../../hooks/useHotkey"
import { Badge, ConfirmLayer, Drawer, EmptyState, Field, FilterChip, PageHeader, SkeletonRows, StatTile } from "../../features/pos/components/backoffice/BackOffice"
import { formatCurrency, formatNumber } from "../../features/pos/lib/currency"
import { debtReminderMessage, openWhatsApp } from "../../features/pos/lib/whatsapp"
import {
  addCustomer, archiveCustomer, buildCustomerStatement, customerHasHistory, deleteCustomer, getCustomerActivity, getCustomerLedger,
  getLedgerTotals, recordDebtPayment, restoreCustomer, subscribeLedger, updateCustomer, type CustomerLedger, type DebtPayment,
} from "../../features/pos/services/customer.service"
import { getSettings } from "../../features/pos/services/settings.service"

// Midnight Gold v2 — Customers & debt (DESIGN-SYSTEM §6–§8). Same anatomy as Products: header,
// stat tiles, filters, table (cards on phones), details drawer. Every action calls the existing
// customer service; balances are debt sales minus payments (FIFO aging), never edited here.
type View = "all" | "owing" | "overdue" | "over_limit" | "archived"
const VIEWS: View[] = ["all", "owing", "overdue", "over_limit", "archived"]
type SortKey = "name" | "balance" | "lastActivity"
const METHODS: DebtPayment["method"][] = ["Cash", "Card", "Wallet", "Bank Transfer", "Refund Credit"]
const METHOD_KEY: Record<DebtPayment["method"], string> = { Cash: "cash", Card: "card", Wallet: "wallet", "Bank Transfer": "bank_transfer", "Refund Credit": "refund_credit" }
const AGES = ["0", "30", "60", "90"] as const

/** One id per payment attempt: a double tap or a retry of the same attempt records it once. */
const newPaymentAttempt = () => `pay-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`

function useDate() {
  const { locale } = useI18n()
  const tag = locale === "ar" ? "ar-LB" : "en-GB"
  return {
    day: (v: string) => new Intl.DateTimeFormat(tag, { day: "2-digit", month: "short", year: "numeric" }).format(new Date(v)),
    stamp: (v: string) => new Intl.DateTimeFormat(tag, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(v)),
  }
}
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
const methodKey = (m: string) => METHOD_KEY[m as DebtPayment["method"]] ?? "cash"

export default function CustomersPage() {
  const { t } = useI18n()
  const date = useDate()
  const [params, setParams] = useSearchParams()
  const loading = false // ledgers are read synchronously from this device
  const [customers, setCustomers] = useState<CustomerLedger[]>(() => getCustomerLedger({ includeArchived: true }))
  const [totals, setTotals] = useState(getLedgerTotals())
  const [search, setSearch] = useState("")
  const q = useDebounce(search, 150)
  const searchRef = useRef<HTMLInputElement>(null)
  useHotkeys([{ key: "f", modifiers: ["ctrl"], handler: () => searchRef.current?.focus() }])
  const view = (VIEWS.includes(params.get("view") as View) ? params.get("view") : "all") as View
  const [age, setAge] = useState("")
  const [sortKey, setSortKey] = useState<SortKey>("name")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const detailId = params.get("customer")
  const [editor, setEditor] = useState<{ mode: "create" } | { mode: "edit"; id: string } | null>(null)
  const [paying, setPaying] = useState<{ customerId: string } | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: "ok" | "err"; text: string } | null>(null)

  function refresh() {
    setCustomers(getCustomerLedger({ includeArchived: true }))
    setTotals(getLedgerTotals())
  }
  useEffect(() => subscribeLedger(refresh), [])

  const active = useMemo(() => customers.filter((c) => !c.archived), [customers])
  const inView = (c: CustomerLedger, v: View) =>
    v === "archived" ? !!c.archived
      : c.archived ? false
      : v === "all" ? true
      : v === "owing" ? c.balance > 0.001
      : v === "overdue" ? c.overdue
      : c.overLimit
  const counts = Object.fromEntries(VIEWS.map((v) => [v, customers.filter((c) => inView(c, v)).length])) as Record<View, number>
  const aging = useMemo(() => active.reduce((a, c) => ({
    current: a.current + c.aging.current, days30: a.days30 + c.aging.days30, days60: a.days60 + c.aging.days60, days90: a.days90 + c.aging.days90,
  }), { current: 0, days30: 0, days60: 0, days90: 0 }), [active])
  const ageAmount: Record<(typeof AGES)[number], number> = { "0": aging.current, "30": aging.days30, "60": aging.days60, "90": aging.days90 }

  const query = q.trim().toLowerCase()
  const list = customers.filter((c) => {
    if (!inView(c, view)) return false
    if (age) {
      // The customer's oldest unpaid debt falls in [days, days + 30); the last bucket is open-ended.
      const days = parseInt(age, 10)
      const owed = c.aging.current + c.aging.days30 + c.aging.days60 + c.aging.days90
      if (!(owed > 0.001 && c.oldestUnpaidDays >= days && (days === 90 || c.oldestUnpaidDays < days + 30))) return false
    }
    return !query || c.name.toLowerCase().includes(query) || c.mobile.includes(query)
  }).sort((a, b) => {
    const cmp = sortDir === "asc" ? 1 : -1
    if (sortKey === "balance") return (b.balance - a.balance) * cmp
    if (sortKey === "lastActivity") return (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? "") * cmp
    return a.name.localeCompare(b.name) * cmp
  })
  const detail = detailId ? customers.find((c) => c.id === detailId) : undefined

  function setView(v: View) {
    const next = new URLSearchParams(params); if (v === "all") next.delete("view"); else next.set("view", v)
    setParams(next, { replace: true })
  }
  function openDetail(id: string | null) {
    const next = new URLSearchParams(params); if (id) next.set("customer", id); else next.delete("customer")
    setParams(next, { replace: true })
  }
  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc")); else { setSortKey(k); setSortDir("asc") }
  }
  function exportCsv() {
    const rows = [["Name", "Phone", "Credit limit", "Sold on account", "Paid", "Balance", "Oldest unpaid days", "Overdue", "Archived"],
      ...list.map((c) => [c.name, c.mobile, c.creditLimit, c.debtTotal, c.paidTotal, c.balance, c.oldestUnpaidDays, c.overdue ? "yes" : "", c.archived ? "yes" : ""])]
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n")
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }))
    const a = document.createElement("a"); a.href = url; a.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url)
  }
  const firstOwing = active.find((c) => c.balance > 0.001)
  const sortHead = (k: SortKey, label: string, className?: string) => (
    <th className={className} aria-sort={sortKey === k ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="mg2-sort" onClick={() => toggleSort(k)}>
        {label}{sortKey === k && (sortDir === "asc" ? <ArrowUp size={13} aria-hidden="true" /> : <ArrowDown size={13} aria-hidden="true" />)}
      </button>
    </th>
  )
  const badges = (c: CustomerLedger) => (
    <>
      {c.archived && <Badge tone="muted">{t("acct.archived")}</Badge>}
      {c.overdue && <Badge tone="err" icon={<AlertTriangle size={13} aria-hidden="true" />}>{t("acct.c.overdue_days", { n: c.oldestUnpaidDays })}</Badge>}
      {c.overLimit && <Badge tone="warn">{t("acct.c.over_limit")}</Badge>}
      {c.sellAtCost && <Badge tone="info">{t("acct.c.sell_at_cost")}</Badge>}
      {c.isWholesale && <Badge tone="muted">{t("acct.c.wholesale")}</Badge>}
    </>
  )

  return (
    <main className="mg2 mg2-bo min-h-0 flex-1 overflow-y-auto">
      <div className="mg2-wrap">
        <PageHeader eyebrow={t("acct.money")} title={t("acct.c.title")} actions={<>
          <button type="button" className="mg2-btn" onClick={exportCsv} aria-label={t("acct.export")}><Download size={16} /><span className="hidden sm:inline">{t("acct.export")}</span></button>
          <button type="button" className="mg2-btn" onClick={() => setEditor({ mode: "create" })}><Plus size={16} />{t("acct.c.add")}</button>
          <button type="button" className="mg2-btn mg2-btn-primary" disabled={!firstOwing} aria-describedby={firstOwing ? undefined : "cust-pay-why"}
            onClick={() => firstOwing && setPaying({ customerId: detail && detail.balance > 0.001 && !detail.archived ? detail.id : firstOwing.id })}>
            <HandCoins size={16} />{t("acct.c.receive")}
          </button>
        </>} />
        {!firstOwing && !loading && <p className="mg2-cap" id="cust-pay-why" style={{ marginTop: 8 }}>{t("acct.c.nobody_owes")}</p>}

        <div className="mg2-stats" style={{ marginBlock: 16 }}>
          <StatTile label={t("acct.c.kpi.customers")} value={formatNumber(totals.customers)} />
          <StatTile label={t("acct.c.kpi.outstanding")} value={<span className={totals.outstanding > 0.001 ? "t-pos" : undefined}>{formatCurrency(totals.outstanding)}</span>} />
          <StatTile label={t("acct.c.kpi.on_account")} value={formatCurrency(totals.debtTotal)} />
          <StatTile label={t("acct.c.kpi.collected")} value={formatCurrency(totals.paidTotal)} />
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
            <input ref={searchRef} className="mg2-input" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("acct.c.search")} aria-label={t("acct.c.search")} />
          </div>
        </div>
        <div className="mg2-chips" role="group" aria-label={t("acct.views")} style={{ marginBottom: 8 }}>
          {VIEWS.map((v) => (
            <FilterChip key={v} pressed={view === v} onClick={() => setView(v)} label={t(`acct.c.view.${v}`)} count={counts[v]}
              tone={v === "overdue" ? "err" : v === "over_limit" || v === "owing" ? "warn" : undefined} />
          ))}
        </div>
        {totals.outstanding > 0.001 && (
          <div className="mg2-chips" role="group" aria-label={t("acct.c.by_age")} style={{ marginBottom: 12 }}>
            {AGES.map((a) => (
              <button key={a} type="button" className="mg2-chip" aria-pressed={age === a} onClick={() => setAge((x) => (x === a ? "" : a))}>
                {t(`acct.c.age.${a}`)}<span className="num">{formatCurrency(ageAmount[a])}</span>
              </button>
            ))}
          </div>
        )}

        {loading ? <SkeletonRows /> : customers.length === 0 ? (
          <div className="mg2-card"><EmptyState icon={<UsersRound size={28} aria-hidden="true" />} title={t("acct.c.empty_title")} text={t("acct.c.empty_text")}
            action={<button type="button" className="mg2-btn mg2-btn-primary" onClick={() => setEditor({ mode: "create" })}><Plus size={16} />{t("acct.c.add")}</button>} /></div>
        ) : list.length === 0 ? (
          <div className="mg2-card"><EmptyState title={t("acct.no_match")} text={t("acct.no_match_text")}
            action={<button type="button" className="mg2-btn" onClick={() => { setSearch(""); setAge(""); setView("all") }}>{t("acct.clear_filters")}</button>} /></div>
        ) : (
          <>
            <div className="mg2-table-wrap wide-only">
              <table className="mg2-table" aria-label={t("acct.c.table")}>
                <thead>
                  <tr>
                    {sortHead("name", t("acct.c.col.customer"))}
                    {sortHead("balance", t("acct.col.balance"), "num")}
                    <th className="p4">{t("acct.c.col.limit")}</th>
                    <th className="p3">{t("acct.c.col.oldest")}</th>
                    {sortHead("lastActivity", t("acct.col.last_activity"), "p4")}
                  </tr>
                </thead>
                <tbody>
                  {list.map((c) => (
                    <tr key={c.id} aria-selected={detailId === c.id} onClick={() => openDetail(c.id)}>
                      <td>
                        <button type="button" className="mg2-sort" style={{ fontWeight: 600, textAlign: "start" }} onClick={(e) => { e.stopPropagation(); openDetail(c.id) }}>{c.name}</button>
                        <span className="sub" style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}><span className="num-ltr">{c.mobile}</span>{badges(c)}</span>
                      </td>
                      <td className={`num ${c.balance > 0.001 ? "t-pos" : ""}`} style={{ fontWeight: 700 }}>{formatCurrency(c.balance)}</td>
                      <td className="p4">
                        {c.creditLimit > 0 ? (
                          <div style={{ minWidth: 140 }}>
                            <span className="mg2-cap">{t("acct.c.of_limit", { used: formatCurrency(c.balance), limit: formatCurrency(c.creditLimit) })}</span>
                            <div className={`mg2-bar ${c.overLimit ? "t-err" : c.balance > c.creditLimit * 0.8 ? "t-warn" : ""}`} style={{ marginTop: 4 }}><span style={{ width: `${Math.min(100, (c.balance / c.creditLimit) * 100)}%` }} /></div>
                          </div>
                        ) : <span style={{ color: "var(--text-3)" }}>{t("acct.c.no_limit")}</span>}
                      </td>
                      <td className="p3">{c.balance > 0.001 ? t("acct.c.days", { n: c.oldestUnpaidDays }) : <span style={{ color: "var(--text-3)" }}>—</span>}</td>
                      <td className="p4" style={{ color: "var(--text-2)" }}>{c.lastActivityAt ? date.stamp(c.lastActivityAt) : t("acct.no_activity")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mg2-rowcards phone-only" role="list" aria-label={t("acct.c.table")}>
              {list.map((c) => (
                <button key={c.id} type="button" role="listitem" className="mg2-rowcard" aria-current={detailId === c.id || undefined} onClick={() => openDetail(c.id)}>
                  <span className="top"><span className="name">{c.name}</span><span className={`amt ${c.balance > 0.001 ? "t-pos" : ""}`}>{formatCurrency(c.balance)}</span></span>
                  <span className="meta"><span className="num-ltr">{c.mobile}</span>{c.lastActivityAt && <span>{date.stamp(c.lastActivityAt)}</span>}</span>
                  {(c.archived || c.overdue || c.overLimit || c.sellAtCost || c.isWholesale) && <span className="meta">{badges(c)}</span>}
                </button>
              ))}
            </div>
            <p className="mg2-cap" style={{ marginTop: 8 }}>{t("acct.c.footer", { n: list.length, total: formatCurrency(list.reduce((s, c) => s + c.balance, 0)) })}</p>
          </>
        )}
      </div>

      {detail && (
        <CustomerDrawer key={detail.id} customer={detail} onClose={() => openDetail(null)}
          onPay={() => setPaying({ customerId: detail.id })}
          onEdit={() => setEditor({ mode: "edit", id: detail.id })}
          onDelete={() => setDeleteId(detail.id)}
          onNotice={setNotice} />
      )}
      {editor && (
        <CustomerEditor customer={editor.mode === "edit" ? customers.find((c) => c.id === editor.id) : undefined}
          onClose={() => setEditor(null)}
          onSaved={(id, text) => { setEditor(null); refresh(); openDetail(id); setNotice({ tone: "ok", text }) }} />
      )}
      {paying && (
        <PaymentDrawer customers={active} initialId={paying.customerId} onClose={() => setPaying(null)}
          onRecorded={(text, id) => { setPaying(null); refresh(); openDetail(id); setNotice({ tone: "ok", text }) }} />
      )}
      <ConfirmLayer open={deleteId !== null} title={t("acct.c.delete_title")} confirmLabel={t("acct.delete")} confirmDestructive
        onConfirm={() => {
          const c = customers.find((x) => x.id === deleteId)
          try { if (deleteId) deleteCustomer(deleteId); openDetail(null); if (c) setNotice({ tone: "ok", text: t("acct.c.deleted", { name: c.name }) }) }
          catch (error) { setNotice({ tone: "err", text: message(error) }) }
          setDeleteId(null)
        }}
        onCancel={() => setDeleteId(null)}>
        <p>{t("acct.c.delete_text", { name: customers.find((x) => x.id === deleteId)?.name ?? "" })}</p>
      </ConfirmLayer>
    </main>
  )
}

/** Details: balance, limit, aging, statement (running balance) and payment history. */
function CustomerDrawer({ customer: c, onClose, onPay, onEdit, onDelete, onNotice }: {
  customer: CustomerLedger; onClose: () => void; onPay: () => void; onEdit: () => void; onDelete: () => void
  onNotice: (n: { tone: "ok" | "err"; text: string }) => void
}) {
  const { t } = useI18n()
  const date = useDate()
  const [tab, setTab] = useState<"statement" | "payments">("statement")
  const [note, setNote] = useState(c.notes)
  const [error, setError] = useState("")
  const activity = getCustomerActivity(c.id)
  // Running balance, oldest first: a sale on account adds, a payment subtracts.
  const statement = activity.reduceRight<Array<(typeof activity)[number] & { running: number }>>((acc, a) => {
    const prev = acc.length ? acc[0].running : 0
    return [{ ...a, running: prev + (a.type === "Payment" ? -a.amount : a.amount) }, ...acc]
  }, [])
  const payments = activity.filter((a) => a.type === "Payment")
  const owed = c.aging.current + c.aging.days30 + c.aging.days60 + c.aging.days90
  const pct = (v: number) => (owed > 0 ? (v / owed) * 100 : 0)
  const hasHistory = customerHasHistory(c.id)
  const store = getSettings().storeName
  const limitPct = c.creditLimit > 0 ? Math.min(100, (c.balance / c.creditLimit) * 100) : 0

  function act(fn: () => void, ok: string) {
    setError("")
    try { fn(); onNotice({ tone: "ok", text: ok }) } catch (e) { setError(message(e)) }
  }
  function downloadStatement() {
    const url = URL.createObjectURL(new Blob([buildCustomerStatement(c.id, store)], { type: "text/plain" }))
    const a = document.createElement("a"); a.href = url; a.download = `statement-${c.name.replace(/\s+/g, "-")}.txt`; a.click(); URL.revokeObjectURL(url)
  }
  function printStatement() {
    const text = buildCustomerStatement(c.id, store)
    const w = window.open("", "_blank", "width=420,height=600")
    if (!w) { setError(t("acct.popup_blocked")); return }
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    w.document.write(`<html><head><title>${esc(c.name)}</title><style>body{font-family:monospace;white-space:pre;padding:20px;font-size:12px}</style></head><body>${esc(text)}</body></html>`)
    w.document.close(); w.focus(); setTimeout(() => w.print(), 250)
  }

  return (
    <Drawer open wide title={c.name} onClose={onClose}
      subtitle={<span style={{ display: "inline-flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}><span className="num-ltr">{c.mobile}</span>
        {c.archived && <Badge tone="muted">{t("acct.archived")}</Badge>}
        {c.overdue && <Badge tone="err">{t("acct.c.overdue_days", { n: c.oldestUnpaidDays })}</Badge>}
        {c.overLimit && <Badge tone="warn">{t("acct.c.over_limit")}</Badge>}
        {c.sellAtCost && <Badge tone="info">{t("acct.c.sell_at_cost")}</Badge>}
        {c.isWholesale && <Badge tone="muted">{t("acct.c.wholesale")}</Badge>}</span>}
      footer={<>
        <button type="button" className="mg2-btn mg2-btn-primary" disabled={c.balance <= 0.001 || !!c.archived} aria-describedby={c.balance <= 0.001 ? "cd-pay-why" : undefined} onClick={onPay} data-autofocus><HandCoins size={16} />{t("acct.c.receive")}</button>
        <button type="button" className="mg2-btn" onClick={onEdit}><Pencil size={16} />{t("acct.edit")}</button>
        {c.archived
          ? <button type="button" className="mg2-btn" onClick={() => act(() => restoreCustomer(c.id), t("acct.restored", { name: c.name }))}>{t("acct.restore")}</button>
          : <button type="button" className="mg2-btn" onClick={() => act(() => archiveCustomer(c.id), t("acct.archived_done", { name: c.name }))}>{t("acct.archive")}</button>}
        {!hasHistory && <button type="button" className="mg2-btn mg2-btn-danger" onClick={onDelete}>{t("acct.delete")}</button>}
      </>}>
      {c.balance <= 0.001 && <p className="mg2-cap" id="cd-pay-why" style={{ margin: 0 }}>{t("acct.c.nothing_owed")}</p>}
      {error && <div className="mg2-banner mg2-t-err" role="alert"><AlertTriangle size={18} aria-hidden="true" /><span style={{ flex: 1, color: "var(--text)" }}>{error}</span></div>}
      <div className="mg2-stats">
        <StatTile label={t("acct.col.balance")} value={<span className={c.balance > 0.001 ? "t-pos" : undefined}>{formatCurrency(c.balance)}</span>} />
        <StatTile label={t("acct.c.sold_on_account")} value={formatCurrency(c.debtTotal)} />
        <StatTile label={t("acct.paid")} value={formatCurrency(c.paidTotal)} />
        <StatTile label={t("acct.c.col.oldest")} value={c.balance > 0.001 ? t("acct.c.days", { n: c.oldestUnpaidDays }) : "—"} />
      </div>
      {c.creditLimit > 0 && (
        <div>
          <div className="mg2-sum"><span className="mg2-cap">{t("acct.c.col.limit")}</span><strong>{t("acct.c.of_limit", { used: formatCurrency(c.balance), limit: formatCurrency(c.creditLimit) })}</strong></div>
          <div className={`mg2-bar ${c.overLimit ? "t-err" : c.balance > c.creditLimit * 0.8 ? "t-warn" : ""}`} role="progressbar" aria-label={t("acct.c.limit_used")}
            aria-valuenow={Math.round(limitPct)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${limitPct}%` }} /></div>
        </div>
      )}
      {owed > 0.001 && (
        <section aria-label={t("acct.c.by_age")}>
          <h3 className="mg2-section-title" style={{ marginBottom: 8 }}>{t("acct.c.by_age")}</h3>
          <div className="mg2-age" aria-hidden="true">
            <span className="a0" style={{ width: `${pct(c.aging.current)}%` }} /><span className="a1" style={{ width: `${pct(c.aging.days30)}%` }} />
            <span className="a2" style={{ width: `${pct(c.aging.days60)}%` }} /><span className="a3" style={{ width: `${pct(c.aging.days90)}%` }} />
          </div>
          <div className="mg2-age-legend">
            <span>{t("acct.c.age.0")}<strong>{formatCurrency(c.aging.current)}</strong></span>
            <span>{t("acct.c.age.30")}<strong>{formatCurrency(c.aging.days30)}</strong></span>
            <span>{t("acct.c.age.60")}<strong>{formatCurrency(c.aging.days60)}</strong></span>
            <span>{t("acct.c.age.90")}<strong>{formatCurrency(c.aging.days90)}</strong></span>
          </div>
        </section>
      )}
      <div className="mg2-actions">
        {c.mobile && <button type="button" className="mg2-btn" onClick={() => openWhatsApp(c.mobile, debtReminderMessage({ storeName: store, customerName: c.name, balance: c.balance, oldestDays: c.oldestUnpaidDays }))}><MessageCircle size={16} />{t("acct.c.whatsapp")}</button>}
        {c.mobile && <a className="mg2-btn" style={{ textDecoration: "none" }} href={`tel:${c.mobile}`}><Phone size={16} />{t("acct.call")}</a>}
        <button type="button" className="mg2-btn" onClick={downloadStatement}><Download size={16} />{t("acct.c.statement_download")}</button>
        <button type="button" className="mg2-btn" onClick={printStatement}><Printer size={16} />{t("acct.c.statement_print")}</button>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); act(() => updateCustomer(c.id, { notes: note.trim() }), t("acct.c.note_saved")) }} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 240px" }}>
          <Field label={t("acct.c.promise")} help={t("acct.c.promise_help")}>
            {(a) => <input {...a} className="mg2-input" maxLength={160} value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
        </div>
        <button type="submit" className="mg2-btn" disabled={note.trim() === (c.notes ?? "").trim()} style={{ marginBottom: 26 }}>{t("acct.save")}</button>
      </form>

      <div className="mg2-chips" role="group" aria-label={t("acct.c.history")}>
        {(["statement", "payments"] as const).map((k) => (
          <FilterChip key={k} pressed={tab === k} onClick={() => setTab(k)} label={t(`acct.c.tab.${k}`)} count={k === "statement" ? statement.length : payments.length} />
        ))}
      </div>
      {(tab === "statement" ? statement.length : payments.length) === 0 ? (
        <EmptyState title={t(tab === "statement" ? "acct.c.no_statement" : "acct.c.no_payments")} text={t("acct.c.no_history_text")} />
      ) : tab === "statement" ? (
        <div className="mg2-table-wrap">
          <table className="mg2-table mg2-trace" aria-label={t("acct.c.tab.statement")}>
            <thead><tr><th>{t("acct.col.date")}</th><th>{t("acct.col.what")}</th><th className="num">{t("acct.c.col.charge")}</th><th className="num">{t("acct.c.col.payment")}</th><th className="num">{t("acct.col.balance")}</th></tr></thead>
            <tbody>
              {statement.map((a) => (
                <tr key={`${a.type}-${a.id}`} className="mg2-static">
                  <td style={{ whiteSpace: "nowrap" }}>{date.day(a.createdAt)}</td>
                  <td>{a.type === "Sale"
                    ? <><span className="num-ltr" style={{ fontWeight: 600 }}>{a.title}</span><span className="sub">{t("acct.c.sale_lines", { n: Number.parseInt(a.detail, 10) || 0 })}</span></>
                    : <>{t(`acct.pay.${methodKey(a.title)}`)}{a.detail && a.detail !== "Debt payment" && <span className="sub">{a.detail}</span>}</>}</td>
                  <td className="num">{a.type === "Sale" ? formatCurrency(a.amount) : ""}</td>
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
            <thead><tr><th>{t("acct.col.date")}</th><th>{t("acct.col.method")}</th><th className="p3">{t("acct.col.reference")}</th><th className="num">{t("acct.col.amount")}</th></tr></thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="mg2-static">
                  <td style={{ whiteSpace: "nowrap" }}>{date.stamp(p.createdAt)}</td>
                  <td>{t(`acct.pay.${methodKey(p.title)}`)}</td>
                  <td className="p3" style={{ color: "var(--text-2)" }}>{p.detail === "Debt payment" ? "—" : p.detail}</td>
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

/** Add / edit a customer. Name and mobile are required; Save moves focus to the first problem. */
function CustomerEditor({ customer, onClose, onSaved }: { customer?: CustomerLedger; onClose: () => void; onSaved: (id: string, text: string) => void }) {
  const { t } = useI18n()
  const [name, setName] = useState(customer?.name ?? "")
  const [mobile, setMobile] = useState(customer?.mobile ?? "")
  const [limit, setLimit] = useState(customer ? String(customer.creditLimit || "") : "")
  const [notes, setNotes] = useState(customer?.notes ?? "")
  const [wholesale, setWholesale] = useState(customer?.isWholesale ?? false)
  const [atCost, setAtCost] = useState(customer?.sellAtCost ?? false)
  const [errors, setErrors] = useState<{ name?: string; mobile?: string; limit?: string }>({})
  const [failure, setFailure] = useState("")
  const formRef = useRef<HTMLFormElement>(null)

  function save() {
    const e: typeof errors = {}
    if (!name.trim()) e.name = t("acct.c.err.name")
    if (!mobile.trim()) e.mobile = t("acct.c.err.mobile")
    const lim = limit.trim() === "" ? 0 : Number(limit)
    if (!Number.isFinite(lim) || lim < 0) e.limit = t("acct.c.err.limit")
    setErrors(e)
    if (Object.keys(e).length) { requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus()); return }
    setFailure("")
    try {
      if (customer) {
        updateCustomer(customer.id, { name: name.trim(), mobile: mobile.trim(), creditLimit: lim, isWholesale: wholesale, sellAtCost: atCost, notes: notes.trim() })
        onSaved(customer.id, t("acct.c.saved", { name: name.trim() }))
      } else {
        const c = addCustomer({ name, mobile, creditLimit: lim, isWholesale: wholesale, sellAtCost: atCost, notes })
        onSaved(c.id, t("acct.c.added", { name: c.name }))
      }
    } catch (err) { setFailure(message(err)) }
  }
  return (
    <Drawer open title={customer ? t("acct.c.edit_title", { name: customer.name }) : t("acct.c.add")} onClose={onClose}
      footer={<><button type="button" className="mg2-btn mg2-btn-primary" onClick={save}>{t("acct.save")}</button><button type="button" className="mg2-btn mg2-btn-ghost" onClick={onClose}>{t("acct.cancel")}</button></>}>
      <form ref={formRef} onSubmit={(e) => { e.preventDefault(); save() }} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {failure && <div className="mg2-banner mg2-t-err" role="alert"><AlertTriangle size={18} aria-hidden="true" /><span style={{ flex: 1, color: "var(--text)" }}>{failure}</span></div>}
        <Field label={t("acct.c.f.name")} error={errors.name}>{(a) => <input {...a} className="mg2-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />}</Field>
        <Field label={t("acct.c.f.mobile")} error={errors.mobile}>{(a) => <input {...a} className="mg2-input" dir="ltr" inputMode="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} />}</Field>
        <Field label={t("acct.c.f.limit")} help={t("acct.c.f.limit_help")} error={errors.limit}>
          {(a) => <span className="mg2-money"><span className="mg2-adorn">$</span><input {...a} type="number" min="0" step="0.01" inputMode="decimal" dir="ltr" value={limit} onChange={(e) => setLimit(e.target.value)} /></span>}
        </Field>
        <Field label={t("acct.c.f.notes")}>{(a) => <textarea {...a} className="mg2-input" rows={2} style={{ paddingBlock: 8 }} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
        <label style={{ display: "flex", gap: 10, alignItems: "center" }}><input type="checkbox" className="mg2-check" checked={wholesale} onChange={(e) => setWholesale(e.target.checked)} />{t("acct.c.f.wholesale")}</label>
        <label style={{ display: "flex", gap: 10, alignItems: "center" }}><input type="checkbox" className="mg2-check" checked={atCost} onChange={(e) => setAtCost(e.target.checked)} />{t("acct.c.f.at_cost")}</label>
        <button type="submit" hidden />
      </form>
    </Drawer>
  )
}

/** Record a payment against a balance. Never more than is owed: an amount above it says so and offers the balance. */
function PaymentDrawer({ customers, initialId, onClose, onRecorded }: {
  customers: CustomerLedger[]; initialId: string; onClose: () => void; onRecorded: (text: string, customerId: string) => void
}) {
  const { t } = useI18n()
  const owing = customers.filter((c) => c.balance > 0.001)
  const [customerId, setCustomerId] = useState(initialId)
  const [amount, setAmount] = useState("")
  const [method, setMethod] = useState<DebtPayment["method"]>("Cash")
  const [reference, setReference] = useState("")
  const [error, setError] = useState("")
  const [failure, setFailure] = useState("")
  const attempt = useRef(newPaymentAttempt())
  // A changed form is a new attempt; pressing again without a change is the same one.
  useEffect(() => { attempt.current = newPaymentAttempt() }, [customerId, amount, method, reference])
  const customer = customers.find((c) => c.id === customerId)
  const balance = customer?.balance ?? 0
  const value = Number(amount)
  const over = Number.isFinite(value) && value > balance + 0.001
  const full = String(Math.round(balance * 100) / 100)

  function record() {
    setFailure("")
    if (!customer || balance <= 0.001) { setError(t("acct.c.err.choose")); return }
    if (!amount.trim() || !Number.isFinite(value) || value <= 0) { setError(t("acct.err.amount")); return }
    if (over) { setError(t("acct.err.over", { amount: formatCurrency(balance) })); return }
    setError("")
    try {
      const p = recordDebtPayment({ id: attempt.current, customerId: customer.id, amount: Math.min(value, balance), method, reference })
      onRecorded(t("acct.c.received", { amount: formatCurrency(p.amount), name: customer.name }), customer.id)
    } catch (err) { setFailure(message(err)) }
  }
  return (
    <Drawer open title={t("acct.c.receive")} subtitle={customer ? t("acct.c.owes", { name: customer.name, amount: formatCurrency(balance) }) : undefined} onClose={onClose}
      footer={<><button type="button" className="mg2-btn mg2-btn-primary" onClick={record}>{t("acct.c.record_payment")}</button><button type="button" className="mg2-btn mg2-btn-ghost" onClick={onClose}>{t("acct.cancel")}</button></>}>
      <form onSubmit={(e) => { e.preventDefault(); record() }} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {failure && <div className="mg2-banner mg2-t-err" role="alert"><AlertTriangle size={18} aria-hidden="true" /><span style={{ flex: 1, color: "var(--text)" }}>{failure}</span></div>}
        <Field label={t("acct.c.f.customer")}>
          {(a) => <select {...a} className="mg2-select" value={customerId} onChange={(e) => { setCustomerId(e.target.value); setError("") }}>
            {owing.map((c) => <option key={c.id} value={c.id}>{c.name} · {formatCurrency(c.balance)}</option>)}
          </select>}
        </Field>
        <Field label={t("acct.f.amount")} help={t("acct.f.amount_max", { amount: formatCurrency(balance) })} error={error || undefined}>
          {(a) => <span className="mg2-money"><span className="mg2-adorn">$</span><input {...a} type="number" min="0" step="0.01" inputMode="decimal" dir="ltr" value={amount} onChange={(e) => { setAmount(e.target.value); setError("") }} /></span>}
        </Field>
        <div className="mg2-actions">
          <button type="button" className="mg2-btn" onClick={() => { setAmount(full); setError("") }}>{over ? t("acct.record_instead", { amount: formatCurrency(balance) }) : t("acct.full_balance", { amount: formatCurrency(balance) })}</button>
        </div>
        <div>
          <span className="mg2-label" id="cust-pay-method">{t("acct.f.method")}</span>
          <div className="mg2-seg" role="radiogroup" aria-labelledby="cust-pay-method" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(112px, 1fr))" }}>
            {METHODS.map((m) => (
              <label key={m}><input type="radio" name="cust-pay-method" checked={method === m} onChange={() => setMethod(m)} /><CheckCircle2 size={14} className="mg2-chk" aria-hidden="true" />{t(`acct.pay.${METHOD_KEY[m]}`)}</label>
            ))}
          </div>
        </div>
        <Field label={t("acct.f.reference")}>{(a) => <input {...a} className="mg2-input" value={reference} onChange={(e) => setReference(e.target.value)} />}</Field>
        <p className="mg2-cap" style={{ margin: 0, display: "flex", gap: 6, alignItems: "center" }}><Info size={14} aria-hidden="true" />{t("acct.c.pay_note")}</p>
        <button type="submit" hidden />
      </form>
    </Drawer>
  )
}
