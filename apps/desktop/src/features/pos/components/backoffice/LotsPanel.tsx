import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router"
import { ArrowDown, ArrowUp, Search, SlidersHorizontal } from "lucide-react"
import { useI18n } from "@lebanonpos/shared"

import { formatCurrency, formatNumber } from "../../lib/currency"
import { daysToExpiry, expiryTone, lotTrace, type LotTraceKind } from "../../lib/lotTrace"
import { getInventoryBatches, getStockMovements, subscribeInventoryBatches, type InventoryBatch } from "../../services/inventoryBatch.service"
import { getRefunds, getSales, subscribeSales } from "../../services/sales.service"
import { Badge, Drawer, EmptyState, ExpiryChip, FilterChip, StatTile, type Tone } from "./BackOffice"

type LotView = "open" | "expiring" | "expired" | "depleted" | "all"
const LOT_VIEWS: LotView[] = ["open", "expiring", "expired", "depleted", "all"]
type SortKey = "expiry" | "received" | "product" | "remaining"
const TRACE_TONE: Record<LotTraceKind, Tone> = { received: "ok", opening: "ok", sale: "info", void: "muted", refund: "ok", adjustment: "warn", unattributed: "warn" }

function viewOf(b: InventoryBatch): Exclude<LotView, "all"> {
  if (b.quantityRemaining <= 0) return "depleted"
  const d = daysToExpiry(b.expiryDate)
  if (d !== null && d < 0) return "expired"
  if (d !== null && d <= 30) return "expiring"
  return "open"
}

/**
 * Lots (§8 Lots): every received lot with what is left, expiry, supplier and cost; first-expiry-first.
 * A lot opens its movement trace (lib/lotTrace) built from the sales, refunds and ledger records.
 */
