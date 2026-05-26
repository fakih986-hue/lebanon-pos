import { useEffect, useMemo, useState } from "react"
import {
  BadgeCheck,
  Calculator,
  Clock3,
  KeyRound,
  LockKeyhole,
  Plus,
  ReceiptText,
  ShieldCheck,
  Store,
  UserCog,
  UsersRound,
} from "lucide-react"

import { formatCurrency, formatNumber } from "../../features/pos/lib/currency"
import {
  getExpenses,
  subscribeExpenses,
  type Expense,
} from "../../features/pos/services/expense.service"
import {
  getRefunds,
  getSales,
  subscribeSales,
  subscribeRefunds,
  type Sale,
  type SaleRefund,
} from "../../features/pos/services/sales.service"
import {
  closeShift,
  createUser,
  getActiveShift,
  getAuditEvents,
  getCurrentUser,
  getShifts,
  getUsers,
  openShift,
  rolePermissions,
  setCurrentUser,
  subscribeSecurity,
  updateUser,
  type AuditEvent,
  type Shift,
  type StaffUser,
  type UserRole,
} from "../../features/pos/services/security.service"
import {
  getSupplierPayments,
  subscribeSuppliers,
  type SupplierPayment,
} from "../../features/pos/services/supplier.service"
import { showToast } from "../../features/pos/services/toast.service"
import ConfirmDialog from "../../components/ConfirmDialog"
import Spinner from "../../components/ui/Spinner"

const roleLabels: Record<UserRole, string> = {
  Admin: "Full control",
  Manager: "Daily control",
  Cashier: "Checkout only",
}

const permissionLabels: Record<string, string> = {
  "sales.checkout": "Checkout",
  "sales.discount": "Discounts",
  "sales.refund": "Refunds",
  "sales.void": "Void sales",
  "inventory.manage": "Inventory",
  "customers.manage": "Customers",
  "reports.view": "Reports",
  "accounting.manage": "Accounting",
  "settings.manage": "Settings",
  "staff.manage": "Staff",
  "shifts.manage": "Shifts",
}

const cashDenominations = [100, 50, 20, 10, 5, 1, 0.25]

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-LB", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}

function parseMoney(value: string) {
  const parsedValue = Number(value.replace(/,/g, "").trim())

  return Number.isFinite(parsedValue) ? Math.max(0, parsedValue) : 0
}

function saleBelongsToShift(sale: Sale, shift: Shift) {
  if (sale.shiftId) {
    return sale.shiftId === shift.id
  }

  const saleAt = new Date(sale.createdAt).getTime()
  const openedAt = new Date(shift.openedAt).getTime()
  const closedAt = shift.closedAt
    ? new Date(shift.closedAt).getTime()
    : Number.POSITIVE_INFINITY

  return saleAt >= openedAt && saleAt <= closedAt
}

function getShiftCashSales(shift: Shift | undefined, sales: Sale[]) {
  if (!shift) {
    return 0
  }

  return sales
    .filter(
      (sale) => sale.paymentMethod === "Cash" && saleBelongsToShift(sale, shift)
    )
    .reduce((sum, sale) => sum + sale.total, 0)
}

function refundBelongsToShift(refund: SaleRefund, shift: Shift) {
  if (refund.shiftId) {
    return refund.shiftId === shift.id
  }

  const refundAt = new Date(refund.createdAt).getTime()
  const openedAt = new Date(shift.openedAt).getTime()
  const closedAt = shift.closedAt
    ? new Date(shift.closedAt).getTime()
    : Number.POSITIVE_INFINITY

  return refundAt >= openedAt && refundAt <= closedAt
}

function getShiftCashRefunds(shift: Shift | undefined, refunds: SaleRefund[]) {
  if (!shift) {
    return 0
  }

  return refunds
    .filter(
      (refund) => refund.method === "Cash" && refundBelongsToShift(refund, shift)
    )
    .reduce((sum, refund) => sum + refund.total, 0)
}

