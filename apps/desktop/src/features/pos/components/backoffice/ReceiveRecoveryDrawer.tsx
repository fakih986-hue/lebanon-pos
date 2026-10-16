import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router"
import { CheckCircle2, LoaderCircle, RotateCcw, ShieldAlert } from "lucide-react"
import { useI18n } from "@lebanonpos/shared"

import { Badge, Drawer, type Tone } from "./BackOffice"
import { formatCurrency, formatNumber } from "../../lib/currency"
import {
  closeReceiveSubmissionByHand, completeReceiveSubmission, inspectReceiveSubmission, ReceiveRecoveryBlockedError,
  undoReceiveSubmission, type EffectState, type OperationEffect, type RecoveryReason, type SubmissionEffects,
} from "../../services/receiveRecovery.service"
import { showToast } from "../../services/toast.service"

// An interrupted delivery save, as found on this device: what reached stock, lots, movements, the
// purchase order, the payment and the sync queue, and the three ways to settle it. Each action is
// permission-checked and audited by receiveRecovery.service; an unsafe one shows why instead.
const STATE_TONE: Record<EffectState, Tone> = { applied: "ok", missing: "warn", unknown: "err", "n/a": "muted" }
const OP_TONE: Record<OperationEffect["state"], Tone> = { queued: "info", sent: "ok", failed: "err", rejected: "err", not_in_queue: "warn" }

export type RecoverySettled = "completed" | "undone" | "closed"

