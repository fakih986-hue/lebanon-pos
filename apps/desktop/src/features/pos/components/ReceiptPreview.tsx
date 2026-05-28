import { memo } from "react"
import { Printer, ReceiptText, RotateCcw, X } from "lucide-react"

import { useI18n } from "@lebanonpos/shared"

import { formatCurrency, formatLbpCurrency, formatNumber } from "../lib/currency"
import {
  formatReceiptDate,
  getSaleExchangeRate,
  getSaleGrossSubtotal,
  getRefundableQuantity,
  getRefundedQuantity,
  getRefundMethod,
  getRefundTotal,
  getSaleRefunds,
  getSaleRefundTotal,
  parseReturnQuantity,
} from "../lib/salesHelpers"
import { userCan } from "../services/security.service"
import type { Sale, SaleItem, SaleRefund } from "../services/sales.service"
import { usdToLbp } from "../lib/currency"

const ReceiptPreview = memo(function ReceiptPreview({
  sale,
  fallbackExchangeRate,
  refunds,
  refundQuantities,
  refundReason,
  refundStatus,
  canRefund,
  onClose,
  onPrint,
  onRefundQuantityChange,
  onRefundReasonChange,
  onRecordRefund,
  onVoid,
}: {
  sale?: Sale
  fallbackExchangeRate: number
  refunds: SaleRefund[]
  refundQuantities: Record<string, string>
  refundReason: string
  refundStatus: string
  canRefund: boolean
  onClose?: () => void
  onPrint: (sale: Sale) => void
  onRefundQuantityChange: (itemId: number, value: string) => void
  onRefundReasonChange: (value: string) => void
  onRecordRefund: (sale: Sale) => void
  onVoid: (saleId: string) => void
}) {
  const { t } = useI18n()
  if (!sale) {
    return (
      <div className="flex min-h-96 items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center">
        <div>
          <ReceiptText size={44} className="mx-auto text-zinc-300" />
          <p className="mt-3 font-bold text-zinc-950">{t("pos.no_receipt")}</p>
          <p className="mt-1 text-sm text-zinc-500">
            {t("pos.select_receipt_hint")}
          </p>
        </div>
      </div>
    )
  }

  const exchangeRate = getSaleExchangeRate(sale, fallbackExchangeRate)
  const totalLbp = usdToLbp(sale.total, exchangeRate)
  const discountTotal = sale.discountTotal ?? 0
  const grossSubtotal = getSaleGrossSubtotal(sale)
  const saleRefunds = getSaleRefunds(refunds, sale.id)
  const refundedTotal = getSaleRefundTotal(refunds, sale.id)
  const hasRefundableItems = sale.items.some(
    (item) => getRefundableQuantity(sale, item, refunds) > 0
  )
  const refundDraftItems = sale.items
    .map((item) => {
      const quantity = Math.min(
        parseReturnQuantity(refundQuantities[String(item.id)] ?? ""),
        getRefundableQuantity(sale, item, refunds)
      )

      return {
        ...item,
        quantity,
        total: item.unitPrice * quantity,
      }
    })
    .filter((item) => item.quantity > 0)
  const refundDraftTotal = Math.min(
    Math.max(0, sale.total - refundedTotal),
    getRefundTotal(sale, refundDraftItems)
  )

  return (
    <article className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-zinc-200 p-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">
            {t("pos.receipt")}
          </p>
          <h2 className="mt-1 text-2xl font-bold text-zinc-950">
            {sale.saleNumber}
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            {formatReceiptDate(sale.createdAt)}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onPrint(sale)}
            className="flex h-10 items-center gap-2 rounded-lg bg-zinc-950 px-3 text-sm font-bold text-white transition hover:bg-zinc-800"
          >
            <Printer size={16} />
            {t("pos.print")}
          </button>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 transition hover:bg-zinc-50 hover:text-zinc-950"
              aria-label={t("pos.close_receipt")}
            >
              <X size={18} />
            </button>
          ) : null}
        </div>
      </div>

      <div className="p-4">
        <div className="grid gap-2 text-sm sm:grid-cols-3">
          <div className="rounded-lg bg-zinc-50 p-3">
            <p className="text-zinc-500">{t("pos.payment")}</p>
            <p className="mt-1 font-bold text-zinc-950">
              {sale.paymentMethod}
            </p>
          </div>
          <div className="rounded-lg bg-zinc-50 p-3">
            <p className="text-zinc-500">{t("pos.cashier")}</p>
            <p className="mt-1 font-bold text-zinc-950">{sale.cashier}</p>
          </div>
          <div className="rounded-lg bg-zinc-50 p-3">
            <p className="text-zinc-500">{t("pos.customer")}</p>
            <p className="mt-1 font-bold text-zinc-950">
              {sale.customerName ?? t("pos.walk_in")}
            </p>
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200">
          <div className="grid grid-cols-[minmax(0,1fr)_64px_90px] bg-zinc-50 px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] text-zinc-500">
            <span>{t("pos.item_header")}</span>
            <span className="text-right">{t("pos.qty_header")}</span>
            <span className="text-right">{t("pos.total_header")}</span>
          </div>

          {sale.items.map((item) => (
            <div
              key={`${sale.id}-${item.id}`}
              className="grid grid-cols-[minmax(0,1fr)_64px_90px] border-t border-zinc-100 px-3 py-3 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate font-bold text-zinc-950">{item.name}</p>
                <p className="mt-1 truncate text-xs text-zinc-500">
                  {item.barcode} - {formatCurrency(item.unitPrice)}
                </p>
              </div>
              <span className="text-right font-semibold text-zinc-700">
                {formatNumber(item.quantity)}
              </span>
              <span className="text-right font-bold text-zinc-950">
                {formatCurrency(item.total)}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-4 space-y-2 rounded-lg bg-zinc-50 p-3 text-sm">
          {discountTotal > 0 ? (
            <>
              <div className="flex justify-between gap-3 text-zinc-600">
                <span>{t("pos.items_subtotal")}</span>
                <strong className="text-zinc-900">
                  {formatCurrency(grossSubtotal)}
                </strong>
              </div>
              <div className="flex justify-between gap-3 text-violet-700">
                <span>{t("pos.discount")}</span>
                <strong>-{formatCurrency(discountTotal)}</strong>
              </div>
            </>
          ) : null}
          <div className="flex justify-between gap-3 text-zinc-600">
            <span>{t("pos.subtotal")}</span>
            <strong className="text-zinc-900">{formatCurrency(sale.subtotal)}</strong>
          </div>
          <div className="flex justify-between gap-3 text-zinc-600">
            <span>{t("pos.vat")}</span>
            <strong className="text-zinc-900">{formatCurrency(sale.tax)}</strong>
          </div>
          <div className="flex justify-between gap-3 border-t border-zinc-200 pt-3 text-xl font-bold text-zinc-950">
            <span>{t("pos.total_usd")}</span>
            <span>{formatCurrency(sale.total)}</span>
          </div>
          <div className="flex justify-between gap-3 text-sm font-bold text-zinc-600">
            <span>{t("pos.total_lbp")}</span>
            <span>{formatLbpCurrency(totalLbp)}</span>
          </div>
          {refundedTotal > 0 ? (
            <>
              <div className="flex justify-between gap-3 text-rose-700">
                <span>{t("pos.refunded")}</span>
                <strong>-{formatCurrency(refundedTotal)}</strong>
              </div>
              <div className="flex justify-between gap-3 border-t border-zinc-200 pt-3 text-base font-bold text-zinc-950">
                <span>{t("pos.net_receipt")}</span>
                <span>{formatCurrency(Math.max(0, sale.total - refundedTotal))}</span>
              </div>
            </>
          ) : null}
        </div>

        {sale.tender ? (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
            <div className="flex justify-between gap-3">
              <span>{t("pos.paid_total")}</span>
              <strong>
                {formatCurrency(sale.tender.paidTotalUsd)} /{" "}
                {formatLbpCurrency(sale.tender.paidTotalLbp)}
              </strong>
            </div>
            <div className="mt-2 flex justify-between gap-3">
              <span>{t("pos.change_usd")}</span>
              <strong>{formatCurrency(sale.tender.changeUsd)}</strong>
            </div>
            <div className="flex justify-between gap-3">
              <span>{t("pos.change_lbp")}</span>
              <strong>{formatLbpCurrency(sale.tender.changeLbp)}</strong>
            </div>
          </div>
        ) : null}

        <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-bold text-rose-950">
              <RotateCcw size={17} />
              {t("pos.returns")}
            </div>
            <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-rose-800 ring-1 ring-rose-200">
              {getRefundMethod(sale)}
            </span>
          </div>

          {saleRefunds.length > 0 ? (
            <div className="mt-3 space-y-2">
              {saleRefunds.map((refund) => (
                <div
                  key={refund.id}
                  className="flex justify-between gap-3 rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-rose-100"
                >
                  <span className="font-semibold text-zinc-700">
                    {refund.refundNumber}
                  </span>
                  <strong className="text-rose-700">
                    -{formatCurrency(refund.total)}
                  </strong>
                </div>
              ))}
            </div>
          ) : null}

          {!canRefund ? (
            <p className="mt-3 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-rose-900 ring-1 ring-rose-100">
              {t("pos.permission_required")}
            </p>
          ) : !hasRefundableItems ? (
            <p className="mt-3 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-rose-900 ring-1 ring-rose-100">
              {t("pos.fully_returned")}
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              <div className="space-y-2">
                {sale.items.map((item) => {
                  const refundedQuantity = getRefundedQuantity(
                    refunds,
                    sale.id,
                    item.id
                  )
                  const availableQuantity = getRefundableQuantity(
                    sale,
                    item,
                    refunds
                  )

                  return (
                    <div
                      key={`return-${sale.id}-${item.id}`}
                      className="grid grid-cols-[minmax(0,1fr)_86px] gap-3 rounded-lg bg-white p-3 ring-1 ring-rose-100"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-bold text-zinc-950">
                          {item.name}
                        </p>
                        <p className="mt-1 text-xs font-semibold text-zinc-500">
                          {t("pos.sold_returned", { n: formatNumber(item.quantity), n2: formatNumber(refundedQuantity) })}
                        </p>
                      </div>
                      <label className="block text-xs font-bold text-rose-900">
                        {t("pos.return_label")}
                        <input
                          type="number"
                          min="0"
                          max={availableQuantity}
                          step="1"
                          disabled={availableQuantity === 0}
                          value={refundQuantities[String(item.id)] ?? ""}
                          onChange={(event) =>
                            onRefundQuantityChange(item.id, event.target.value)
                          }
                          className="mt-1 h-10 w-full rounded-lg border border-rose-200 bg-white px-2 text-right text-zinc-900 outline-none focus:border-rose-400 focus:ring-4 focus:ring-rose-100 disabled:bg-zinc-100 disabled:text-zinc-400"
                        />
                      </label>
                    </div>
                  )
                })}
              </div>

              <input
                value={refundReason}
                onChange={(event) => onRefundReasonChange(event.target.value)}
                placeholder={t("pos.return_reason")}
                className="h-11 w-full rounded-lg border border-rose-200 bg-white px-3 text-sm font-medium outline-none focus:border-rose-400 focus:ring-4 focus:ring-rose-100"
              />

              <div className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-rose-100">
                <span className="font-semibold text-zinc-600">
                  {t("pos.refund_amount")}
                </span>
                <strong className="text-rose-700">
                  {formatCurrency(refundDraftTotal)}
                </strong>
              </div>

              <button
                type="button"
                onClick={() => onRecordRefund(sale)}
                disabled={refundDraftItems.length === 0}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-rose-600 px-3 text-sm font-bold text-white transition hover:bg-rose-500 disabled:bg-zinc-200 disabled:text-zinc-400"
              >
                <RotateCcw size={16} />
                {t("pos.record_return")}
              </button>

              <p className="text-sm font-semibold text-rose-900">
                {refundStatus}
              </p>
            </div>
          )}

          {sale && sale.status !== "Voided" && userCan("sales.void") && (
            <button
              type="button"
              onClick={() => onVoid(sale.id)}
              className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-rose-200 bg-white px-3 text-sm font-bold text-rose-600 transition hover:bg-rose-50"
            >
              <X size={16} />
              {t("pos.void")}
            </button>
          )}
        </div>
      </div>
    </article>
  )
})

export default ReceiptPreview
