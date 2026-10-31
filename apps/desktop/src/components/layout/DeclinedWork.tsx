import { useEffect, useState } from "react"
import { useI18n } from "@lebanonpos/shared"
import { getSyncQueue, removeRejectedOperation, subscribeSync, type SyncOperation } from "../../features/pos/services/sync.service"
import { getCurrentUser, recordAuditEvent } from "../../features/pos/services/security.service"

/** Operations a manager declined on review (the server answers DISMISSED to this register). */
const declined = () => getSyncQueue().filter((op) => op.status === "Rejected" && String(op.error ?? "").startsWith("DISMISSED:"))

/**
 * Refused work a manager DECLINED. The server will never apply it — but it already happened on this
 * register (stock changed, cash paid out or taken, a sale paid) and nothing is undone automatically.
 * Each one stays here, with the manager's decision, until someone records what was done about it.
 */
export default function DeclinedWork() {
  const { t } = useI18n()
  const [items, setItems] = useState<SyncOperation[]>(declined)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  useEffect(() => subscribeSync(() => setItems(declined())), [])
  if (items.length === 0) return null

  const money = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v).toFixed(2) : "—")
  function effect(op: SyncOperation): string {
    const p = (op.payload ?? {}) as Record<string, unknown>
    if (op.entity === "inventory" && op.action === "adjust") {
      const change = Number(p.quantityChange ?? 0)
      return t("sync.declined.stock", { product: String(p.productName ?? op.summary), change: `${change > 0 ? "+" : ""}${change}` })
    }
    if (op.entity === "sale" && op.action === "create") return t("sync.declined.sale", { number: String(p.saleNumber ?? "—"), total: money(p.total) })
    const what = op.entity === "expense" ? "expense" : op.entity === "cash-movement" ? "cash" : op.entity === "supplier-payment" ? "supplier-payment" : op.entity === "refund" ? "refund" : null
    if (what) return t("sync.declined.money", { amount: money(p.amount ?? p.total), what: t(`sync.declined.what.${what}`) })
    return t("sync.declined.other", { summary: op.summary })
  }
  const decision = (op: SyncOperation) => /^DISMISSED: (.*?)\. The server did not apply/.exec(String(op.error ?? ""))?.[1] ?? String(op.error ?? "")

  function handled(op: SyncOperation) {
    const note = (notes[op.id] ?? "").trim()
    const user = getCurrentUser()
    if (!user) return
    if (note.length < 3) { setErrors((e) => ({ ...e, [op.id]: t("sync.declined.note_required") })); return }
    recordAuditEvent({
      action: "sync.declined.handled", entity: op.entity,
      summary: `${user.name} handled the declined "${op.summary}" on this register: ${note}`,
      metadata: { operationId: op.id, entity: op.entity, action: op.action, decision: decision(op), note },
    })
    removeRejectedOperation(op.id)
    setItems(declined())
  }

  return (
    <section className="mb-3 flex flex-col gap-2" role="alert" aria-label={t("sync.declined.title")} data-testid="declined-work">
      <p className="text-[13px] font-semibold" style={{ color: "var(--v2-err)" }}>{t("sync.declined.title")}</p>
      <p className="text-[12px]" style={{ color: "var(--text-2)" }}>{t("sync.declined.help")}</p>
      {items.map((op) => (
        <div key={op.id} className="flex flex-col gap-1 rounded-lg p-2 text-[12px]" style={{ background: "var(--surface-2)", color: "var(--text-2)" }}>
          <p className="font-semibold" style={{ color: "var(--text)" }}>{effect(op)}</p>
          <p>{t("sync.declined.decision", { decision: decision(op) })}</p>
          <input className="mg2-input" style={{ minHeight: 32, fontSize: 12, background: "var(--surface)", border: "1px solid var(--border-input)", color: "var(--text)", borderRadius: 6, padding: "0 8px" }}
            aria-label={t("sync.declined.note")} placeholder={t("sync.declined.note")}
            value={notes[op.id] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [op.id]: e.target.value }))} />
          <button type="button" className="mg2-btn self-start rounded-md px-3 font-semibold" style={{ minHeight: 32, fontSize: 12, background: "var(--surface)", border: "1px solid var(--border-strong)", color: "var(--text)" }} onClick={() => handled(op)}>
            {t("sync.declined.handled")}
          </button>
          {errors[op.id] && <p role="status" style={{ color: "var(--v2-err)" }}>{errors[op.id]}</p>}
        </div>
      ))}
    </section>
  )
}
