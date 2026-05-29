import { useEffect, useMemo, useState } from "react"
import { useI18n } from "@lebanonpos/shared"

import { getSales, subscribeSales, getRefunds, subscribeRefunds } from "../../features/pos/services/sales.service"
import { getExpenses, subscribeExpenses } from "../../features/pos/services/expense.service"
import { getSupplierPayments, subscribeSuppliers } from "../../features/pos/services/supplier.service"
import { getDailyCloses, subscribeDailyCloses } from "../../features/pos/services/dailyClose.service"
import { userCan } from "../../features/pos/services/security.service"
import { closeBusinessDay } from "../../features/pos/services/dailyClose.service"
import { showToast } from "../../features/pos/services/toast.service"

import Spinner from "../../components/ui/Spinner"
import WorkspaceTabs from "../../components/ui/WorkspaceTabs"
import ConfirmDialog from "../../components/ConfirmDialog"

import {
  getAccountingSummary,
  formatDateKey,
  isToday,
  expenseCategories,
  type AccountingWorkspace,
} from "./accounting.helpers"
import { formatCurrency } from "../../features/pos/lib/currency"
import type {
  Expense,
  ExpenseCategory,
  ExpensePaymentMethod,
} from "../../features/pos/services/expense.service"
import type {
  Sale,
  SaleRefund,
} from "../../features/pos/services/sales.service"
import type {
  SupplierPayment,
} from "../../features/pos/services/supplier.service"
import type { DailyClose } from "../../features/pos/services/dailyClose.service"

import AccountingKpiCards from "./components/AccountingKpiCards"
import CloseDayPanel from "./components/CloseDayPanel"
import CashFlowPanel from "./components/CashFlowPanel"
import ExpensesPanel from "./components/ExpensesPanel"
import ExpenseFormPanel from "./components/ExpenseForm"
import ExpenseMixPanel from "./components/ExpenseMixPanel"
import HistoryPanel from "./components/HistoryPanel"

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
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)
  const [activeWorkspace, setActiveWorkspace] =
    useState<AccountingWorkspace>("Close day")
  const canManageAccounting = userCan("accounting.manage")

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

  function handleCloseDay() {
    setShowCloseConfirm(true)
  }

  function confirmCloseDay() {
    if (!canManageAccounting) {
      showToast(t("pos.permission_required"), "error")
      return
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
      note: "",
    })
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
        <AccountingKpiCards
          summary={summary}
          todayExpensesCount={todayExpenses.length}
          todayClose={todayClose}
        />

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
              <CloseDayPanel
                summary={summary}
                todayClose={!!todayClose}
                onCloseDay={handleCloseDay}
                canManageAccounting={canManageAccounting}
              />
            ) : null}

            {activeWorkspace === "Cash flow" ? (
              <CashFlowPanel
                summary={summary}
                categoryTotals={categoryTotals}
                categoryLabels={categoryLabels}
              />
            ) : null}

            {activeWorkspace === "Expenses" ? (
              <ExpensesPanel
                expenses={recentExpenses}
                categoryLabels={categoryLabels}
                paymentMethodLabels={paymentMethodLabels}
              />
            ) : null}
          </div>

          <aside className="space-y-5">
            {activeWorkspace === "Expenses" ? (
              <ExpenseFormPanel canManageAccounting={canManageAccounting} />
            ) : null}

            {activeWorkspace === "History" ? (
              <HistoryPanel dailyCloses={dailyCloses} maxItems={20} />
            ) : null}

            {activeWorkspace === "Expenses" || activeWorkspace === "Cash flow" ? (
              <ExpenseMixPanel
                categoryTotals={categoryTotals}
                categoryLabels={categoryLabels}
              />
            ) : null}

            {activeWorkspace === "History" || activeWorkspace === "Close day" ? (
              <HistoryPanel dailyCloses={dailyCloses} maxItems={5} />
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
