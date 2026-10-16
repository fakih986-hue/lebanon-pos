import { useState } from "react"
import { Link } from "react-router"
import { Archive, ArchiveRestore, CheckCircle2, ClipboardList, PackagePlus, Pencil, SlidersHorizontal, Star, Trash2 } from "lucide-react"
import { useI18n } from "@lebanonpos/shared"

import ConfirmDialog from "../../../../components/ConfirmDialog"
import { formatCurrency, formatNumber } from "../../lib/currency"
import { daysToExpiry, expiryTone } from "../../lib/lotTrace"
import type { InventoryBatch } from "../../services/inventoryBatch.service"
import {
  archiveProduct, deleteProduct, getProductHistory, productHasHistory, restoreProduct, toggleProductFavorite,
} from "../../services/product.service"
import { showToast } from "../../services/toast.service"
import type { Product } from "../../types/product"
import { Badge, Drawer, ExpiryChip, StatTile } from "./BackOffice"

/** Product details (§8 Lots): on hand, reorder, average cost, lots first-expiry-first, stock vs lots, actions. */
export default function ProductDetailsDrawer({ product, products, lots, canManage, canReceive, onClose, onEdit, onOpenLot }: {
  product: Product; products: Product[]; lots: InventoryBatch[]; canManage: boolean; canReceive: boolean
  onClose: () => void; onEdit: () => void; onOpenLot: (lotId: string) => void
}) {
  const { t, locale } = useI18n()
  const [confirm, setConfirm] = useState<null | "delete">(null)
  const history = getProductHistory(product.id)
  const variants = products.filter((p) => p.parentId === product.id)
  const hasHistory = productHasHistory(history) || variants.some((v) => productHasHistory(getProductHistory(v.id)))
  // First-expiry-first; lots without expiry last, oldest received first.
  const sorted = [...lots].sort((a, b) => (a.expiryDate ?? "9999").localeCompare(b.expiryDate ?? "9999") || a.receivedAt.localeCompare(b.receivedAt))
  const inLots = lots.reduce((s, b) => s + b.quantityRemaining, 0)
  const lotValue = lots.reduce((s, b) => s + b.quantityRemaining * b.unitCost, 0)
  const avgCost = inLots > 0 ? lotValue / inLots : product.cost
  const untracked = product.stock - inLots
  const date = (iso: string) => new Intl.DateTimeFormat(locale === "ar" ? "ar-LB" : "en-GB", { day: "2-digit", month: "short" }).format(new Date(iso))
  const parent = product.parentId ? products.find((p) => p.id === product.parentId) : undefined

  function act(fn: () => void, ok: string) {
    try { fn(); showToast(ok) } catch (err) { showToast(String((err as Error)?.message ?? err), "error") }
  }

  return (
    <>
      <Drawer open title={product.name} onClose={onClose}
        subtitle={<>
          <span className="num" dir="ltr">{product.barcode || t("inv.no_barcode")}</span>
          {(product.barcodeAliases ?? []).length > 0 && <> · {t("inv.aliases_list", { list: (product.barcodeAliases ?? []).join(", ") })}</>}
          {" · "}{product.category}{product.supplierName ? ` · ${product.supplierName}` : ""}
        </>}
        footer={<>
          <button type="button" className="mg2-btn mg2-btn-primary" onClick={onEdit} disabled={!canManage} data-autofocus><Pencil size={16} />{t("inv.edit")}</button>
          {canReceive && <Link className="mg2-btn" style={{ textDecoration: "none" }} to={`/products/new?barcode=${encodeURIComponent(product.barcode ?? "")}`}><PackagePlus size={16} />{t("inv.receive")}</Link>}
          <Link className="mg2-btn" style={{ textDecoration: "none" }} to={`/stock?view=Control&product=${product.id}`}><SlidersHorizontal size={16} />{t("inv.adjust_count")}</Link>
          <span style={{ flex: 1 }} />
          {product.archived
            ? <button type="button" className="mg2-btn" disabled={!canManage} onClick={() => act(() => restoreProduct(product.id), t("inv.restored", { name: product.name }))}><ArchiveRestore size={16} />{t("inv.restore")}</button>
            : <button type="button" className="mg2-btn" disabled={!canManage} onClick={() => act(() => archiveProduct(product.id), t("inv.archived_toast", { name: product.name }))}><Archive size={16} />{t("inv.archive")}</button>}
          {!hasHistory && <button type="button" className="mg2-btn mg2-btn-ghost" disabled={!canManage} onClick={() => setConfirm("delete")} aria-label={t("inv.delete")}><Trash2 size={16} /></button>}
        </>}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {product.archived && <Badge tone="muted">{t("inv.archived")}</Badge>}
          {parent && <Badge tone="info">{t("inv.variant_of", { name: parent.name })}</Badge>}
          {product.isParent && <Badge tone="info">{t("inv.variants_n", { n: variants.length })}</Badge>}
          <button type="button" className="mg2-chip" aria-pressed={!!product.favorite}
            onClick={() => act(() => toggleProductFavorite(product.id), product.favorite ? t("inv.unfavorited", { name: product.name }) : t("inv.favorited", { name: product.name }))}>
            <Star size={14} aria-hidden="true" />{t("inv.favorite")}
          </button>
        </div>

        <div className="mg2-stats">
          <StatTile label={t("inv.on_hand")} value={<span className="num">{product.isParent ? "—" : formatNumber(product.stock)}</span>} />
          <StatTile label={t("inv.reorder_at")} value={<span className="num">{formatNumber(product.reorderPoint ?? 10)}</span>} />
          <StatTile label={t("inv.avg_cost")} value={<span className="num">{formatCurrency(avgCost)}</span>} />
          <StatTile label={t("inv.field.price")} value={<span className="num">{formatCurrency(product.price)}</span>} />
        </div>

        {!product.isParent && (
          <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <h3 className="mg2-section-title">{t("inv.lots_fefo")}</h3>
            {sorted.length === 0 ? <p className="mg2-cap" style={{ margin: 0 }}>{product.stock > 0 ? t("inv.no_lots_untracked", { n: formatNumber(product.stock) }) : t("inv.no_lots")}</p> : sorted.map((b) => {
              const pct = b.initialQuantity > 0 ? Math.max(0, Math.min(100, (b.quantityRemaining / b.initialQuantity) * 100)) : 0
              const tone = expiryTone(daysToExpiry(b.expiryDate))
              return (
                <button key={b.id} type="button" className="mg2-lot" style={{ textAlign: "start", font: "inherit", color: "inherit", cursor: "pointer" }} onClick={() => onOpenLot(b.id)}
                  aria-label={t("inv.lot.open", { lot: b.batchNumber })}>
                  <div className="top">
                    <span><strong className="num" dir="ltr">{b.batchNumber}</strong> <span className="mg2-cap">{t("inv.lot.received_on", { date: date(b.receivedAt) })}{b.supplierName ? ` · ${b.supplierName}` : ""}</span></span>
                    <ExpiryChip date={b.expiryDate} />
                  </div>
                  <div className={`mg2-bar${tone === "err" ? " t-err" : tone === "warn" ? " t-warn" : ""}`} aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
                  <span className="mg2-cap" style={{ textAlign: "end" }}>{t("inv.lot.left_of", { left: formatNumber(b.quantityRemaining), of: formatNumber(b.initialQuantity) })} · {formatCurrency(b.unitCost)}</span>
                </button>
              )
            })}
            {Math.abs(untracked) < 0.0001
              ? <Badge tone="ok" icon={<CheckCircle2 size={14} aria-hidden="true" />}>{t("inv.stock_matches_lots")}</Badge>
              : sorted.length > 0 && <Badge tone="warn">{untracked > 0 ? t("inv.stock_more_than_lots", { stock: formatNumber(product.stock), lots: formatNumber(inLots), n: formatNumber(untracked) }) : t("inv.stock_less_than_lots", { stock: formatNumber(product.stock), lots: formatNumber(inLots) })}</Badge>}
          </section>
        )}

        <section style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <h3 className="mg2-section-title"><ClipboardList size={15} aria-hidden="true" style={{ verticalAlign: "-2px" }} /> {t("inv.history")}</h3>
          <p className="mg2-cap" style={{ margin: 0 }}>{t("inv.history_counts", { sales: history.sales, refunds: history.refunds, lots: history.lots, moves: history.movements })}</p>
          {hasHistory && <p className="mg2-cap" style={{ margin: 0 }}>{t("inv.archive_not_delete")}</p>}
        </section>
      </Drawer>
      <ConfirmDialog open={confirm === "delete"} title={t("inv.delete_title", { name: product.name })} confirmLabel={t("inv.delete")} confirmDestructive
        onCancel={() => setConfirm(null)}
        onConfirm={() => { setConfirm(null); act(() => { deleteProduct(product.id); onClose() }, t("inv.deleted", { name: product.name })) }}>
        <p>{t("inv.delete_text", { n: variants.length })}</p>
      </ConfirmDialog>
    </>
  )
}
