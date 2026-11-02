import { useEffect, useState } from "react"
import { Plus, Save } from "lucide-react"
import { useI18n } from "@lebanonpos/shared"

import { checkGroup, type ModifierGroup, type ModifierOption } from "../../lib/cafeMenu"
import { formatCurrency } from "../../lib/currency"
import { getModifierGroups, MenuSetupError, newModifierGroup, newOptionId, saveModifierGroup, subscribeMenu } from "../../services/menu.service"
import { userCan } from "../../services/security.service"
import { showToast } from "../../services/toast.service"
import { Drawer, Field } from "./BackOffice"

/**
 * Café batch — the menu's option groups (size, milk, sugar, shots, ice): names in English and Arabic, required or
 * optional, how many may be chosen, defaults, price changes, availability. Options are archived, never deleted (old
 * sales keep showing what was bought). Managing staff only (inventory.manage); the server checks the same.
 */
export default function MenuOptionsDrawer({ onClose }: { onClose: () => void }) {
  const { t, locale } = useI18n()
  const [groups, setGroups] = useState<ModifierGroup[]>(() => getModifierGroups())
  const [draft, setDraft] = useState<ModifierGroup | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const canManage = userCan("inventory.manage")
  useEffect(() => subscribeMenu(() => setGroups(getModifierGroups())), [])

  const setOption = (i: number, patch: Partial<ModifierOption>) => setDraft((d) => d && { ...d, options: d.options.map((o, j) => (j === i ? { ...o, ...patch } : o)) })
  function save() {
    if (!draft) return
    const p = checkGroup(draft)
    setProblems(p)
    if (p.length) return
    try {
      saveModifierGroup(draft)
      showToast(t("menu.saved", { name: draft.name }))
      setDraft(null)
    } catch (err) {
      if (err instanceof MenuSetupError) setProblems(err.codes.split(","))
      else showToast(String((err as Error)?.message ?? err), "error")
    }
  }
  const live = (draft?.options ?? []).filter((o) => !o.archived)

  return (
    <Drawer open wide title={draft ? (draft.name || t("menu.new_group")) : t("menu.title")} subtitle={t("menu.subtitle")} onClose={draft ? () => { setDraft(null); setProblems([]) } : onClose}
      footer={draft ? <>
        <button type="button" className="mg2-btn mg2-btn-primary" onClick={save} disabled={!canManage}><Save size={16} />{t("menu.save_group")}</button>
        <button type="button" className="mg2-btn mg2-btn-ghost" onClick={() => { setDraft(null); setProblems([]) }}>{t("inv.cancel")}</button>
        {problems.length > 0 && <span className="mg2-cap" role="alert" style={{ color: "var(--v2-err)" }}>{problems.map((p) => t(`menu.err.${p}`)).join(" · ")}</span>}
      </> : <>
        <button type="button" className="mg2-btn mg2-btn-primary" onClick={() => setDraft(newModifierGroup())} disabled={!canManage}><Plus size={16} />{t("menu.new_group")}</button>
        <button type="button" className="mg2-btn mg2-btn-ghost" onClick={onClose}>{t("inv.close")}</button>
      </>}>
      {!draft ? (
        groups.length === 0 ? <p className="mg2-cap" style={{ margin: 0 }}>{t("menu.empty")}</p> : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {groups.map((g) => (
              <li key={g.id} className="mg2-card" style={{ padding: 12, display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", opacity: g.archived ? 0.6 : 1 }}>
                <span style={{ minWidth: 0 }}>
                  <strong>{g.name}</strong>{g.nameAr ? <span className="mg2-cap" dir="rtl"> · {g.nameAr}</span> : null}
                  <span className="mg2-cap" style={{ display: "block" }}>
                    {g.archived ? t("menu.archived") : `${g.required ? t("pos.mod.required") : t("pos.mod.optional")} · ${t("menu.choose_n", { min: g.minSelect ?? 0, max: g.maxSelect ?? 1 })}`}
                    {" · "}{g.options.filter((o) => !o.archived).map((o) => `${o.name}${Number(o.priceDelta) ? ` \u2066${Number(o.priceDelta) > 0 ? "+" : "−"}${formatCurrency(Math.abs(Number(o.priceDelta)))}\u2069` : ""}`).join(locale === "ar" ? "\u060c " : ", ")}
                  </span>
                </span>
                <button type="button" className="mg2-btn" disabled={!canManage} onClick={() => setDraft(JSON.parse(JSON.stringify(g)))}>{t("inv.edit")}</button>
              </li>
            ))}
          </ul>
        )
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="mg2-grid2">
            <Field label={t("menu.group_name")} error={problems.includes("name") ? t("menu.err.name") : undefined}>{(a) => <input {...a} className="mg2-input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} data-autofocus />}</Field>
            <Field label={t("menu.group_name_ar")}>{(a) => <input {...a} className="mg2-input" dir="rtl" value={draft.nameAr ?? ""} onChange={(e) => setDraft({ ...draft, nameAr: e.target.value })} />}</Field>
            <Field label={t("menu.min")} error={problems.includes("min-max") ? t("menu.err.min-max") : undefined}>{(a) => <input {...a} className="mg2-input num" type="number" min="0" step="1" dir="ltr" value={draft.minSelect ?? 0} onChange={(e) => setDraft({ ...draft, minSelect: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />}</Field>
            <Field label={t("menu.max")} help={t("menu.max_help")}>{(a) => <input {...a} className="mg2-input num" type="number" min="1" step="1" dir="ltr" value={draft.maxSelect ?? 1} onChange={(e) => setDraft({ ...draft, maxSelect: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />}</Field>
          </div>
          <label style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 600 }}>
            <input type="checkbox" className="mg2-check" checked={!!draft.required} onChange={(e) => setDraft({ ...draft, required: e.target.checked })} />{t("menu.required")}
          </label>
          <label style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 600 }}>
            <input type="checkbox" className="mg2-check" checked={!!draft.archived} onChange={(e) => setDraft({ ...draft, archived: e.target.checked })} />{t("menu.archive_group")}
          </label>
          <fieldset className="mg2-card" style={{ padding: 12, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            <legend className="mg2-cap" style={{ padding: "0 4px" }}>{t("menu.options")} ({live.length})</legend>
            {draft.options.map((o, i) => (
              <div key={o.id} style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,130px),1fr))", alignItems: "end", opacity: o.archived ? 0.55 : 1 }}>
                <Field label={t("menu.option_name")} error={problems.includes("option-name") && !o.name.trim() ? t("menu.err.option-name") : undefined}>{(a) => <input {...a} className="mg2-input" value={o.name} onChange={(e) => setOption(i, { name: e.target.value })} />}</Field>
                <Field label={t("menu.option_name_ar")}>{(a) => <input {...a} className="mg2-input" dir="rtl" value={o.nameAr ?? ""} onChange={(e) => setOption(i, { nameAr: e.target.value })} />}</Field>
                <Field label={t("menu.price_delta")} help={t("menu.price_delta_help")}>{(a) => <span className="mg2-money"><span className="mg2-adorn">$</span><input {...a} type="number" step="0.01" inputMode="decimal" dir="ltr" value={String(o.priceDelta)} onChange={(e) => setOption(i, { priceDelta: e.target.value })} /></span>}</Field>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, paddingBottom: 8 }}>
                  <label className="mg2-cap" style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" className="mg2-check" checked={!!o.isDefault} onChange={(e) => setOption(i, { isDefault: e.target.checked })} />{t("menu.default")}</label>
                  <label className="mg2-cap" style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" className="mg2-check" checked={o.available !== false} onChange={(e) => setOption(i, { available: e.target.checked })} />{t("menu.available")}</label>
                  <label className="mg2-cap" style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" className="mg2-check" checked={!!o.archived} onChange={(e) => setOption(i, { archived: e.target.checked })} />{t("menu.archived")}</label>
                </div>
              </div>
            ))}
            <button type="button" className="mg2-btn" style={{ alignSelf: "flex-start" }} onClick={() => setDraft({ ...draft, options: [...draft.options, { id: newOptionId(), name: "", nameAr: "", priceDelta: 0, sortOrder: draft.options.length }] })}><Plus size={16} />{t("menu.add_option")}</button>
          </fieldset>
        </div>
      )}
    </Drawer>
  )
}
