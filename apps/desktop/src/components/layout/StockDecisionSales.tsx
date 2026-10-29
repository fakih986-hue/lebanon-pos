import { useEffect, useState } from "react"
import { useI18n } from "@lebanonpos/shared"
import { getPolicyHeldSales, resolvePolicyHeldSale, subscribeSync, type PolicyHeldSale } from "../../features/pos/services/sync.service"
import { getCurrentUser, recordAuditEvent, userCan } from "../../features/pos/services/security.service"

/**
 * SPRINT-1: sales this till has been paid for that the server is holding, because it does not know
 * which stock setting the product was sold under. A manager decides how to record each one, with a
 * note (audited here and on the server); the same sale is re-sent, so nothing is charged again and
 * the stock setting is never silently re-read with today's value.
 */
export default function StockDecisionSales() {
  const { t } = useI18n()
  const [held, setHeld] = useState<PolicyHeldSale[]>(() => getPolicyHeldSales())
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<Record<string, { text: string; error: boolean }>>({})
  useEffect(() => subscribeSync(() => setHeld(getPolicyHeldSales())), [])
  if (held.length === 0) return null

  const user = getCurrentUser()
  const canDecide = !!user && userCan("inventory.manage" as never)

  function decide(sale: PolicyHeldSale, policy: "tracked" | "untracked") {
    const note = (notes[sale.operationId] ?? "").trim()
    if (!user || !canDecide) { setMessage((m) => ({ ...m, [sale.operationId]: { text: t("sync.held.need_manager"), error: true } })); return }
    if (note.length < 3) { setMessage((m) => ({ ...m, [sale.operationId]: { text: t("sync.held.note_required"), error: true } })); return }
    if (!resolvePolicyHeldSale(sale.operationId, policy, note, { id: user.id, name: user.name })) return
    recordAuditEvent({
      action: "sale.stock_policy_resolved", entity: "sale",
      summary: `${sale.saleNumber}: "${sale.productName ?? ""}" recorded as ${policy} by ${user.name} (held: stock setting not known to the server). Already paid ${sale.total.toFixed(2)}. Note: ${note}`,
      metadata: { saleId: sale.saleId, productName: sale.productName ?? "", revision: sale.revision ?? "", policy, note, total: sale.total },
    })
    setMessage((m) => ({ ...m, [sale.operationId]: { text: t("sync.held.resolved", { policy: t(`sync.held.policy.${policy}`) }), error: false } }))
  }

  return (
    <section className="mb-3 flex flex-col gap-2" role="alert" aria-label={t("sync.held.title")}>
      <p className="text-[13px] font-semibold" style={{ color: "var(--v2-err)" }}>{t("sync.held.title")}</p>
      {held.map((sale) => {
        const line = sale.lines.find((l) => l.held)
        const msg = message[sale.operationId]
        return (
          <div key={sale.operationId} className="rounded-lg p-2 text-[12px] flex flex-col gap-1" style={{ background: "var(--surface-2)", color: "var(--text-2)" }}>
            <p className="font-semibold" style={{ color: "var(--text)" }}>{t("sync.held.sale", { number: sale.saleNumber, time: new Date(sale.createdAt).toLocaleString(), cashier: sale.cashier })}</p>
            <p>{t("sync.held.paid", { amount: sale.total.toFixed(2), method: sale.paymentMethod })}</p>
            <p>{t("sync.held.help", { product: sale.productName ?? "" })}</p>
            <p>{t("sync.held.product", { name: sale.productName ?? "" })}</p>
            <p dir="ltr">{sale.revision ? t("sync.held.revision", { rev: sale.revision }) : t("sync.held.revision_none")}</p>
            {line && <p>{t("sync.held.till_recorded", { policy: t(`sync.held.policy.${line.stockPolicy}`) })}</p>}
            {canDecide ? (
              <>
                <input className="mg2-input" style={{ minHeight: 32, fontSize: 12 }} aria-label={t("sync.held.note")} placeholder={t("sync.held.note")}
                  value={notes[sale.operationId] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [sale.operationId]: e.target.value }))} />
                <div className="flex flex-wrap gap-1">
                  <button type="button" className="mg2-btn" style={{ minHeight: 32, fontSize: 12 }} onClick={() => decide(sale, "tracked")}>{t("sync.held.as_tracked")}</button>
                  <button type="button" className="mg2-btn" style={{ minHeight: 32, fontSize: 12 }} onClick={() => decide(sale, "untracked")}>{t("sync.held.as_untracked")}</button>
                </div>
              </>
            ) : <p style={{ color: "var(--v2-err)" }}>{t("sync.held.need_manager")}</p>}
            {msg && <p role="status" style={{ color: msg.error ? "var(--v2-err)" : "var(--text)" }}>{msg.text}</p>}
          </div>
        )
      })}
    </section>
  )
}
