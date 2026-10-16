import { useEffect, useState } from "react"
import { AlertTriangle } from "lucide-react"
import { useI18n } from "@lebanonpos/shared"

import { formatCurrency, formatLbpCurrency, usdToLbp } from "../lib/currency"
import { getMoneyConflicts, settleMoneyConflict, type MoneyConflict } from "../services/refundConflict.service"
import { getAllRefunds } from "../services/sales.service"
import { userCan } from "../services/security.service"
import { subscribeSync } from "../services/sync.service"
import { showToast } from "../services/toast.service"

/**
 * REFUND-INTEGRITY-1 — refunds/voids issued offline that the server rejected.
 * They are never reversed or hidden automatically: each stays here until a
 * manager settles it as a loss (recorded as an expense) or as recovered.
 */
export default function MoneyConflictsPanel() {
  const { t } = useI18n()
  const [conflicts, setConflicts] = useState<MoneyConflict[]>(() => getMoneyConflicts())
  const [openId, setOpenId] = useState<string | null>(null)
  const [resolution, setResolution] = useState<"loss" | "recovered">("loss")
  const [note, setNote] = useState("")
  const [error, setError] = useState("")
  const canSettle = userCan("accounting.manage")

  useEffect(() => subscribeSync(() => setConflicts(getMoneyConflicts())), [])

  if (conflicts.length === 0) return null

  function rateFor(conflict: MoneyConflict) {
    const refund = conflict.refundId ? getAllRefunds().find((r) => r.id === conflict.refundId) : undefined
    return refund?.exchangeRate ?? null
  }

  function codeLabel(code: string) {
    const key = `pos.conflict.code_${code}`
    const label = t(key)
    return label === key ? t("pos.conflict.code_REJECTED") : label
  }

  function confirm(conflict: MoneyConflict) {
    setError("")
    try {
      settleMoneyConflict({ opId: conflict.opId, resolution, note })
      showToast(t("pos.conflict.settled", { refund: conflict.refundNumber ?? conflict.saleNumber }), "success")
      setOpenId(null)
      setNote("")
      setConflicts(getMoneyConflicts())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <section
      aria-labelledby="money-conflicts-title"
      className="mt-4 rounded-[var(--radius-lg)] p-4"
      style={{ background: "var(--surface)", border: "1px solid var(--st-warn)", boxShadow: "var(--elev-1)" }}
    >
      <header className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius)]" style={{ background: "var(--st-warn-soft)", color: "var(--st-warn-text)" }}>
          <AlertTriangle size={18} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 id="money-conflicts-title" className="font-semibold" style={{ color: "var(--text)", fontSize: "var(--fs-subhead)" }}>
            {t("pos.conflict.title")} <span style={{ color: "var(--st-warn-text)" }}>({conflicts.length})</span>
          </h2>
          <p className="mt-1" style={{ color: "var(--text-2)", fontSize: "var(--fs-meta)" }}>{t("pos.conflict.subtitle")}</p>
        </div>
      </header>

      <ul className="mt-3 space-y-2">
        {conflicts.map((conflict) => {
          const rate = rateFor(conflict)
          const open = openId === conflict.opId
          return (
            <li key={conflict.opId} className="rounded-[var(--radius)] p-3" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold" style={{ color: "var(--text)", fontSize: "var(--fs-body)" }}>
                    {conflict.kind === "refund" ? t("pos.conflict.kind_refund") : t("pos.conflict.kind_void")}{" "}
                    {conflict.refundNumber ?? ""} · {conflict.saleNumber}
                  </p>
                  <p style={{ color: "var(--text-3)", fontSize: "var(--fs-meta)" }}>
                    {t("pos.conflict.reason")}: {codeLabel(conflict.code)}
                    {conflict.issuedAt ? ` · ${t("pos.conflict.issued", { date: new Date(conflict.issuedAt).toLocaleString(), cashier: conflict.cashier ?? "—" })}` : ""}
                  </p>
                  <p style={{ color: "var(--st-warn-text)", fontSize: "var(--fs-meta)" }}>{t("pos.conflict.counted_locally")}</p>
                </div>
                <div className="text-end">
                  <p className="money font-semibold tabular-nums" style={{ color: "var(--text)", fontSize: "var(--fs-subhead)" }}>{formatCurrency(conflict.amount)}</p>
                  <p className="tabular-nums" style={{ color: "var(--text-3)", fontSize: "var(--fs-meta)" }}>
                    {rate ? formatLbpCurrency(usdToLbp(conflict.amount, rate)) : t("pos.refund.rate_unavailable")}
                  </p>
                </div>
              </div>

              {!open ? (
                <div className="mt-2 flex items-center justify-end gap-2">
                  {!canSettle && <span style={{ color: "var(--text-3)", fontSize: "var(--fs-meta)" }}>{t("pos.conflict.needs_manager")}</span>}
                  <button type="button" className="btn btn-default btn-sm" disabled={!canSettle} onClick={() => { setOpenId(conflict.opId); setResolution("loss"); setNote(""); setError("") }}>
                    {t("pos.conflict.settle")}
                  </button>
                </div>
              ) : (
                <fieldset className="mt-3 space-y-2">
                  <legend className="sr-only">{t("pos.conflict.settle")}</legend>
                  {(["loss", "recovered"] as const).map((option) => (
                    <label key={option} className="flex cursor-pointer items-start gap-2 rounded-[var(--radius)] p-2" style={{ background: resolution === option ? "var(--brand-soft)" : "transparent", border: `1px solid ${resolution === option ? "var(--brand-border)" : "var(--border)"}` }}>
                      <input type="radio" name={`resolution-${conflict.opId}`} checked={resolution === option} onChange={() => setResolution(option)} className="mt-1" />
                      <span>
                        <span className="block font-medium" style={{ color: "var(--text)", fontSize: "var(--fs-body)" }}>{t(`pos.conflict.${option}`)}</span>
                        <span className="block" style={{ color: "var(--text-3)", fontSize: "var(--fs-meta)" }}>
                          {option === "loss" ? t("pos.conflict.loss_hint", { amount: formatCurrency(conflict.amount) }) : t("pos.conflict.recovered_hint")}
                        </span>
                      </span>
                    </label>
                  ))}
                  <label className="block">
                    <span className="mb-1 block font-medium" style={{ color: "var(--text-2)", fontSize: "var(--fs-meta)" }}>{t("pos.conflict.note")}</span>
                    <textarea className="input w-full" rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder={t("pos.conflict.note_placeholder")} />
                  </label>
                  {error && <p role="alert" style={{ color: "var(--st-err-text)", fontSize: "var(--fs-meta)" }}>{error}</p>}
                  <div className="flex justify-end gap-2">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpenId(null)}>{t("pos.conflict.cancel")}</button>
                    <button type="button" className="btn btn-primary btn-sm" disabled={note.trim().length < 3} onClick={() => confirm(conflict)}>{t("pos.conflict.confirm")}</button>
                  </div>
                </fieldset>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