export default function LotsPanel({ initialLotId, productFilter, canAdjust, onAdjustLot }: {
  initialLotId?: string | null; productFilter?: number | null; canAdjust: boolean
  onAdjustLot: (lot: InventoryBatch) => void
}) {
  const { t, locale } = useI18n()
  const [batches, setBatches] = useState<InventoryBatch[]>(() => getInventoryBatches())
  const [version, setVersion] = useState(0)
  const [view, setView] = useState<LotView>("open")
  const [search, setSearch] = useState("")
  const [supplier, setSupplier] = useState("")
  const [sortKey, setSortKey] = useState<SortKey>("expiry")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [openId, setOpenId] = useState<string | null>(initialLotId ?? null)
  useEffect(() => {
    const un1 = subscribeInventoryBatches(() => setBatches(getInventoryBatches()))
    const un2 = subscribeSales(() => setVersion((v) => v + 1))
    return () => { un1(); un2() }
  }, [])

  const date = (iso?: string) => (iso ? new Intl.DateTimeFormat(locale === "ar" ? "ar-LB" : "en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso)) : "—")
  const scoped = productFilter ? batches.filter((b) => b.productId === productFilter) : batches
  const counts = Object.fromEntries(LOT_VIEWS.map((v) => [v, v === "all" ? scoped.length : v === "open" ? scoped.filter((b) => b.quantityRemaining > 0).length : scoped.filter((b) => viewOf(b) === v).length])) as Record<LotView, number>
  const suppliers = Array.from(new Set(scoped.map((b) => b.supplierName).filter(Boolean))) as string[]
  const q = search.trim().toLowerCase()
  const list = scoped
    .filter((b) => (view === "all" ? true : view === "open" ? b.quantityRemaining > 0 : viewOf(b) === view))
    .filter((b) => !supplier || b.supplierName === supplier)
    .filter((b) => !q || [b.batchNumber, b.productName, b.barcode, b.supplierName, b.purchaseOrderNumber].some((v) => (v ?? "").toLowerCase().includes(q)))
    .sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1
      if (sortKey === "expiry") return dir * ((a.expiryDate ?? "9999").localeCompare(b.expiryDate ?? "9999") || a.receivedAt.localeCompare(b.receivedAt))
      if (sortKey === "received") return dir * a.receivedAt.localeCompare(b.receivedAt)
      if (sortKey === "product") return dir * a.productName.localeCompare(b.productName)
      return dir * (a.quantityRemaining - b.quantityRemaining)
    })
  const open = openId ? batches.find((b) => b.id === openId) : undefined
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const trace = useMemo(() => (open ? lotTrace(open, { sales: getSales(), refunds: getRefunds(), movements: getStockMovements() }) : null), [open, version, batches])

  const head = (k: SortKey, label: string, className?: string) => (
    <th className={className} aria-sort={sortKey === k ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="mg2-sort" onClick={() => { if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc")); else { setSortKey(k); setSortDir("asc") } }}>
        {label}{sortKey === k && (sortDir === "asc" ? <ArrowUp size={13} aria-hidden="true" /> : <ArrowDown size={13} aria-hidden="true" />)}
      </button>
    </th>
  )

  return (
    <>
      <div className="mg2-toolbar">
        <div className="mg2-search">
          <Search size={16} aria-hidden="true" />
          <input className="mg2-input" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("inv.lots.search")} aria-label={t("inv.lots.search")} />
        </div>
        {suppliers.length > 0 && (
          <select className="mg2-select" value={supplier} onChange={(e) => setSupplier(e.target.value)} aria-label={t("inv.field.supplier")}>
            <option value="">{t("inv.all_suppliers")}</option>
            {suppliers.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
      </div>
      <div className="mg2-chips" role="group" aria-label={t("inv.lots.views")} style={{ marginBottom: 12 }}>
        {LOT_VIEWS.map((v) => (
          <FilterChip key={v} pressed={view === v} onClick={() => setView(v)} label={t(`inv.lots.view.${v}`)} count={counts[v]} tone={v === "expiring" ? "warn" : v === "expired" ? "err" : undefined} />
        ))}
      </div>

      {batches.length === 0 ? (
        <div className="mg2-card"><EmptyState title={t("inv.lots.empty_title")} text={t("inv.lots.empty_text")}
          action={<Link to="/products/new" className="mg2-btn mg2-btn-primary" style={{ textDecoration: "none" }}>{t("inv.receive")}</Link>} /></div>
      ) : list.length === 0 ? (
        <div className="mg2-card"><EmptyState title={t("inv.lots.no_match")} action={<button type="button" className="mg2-btn" onClick={() => { setSearch(""); setSupplier(""); setView("all") }}>{t("inv.clear_filters")}</button>} /></div>
      ) : (
        <div className="mg2-table-wrap">
          <table className="mg2-table" aria-label={t("inv.lots.table")}>
            <thead>
              <tr>
                {head("product", t("inv.col.product"))}
                <th className="p3">{t("inv.lots.col.lot")}</th>
                {head("received", t("inv.lots.col.received"), "p3")}
                <th className="p4">{t("inv.field.supplier")}</th>
                {head("remaining", t("inv.lots.col.remaining"), "num")}
                {head("expiry", t("inv.lots.col.expiry"))}
                <th className="num p4">{t("inv.field.cost")}</th>
                <th className="num p4">{t("inv.lots.col.value")}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((b) => {
                const pct = b.initialQuantity > 0 ? Math.max(0, Math.min(100, (b.quantityRemaining / b.initialQuantity) * 100)) : 0
                const tone = expiryTone(daysToExpiry(b.expiryDate))
                return (
                  <tr key={b.id} aria-selected={openId === b.id} onClick={() => setOpenId(b.id)}>
                    <td>
                      <button type="button" className="mg2-sort" style={{ fontWeight: 600, textAlign: "start" }} onClick={(e) => { e.stopPropagation(); setOpenId(b.id) }}>{b.productName}</button>
                      <span className="sub code">{b.barcode}<span className="phone-only" dir="ltr" style={{ display: "block", whiteSpace: "nowrap" }}>{b.batchNumber}</span></span>
                    </td>
                    <td className="p3" style={{ whiteSpace: "nowrap" }}>
                      <span className="num" dir="ltr">{b.batchNumber}</span>
                      {b.purchaseOrderNumber && <span className="sub num" dir="ltr">{b.purchaseOrderNumber}</span>}
                    </td>
                    <td className="p3">{date(b.receivedAt)}</td>
                    <td className="p4" style={{ color: "var(--text-2)" }}>{b.supplierName || "—"}</td>
                    <td className="num" style={{ minWidth: 96 }}>
                      {t("inv.lot.left_of", { left: formatNumber(b.quantityRemaining), of: formatNumber(b.initialQuantity) })}
                      <div className={`mg2-bar${tone === "err" ? " t-err" : tone === "warn" ? " t-warn" : ""}`} style={{ marginTop: 6 }} aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
                    </td>
                    <td><ExpiryChip date={b.expiryDate} /></td>
                    <td className="num p4">{formatCurrency(b.unitCost)}</td>
                    <td className="num p4">{formatCurrency(b.quantityRemaining * b.unitCost)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {list.length > 0 && <p className="mg2-cap" style={{ marginTop: 8 }}>{t("inv.lots.footer", { n: list.length, units: formatNumber(list.reduce((s, b) => s + b.quantityRemaining, 0)), value: formatCurrency(list.reduce((s, b) => s + b.quantityRemaining * b.unitCost, 0)) })}</p>}

      {open && trace && (
        <Drawer open wide title={t("inv.lots.drawer_title", { lot: open.batchNumber, product: open.productName })} onClose={() => setOpenId(null)}
          subtitle={<>{t("inv.lot.received_on", { date: date(open.receivedAt) })}{open.supplierName ? ` · ${open.supplierName}` : ""}{open.purchaseOrderNumber ? ` · ${open.purchaseOrderNumber}` : ""}</>}
          footer={<>
            <button type="button" className="mg2-btn mg2-btn-primary" disabled={!canAdjust || open.quantityRemaining <= 0} onClick={() => { setOpenId(null); onAdjustLot(open) }} aria-describedby={canAdjust ? undefined : "inv-adjust-why"} data-autofocus><SlidersHorizontal size={16} />{t("inv.lots.adjust_lot")}</button>
            <Link className="mg2-btn" style={{ textDecoration: "none" }} to={`/products?product=${open.productId}`}>{t("inv.lots.view_product")}</Link>
            {!canAdjust && <span id="inv-adjust-why" className="mg2-cap">{t("inv.perm.adjust")}</span>}
          </>}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}><ExpiryChip date={open.expiryDate} /><Badge tone="muted">{t(`inv.lots.view.${viewOf(open)}`)}</Badge></div>
          <div className="mg2-stats">
            <StatTile label={t("inv.lots.col.remaining")} value={<span className="num">{formatNumber(open.quantityRemaining)}</span>} />
            <StatTile label={t("inv.lots.received_qty")} value={<span className="num">{formatNumber(open.initialQuantity)}</span>} />
            <StatTile label={t("inv.field.cost")} value={<span className="num">{formatCurrency(open.unitCost)}</span>} />
            <StatTile label={t("inv.lots.col.value")} value={<span className="num">{formatCurrency(open.quantityRemaining * open.unitCost)}</span>} />
          </div>
          <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <h3 className="mg2-section-title">{t("inv.lots.trace")}</h3>
            <div className="mg2-table-wrap">
              <table className="mg2-table" aria-label={t("inv.lots.trace")}>
                <thead><tr><th>{t("inv.lots.col.when")}</th><th>{t("inv.lots.col.what")}</th><th>{t("inv.lots.col.ref")}</th><th className="num">{t("inv.lots.col.qty")}</th><th className="num">{t("inv.lots.col.balance")}</th></tr></thead>
                <tbody>
                  {trace.entries.map((e, i) => (
                    <tr key={i} style={{ cursor: "default" }}>
                      <td style={{ color: "var(--text-2)" }}>{e.at ? date(e.at) : t("inv.lots.time_unknown")}</td>
                      <td><Badge tone={TRACE_TONE[e.kind]}>{t(`inv.lots.kind.${e.kind}`)}</Badge></td>
                      <td><span className="num" dir="ltr">{e.reference || "—"}</span>{e.note && <span className="sub">{e.note}</span>}</td>
                      <td className="num" style={{ color: e.quantity < 0 ? "var(--v2-err)" : "var(--v2-ok)" }}>{e.quantity > 0 ? "+" : "−"}{formatNumber(Math.abs(e.quantity))}</td>
                      <td className="num">{formatNumber(e.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {trace.unattributed !== 0 && <p className="mg2-cap" style={{ margin: 0 }}>{t("inv.lots.unattributed_help")}</p>}
          </section>
        </Drawer>
      )}
    </>
  )
}
