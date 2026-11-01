import { useEffect, useState } from "react"
import { api } from "../app/api"
import { useI18n } from "@lebanonpos/shared"

type Effect = Record<string, any> & { kind: string }
type RefusedOp = {
  id: string; entity: string; action: string; status: string; reason: string | null; attempts: number
  refusedAt: string; lastAttemptAt: string | null
  pushedBy: { id: string; name: string | null } | null; deviceId: string | null
  claimedActor: { id: string | null; name: string | null; knownName: string | null }
  limitations: string[]; effects: Effect[]; payload: unknown
  requiredPermissions: string[]; canResolve: boolean
  // SPRINT-2 F
  category?: string
  evidence?: { label: string | null; deviceCheck: string | null; sessionCheck: string | null; sessionStaff: { id: string; name: string | null } | null; approval: { check?: string; approverName?: string | null } | null; attestation: string | null; heldAt: string | null } | null
  money?: { direction: "collected" | "paid-out" | "none"; amountUsd: number; method: string | null }
  previewToken?: string
}
const OUTCOMES = ["nothing-to-correct", "manual-correction-acknowledged", "money-recovered-attested"] as const
type Decision = {
  opId: string; entity: string; action: string; decision: "apply" | "dismiss"; outcome: string; category: string; decidedAt: string; note: string
  money: { direction: string; amountUsd: number; method: string | null } | null
  actor: { named: string | null; session: { name: string | null; check: string | null } | null }
  approver: { name: string | null; check: string | null } | null
  reviewer: { id: string; name: string }
}

const OPS = new Set(["inventory.adjust", "inventory.count", "inventory.receive", "customer.create", "customer.update", "debt.create", "debt.payment", "debt.delete", "sale.create", "held-sale.create", "delivery-order.create", "delivery-order.update"])

/**
 * Refused work: operations the server refused (e.g. a manager's stock correction pushed by a till
 * connected with a cashier's account). A manager decides each one — apply it under their own
 * authority, or decline it — with a note. The server applies it at most once.
 */
