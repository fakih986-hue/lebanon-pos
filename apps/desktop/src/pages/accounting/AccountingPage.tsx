import { useEffect, useMemo, useState } from "react"
import { useI18n } from "@lebanonpos/shared"
import {
  Banknote,
  Building2,
  Calculator,
  CheckCircle2,
  ClipboardList,
  FileText,
  Landmark,
  Plus,
  ReceiptText,
  TrendingDown,
  TrendingUp,
  WalletCards,
} from "lucide-react"

import { formatCurrency, formatNumber } from "../../features/pos/lib/currency"
import { formatDateTime, parseMoney } from "../../features/pos/lib/helpers"
import {
  closeBusinessDay,
  getDailyCloses,
  getLocalDateKey,
  subscribeDailyCloses,
  type DailyClose,
} from "../../features/pos/services/dailyClose.service"
import {
  createExpense,
  getExpenses,
  subscribeExpenses,
  type Expense,
  type ExpenseCategory,
  type ExpensePaymentMethod,
} from "../../features/pos/services/expense.service"
import {
  getRefunds,
  getSales,
  subscribeRefunds,
  subscribeSales,
  type Sale,
  type SaleRefund,
} from "../../features/pos/services/sales.service"
import { userCan } from "../../features/pos/services/security.service"
import {
  getSupplierPayments,
  subscribeSuppliers,
  type SupplierPayment,
} from "../../features/pos/services/supplier.service"

import { showToast } from "../../features/pos/services/toast.service"
import ConfirmDialog from "../../components/ConfirmDialog"
import Spinner from "../../components/ui/Spinner"
import WorkspaceTabs from "../../components/ui/WorkspaceTabs"

type ExpenseForm = {
  vendor: string
  category: ExpenseCategory
  amount: string
  paymentMethod: ExpensePaymentMethod
  invoiceNumber: string
  note: string
}

type AccountingSummary = {
  dateKey: string
  grossSales: number
  refunds: number
  netSales: number
  costOfGoods: number
  returnedCost: number
  grossMargin: number
  expenses: number
  supplierPayments: number
  netProfit: number
  cashIn: number
  cashOut: number
  cashNet: number
}

type AccountingWorkspace = "Close day" | "Expenses" | "Cash flow" | "History"

const expenseCategories: ExpenseCategory[] = [
  "Supplier",
  "Rent",
  "Utilities",
  "Payroll",
  "Delivery",
  "Maintenance",
  "Other",
]

const expensePaymentMethods: ExpensePaymentMethod[] = [
  "Cash",
  "Card",
  "Bank Transfer",
  "Wallet",
  "On Account",
]

const emptyExpenseForm: ExpenseForm = {
  vendor: "",
  category: "Supplier",
  amount: "",
  paymentMethod: "Cash",
  invoiceNumber: "",
  note: "",
}

