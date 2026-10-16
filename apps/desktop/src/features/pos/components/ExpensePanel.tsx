import { useState } from "react"
import { ChevronDown, Lock, Receipt } from "lucide-react"
import { useI18n } from "@lebanonpos/shared"

import { createExpense, type ExpenseCategory, type ExpensePaymentMethod } from "../services/expense.service"
import { getActiveShift, userCan } from "../services/security.service"
import { showToast } from "../services/toast.service"
import { formatCurrency } from "../lib/currency"

const CATEGORIES: ExpenseCategory[] = ["Supplier", "Rent", "Utilities", "Payroll", "Delivery", "Maintenance", "Other"]
const PAYMENTS: ExpensePaymentMethod[] = ["Cash", "Card", "Bank Transfer", "Wallet", "On Account"]
const key = (v: string) => v.toLowerCase().replace(/\s+/g, "_")

/** Record expense (register rail + shift sheet). Values stay in English (stored); labels are localized. */
export default function ExpensePanel({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const { t } = useI18n()
  const [vendor, setVendor] = useState("")
  const [amount, setAmount] = useState("")
  const [category, setCategory] = useState<ExpenseCategory>("Other")
  const [payment, setPayment] = useState<ExpensePaymentMethod>("Cash")
  // Same rule as expense.service and the server push: accounting.manage.
  const allowed = userCan("accounting.manage")
  const hasShift = Boolean(getActiveShift())

  function handleSubmit() {
    const amt = parseFloat(amount)
    if (!vendor.trim()) { showToast(t("pos.expense.need_vendor"), "error"); return }
    if (!amt || amt <= 0) { showToast(t("pos.expense.need_amount"), "error"); return }
    try {
      createExpense({ vendor: vendor.trim(), amount: amt, category, paymentMethod: payment, invoiceNumber: "", note: "" })
    } catch (err) {
      const message = String((err as Error)?.message ?? err)
      showToast((err as Error)?.name === "PermissionError" ? t("pos.expense.need_permission") : /shift/i.test(message) ? t("pos.expense.need_shift") : t("pos.drawer.action_failed", { reason: message }), "error")
      return
    }
    showToast(t("pos.expense.recorded", { amount: formatCurrency(amt) }))
    setVendor("")
    setAmount("")
    setCategory("Other")
    setPayment("Cash")
  }

  const field = { minHeight: 44, fontSize: 14 } as const
  return (
    <div>
      <button type="button" onClick={onToggle} aria-expanded={expanded}
        className="flex w-full items-center justify-between px-4 text-[14px] font-semibold hover:opacity-80"
        style={{ minHeight: 48, color: "var(--text-2)", background: expanded ? "var(--surface-2)" : "transparent" }}>
        <span className="flex items-center gap-2">
          <Receipt size={16} style={{ color: "var(--text-2)" }} aria-hidden="true" />
          {t("pos.expense.title")}
        </span>
        <ChevronDown size={16} className={`transition ${expanded ? "rotate-180" : ""}`} style={{ color: "var(--text-2)" }} aria-hidden="true" />
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-2 space-y-2">
          {!allowed ? (
            <p className="flex items-center gap-2 text-[14px]" style={{ margin: 0, color: "var(--text-2)" }}><Lock size={14} aria-hidden="true" />{t("pos.expense.need_permission")}</p>
          ) : (<>
            {!hasShift && <p className="text-[14px]" style={{ margin: 0, color: "var(--v2-warn)" }}>{t("pos.expense.need_shift")}</p>}
            <input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder={t("pos.expense.vendor")} aria-label={t("pos.expense.vendor")}
              className="input w-full" style={field} />
            <input type="number" min="0" step="0.01" inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)}
              placeholder={t("pos.expense.amount")} aria-label={t("pos.expense.amount")} className="input w-full" style={{ ...field, fontWeight: 600, textAlign: "end" }} />
            <div className="grid grid-cols-2 gap-2">
              <select value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)} aria-label={t("pos.expense.category")} className="input w-full" style={field}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{t(`pos.accounting.category_${key(c)}`)}</option>)}
              </select>
              <select value={payment} onChange={(e) => setPayment(e.target.value as ExpensePaymentMethod)} aria-label={t("pos.expense.payment")} className="input w-full" style={field}>
                {PAYMENTS.map((p) => <option key={p} value={p}>{t(`pos.accounting.payment_${key(p)}`)}</option>)}
              </select>
            </div>
            <button type="button" onClick={handleSubmit} disabled={!hasShift && payment === "Cash"} className="mg2-btn" style={{ width: "100%" }}>
              {t("pos.expense.submit")}
            </button>
          </>)}
        </div>
      )}
    </div>
  )
}
