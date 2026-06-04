import { CheckCircle2, Eraser, MessageCircle, Printer } from "lucide-react"
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
      className="flex items-center gap-3 rounded-lg border px-3 py-2"
      style={{
        background: "var(--brand-soft)",
        borderColor: "var(--brand-border)",
      }}
    >
      <CheckCircle2 size={16} className="shrink-0" style={{ color: "var(--brand)" }} />
      <span className="text-[12px] font-semibold truncate" style={{ color: "var(--text)" }}>
        {t("pos.last_sale.completed", { number: sale.number })}
        <span className="ml-1.5 font-bold tabular-nums" style={{ color: "var(--brand-text)" }}>
          {formatCurrency(sale.total)}
        </span>
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={onNewSale}
          className="flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-bold text-white transition hover:opacity-90"
          style={{ background: "var(--brand)" }}
        >
          <Eraser size={12} />
          {t("pos.new_sale")}
        </button>
        <button
          type="button"
          onClick={onPrintReceipt}
          className="flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-bold transition hover:opacity-80"
          style={{ borderColor: "var(--brand-border)", color: "var(--brand-text)", background: "white" }}
        >
          <Printer size={12} />
        </button>
        {onWhatsApp && (
          <button
            type="button"
            onClick={onWhatsApp}
            className="flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-bold transition hover:opacity-80"
            style={{ borderColor: "var(--border)", color: "#25D366", background: "white" }}
          >
            <MessageCircle size={12} />
          </button>
        )}
      </div>
    </div>
  )
}