export function RefusedWorkPage() {
  const { t, locale } = useI18n()
  const [ops, setOps] = useState<RefusedOp[]>([])
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState("")
  const [notice, setNotice] = useState("")
  const [deciding, setDeciding] = useState<{ op: RefusedOp; decision: "apply" | "dismiss" } | null>(null)
  const [note, setNote] = useState("")
  const [outcome, setOutcome] = useState<(typeof OUTCOMES)[number] | "">("")
  const [busy, setBusy] = useState(false)
  const fmt = (iso: string) => new Intl.DateTimeFormat(locale === "ar" ? "ar-LB" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso))
  const n = (v: unknown) => (v === null || v === undefined ? "—" : String(v))

  async function load() {
    setLoading(true); setErrorMsg("")
    try {
      setOps((await api<{ operations: RefusedOp[] }>("/api/sync/refused")).operations)
      setDecisions((await api<{ decisions: Decision[] }>("/api/sync/refused/decisions")).decisions)
    } catch (e) { setErrorMsg(e instanceof Error ? e.message : String(e)) }
    setLoading(false)
  }
  useEffect(() => { void load() }, [])

  async function decide() {
    if (!deciding || note.trim().length < 3 || (deciding.decision === "dismiss" && !outcome)) return
    setBusy(true); setErrorMsg("")
    try {
      await api(`/api/sync/refused/${encodeURIComponent(deciding.op.id)}/resolve`, { method: "POST", body: JSON.stringify({ decision: deciding.decision, note: note.trim(), previewToken: deciding.op.previewToken, ...(deciding.decision === "dismiss" ? { outcome } : {}) }) })
      setNotice(deciding.decision === "apply" ? t("refused.applied_ok") : t("refused.dismissed_ok"))
      setDeciding(null); setNote("")
      await load()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      // what the reviewer looked at changed (or someone else decided): show it again, decide again
      if (/changed since you looked|no longer waiting for review|Someone else is deciding/i.test(message)) { setDeciding(null); setNotice(t("refused.stale")); await load() }
      else setErrorMsg(message)
    }
    setBusy(false)
  }

  const opLabel = (o: RefusedOp) => OPS.has(`${o.entity}.${o.action}`) ? t(`refused.op.${o.entity}.${o.action}`) : `${o.action} ${o.entity}`
  const limitation = (l: string) => { const k = `refused.lim.${l}`; const s = t(k); return s === k ? l : s }

  function effectLines(e: Effect): string[] {
    switch (e.kind) {
      case "stock-change": return [
        t("refused.fx.stock_till", { product: e.product, change: (e.change > 0 ? "+" : "") + e.change, before: n(e.tillBefore), after: n(e.tillAfter) }),
        t("refused.fx.stock_server", { now: n(e.serverNow), after: n(e.serverAfter) }),
      ]
      case "lots-received": return [t("refused.fx.lots", { product: e.product, quantity: e.quantity, now: n(e.serverNow), after: n(e.serverAfter) })]
      case "stock-count": return [t("refused.fx.count", { lines: e.lines })]
      case "customer": return [t("refused.fx.customer", { name: e.name })]
      case "debt-payment": return [t("refused.fx.debt_payment", { customer: e.customer, amount: e.amount })]
      case "money": return [t(`refused.fx.money.${e.what}`, { amount: n(e.amount), party: e.party ?? "" }), t("refused.fx.money_not_undone")]
      case "sale": return [t("refused.fx.sale", { number: n(e.saleNumber), total: n(e.total) }), ...(e.lines ?? []).map((l: any) => t("refused.fx.sale_line", { name: l.name, quantity: l.quantity, price: l.unitPrice, catalogue: n(l.catalogue) }))]
      default: return [t("refused.fx.other")]
    }
  }

  return (
    <div className="space-y-6 pb-12">
      <div className="animate-fade-in">
        <h1 className="text-3xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>{t("refused.title")}</h1>
        <p className="text-sm mt-1 max-w-3xl" style={{ color: "var(--text-secondary)" }}>{t("refused.subtitle")}</p>
      </div>

      {notice && <div role="status" className="data-card text-sm" style={{ color: "var(--text-primary)" }}>{notice}</div>}
      {errorMsg && <div role="alert" className="data-card text-sm" style={{ color: "#dc2626" }}>{errorMsg}</div>}

      {loading ? <p className="text-sm" style={{ color: "var(--text-muted)" }}>{t("refused.loading")}</p>
        : ops.length === 0 ? <div className="data-card text-sm" style={{ color: "var(--text-secondary)" }}>{t("refused.empty")}</div>
        : ops.map((o) => (
          <article key={o.id} className="data-card space-y-3" aria-labelledby={`rw-${o.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 id={`rw-${o.id}`} className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>{opLabel(o)}</h2>
                <p className="text-sm" style={{ color: "#dc2626" }}>{t("refused.reason")}: <bdi>{o.reason ?? "—"}</bdi></p>
                <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{t("refused.when", { time: fmt(o.refusedAt), attempts: o.attempts })}</p>
              </div>
              {o.status === "Resolving" && <span className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>{t("refused.resolving")}</span>}
            </div>

            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]" style={{ color: "var(--text-secondary)" }}>
              <dt className="font-medium">{t("refused.pushed_by")}</dt>
              <dd>{o.pushedBy ? (o.pushedBy.name ?? o.pushedBy.id) : "—"}{o.deviceId ? ` · ${t("refused.device")} ${o.deviceId}` : ""}</dd>
              <dt className="font-medium">{t("refused.named_actor")}</dt>
              <dd>{o.claimedActor.knownName ?? o.claimedActor.name ?? t("refused.not_recorded")}</dd>
              {o.category && <><dt className="font-medium">{t("refused.category")}</dt><dd>{(() => { const k = `refused.cat.${o.category}`; const s = t(k); return s === k ? o.category : s })()}</dd></>}
              {o.evidence && <><dt className="font-medium">{t("refused.evidence")}</dt><dd>{n(o.evidence.label)}{o.evidence.sessionStaff ? ` · ${t("refused.session_of", { name: o.evidence.sessionStaff.name ?? o.evidence.sessionStaff.id })}` : ""}{o.evidence.approval?.approverName ? ` · ${t("refused.approved_by", { name: o.evidence.approval.approverName, check: o.evidence.approval.check ?? "" })}` : ""}</dd></>}
              {o.money && o.money.direction !== "none" && <><dt className="font-medium">{t("refused.money")}</dt><dd>{t(o.money.direction === "collected" ? "refused.money_collected" : "refused.money_paid", { amount: o.money.amountUsd.toFixed(2), method: o.money.method ?? "" })}</dd></>}
            </dl>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{t("refused.effects")}</h3>
              <ul className="mt-1 list-disc ps-5 text-sm" style={{ color: "var(--text-primary)" }}>
                {o.effects.flatMap(effectLines).map((line, i) => <li key={i}>{line}</li>)}
              </ul>
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{t("refused.limitations")}</h3>
              <ul className="mt-1 list-disc ps-5 text-sm" style={{ color: "var(--text-secondary)" }}>
                {o.limitations.map((l) => <li key={l}>{limitation(l)}</li>)}
              </ul>
            </div>

            <details>
              <summary className="cursor-pointer text-sm" style={{ color: "var(--text-secondary)" }}>{t("refused.payload")}</summary>
              <pre dir="ltr" className="mt-2 max-h-72 overflow-auto rounded-lg p-3 text-xs" style={{ background: "var(--bg-secondary, rgba(0,0,0,.05))", color: "var(--text-primary)" }}>{JSON.stringify(o.payload, null, 2)}</pre>
            </details>

            {o.status === "Refused" && (o.canResolve ? (
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary text-sm" onClick={() => { setDeciding({ op: o, decision: "apply" }); setNote(""); setOutcome("") }}>{t("refused.apply")}</button>
                <button className="btn-secondary text-sm" onClick={() => { setDeciding({ op: o, decision: "dismiss" }); setNote(""); setOutcome("") }}>{t("refused.dismiss")}</button>
              </div>
            ) : <p className="text-sm" style={{ color: "var(--text-muted)" }}>{t("refused.needs", { permissions: o.requiredPermissions.join(", ") })}</p>)}
          </article>
        ))}

      {decisions.length > 0 && (
        <section aria-labelledby="rw-decided" className="space-y-2">
          <h2 id="rw-decided" className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>{t("refused.decided")}</h2>
          {decisions.map((d) => (
            <article key={d.opId} className="data-card text-sm space-y-1" style={{ color: "var(--text-secondary)" }}>
              <p className="font-medium" style={{ color: "var(--text-primary)" }}>
                {d.action} {d.entity} · {d.decision === "apply" ? t("refused.decided_applied") : t(`refused.outcome.${d.outcome}`)}
              </p>
              <dl className="grid gap-x-6 gap-y-0.5 sm:grid-cols-[max-content_1fr]">
                <dt className="font-medium">{t("refused.who_actor")}</dt>
                <dd>{d.actor.session?.name ? t("refused.session_of", { name: d.actor.session.name }) : (d.actor.named ?? t("refused.not_recorded"))}{d.actor.session?.check ? ` (${d.actor.session.check})` : ""}</dd>
                <dt className="font-medium">{t("refused.who_approver")}</dt>
                <dd>{d.approver?.name ? `${d.approver.name} (${d.approver.check ?? ""})` : "—"}</dd>
                <dt className="font-medium">{t("refused.who_reviewer")}</dt>
                <dd>{d.reviewer.name} · {fmt(d.decidedAt)} · <bdi>{d.note}</bdi></dd>
              </dl>
            </article>
          ))}
        </section>
      )}

      {deciding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,.6)" }} onClick={() => !busy && setDeciding(null)}>
          <div className="data-card w-full" role="dialog" aria-modal="true" aria-labelledby="rw-decide" style={{ maxWidth: "520px" }} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === "Escape" && !busy) setDeciding(null) }}>
            <h2 id="rw-decide" className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
              {deciding.decision === "apply" ? t("refused.confirm_apply_title") : t("refused.confirm_dismiss_title")}
            </h2>
            <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
              {deciding.decision === "apply" ? t("refused.confirm_apply_body") : t("refused.confirm_dismiss_body")}
            </p>
            <label className="mt-4 block text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              {t("refused.note")}
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} autoFocus className="input-field mt-1 w-full" />
            </label>
            {deciding.decision === "dismiss" && (
              <fieldset className="mt-4 text-sm" style={{ color: "var(--text-primary)" }}>
                <legend className="font-medium">{t("refused.outcome")}</legend>
                {OUTCOMES.map((o) => (
                  <label key={o} className="mt-1 flex items-start gap-2"><input type="radio" name="rw-outcome" checked={outcome === o} onChange={() => setOutcome(o)} /><span>{t(`refused.outcome.${o}`)}</span></label>
                ))}
              </fieldset>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-secondary text-sm" disabled={busy} onClick={() => setDeciding(null)}>{t("admin.cancel")}</button>
              <button className="btn-primary text-sm" style={{ opacity: busy || note.trim().length < 3 || (deciding.decision === "dismiss" && !outcome) ? 0.5 : 1 }} disabled={busy || note.trim().length < 3 || (deciding.decision === "dismiss" && !outcome)} onClick={() => void decide()}>
                {deciding.decision === "apply" ? t("refused.apply") : t("refused.dismiss")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
