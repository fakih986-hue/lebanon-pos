import { CheckCircle2, Eraser, Printer, ReceiptText } from "lucide-react"
import { Link } from "react-router"

import { useI18n } from "@lebanonpos/shared"
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
  const { t } = useI18n()
  if (!sale) {
    return null
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-950 shadow-sm xl:flex-row xl:items-center xl:justify-between">
      <div className="flex items-center gap-3">
        <CheckCircle2 size={22} />
        <div>
          <p className="font-bold">{t("pos.last_sale.completed", { number: sale.number })}</p>
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
          className="flex h-10 items-center gap-2 rounded-lg bg-emerald-600 px-3 text-sm font-bold text-white transition hover:bg-emerald-500"
        >
          <Eraser size={16} />
          {t("pos.new_sale")}
        </button>
        <button
          type="button"
          onClick={onPrintReceipt}
          className="flex h-10 items-center gap-2 rounded-lg bg-emerald-600 px-3 text-sm font-bold text-white transition hover:bg-emerald-500"
        >
          <Printer size={16} />
          {t("pos.receipt")}
        </button>
        <Link
          to="/sales?tab=receipts"
          className="flex h-10 items-center gap-2 rounded-lg bg-white px-3 text-sm font-bold text-emerald-800 ring-1 ring-emerald-200 transition hover:bg-emerald-100"
        >
          <ReceiptText size={16} />
          {t("pos.history")}
        </Link>
      </div>
    </div>
  )
}
