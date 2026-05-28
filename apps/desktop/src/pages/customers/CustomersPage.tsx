import { useEffect, useMemo, useRef, useState } from "react"
import { useDebounce } from "../../hooks/useDebounce"
import { useHotkeys } from "../../hooks/useHotkey"
import {
  CalendarClock,
  CreditCard,
  HandCoins,
  Phone,
  Plus,
  ReceiptText,
  Search,
  UserPlus,
  UsersRound,
  WalletCards,
  X,
} from "lucide-react"

import { formatCurrency, formatNumber } from "../../features/pos/lib/currency"
import {
  addCustomer,
  deleteCustomer,
  getCustomerActivity,
  getCustomerLedger,
  getLedgerTotals,
  recordDebtPayment,
  subscribeLedger,
  type CustomerLedger,
  type DebtPayment,
} from "../../features/pos/services/customer.service"
import { showToast } from "../../features/pos/services/toast.service"
import ConfirmDialog from "../../components/ConfirmDialog"
import { useI18n } from "@lebanonpos/shared"
import Spinner from "../../components/ui/Spinner"
import WorkspaceTabs from "../../components/ui/WorkspaceTabs"

type NewCustomerForm = {
  name: string
  mobile: string
  creditLimit: number
  notes: string
}

type PaymentForm = {
  customerId: string
  amount: number
  method: DebtPayment["method"]
  reference: string
}

type CustomerPanel = "Ledger" | "Pay debt" | "Add customer"

const emptyCustomerForm: NewCustomerForm = {
  name: "",
  mobile: "",
  creditLimit: 0,
  notes: "",
}

const paymentMethods: Array<{
  label: DebtPayment["method"]
  icon: typeof HandCoins
}> = [
  {
    label: "Cash",
    icon: HandCoins,
  },
  {
    label: "Card",
    icon: CreditCard,
  },
  {
    label: "Wallet",
    icon: WalletCards,
  },
]

function normalizeNumber(value: string) {
  const parsedValue = Number(value)

  return Number.isFinite(parsedValue) ? parsedValue : 0
}

