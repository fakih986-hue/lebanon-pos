import { CheckCircle2, Eraser, MessageCircle, Printer, ReceiptText } from "lucide-react"
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
  onWhatsApp?: () => void
}

export default function LastSaleBanner({ sale, onNewSale, onPrintReceipt, onWhatsApp }: Props) {
  const { t } = useI18n()
  if (!sale) return null

  return (
    <div
      className="flex flex-col gap-3 rounded-xl border p-3 xl:flex-row xl:items-center xl:justify-between"
      style={{
        background: "var(--brand-soft)",
        borderColor: "var(--brand-border)",
      }}
    >
      <div className="flex items-center gap-3">
        <CheckCircle2 size={20} style={{ color: "var(--brand)" }} />
        <div>
          <p className="text-[14px] font-bold" style={{ color: "var(--text)" }}>
            {t("pos.last_sale.completed", { number: sale.number })}
          </p>
          <p className="text-[12px]" style={{ color: "var(--text-2)" }}>
            {formatCurrency(sale.total)} / {formatLbpCurrency(sale.totalLbp)}
            {sale.customerName ? ` · ${sale.customerName}` : ""}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onNewSale}
          className="btn btn-primary h-9 gap-2"
        >
          <Eraser size={14} />
          {t("pos.new_sale")}
        </button>
        <button
          type="button"
          onClick={onPrintReceipt}
          className="btn h-9 gap-2"
          style={{
            background: "var(--surface)",
            borderColor: "var(--brand-border)",
            color: "var(--brand-text)",
            border: "1px solid",
          }}
        >
          <Printer size={14} />
          {t("pos.receipt")}
        </button>
        {onWhatsApp && (
          <button
            type="button"
            onClick={onWhatsApp}
            className="btn h-9 gap-2"
            style={{ background: "var(--surface)", borderColor: "var(--border)", color: "#25D366", border: "1px solid" }}
          >
            <MessageCircle size={14} />
            WhatsApp
          </button>
        )}
        <Link
          to="/sales?tab=receipts"
          className="btn h-9 gap-2"
          style={{
            background: "var(--surface)",
            borderColor: "var(--border)",
            color: "var(--text-2)",
            border: "1px solid",
          }}
        >
          <ReceiptText size={14} />
          {t("pos.history")}
        </Link>
      </div>
    </div>
  )
}
