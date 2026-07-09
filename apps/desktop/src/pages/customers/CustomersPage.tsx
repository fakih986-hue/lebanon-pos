import { useEffect, useMemo, useRef, useState } from "react"
import { useDebounce } from "../../hooks/useDebounce"
import { useHotkeys } from "../../hooks/useHotkey"
import {
  CalendarClock,
  CreditCard,
  Download,
  HandCoins,
  MessageCircle,
  Pencil,
  Phone,
  Plus,
  Printer,
  ReceiptText,
  Search,
  UserPlus,
  UsersRound,
  WalletCards,
  X,
} from "lucide-react"
import { formatCurrency, formatLbpCurrency, formatNumber, usdToLbp } from "../../features/pos/lib/currency"
import {
  addCustomer,
  archiveCustomer,
  buildCustomerStatement,
  deleteCustomer,
  getCustomerActivity,
  getCustomerLedger,
  getLedgerTotals,
  recordDebtPayment,
  restoreCustomer,
  subscribeLedger,
  updateCustomer,
  type CustomerLedger,
  type DebtPayment,
} from "../../features/pos/services/customer.service"
import { getSettings } from "../../features/pos/services/settings.service"
import { openWhatsApp, debtReminderMessage } from "../../features/pos/lib/whatsapp"
import { showToast } from "../../features/pos/services/toast.service"
import ConfirmDialog from "../../components/ConfirmDialog"
import { useI18n } from "@lebanonpos/shared"
import Spinner from "../../components/ui/Spinner"
import WorkspaceTabs from "../../components/ui/WorkspaceTabs"

type NewCustomerForm = {
  name: string
  mobile: string
  creditLimit: number
  isWholesale: boolean
  sellAtCost: boolean
  notes: string
}

type PaymentForm = {
  customerId: string
  amount: number
  method: DebtPayment["method"]
  reference: string
}

type EditCustomerForm = {
  id: string
  name: string
  mobile: string
  creditLimit: number
  isWholesale: boolean
  sellAtCost: boolean
  notes: string
}

type CustomerPanel = "Ledger" | "Pay debt" | "Add customer"