function formatDate(value: string | null) {
  if (!value) {
    return "No activity"
  }

  return new Intl.DateTimeFormat("en-LB", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}

export default function CustomersPage() {
  const [isLoading, setIsLoading] = useState(true)
  const [customers, setCustomers] = useState<CustomerLedger[]>([])
  const [totals, setTotals] = useState(getLedgerTotals())
  const [search, setSearch] = useState("")
  const searchRef = useRef<HTMLInputElement>(null)
  useHotkeys([{ key: "f", modifiers: ["ctrl"], handler: () => searchRef.current?.focus() }])
  const debouncedSearch = useDebounce(search, 200)
  const [selectedCustomerId, setSelectedCustomerId] = useState("")
  const [newCustomer, setNewCustomer] =
    useState<NewCustomerForm>(emptyCustomerForm)
  const [payment, setPayment] = useState<PaymentForm>({
    customerId: "",
    amount: 0,
    method: "Cash",
    reference: "",
  })
  const [activePanel, setActivePanel] = useState<CustomerPanel>("Ledger")
  const [formErrors, setFormErrors] = useState<Partial<Record<"name" | "mobile", string>>>({})
  const [deleteCustomerId, setDeleteCustomerId] = useState<string | null>(null)
  const { t } = useI18n()

  function refreshLedger(preferredCustomerId?: string) {
    const nextCustomers = getCustomerLedger()

    setCustomers(nextCustomers)
    setTotals(getLedgerTotals())

    const nextSelectedId =
      preferredCustomerId ||
      selectedCustomerId ||
      nextCustomers.find((customer) => customer.balance > 0)?.id ||
      nextCustomers[0]?.id ||
      ""

    setSelectedCustomerId(nextSelectedId)
    setPayment((currentPayment) => ({
      ...currentPayment,
      customerId: preferredCustomerId || currentPayment.customerId || nextSelectedId,
    }))
  }

  useEffect(() => {
    refreshLedger()
    setIsLoading(false)

    return subscribeLedger(() => refreshLedger())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filteredCustomers = useMemo(() => {
    const query = search.trim().toLowerCase()

    if (!query) {
      return customers
    }

    return customers.filter(
      (customer) =>
        customer.name.toLowerCase().includes(query) ||
        customer.mobile.includes(query)
    )
      }, [customers, debouncedSearch])

  const selectedCustomer = customers.find(
    (customer) => customer.id === selectedCustomerId
  )
  const selectedActivity = selectedCustomer
    ? getCustomerActivity(selectedCustomer.id)
    : []

  function handleAddCustomer() {
    const errors: typeof formErrors = {}
    if (!newCustomer.name.trim()) {
      errors.name = "Name is required"
    }
    if (!newCustomer.mobile.trim()) {
      errors.mobile = "Mobile is required"
    }
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors)
      return
    }

    try {
      const customer = addCustomer(newCustomer)
      setNewCustomer(emptyCustomerForm)
      setFormErrors({})
      showToast(`${customer.name} was added.`)
      setActivePanel("Ledger")
      refreshLedger(customer.id)
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Customer not added.", "error")
    }
  }

  function handleRecordPayment() {
    const customer = customers.find(
      (currentCustomer) => currentCustomer.id === payment.customerId
    )

    if (!customer || customer.balance <= 0) {
      showToast("Choose a customer with an outstanding balance.", "error")
      return
    }

    if (!payment.customerId) {
      showToast("Please select a customer.", "error")
      return
    }

    if (payment.amount <= 0) {
      showToast("Payment amount must be greater than 0.", "error")
      return
    }

    const amount = Math.min(payment.amount, customer.balance)

    try {
      recordDebtPayment({
        customerId: customer.id,
        amount,
        method: payment.method,
        reference: payment.reference,
      })
      setPayment((currentPayment) => ({
        ...currentPayment,
        amount: 0,
        reference: "",
      }))
      setFormErrors({})
      showToast(`${formatCurrency(amount)} received from ${customer.name}.`)
      setActivePanel("Ledger")
      refreshLedger(customer.id)
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Payment not saved.", "error")
    }
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-page p-3 sm:p-5 xl:p-6">
      {isLoading ? (
        <div className="flex min-h-[400px] items-center justify-center p-6">
          <Spinner label="Loading customers..." />
        </div>
      ) : (
      <>
      <section className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-zinc-500">Customers</p>
              <p className="mt-2 text-2xl font-bold text-zinc-950">
                {formatNumber(totals.customers)}
              </p>
            </div>

            <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-zinc-500">Outstanding</p>
              <p className="mt-2 text-2xl font-bold text-rose-700">
                {formatCurrency(totals.outstanding)}
              </p>
            </div>

            <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-zinc-500">Credit sales</p>
              <p className="mt-2 text-2xl font-bold text-zinc-950">
                {formatCurrency(totals.debtTotal)}
              </p>
            </div>

            <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-zinc-500">Collected</p>
              <p className="mt-2 text-2xl font-bold text-emerald-700">
                {formatCurrency(totals.paidTotal)}
              </p>
            </div>
      </section>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <WorkspaceTabs<CustomerPanel>
          active={activePanel}
          onChange={setActivePanel}
          tabs={[
            { label: "Ledger", count: filteredCustomers.length },
            { label: "Pay debt", count: customers.filter((customer) => customer.balance > 0).length },
            { label: "Add customer" },
          ]}
        />

        <label className="relative w-full sm:w-64">
          <span className="sr-only">Search customers</span>
          <Search
            size={16}
            className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400"
          />
          <input
            ref={searchRef}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name or mobile"
            className="h-10 w-full rounded-lg border border-zinc-200 bg-white ps-9 pe-3 text-sm outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
          />
        </label>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
        <section className="min-w-0 space-y-5">
          <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-0 text-sm">
                <thead>
                  <tr className="text-start text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">
                    <th className="border-b border-zinc-200 px-4 py-3">
                      Customer
                    </th>
                    <th className="border-b border-zinc-200 px-4 py-3">
                      Contact
                    </th>
                    <th className="border-b border-zinc-200 px-4 py-3 text-end">
                      Sales
                    </th>
                    <th className="border-b border-zinc-200 px-4 py-3 text-end">
                      Paid
                    </th>
                    <th className="border-b border-zinc-200 px-4 py-3 text-end">
                      Balance
                    </th>
                    <th className="border-b border-zinc-200 px-4 py-3">
                      Mobile
                    </th>
                    <th className="border-b border-zinc-200 px-4 py-3 text-right">
                      Debt
                    </th>
                    <th className="border-b border-zinc-200 px-4 py-3 text-right">
                      Paid
                    </th>
                    <th className="border-b border-zinc-200 px-4 py-3 text-right">
                      Balance
                    </th>
                    <th className="border-b border-zinc-200 px-4 py-3">
                      Last activity
                    </th>
                    <th className="border-b border-zinc-200 px-4 py-3">
                      <span className="sr-only">Delete</span>
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {filteredCustomers.length === 0 ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-4 py-12 text-center text-sm font-medium text-zinc-500"
                      >
                        No customers found
                      </td>
                    </tr>
                  ) : null}

                  {filteredCustomers.map((customer) => {
                    const active = selectedCustomerId === customer.id

                    return (
                      <tr
                        key={customer.id}
                        onClick={() => {
                          setSelectedCustomerId(customer.id)
                          setActivePanel("Ledger")
                          setPayment((currentPayment) => ({
                            ...currentPayment,
                            customerId: customer.id,
                          }))
                        }}
                        className={`cursor-pointer transition hover:bg-zinc-50 ${
                          active ? "bg-emerald-50/70" : ""
                        }`}
                      >
                        <td className="border-b border-zinc-100 px-4 py-4">
                          <div className="font-bold text-zinc-950">
                            {customer.name}
                          </div>
                          {customer.notes ? (
                            <div className="mt-1 max-w-64 truncate text-xs text-zinc-500">
                              {customer.notes}
                            </div>
                          ) : null}
                        </td>
                        <td className="border-b border-zinc-100 px-4 py-4">
                          <a
                            href={`tel:${customer.mobile}`}
                            className="inline-flex items-center gap-2 font-semibold text-zinc-700 hover:text-emerald-700"
                          >
                            <Phone size={15} />
                            {customer.mobile}
                          </a>
                        </td>
                        <td className="border-b border-zinc-100 px-4 py-4 text-end font-semibold text-zinc-800">
                          {formatCurrency(customer.saleTotal)}
                        </td>
                        <td className="border-b border-zinc-100 px-4 py-4 text-end font-semibold text-emerald-700">
                          {formatCurrency(customer.paidTotal)}
                        </td>
                        <td className="border-b border-zinc-100 px-4 py-4 text-end font-bold text-rose-700">
                          {formatCurrency(customer.balance)}
                        </td>
                        <td className="border-b border-zinc-100 px-4 py-4 text-zinc-500">
                          {formatDate(customer.lastActivityAt)}
                        </td>
                        <td className="border-b border-zinc-100 px-4 py-4">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              setDeleteCustomerId(customer.id)
                            }}
                            className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-400 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
                            aria-label={`Delete ${customer.name}`}
                          >
                            <X size={15} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </section>

        <aside className="space-y-5">
          {activePanel === "Add customer" ? (
          <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                <UserPlus size={21} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-zinc-950">
                  Add customer
                </h2>
                <p className="text-sm text-zinc-500">
                  Name and mobile number are required.
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <input
                value={newCustomer.name}
                onChange={(event) => {
                  setNewCustomer((currentCustomer) => ({
                    ...currentCustomer,
                    name: event.target.value,
                  }))
                  if (formErrors.name) {
                    setFormErrors((currentErrors) => ({ ...currentErrors, name: undefined }))
                  }
                }}
                placeholder="Customer name"
                className={`h-11 w-full rounded-lg border bg-zinc-50 px-3 outline-none focus:bg-white focus:ring-4 ${
                  formErrors.name
                    ? "border-rose-300 focus:border-rose-400 focus:ring-rose-100"
                    : "border-zinc-200 focus:border-emerald-400 focus:ring-emerald-100"
                }`}
              />
              {formErrors.name ? (
                <p className="mt-1 text-xs font-medium text-rose-500">{formErrors.name}</p>
              ) : null}
              <input
                value={newCustomer.mobile}
                onChange={(event) => {
                  setNewCustomer((currentCustomer) => ({
                    ...currentCustomer,
                    mobile: event.target.value,
                  }))
                  if (formErrors.mobile) {
                    setFormErrors((currentErrors) => ({ ...currentErrors, mobile: undefined }))
                  }
                }}
                placeholder="Mobile number"
                className={`h-11 w-full rounded-lg border bg-zinc-50 px-3 outline-none focus:bg-white focus:ring-4 ${
                  formErrors.mobile
                    ? "border-rose-300 focus:border-rose-400 focus:ring-rose-100"
                    : "border-zinc-200 focus:border-emerald-400 focus:ring-emerald-100"
                }`}
              />
              {formErrors.mobile ? (
                <p className="mt-1 text-xs font-medium text-rose-500">{formErrors.mobile}</p>
              ) : null}
              <input
                type="number"
                min="0"
                value={newCustomer.creditLimit}
                onChange={(event) =>
                  setNewCustomer((currentCustomer) => ({
                    ...currentCustomer,
                    creditLimit: normalizeNumber(event.target.value),
                  }))
                }
                placeholder="Credit limit"
                className="h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
              <textarea
                value={newCustomer.notes}
                onChange={(event) =>
                  setNewCustomer((currentCustomer) => ({
                    ...currentCustomer,
                    notes: event.target.value,
                  }))
                }
                placeholder="Notes"
                rows={3}
                className="w-full resize-none rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
              <button
                type="button"
                onClick={handleAddCustomer}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-zinc-950 px-3 text-sm font-bold text-white transition hover:bg-zinc-800"
              >
                <Plus size={17} />
                Add Customer
              </button>
            </div>
          </section>
          ) : null}

          {activePanel === "Pay debt" ? (
          <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                <HandCoins size={21} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-zinc-950">
                  Pay debt
                </h2>
                <p className="text-sm text-zinc-500">
                  Record a later payment against an account.
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <select
                value={payment.customerId || selectedCustomerId}
                onChange={(event) => {
                  setSelectedCustomerId(event.target.value)
                  setPayment((currentPayment) => ({
                    ...currentPayment,
                    customerId: event.target.value,
                  }))
                }}
                className="h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              >
                <option value="">Choose customer</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name} - {formatCurrency(customer.balance)}
                  </option>
                ))}
              </select>

              <input
                type="number"
                min="0"
                step="0.01"
                value={payment.amount}
                onChange={(event) =>
                  setPayment((currentPayment) => ({
                    ...currentPayment,
                    amount: normalizeNumber(event.target.value),
                  }))
                }
                placeholder="Payment amount"
                className="h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />

              <div className="grid grid-cols-3 gap-2">
                {paymentMethods.map((method) => {
                  const Icon = method.icon
                  const active = payment.method === method.label

                  return (
                    <button
                      key={method.label}
                      type="button"
                      onClick={() =>
                        setPayment((currentPayment) => ({
                          ...currentPayment,
                          method: method.label,
                        }))
                      }
                      className={`flex h-11 items-center justify-center gap-2 rounded-lg border text-sm font-bold transition ${
                        active
                          ? "border-emerald-600 bg-emerald-50 text-emerald-800"
                          : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                      }`}
                    >
                      <Icon size={16} />
                      {method.label}
                    </button>
                  )
                })}
              </div>

              <input
                value={payment.reference}
                onChange={(event) =>
                  setPayment((currentPayment) => ({
                    ...currentPayment,
                    reference: event.target.value,
                  }))
                }
                placeholder="Reference or note"
                className="h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />

              <button
                type="button"
                onClick={handleRecordPayment}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 text-sm font-bold text-white transition hover:bg-emerald-500"
              >
                <HandCoins size={17} />
                Record Payment
              </button>
            </div>
          </section>
          ) : null}

          {activePanel === "Ledger" ? (
          <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
                <UsersRound size={21} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-zinc-950">Ledger</h2>
                <p className="text-sm text-zinc-500">Customer payments and debt activity.</p>
              </div>
            </div>

            {selectedCustomer ? (
              <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-bold text-zinc-950">
                      {selectedCustomer.name}
                    </p>
                    <p className="text-sm text-zinc-500">
                      {selectedCustomer.mobile}
                    </p>
                  </div>
                  <div className="text-end">
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">
                      Balance
                    </p>
                    <p className="text-lg font-bold text-rose-700">
                      {formatCurrency(selectedCustomer.balance)}
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="mt-4 max-h-80 space-y-2 overflow-y-auto">
              {selectedActivity.length === 0 ? (
                <div className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm font-medium text-zinc-500">
                  No activity yet
                </div>
              ) : null}

              {selectedActivity.map((activity) => (
                <div
                  key={`${activity.type}-${activity.id}`}
                  className="rounded-lg border border-zinc-200 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2">
                      {activity.type === "Sale" ? (
                        <ReceiptText
                          size={17}
                          className="mt-0.5 text-rose-600"
                        />
                      ) : (
                        <HandCoins
                          size={17}
                          className="mt-0.5 text-emerald-600"
                        />
                      )}
                      <div>
                        <p className="font-bold text-zinc-950">
                          {activity.title}
                        </p>
                        <p className="text-sm text-zinc-500">
                          {activity.detail}
                        </p>
                      </div>
                    </div>
                    <p
                      className={`font-bold ${
                        activity.type === "Sale"
                          ? "text-rose-700"
                          : "text-emerald-700"
                      }`}
                    >
                      {activity.type === "Sale" ? "+" : "-"}
                      {formatCurrency(activity.amount)}
                    </p>
                  </div>
                  <p className="mt-2 flex items-center gap-1 text-xs font-medium text-zinc-500">
                    <CalendarClock size={13} />
                    {formatDate(activity.createdAt)}
                  </p>
                </div>
              ))}
            </div>
          </section>
          ) : null}
        </aside>
      </div>
      <ConfirmDialog
        open={deleteCustomerId !== null}
        title="Delete customer"
        confirmLabel={t("pos.delete")}
        confirmDestructive
        onConfirm={() => {
          if (deleteCustomerId !== null) {
            deleteCustomer(deleteCustomerId)
            setDeleteCustomerId(null)
          }
        }}
        onCancel={() => setDeleteCustomerId(null)}
      >
        <p>Delete this customer and their ledger? This cannot be undone.</p>
      </ConfirmDialog>
      </>
      )}
    </main>
  )
}
