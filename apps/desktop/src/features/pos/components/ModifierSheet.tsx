import { useLayoutEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, Minus, Plus } from "lucide-react"
import { useI18n } from "@lebanonpos/shared"

import { formatCurrency } from "../lib/currency"
import { checkSelection, groupBounds, priceWithModifiers, selectable, snapshotModifiers, type ModifierGroup, type Selection } from "../lib/cafeMenu"
import type { Product } from "../types/product"

/**
 * Café batch — choose a drink's options before it goes in the cart (full register and Simple POS).
 * Required groups first in the product's order, defaults pre-selected, the price change shown before adding. One
 * choice = radio group, several = checkboxes (min/max enforced). Options without stock for the drink are shown
 * unavailable. Enter adds (when complete), Escape cancels: the cart is untouched and the caller returns focus.
 * Focus stays inside (Tab / Shift+Tab wrap); everything behind is inert while open.
 */
export default function ModifierSheet({ product, groups, initial, mode, servingsWith, onConfirm, onCancel }: {
  product: Product
  groups: ModifierGroup[]
  initial: { selection: Selection[]; note: string; quantity: number }
  mode: "add" | "edit"
  /** Servings the ingredients in stock allow with these options (null = not a recipe drink). */
  servingsWith: (optionIds: string[]) => number | null
  onConfirm: (result: { selection: Selection[]; note: string; quantity: number }) => void
  onCancel: () => void
}) {
  const { t, locale } = useI18n()
  const [selection, setSelection] = useState<Selection[]>(initial.selection)
  const [note, setNote] = useState(initial.note)
  const [quantity, setQuantity] = useState(Math.max(1, initial.quantity))
  const [attempted, setAttempted] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const label = (x: { name: string; nameAr?: string }) => (locale === "ar" && x.nameAr ? x.nameAr : x.name)

  // a layout effect: the page behind is made usable again as the sheet closes, before the caller puts focus back in it
  // (a passive cleanup could run after that, and focus on a still-inert scan field is silently dropped)
  useLayoutEffect(() => {
    const marked: Element[] = []
    for (let node: Element | null = overlayRef.current; node && node !== document.body; node = node.parentElement) {
      for (const sibling of Array.from(node.parentElement?.children ?? [])) {
        if (sibling !== node && !sibling.hasAttribute("inert") && !(sibling instanceof HTMLScriptElement)) { sibling.setAttribute("inert", ""); marked.push(sibling) }
      }
    }
    const id = window.setTimeout(() => dialogRef.current?.querySelector<HTMLElement>("input:not([disabled])")?.focus() ?? dialogRef.current?.focus(), 30)
    return () => { window.clearTimeout(id); for (const el of marked) el.removeAttribute("inert") }
  }, [])

  const problems = useMemo(() => checkSelection(groups, selection), [groups, selection])
  const mods = useMemo(() => snapshotModifiers(groups, selection), [groups, selection])
  const unitPrice = priceWithModifiers(product.price, mods)
  const delta = Math.round((unitPrice - Number(product.price)) * 10000) / 10000
  const chosenIds = mods.map((m) => m.optionId)
  const servings = servingsWith(chosenIds)
  const short = servings !== null && servings < quantity
  const complete = problems.length === 0 && !short

  const isChosen = (g: string, o: string) => selection.some((s) => s.groupId === g && s.optionId === o)
  function toggle(g: ModifierGroup, optionId: string) {
    const { max } = groupBounds(g)
    setSelection((cur) => {
      const mine = cur.filter((s) => s.groupId === g.id)
      if (max === 1) return [...cur.filter((s) => s.groupId !== g.id), { groupId: g.id, optionId }]
      if (mine.some((s) => s.optionId === optionId)) return cur.filter((s) => !(s.groupId === g.id && s.optionId === optionId))
      if (mine.length >= max) return cur
      return [...cur, { groupId: g.id, optionId }]
    })
  }
  function confirm() {
    if (!complete) {
      setAttempted(true)
      const first = problems[0]?.groupId
      const el = first ? dialogRef.current?.querySelector<HTMLElement>(`[data-group="${first}"] input:not([disabled])`) : null
      el?.focus()
      return
    }
    onConfirm({ selection, note: note.trim(), quantity })
  }
  const problemOf = (groupId: string) => problems.find((p) => p.groupId === groupId)
  const optionUnavailable = (g: ModifierGroup, optionId: string) => {
    // with this option instead of (single) or besides (multiple) the current choice: can a serving still be made?
    const ids = groupBounds(g).max === 1 ? [...chosenIds.filter((id) => !(g.options ?? []).some((o) => o.id === id)), optionId] : [...new Set([...chosenIds, optionId])]
    const n = servingsWith(ids)
    return n !== null && n < 1
  }

  return (
    <div ref={overlayRef} className="mg2 fixed inset-0 z-[200] grid place-items-center p-4" style={{ background: "rgba(5,7,13,.78)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) e.preventDefault() }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="mg2-mod-title" aria-describedby="mg2-mod-price" tabIndex={-1}
        className="w-full outline-none"
        style={{ maxWidth: 560, maxHeight: "calc(100dvh - 32px)", overflowY: "auto", borderRadius: 16, background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "0 16px 40px rgba(0,0,0,.45)", padding: "clamp(16px, 4vw, 24px)", display: "flex", flexDirection: "column", gap: 16 }}
        onKeyDown={(e) => {
          if (e.key === "Tab") {
            const focusables = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])") ?? [])]
            if (focusables.length === 0) { e.preventDefault(); return }
            const first = focusables[0], last = focusables[focusables.length - 1]
            const active = document.activeElement as HTMLElement | null
            if (e.shiftKey && (active === first || active === dialogRef.current)) { e.preventDefault(); last.focus() }
            else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
            return
          }
          if (e.key === "Escape") { e.preventDefault(); onCancel(); return }
          if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); if (!e.repeat) confirm() }
        }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="mg2-mod-title" className="mg2-sub" style={{ margin: 0, fontSize: 20, lineHeight: "28px", color: "var(--text)" }}>{label(product)}</h2>
            <p className="mg2-cap" style={{ margin: 0 }}>{mode === "edit" ? t("pos.mod.edit_hint") : t("pos.mod.choose_hint")}</p>
          </div>
          <span className="num font-semibold" style={{ color: "var(--text-2)" }}>{formatCurrency(Number(product.price))}</span>
        </div>

        {groups.map((g) => {
          const { min, max } = groupBounds(g)
          const single = max === 1
          const problem = attempted ? problemOf(g.id) : undefined
          const live = [...(g.options ?? [])].filter((o) => !o.archived).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
          return (
            <fieldset key={g.id} data-group={g.id} className="rounded-xl p-3" style={{ border: `1px solid ${problem ? "var(--rose)" : "var(--border)"}`, background: "var(--surface-2)", margin: 0 }}
              aria-describedby={problem ? `mg2-mod-err-${g.id}` : undefined}>
              <legend className="px-1 text-[14px] font-semibold" style={{ color: "var(--text)" }}>
                {label(g)}{" "}
                <span className="mg2-cap" style={{ color: g.required || min > 0 ? "var(--brand)" : "var(--text-3)" }}>
                  {g.required || min > 0 ? t("pos.mod.required") : t("pos.mod.optional")}{max > 1 ? ` · ${t("pos.mod.up_to", { n: max })}` : ""}
                </span>
              </legend>
              <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,150px),1fr))" }} role={single ? "radiogroup" : "group"} aria-label={label(g)}>
                {live.map((o) => {
                  const chosen = isChosen(g.id, o.id)
                  const blocked = !selectable(o) || (!chosen && optionUnavailable(g, o.id))
                  const d = Number(o.priceDelta) || 0
                  return (
                    <label key={o.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-3"
                      style={{ minHeight: 48, border: `1px solid ${chosen ? "var(--brand)" : "var(--border)"}`, background: chosen ? "var(--brand-soft)" : "var(--surface)", opacity: blocked ? 0.5 : 1, cursor: blocked ? "not-allowed" : "pointer" }}>
                      <input type={single ? "radio" : "checkbox"} name={`mod-${g.id}`} checked={chosen} disabled={blocked}
                        onChange={() => toggle(g, o.id)} className="h-4 w-4 shrink-0" style={{ accentColor: "var(--brand)" }} />
                      <span className="min-w-0 flex-1 text-[14px] font-medium" style={{ color: "var(--text)" }}>{label(o)}</span>
                      <span className="num text-[12px] font-semibold" dir="ltr" style={{ color: "var(--text-3)" }}>
                        {blocked ? t("pos.mod.unavailable") : d === 0 ? "" : `${d > 0 ? "+" : "−"}${formatCurrency(Math.abs(d))}`}
                      </span>
                    </label>
                  )
                })}
              </div>
              {problem && (
                <p id={`mg2-mod-err-${g.id}`} role="alert" className="mt-2 text-[13px] font-semibold" style={{ color: "var(--rose)", margin: "8px 0 0" }}>
                  {problem.code === "too-many" ? t("pos.mod.err_too_many", { n: max }) : problem.code === "too-few" ? t("pos.mod.err_too_few", { n: min }) : t("pos.mod.err_required", { group: label(g) })}
                </p>
              )}
            </fieldset>
          )
        })}

        <label className="block">
          <span className="mg2-cap">{t("pos.mod.note")}</span>
          <textarea value={note} maxLength={200} rows={2} onChange={(e) => setNote(e.target.value)} placeholder={t("pos.mod.note_hint")}
            className="mt-1 w-full rounded-lg px-3 py-2 text-[14px] outline-none" style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)" }} />
        </label>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2" role="group" aria-label={t("pos.mod.quantity")}>
            <button type="button" className="mg2-btn" style={{ minHeight: 48, minWidth: 48 }} aria-label={t("pos.mod.less")} disabled={quantity <= 1} onClick={() => setQuantity((q) => Math.max(1, q - 1))}><Minus size={18} /></button>
            <span className="num text-[18px] font-semibold" aria-live="polite" style={{ minWidth: 32, textAlign: "center", color: "var(--text)" }}>{quantity}</span>
            <button type="button" className="mg2-btn" style={{ minHeight: 48, minWidth: 48 }} aria-label={t("pos.mod.more")} onClick={() => setQuantity((q) => q + 1)}><Plus size={18} /></button>
          </div>
          <p id="mg2-mod-price" className="num text-[14px]" style={{ margin: 0, color: "var(--text-2)" }} aria-live="polite">
            {delta !== 0 ? t("pos.mod.price_line", { base: formatCurrency(Number(product.price)), delta: `\u2066${delta > 0 ? "+" : "−"}${formatCurrency(Math.abs(delta))}\u2069`, each: formatCurrency(unitPrice) }) : t("pos.mod.price_each", { each: formatCurrency(unitPrice) })}
          </p>
        </div>

        {short && <div role="alert" className="mg2-t-err mg2-banner text-[14px] font-semibold">{servings === 0 ? t("pos.mod.cannot_make") : t("pos.mod.only_n", { n: servings ?? 0 })}</div>}

        {/* stays in view while the groups scroll (a phone shows only a few groups): the price and Add are always reachable */}
        <div className="flex gap-3" style={{ position: "sticky", bottom: "calc(-1 * clamp(16px, 4vw, 24px))", margin: "0 calc(-1 * clamp(16px, 4vw, 24px)) calc(-1 * clamp(16px, 4vw, 24px))", padding: "12px clamp(16px, 4vw, 24px) clamp(16px, 4vw, 24px)", background: "var(--surface)", borderTop: "1px solid var(--border)" }}>
          <button type="button" className="mg2-btn" style={{ flex: "0 0 auto", minHeight: 56 }} onClick={onCancel}>
            <ArrowLeft size={18} className="mg2-dir" />{t("pos.v2.back")} <span className="mg2-kbd hidden sm:inline">Esc</span>
          </button>
          <button type="button" className="mg2-pay" style={{ flex: "1 1 0", minWidth: 0, minHeight: 56, width: "auto", fontSize: 17, justifyContent: "space-between", opacity: complete ? 1 : 0.7 }}
            aria-disabled={!complete} onClick={confirm}>
            <span>{mode === "edit" ? t("pos.mod.update") : t("pos.mod.add")}</span>
            <span className="num" style={{ whiteSpace: "nowrap" }}>{formatCurrency(unitPrice * quantity)}</span>
            <span className="mg2-kbd hidden sm:inline">Enter</span>
          </button>
        </div>
      </div>
    </div>
  )
}
