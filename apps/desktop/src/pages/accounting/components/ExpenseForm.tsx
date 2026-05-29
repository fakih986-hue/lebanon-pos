import { Banknote, FileText, Landmark, Plus, WalletCards } from "lucide-react"
import { parseMoney } from "../../../features/pos/lib/helpers"
import { showToast } from "../../../features/pos/services/toast.service"
import { createExpense } from "../../../features/pos/services/expense.service"
import { useI18n } from "@lebanonpos/shared"
import { useState } from "react"
import {
  expenseCategories,
  expensePaymentMethods,
  emptyExpenseForm,
  type ExpenseForm,
} from "../accounting.helpers"
import type {
  ExpenseCategory,
  ExpensePaymentMethod,
} from "../../../features/pos/services/expense.service"

type Props = {
  canManageAccounting: boolean
}

export default function ExpenseFormPanel({ canManageAccounting }: Props) {
  const { t } = useI18n()
  const [form, setForm] = useState<ExpenseForm>(emptyExpenseForm)
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({})

  const categoryLabels: Record<ExpenseCategory, string> = {
    Supplier: t("pos.accounting.category_supplier"),
    Rent: t("pos.accounting.category_rent"),
    Utilities: t("pos.accounting.category_utilities"),
    Payroll: t("pos.accounting.category_payroll"),
    Delivery: t("pos.accounting.category_delivery"),
    Maintenance: t("pos.accounting.category_maintenance"),
    Other: t("pos.accounting.category_other"),
  }

  const paymentMethodLabels: Record<ExpensePaymentMethod, string> = {
    Cash: t("pos.accounting.payment_cash"),
    Card: t("pos.accounting.payment_card"),
    "Bank Transfer": t("pos.accounting.payment_bank_transfer"),
    Wallet: t("pos.accounting.payment_wallet"),
    "On Account": t("pos.accounting.payment_on_account"),
  }

  function updateForm(patch: Partial<ExpenseForm>) {
    setForm((current) => ({ ...current, ...patch }))
  }

  function handleCreateExpense() {
    if (!canManageAccounting) {
      showToast(t("pos.permission_required"), "error")
      return
    }
    const newErrors: Record<string, string> = {}
    if (!form.vendor.trim()) newErrors.vendor = t("pos.accounting.vendor_required")
    if (!form.category) newErrors.category = "Category is required"
    if (!form.amount || parseMoney(form.amount) <= 0) newErrors.amount = t("pos.accounting.amount_required")
    setErrors(newErrors)
    if (Object.keys(newErrors).length > 0) {
      showToast(t("pos.accounting.fix_fields"), "error")
      return
    }
    try {
      const expense = createExpense({
        vendor: form.vendor,
        category: form.category,
        amount: parseMoney(form.amount),
        paymentMethod: form.paymentMethod,
        invoiceNumber: form.invoiceNumber,
        note: form.note,
      })
      setForm(emptyExpenseForm)
      setErrors({})
      showToast(t("pos.accounting.expense_recorded", { number: expense.expenseNumber }))
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("pos.accounting.expense_not_saved"), "error")
    }
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
          <Plus size={21} />
        </div>
        <div>
          <h2 className="text-lg font-bold text-zinc-950">
            Record expense
          </h2>
          <p className="text-sm text-zinc-500">
            Supplier bills, rent, payroll, and daily costs.
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <label className="block text-sm font-bold text-zinc-700">
          Vendor
          <input
            value={form.vendor}
            onChange={(e) => {
              updateForm({ vendor: e.target.value })
              setErrors((prev) => ({ ...prev, vendor: undefined }))
            }}
            placeholder="Supplier name"
            className={`mt-2 h-11 w-full rounded-lg border px-3 outline-none focus:ring-4 ${
              errors.vendor
                ? "border-rose-300 bg-rose-50 focus:border-rose-400 focus:ring-rose-100"
                : "border-zinc-200 bg-zinc-50 focus:border-emerald-400 focus:bg-white focus:ring-emerald-100"
            }`}
          />
          {errors.vendor ? (
            <p className="mt-1 text-xs font-medium text-rose-600">{errors.vendor}</p>
          ) : null}
        </label>

        <div className="grid grid-cols-2 gap-2">
          {expenseCategories.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => updateForm({ category })}
              className={`h-10 rounded-lg border text-sm font-bold transition ${
                form.category === category
                  ? "border-zinc-950 bg-zinc-950 text-white"
                  : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
              }`}
            >
              {categoryLabels[category]}
            </button>
          ))}
        </div>

        <label className="block text-sm font-bold text-zinc-700">
          Amount
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.amount}
            onChange={(e) => {
              updateForm({ amount: e.target.value })
              setErrors((prev) => ({ ...prev, amount: undefined }))
            }}
            className={`mt-2 h-11 w-full rounded-lg border px-3 outline-none focus:ring-4 ${
              errors.amount
                ? "border-rose-300 bg-rose-50 focus:border-rose-400 focus:ring-rose-100"
                : "border-zinc-200 bg-zinc-50 focus:border-emerald-400 focus:bg-white focus:ring-emerald-100"
            }`}
          />
          {errors.amount ? (
            <p className="mt-1 text-xs font-medium text-rose-600">{errors.amount}</p>
          ) : null}
        </label>

        <div className="grid grid-cols-2 gap-2">
          {expensePaymentMethods.map((method) => (
            <button
              key={method}
              type="button"
              onClick={() => updateForm({ paymentMethod: method })}
              className={`flex h-10 items-center justify-center gap-2 rounded-lg border text-sm font-bold transition ${
                form.paymentMethod === method
                  ? "border-emerald-600 bg-emerald-50 text-emerald-800"
                  : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
              }`}
            >
              {method === "Cash" ? (
                <Banknote size={15} />
              ) : method === "Bank Transfer" ? (
                <Landmark size={15} />
              ) : method === "Wallet" ? (
                <WalletCards size={15} />
              ) : (
                <FileText size={15} />
              )}
              {paymentMethodLabels[method]}
            </button>
          ))}
        </div>

        <input
          value={form.invoiceNumber}
          onChange={(e) => updateForm({ invoiceNumber: e.target.value })}
          placeholder="Invoice number"
          className="h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
        />

        <textarea
          value={form.note}
          onChange={(e) => updateForm({ note: e.target.value })}
          rows={3}
          placeholder="Note"
          className="w-full resize-none rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
        />

        <button
          type="button"
          onClick={handleCreateExpense}
          disabled={!canManageAccounting}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 text-sm font-bold text-white transition hover:bg-emerald-500 disabled:bg-zinc-200 disabled:text-zinc-400"
        >
          <Plus size={17} />
          Save Expense
        </button>
      </div>
    </section>
  )
}
