import { Clock3, Eye, Printer, ReceiptText } from "lucide-react"

import { formatCurrency, formatNumber } from "../lib/currency"
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
  return (
    <div className="rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-200 p-3 sm:p-4">
        <div>
          <h3 className="font-bold text-zinc-950">
            {formatNumber(filteredSales.length)} receipts
          </h3>
          <p className="text-sm text-zinc-500">
            Tap one to preview or reprint.
          </p>
        </div>
        <ReceiptText size={22} className="text-zinc-400" />
      </div>

      <div className="max-h-[70vh] space-y-3 overflow-y-auto p-3 sm:p-4">
        {filteredSales.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center">
            <ReceiptText size={40} className="mx-auto text-zinc-300" />
            <p className="mt-3 font-bold text-zinc-950">
              No receipts found
            </p>
            <p className="mt-1 text-sm text-zinc-500">
              Completed sales will appear here.
            </p>
          </div>
        ) : null}

        {filteredSales.map((sale) => {
          const Icon = paymentIcons[sale.paymentMethod]
          const active = selectedSaleId === sale.id
          const quantity = getSaleQuantity(sale)
          const refundedTotal = getSaleRefundTotal(
            refunds,
            sale.id
          )

          return (
            <article
              key={sale.id}
              className={`rounded-lg border p-3 transition ${
                active
                  ? "border-emerald-300 bg-emerald-50"
                  : "border-zinc-200 bg-white hover:border-zinc-300"
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectSale(sale.id)}
                className="block w-full text-left"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-bold text-zinc-950">
                      {sale.saleNumber}
                    </p>
                    <p className="mt-1 flex items-center gap-1 text-xs text-zinc-500">
                      <Clock3 size={13} />
                      {formatDate(sale.createdAt)}
                    </p>
                  </div>
                  <p className="shrink-0 text-lg font-bold text-zinc-950">
                    {formatCurrency(sale.total)}
                  </p>
                </div>

                <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
                  <span className="inline-flex items-center gap-1 rounded-lg bg-zinc-100 px-2 py-1 text-zinc-700">
                    <Icon size={13} />
                    {sale.paymentMethod}
                  </span>
                  <span className="rounded-lg bg-zinc-100 px-2 py-1 text-zinc-700">
                    {formatNumber(quantity)} items
                  </span>
                  <span className="rounded-lg bg-zinc-100 px-2 py-1 text-zinc-700">
                    {sale.customerName ?? "Walk-in"}
                  </span>
                  {refundedTotal > 0 ? (
                    <span className="rounded-lg bg-rose-100 px-2 py-1 text-rose-700">
                      Returned {formatCurrency(refundedTotal)}
                    </span>
                  ) : null}
                </div>

                <p className="mt-3 line-clamp-2 text-sm text-zinc-500">
                  {sale.items.map((item) => item.name).join(", ")}
                </p>
              </button>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => onViewSale(sale)}
                  className="flex h-10 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-3 text-sm font-bold text-white transition hover:bg-zinc-800"
                >
                  <Eye size={15} />
                  View
                </button>
                <button
                  type="button"
                  onClick={() => handlePrint(sale)}
                  className="flex h-10 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-bold text-zinc-700 transition hover:bg-zinc-50"
                >
                  <Printer size={15} />
                  Print
                </button>
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
