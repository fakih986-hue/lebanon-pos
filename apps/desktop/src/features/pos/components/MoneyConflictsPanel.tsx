import { useEffect, useState } from "react"
import { AlertTriangle } from "lucide-react"
import { useI18n } from "@lebanonpos/shared"

import { formatCurrency, formatLbpCurrency, usdToLbp } from "../lib/currency"
import {
  allowedResolutions, getMoneyConflicts, getPendingSettlements, planSettlement, retrySettlementEntry, settleMoneyConflict,
  type MoneyConflict, type RecoveryMethod, type SettlementResolution,
} from "../services/refundConflict.service"
import { getAllRefunds } from "../services/sales.service"
import { userCan } from "../services/security.service"
import { subscribeSync } from "../services/sync.service"
import { showToast } from "../services/toast.service"

const RECOVERY_METHODS: RecoveryMethod[] = ["Cash", "Bank Transfer", "Card", "Wallet"]

/**
 * REFUND-INTEGRITY-1 — refunds/voids issued offline that the server rejected,
 * and settlement entries the server rejected. Never reversed or hidden
 * automatically: a manager settles each one with a note (and, for money that
 * came back, its method and reference). The panel states up front exactly
 * what will be recorded, so the money is counted once.
 */
export default function MoneyConflictsPanel() {
  const { t } = useI18n()
  const [conflicts, setConflicts] = useState<MoneyConflict[]>(() => getMoneyConflicts())
  const [pending, setPending] = useState(() => getPendingSettlements())
  const [openId, setOpenId] = useState<string | null>(null)
  const [resolution, setResolution] = useState<SettlementResolution>("loss")
  const [recoveryMethod, setRecoveryMethod] = useState<RecoveryMethod>("Cash")
  const [reference, setReference] = useState("")
  const [note, setNote] = useState("")
  const [error, setError] = useState("")
  const canSettle = userCan("accounting.manage")

  const refresh = () => { setConflicts(getMoneyConflicts()); setPending(getPendingSettlements()) }
  useEffect(() => subscribeSync(refresh), [])

  if (conflicts.length === 0 && pending.length === 0) return null

  function rateFor(conflict: MoneyConflict) {
    const refund = conflict.refundId ? getAllRefunds().find((r) => r.id === conflict.refundId) : undefined
    return refund?.exchangeRate ?? null
  }
  function codeLabel(code: string) {
    const key = `pos.conflict.code_${code}`
    const label = t(key)
    return label === key ? t("pos.conflict.code_REJECTED") : label
  }
  function resolutionLabel(conflict: MoneyConflict, option: SettlementResolution) {
    const debt = conflict.method === "Debt_Credit" || conflict.method === "Debt"
    return t(debt ? `pos.conflict.debt_${option}` : `pos.conflict.${option}`)
  }
  /** Plain statement of what this resolution records, before the user confirms. */
  function consequence(conflict: MoneyConflict, option: SettlementResolution) {
    const entries = planSettlement(conflict, option, { method: recoveryMethod })
    const amount = formatCurrency(conflict.amount)
    if (entries.expenseId) return t("pos.conflict.records_expense", { amount })
    if (entries.debtCreditId) return t("pos.conflict.records_credit", { amount })
    if (entries.cashOutId && entries.cashInId) return t("pos.conflict.records_out_in", { amount })
    if (entries.cashOutId) return t("pos.conflict.records_out_only", { amount })
    if (option === "recovered") return t("pos.conflict.records_evidence_only")
    return t("pos.conflict.records_nothing")
  }
  function startSettling(conflict: MoneyConflict) {
    setOpenId(conflict.opId); setResolution(allowedResolutions(conflict)[0]); setRecoveryMethod("Cash")
    setReference(""); setNote(""); setError("")
  }
  function confirm(conflict: MoneyConflict) {
    setError("")
    try {
      settleMoneyConflict({
        opId: conflict.opId, resolution, note,
        ...(resolution === "recovered" ? { recovery: { method: recoveryMethod, reference } } : {}),
      })
      showToast(t("pos.conflict.settled", { refund: conflict.refundNumber ?? conflict.saleNumber }), "success")
      setOpenId(null)
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      refresh()
    }
  }
  const needsReference = resolution === "recovered"
  const canConfirm = note.trim().length >= 3 && (!needsReference || reference.trim().length >= 2)

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

      {pending.length > 0 && (
        <p role="status" className="mt-3" style={{ color: "var(--text-2)", fontSize: "var(--fs-meta)" }}>
          {t("pos.conflict.finishing", { count: pending.length })}
        </p>
      )}

      <ul className="mt-3 space-y-2">
        {conflicts.map((conflict) => {
          const rate = rateFor(conflict)
          const open = openId === conflict.opId
          const isEntry = conflict.kind === "settlement_entry"
          return (
            <li key={conflict.opId} className="rounded-[var(--radius)] p-3" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold" style={{ color: "var(--text)", fontSize: "var(--fs-body)" }}>
                    {t(`pos.conflict.kind_${conflict.kind}`)} {conflict.refundNumber ?? ""}{conflict.saleNumber ? ` · ${conflict.saleNumber}` : ""}
                  </p>
                  <p style={{ color: "var(--text-3)", fontSize: "var(--fs-meta)" }}>
                    {t("pos.conflict.reason")}: {isEntry ? conflict.message : codeLabel(conflict.code)}
                    {conflict.issuedAt ? ` · ${t("pos.conflict.issued", { date: new Date(conflict.issuedAt).toLocaleString(), cashier: conflict.cashier ?? "—" })}` : ""}
                  </p>
                  {!isEntry && <p style={{ color: "var(--st-warn-text)", fontSize: "var(--fs-meta)" }}>{t("pos.conflict.counted_locally")}</p>}
                </div>
                <div className="text-end">
                  <p className="money font-semibold tabular-nums" style={{ color: "var(--text)", fontSize: "var(--fs-subhead)" }}>{formatCurrency(conflict.amount)}</p>
                  {!isEntry && (
                    <p className="tabular-nums" style={{ color: "var(--text-3)", fontSize: "var(--fs-meta)" }}>
                      {rate ? formatLbpCurrency(usdToLbp(conflict.amount, rate)) : t("pos.refund.rate_unavailable")}
                    </p>
                  )}
                </div>
              </div>

              {isEntry ? (
                <div className="mt-2 flex items-center justify-end gap-2">
                  <span style={{ color: "var(--text-3)", fontSize: "var(--fs-meta)" }}>{t("pos.conflict.entry_hint")}</span>
                  <button type="button" className="btn btn-default btn-sm" onClick={() => { retrySettlementEntry(conflict.opId); refresh() }}>{t("pos.conflict.retry")}</button>
                </div>
              ) : !open ? (
                <div className="mt-2 flex items-center justify-end gap-2">
                  {!canSettle && <span style={{ color: "var(--text-3)", fontSize: "var(--fs-meta)" }}>{t("pos.conflict.needs_manager")}</span>}
                  <button type="button" className="btn btn-default btn-sm" disabled={!canSettle} onClick={() => startSettling(conflict)}>
                    {t("pos.conflict.settle")}
                  </button>
                </div>
              ) : (
                <fieldset className="mt-3 space-y-2">
                  <legend className="sr-only">{t("pos.conflict.settle")}</legend>
                  {allowedResolutions(conflict).map((option) => (
                    <label key={option} className="flex cursor-pointer items-start gap-2 rounded-[var(--radius)] p-2" style={{ background: resolution === option ? "var(--brand-soft)" : "transparent", border: `1px solid ${resolution === option ? "var(--brand-border)" : "var(--border)"}` }}>
                      <input type="radio" name={`resolution-${conflict.opId}`} checked={resolution === option} onChange={() => setResolution(option)} className="mt-1" />
                      <span>
                        <span className="block font-medium" style={{ color: "var(--text)", fontSize: "var(--fs-body)" }}>{resolutionLabel(conflict, option)}</span>
                        <span className="block" style={{ color: "var(--text-3)", fontSize: "var(--fs-meta)" }}>{consequence(conflict, option)}</span>
                      </span>
                    </label>
                  ))}
                  {needsReference && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-1 block font-medium" style={{ color: "var(--text-2)", fontSize: "var(--fs-meta)" }}>{t("pos.conflict.recovery_method")}</span>
                        <select className="input w-full" value={recoveryMethod} onChange={(event) => setRecoveryMethod(event.target.value as RecoveryMethod)}>
                          {RECOVERY_METHODS.map((m) => <option key={m} value={m}>{t(`pos.conflict.method_${m.replace(" ", "_")}`)}</option>)}
                        </select>
                      </label>
                      <label className="block">
                        <span className="mb-1 block font-medium" style={{ color: "var(--text-2)", fontSize: "var(--fs-meta)" }}>{t("pos.conflict.recovery_reference")}</span>
                        <input className="input w-full" value={reference} onChange={(event) => setReference(event.target.value)} placeholder={t("pos.conflict.recovery_reference_placeholder")} />
                      </label>
                    </div>
                  )}
                  <label className="block">
                    <span className="mb-1 block font-medium" style={{ color: "var(--text-2)", fontSize: "var(--fs-meta)" }}>{t("pos.conflict.note")}</span>
                    <textarea className="input w-full" rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder={t("pos.conflict.note_placeholder")} />
                  </label>
                  {error && <p role="alert" style={{ color: "var(--st-err-text)", fontSize: "var(--fs-meta)" }}>{error}</p>}
                  <div className="flex justify-end gap-2">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpenId(null)}>{t("pos.conflict.cancel")}</button>
                    <button type="button" className="btn btn-primary btn-sm" disabled={!canConfirm} onClick={() => confirm(conflict)}>{t("pos.conflict.confirm")}</button>
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
