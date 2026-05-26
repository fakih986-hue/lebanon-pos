import { Printer, ReceiptText, RotateCcw, X } from "lucide-react"

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

export default function ReceiptPreview({
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
  if (!sale) {
    return (
      <div className="flex min-h-96 items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center">
        <div>
          <ReceiptText size={44} className="mx-auto text-zinc-300" />
          <p className="mt-3 font-bold text-zinc-950">No receipt selected</p>
          <p className="mt-1 text-sm text-zinc-500">
            Select a sale to preview the full receipt.
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
            Receipt
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
            Print
          </button>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 transition hover:bg-zinc-50 hover:text-zinc-950"
              aria-label="Close receipt"
            >
              <X size={18} />
            </button>
          ) : null}
        </div>
      </div>

      <div className="p-4">
        <div className="grid gap-2 text-sm sm:grid-cols-3">
          <div className="rounded-lg bg-zinc-50 p-3">
            <p className="text-zinc-500">Payment</p>
            <p className="mt-1 font-bold text-zinc-950">
              {sale.paymentMethod}
            </p>
          </div>
          <div className="rounded-lg bg-zinc-50 p-3">
            <p className="text-zinc-500">Cashier</p>
            <p className="mt-1 font-bold text-zinc-950">{sale.cashier}</p>
          </div>
          <div className="rounded-lg bg-zinc-50 p-3">
            <p className="text-zinc-500">Customer</p>
            <p className="mt-1 font-bold text-zinc-950">
              {sale.customerName ?? "Walk-in"}
            </p>
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200">
          <div className="grid grid-cols-[minmax(0,1fr)_64px_90px] bg-zinc-50 px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] text-zinc-500">
            <span>Item</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Total</span>
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
                <span>Items subtotal</span>
                <strong className="text-zinc-900">
                  {formatCurrency(grossSubtotal)}
                </strong>
              </div>
              <div className="flex justify-between gap-3 text-violet-700">
                <span>Discount</span>
                <strong>-{formatCurrency(discountTotal)}</strong>
              </div>
            </>
          ) : null}
          <div className="flex justify-between gap-3 text-zinc-600">
            <span>Subtotal</span>
            <strong className="text-zinc-900">{formatCurrency(sale.subtotal)}</strong>
          </div>
          <div className="flex justify-between gap-3 text-zinc-600">
            <span>VAT</span>
            <strong className="text-zinc-900">{formatCurrency(sale.tax)}</strong>
          </div>
          <div className="flex justify-between gap-3 border-t border-zinc-200 pt-3 text-xl font-bold text-zinc-950">
            <span>Total USD</span>
            <span>{formatCurrency(sale.total)}</span>
          </div>
          <div className="flex justify-between gap-3 text-sm font-bold text-zinc-600">
            <span>Total LBP</span>
            <span>{formatLbpCurrency(totalLbp)}</span>
          </div>
          {refundedTotal > 0 ? (
            <>
              <div className="flex justify-between gap-3 text-rose-700">
                <span>Refunded</span>
                <strong>-{formatCurrency(refundedTotal)}</strong>
              </div>
              <div className="flex justify-between gap-3 border-t border-zinc-200 pt-3 text-base font-bold text-zinc-950">
                <span>Net receipt</span>
                <span>{formatCurrency(Math.max(0, sale.total - refundedTotal))}</span>
              </div>
            </>
          ) : null}
        </div>

        {sale.tender ? (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
            <div className="flex justify-between gap-3">
              <span>Paid total</span>
              <strong>
                {formatCurrency(sale.tender.paidTotalUsd)} /{" "}
                {formatLbpCurrency(sale.tender.paidTotalLbp)}
              </strong>
            </div>
            <div className="mt-2 flex justify-between gap-3">
              <span>Change returned</span>
              <strong>
                {sale.tender.changeCurrency === "USD"
                  ? formatCurrency(sale.tender.changeUsd)
                  : formatLbpCurrency(sale.tender.changeLbp)}
              </strong>
            </div>
          </div>
        ) : null}

        <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-bold text-rose-950">
              <RotateCcw size={17} />
              Returns
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
              Manager or admin permission required.
            </p>
          ) : !hasRefundableItems ? (
            <p className="mt-3 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-rose-900 ring-1 ring-rose-100">
              This receipt is fully returned.
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
                          Sold {formatNumber(item.quantity)} - Returned{" "}
                          {formatNumber(refundedQuantity)}
                        </p>
                      </div>
                      <label className="block text-xs font-bold text-rose-900">
                        Return
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
                placeholder="Return reason"
                className="h-11 w-full rounded-lg border border-rose-200 bg-white px-3 text-sm font-medium outline-none focus:border-rose-400 focus:ring-4 focus:ring-rose-100"
              />

              <div className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-rose-100">
                <span className="font-semibold text-zinc-600">
                  Refund amount
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
                Record Return
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
              Void
            </button>
          )}
        </div>
      </div>
    </article>
  )
}
