import { useEffect, useMemo, useRef, useState } from "react"
import { useDebounce } from "../../hooks/useDebounce"
import { useHotkeys } from "../../hooks/useHotkey"
import {
  Banknote,
  Building2,
  CreditCard,
  HandCoins,
  Landmark,
  Phone,
  Plus,
  Search,
  Truck,
  WalletCards,
  X,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { formatCurrency, formatNumber } from "../../features/pos/lib/currency"
import {
  createSupplier,
  getPurchaseOrders,
  getSupplierActivity,
  getSupplierLedger,
  getSupplierTotals,
  recordSupplierPayment,
  subscribeSuppliers,
  type PurchaseOrder,
  type SupplierLedger,
  type SupplierPaymentMethod,
} from "../../features/pos/services/supplier.service"
import { deleteSupplier } from "../../features/pos/services/supplier.service"
import { showToast } from "../../features/pos/services/toast.service"
import ConfirmDialog from "../../components/ConfirmDialog"
import Spinner from "../../components/ui/Spinner"
import WorkspaceTabs from "../../components/ui/WorkspaceTabs"

type SupplierForm = {
  name: string
  mobile: string
  contact: string
  address: string
  notes: string
}

type PaymentForm = {
  supplierId: string
  purchaseOrderId: string
  amount: string
  method: SupplierPaymentMethod
  reference: string
}

type SupplierWorkspace = "Accounts" | "Orders" | "Pay supplier" | "Add supplier" | "Activity"

const emptySupplierForm: SupplierForm = {
  name: "",
  mobile: "",
  contact: "",
  address: "",
  notes: "",
}

const supplierPaymentMethods: Array<{
  label: SupplierPaymentMethod
  icon: LucideIcon
}> = [
  {
    label: "Cash",
    icon: Banknote,
  },
  {
    label: "Card",
    icon: CreditCard,
  },
  {
    label: "Bank Transfer",
    icon: Landmark,
  },
  {
    label: "Wallet",
    icon: WalletCards,
  },
]

function parseMoney(value: string) {
  const parsedValue = Number(value.replace(/,/g, "").trim())

  return Number.isFinite(parsedValue) ? Math.max(0, parsedValue) : 0
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

export default function SuppliersPage() {
  const [isLoading, setIsLoading] = useState(true)
  const [suppliers, setSuppliers] =
    useState<SupplierLedger[]>(getSupplierLedger())
  const [purchaseOrders, setPurchaseOrders] =
    useState<PurchaseOrder[]>(getPurchaseOrders())
  const [totals, setTotals] = useState(getSupplierTotals())
  const [selectedSupplierId, setSelectedSupplierId] = useState("")
  const [search, setSearch] = useState("")
  const searchRef = useRef<HTMLInputElement>(null)
  useHotkeys([{ key: "f", modifiers: ["ctrl"], handler: () => searchRef.current?.focus() }])
  const debouncedSearch = useDebounce(search, 200)
  const [supplierForm, setSupplierForm] =
    useState<SupplierForm>(emptySupplierForm)
  const [payment, setPayment] = useState<PaymentForm>({
    supplierId: "",
    purchaseOrderId: "",
    amount: "",
    method: "Cash",
    reference: "",
  })
  const [formErrors, setFormErrors] = useState<Partial<Record<"name" | "mobile", string>>>({})
  const [deleteSupplierId, setDeleteSupplierId] = useState<string | null>(null)
  const [activeWorkspace, setActiveWorkspace] =
    useState<SupplierWorkspace>("Accounts")

  function refreshSuppliers(preferredSupplierId?: string) {
    const nextSuppliers = getSupplierLedger()
    const nextPurchaseOrders = getPurchaseOrders()
    const nextSelectedId =
      preferredSupplierId ||
      selectedSupplierId ||
      nextSuppliers.find((supplier) => supplier.balance > 0)?.id ||
      nextSuppliers[0]?.id ||
      ""

    setSuppliers(nextSuppliers)
    setPurchaseOrders(nextPurchaseOrders)
    setTotals(getSupplierTotals())
    setSelectedSupplierId(nextSelectedId)
    setPayment((currentPayment) => ({
      ...currentPayment,
      supplierId:
        preferredSupplierId || currentPayment.supplierId || nextSelectedId,
    }))
  }

  useEffect(() => {
    refreshSuppliers()
    setIsLoading(false)

    return subscribeSuppliers(() => refreshSuppliers())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filteredSuppliers = useMemo(() => {
    const query = search.trim().toLowerCase()

    if (!query) {
      return suppliers
    }

    return suppliers.filter(
      (supplier) =>
        supplier.name.toLowerCase().includes(query) ||
        supplier.mobile.includes(query) ||
        supplier.contact.toLowerCase().includes(query)
    )
      }, [debouncedSearch, suppliers])
  const selectedSupplier = suppliers.find(
    (supplier) => supplier.id === selectedSupplierId
  )
  const selectedActivity = selectedSupplier
    ? getSupplierActivity(selectedSupplier.id)
    : []
  const selectedOpenOrders = purchaseOrders.filter(
    (purchaseOrder) =>
      purchaseOrder.supplierId === (payment.supplierId || selectedSupplierId) &&
      purchaseOrder.paymentStatus !== "Paid"
  )
  const selectedPurchaseOrder = purchaseOrders.find(
    (purchaseOrder) => purchaseOrder.id === payment.purchaseOrderId
  )
  const paymentBalance = selectedPurchaseOrder
    ? Math.max(0, selectedPurchaseOrder.total - selectedPurchaseOrder.paidTotal)
    : selectedSupplier?.balance ?? 0

  function updateSupplierForm(patch: Partial<SupplierForm>) {
    setSupplierForm((currentForm) => ({
      ...currentForm,
      ...patch,
    }))
  }

  function handleCreateSupplier() {
    const errors: typeof formErrors = {}
    if (!supplierForm.name.trim()) {
      errors.name = "Name is required"
    }
    if (!supplierForm.mobile.trim()) {
      errors.mobile = "Mobile is required"
    }
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors)
      return
    }

    try {
      const supplier = createSupplier(supplierForm)

      setSupplierForm(emptySupplierForm)
      setFormErrors({})
      showToast(`${supplier.name} was added.`)
      refreshSuppliers(supplier.id)
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Supplier not added.", "error")
    }
  }

  function handleRecordPayment() {
    const supplier = suppliers.find(
      (currentSupplier) => currentSupplier.id === payment.supplierId
    )

    if (!supplier || paymentBalance <= 0) {
      showToast("Choose a supplier with an outstanding balance.", "error")
      return
    }

    const amount = Math.min(parseMoney(payment.amount), paymentBalance)

    try {
      const supplierPayment = recordSupplierPayment({
        supplierId: supplier.id,
        purchaseOrderId: payment.purchaseOrderId || undefined,
        amount,
        method: payment.method,
        reference: payment.reference,
      })

      setPayment((currentPayment) => ({
        ...currentPayment,
        purchaseOrderId: "",
        amount: "",
        reference: "",
      }))
      showToast(
        `${formatCurrency(supplierPayment.amount)} paid to ${
          supplierPayment.supplierName
        }.`
      )
      setActiveWorkspace("Activity")
      refreshSuppliers(supplier.id)
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Payment not saved.", "error")
    }
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-[#eef3f2] p-3 sm:p-5 xl:p-6">
      {isLoading ? (
        <div className="flex min-h-[400px] items-center justify-center p-6">
          <Spinner label="Loading suppliers..." />
        </div>
      ) : (
      <>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
        <section className="min-w-0 space-y-5">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-zinc-500">Suppliers</p>
              <p className="mt-2 text-2xl font-bold text-zinc-950">
                {formatNumber(totals.suppliers)}
              </p>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-zinc-500">Purchases</p>
              <p className="mt-2 text-2xl font-bold text-zinc-950">
                {formatCurrency(totals.purchaseTotal)}
              </p>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-zinc-500">Paid</p>
              <p className="mt-2 text-2xl font-bold text-emerald-700">
                {formatCurrency(totals.paidTotal)}
              </p>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-zinc-500">Payable</p>
              <p className="mt-2 text-2xl font-bold text-rose-700">
                {formatCurrency(totals.outstanding)}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <WorkspaceTabs<SupplierWorkspace>
              active={activeWorkspace}
              onChange={setActiveWorkspace}
              tabs={[
                { label: "Accounts", count: filteredSuppliers.length },
                { label: "Orders", count: purchaseOrders.length },
                { label: "Pay supplier", count: selectedOpenOrders.length },
                { label: "Add supplier" },
                { label: "Activity", count: selectedActivity.length },
              ]}
            />

            <label className="relative w-full sm:w-64">
              <span className="sr-only">Search suppliers</span>
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
              />
              <input
                ref={searchRef}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search supplier, contact, mobile"
                className="h-10 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
              />
            </label>
          </div>

          {activeWorkspace === "Accounts" ? (
          <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
            <div className="border-b border-zinc-200 p-4">
              <div>
                <h2 className="text-xl font-bold text-zinc-950">
                  Supplier accounts
                </h2>
                <p className="text-sm text-zinc-500">
                  Purchases from receiving and later payments stay connected.
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-0 text-sm">
                <thead>
                  <tr className="text-left text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">
                    <th className="border-b border-zinc-200 px-4 py-3">
                      Supplier
                    </th>
                    <th className="border-b border-zinc-200 px-4 py-3">
                      Contact
                    </th>
                    <th className="border-b border-zinc-200 px-4 py-3 text-right">
                      Purchases
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
                  {filteredSuppliers.length === 0 ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-4 py-12 text-center text-sm font-medium text-zinc-500"
                      >
                        No suppliers found
                      </td>
                    </tr>
                  ) : null}

                  {filteredSuppliers.map((supplier) => {
                    const active = selectedSupplierId === supplier.id

                    return (
                      <tr
                        key={supplier.id}
                        onClick={() => {
                          setSelectedSupplierId(supplier.id)
                          setPayment((currentPayment) => ({
                            ...currentPayment,
                            supplierId: supplier.id,
                            purchaseOrderId: "",
                          }))
                        }}
                        className={`cursor-pointer transition hover:bg-zinc-50 ${
                          active ? "bg-emerald-50/70" : ""
                        }`}
                      >
                        <td className="border-b border-zinc-100 px-4 py-4">
                          <div className="font-bold text-zinc-950">
                            {supplier.name}
                          </div>
                          {supplier.notes ? (
                            <div className="mt-1 max-w-64 truncate text-xs text-zinc-500">
                              {supplier.notes}
                            </div>
                          ) : null}
                        </td>
                        <td className="border-b border-zinc-100 px-4 py-4">
                          <p className="font-semibold text-zinc-700">
                            {supplier.contact || "-"}
                          </p>
                          {supplier.mobile ? (
                            <a
                              href={`tel:${supplier.mobile}`}
                              className="mt-1 inline-flex items-center gap-2 text-xs font-semibold text-zinc-500 hover:text-emerald-700"
                            >
                              <Phone size={13} />
                              {supplier.mobile}
                            </a>
                          ) : null}
                        </td>
                        <td className="border-b border-zinc-100 px-4 py-4 text-right font-semibold text-zinc-800">
                          {formatCurrency(supplier.purchaseTotal)}
                        </td>
                        <td className="border-b border-zinc-100 px-4 py-4 text-right font-semibold text-emerald-700">
                          {formatCurrency(supplier.paidTotal)}
                        </td>
                        <td className="border-b border-zinc-100 px-4 py-4 text-right font-bold text-rose-700">
                          {formatCurrency(supplier.balance)}
                        </td>
                        <td className="border-b border-zinc-100 px-4 py-4 text-zinc-500">
                          {formatDate(supplier.lastActivityAt)}
                        </td>
                        <td className="border-b border-zinc-100 px-4 py-4">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              setDeleteSupplierId(supplier.id)
                            }}
                            className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-400 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
                            aria-label={`Delete ${supplier.name}`}
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
          ) : null}

          {activeWorkspace === "Orders" ? (
          <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
            <div className="border-b border-zinc-200 p-4">
              <h2 className="text-xl font-bold text-zinc-950">
                Purchase orders
              </h2>
              <p className="text-sm text-zinc-500">
                Orders created by receiving stock.
              </p>
            </div>
            <div className="max-h-[420px] space-y-3 overflow-y-auto p-4">
              {purchaseOrders.length === 0 ? (
                <p className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm font-medium text-zinc-500">
                  No purchase orders yet.
                </p>
              ) : null}
              {purchaseOrders.slice(0, 12).map((purchaseOrder) => (
                <article
                  key={purchaseOrder.id}
                  className="rounded-lg border border-zinc-200 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold text-zinc-950">
                        {purchaseOrder.poNumber}
                      </p>
                      <p className="mt-1 truncate text-sm text-zinc-500">
                        {purchaseOrder.supplierName} -{" "}
                        {formatDate(purchaseOrder.createdAt)}
                      </p>
                    </div>
                    <strong className="shrink-0 text-zinc-950">
                      {formatCurrency(purchaseOrder.total)}
                    </strong>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
                    <span className="rounded-lg bg-zinc-100 px-2 py-1 text-zinc-700">
                      {purchaseOrder.status}
                    </span>
                    <span
                      className={`rounded-lg px-2 py-1 ${
                        purchaseOrder.paymentStatus === "Paid"
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-rose-100 text-rose-700"
                      }`}
                    >
                      {purchaseOrder.paymentStatus}
                    </span>
                    <span className="rounded-lg bg-zinc-100 px-2 py-1 text-zinc-700">
                      {formatNumber(purchaseOrder.items.length)} items
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </section>
          ) : null}
        </section>

        <aside className="space-y-5">
          {activeWorkspace === "Add supplier" ? (
          <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                <Building2 size={21} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-zinc-950">
                  Add supplier
                </h2>
                <p className="text-sm text-zinc-500">Create a payable account.</p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <input
                value={supplierForm.name}
                onChange={(event) => {
                  updateSupplierForm({ name: event.target.value })
                  if (formErrors.name) {
                    setFormErrors((currentErrors) => ({ ...currentErrors, name: undefined }))
                  }
                }}
                placeholder="Supplier name"
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
                value={supplierForm.mobile}
                onChange={(event) => {
                  updateSupplierForm({ mobile: event.target.value })
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
                value={supplierForm.contact}
                onChange={(event) =>
                  updateSupplierForm({ contact: event.target.value })
                }
                placeholder="Contact person"
                className="h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
              <input
                value={supplierForm.address}
                onChange={(event) =>
                  updateSupplierForm({ address: event.target.value })
                }
                placeholder="Address"
                className="h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
              <textarea
                value={supplierForm.notes}
                onChange={(event) =>
                  updateSupplierForm({ notes: event.target.value })
                }
                placeholder="Notes"
                rows={3}
                className="w-full resize-none rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
              <button
                type="button"
                onClick={handleCreateSupplier}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-zinc-950 px-3 text-sm font-bold text-white transition hover:bg-zinc-800"
              >
                <Plus size={17} />
                Add Supplier
              </button>
            </div>
          </section>
          ) : null}

          {activeWorkspace === "Pay supplier" ? (
          <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                <HandCoins size={21} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-zinc-950">
                  Pay supplier
                </h2>
                <p className="text-sm text-zinc-500">
                  Settle a purchase order or supplier balance.
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <select
                value={payment.supplierId || selectedSupplierId}
                onChange={(event) => {
                  setSelectedSupplierId(event.target.value)
                  setPayment((currentPayment) => ({
                    ...currentPayment,
                    supplierId: event.target.value,
                    purchaseOrderId: "",
                  }))
                }}
                className="h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              >
                <option value="">Choose supplier</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name} - {formatCurrency(supplier.balance)}
                  </option>
                ))}
              </select>

              <select
                value={payment.purchaseOrderId}
                onChange={(event) =>
                  setPayment((currentPayment) => ({
                    ...currentPayment,
                    purchaseOrderId: event.target.value,
                  }))
                }
                className="h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              >
                <option value="">Any payable balance</option>
                {selectedOpenOrders.map((purchaseOrder) => (
                  <option key={purchaseOrder.id} value={purchaseOrder.id}>
                    {purchaseOrder.poNumber} -{" "}
                    {formatCurrency(purchaseOrder.total - purchaseOrder.paidTotal)}
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
                    amount: event.target.value,
                  }))
                }
                placeholder={`Payment amount, max ${formatCurrency(paymentBalance)}`}
                className="h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />

              <div className="grid grid-cols-2 gap-2">
                {supplierPaymentMethods.map((method) => {
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

          {activeWorkspace === "Activity" || activeWorkspace === "Accounts" ? (
          <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
                <Truck size={21} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-zinc-950">Activity</h2>
                <p className="text-sm text-zinc-500">Track supplier payments and purchase orders.</p>
              </div>
            </div>

            {selectedSupplier ? (
              <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-bold text-zinc-950">
                      {selectedSupplier.name}
                    </p>
                    <p className="text-sm text-zinc-500">
                      {selectedSupplier.contact || selectedSupplier.mobile || "-"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">
                      Balance
                    </p>
                    <p className="text-lg font-bold text-rose-700">
                      {formatCurrency(selectedSupplier.balance)}
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
                <article
                  key={`${activity.type}-${activity.id}`}
                  className="rounded-lg border border-zinc-200 bg-white p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-bold text-zinc-950">
                        {activity.label}
                      </p>
                      <p className="mt-1 text-xs font-semibold text-zinc-500">
                        {activity.type} - {formatDate(activity.createdAt)}
                      </p>
                    </div>
                    <p
                      className={`shrink-0 font-bold ${
                        activity.type === "Payment"
                          ? "text-emerald-700"
                          : "text-rose-700"
                      }`}
                    >
                      {activity.type === "Payment" ? "-" : ""}
                      {formatCurrency(activity.amount)}
                    </p>
                  </div>
                  <span className="mt-2 inline-flex rounded-lg bg-zinc-100 px-2 py-1 text-xs font-bold text-zinc-600">
                    {activity.status}
                  </span>
                </article>
              ))}
            </div>
          </section>
          ) : null}
        </aside>
      </div>
      <ConfirmDialog
        open={deleteSupplierId !== null}
        title="Delete supplier"
        confirmLabel="Delete"
        confirmDestructive
        onConfirm={() => {
          if (deleteSupplierId !== null) {
            deleteSupplier(deleteSupplierId)
            setDeleteSupplierId(null)
          }
        }}
        onCancel={() => setDeleteSupplierId(null)}
      >
        <p>Delete this supplier and their records? This cannot be undone.</p>
      </ConfirmDialog>
      </>
      )}
    </main>
  )
}