function formatDateKey(value: string) {
  return new Intl.DateTimeFormat("en-LB", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`))
}

function isToday(value: string, todayKey = getLocalDateKey()) {
  return getLocalDateKey(new Date(value)) === todayKey
}

function getSaleGrossSubtotal(sale: Sale) {
  return sale.items.reduce((sum, item) => sum + item.total, 0)
}

function getRefundPreTax(refund: SaleRefund, sales: Sale[]) {
  const sale = sales.find((currentSale) => currentSale.id === refund.saleId)

  if (!sale) {
    return refund.total
  }

  const grossSubtotal = getSaleGrossSubtotal(sale)

  if (grossSubtotal <= 0) {
    return refund.total
  }

  const refundGrossSubtotal = refund.items.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity,
    0
  )

  return refundGrossSubtotal * (sale.subtotal / grossSubtotal)
}

function getRefundCost(refund: SaleRefund, sales: Sale[]) {
  const sale = sales.find((currentSale) => currentSale.id === refund.saleId)

  return refund.items.reduce((sum, item) => {
    const saleItem = sale?.items.find((currentItem) => currentItem.id === item.id)
    const unitCost = item.cost ?? saleItem?.cost ?? 0

    return sum + unitCost * item.quantity
  }, 0)
}

function getAccountingSummary(
  sales: Sale[],
  refunds: SaleRefund[],
  expenses: Expense[],
  supplierPayments: SupplierPayment[]
): AccountingSummary {
  const dateKey = getLocalDateKey()
  const todaySales = sales.filter((sale) => isToday(sale.createdAt, dateKey))
  const todayRefunds = refunds.filter((refund) =>
    isToday(refund.createdAt, dateKey)
  )
  const todayExpenses = expenses.filter((expense) =>
    isToday(expense.createdAt, dateKey)
  )
  const todaySupplierPayments = supplierPayments.filter((payment) =>
    isToday(payment.createdAt, dateKey)
  )
  const grossSales = todaySales.reduce((sum, sale) => sum + sale.total, 0)
  const refundsTotal = todayRefunds.reduce(
    (sum, refund) => sum + refund.total,
    0
  )
  const soldCost = todaySales.reduce(
    (sum, sale) =>
      sum +
      sale.items.reduce(
        (itemSum, item) => itemSum + item.cost * item.quantity,
        0
      ),
    0
  )
  const returnedCost = todayRefunds.reduce(
    (sum, refund) => sum + getRefundCost(refund, sales),
    0
  )
  const salesMargin = todaySales.reduce((sum, sale) => sum + sale.profit, 0)
  const refundMarginImpact = todayRefunds.reduce(
    (sum, refund) =>
      sum + getRefundPreTax(refund, sales) - getRefundCost(refund, sales),
    0
  )
  const expensesTotal = todayExpenses.reduce(
    (sum, expense) => sum + expense.amount,
    0
  )
  const cashIn = todaySales
    .filter((sale) => sale.paymentMethod === "Cash")
    .reduce((sum, sale) => sum + sale.total, 0)
  const cashRefunds = todayRefunds
    .filter((refund) => refund.method === "Cash")
    .reduce((sum, refund) => sum + refund.total, 0)
  const cashExpenses = todayExpenses
    .filter((expense) => expense.paymentMethod === "Cash")
    .reduce((sum, expense) => sum + expense.amount, 0)
  const cashSupplierPayments = todaySupplierPayments
    .filter((payment) => payment.method === "Cash")
    .reduce((sum, payment) => sum + payment.amount, 0)
  const supplierPaymentsTotal = todaySupplierPayments.reduce(
    (sum, payment) => sum + payment.amount,
    0
  )

  return {
    dateKey,
    grossSales,
    refunds: refundsTotal,
    netSales: grossSales - refundsTotal,
    costOfGoods: Math.max(0, soldCost - returnedCost),
    returnedCost,
    grossMargin: salesMargin - refundMarginImpact,
    expenses: expensesTotal,
    supplierPayments: supplierPaymentsTotal,
    netProfit: salesMargin - refundMarginImpact - expensesTotal,
    cashIn,
    cashOut: cashRefunds + cashExpenses + cashSupplierPayments,
    cashNet: cashIn - cashRefunds - cashExpenses - cashSupplierPayments,
  }
}

export default function AccountingPage() {
  const { t } = useI18n()
  const [isLoading, setIsLoading] = useState(true)
  const [sales, setSales] = useState<Sale[]>(getSales())
  const [refunds, setRefunds] = useState<SaleRefund[]>(getRefunds())
  const [expenses, setExpenses] = useState<Expense[]>(getExpenses())
  const [supplierPayments, setSupplierPayments] = useState<SupplierPayment[]>(
    getSupplierPayments()
  )
  const [dailyCloses, setDailyCloses] = useState<DailyClose[]>(getDailyCloses())
  const [expenseForm, setExpenseForm] =
    useState<ExpenseForm>(emptyExpenseForm)
  const [closeNote, setCloseNote] = useState("")
  const [countedCash, setCountedCash] = useState("")
  const canManageAccounting = userCan("accounting.manage")
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)
  const [activeWorkspace, setActiveWorkspace] =
    useState<AccountingWorkspace>("Close day")

  useEffect(() => {
    setIsLoading(false)
    const unsubscribeSales = subscribeSales(setSales)
    const unsubscribeRefunds = subscribeRefunds(setRefunds)
    const unsubscribeExpenses = subscribeExpenses(setExpenses)
    const unsubscribeDailyCloses = subscribeDailyCloses(setDailyCloses)
    const unsubscribeSuppliers = subscribeSuppliers(() =>
      setSupplierPayments(getSupplierPayments())
    )

    return () => {
      unsubscribeSales()
      unsubscribeRefunds()
      unsubscribeExpenses()
      unsubscribeDailyCloses()
      unsubscribeSuppliers()
    }
  }, [])

  const summary = useMemo(
    () => getAccountingSummary(sales, refunds, expenses, supplierPayments),
    [expenses, refunds, sales, supplierPayments]
  )
  const todayExpenses = expenses.filter((expense) =>
    isToday(expense.createdAt, summary.dateKey)
  )
  const recentExpenses = expenses.slice(0, 8)
  const todayClose = dailyCloses.find(
    (dailyClose) => dailyClose.dateKey === summary.dateKey
  )
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
  const categoryTotals = expenseCategories.map((category) => ({
    category,
    total: todayExpenses
      .filter((expense) => expense.category === category)
      .reduce((sum, expense) => sum + expense.amount, 0),
  }))

  function updateExpenseForm(patch: Partial<ExpenseForm>) {
    setExpenseForm((currentForm) => ({
      ...currentForm,
      ...patch,
    }))
  }

  const [expenseErrors, setExpenseErrors] = useState<Partial<Record<string, string>>>({})

  function handleCreateExpense() {
    if (!canManageAccounting) {
      showToast(t("pos.permission_required"), "error")
      return
    }

    const errors: Record<string, string> = {}
    if (!expenseForm.vendor.trim()) errors.vendor = t("pos.accounting.vendor_required")
    if (!expenseForm.category) errors.category = "Category is required"
    if (!expenseForm.amount || parseMoney(expenseForm.amount) <= 0) errors.amount = t("pos.accounting.amount_required")

    setExpenseErrors(errors)
    if (Object.keys(errors).length > 0) {
      showToast(t("pos.accounting.fix_fields"), "error")
      return
    }

    try {
      const expense = createExpense({
        vendor: expenseForm.vendor,
        category: expenseForm.category,
        amount: parseMoney(expenseForm.amount),
        paymentMethod: expenseForm.paymentMethod,
        invoiceNumber: expenseForm.invoiceNumber,
        note: expenseForm.note,
      })

      setExpenseForm(emptyExpenseForm)
      setExpenseErrors({})
      showToast(t("pos.accounting.expense_recorded", { number: expense.expenseNumber }))
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("pos.accounting.expense_not_saved"), "error")
    }
  }

  function handleCloseDay() {
    setShowCloseConfirm(true)
  }

  function confirmCloseDay() {
    if (!canManageAccounting) {
      showToast(t("pos.permission_required"), "error")
      return
    }
    // Append cash reconciliation to the note if a count was entered
    const counted = parseFloat(countedCash)
    let finalNote = closeNote
    if (countedCash.trim() !== "" && !isNaN(counted)) {
      const variance = counted - summary.cashNet
      const varianceLine = `Cash count: ${formatCurrency(counted)} vs expected ${formatCurrency(summary.cashNet)} (variance ${variance >= 0 ? "+" : ""}${formatCurrency(variance)}).`
      finalNote = finalNote ? `${finalNote}\n${varianceLine}` : varianceLine
    }

    const close = closeBusinessDay({
      dateKey: summary.dateKey,
      grossSales: summary.grossSales,
      refunds: summary.refunds,
      netSales: summary.netSales,
      costOfGoods: summary.costOfGoods,
      returnedCost: summary.returnedCost,
      grossMargin: summary.grossMargin,
      expenses: summary.expenses,
      supplierPayments: summary.supplierPayments,
      netProfit: summary.netProfit,
      cashIn: summary.cashIn,
      cashOut: summary.cashOut,
      note: finalNote,
    })
    setCloseNote("")
    setCountedCash("")
    setShowCloseConfirm(false)
    showToast(t("pos.accounting.day_closed", { date: formatDateKey(close.dateKey) }))
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-page p-3 sm:p-5 xl:p-6">
      {isLoading ? (
        <div className="flex min-h-[400px] items-center justify-center p-6">
          <Spinner label={t("pos.accounting.loading")} />
        </div>
      ) : (
      <>
      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-zinc-500">{t("pos.accounting.net_sales")}</p>
            <ReceiptText size={20} className="text-emerald-700" />
          </div>
          <p className="mt-3 text-3xl font-bold text-zinc-950">
            {formatCurrency(summary.netSales)}
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            {t("pos.accounting.gross_breakdown", { gross: formatCurrency(summary.grossSales), returns: formatCurrency(summary.refunds) })}
          </p>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-zinc-500">{t("pos.accounting.gross_margin")}</p>
            <TrendingUp size={20} className="text-indigo-700" />
          </div>
          <p className="mt-3 text-3xl font-bold text-zinc-950">
            {formatCurrency(summary.grossMargin)}
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            After returned item cost
          </p>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-zinc-500">Expenses</p>
            <TrendingDown size={20} className="text-rose-700" />
          </div>
          <p className="mt-3 text-3xl font-bold text-rose-700">
            {formatCurrency(summary.expenses)}
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            {formatNumber(todayExpenses.length)} entries today
          </p>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-zinc-500">Net profit</p>
            <Calculator size={20} className="text-amber-700" />
          </div>
          <p
            className={`mt-3 text-3xl font-bold ${
              summary.netProfit >= 0 ? "text-emerald-700" : "text-rose-700"
            }`}
          >
            {formatCurrency(summary.netProfit)}
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            {todayClose ? "Day already closed" : "Ready to close today"}
          </p>
        </div>
      </section>

      <WorkspaceTabs<AccountingWorkspace>
        className="mt-5"
        active={activeWorkspace}
        onChange={setActiveWorkspace}
        tabs={[
          { label: "Close day", count: todayClose ? 1 : 0 },
          { label: "Expenses", count: todayExpenses.length },
          { label: "Cash flow" },
          { label: "History", count: dailyCloses.length },
        ]}
      />

      <section className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
        <div className="space-y-5">
          {activeWorkspace === "Close day" ? (
          <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
            <div className="border-b border-zinc-200 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-zinc-950 text-white">
                  <ClipboardList size={21} />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-zinc-950">
                    Daily closing statement
                  </h2>
                  <p className="text-sm text-zinc-500">
                    {formatDateKey(summary.dateKey)}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-4 p-4 lg:grid-cols-2">
              <div className="space-y-2 rounded-lg border border-zinc-200 p-4 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-zinc-500">Gross sales</span>
                  <strong>{formatCurrency(summary.grossSales)}</strong>
                </div>
                <div className="flex justify-between gap-3 text-rose-700">
                  <span>Refunds</span>
                  <strong>-{formatCurrency(summary.refunds)}</strong>
                </div>
                <div className="flex justify-between gap-3 border-t border-zinc-200 pt-2">
                  <span className="text-zinc-500">{t("pos.accounting.net_sales")}</span>
                  <strong>{formatCurrency(summary.netSales)}</strong>
                </div>
                <div className="flex justify-between gap-3 text-zinc-500">
                  <span>Cost of goods</span>
                  <strong className="text-zinc-900">
                    -{formatCurrency(summary.costOfGoods)}
                  </strong>
                </div>
                <div className="flex justify-between gap-3 border-t border-zinc-200 pt-2 font-bold text-zinc-950">
                  <span>{t("pos.accounting.gross_margin")}</span>
                  <span>{formatCurrency(summary.grossMargin)}</span>
                </div>
              </div>

              <div className="space-y-2 rounded-lg border border-zinc-200 p-4 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-zinc-500">Operating expenses</span>
                  <strong className="text-rose-700">
                    -{formatCurrency(summary.expenses)}
                  </strong>
                </div>
                <div className="flex justify-between gap-3 border-t border-zinc-200 pt-2 text-lg font-bold">
                  <span>Net profit</span>
                  <span
                    className={
                      summary.netProfit >= 0 ? "text-emerald-700" : "text-rose-700"
                    }
                  >
                    {formatCurrency(summary.netProfit)}
                  </span>
                </div>
                <div className="mt-3 rounded-lg bg-zinc-50 p-3">
                  <div className="flex justify-between gap-3">
                    <span className="text-zinc-500">Cash in</span>
                    <strong>{formatCurrency(summary.cashIn)}</strong>
                  </div>
                  <div className="mt-2 flex justify-between gap-3 text-rose-700">
                    <span>Cash out</span>
                    <strong>-{formatCurrency(summary.cashOut)}</strong>
                  </div>
                  <div className="mt-2 flex justify-between gap-3 text-zinc-500">
                    <span>Supplier payments</span>
                    <strong className="text-zinc-900">
                      {formatCurrency(summary.supplierPayments)}
                    </strong>
                  </div>
                  <div className="mt-2 flex justify-between gap-3 border-t border-zinc-200 pt-2 font-bold">
                    <span>Cash movement</span>
                    <span>{formatCurrency(summary.cashNet)}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-zinc-200 p-4">
              {/* Cash reconciliation: count drawer vs expected */}
              {(() => {
                const expected = summary.cashNet
                const counted = parseFloat(countedCash)
                const hasCount = countedCash.trim() !== "" && !isNaN(counted)
                const variance = hasCount ? counted - expected : 0
                const matched = Math.abs(variance) < 0.01
                return (
                  <div className="mb-3 rounded-lg border p-4" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
                    <p className="text-[13px] font-bold mb-3" style={{ color: "var(--text)" }}>Cash reconciliation</p>
                    <div className="flex items-center justify-between mb-2 text-sm">
                      <span style={{ color: "var(--text-2)" }}>Expected in drawer</span>
                      <strong style={{ color: "var(--text)" }}>{formatCurrency(expected)}</strong>
                    </div>
                    <label className="block">
                      <span className="block text-[12px] font-semibold mb-1.5" style={{ color: "var(--text-2)" }}>
                        Counted cash (actual in drawer)
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={countedCash}
                        onChange={(e) => setCountedCash(e.target.value)}
                        placeholder={expected.toFixed(2)}
                        className="input w-full text-right font-bold"
                        style={{ height: 44, fontSize: 16 }}
                      />
                    </label>
                    {hasCount && (
                      <div
                        className="mt-3 flex items-center justify-between rounded-lg px-3 py-2.5"
                        style={matched
                          ? { background: "var(--brand-soft)", color: "var(--brand-text)" }
                          : { background: "var(--rose-soft)", color: "var(--rose-text)" }
                        }
                      >
                        <span className="text-[13px] font-bold">
                          {matched ? "✓ Balanced" : variance > 0 ? "Over (extra cash)" : "Short (missing cash)"}
                        </span>
                        <strong className="text-[15px]">
                          {variance > 0 ? "+" : ""}{formatCurrency(variance)}
                        </strong>
                      </div>
                    )}
                  </div>
                )
              })()}

              <textarea
                value={closeNote}
                onChange={(event) => setCloseNote(event.target.value)}
                rows={3}
                placeholder="Closing note"
                className="w-full resize-none rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 text-sm font-medium outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm font-semibold text-zinc-500">Daily profit and expense summary.</p>
                <button
                  type="button"
                  onClick={handleCloseDay}
                  disabled={!canManageAccounting}
                  className="flex h-11 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-4 text-sm font-bold text-white transition hover:bg-zinc-800 disabled:bg-zinc-200 disabled:text-zinc-400"
                >
                  <CheckCircle2 size={17} />
                  {todayClose ? "Reclose Today" : "Close Today"}
                </button>
              </div>
            </div>
          </section>
          ) : null}

          {activeWorkspace === "Cash flow" ? (
          <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
            <div className="border-b border-zinc-200 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
                  <Building2 size={21} />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-zinc-950">
                    Cash flow
                  </h2>
                  <p className="text-sm text-zinc-500">
                    {formatDateKey(summary.dateKey)}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3 p-4">
              <div className="rounded-lg bg-zinc-50 p-4">
                <div className="flex justify-between gap-3">
                  <span className="text-zinc-500">Cash in</span>
                  <strong className="text-lg">{formatCurrency(summary.cashIn)}</strong>
                </div>
                <div className="mt-3 flex justify-between gap-3 text-rose-700">
                  <span>Cash out</span>
                  <strong className="text-lg">-{formatCurrency(summary.cashOut)}</strong>
                </div>
                <div className="mt-3 flex justify-between gap-3 text-zinc-500">
                  <span>Supplier payments</span>
                  <strong className="text-lg text-zinc-900">{formatCurrency(summary.supplierPayments)}</strong>
                </div>
                <div className="mt-3 flex justify-between gap-3 border-t border-zinc-200 pt-3 font-bold">
                  <span>Net cash movement</span>
                  <span className="text-lg">{formatCurrency(summary.cashNet)}</span>
                </div>
              </div>

              <div className="rounded-lg border border-zinc-200 p-4">
                <h3 className="font-bold text-zinc-950">Expense mix today</h3>
                <div className="mt-3 space-y-2">
                  {categoryTotals.map((item) => (
                    <div key={item.category} className="flex items-center justify-between text-sm">
                      <span className="font-semibold text-zinc-700">{categoryLabels[item.category]}</span>
                      <strong className="text-zinc-950">{formatCurrency(item.total)}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
          ) : null}

          {activeWorkspace === "Expenses" ? (
          <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
            <div className="border-b border-zinc-200 p-4">
              <h2 className="text-xl font-bold text-zinc-950">
                Recent expenses
              </h2>
              <p className="text-sm text-zinc-500">
                Supplier bills and operating costs.
              </p>
            </div>
            <div className="space-y-3 p-4">
              {recentExpenses.length === 0 ? (
                <p className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm font-medium text-zinc-500">
                  No expenses recorded yet.
                </p>
              ) : null}

              {recentExpenses.map((expense) => (
                <article
                  key={expense.id}
                  className="rounded-lg border border-zinc-200 bg-white p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-bold text-zinc-950">
                        {expense.vendor}
                      </p>
                      <p className="mt-1 text-sm text-zinc-500">
                        {categoryLabels[expense.category]} - {formatDateTime(expense.createdAt)}
                      </p>
                    </div>
                    <strong className="shrink-0 text-rose-700">
                      {formatCurrency(expense.amount)}
                    </strong>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
                    <span className="rounded-lg bg-zinc-100 px-2 py-1 text-zinc-700">
                      {paymentMethodLabels[expense.paymentMethod]}
                    </span>
                    {expense.invoiceNumber ? (
                      <span className="rounded-lg bg-zinc-100 px-2 py-1 text-zinc-700">
                        {expense.invoiceNumber}
                      </span>
                    ) : null}
                    {expense.shiftNumber ? (
                      <span className="rounded-lg bg-zinc-100 px-2 py-1 text-zinc-700">
                        {expense.shiftNumber}
                      </span>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </section>
          ) : null}
        </div>

        <aside className="space-y-5">
          {activeWorkspace === "Expenses" ? (
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
                  value={expenseForm.vendor}
                  onChange={(event) => {
                    updateExpenseForm({ vendor: event.target.value })
                    setExpenseErrors((prev) => ({ ...prev, vendor: undefined }))
                  }}
                  placeholder="Supplier name"
                  className={`mt-2 h-11 w-full rounded-lg border px-3 outline-none focus:ring-4 ${
                    expenseErrors.vendor
                      ? "border-rose-300 bg-rose-50 focus:border-rose-400 focus:ring-rose-100"
                      : "border-zinc-200 bg-zinc-50 focus:border-emerald-400 focus:bg-white focus:ring-emerald-100"
                  }`}
                />
                {expenseErrors.vendor ? (
                  <p className="mt-1 text-xs font-medium text-rose-600">{expenseErrors.vendor}</p>
                ) : null}
              </label>

              <div className="grid grid-cols-2 gap-2">
                {expenseCategories.map((category) => (
                  <button
                    key={category}
                    type="button"
                    onClick={() => updateExpenseForm({ category })}
                    className={`h-10 rounded-lg border text-sm font-bold transition ${
                      expenseForm.category === category
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
                  value={expenseForm.amount}
                  onChange={(event) => {
                    updateExpenseForm({ amount: event.target.value })
                    setExpenseErrors((prev) => ({ ...prev, amount: undefined }))
                  }}
                  className={`mt-2 h-11 w-full rounded-lg border px-3 outline-none focus:ring-4 ${
                    expenseErrors.amount
                      ? "border-rose-300 bg-rose-50 focus:border-rose-400 focus:ring-rose-100"
                      : "border-zinc-200 bg-zinc-50 focus:border-emerald-400 focus:bg-white focus:ring-emerald-100"
                  }`}
                />
                {expenseErrors.amount ? (
                  <p className="mt-1 text-xs font-medium text-rose-600">{expenseErrors.amount}</p>
                ) : null}
              </label>

              <div className="grid grid-cols-2 gap-2">
                {expensePaymentMethods.map((method) => (
                  <button
                    key={method}
                    type="button"
                    onClick={() => updateExpenseForm({ paymentMethod: method })}
                    className={`flex h-10 items-center justify-center gap-2 rounded-lg border text-sm font-bold transition ${
                      expenseForm.paymentMethod === method
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
                value={expenseForm.invoiceNumber}
                onChange={(event) =>
                  updateExpenseForm({ invoiceNumber: event.target.value })
                }
                placeholder="Invoice number"
                className="h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />

              <textarea
                value={expenseForm.note}
                onChange={(event) => updateExpenseForm({ note: event.target.value })}
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
          ) : null}

          {activeWorkspace === "History" ? (
          <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
            <div className="border-b border-zinc-200 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                  <CheckCircle2 size={21} />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-zinc-950">
                    Close history
                  </h2>
                  <p className="text-sm text-zinc-500">Daily profit snapshots.</p>
                </div>
              </div>
            </div>

            <div className="space-y-3 p-4">
              {dailyCloses.length === 0 ? (
                <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm font-medium text-zinc-500">
                  No closed days yet.
                </p>
              ) : null}

              {dailyCloses.slice(0, 20).map((dailyClose) => (
                <article
                  key={dailyClose.id}
                  className="rounded-lg border border-zinc-200 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold text-zinc-950">
                        {formatDateKey(dailyClose.dateKey)}
                      </p>
                      <p className="mt-1 text-xs font-semibold text-zinc-500">
                        {dailyClose.closedBy}
                      </p>
                    </div>
                    <strong
                      className={
                        dailyClose.netProfit >= 0
                          ? "text-emerald-700"
                          : "text-rose-700"
                      }
                    >
                      {formatCurrency(dailyClose.netProfit)}
                    </strong>
                  </div>
                </article>
              ))}
            </div>
          </section>
          ) : null}

          {activeWorkspace === "Expenses" || activeWorkspace === "Cash flow" ? (
          <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
                <Building2 size={21} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-zinc-950">
                  Expense mix
                </h2>
                <p className="text-sm text-zinc-500">Today by category.</p>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {categoryTotals.map((item) => (
                <div
                  key={item.category}
                  className="flex items-center justify-between rounded-lg bg-zinc-50 p-3 text-sm"
                >
                  <span className="font-semibold text-zinc-700">
                    {categoryLabels[item.category]}
                  </span>
                  <strong className="text-zinc-950">
                    {formatCurrency(item.total)}
                  </strong>
                </div>
              ))}
            </div>
          </section>
          ) : null}

          {activeWorkspace === "History" || activeWorkspace === "Close day" ? (
          <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                <CheckCircle2 size={21} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-zinc-950">
                  Close history
                </h2>
                <p className="text-sm text-zinc-500">Daily profit snapshots.</p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {dailyCloses.length === 0 ? (
                <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm font-medium text-zinc-500">
                  No closed days yet.
                </p>
              ) : null}

              {dailyCloses.slice(0, 5).map((dailyClose) => (
                <article
                  key={dailyClose.id}
                  className="rounded-lg border border-zinc-200 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold text-zinc-950">
                        {formatDateKey(dailyClose.dateKey)}
                      </p>
                      <p className="mt-1 text-xs font-semibold text-zinc-500">
                        {dailyClose.closedBy}
                      </p>
                    </div>
                    <strong
                      className={
                        dailyClose.netProfit >= 0
                          ? "text-emerald-700"
                          : "text-rose-700"
                      }
                    >
                      {formatCurrency(dailyClose.netProfit)}
                    </strong>
                  </div>
                </article>
              ))}
            </div>
          </section>
          ) : null}
        </aside>
      </section>
      <ConfirmDialog
        open={showCloseConfirm}
        title="Close business day"
        confirmLabel={todayClose ? "Reclose" : "Close"}
        confirmDestructive
        onConfirm={confirmCloseDay}
        onCancel={() => setShowCloseConfirm(false)}
      >
        <p>
          Close {summary.dateKey} with net profit of {formatCurrency(summary.netProfit)}?
          {todayClose ? " This day was already closed." : ""}
        </p>
      </ConfirmDialog>
      </>
      )}
    </main>
  )
}