function expenseBelongsToShift(expense: Expense, shift: Shift) {
  if (expense.shiftId) {
    return expense.shiftId === shift.id
  }

  const expenseAt = new Date(expense.createdAt).getTime()
  const openedAt = new Date(shift.openedAt).getTime()
  const closedAt = shift.closedAt
    ? new Date(shift.closedAt).getTime()
    : Number.POSITIVE_INFINITY

  return expenseAt >= openedAt && expenseAt <= closedAt
}

function getShiftCashExpenses(shift: Shift | undefined, expenses: Expense[]) {
  if (!shift) {
    return 0
  }

  return expenses
    .filter(
      (expense) =>
        expense.paymentMethod === "Cash" && expenseBelongsToShift(expense, shift)
    )
    .reduce((sum, expense) => sum + expense.amount, 0)
}

function supplierPaymentBelongsToShift(payment: SupplierPayment, shift: Shift) {
  if (payment.shiftId) {
    return payment.shiftId === shift.id
  }

  const paymentAt = new Date(payment.createdAt).getTime()
  const openedAt = new Date(shift.openedAt).getTime()
  const closedAt = shift.closedAt
    ? new Date(shift.closedAt).getTime()
    : Number.POSITIVE_INFINITY

  return paymentAt >= openedAt && paymentAt <= closedAt
}

function getShiftCashSupplierPayments(
  shift: Shift | undefined,
  payments: SupplierPayment[]
) {
  if (!shift) {
    return 0
  }

  return payments
    .filter(
      (payment) =>
        payment.method === "Cash" && supplierPaymentBelongsToShift(payment, shift)
    )
    .reduce((sum, payment) => sum + payment.amount, 0)
}

function AuditRow({ event }: { event: AuditEvent }) {
  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold text-zinc-950">{event.summary}</p>
          <p className="mt-1 text-sm text-zinc-500">
            {event.userName} - {event.userRole} - {formatDateTime(event.createdAt)}
          </p>
        </div>
        <span className="shrink-0 rounded-lg bg-zinc-100 px-2 py-1 text-xs font-bold text-zinc-600">
          {event.action}
        </span>
      </div>
    </article>
  )
}

