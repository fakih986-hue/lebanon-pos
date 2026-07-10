import { Clock3, Eye, Printer, ReceiptText } from "lucide-react"

import { useI18n } from "@lebanonpos/shared"
import { formatCurrency } from "../lib/currency"
import {
  formatDate,
  getSaleQuantity,
  getSaleRefundTotal,
  paymentIcons,
} from "../lib/salesHelpers"
import type { Sale, SaleRefund } from "../services/sales.service"

export default function ReceiptList({
  filteredSales,
  selectedSaleId,
  refunds,
  onSelectSale,
  handlePrint,
  onViewSale,
}: {
  filteredSales: Sale[]
  selectedSaleId: string
  refunds: SaleRefund[]
  onSelectSale: (id: string) => void
  handlePrint: (sale: Sale) => void
  onViewSale: (sale: Sale) => void
}) {
  const { t } = useI18n()
  return (
    <div className="rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5" style={{ borderColor: "var(--border)" }}>
        <p className="text-[13px] font-bold" style={{ color: "var(--text)" }}>
          {t("pos.receipt_list.count", { n: filteredSales.length })}
        </p>
        <ReceiptText size={16} style={{ color: "var(--text-3)" }} />
      </div>

      <div className="max-h-[70vh] space-y-1.5 overflow-y-auto p-2">
        {filteredSales.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-10 text-center" style={{ borderColor: "var(--border)" }}>
            <ReceiptText size={28} style={{ color: "var(--text-3)" }} />
            <p className="mt-2 text-[13px] font-bold" style={{ color: "var(--text-2)" }}>
              {t("pos.receipt_list.no_receipts")}
            </p>
            <p className="mt-0.5 text-[12px]" style={{ color: "var(--text-3)" }}>
              {t("pos.receipt_list.no_receipts_sub")}
            </p>
          </div>
        ) : null}

        {filteredSales.map((sale) => {
          const Icon = paymentIcons[sale.paymentMethod]
          const active = selectedSaleId === sale.id
          const quantity = getSaleQuantity(sale)
          const refundedTotal = getSaleRefundTotal(refunds, sale.id)

          return (
            <article
              key={sale.id}
              className="rounded-lg border transition"
              style={active
                ? { borderColor: "var(--brand-border)", background: "var(--brand-soft)", boxShadow: "inset 3px 0 0 var(--brand)" }
                : { borderColor: "var(--border)", background: "var(--surface)" }}
            >
              <div className="flex items-stretch">
                <button
                  type="button"
                  onClick={() => onSelectSale(sale.id)}
                  onDoubleClick={() => onViewSale(sale)}
                  className="block min-w-0 flex-1 px-2.5 py-2.5 text-start"
                  aria-pressed={active}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[13px] font-bold truncate" style={{ color: "var(--text)" }}>
                        {sale.saleNumber}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold shrink-0" style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                        <Icon size={11} />
                        {sale.paymentMethod}
                      </span>
                    </div>
                    <span className="shrink-0 text-[15px] font-black tabular-nums" style={{ color: "var(--text)" }}>
                      {formatCurrency(sale.total)}
                    </span>
                  </div>

                  <div className="mt-1 flex items-center gap-2 text-[11px]" style={{ color: "var(--text-3)" }}>
                    <span>{formatDate(sale.createdAt)}</span>
                    <span className="opacity-40">·</span>
                    <span>{sale.customerName || "Walk-in"}</span>
                    <span className="opacity-40">·</span>
                    <span>{quantity} {t("pos.items_short") || "items"}</span>
                    {refundedTotal > 0 && (
                      <>
                        <span className="opacity-40">·</span>
                        <span style={{ color: "var(--rose-text)" }}>
                          ↩ {formatCurrency(refundedTotal)}
                        </span>
                      </>
                    )}
                  </div>

                  <p className="mt-1 text-[12px] line-clamp-1" style={{ color: "var(--text-2)" }}>
                    {sale.items.map((item) => (item as any).name ?? (item as any).productName ?? "").filter(Boolean).join(", ")}
                  </p>
                </button>

                {/* Compact actions — rows stay calm, no full-width strips */}
                <div className="flex shrink-0 flex-col justify-center gap-1 pe-2">
                  <button
                    type="button"
                    onClick={() => onViewSale(sale)}
                    aria-label={`Open ${sale.saleNumber}`}
                    title={t("pos.view")}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border transition hover:opacity-80"
                    style={{ borderColor: "var(--border)", color: "var(--text-3)", background: "var(--surface-2)" }}
                  >
                    <Eye size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePrint(sale)}
                    aria-label={`Print ${sale.saleNumber}`}
                    title="Print"
                    className="flex h-7 w-7 items-center justify-center rounded-lg border transition hover:opacity-80"
                    style={{ borderColor: "var(--border)", color: "var(--text-3)", background: "var(--surface-2)" }}
                  >
                    <Printer size={12} />
                  </button>
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
