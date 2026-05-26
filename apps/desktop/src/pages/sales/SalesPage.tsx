import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { BarChart3, ReceiptText, Search } from "lucide-react"

import { formatCurrency } from "../../features/pos/lib/currency"
import { getSettings } from "../../features/pos/services/settings.service"
import {
  getPaymentMix,
  getRefunds,
  getSales,
  getSalesMetrics,
  recordRefund,
  subscribeRefunds,
  subscribeSales,
  voidSale,
  type Sale,
  type SalePaymentMethod,
  type SaleRefund,
} from "../../features/pos/services/sales.service"
import { recordDebtPayment } from "../../features/pos/services/customer.service"
import { restoreInventoryBatches } from "../../features/pos/services/inventoryBatch.service"
import { increaseProductStock } from "../../features/pos/services/product.service"
import { userCan } from "../../features/pos/services/security.service"
import {
  getRefundMethod,
  getRefundTotal,
  getRefundableQuantity,
  getSaleRefunds,
  parseReturnQuantity,
} from "../../features/pos/lib/salesHelpers"
import { printSaleReceipt } from "../../features/pos/lib/printReceipt"
import InsightsPanel from "../../features/pos/components/InsightsPanel"
import ReceiptList from "../../features/pos/components/ReceiptList"
import ReceiptPreview from "../../features/pos/components/ReceiptPreview"
import SalesKpiCards from "../../features/pos/components/SalesKpiCards"
import ConfirmDialog from "../../components/ConfirmDialog"

type SalesTab = "Receipts" | "Insights"