export default function StaffPage() {
  const [isLoading, setIsLoading] = useState(true)
  const [users, setUsers] = useState<StaffUser[]>(getUsers())
  const [activeUserId, setActiveUserId] = useState(getCurrentUser().id)
  const [shifts, setShifts] = useState<Shift[]>(getShifts())
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>(getAuditEvents())
  const [sales, setSales] = useState<Sale[]>(getSales())
  const [refunds, setRefunds] = useState<SaleRefund[]>(getRefunds())
  const [expenses, setExpenses] = useState<Expense[]>(getExpenses())
  const [supplierPayments, setSupplierPayments] = useState<SupplierPayment[]>(
    getSupplierPayments()
  )
  const [name, setName] = useState("")
  const [mobile, setMobile] = useState("")
  const [pin, setPin] = useState("")
  const [role, setRole] = useState<UserRole>("Cashier")
  const [openingFloat, setOpeningFloat] = useState("250")
  const [closingCash, setClosingCash] = useState("")
  const [shiftNotes, setShiftNotes] = useState("")
  const [cashCounts, setCashCounts] = useState<Record<string, string>>({})
  const [confirmAction, setConfirmAction] = useState<{
    title: string
    message: string
    confirmLabel: string
    confirmDestructive?: boolean
    onConfirm: () => void
  } | null>(null)

  useEffect(() => {
    setIsLoading(false)

    function refreshSecurity() {
      setUsers(getUsers())
      setActiveUserId(getCurrentUser().id)
      setShifts(getShifts())
      setAuditEvents(getAuditEvents())
    }

    const unsubscribeSecurity = subscribeSecurity(refreshSecurity)
    const unsubscribeSales = subscribeSales(setSales)
    const unsubscribeRefunds = subscribeRefunds(setRefunds)
    const unsubscribeExpenses = subscribeExpenses(setExpenses)
    const unsubscribeSuppliers = subscribeSuppliers(() =>
      setSupplierPayments(getSupplierPayments())
    )

    return () => {
      unsubscribeSecurity()
      unsubscribeSales()
      unsubscribeRefunds()
      unsubscribeExpenses()
      unsubscribeSuppliers()
    }
  }, [])

  const activeUser = useMemo(() => getCurrentUser(), [activeUserId, users])
  const activeShift = useMemo(() => getActiveShift(), [shifts])
  const cashSales = useMemo(
    () => getShiftCashSales(activeShift, sales),
    [activeShift, sales]
  )
  const cashRefunds = useMemo(
    () => getShiftCashRefunds(activeShift, refunds),
    [activeShift, refunds]
  )
  const cashExpenses = useMemo(
    () => getShiftCashExpenses(activeShift, expenses),
    [activeShift, expenses]
  )
  const cashSupplierPayments = useMemo(
    () => getShiftCashSupplierPayments(activeShift, supplierPayments),
    [activeShift, supplierPayments]
  )
  const expectedCash =
    (activeShift?.openingFloatUsd ?? 0) +
    cashSales -
    cashRefunds -
    cashExpenses -
    cashSupplierPayments
  const countedCash = cashDenominations.reduce(
    (sum, denomination) =>
      sum + denomination * parseMoney(cashCounts[String(denomination)] ?? ""),
    0
  )
  const closingDifference = parseMoney(closingCash) - expectedCash

  async function handleCreateUser() {
    if (!name.trim() || !mobile.trim() || !pin.trim()) {
      showToast("Add name, mobile, and PIN before saving a user.", "error")
      return
    }

    const user = await createUser({
      name,
      mobile,
      pin,
      role,
    })

    setName("")
    setMobile("")
    setPin("")
    setRole("Cashier")
    showToast(`${user.name} was added.`)
  }

  function handleOpenShift() {
    const shift = openShift(parseMoney(openingFloat))

    showToast(`${shift.shiftNumber} is open.`)
  }

  function handleCloseShift() {
    if (!activeShift) {
      showToast("No active shift to close.", "error")
      return
    }
    setConfirmAction({
      title: "Close shift",
      message: `Close ${activeShift.shiftNumber} with ${formatCurrency(expectedCash)} expected cash?`,
      confirmLabel: "Close Shift",
      confirmDestructive: true,
      onConfirm: () => {
        const closedShift = closeShift({
          shiftId: activeShift.id,
          cashSalesUsd: cashSales,
          cashRefundsUsd: cashRefunds,
          cashExpensesUsd: cashExpenses,
          supplierPaymentsUsd: cashSupplierPayments,
          expectedCashUsd: expectedCash,
          closingCashUsd: parseMoney(closingCash),
          notes: shiftNotes,
        })
        if (closedShift) {
          setClosingCash("")
          setShiftNotes("")
          setCashCounts({})
          showToast(`${closedShift.shiftNumber} closed.`)
        }
      },
    })
  }

  function updateCashCount(denomination: number, value: string) {
    setCashCounts((currentCounts) => ({
      ...currentCounts,
      [String(denomination)]: value,
    }))
  }

  function applyCashCount() {
    setClosingCash(countedCash.toFixed(2))
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-[#eef3f2] p-3 sm:p-5 xl:p-6">
      {isLoading ? (
        <div className="flex min-h-[400px] items-center justify-center p-6">
          <Spinner label="Loading staff data..." />
        </div>
      ) : (
      <>
      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-zinc-500">Active user</p>
            <UserCog size={20} className="text-emerald-700" />
          </div>
          <p className="mt-3 text-2xl font-bold text-zinc-950">
            {activeUser.name}
          </p>
          <p className="mt-1 text-sm text-zinc-500">{activeUser.role}</p>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-zinc-500">Shift</p>
            <Clock3 size={20} className="text-indigo-700" />
          </div>
          <p className="mt-3 text-2xl font-bold text-zinc-950">
            {activeShift?.shiftNumber ?? "Closed"}
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            {activeShift ? `Opened ${formatDateTime(activeShift.openedAt)}` : "No active shift"}
          </p>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-zinc-500">Expected cash</p>
            <Store size={20} className="text-amber-700" />
          </div>
          <p className="mt-3 text-2xl font-bold text-zinc-950">
            {formatCurrency(expectedCash)}
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            {formatCurrency(cashSales)} sales -{" "}
            {formatCurrency(cashRefunds + cashExpenses + cashSupplierPayments)} out
          </p>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-zinc-500">Audit events</p>
            <ReceiptText size={20} className="text-zinc-700" />
          </div>
          <p className="mt-3 text-2xl font-bold text-zinc-950">
            {formatNumber(auditEvents.length)}
          </p>
          <p className="mt-1 text-sm text-zinc-500">Last 500 kept locally</p>
        </div>
      </section>

      <section className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
        <div className="space-y-5">
          <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-zinc-200 p-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-zinc-950 text-white">
                  <UsersRound size={21} />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-zinc-950">
                    Staff users
                  </h2>
                  <p className="text-sm text-zinc-500">
                    Add operators and control who is active at the register.
                  </p>
                </div>
              </div>

              <select
                value={activeUserId}
                onChange={(event) => setCurrentUser(event.target.value)}
                className="h-11 rounded-lg border border-zinc-200 bg-zinc-50 px-3 font-semibold text-zinc-700 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              >
                {users
                  .filter((user) => user.active)
                  .map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name} - {user.role}
                    </option>
                  ))}
              </select>
            </div>

            <div className="grid gap-4 p-4 lg:grid-cols-2">
              {users.map((user) => (
                <article
                  key={user.id}
                  className={`rounded-lg border p-4 ${
                    user.id === activeUser.id
                      ? "border-emerald-300 bg-emerald-50"
                      : "border-zinc-200 bg-white"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-bold text-zinc-950">{user.name}</h3>
                      <p className="mt-1 text-sm text-zinc-500">{user.mobile}</p>
                    </div>
                    <span
                      className={`rounded-lg px-2 py-1 text-xs font-bold ${
                        user.active
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-zinc-100 text-zinc-500"
                      }`}
                    >
                      {user.active ? "Active" : "Disabled"}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
                    <span className="rounded-lg bg-zinc-100 px-2 py-1 text-zinc-700">
                      {user.role}
                    </span>

                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setCurrentUser(user.id)}
                      disabled={!user.active}
                      className="flex h-10 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-3 text-sm font-bold text-white transition hover:bg-zinc-800 disabled:bg-zinc-200 disabled:text-zinc-400"
                    >
                      <BadgeCheck size={16} />
                      Use
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const label = user.active ? "Disable" : "Enable"
                        setConfirmAction({
                          title: `${label} user`,
                          message: `${label} ${user.name}?`,
                          confirmLabel: label,
                          confirmDestructive: user.active,
                          onConfirm: async () => {
                            await updateUser(user.id, { active: !user.active })
                          },
                        })
                      }}
                      className="flex h-10 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-bold text-zinc-700 transition hover:bg-zinc-50"
                    >
                      <LockKeyhole size={16} />
                      {user.active ? "Disable" : "Enable"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
            <div className="border-b border-zinc-200 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                  <Plus size={21} />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-zinc-950">
                    Add staff user
                  </h2>
                  <p className="text-sm text-zinc-500">Add new staff users with role-based permissions.</p>
                </div>
              </div>
            </div>

            <div className="grid gap-4 p-4 md:grid-cols-2">
              <label className="block text-sm font-bold text-zinc-700">
                Name
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                />
              </label>

              <label className="block text-sm font-bold text-zinc-700">
                Mobile
                <input
                  value={mobile}
                  onChange={(event) => setMobile(event.target.value)}
                  className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                />
              </label>

              <label className="block text-sm font-bold text-zinc-700">
                PIN
                <input
                  value={pin}
                  onChange={(event) => setPin(event.target.value)}
                  maxLength={6}
                  className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                />
              </label>

              <label className="block text-sm font-bold text-zinc-700">
                Role
                <select
                  value={role}
                  onChange={(event) => setRole(event.target.value as UserRole)}
                  className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                >
                  <option value="Cashier">Cashier</option>
                  <option value="Manager">Manager</option>
                  <option value="Admin">Admin</option>
                </select>
              </label>
            </div>

            <div className="flex justify-end border-t border-zinc-200 p-4">
              <button
                type="button"
                onClick={handleCreateUser}
                className="flex h-11 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-bold text-white transition hover:bg-emerald-500"
              >
                <Plus size={17} />
                Add User
              </button>
            </div>
          </section>
        </div>

        <aside className="space-y-5">
          <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-zinc-950 text-white">
                <Clock3 size={21} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-zinc-950">
                  Shift control
                </h2>
                <p className="text-sm text-zinc-500">
                  Open, close, and count register cash.
                </p>
              </div>
            </div>

            {activeShift ? (
              <div className="mt-4 space-y-3">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
                  <div className="flex justify-between gap-3">
                    <span>Opening float</span>
                    <strong>{formatCurrency(activeShift.openingFloatUsd)}</strong>
                  </div>
                  <div className="mt-2 flex justify-between gap-3">
                    <span>Cash sales</span>
                    <strong>{formatCurrency(cashSales)}</strong>
                  </div>
                  <div className="mt-2 flex justify-between gap-3">
                    <span>Cash returns</span>
                    <strong>-{formatCurrency(cashRefunds)}</strong>
                  </div>
                  <div className="mt-2 flex justify-between gap-3">
                    <span>Cash expenses</span>
                    <strong>-{formatCurrency(cashExpenses)}</strong>
                  </div>
                  <div className="mt-2 flex justify-between gap-3">
                    <span>Supplier payments</span>
                    <strong>-{formatCurrency(cashSupplierPayments)}</strong>
                  </div>
                  <div className="mt-2 flex justify-between gap-3 border-t border-emerald-200 pt-2 text-base">
                    <span>Expected cash</span>
                    <strong>{formatCurrency(expectedCash)}</strong>
                  </div>
                </div>

                <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm font-bold text-indigo-950">
                      <Calculator size={17} />
                      Cash count
                    </div>
                    <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-indigo-800 ring-1 ring-indigo-200">
                      {formatCurrency(countedCash)}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {cashDenominations.map((denomination) => (
                      <label
                        key={denomination}
                        className="block text-xs font-bold text-indigo-950"
                      >
                        ${denomination}
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={cashCounts[String(denomination)] ?? ""}
                          onChange={(event) =>
                            updateCashCount(denomination, event.target.value)
                          }
                          className="mt-1 h-10 w-full rounded-lg border border-indigo-200 bg-white px-2 text-right text-zinc-900 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                        />
                      </label>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={applyCashCount}
                    className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-indigo-700 px-3 text-sm font-bold text-white transition hover:bg-indigo-600"
                  >
                    <Calculator size={16} />
                    Use Count
                  </button>
                </div>

                <label className="block text-sm font-bold text-zinc-700">
                  Closing cash
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={closingCash}
                    onChange={(event) => setClosingCash(event.target.value)}
                    className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                  />
                </label>

                <div
                  className={`rounded-lg p-3 text-sm font-bold ${
                    closingCash
                      ? Math.abs(closingDifference) < 0.01
                        ? "bg-emerald-50 text-emerald-800"
                        : "bg-amber-50 text-amber-900"
                      : "bg-zinc-50 text-zinc-500"
                  }`}
                >
                  Difference {formatCurrency(closingCash ? closingDifference : 0)}
                </div>

                <label className="block text-sm font-bold text-zinc-700">
                  Notes
                  <textarea
                    value={shiftNotes}
                    onChange={(event) => setShiftNotes(event.target.value)}
                    rows={3}
                    className="mt-2 w-full resize-none rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                  />
                </label>

                <button
                  type="button"
                  onClick={handleCloseShift}
                  disabled={!closingCash}
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-zinc-950 px-3 text-sm font-bold text-white transition hover:bg-zinc-800 disabled:bg-zinc-200 disabled:text-zinc-400"
                >
                  <KeyRound size={17} />
                  Close Shift
                </button>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <label className="block text-sm font-bold text-zinc-700">
                  Opening float
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={openingFloat}
                    onChange={(event) => setOpeningFloat(event.target.value)}
                    className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                  />
                </label>
                <button
                  type="button"
                  onClick={handleOpenShift}
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 text-sm font-bold text-white transition hover:bg-emerald-500"
                >
                  <Clock3 size={17} />
                  Open Shift
                </button>
              </div>
            )}
          </section>

          <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
                <ShieldCheck size={21} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-zinc-950">
                  Role permissions
                </h2>
                <p className="text-sm text-zinc-500">
                  Permission model ready for backend enforcement.
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {(Object.keys(rolePermissions) as UserRole[]).map((roleName) => (
                <div key={roleName} className="rounded-lg bg-zinc-50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-bold text-zinc-950">{roleName}</p>
                    <span className="text-xs font-bold text-zinc-500">
                      {roleLabels[roleName]}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {rolePermissions[roleName].map((permission) => (
                      <span
                        key={permission}
                        className="rounded-lg bg-white px-2 py-1 text-xs font-bold text-zinc-600 ring-1 ring-zinc-200"
                      >
                        {permissionLabels[permission]}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </section>

      <section className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.7fr)]">
        <div className="rounded-lg border border-zinc-200 bg-white shadow-sm">
          <div className="border-b border-zinc-200 p-4">
            <h2 className="text-xl font-bold text-zinc-950">Audit trail</h2>
            <p className="text-sm text-zinc-500">
              Every important operator, sale, and shift event is tracked.
            </p>
          </div>
          <div className="max-h-[520px] space-y-3 overflow-y-auto bg-zinc-50 p-4">
            {auditEvents.slice(0, 60).map((event) => (
              <AuditRow key={event.id} event={event} />
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white shadow-sm">
          <div className="border-b border-zinc-200 p-4">
            <h2 className="text-xl font-bold text-zinc-950">Shift history</h2>
            <p className="text-sm text-zinc-500">
              Closed shifts keep expected cash and difference.
            </p>
          </div>
          <div className="max-h-[520px] space-y-3 overflow-y-auto p-4">
            {shifts.map((shift) => (
              <article
                key={shift.id}
                className="rounded-lg border border-zinc-200 bg-white p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-zinc-950">
                      {shift.shiftNumber}
                    </p>
                    <p className="mt-1 text-sm text-zinc-500">
                      {formatDateTime(shift.openedAt)}
                      {shift.closedAt ? ` - ${formatDateTime(shift.closedAt)}` : ""}
                    </p>
                  </div>
                  <span
                    className={`rounded-lg px-2 py-1 text-xs font-bold ${
                      shift.status === "Open"
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-zinc-100 text-zinc-600"
                    }`}
                  >
                    {shift.status}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-lg bg-zinc-50 p-2">
                    <p className="text-zinc-500">Opened by</p>
                    <p className="font-bold text-zinc-950">
                      {shift.openedByName}
                    </p>
                  </div>
                  <div className="rounded-lg bg-zinc-50 p-2">
                    <p className="text-zinc-500">Expected</p>
                    <p className="font-bold text-zinc-950">
                      {shift.expectedCashUsd === undefined
                        ? "-"
                        : formatCurrency(shift.expectedCashUsd)}
                    </p>
                  </div>
                  <div className="rounded-lg bg-zinc-50 p-2">
                    <p className="text-zinc-500">Returns</p>
                    <p className="font-bold text-rose-700">
                      {shift.cashRefundsUsd === undefined
                        ? "-"
                        : formatCurrency(shift.cashRefundsUsd)}
                    </p>
                  </div>
                  <div className="rounded-lg bg-zinc-50 p-2">
                    <p className="text-zinc-500">Cash out</p>
                    <p className="font-bold text-rose-700">
                      {formatCurrency(
                        (shift.cashExpensesUsd ?? 0) +
                          (shift.supplierPaymentsUsd ?? 0)
                      )}
                    </p>
                  </div>
                  <div className="rounded-lg bg-zinc-50 p-2">
                    <p className="text-zinc-500">Difference</p>
                    <p className="font-bold text-zinc-950">
                      {shift.differenceUsd === undefined
                        ? "-"
                        : formatCurrency(shift.differenceUsd)}
                    </p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
      {confirmAction && (
        <ConfirmDialog
          open={!!confirmAction}
          title={confirmAction.title}
          confirmLabel={confirmAction.confirmLabel}
          confirmDestructive={confirmAction.confirmDestructive}
          onConfirm={() => {
            confirmAction.onConfirm()
            setConfirmAction(null)
          }}
          onCancel={() => setConfirmAction(null)}
        >
          <p>{confirmAction.message}</p>
        </ConfirmDialog>
      )}
      </>
      )}
    </main>
  )
}
