import { Eye, ReceiptText } from "lucide-react"

import { formatCurrency, formatNumber } from "../lib/currency"
import {
  formatDate,
  getSaleQuantity,
  paymentIcons,
} from "../lib/salesHelpers"
import type { Sale } from "../services/sales.service"

export default function InsightsPanel({
  filteredSales,
  paymentMix,
  onViewSale,
}: {
  filteredSales: Sale[]
  paymentMix: Record<string, number>
  onViewSale: (sale: Sale) => void
}) {
  return (
    <section className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="rounded-lg border border-zinc-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-left text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">
                <th className="border-b border-zinc-200 px-4 py-3">
                  Receipt
                </th>
                <th className="border-b border-zinc-200 px-4 py-3">
                  Payment
                </th>
                <th className="border-b border-zinc-200 px-4 py-3">
                  Customer
                </th>
                <th className="border-b border-zinc-200 px-4 py-3 text-right">
                  Items
                </th>
                <th className="border-b border-zinc-200 px-4 py-3 text-right">
                  Total
                </th>
                <th className="border-b border-zinc-200 px-4 py-3">
                  Time
                </th>
                <th className="border-b border-zinc-200 px-4 py-3 text-right">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredSales.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-12 text-center text-sm font-medium text-zinc-500"
                  >
                    No sales recorded yet
                  </td>
                </tr>
              ) : null}

              {filteredSales.map((sale) => {
                const Icon = paymentIcons[sale.paymentMethod]
                const quantity = getSaleQuantity(sale)

                return (
                  <tr key={sale.id} className="hover:bg-zinc-50">
                    <td className="border-b border-zinc-100 px-4 py-4">
                      <span className="inline-flex items-center gap-2 font-bold text-zinc-950">
                        <ReceiptText size={15} />
                        {sale.saleNumber}
                      </span>
                    </td>
                    <td className="border-b border-zinc-100 px-4 py-4">
                      <span className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-2 py-1 text-xs font-bold text-zinc-700">
                        <Icon size={14} />
                        {sale.paymentMethod}
                      </span>
                    </td>
                    <td className="border-b border-zinc-100 px-4 py-4 text-zinc-600">
                      {sale.customerName ?? "-"}
                    </td>
                    <td className="border-b border-zinc-100 px-4 py-4 text-right font-semibold text-zinc-800">
                      {formatNumber(quantity)}
                    </td>
                    <td className="border-b border-zinc-100 px-4 py-4 text-right font-bold text-zinc-950">
                      {formatCurrency(sale.total)}
                    </td>
                    <td className="border-b border-zinc-100 px-4 py-4 text-zinc-500">
                      {formatDate(sale.createdAt)}
                    </td>
                    <td className="border-b border-zinc-100 px-4 py-4 text-right">
                      <button
                        type="button"
                        onClick={() => onViewSale(sale)}
                        className="inline-flex h-9 items-center gap-2 rounded-lg bg-zinc-950 px-3 text-xs font-bold text-white transition hover:bg-zinc-800"
                      >
                        <Eye size={14} />
                        Receipt
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <aside className="space-y-4">
        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-bold text-zinc-950">Payment mix</h2>
          <div className="mt-3 space-y-2">
            {Object.entries(paymentMix).map(([method, amount]) => (
              <div
                key={method}
                className="flex items-center justify-between rounded-lg bg-zinc-50 p-3"
              >
                <span className="font-semibold text-zinc-700">
                  {method}
                </span>
                <span className="font-bold text-zinc-950">
                  {formatCurrency(amount)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </section>
  )
}
