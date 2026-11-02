import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft } from "lucide-react"
import { useI18n } from "@lebanonpos/shared"

import { defaultSelection, groupBounds, selectable, type Selection } from "../lib/cafeMenu"
import { formatNumber } from "../lib/currency"
import { groupsForProduct, recordWaste } from "../services/menu.service"
import { userCan } from "../services/security.service"
import type { Product } from "../types/product"

/**
 * Café batch — record a remake or waste: a drink (its recipe's ingredients, with the options it was made with) or a
 * stock item itself (milk spilled, beans expired) in its unit. A stock event, never a sale or a refund: the server
 * takes it from the lots once. Whether it waits for a manager's review is the server's decision (the connection's or the
 * staff session's permission, by store mode), so the wording below never promises either outcome.
 */
export default function WasteDialog({ products, onDone, onCancel }: { products: Product[]; onDone: (message: string) => void; onCancel: () => void }) {
  const { t, locale } = useI18n()
  const items = useMemo(() => products.filter((p) => !p.archived && !p.isParent && (p.stockPolicy === "recipe" || (p.stockPolicy ?? "tracked") === "tracked"))
    .sort((a, b) => Number(b.stockPolicy === "recipe") - Number(a.stockPolicy === "recipe") || a.name.localeCompare(b.name)), [products])
  const [productId, setProductId] = useState<number>(items[0]?.id ?? 0)
  const product = items.find((p) => p.id === productId)
  const groups = product ? groupsForProduct(product) : []
  const [selection, setSelection] = useState<Selection[]>(() => (product ? defaultSelection(groupsForProduct(product)) : []))
  const [quantity, setQuantity] = useState("1")
  const [reason, setReason] = useState<"Remake" | "Waste">("Remake")
  const [note, setNote] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const label = (x: { name: string; nameAr?: string }) => (locale === "ar" && x.nameAr ? x.nameAr : x.name)
  useEffect(() => { const id = window.setTimeout(() => dialogRef.current?.querySelector<HTMLElement>("select, input")?.focus(), 30); return () => window.clearTimeout(id) }, [])
  const isDrink = product?.stockPolicy === "recipe"
  const unit = isDrink ? t("waste.drinks") : t(`unit.${product?.stockUnit ?? "unit"}`)

  async function submit() {
    if (!product || busy) return
    const q = Number(quantity)
    if (!Number.isFinite(q) || q <= 0) { setError(t("waste.err.quantity")); return }
    if (note.trim().length < 3) { setError(t("waste.err.note")); return }
    setBusy(true)
    try {
      await recordWaste({ product, quantity: q, reason, note, selection: isDrink ? selection : undefined })
      onDone(t(userCan("inventory.adjust") ? "waste.recorded" : "waste.recorded_review", { qty: formatNumber(q), name: product.name }))
    } catch (err) { setError(String((err as Error)?.message ?? err)) } finally { setBusy(false) }
  }

  return (
    <div className="mg2 fixed inset-0 z-[200] grid place-items-center p-4" style={{ background: "rgba(5,7,13,.78)" }} onMouseDown={(e) => { if (e.target === e.currentTarget) e.preventDefault() }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="mg2-waste-title" tabIndex={-1} className="w-full outline-none"
        style={{ maxWidth: 520, maxHeight: "calc(100dvh - 32px)", overflowY: "auto", borderRadius: 16, background: "var(--surface)", border: "1px solid var(--border)", padding: "clamp(16px, 4vw, 24px)", display: "flex", flexDirection: "column", gap: 14 }}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.preventDefault(); onCancel() }
          if (e.key === "Tab") {
            const f = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])") ?? [])]
            if (!f.length) return
            const first = f[0], last = f[f.length - 1], active = document.activeElement
            if (e.shiftKey && (active === first || active === dialogRef.current)) { e.preventDefault(); last.focus() }
            else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
          }
        }}>
        <h2 id="mg2-waste-title" className="mg2-sub" style={{ margin: 0, fontSize: 20 }}>{t("waste.title")}</h2>
        <p className="mg2-cap" style={{ margin: 0 }}>{t("waste.help")}</p>
        <label className="mg2-field"><span className="lbl">{t("waste.item")}</span>
          <select className="mg2-select" value={productId} onChange={(e) => { const id = Number(e.target.value); setProductId(id); const p = items.find((x) => x.id === id); setSelection(p ? defaultSelection(groupsForProduct(p)) : []) }}>
            {items.map((p) => <option key={p.id} value={p.id}>{p.name}{p.stockPolicy === "recipe" ? ` · ${t("inv.kind.recipe")}` : ` (${t(`unit.${p.stockUnit ?? "unit"}`)})`}</option>)}
          </select>
        </label>
        {isDrink && groups.map((g) => {
          const single = groupBounds(g).max === 1
          return (
            <fieldset key={g.id} className="rounded-xl p-3" style={{ border: "1px solid var(--border)", margin: 0 }}>
              <legend className="px-1 text-[13px] font-semibold">{label(g)}</legend>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {g.options.filter(selectable).map((o) => {
                  const chosen = selection.some((s) => s.groupId === g.id && s.optionId === o.id)
                  return (
                    <label key={o.id} className="mg2-btn" style={{ minHeight: 44, borderColor: chosen ? "var(--brand)" : undefined }}>
                      <input type={single ? "radio" : "checkbox"} name={`w-${g.id}`} checked={chosen} onChange={() => setSelection((cur) => single ? [...cur.filter((s) => s.groupId !== g.id), { groupId: g.id, optionId: o.id }] : chosen ? cur.filter((s) => !(s.groupId === g.id && s.optionId === o.id)) : [...cur, { groupId: g.id, optionId: o.id }])} />
                      {label(o)}
                    </label>
                  )
                })}
              </div>
            </fieldset>
          )
        })}
        <div className="mg2-grid2">
          <label className="mg2-field"><span className="lbl">{t("waste.quantity", { unit })}</span>
            <input className="mg2-input num" inputMode="decimal" dir="ltr" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </label>
          <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
            <legend className="lbl mg2-cap">{t("waste.reason")}</legend>
            {(["Remake", "Waste"] as const).map((r) => (
              <label key={r} style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 36 }}>
                <input type="radio" name="waste-reason" checked={reason === r} onChange={() => setReason(r)} />{t(`waste.reason.${r}`)}
              </label>
            ))}
          </fieldset>
        </div>
        <label className="mg2-field"><span className="lbl">{t("waste.note")}</span>
          <input className="mg2-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("waste.note_hint")} />
        </label>
        {!userCan("inventory.adjust") && <p className="mg2-cap" role="note" style={{ margin: 0 }}>{t("waste.needs_review")}</p>}
        {error && <div role="alert" className="mg2-t-err mg2-banner text-[14px] font-semibold">{error}</div>}
        <div className="flex flex-wrap gap-3">
          <button type="button" className="mg2-btn" style={{ minHeight: 52 }} onClick={onCancel}><ArrowLeft size={18} className="mg2-dir" />{t("pos.v2.back")}</button>
          <button type="button" className="mg2-btn mg2-btn-primary" style={{ minHeight: 52, flex: "1 1 200px" }} disabled={!product || busy} onClick={() => void submit()}>{t("waste.record")}</button>
        </div>
      </div>
    </div>
  )
}
