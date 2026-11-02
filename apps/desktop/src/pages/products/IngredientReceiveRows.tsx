import { Plus, Trash2 } from "lucide-react"
import { useI18n } from "@lebanonpos/shared"

import { Badge } from "../../features/pos/components/backoffice/BackOffice"
import { PURCHASE_UNITS, asStockUnit, type PurchaseUnit } from "../../features/pos/lib/cafeMenu"
import { formatCurrency, formatNumber } from "../../features/pos/lib/currency"
import { formatUnitCost } from "../../features/pos/lib/cost"
import { createRow, ingredientRowPlan, isBlankRow, rowProblems, type BatchRow, type RowProblem } from "../../features/pos/lib/receiveRows"
import type { Product } from "../../features/pos/types/product"

/**
 * Café batch — ingredients and supplies on the Receive page (no barcode): bought in purchase units (2 kg of beans,
 * 3 L of milk, 4 packs of 50 cups) at the invoice's actual price per purchase unit. The stock quantity (in grams,
 * millilitres or units) and the valuation per stock unit are previewed before saving and derived exactly; the
 * invoice price is kept as stated. These rows are saved with the rest of the delivery (same submission, same
 * recovery journal, per-row results).
 */
export default function IngredientReceiveRows({ rows, products, problemKey, costRequired, onAdd, onUpdate, onRemove }: {
  rows: BatchRow[]
  products: Product[]
  problemKey: Record<RowProblem, string>
  costRequired: boolean
  onAdd: (row: BatchRow) => void
  onUpdate: (id: string, patch: Partial<BatchRow>) => void
  onRemove: (id: string) => void
}) {
  const { t } = useI18n()
  // stock items without a barcode (ingredients first); packaged goods are received by scanning
  const choices = products.filter((p) => !p.archived && !p.isParent && (p.stockPolicy ?? "tracked") === "tracked" && (p.sellable === false || !p.barcode))
    .sort((a, b) => Number(a.sellable !== false) - Number(b.sellable !== false) || a.name.localeCompare(b.name))
  const choose = (r: BatchRow, id: number) => {
    const p = products.find((x) => x.id === id)
    if (!p) { onUpdate(r.id, { ingredientProductId: undefined }); return }
    const unit = asStockUnit(p.stockUnit)
    onUpdate(r.id, { ingredientProductId: p.id, name: p.name, category: p.category, stockUnit: unit, purchaseUnit: p.purchaseUnit ?? unit, packSize: p.purchaseUnit === "pack" ? Number(p.unitsPerPurchase) || undefined : undefined })
  }
  const numOrUndefined = (v: string) => (v.trim() === "" ? undefined : Number.isFinite(Number(v)) ? Number(v) : undefined)

  return (
    <section aria-labelledby="rcv-ingredients" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid var(--border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <h3 id="rcv-ingredients" className="mg2-sub" style={{ margin: 0, fontSize: 15 }}>{t("inv.rcv.ing.title")}</h3>
        <button type="button" className="mg2-btn" style={{ minHeight: 44 }} disabled={choices.length === 0}
          onClick={() => onAdd(createRow({ mode: "ingredient", decisionConfirmed: true, purchaseQuantity: undefined }))}><Plus size={16} />{t("inv.rcv.ing.add")}</button>
      </div>
      {choices.length === 0 && <p className="mg2-cap" style={{ margin: 0 }}>{t("inv.rcv.ing.none")}</p>}
      {rows.map((r) => {
        const plan = ingredientRowPlan(r)
        const { problems } = isBlankRow(r) ? { problems: [] as RowProblem[] } : rowProblems(r, undefined, { costRequired })
        const unit = asStockUnit(r.stockUnit)
        const label = r.name || t("inv.rcv.ing.row")
        return (
          <fieldset key={r.id} data-row={r.id} className="mg2-card" style={{ margin: 0, padding: 10, display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,150px),1fr))", alignItems: "end", borderColor: problems.length ? "var(--v2-err)" : undefined }}>
            <legend className="sr-only">{label}</legend>
            <label className="mg2-field"><span className="lbl">{t("inv.rcv.ing.item")}</span>
              <select className="mg2-select" value={r.ingredientProductId ?? ""} onChange={(e) => choose(r, Number(e.target.value))} aria-invalid={problems.includes("missing_target") || undefined}>
                <option value="">{t("inv.rcv.ing.choose")}</option>
                {choices.map((p) => <option key={p.id} value={p.id}>{p.name} ({t(`unit.${asStockUnit(p.stockUnit)}`)})</option>)}
              </select>
            </label>
            <label className="mg2-field"><span className="lbl">{t("inv.rcv.ing.quantity")}</span>
              <input className="mg2-input num" inputMode="decimal" dir="ltr" value={r.purchaseQuantity ?? ""} onChange={(e) => onUpdate(r.id, { purchaseQuantity: numOrUndefined(e.target.value) })} aria-invalid={problems.includes("missing_quantity") || undefined} aria-label={`${t("inv.rcv.ing.quantity")} — ${label}`} />
            </label>
            <label className="mg2-field"><span className="lbl">{t("inv.rcv.ing.unit")}</span>
              <select className="mg2-select" value={r.purchaseUnit ?? unit} onChange={(e) => onUpdate(r.id, { purchaseUnit: e.target.value as PurchaseUnit })} aria-invalid={problems.includes("unit_incompatible") || undefined}>
                {PURCHASE_UNITS[unit].map((u) => <option key={u} value={u}>{t(`unit.${u}`)}</option>)}
              </select>
            </label>
            {r.purchaseUnit === "pack" && (
              <label className="mg2-field"><span className="lbl">{t("inv.field.pack_size")}</span>
                <input className="mg2-input num" type="number" min="1" step="1" dir="ltr" value={r.packSize ?? ""} onChange={(e) => onUpdate(r.id, { packSize: numOrUndefined(e.target.value) })} aria-invalid={problems.includes("pack_size") || undefined} />
              </label>
            )}
            <label className="mg2-field"><span className="lbl">{t("inv.rcv.ing.price", { unit: t(`unit.${r.purchaseUnit ?? unit}`) })}</span>
              <span className="mg2-money"><span className="mg2-adorn">$</span><input type="number" min="0" step="0.0001" inputMode="decimal" dir="ltr" value={r.purchasePrice ?? ""} onChange={(e) => onUpdate(r.id, { purchasePrice: numOrUndefined(e.target.value) })} aria-invalid={problems.includes("cost_missing") || problems.includes("negative_money") || undefined} aria-label={`${t("inv.rcv.ing.price", { unit: t(`unit.${r.purchaseUnit ?? unit}`) })} — ${label}`} /></span>
            </label>
            <label className="mg2-field"><span className="lbl">{t("inv.rcv.col.expiry")}</span>
              <input className="mg2-input" type="date" dir="ltr" value={r.expiryDate} onChange={(e) => onUpdate(r.id, { expiryDate: e.target.value })} />
            </label>
            <label className="mg2-field"><span className="lbl">{t("inv.rcv.ing.reference")}</span>
              <input className="mg2-input" value={r.supplierReference ?? ""} onChange={(e) => onUpdate(r.id, { supplierReference: e.target.value })} />
            </label>
            <div style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "space-between", gridColumn: "1 / -1", flexWrap: "wrap" }}>
              <span className="mg2-cap" role="status" aria-live="polite">
                {plan.ok && r.ingredientProductId
                  ? t("inv.rcv.ing.preview", { qty: formatNumber(plan.stockMilli / 1000), unit: t(`unit.${unit}`), value: plan.unitCostTT !== null ? `${formatUnitCost(plan.unitCostTT / 10000, t("pos.not_available"))}/${t(`unit.${unit}`)}` : t("pos.not_available"), total: r.purchasePrice !== undefined && r.purchaseQuantity ? formatCurrency(Math.round(r.purchaseQuantity * r.purchasePrice * 10000) / 10000) : t("pos.not_available") })
                  : null}
                {problems.map((p) => <Badge key={p} tone="err">{t(problemKey[p])}</Badge>)}
                {r.saveError ? <Badge tone="err">{r.saveError}</Badge> : null}
              </span>
              <button type="button" className="mg2-btn mg2-btn-ghost" style={{ width: 40, padding: 0 }} onClick={() => onRemove(r.id)} aria-label={t("inv.rcv.remove_row")}><Trash2 size={15} /></button>
            </div>
          </fieldset>
        )
      })}
    </section>
  )
}