export default function ReceiveRecoveryDrawer({ submissionId, onClose, onSettled }: {
  submissionId: string | null
  onClose: () => void
  onSettled: (id: string, how: RecoverySettled) => void
}) {
  const { t, locale } = useI18n()
  const [fx, setFx] = useState<SubmissionEffects | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState<"" | "complete" | "undo" | "close">("")
  const [note, setNote] = useState("")
  const [blocked, setBlocked] = useState<RecoveryReason[]>([])

  const refresh = useCallback(async () => {
    if (!submissionId) return
    try { setFx(await inspectReceiveSubmission(submissionId)); setError("") } catch (e) { setError(String((e as Error)?.message ?? e)) }
  }, [submissionId])
  // The page remounts this drawer per submission (key), so there is no state to reset here.
  useEffect(() => {
    if (!submissionId) return
    let alive = true
    inspectReceiveSubmission(submissionId).then(
      (found) => { if (alive) setFx(found) },
      (e) => { if (alive) setError(String((e as Error)?.message ?? e)) },
    )
    return () => { alive = false }
  }, [submissionId])

  const when = (iso?: string) => iso ? new Intl.DateTimeFormat(locale === "ar" ? "ar-LB" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : ""
  const reasonText = (r: RecoveryReason) => t(`inv.rcv.fx.r.${r.code}`, Object.fromEntries(Object.entries(r.params ?? {}).map(([k, v]) => [k, String(v)])))
  const state = (s: EffectState) => <Badge tone={STATE_TONE[s]}>{t(`inv.rcv.fx.s.${s === "n/a" ? "na" : s}`)}</Badge>

  async function run(kind: "complete" | "undo" | "close") {
    if (!submissionId || busy) return
    setBusy(kind); setBlocked([])
    try {
      if (kind === "complete") await completeReceiveSubmission(submissionId)
      else if (kind === "undo") await undoReceiveSubmission(submissionId)
      else await closeReceiveSubmissionByHand(submissionId, note)
      showToast(t(`inv.rcv.fx.done_${kind}`), "success")
      onSettled(submissionId, kind === "complete" ? "completed" : kind === "undo" ? "undone" : "closed")
    } catch (e) {
      if (e instanceof ReceiveRecoveryBlockedError) setBlocked(e.reasons)
      showToast(String((e as Error)?.message ?? e), "error")
      await refresh()
    } finally { setBusy("") }
  }

  const sub = fx?.submission
  return (
    <Drawer open={!!submissionId} wide title={t("inv.rcv.fx.title")} onClose={onClose}
      subtitle={sub ? t("inv.rcv.fx.subtitle", { time: when(sub.startedAt), n: sub.rowIds.length }) : undefined}>
      {/* Opens at the top (what was found), not on the close-by-hand note at the bottom. */}
      <div data-autofocus tabIndex={-1} style={{ outline: "none" }}>
      {error && <p className="mg2-banner mg2-t-err" role="alert">{error}</p>}
      {!fx ? (!error && <p className="mg2-cap"><LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> {t("inv.rcv.fx.loading")}</p>) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {sub?.failure && <p className="mg2-cap" style={{ margin: 0 }}>{t("inv.rcv.fx.failure", { reason: sub.failure })}</p>}

          <section aria-labelledby="fx-stock" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <h3 id="fx-stock" className="mg2-section-title">{t("inv.rcv.fx.stock_title")}</h3>
            <div className="mg2-table-wrap">
              <table className="mg2-table mg2-trace" aria-labelledby="fx-stock">
                <thead><tr>
                  <th>{t("inv.rcv.col.item")}</th><th className="num">{t("inv.rcv.col.qty")}</th>
                  <th>{t("inv.rcv.fx.col.stock")}</th><th>{t("inv.rcv.fx.col.lot")}</th><th className="p3">{t("inv.rcv.fx.col.movement")}</th>
                </tr></thead>
                <tbody>
                  {fx.rows.map((r) => (
                    <tr key={r.rowId} style={{ cursor: "default" }}>
                      <td>
                        <span style={{ fontWeight: 600 }}>{r.name}</span>
                        <span className="sub code">{r.barcode}</span>
                        {r.newProduct && <span className="sub">{t("inv.rcv.s.new")}</span>}
                        {r.accepted === false && <span className="sub">{t("inv.rcv.fx.rejected", { reason: r.reason ?? "" })}</span>}
                      </td>
                      <td className="num">{formatNumber(r.quantity)}</td>
                      <td>
                        {state(r.stock.state)}
                        {(r.stock.before != null || r.stock.now != null) && (
                          <span className="sub num" dir="ltr">{t("inv.rcv.fx.stock_line", { before: r.stock.before ?? "?", now: r.stock.now ?? "?", expected: r.stock.expected ?? "?" })}</span>
                        )}
                      </td>
                      <td>
                        {state(r.lot.state)}
                        {r.lot.state === "applied" && <span className="sub num" dir="ltr">{t("inv.lot.left_of", { left: formatNumber(r.lot.remaining ?? 0), of: formatNumber(r.lot.initial ?? 0) })}</span>}
                      </td>
                      <td className="p3">{state(r.movement.state)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="fx-supplier" style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <h3 id="fx-supplier" className="mg2-section-title" style={{ gridColumn: "1 / -1" }}>{t("inv.rcv.fx.supplier_title")}</h3>
            <div className="mg2-card mg2-card-body" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="mg2-label">{t("inv.rcv.fx.po")}</span>
              <span>{state(fx.purchaseOrder.state)} {fx.purchaseOrder.number && <span className="num" dir="ltr">{fx.purchaseOrder.number}</span>}</span>
              {fx.purchaseOrder.total != null && <span className="mg2-cap">{formatCurrency(fx.purchaseOrder.total)} · {fx.purchaseOrder.status} · {fx.purchaseOrder.paymentStatus}</span>}
            </div>
            <div className="mg2-card mg2-card-body" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="mg2-label">{t("inv.rcv.fx.payment")}</span>
              <span>{state(fx.payment.state)}</span>
              {fx.payment.amount != null && <span className="mg2-cap">{formatCurrency(fx.payment.amount)}{fx.payment.method ? ` · ${fx.payment.method}` : ""}</span>}
            </div>
          </section>

          <section aria-labelledby="fx-sync" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <h3 id="fx-sync" className="mg2-section-title">{t("inv.rcv.fx.sync_title")}</h3>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              {fx.operations.map((o) => (
                <li key={o.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <Badge tone={OP_TONE[o.state]}>{t(`inv.rcv.fx.op.${o.state}`)}</Badge>
                  <span>{o.label.startsWith("product:") ? t("inv.rcv.fx.opl.product", { name: o.label.slice(8) }) : t(`inv.rcv.fx.opl.${o.label}`)}</span>
                  {o.error && <span className="mg2-cap">{o.error}</span>}
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="fx-actions" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <h3 id="fx-actions" className="mg2-section-title">{t("inv.rcv.fx.actions_title")}</h3>
            {blocked.length > 0 && (
              <div className="mg2-banner mg2-t-err" role="alert" style={{ display: "block" }}>
                <strong>{t("inv.rcv.fx.blocked")}</strong>
                <ul style={{ margin: "6px 0 0", paddingInlineStart: 18 }}>{blocked.map((r, i) => <li key={i}>{reasonText(r)}</li>)}</ul>
              </div>
            )}
            <ActionCard
              title={t("inv.rcv.fx.complete")} text={t("inv.rcv.fx.complete_help")}
              safe={fx.complete.safe} allowed={fx.can.complete} reasons={fx.complete.reasons.map(reasonText)} noPermission={t("inv.rcv.fx.no_permission", { perm: t("pos.staff.permission_receive") })}
              button={<button type="button" className="mg2-btn mg2-btn-primary" disabled={!fx.complete.safe || !fx.can.complete || !!busy} aria-busy={busy === "complete" || undefined} onClick={() => void run("complete")}>
                {busy === "complete" ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}{t("inv.rcv.fx.complete")}
              </button>} />
            <ActionCard
              title={t("inv.rcv.fx.undo")} text={t("inv.rcv.fx.undo_help")}
              safe={fx.undo.safe} allowed={fx.can.undo} reasons={fx.undo.reasons.map(reasonText)} noPermission={t("inv.rcv.fx.no_permission", { perm: t("pos.staff.permission_adjust") })}
              button={<button type="button" className="mg2-btn" disabled={!fx.undo.safe || !fx.can.undo || !!busy} onClick={() => void run("undo")}><RotateCcw size={16} aria-hidden="true" />{t("inv.rcv.fx.undo")}</button>} />
            <div className="mg2-card mg2-card-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <strong>{t("inv.rcv.fx.close")}</strong>
              <p className="mg2-cap" style={{ margin: 0 }}>{t("inv.rcv.fx.close_help")}</p>
              <ul className="mg2-cap" style={{ margin: 0, paddingInlineStart: 18 }}>
                <li>{t("inv.rcv.fx.step_count")} <Link to="/stock?view=Control">{t("inv.lots.tab.control")}</Link></li>
                <li>{t("inv.rcv.fx.step_lots")} <Link to="/stock">{t("inv.lots.tab.lots")}</Link></li>
                <li>{t("inv.rcv.fx.step_supplier")} <Link to="/suppliers">{t("inv.rcv.fx.suppliers")}</Link></li>
              </ul>
              <label className="mg2-field"><span className="lbl">{t("inv.rcv.fx.close_note")}</span>
                <textarea className="mg2-input" rows={2} style={{ paddingBlock: 8 }} value={note} onChange={(e) => setNote(e.target.value)} disabled={!fx.can.close} />
              </label>
              {!fx.can.close && <p className="mg2-cap" style={{ margin: 0 }}><ShieldAlert size={14} aria-hidden="true" /> {t("inv.rcv.fx.no_permission", { perm: t("pos.staff.permission_adjust") })}</p>}
              <button type="button" className="mg2-btn" style={{ alignSelf: "flex-start" }} disabled={!fx.can.close || !note.trim() || !!busy} onClick={() => void run("close")}>{t("inv.rcv.fx.close")}</button>
            </div>
          </section>

          {(sub?.audit?.length ?? 0) > 0 && (
            <section aria-labelledby="fx-audit" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <h3 id="fx-audit" className="mg2-section-title">{t("inv.rcv.fx.audit_title")}</h3>
              <ul className="mg2-cap" style={{ margin: 0, paddingInlineStart: 18 }}>
                {sub!.audit!.map((a, i) => <li key={i}>{when(a.at)} · {a.by} · {a.detail}</li>)}
              </ul>
            </section>
          )}
        </div>
      )}
      </div>
    </Drawer>
  )
}

function ActionCard({ title, text, safe, allowed, reasons, noPermission, button }: {
  title: string; text: string; safe: boolean; allowed: boolean; reasons: string[]; noPermission: string; button: React.ReactNode
}) {
  const { t } = useI18n()
  return (
    <div className="mg2-card mg2-card-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <strong>{title}</strong>
      <p className="mg2-cap" style={{ margin: 0 }}>{text}</p>
      {!safe && reasons.length > 0 && (
        <div>
          <span className="mg2-cap" style={{ fontWeight: 600 }}>{t("inv.rcv.fx.not_safe")}</span>
          <ul className="mg2-cap" style={{ margin: "4px 0 0", paddingInlineStart: 18 }}>{reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      )}
      {!allowed && <p className="mg2-cap" style={{ margin: 0 }}><ShieldAlert size={14} aria-hidden="true" /> {noPermission}</p>}
      <div>{button}</div>
    </div>
  )
}