const emptyCustomerForm: NewCustomerForm = {
  name: "",
  mobile: "",
  creditLimit: 0,
  isWholesale: false,
  sellAtCost: false,
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
  {
    label: "Bank Transfer",
    icon: HandCoins,
  },
  {
    label: "Refund Credit",
    icon: HandCoins,
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
  const [editCustomer, setEditCustomer] = useState<EditCustomerForm | null>(null)
  const [sortBy, setSortBy] = useState<"name" | "balance" | "lastActivity">("name")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [agingFilter, setAgingFilter] = useState<string>("")
  const [showArchived, setShowArchived] = useState(false)
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

  const agingTotals = useMemo(() => {
    return customers.reduce(
      (acc, c) => ({
        current: acc.current + c.aging.current,
        days30: acc.days30 + c.aging.days30,
        days60: acc.days60 + c.aging.days60,
        days90: acc.days90 + c.aging.days90,
      }),
      { current: 0, days30: 0, days60: 0, days90: 0 }
    )
  }, [customers])

  const filteredCustomers = useMemo(() => {
    let list = customers.filter(c => showArchived ? c.archived === true : !c.archived)

    if (agingFilter) {
      const days = parseInt(agingFilter)
      if (!isNaN(days)) {
        list = list.filter(c => {
          const total = c.aging.current + c.aging.days30 + c.aging.days60 + c.aging.days90
          return total > 0.001 && c.oldestUnpaidDays >= days && c.oldestUnpaidDays < days + 30
        })
      }
    }

    const query = search.trim().toLowerCase()
    if (query) {
      list = list.filter(c => c.name.toLowerCase().includes(query) || c.mobile.includes(query))
    }

    return list.sort((a, b) => {
      const cmp = sortDir === "asc" ? 1 : -1
      if (sortBy === "balance") return (b.balance - a.balance) * cmp
      if (sortBy === "lastActivity") return ((a.lastActivityAt ?? "").localeCompare(b.lastActivityAt ?? "")) * cmp
      return a.name.localeCompare(b.name) * cmp
    })
  }, [customers, debouncedSearch, sortBy, sortDir, agingFilter, showArchived])

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

  function openEdit(customer: CustomerLedger) {
    setEditCustomer({
      id: customer.id,
      name: customer.name,
      mobile: customer.mobile,
      creditLimit: customer.creditLimit,
      isWholesale: customer.isWholesale ?? false,
      sellAtCost: customer.sellAtCost ?? false,
      notes: customer.notes,
    })
  }

  function saveEdit() {
    if (!editCustomer) return
    updateCustomer(editCustomer.id, {
      name: editCustomer.name,
      mobile: editCustomer.mobile,
      creditLimit: editCustomer.creditLimit,
      isWholesale: editCustomer.isWholesale,
      sellAtCost: editCustomer.sellAtCost,
      notes: editCustomer.notes,
    })
    showToast(`${editCustomer.name} updated.`)
    setEditCustomer(null)
  }

  function quickToggleSellAtCost(customer: CustomerLedger) {
    updateCustomer(customer.id, { sellAtCost: !customer.sellAtCost })
    showToast(`${customer.name}: sell at cost ${!customer.sellAtCost ? "ON" : "OFF"}`)
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
    const wasCapped = payment.amount > customer.balance

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
      if (wasCapped) {
        showToast(`Amount capped to ${formatCurrency(amount)} (outstanding balance).`, "error")
      }
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
        <div className="p-6 space-y-2">
          {[1,2,3,4,5,6].map(i => (
            <div key={i} className="skeleton h-14 rounded-lg" style={{ background: "var(--surface-3)", animation: "pulse 1.5s infinite" }} />
          ))}
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
              <p className="mt-2 text-2xl font-bold" style={{ color: "var(--success)" }}>
                {formatCurrency(totals.paidTotal)}
              </p>
            </div>
      </section>

      {/* Debt aging breakdown */}
      {totals.outstanding > 0 && (
        <section className="mt-3 rounded-xl border p-4" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
          <p className="text-[12px] font-bold uppercase tracking-wide mb-3" style={{ color: "var(--text-3)" }}>Outstanding by age</p>
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: "0–30 days", value: agingTotals.current, color: "var(--brand-text)", bg: "var(--brand-soft)", days: "0" },
              { label: "30–60 days", value: agingTotals.days30, color: "var(--amber-text)", bg: "var(--amber-soft)", days: "30" },
              { label: "60–90 days", value: agingTotals.days60, color: "#EA580C", bg: "rgba(234,88,12,0.12)", days: "60" },
              { label: "90+ days", value: agingTotals.days90, color: "var(--rose-text)", bg: "var(--rose-soft)", days: "90" },
            ].map((b) => (
              <button key={b.label} onClick={() => setAgingFilter(a => a === b.days ? "" : b.days)}
                className={`rounded-lg p-3 text-left transition cursor-pointer ${agingFilter === b.days ? "ring-2 ring-zinc-400" : ""}`}
                style={{ background: b.bg }}
                aria-pressed={agingFilter === b.days}
                aria-label={`Filter by ${b.label} debt`}>
                <p className="text-[11px] font-semibold" style={{ color: b.color }}>{b.label}</p>
                <p className="mt-1 text-[17px] font-bold tabular-nums" style={{ color: b.color }}>{formatCurrency(b.value)}</p>
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <WorkspaceTabs<CustomerPanel>
          active={activePanel}
          onChange={setActivePanel}
          tabs={[
            { label: "Ledger", count: filteredCustomers.length },
            { label: "Pay debt", count: customers.filter((customer) => customer.balance > 0).length },
          ]}
        />

        <button
          type="button"
          onClick={() => setActivePanel("Add customer")}
          className="btn-primary btn-sm h-10 shrink-0 px-3"
        >
          + Add customer
        </button>

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
        <button type="button" onClick={() => {
          const csv = ["Name,Phone,Credit Limit,Debt Total,Paid Total,Balance,Oldest Unpaid Days,Overdue"].concat(
            customers.map((c) => `"${c.name}","${c.mobile}",${c.creditLimit},${c.debtTotal},${c.paidTotal},${c.balance},${c.oldestUnpaidDays},${c.overdue}`)
          ).join("\n")
          const b = new Blob([csv], { type: "text/csv" })
          const u = URL.createObjectURL(b)
          const a = document.createElement("a"); a.href = u; a.download = `customers-${new Date().toISOString().slice(0,10)}.csv`; a.click()
          URL.revokeObjectURL(u)
        }}
          className="flex h-10 items-center gap-1.5 rounded-lg border px-3 text-[12px] font-bold transition hover:opacity-80 shrink-0"
          style={{ borderColor: "var(--border)", color: "var(--text-3)" }}>
          <Download size={14} /> Export CSV
        </button>
      </div>

      {/* Archive toggle + filter info */}
      <div className="mt-2 flex items-center gap-3">
        <label className="flex items-center gap-2 text-[12px] font-semibold cursor-pointer" style={{ color: "var(--text-2)" }}>
          <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
          Show archived
        </label>
        {agingFilter && (
          <button onClick={() => setAgingFilter("")}
            className="text-[11px] font-bold px-2 py-1 rounded"
            style={{ background: "var(--brand-soft)", color: "var(--brand-text)" }}>
            Filter: {agingFilter === "0" ? "0–30d" : agingFilter === "30" ? "30–60d" : agingFilter === "60" ? "60–90d" : "90+d"} ✕
          </button>
        )}
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
        <section className="min-w-0 space-y-5">
          <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-0 text-sm">
                <thead>
                  <tr className="text-start text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">
                    <th className="border-b border-zinc-200 px-4 py-3 cursor-pointer hover:text-zinc-700" onClick={() => { setSortBy("name"); setSortDir(d => d === "asc" ? "desc" : "asc") }}>
                      Customer {sortBy === "name" && (sortDir === "asc" ? "↑" : "↓")}
                    </th>
                    <th className="border-b border-zinc-200 px-4 py-3">
                      Contact
                    </th>
                    <th className="border-b border-zinc-200 px-4 py-3 text-end">
                      Debt
                    </th>
                    <th className="border-b border-zinc-200 px-4 py-3 text-end">
                      Paid
                    </th>
                    <th className="border-b border-zinc-200 px-4 py-3 text-end cursor-pointer hover:text-zinc-700" onClick={() => { setSortBy("balance"); setSortDir("desc") }}>
                      Balance {sortBy === "balance" ? "↓" : "↕"}
                    </th>
                    <th className="border-b border-zinc-200 px-4 py-3 cursor-pointer hover:text-zinc-700" onClick={() => { setSortBy("lastActivity"); setSortDir("desc") }}>
                      Last activity {sortBy === "lastActivity" ? "↓" : "↕"}
                    </th>
                    <th className="border-b border-zinc-200 px-4 py-3">
                      <span className="sr-only">Actions</span>
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
                        className="t-row cursor-pointer transition"
                        style={active ? { background: "var(--brand-soft)", boxShadow: "inset 3px 0 0 var(--brand)" } : undefined}
                      >
                        <td className="border-b border-zinc-100 px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-zinc-950">{customer.name}</span>
                            {customer.overdue && (
                              <span className="rounded-md px-1.5 py-0.5 text-[10px] font-bold" style={{ background: "var(--rose-soft)", color: "var(--rose-text)" }}>
                                {customer.oldestUnpaidDays}d overdue
                              </span>
                            )}
                            {customer.overLimit && (
                              <span className="rounded-md px-1.5 py-0.5 text-[10px] font-bold" style={{ background: "var(--amber-soft)", color: "var(--amber-text)" }}>
                                over limit
                              </span>
                            )}
                            {!customer.overLimit && customer.creditLimit > 0 && customer.balance > customer.creditLimit * 0.8 && (
                              <span className="rounded-md px-1.5 py-0.5 text-[10px] font-bold" style={{ background: "var(--amber-soft)", color: "var(--amber-text)" }}>
                                near limit
                              </span>
                            )}
                            {!customer.overdue && !customer.overLimit && customer.balance <= 0 && (
                              <span className="rounded-md px-1.5 py-0.5 text-[10px] font-bold" style={{ background: "var(--emerald-100)", color: "var(--emerald-700)" }}>
                                good
                              </span>
                            )}
                          </div>
                          {customer.notes ? (
                            <div className="mt-1 max-w-64 truncate text-xs text-zinc-500">
                              {customer.notes}
                            </div>
                          ) : null}
                        </td>
                        <td className="border-b border-zinc-100 px-4 py-2.5">
                          <a
                            href={`tel:${customer.mobile}`}
                            className="inline-flex items-center gap-2 font-semibold text-zinc-700 hover:text-emerald-700"
                          >
                            <Phone size={15} />
                            {customer.mobile}
                          </a>
                        </td>
                        <td className="border-b border-zinc-100 px-4 py-2.5 text-end font-semibold text-zinc-800">
                          {formatCurrency(customer.debtTotal)}
                        </td>
                        <td className="border-b border-zinc-100 px-4 py-2.5 text-end font-semibold" style={{ color: "var(--success)" }}>
                          {formatCurrency(customer.paidTotal)}
                        </td>
                        <td className="border-b border-zinc-100 px-4 py-2.5 text-end font-bold text-rose-700">
                          {formatCurrency(customer.balance)}
                          {customer.balance > 0 && <div className="text-[10px] text-rose-400">{formatLbpCurrency(usdToLbp(customer.balance, getSettings().usdToLbpRate))}</div>}
                          {customer.creditLimit > 0 && (
                            <div className="mt-1 h-1 w-full rounded-full" style={{ background: "var(--surface-3)" }}>
                              <div className="h-1 rounded-full transition-all" style={{
                                width: `${Math.min(100, (customer.balance / customer.creditLimit) * 100)}%`,
                                background: customer.overLimit ? "var(--rose)" : customer.balance > customer.creditLimit * 0.8 ? "var(--amber)" : "var(--brand)",
                              }} />
                            </div>
                          )}
                        </td>
                        <td className="border-b border-zinc-100 px-4 py-2.5 text-zinc-500">
                          {formatDate(customer.lastActivityAt)}
                        </td>
                        <td className="border-b border-zinc-100 px-4 py-2.5">
                          <div className="flex items-center justify-end gap-1.5">
                            {customer.sellAtCost && (
                              <span className="rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-600" style={{ background: "rgba(214,166,58,0.12)" }}>COST</span>
                            )}
                            {customer.isWholesale && (
                              <span className="rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-700" style={{ background: "var(--brand-soft)" }}>WS</span>
                            )}
                            {customer.balance > 0 && customer.mobile && (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  openWhatsApp(customer.mobile, debtReminderMessage({
                                    storeName: getSettings().storeName,
                                    customerName: customer.name,
                                    balance: customer.balance,
                                    oldestDays: customer.oldestUnpaidDays,
                                  }))
                                }}
                                className="flex h-9 w-9 items-center justify-center rounded-lg border transition"
                                style={{ borderColor: "var(--border)", color: "#25D366" }}
                                title="Send WhatsApp reminder"
                                aria-label={`WhatsApp ${customer.name}`}
                              >
                                <MessageCircle size={15} />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                openEdit(customer)
                              }}
                              className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-400 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600"
                              title="Edit customer"
                              aria-label={`Edit ${customer.name}`}
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                if (customer.archived) {
                                  restoreCustomer(customer.id)
                                  showToast(`${customer.name} restored.`)
                                } else {
                                  archiveCustomer(customer.id)
                                  showToast(`${customer.name} archived.`)
                                }
                                refreshLedger()
                              }}
                              className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-400 transition hover:border-zinc-400 hover:bg-zinc-50 hover:text-zinc-700"
                              title={customer.archived ? "Restore customer" : "Archive customer"}
                              aria-label={customer.archived ? `Restore ${customer.name}` : `Archive ${customer.name}`}
                            >
                              {customer.archived ? "↩" : "📦"}
                            </button>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                const text = buildCustomerStatement(customer.id, getSettings().storeName)
                                const blob = new Blob([text], { type: "text/plain" })
                                const url = URL.createObjectURL(blob)
                                const a = document.createElement("a")
                                a.href = url
                                a.download = `statement-${customer.name.replace(/\s+/g, "-")}.txt`
                                a.click()
                                URL.revokeObjectURL(url)
                              }}
                              className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-400 transition hover:bg-zinc-50 hover:text-zinc-700"
                              title="Download statement"
                              aria-label={`Download statement for ${customer.name}`}
                            >
                              <Download size={15} />
                            </button>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                const text = buildCustomerStatement(customer.id, getSettings().storeName)
                                const w = window.open("", "_blank", "width=420,height=600")
                                if (w) { w.document.write(`<html><head><title>${customer.name}</title><style>body{font-family:monospace;white-space:pre;padding:20px;font-size:12px}</style></head><body>${text.replace(/\n/g,"<br>")}</body></html>`); w.document.close(); w.focus(); setTimeout(() => w.print(), 250) }
                              }}
                              className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-400 transition hover:bg-zinc-50 hover:text-zinc-700"
                              title="Print statement"
                              aria-label={`Print statement for ${customer.name}`}
                            >
                              <Printer size={15} />
                            </button>
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
                          </div>
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
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={newCustomer.isWholesale}
                  onChange={(e) => setNewCustomer((c) => ({ ...c, isWholesale: e.target.checked }))}
                  className="h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span className="text-sm font-medium text-zinc-700">Wholesale prices by default</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={newCustomer.sellAtCost}
                  onChange={(e) => setNewCustomer((c) => ({ ...c, sellAtCost: e.target.checked }))}
                  className="h-4 w-4 rounded border-zinc-300 text-amber-600 focus:ring-amber-500"
                />
                <span className="text-sm font-medium text-zinc-700">Sell at cost by default</span>
              </label>
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
                      aria-pressed={active}
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
                      className="font-bold"
                      style={{ color: activity.type === "Sale" ? "var(--rose)" : "var(--success)" }}
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

      {/* Edit Customer Modal */}
      {editCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }} onClick={() => setEditCustomer(null)}>
          <div className="w-full max-w-md rounded-xl border bg-white p-6 shadow-2xl mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-zinc-950">Edit Customer</h3>
              <button onClick={() => setEditCustomer(null)} className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"><X size={16} /></button>
            </div>
            <div className="space-y-3">
              <label className="block text-sm font-bold text-zinc-700">
                Name
                <input value={editCustomer.name} onChange={(e) => setEditCustomer((c) => c ? { ...c, name: e.target.value } : null)} className="mt-1 h-10 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100" />
              </label>
              <label className="block text-sm font-bold text-zinc-700">
                Mobile
                <input value={editCustomer.mobile} onChange={(e) => setEditCustomer((c) => c ? { ...c, mobile: e.target.value } : null)} className="mt-1 h-10 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100" />
              </label>
              <label className="block text-sm font-bold text-zinc-700">
                Credit limit
                <input type="number" min="0" value={editCustomer.creditLimit} onChange={(e) => setEditCustomer((c) => c ? { ...c, creditLimit: normalizeNumber(e.target.value) } : null)} className="mt-1 h-10 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100" />
              </label>
              <label className="block text-sm font-bold text-zinc-700">
                Notes
                <input value={editCustomer.notes} onChange={(e) => setEditCustomer((c) => c ? { ...c, notes: e.target.value } : null)} className="mt-1 h-10 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100" />
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={editCustomer.isWholesale} onChange={(e) => setEditCustomer((c) => c ? { ...c, isWholesale: e.target.checked } : null)} className="h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500" />
                <span className="text-sm font-medium text-zinc-700">Wholesale prices</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={editCustomer.sellAtCost} onChange={(e) => setEditCustomer((c) => c ? { ...c, sellAtCost: e.target.checked } : null)} className="h-4 w-4 rounded border-zinc-300 text-amber-600 focus:ring-amber-500" />
                <span className="text-sm font-medium text-zinc-700">Sell at cost by default</span>
              </label>
              <button onClick={saveEdit} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-zinc-950 px-3 text-sm font-bold text-white transition hover:bg-zinc-800">
                <Plus size={17} /> Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      </>
      )}
    </main>
  )
}
