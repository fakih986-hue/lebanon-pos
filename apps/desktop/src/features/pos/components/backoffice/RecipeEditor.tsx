import { useMemo, useState } from "react"
import { Plus, Save, Trash2 } from "lucide-react"
import { useI18n } from "@lebanonpos/shared"

import { checkRecipe, defaultSelection, type RecipeLine } from "../../lib/cafeMenu"
import { formatNumber } from "../../lib/currency"
import { describeServing, groupsForProduct, MenuSetupError, recipeOf, revisionsOf, saveRecipe, servingsFor } from "../../services/menu.service"
import { userCan } from "../../services/security.service"
import { showToast } from "../../services/toast.service"
import type { Product } from "../../types/product"
import { Field } from "./BackOffice"

type Row = { ingredientSyncId: string; quantity: string; when: string[]; unless: string[] }

/**
 * Café batch — a drink's recipe: per serving, each ingredient in its stock unit (at most 3 decimals), optionally only
 * with some options ("when": size Large, oat milk, extra shot) or not with others ("unless": milk unless oat), and
 * the yield. Saving adds a new revision and makes it current; earlier revisions stay (drinks already sold keep the
 * one they were made with). Managing staff only.
 */
export default function RecipeEditor({ product, products }: { product: Product; products: Product[] }) {
  const { t } = useI18n()
  const current = recipeOf(product)
  const [rows, setRows] = useState<Row[]>(() => (current?.lines ?? []).map((l) => ({ ingredientSyncId: l.ingredientSyncId, quantity: String(l.quantity), when: l.when ?? [], unless: l.unless ?? [] })))
  const [yieldN, setYieldN] = useState(String(current?.yield ?? 1))
  const [note, setNote] = useState("")
  const [problems, setProblems] = useState<Array<{ line: number; code: string }>>([])
  const ingredients = products.filter((p) => !p.archived && (p.stockPolicy ?? "tracked") === "tracked" && p.syncId && p.syncId !== product.syncId)
  const options = groupsForProduct(product).flatMap((g) => g.options.filter((o) => !o.archived).map((o) => ({ id: o.id, label: `${g.name}: ${o.name}` })))
  const unitOf = (sid: string) => products.find((p) => p.syncId === sid)?.stockUnit ?? "unit"
  const nameOf = (sid: string) => products.find((p) => p.syncId === sid)?.name ?? sid
  const preview = useMemo(() => current ? describeServing(current, defaultSelection(groupsForProduct(product)).map((s) => s.optionId)) : [], [current, product])
  const servings = servingsFor(product)
  const canManage = userCan("inventory.manage")
  const set = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const lineProblem = (i: number) => problems.find((p) => p.line === i)?.code

  function save() {
    const lines: RecipeLine[] = rows.map((r) => ({ ingredientSyncId: r.ingredientSyncId, quantity: r.quantity.trim(), ...(r.when.length ? { when: r.when } : {}), ...(r.unless.length ? { unless: r.unless } : {}) }))
    const isIngredient = (sid: string) => ingredients.some((p) => p.syncId === sid)
    const p = checkRecipe({ id: "draft", yield: Number(yieldN), lines }, isIngredient, product.syncId)
    setProblems(p)
    if (p.length) return
    try {
      saveRecipe(product, { yield: Number(yieldN), lines, note })
      showToast(t("recipe.saved", { name: product.name }))
      setNote("")
    } catch (err) {
      if (err instanceof MenuSetupError) setProblems(err.codes.split(",").map((code) => ({ line: -1, code })))
      else showToast(String((err as Error)?.message ?? err), "error")
    }
  }

  return (
    <section className="mg2-card" aria-labelledby="recipe-title" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <h3 id="recipe-title" className="mg2-sub" style={{ margin: 0, fontSize: 16 }}>{t("recipe.title")}</h3>
        <span className="mg2-cap">
          {current ? t("recipe.current", { n: revisionsOf(product).length }) : t("recipe.none")}
          {servings !== null ? ` · ${servings === 0 ? t("recipe.cannot_make") : Number.isFinite(servings) ? t("recipe.servings", { n: formatNumber(servings) }) : ""}` : ""}
        </span>
      </div>
      {preview.length > 0 && <p className="mg2-cap" style={{ margin: 0 }}>{t("recipe.default_serving")}: {preview.map((c) => `${formatNumber(c.quantity)} ${t(`unit.${unitOf(c.ingredientSyncId)}`)} ${nameOf(c.ingredientSyncId)}`).join(" · ")}</p>}
      {ingredients.length === 0 && <p className="mg2-cap" role="status" style={{ margin: 0 }}>{t("recipe.no_ingredients")}</p>}
      {rows.map((r, i) => (
        <div key={i} className="mg2-card" style={{ padding: 10, display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,160px),1fr))", alignItems: "end" }}>
          <Field label={t("recipe.ingredient")} error={lineProblem(i) === "ingredient" || lineProblem(i) === "self" ? t(`recipe.err.${lineProblem(i)}`) : undefined}>{(a) => (
            <select {...a} className="mg2-select" value={r.ingredientSyncId} onChange={(e) => set(i, { ingredientSyncId: e.target.value })}>
              <option value="">{t("recipe.choose_ingredient")}</option>
              {ingredients.map((p) => <option key={p.syncId!} value={p.syncId!}>{p.name} ({t(`unit.${p.stockUnit ?? "unit"}`)})</option>)}
            </select>
          )}</Field>
          <Field label={t("recipe.quantity_in", { unit: t(`unit.${unitOf(r.ingredientSyncId)}`) })} error={lineProblem(i) === "quantity" || lineProblem(i) === "precision" ? t(`recipe.err.${lineProblem(i)}`) : undefined}>{(a) => (
            <input {...a} className="mg2-input num" inputMode="decimal" dir="ltr" value={r.quantity} onChange={(e) => set(i, { quantity: e.target.value })} />
          )}</Field>
          {options.length > 0 && <Field label={t("recipe.only_with")} help={t("recipe.only_with_help")}>{(a) => (
            <select {...a} multiple className="mg2-select" style={{ minHeight: 72 }} value={r.when} onChange={(e) => set(i, { when: [...e.target.selectedOptions].map((o) => o.value) })}>
              {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          )}</Field>}
          {options.length > 0 && <Field label={t("recipe.not_with")} help={t("recipe.not_with_help")}>{(a) => (
            <select {...a} multiple className="mg2-select" style={{ minHeight: 72 }} value={r.unless} onChange={(e) => set(i, { unless: [...e.target.selectedOptions].map((o) => o.value) })}>
              {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          )}</Field>}
          <button type="button" className="mg2-btn mg2-btn-ghost" style={{ width: 44, padding: 0, justifySelf: "start" }} onClick={() => setRows((x) => x.filter((_, j) => j !== i))} aria-label={t("recipe.remove_line", { n: i + 1 })}><Trash2 size={15} /></button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
        <button type="button" className="mg2-btn" disabled={ingredients.length === 0} onClick={() => setRows((x) => [...x, { ingredientSyncId: ingredients[0]?.syncId ?? "", quantity: "", when: [], unless: [] }])}><Plus size={16} />{t("recipe.add_line")}</button>
        <Field label={t("recipe.yield")} help={t("recipe.yield_help")} error={problems.some((p) => p.code === "yield") ? t("recipe.err.yield") : undefined}>{(a) => <input {...a} className="mg2-input num" type="number" min="1" step="1" dir="ltr" style={{ width: 96 }} value={yieldN} onChange={(e) => setYieldN(e.target.value)} />}</Field>
        <Field label={t("recipe.note")}>{(a) => <input {...a} className="mg2-input" value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      </div>
      {problems.some((p) => p.code === "no-lines") && <p role="alert" className="mg2-cap" style={{ color: "var(--v2-err)", margin: 0 }}>{t("recipe.err.no-lines")}</p>}
      <button type="button" className="mg2-btn mg2-btn-primary" style={{ alignSelf: "flex-start" }} disabled={!canManage} onClick={save}><Save size={16} />{t("recipe.save")}</button>
    </section>
  )
}
