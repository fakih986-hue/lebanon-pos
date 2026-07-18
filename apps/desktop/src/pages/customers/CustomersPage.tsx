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
      {/* KPI cards */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-xl border p-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <p className="text-[11px] font-semibold" style={{ color: "var(--text-3)" }}>{t("pos.customers")}</p>
          <p className="mt-1 text-[22px] font-black tabular-nums" style={{ color: "var(--text)" }}>{formatNumber(totals.customers)}</p>
        </div>
        <div className="rounded-xl border p-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <p className="text-[11px] font-semibold" style={{ color: "var(--text-3)" }}>Outstanding</p>
          <p className="mt-1 text-[22px] font-black tabular-nums" style={{ color: "var(--rose-text)" }}>{formatCurrency(totals.outstanding)}</p>
        </div>
        <div className="rounded-xl border p-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <p className="text-[11px] font-semibold" style={{ color: "var(--text-3)" }}>Credit sales</p>
          <p className="mt-1 text-[22px] font-black tabular-nums" style={{ color: "var(--text)" }}>{formatCurrency(totals.debtTotal)}</p>
        </div>
        <div className="rounded-xl border p-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <p className="text-[11px] font-semibold" style={{ color: "var(--text-3)" }}>Collected</p>
          <p className="mt-1 text-[22px] font-black tabular-nums" style={{ color: "var(--success-text)" }}>{formatCurrency(totals.paidTotal)}</p>
        </div>
      </section>

      {/* Debt aging breakdown */}
      {totals.outstanding > 0 && (
        <section className="mt-3 rounded-xl border p-3" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
          <p className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: "var(--text-3)" }}>Outstanding by age</p>
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: "0–30 days", value: agingTotals.current, color: "var(--brand-text)", bg: "var(--brand-soft)", days: "0" },
              { label: "30–60 days", value: agingTotals.days30, color: "var(--amber-text)", bg: "var(--amber-soft)", days: "30" },
              { label: "60–90 days", value: agingTotals.days60, color: "#EA580C", bg: "rgba(234,88,12,0.12)", days: "60" },
              { label: "90+ days", value: agingTotals.days90, color: "var(--rose-text)", bg: "var(--rose-soft)", days: "90" },
            ].map((b) => (
              <button key={b.label} onClick={() => setAgingFilter(a => a === b.days ? "" : b.days)}
                className="rounded-lg p-2.5 text-left transition cursor-pointer"
                style={{ background: b.bg, outline: agingFilter === b.days ? `2px solid ${b.color}` : undefined }}
                aria-pressed={agingFilter === b.days}
                aria-label={`Filter by ${b.label} debt`}>
                <p className="text-[10px] font-semibold" style={{ color: b.color }}>{b.label}</p>
                <p className="mt-0.5 text-[15px] font-bold tabular-nums" style={{ color: b.color }}>{formatCurrency(b.value)}</p>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Toolbar */}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <WorkspaceTabs<CustomerPanel>
            active={activePanel}
            onChange={setActivePanel}
            tabs={[
              { label: "Ledger", count: filteredCustomers.length },
              { label: "Pay debt", count: customers.filter((customer) => customer.balance > 0).length },
            ]}
          />
          <label className="flex items-center gap-1.5 text-[11px] font-semibold cursor-pointer shrink-0" style={{ color: "var(--text-3)" }}>
            <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} className="h-3.5 w-3.5" />
            Archived
          </label>
          {agingFilter && (
            <button onClick={() => setAgingFilter("")} className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ borderColor: "var(--border)", color: "var(--text-3)" }}>
              {agingFilter === "0" ? "0–30d" : agingFilter === "30" ? "30–60d" : agingFilter === "60" ? "60–90d" : "90+d"} ✕
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Search */}
          <label className="relative min-w-[160px] flex-1 sm:flex-none sm:w-52">
            <Search size={13} className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--text-3)" }} />
            <input
              ref={searchRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name or mobile"
              className="input w-full ps-8"
              style={{ height: 34 }}
            />
            {search && (
              <button type="button" onClick={() => setSearch("")} className="absolute end-2 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100">
                <X size={13} style={{ color: "var(--text-3)" }} />
              </button>
            )}
          </label>

          <button
            type="button"
            onClick={() => setActivePanel("Add customer")}
            className="btn btn-default h-[34px] gap-1.5 px-2.5 text-[12px] font-bold"
          >
            <Plus size={14} />
            Add
          </button>

          <button type="button" onClick={() => {
            const csv = ["Name,Phone,Credit Limit,Debt Total,Paid Total,Balance,Oldest Unpaid Days,Overdue"].concat(
              customers.map((c) => `"${c.name}","${c.mobile}",${c.creditLimit},${c.debtTotal},${c.paidTotal},${c.balance},${c.oldestUnpaidDays},${c.overdue}`)
            ).join("\n")
            const b = new Blob([csv], { type: "text/csv" })
            const u = URL.createObjectURL(b)
            const a = document.createElement("a"); a.href = u; a.download = `customers-${new Date().toISOString().slice(0,10)}.csv`; a.click()
            URL.revokeObjectURL(u)
          }}
            className="btn btn-default h-[34px] gap-1.5 px-2.5 text-[12px] font-bold">
            <Download size={14} /> Export
          </button>
        </div>
      </div>

      {/* Two-pane layout */}
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(320px,440px)_minmax(0,1fr)]">
        {/* Left: Customer cards */}
        <section className="min-w-0">
          <div className="rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
            <div className="max-h-[70vh] space-y-1.5 overflow-y-auto p-2">
              {filteredCustomers.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <UsersRound size={28} style={{ color: "var(--text-3)" }} />
                  <p className="mt-2 text-[13px] font-bold" style={{ color: "var(--text-2)" }}>No customers found</p>
                  <p className="mt-0.5 text-[12px]" style={{ color: "var(--text-3)" }}>Try a different search, or add a customer.</p>
                </div>
              ) : null}

              {filteredCustomers.map((customer) => {
                const active = selectedCustomerId === customer.id

                return (
                  <article
                    key={customer.id}
                    role="button"
                    aria-pressed={active}
                    className="rounded-lg border transition cursor-pointer"
                    style={active
                      ? { borderColor: "var(--brand-border)", background: "var(--brand-soft)", boxShadow: "inset 3px 0 0 var(--brand)" }
                      : { borderColor: "var(--border)", background: "var(--surface)" }}
                    onClick={() => {
                      setSelectedCustomerId(customer.id)
                      setActivePanel((p) => p === "Pay debt" ? "Pay debt" : "Ledger")
                      setPayment((currentPayment) => ({
                        ...currentPayment,
                        customerId: customer.id,
                      }))
                    }}
                  >
                    <div className="px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-[13px] font-bold truncate" style={{ color: "var(--text)" }}>{customer.name}</span>
                          {customer.overdue && (
                            <span className="rounded px-1 py-0.5 text-[9px] font-bold shrink-0" style={{ background: "var(--rose-soft)", color: "var(--rose-text)" }}>
                              {customer.oldestUnpaidDays}d
                            </span>
                          )}
                          {customer.overLimit && (
                            <span className="rounded px-1 py-0.5 text-[9px] font-bold shrink-0" style={{ background: "var(--amber-soft)", color: "var(--amber-text)" }}>LIMIT</span>
                          )}
                          {customer.sellAtCost && (
                            <span className="rounded px-1 py-0.5 text-[9px] font-bold uppercase shrink-0" style={{ background: "var(--brand-soft)", color: "var(--brand-text)" }}>COST</span>
                          )}
                          {customer.isWholesale && (
                            <span className="rounded border px-1 py-0.5 text-[9px] font-bold uppercase shrink-0" style={{ borderColor: "var(--border)", color: "var(--text-3)" }}>WS</span>
                          )}
                        </div>
                        <span className="shrink-0 text-[15px] font-black tabular-nums" style={{ color: customer.balance > 0 ? "var(--rose-text)" : "var(--text)" }}>
                          {formatCurrency(customer.balance)}
                        </span>
                      </div>

                      <div className="mt-1 flex items-center gap-2 text-[11px]" style={{ color: "var(--text-3)" }}>
                        {customer.mobile && (
                          <a href={`tel:${customer.mobile}`} onClick={e => e.stopPropagation()} className="hover:underline">{customer.mobile}</a>
                        )}
                        {customer.mobile && customer.lastActivityAt && <span className="opacity-40">·</span>}
                        {customer.lastActivityAt && <span>{formatDate(customer.lastActivityAt)}</span>}
                      </div>

                      {customer.notes && (
                        <p className="mt-0.5 truncate text-[11px]" style={{ color: "var(--text-3)" }}>{customer.notes}</p>
                      )}

                      {customer.creditLimit > 0 && customer.balance > 0 && (
                        <div className="mt-1.5 h-1 w-full rounded-full" style={{ background: "var(--surface-3)" }}>
                          <div className="h-1 rounded-full transition-all" style={{
                            width: `${Math.min(100, (customer.balance / customer.creditLimit) * 100)}%`,
                            background: customer.overLimit ? "var(--danger)" : customer.balance > customer.creditLimit * 0.8 ? "var(--warning)" : "var(--success)",
                          }} />
                        </div>
                      )}
                    </div>

                  </article>
                )
              })}
            </div>
          </div>
        </section>

        {/* Right: Detail panel */}
        <aside className="hidden xl:block">
          <div className="sticky top-4 space-y-4">

            {/* Add customer panel */}
            {activePanel === "Add customer" && (
              <section className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ borderColor: "var(--border)", color: "var(--text-3)" }}>
                    <UserPlus size={18} />
                  </div>
                  <div>
                    <h2 className="text-[15px] font-bold" style={{ color: "var(--text)" }}>Add customer</h2>
                    <p className="text-[11px]" style={{ color: "var(--text-3)" }}>Name and mobile are required.</p>
                  </div>
                </div>

                <div className="space-y-2.5">
                  <input value={newCustomer.name} onChange={(event) => { setNewCustomer((c) => ({ ...c, name: event.target.value })); if (formErrors.name) setFormErrors((e) => ({ ...e, name: undefined })) }}
                    placeholder="Customer name"
                    className={`input w-full h-9 text-[13px] ${formErrors.name ? "border-rose-300" : ""}`}
                  />
                  {formErrors.name && <p className="text-[11px] font-medium" style={{ color: "var(--rose-text)" }}>{formErrors.name}</p>}
                  <input value={newCustomer.mobile} onChange={(event) => { setNewCustomer((c) => ({ ...c, mobile: event.target.value })); if (formErrors.mobile) setFormErrors((e) => ({ ...e, mobile: undefined })) }}
                    placeholder="Mobile number"
                    className={`input w-full h-9 text-[13px] ${formErrors.mobile ? "border-rose-300" : ""}`}
                  />
                  {formErrors.mobile && <p className="text-[11px] font-medium" style={{ color: "var(--rose-text)" }}>{formErrors.mobile}</p>}
                  <input type="number" min="0" value={newCustomer.creditLimit} onChange={(event) => setNewCustomer((c) => ({ ...c, creditLimit: normalizeNumber(event.target.value) }))}
                    placeholder="Credit limit" className="input w-full h-9 text-[13px]"
                  />
                  <textarea value={newCustomer.notes} onChange={(event) => setNewCustomer((c) => ({ ...c, notes: event.target.value }))}
                    placeholder="Notes" rows={2} className="input w-full resize-none text-[13px]" style={{ minHeight: 60 }}
                  />
                  <label className="flex items-center gap-2 cursor-pointer select-none text-[12px] font-medium" style={{ color: "var(--text-2)" }}>
                    <input type="checkbox" checked={newCustomer.isWholesale} onChange={(e) => setNewCustomer((c) => ({ ...c, isWholesale: e.target.checked }))} className="h-3.5 w-3.5" />
                    Wholesale prices by default
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer select-none text-[12px] font-medium" style={{ color: "var(--text-2)" }}>
                    <input type="checkbox" checked={newCustomer.sellAtCost} onChange={(e) => setNewCustomer((c) => ({ ...c, sellAtCost: e.target.checked }))} className="h-3.5 w-3.5" />
                    Sell at cost by default
                  </label>
                  <button type="button" onClick={handleAddCustomer}
                    className="btn h-9 w-full gap-1.5 text-[12px] font-bold"
                    style={{ background: "var(--text)", color: "var(--surface)" }}>
                    <Plus size={14} /> Add Customer
                  </button>
                </div>
              </section>
            )}

            {/* Pay debt panel */}
            {activePanel === "Pay debt" && (
              <section className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ background: "var(--amber-soft)", color: "var(--amber-text)" }}>
                    <HandCoins size={18} />
                  </div>
                  <div>
                    <h2 className="text-[15px] font-bold" style={{ color: "var(--text)" }}>Pay debt</h2>
                    <p className="text-[11px]" style={{ color: "var(--text-3)" }}>Record a payment against an account.</p>
                  </div>
                </div>

                <div className="space-y-2.5">
                  <select value={payment.customerId || selectedCustomerId} onChange={(event) => { setSelectedCustomerId(event.target.value); setPayment((p) => ({ ...p, customerId: event.target.value })) }}
                    className="input w-full h-9 text-[13px]"
                  >
                    <option value="">Choose customer</option>
                    {customers.map((c) => (<option key={c.id} value={c.id}>{c.name} — {formatCurrency(c.balance)}</option>))}
                  </select>

                  <input type="number" min="0" step="0.01" value={payment.amount} onChange={(event) => setPayment((p) => ({ ...p, amount: normalizeNumber(event.target.value) }))}
                    placeholder="Payment amount" className="input w-full h-9 text-[13px]"
                  />

                  <div className="grid grid-cols-3 gap-1.5">
                    {paymentMethods.map((method) => {
                      const Icon = method.icon
                      const active = payment.method === method.label
                      return (
                        <button key={method.label} type="button" onClick={() => setPayment((p) => ({ ...p, method: method.label }))}
                          aria-pressed={active}
                          className="h-9 rounded-lg border text-[11px] font-bold transition"
                          style={active ? { background: "var(--brand-soft)", borderColor: "var(--brand)", color: "var(--brand-text)" } : { borderColor: "var(--border)", color: "var(--text-3)" }}>
                          <Icon size={13} className="inline me-1" />{method.label}
                        </button>
                      )
                    })}
                  </div>

                  <input value={payment.reference} onChange={(event) => setPayment((p) => ({ ...p, reference: event.target.value }))}
                    placeholder="Reference or note" className="input w-full h-9 text-[13px]"
                  />

                  <button type="button" onClick={handleRecordPayment}
                    className="btn h-9 w-full gap-1.5 text-[12px] font-bold"
                    style={{ background: "var(--brand)", color: "#fff" }}>
                    <HandCoins size={14} /> Record Payment
                  </button>
                </div>
              </section>
            )}

            {/* Ledger panel */}
            {activePanel === "Ledger" && (
              <section className="rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
                {/* Header with summary */}
                <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
                  <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-3)" }}>Ledger</p>
                  {selectedCustomer && (
                    <div className="flex items-center gap-3 text-[11px] tabular-nums">
                      <span style={{ color: "var(--text-3)" }}>Charged <strong style={{ color: "var(--text)" }}>{formatCurrency(selectedCustomer.debtTotal)}</strong></span>
                      <span style={{ color: "var(--text-3)" }}>Paid <strong style={{ color: "var(--text)" }}>{formatCurrency(selectedCustomer.paidTotal)}</strong></span>
                    </div>
                  )}
                </div>

                {selectedCustomer ? (
                  <>
                    {/* Customer info + balance + actions */}
                    <div className="border-b p-4" style={{ borderColor: "var(--border)" }}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <p className="text-[15px] font-bold truncate" style={{ color: "var(--text)" }}>{selectedCustomer.name}</p>
                            {selectedCustomer.overdue && (
                              <span className="rounded px-1 py-0.5 text-[9px] font-bold shrink-0" style={{ background: "var(--rose-soft)", color: "var(--rose-text)" }}>{selectedCustomer.oldestUnpaidDays}d</span>
                            )}
                            {selectedCustomer.overLimit && (
                              <span className="rounded px-1 py-0.5 text-[9px] font-bold shrink-0" style={{ background: "var(--amber-soft)", color: "var(--amber-text)" }}>LIMIT</span>
                            )}
                            {selectedCustomer.sellAtCost && (
                              <span className="rounded px-1 py-0.5 text-[9px] font-bold shrink-0" style={{ background: "var(--brand-soft)", color: "var(--brand-text)" }}>COST</span>
                            )}
                            {selectedCustomer.isWholesale && (
                              <span className="rounded px-1 py-0.5 text-[9px] font-bold shrink-0" style={{ borderColor: "var(--border)", color: "var(--text-3)" }}>WS</span>
                            )}
                          </div>
                          {selectedCustomer.mobile && (
                            <p className="mt-0.5 text-[12px]" style={{ color: "var(--text-3)" }}>{selectedCustomer.mobile}</p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-[11px] font-semibold" style={{ color: "var(--text-3)" }}>Balance</p>
                          <p className="text-[22px] font-black tabular-nums leading-none mt-0.5" style={{ color: selectedCustomer.balance > 0 ? "var(--rose-text)" : "var(--text)" }}>
                            {formatCurrency(selectedCustomer.balance)}
                          </p>
                        </div>
                      </div>

                      {/* Quick action buttons */}
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {selectedCustomer.mobile && (
                          <button type="button" onClick={(e) => { e.stopPropagation(); openWhatsApp(selectedCustomer.mobile, debtReminderMessage({ storeName: getSettings().storeName, customerName: selectedCustomer.name, balance: selectedCustomer.balance, oldestDays: selectedCustomer.oldestUnpaidDays })) }}
                            className="flex h-7 items-center gap-1 rounded-lg border px-2.5 text-[10px] font-bold transition"
                            style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text-2)" }}>
                            <MessageCircle size={11} style={{ color: "#25D366" }} /> WhatsApp
                          </button>
                        )}
                        {selectedCustomer.mobile && (
                          <a href={`tel:${selectedCustomer.mobile}`} onClick={e => e.stopPropagation()}
                            className="flex h-7 items-center gap-1 rounded-lg border px-2.5 text-[10px] font-bold transition"
                            style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text-2)" }}>
                            <Phone size={11} /> Call
                          </a>
                        )}
                        <button type="button" onClick={() => openEdit(selectedCustomer)}
                          className="flex h-7 items-center gap-1 rounded-lg border px-2.5 text-[10px] font-bold transition"
                          style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text-2)" }}>
                          <Pencil size={11} /> Edit
                        </button>
                        <button type="button" onClick={() => { const text = buildCustomerStatement(selectedCustomer.id, getSettings().storeName); const blob = new Blob([text], { type: "text/plain" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `statement-${selectedCustomer.name.replace(/\s+/g, "-")}.txt`; a.click(); URL.revokeObjectURL(url) }}
                          className="flex h-7 items-center gap-1 rounded-lg border px-2.5 text-[10px] font-bold transition"
                          style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text-2)" }}>
                          <Download size={11} /> Statement
                        </button>
                        <button type="button" onClick={() => { const text = buildCustomerStatement(selectedCustomer.id, getSettings().storeName); const w = window.open("", "_blank", "width=420,height=600"); if (w) { w.document.write(`<html><head><title>${selectedCustomer.name}</title><style>body{font-family:monospace;white-space:pre;padding:20px;font-size:12px}</style></head><body>${text.replace(/\n/g,"<br>")}</body></html>`); w.document.close(); w.focus(); setTimeout(() => w.print(), 250) } }}
                          className="flex h-7 items-center gap-1 rounded-lg border px-2.5 text-[10px] font-bold transition"
                          style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text-2)" }}>
                          <Printer size={11} /> Print
                        </button>
                        <button type="button"
                          onClick={() => {
                            if (selectedCustomer.archived) { restoreCustomer(selectedCustomer.id); showToast(`${selectedCustomer.name} restored.`) }
                            else { archiveCustomer(selectedCustomer.id); showToast(`${selectedCustomer.name} archived.`) }
                            refreshLedger()
                          }}
                          className="flex h-7 items-center gap-1 rounded-lg border px-2.5 text-[10px] font-bold transition"
                          style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text-2)" }}>
                          {selectedCustomer.archived ? "Restore" : "Archive"}
                        </button>
                        <button type="button"
                          onClick={() => setDeleteCustomerId(selectedCustomer.id)}
                          aria-label={`Delete ${selectedCustomer.name}`}
                          className="flex h-7 items-center gap-1 rounded-lg border px-2.5 text-[10px] font-bold transition"
                          style={{ background: "var(--danger-soft)", borderColor: "var(--danger)", color: "var(--danger-text)" }}>
                          <X size={11} /> Delete
                        </button>
                      </div>
                    </div>

                    <div className="p-4 space-y-4">
                      {/* Aging breakdown — stacked bar */}
                      <div>
                        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-3)" }}>Aging</p>
                        {(() => {
                          const { current, days30, days60, days90 } = selectedCustomer.aging
                          const total = current + days30 + days60 + days90
                          const pct = (v: number) => total > 0 ? (v / total) * 100 : 0
                          const fmt = (v: number) => formatCurrency(v)
                          return (
                            <>
                              <div className="flex h-5 w-full overflow-hidden rounded-md" style={{ background: "var(--surface-3)" }}>
                                {current > 0 && <div style={{ width: `${pct(current)}%`, background: "var(--success)" }} title={`Current: ${fmt(current)}`} />}
                                {days30 > 0 && <div style={{ width: `${pct(days30)}%`, background: "var(--warning)" }} title={`30d: ${fmt(days30)}`} />}
                                {days60 > 0 && <div style={{ width: `${pct(days60)}%`, background: "#f97316" }} title={`60d: ${fmt(days60)}`} />}
                                {days90 > 0 && <div style={{ width: `${pct(days90)}%`, background: "var(--rose)" }} title={`90d+: ${fmt(days90)}`} />}
                              </div>
                              <div className="mt-1.5 grid grid-cols-4 gap-1 text-[10px] tabular-nums" style={{ color: "var(--text-3)" }}>
                                <span>Current <strong style={{ color: "var(--text)" }}>{fmt(current)}</strong></span>
                                <span>1–30d <strong style={{ color: "var(--text)" }}>{fmt(days30)}</strong></span>
                                <span>31–60d <strong style={{ color: "var(--text)" }}>{fmt(days60)}</strong></span>
                                <span>60d+ <strong style={{ color: "var(--text)" }}>{fmt(days90)}</strong></span>
                              </div>
                            </>
                          )
                        })()}
                      </div>

                      {/* Credit-limit usage */}
                      {selectedCustomer.creditLimit > 0 && (
                        <div>
                          <div className="mb-1 flex items-center justify-between text-[11px] font-semibold" style={{ color: "var(--text-3)" }}>
                            <span>Credit limit</span>
                            <span className="tabular-nums">{formatCurrency(selectedCustomer.balance)} / {formatCurrency(selectedCustomer.creditLimit)}</span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--surface-3)" }}>
                            {(() => {
                              const pct = Math.min(100, (selectedCustomer.balance / selectedCustomer.creditLimit) * 100)
                              const color = pct >= 100 ? "var(--danger)" : pct >= 75 ? "var(--warning)" : "var(--success)"
                              return <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(pct, 2)}%`, background: color }} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Credit limit used" />
                            })()}
                          </div>
                        </div>
                      )}

                      {/* Promise-to-pay note */}
                      <div>
                        <label className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: "var(--text-3)" }}>
                          <CalendarClock size={12} />
                          Promise to pay / note
                        </label>
                        <input key={selectedCustomer.id} defaultValue={selectedCustomer.notes} placeholder="e.g. will pay Friday" maxLength={160}
                          className="input h-9 w-full text-[12px]" onKeyDown={(e) => { if (e.key !== "Enter") return; const value = (e.target as HTMLInputElement).value.trim(); updateCustomer(selectedCustomer.id, { notes: value }); showToast("Note saved.") }} />
                        <p className="mt-1 text-[10px]" style={{ color: "var(--text-3)" }}>Enter to save</p>
                      </div>
                    </div>

                    {/* Activity timeline */}
                    <div className="border-t p-4" style={{ borderColor: "var(--border)" }}>
                      <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-3)" }}>Activity</p>
                      <div className="max-h-72 space-y-1.5 overflow-y-auto">
                        {selectedActivity.length === 0 ? (
                          <div className="flex flex-col items-center justify-center py-8 text-center">
                            <ReceiptText size={24} style={{ color: "var(--text-3)" }} />
                            <p className="mt-2 text-[12px] font-medium" style={{ color: "var(--text-3)" }}>No activity yet</p>
                          </div>
                        ) : selectedActivity.map((activity) => (
                          <div key={`${activity.type}-${activity.id}`}
                            className="flex items-start gap-3 rounded-lg p-2.5 transition hover:bg-zinc-50"
                            style={{ borderColor: "var(--border)" }}>
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                              style={{ background: activity.type === "Sale" ? "var(--rose-soft)" : "var(--brand-soft)" }}>
                              {activity.type === "Sale" ? <ReceiptText size={13} style={{ color: "var(--rose-text)" }} /> : <HandCoins size={13} style={{ color: "var(--brand-text)" }} />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-[12px] font-bold truncate" style={{ color: "var(--text)" }}>{activity.title}</p>
                                <span className="shrink-0 text-[13px] font-black tabular-nums" style={{ color: activity.type === "Sale" ? "var(--rose-text)" : "var(--success)" }}>
                                  {activity.type === "Sale" ? "+" : "-"}{formatCurrency(activity.amount)}
                                </span>
                              </div>
                              <p className="text-[11px]" style={{ color: "var(--text-3)" }}>{activity.detail}</p>
                              <p className="mt-0.5 flex items-center gap-1 text-[10px]" style={{ color: "var(--text-3)" }}>
                                <CalendarClock size={10} /> {formatDate(activity.createdAt)}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center py-14 text-center">
                    <UsersRound size={32} style={{ color: "var(--text-3)" }} />
                    <p className="mt-3 text-[13px] font-bold" style={{ color: "var(--text-2)" }}>Select a customer</p>
                    <p className="mt-1 text-[11px]" style={{ color: "var(--text-3)" }}>Choose a customer from the list to view their ledger.</p>
                  </div>
                )}
              </section>
            )}
          </div>
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
