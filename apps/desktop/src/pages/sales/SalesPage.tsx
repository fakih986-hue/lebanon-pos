import { useEffect, useMemo, useRef, useState } from "react"
import { useDebounce } from "../../hooks/useDebounce"
import { useHotkeys } from "../../hooks/useHotkey"
import { useSearchParams } from "react-router"
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
import WorkspaceTabs from "../../components/ui/WorkspaceTabs"
import { useI18n } from "@lebanonpos/shared"

type SalesTab = "Receipts" | "Insights"

export default function SalesPage() {
  const { t } = useI18n()
  const [searchParams, setSearchParams] = useSearchParams()
  const [sales, setSales] = useState<Sale[]>(getSales())
  const [refunds, setRefunds] = useState<SaleRefund[]>(getRefunds())
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebounce(search, 200)
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
  const [refundStatus, setRefundStatus] = useState(t("pos.sales.refund_status_default"))
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

  const searchRef = useRef<HTMLInputElement>(null)
  useHotkeys([{ key: "f", modifiers: ["ctrl"], handler: () => searchRef.current?.focus() }])
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
  }, [paymentFilter, sales, debouncedSearch])

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
    setRefundStatus(t("pos.sales.refund_status_default"))
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
      setRefundStatus(t("pos.permission_required"))
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
      setRefundStatus(t("pos.sales.choose_item_qty"))
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
      setRefundStatus(t("pos.sales.no_refundable_balance"))
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
    setRefundStatus(t("pos.sales.refund_recorded", { refund: refund.refundNumber }))
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-page p-3 sm:p-5 xl:p-6">
      <SalesKpiCards metrics={metrics} />

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <WorkspaceTabs<SalesTab>
          active={activeTab}
          onChange={selectTab}
          tabs={[
            { label: t("pos.sales.tab_receipts"), icon: <ReceiptText size={18} />, count: sales.length },
            { label: t("pos.sales.tab_insights"), icon: <BarChart3 size={18} /> },
          ]}
        />

        <div className="flex gap-2">
          <label className="relative w-full sm:w-64">
            <span className="sr-only">{t("pos.sales.search_sales")}</span>
            <Search
              size={16}
              className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400"
            />
            <input
              ref={searchRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("pos.sales.search_placeholder")}
              className="h-10 w-full rounded-lg border border-zinc-200 bg-white ps-9 pe-3 text-sm outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
            />
          </label>

          <select
            value={paymentFilter}
            onChange={(event) =>
              setPaymentFilter(event.target.value as "All" | SalePaymentMethod)
            }
            className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
          >
            <option value="All">{t("pos.sales.all_payments")}</option>
            <option value="Cash">{t("pos.payment.cash")}</option>
            <option value="Card">{t("pos.payment.card")}</option>
            <option value="Wallet">{t("pos.payment.wallet")}</option>
            <option value="Debt">{t("pos.payment.debt")}</option>
          </select>
        </div>
      </div>

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
            aria-label={t("pos.sales.receipt_details")}
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
        title={t("pos.record_return")}
        confirmLabel={t("pos.record_return")}
        confirmDestructive
        onConfirm={executeRefund}
        onCancel={() => setPendingRefund(null)}
      >
        <p>
          {t("pos.sales.confirm_refund", { count: pendingRefund?.refundItems.length ?? 0, total: formatCurrency(pendingRefund?.refundTotal ?? 0) })}
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={voidSaleId !== null}
        title={t("pos.sales.void_sale_title")}
        confirmLabel={t("pos.void")}
        confirmDestructive
        onConfirm={() => {
          if (voidSaleId !== null) {
            voidSale(voidSaleId)
            setVoidSaleId(null)
          }
        }}
        onCancel={() => setVoidSaleId(null)}
      >
        <p>{t("pos.sales.void_sale_message")}</p>
      </ConfirmDialog>
    </main>
  )
}
