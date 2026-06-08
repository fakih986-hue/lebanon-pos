import { useState } from "react"
import { ChevronDown, Receipt } from "lucide-react"
import { createExpense, type ExpenseCategory, type ExpensePaymentMethod } from "../services/expense.service"
import { showToast } from "../services/toast.service"

const CATEGORIES: ExpenseCategory[] = ["Supplier", "Rent", "Utilities", "Payroll", "Delivery", "Maintenance", "Other"]
const PAYMENTS: ExpensePaymentMethod[] = ["Cash", "Card", "Bank Transfer", "Wallet", "On Account"]

export default function ExpensePanel({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const [vendor, setVendor] = useState("")
  const [amount, setAmount] = useState("")
  const [category, setCategory] = useState<ExpenseCategory>("Other")
  const [payment, setPayment] = useState<ExpensePaymentMethod>("Cash")

  function handleSubmit() {
    const amt = parseFloat(amount)
    if (!vendor.trim()) { showToast("Enter a vendor name", "error"); return }
    if (!amt || amt <= 0) { showToast("Enter a valid amount", "error"); return }
    createExpense({ vendor: vendor.trim(), amount: amt, category, paymentMethod: payment, invoiceNumber: "", note: "" })
    showToast(`Expense recorded — $${amt.toFixed(2)}`)
    setVendor("")
    setAmount("")
    setCategory("Other")
    setPayment("Cash")
  }

  return (
    <div>
      <button type="button" onClick={onToggle} className="flex w-full items-center justify-between px-4 py-2.5 text-[12px] font-bold hover:opacity-80"
        style={{ color: "var(--text-2)", background: expanded ? "var(--surface-2)" : "transparent" }}>
        <span className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: "var(--rose)" }} />
          <Receipt size={14} style={{ color: "var(--text-3)" }} />
          Record Expense
        </span>
        <ChevronDown size={14} className={`transition ${expanded ? "rotate-180" : ""}`} style={{ color: "var(--text-3)" }} />
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          <input
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            placeholder="Vendor / description"
            className="input w-full"
            style={{ height: 34, fontSize: 12 }}
          />
          <div className="flex gap-2">
            <input
              type="number" min="0" step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Amount (USD)"
              className="input flex-1"
              style={{ height: 34, fontSize: 13, fontWeight: 700 }}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
              className="input w-full"
              style={{ height: 32, fontSize: 11 }}
            >
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select
              value={payment}
              onChange={(e) => setPayment(e.target.value as ExpensePaymentMethod)}
              className="input w-full"
              style={{ height: 32, fontSize: 11 }}
            >
              {PAYMENTS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <button
            onClick={handleSubmit}
            className="w-full rounded-lg py-1.5 text-[12px] font-bold text-white transition hover:opacity-90"
            style={{ background: "var(--rose)" }}
          >
            Record Expense
          </button>
        </div>
      )}
    </div>
  )
}