export default function SalesPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [sales, setSales] = useState<Sale[]>(getSales())
  const [refunds, setRefunds] = useState<SaleRefund[]>(getRefunds())
  const [search, setSearch] = useState("")
  const [paymentFilter, setPaymentFilter] = useState<"All" | SalePaymentMethod>(
    "All"
  )
  const [activeTab, setActiveTab] = useState<SalesTab>(
    searchParams.get("tab") === "insights" ? "Insights" : "Receipts"
  )
  const [selectedSaleId, setSelectedSaleId] = useState("")
  const [drawerSaleId, setDrawerSaleId] = useState<string | null>(null)
  const [refundQuantities, setRefundQuantities] = useState<
    Record<string, string>
  >({})
  const [refundReason, setRefundReason] = useState("")
  const [refundStatus, setRefundStatus] = useState("Choose quantities to return.")
  const [pendingRefund, setPendingRefund] = useState<{
    sale: Sale
    refundTotal: number
    refundItems: Array<{ id: number; name: string; barcode: string; quantity: number; unitPrice: number; cost: number; total: number }>
    refundReason: string
  } | null>(null)
  const [voidSaleId, setVoidSaleId] = useState<string | null>(null)

  useEffect(() => subscribeSales(setSales), [])
  useEffect(() => subscribeRefunds(setRefunds), [])

  useEffect(() => {
    setActiveTab(searchParams.get("tab") === "insights" ? "Insights" : "Receipts")
  }, [searchParams])

  const settings = getSettings()
  const metrics = useMemo(() => getSalesMetrics(), [sales, refunds])
  const paymentMix = useMemo(() => getPaymentMix(), [sales, refunds])
  const filteredSales = useMemo(() => {
    const query = search.trim().toLowerCase()

    return sales.filter((sale) => {
      const matchesPayment =
        paymentFilter === "All" || sale.paymentMethod === paymentFilter
      const matchesSearch =
        query.length === 0 ||
        sale.saleNumber.toLowerCase().includes(query) ||
        sale.customerName?.toLowerCase().includes(query) ||
        sale.items.some((item) => item.name.toLowerCase().includes(query))

      return matchesPayment && matchesSearch
    })
  }, [paymentFilter, sales, search])

  const selectedSale =
    sales.find((sale) => sale.id === selectedSaleId) ?? filteredSales[0]
  const drawerSale = sales.find((sale) => sale.id === drawerSaleId)
  const canRefund = userCan("sales.refund")

  useEffect(() => {
    if (!selectedSale && filteredSales[0]) {
      setSelectedSaleId(filteredSales[0].id)
    }
  }, [filteredSales, selectedSale])

  useEffect(() => {
    setRefundQuantities({})
    setRefundReason("")
    setRefundStatus("Choose quantities to return.")
  }, [drawerSaleId, selectedSale?.id])

  function selectTab(tab: SalesTab) {
    setActiveTab(tab)
    setSearchParams({ tab: tab === "Insights" ? "insights" : "receipts" })
  }

  function handlePrint(sale: Sale) {
    printSaleReceipt(sale, settings.usdToLbpRate, refunds)
  }

  function handleRefundQuantityChange(itemId: number, value: string) {
    setRefundQuantities((currentQuantities) => ({
      ...currentQuantities,
      [String(itemId)]: value,
    }))
  }

  function handleRecordRefund(sale: Sale) {
    if (!canRefund) {
      setRefundStatus("Manager or admin permission required.")
      return
    }

    const saleRefunds = getSaleRefunds(refunds, sale.id)
    const refundItems = sale.items
      .map((item) => {
        const availableQuantity = getRefundableQuantity(sale, item, refunds)
        const quantity = Math.min(
          parseReturnQuantity(refundQuantities[String(item.id)] ?? ""),
          availableQuantity
        )

        return {
          ...item,
          quantity,
          total: item.unitPrice * quantity,
        }
      })
      .filter((item) => item.quantity > 0)

    if (refundItems.length === 0) {
      setRefundStatus("Choose at least one item quantity.")
      return
    }

    const alreadyRefunded = saleRefunds.reduce(
      (sum, refund) => sum + refund.total,
      0
    )
    const refundTotal = Math.min(
      Math.max(0, sale.total - alreadyRefunded),
      getRefundTotal(sale, refundItems)
    )

    if (refundTotal <= 0) {
      setRefundStatus("This sale has no refundable balance left.")
      return
    }

    setPendingRefund({
      sale,
      refundTotal,
      refundItems: refundItems.map((item) => ({
        id: item.id,
        name: item.name,
        barcode: item.barcode,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        cost: item.cost,
        total: item.total,
      })),
      refundReason: refundReason,
    })
  }

  function executeRefund() {
    if (!pendingRefund) return
    const { sale, refundTotal, refundItems, refundReason } = pendingRefund

    const refund = recordRefund({
      saleId: sale.id,
      saleNumber: sale.saleNumber,
      customerId: sale.customerId,
      customerName: sale.customerName,
      method: getRefundMethod(sale),
      reason: refundReason,
      total: refundTotal,
      items: refundItems,
    })

    increaseProductStock(
      refundItems.map((item) => ({
        productId: item.id,
        quantity: item.quantity,
      }))
    )
    restoreInventoryBatches(
      refundItems.map((item) => ({
        productId: item.id,
        productName: item.name,
        barcode: item.barcode,
        quantity: item.quantity,
        fallbackUnitCost: item.cost,
      }))
    )

    if (sale.paymentMethod === "Debt" && sale.customerId) {
      recordDebtPayment({
        customerId: sale.customerId,
        amount: refundTotal,
        method: "Refund Credit",
        reference: `${refund.refundNumber} return for ${sale.saleNumber}`,
      })
    }

    setRefunds(getRefunds())
    setRefundQuantities({})
    setRefundReason("")
    setPendingRefund(null)
    setRefundStatus(`${refund.refundNumber} recorded.`)
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-[#eef3f2] p-3 sm:p-5 xl:p-6">
      <SalesKpiCards metrics={metrics} />

      <section className="mt-4 rounded-lg border border-zinc-200 bg-white p-1 shadow-sm">
        <div className="grid grid-cols-2 gap-1">
          {(["Receipts", "Insights"] as SalesTab[]).map((tab) => {
            const active = activeTab === tab
            const Icon = tab === "Receipts" ? ReceiptText : BarChart3

            return (
              <button
                key={tab}
                type="button"
                onClick={() => selectTab(tab)}
                className={`flex h-12 items-center justify-center gap-2 rounded-lg text-sm font-bold transition ${
                  active
                    ? "bg-zinc-950 text-white"
                    : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-950"
                }`}
              >
                <Icon size={18} />
                {tab === "Receipts" ? "Receipt History" : "Sales Insights"}
              </button>
            )
          })}
        </div>
      </section>

      <section className="mt-4 rounded-lg border border-zinc-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-zinc-200 p-3 sm:p-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="text-xl font-bold text-zinc-950">
              {activeTab === "Receipts" ? "Receipt history" : "Sales ledger"}
            </h2>
            <p className="text-sm text-zinc-500">
              {activeTab === "Receipts"
                ? "Every completed sale stays available for lookup and reprint."
                : "Filter the complete transaction ledger by payment and item."}
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="relative w-full sm:w-80">
              <span className="sr-only">Search sales</span>
              <Search
                size={18}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
              />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search receipt, customer, item"
                className="h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 pl-10 pr-3 outline-none transition focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </label>

            <select
              value={paymentFilter}
              onChange={(event) =>
                setPaymentFilter(event.target.value as "All" | SalePaymentMethod)
              }
              className="h-11 rounded-lg border border-zinc-200 bg-zinc-50 px-3 font-semibold text-zinc-700 outline-none transition focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
            >
              <option value="All">All payments</option>
              <option value="Cash">Cash</option>
              <option value="Card">Card</option>
              <option value="Wallet">Wallet</option>
              <option value="Debt">Debt</option>
            </select>
          </div>
        </div>
      </section>

      {activeTab === "Receipts" ? (
        <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(320px,430px)_minmax(0,1fr)]">
          <ReceiptList
            filteredSales={filteredSales}
            selectedSaleId={selectedSaleId}
            refunds={refunds}
            onSelectSale={setSelectedSaleId}
            handlePrint={handlePrint}
            onViewSale={(sale) => {
              setSelectedSaleId(sale.id)
              setDrawerSaleId(sale.id)
            }}
          />

          <div className="hidden xl:block">
            <div className="sticky top-4">
              <ReceiptPreview
                sale={selectedSale}
                fallbackExchangeRate={settings.usdToLbpRate}
                refunds={refunds}
                refundQuantities={refundQuantities}
                refundReason={refundReason}
                refundStatus={refundStatus}
                canRefund={canRefund}
                onPrint={handlePrint}
                onRefundQuantityChange={handleRefundQuantityChange}
                onRefundReasonChange={setRefundReason}
                onRecordRefund={handleRecordRefund}
                onVoid={setVoidSaleId}
              />
            </div>
          </div>
        </section>
      ) : (
        <InsightsPanel
          filteredSales={filteredSales}
          paymentMix={paymentMix}
          onViewSale={(sale) => setDrawerSaleId(sale.id)}
        />
      )}

      {drawerSale ? (
        <div
          className="fixed inset-0 z-50 flex justify-end"
          onKeyDown={(e) => { if (e.key === "Escape") setDrawerSaleId(null) }}
          tabIndex={0}
        >
          <div
            className="fixed inset-0 bg-black/20 transition-opacity duration-300"
            onClick={() => setDrawerSaleId(null)}
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Receipt details"
            className="relative z-10 flex h-full w-full max-w-2xl flex-col overflow-hidden bg-white shadow-2xl transition-transform duration-300 sm:rounded-xl translate-x-0"
          >
            <div className="flex-1 overflow-y-auto">
              <ReceiptPreview
                sale={drawerSale}
                fallbackExchangeRate={settings.usdToLbpRate}
                refunds={refunds}
                refundQuantities={refundQuantities}
                refundReason={refundReason}
                refundStatus={refundStatus}
                canRefund={canRefund}
                onClose={() => setDrawerSaleId(null)}
                onPrint={handlePrint}
                onRefundQuantityChange={handleRefundQuantityChange}
                onRefundReasonChange={setRefundReason}
                onRecordRefund={handleRecordRefund}
                onVoid={setVoidSaleId}
              />
            </div>
          </aside>
        </div>
      ) : null}

      <ConfirmDialog
        open={!!pendingRefund}
        title="Record return"
        confirmLabel="Record Return"
        confirmDestructive
        onConfirm={executeRefund}
        onCancel={() => setPendingRefund(null)}
      >
        <p>
          Process refund for {pendingRefund?.refundItems.length} item(s) totaling {formatCurrency(pendingRefund?.refundTotal ?? 0)}?
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={voidSaleId !== null}
        title="Void sale"
        confirmLabel="Void"
        confirmDestructive
        onConfirm={() => {
          if (voidSaleId !== null) {
            voidSale(voidSaleId)
            setVoidSaleId(null)
          }
        }}
        onCancel={() => setVoidSaleId(null)}
      >
        <p>Void this sale? This marks it as voided in the records.</p>
      </ConfirmDialog>
    </main>
  )
}
