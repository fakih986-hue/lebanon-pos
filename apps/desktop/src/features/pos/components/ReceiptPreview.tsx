import { memo, useState } from "react"
import { ChevronDown, Printer, ReceiptText, RotateCcw, X } from "lucide-react"

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
  const [showReturns, setShowReturns] = useState(false)

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
          {sale.soldAtCost && (
            <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
              SOLD AT COST
            </span>
          )}
          <p className="mt-1 text-sm text-zinc-500">
            {formatReceiptDate(sale.createdAt)}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {userCan("sales.reprint") && (
          <button
            type="button"
            onClick={() => onPrint(sale)}
            className="flex h-10 items-center gap-2 rounded-lg bg-zinc-950 px-3 text-sm font-bold text-white transition hover:bg-zinc-800"
          >
            <Printer size={16} />
            {t("pos.print")}
          </button>
          )}
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
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-2 bg-zinc-50 px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] text-zinc-500">
            <span>{t("pos.item_header")}</span>
            <span className="text-end" style={{ minWidth: 40 }}>{t("pos.qty_header")}</span>
            <span className="text-end" style={{ minWidth: 70 }}>{t("pos.total_header")}</span>
          </div>

          {sale.items.map((item) => (
            <div
              key={`${sale.id}-${item.id}`}
              className="grid grid-cols-[1fr_auto_auto] gap-x-2 border-t border-zinc-100 px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="text-[13px] font-bold break-words" style={{ color: "var(--text)", wordBreak: "break-word" }}>{(item as any).name ?? (item as any).productName ?? "Product"}</p>
                <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-3)" }}>
                  @{formatCurrency(item.unitPrice)}
                </p>
              </div>
              <span className="text-end font-semibold self-center" style={{ color: "var(--text-2)", minWidth: 40 }}>
                {formatNumber(item.quantity)}
              </span>
              <span className="text-end font-bold self-center" style={{ color: "var(--text)", minWidth: 70 }}>
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
          <div className="mt-4 rounded-lg p-3 text-sm text-white" style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)" }}>
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

        {/* Return / Void actions */}
        <div className="mt-4 flex gap-2">
          {canRefund && hasRefundableItems && (
            <button
              type="button"
              onClick={() => setShowReturns(!showReturns)}
              className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-[12px] font-bold transition"
              style={{ background: "var(--rose-soft)", color: "var(--rose-text)", border: "1px solid rgba(239,68,68,0.2)" }}
            >
              <RotateCcw size={14} />
              {t("pos.returns")}
              <ChevronDown size={12} className={`transition ${showReturns ? "rotate-180" : ""}`} />
            </button>
          )}
          {sale && sale.status !== "Voided" && userCan("sales.void") && (
            <button
              type="button"
              onClick={() => onVoid(sale.id)}
              className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border text-[12px] font-bold transition"
              style={{ borderColor: "var(--border)", color: "var(--text-3)" }}
            >
              <X size={14} />
              {t("pos.void")}
            </button>
          )}
        </div>

        {showReturns && (
          <div className="mt-3 rounded-lg p-3" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
            <div className="flex items-center justify-between gap-3 mb-3">
              <span className="text-[12px] font-bold" style={{ color: "var(--rose-text)" }}>{t("pos.returns")}</span>
              <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: "var(--surface)", color: "var(--text-3)" }}>
                {getRefundMethod(sale)}
              </span>
            </div>

            {saleRefunds.length > 0 ? (
              <div className="space-y-1.5 mb-3">
                {saleRefunds.map((refund) => (
                  <div key={refund.id} className="flex justify-between gap-3 rounded-lg px-3 py-2 text-[12px]" style={{ background: "var(--surface)" }}>
                    <span className="font-semibold" style={{ color: "var(--text-2)" }}>{refund.refundNumber}</span>
                    <strong style={{ color: "var(--rose-text)" }}>-{formatCurrency(refund.total)}</strong>
                  </div>
                ))}
              </div>
            ) : null}

            {canRefund && hasRefundableItems && (
              <div className="space-y-2">
                {sale.items.map((item) => {
                  const refundedQuantity = getRefundedQuantity(refunds, sale.id, item.id)
                  const availableQuantity = getRefundableQuantity(sale, item, refunds)

                  return (
                    <div key={`return-${sale.id}-${item.id}`} className="grid grid-cols-[minmax(0,1fr)_72px] gap-2 rounded-lg px-3 py-2 text-[12px]" style={{ background: "var(--surface)" }}>
                      <div className="min-w-0">
                        <p className="truncate font-bold" style={{ color: "var(--text)" }}>{item.name}</p>
                        <p className="text-[11px]" style={{ color: "var(--text-3)" }}>
                          {t("pos.sold_returned", { n: formatNumber(item.quantity), n2: formatNumber(refundedQuantity) })}
                        </p>
                      </div>
                      <input
                        type="number" min="0" max={availableQuantity} step="1"
                        disabled={availableQuantity === 0}
                        value={refundQuantities[String(item.id)] ?? ""}
                        onChange={(event) => onRefundQuantityChange(item.id, event.target.value)}
                        className="h-8 w-full rounded-lg border px-2 text-end text-[12px] font-bold outline-none"
                        style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--text)" }}
                      />
                    </div>
                  )
                })}

                <input
                  value={refundReason}
                  onChange={(event) => onRefundReasonChange(event.target.value)}
                  placeholder={t("pos.return_reason")}
                  className="h-9 w-full rounded-lg border px-3 text-[12px] font-medium outline-none"
                  style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--text)" }}
                />

                <div className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-[12px]" style={{ background: "var(--surface)" }}>
                  <span className="font-semibold" style={{ color: "var(--text-2)" }}>{t("pos.refund_amount")}</span>
                  <strong style={{ color: "var(--rose-text)" }}>{formatCurrency(refundDraftTotal)}</strong>
                </div>

                <button
                  type="button"
                  onClick={() => onRecordRefund(sale)}
                  disabled={refundDraftItems.length === 0}
                  className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg text-[12px] font-bold text-white transition"
                  style={{ background: "var(--rose)" }}
                >
                  <RotateCcw size={13} />
                  {t("pos.record_return")}
                </button>

                {refundStatus && (
                  <p className="text-[12px] font-semibold" style={{ color: "var(--rose-text)" }}>{refundStatus}</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  )
})

export default ReceiptPreview
