import { CheckCircle2, Eraser, Printer, ReceiptText } from "lucide-react"
import { Link } from "react-router-dom"

import { formatCurrency, formatLbpCurrency } from "../lib/currency"

interface Sale {
  number: string
  total: number
  totalLbp: number
  customerName?: string
}

interface Props {
  sale: Sale | null
  onNewSale: () => void
  onPrintReceipt: () => void
}

export default function LastSaleBanner({
  sale,
  onNewSale,
  onPrintReceipt,
}: Props) {
  if (!sale) {
    return null
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-950 shadow-sm xl:flex-row xl:items-center xl:justify-between">
      <div className="flex items-center gap-3">
        <CheckCircle2 size={22} />
        <div>
          <p className="font-bold">Sale {sale.number} completed</p>
          <p className="text-sm text-emerald-800">
            {formatCurrency(sale.total)} / {formatLbpCurrency(sale.totalLbp)}
            {sale.customerName ? ` - ${sale.customerName}` : ""}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onNewSale}
          className="flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-bold transition hover:bg-emerald-100"
        >
          <Eraser size={16} />
          New Sale
        </button>
        <button
          type="button"
          onClick={onPrintReceipt}
          className="flex h-10 items-center gap-2 rounded-lg bg-emerald-600 px-3 text-sm font-bold text-white transition hover:bg-emerald-500"
        >
          <Printer size={16} />
          Receipt
        </button>
        <Link
          to="/sales?tab=receipts"
          className="flex h-10 items-center gap-2 rounded-lg bg-white px-3 text-sm font-bold text-emerald-800 ring-1 ring-emerald-200 transition hover:bg-emerald-100"
        >
          <ReceiptText size={16} />
          History
        </Link>
      </div>
    </div>
  )
}
