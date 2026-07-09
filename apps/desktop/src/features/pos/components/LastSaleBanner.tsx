import { CheckCircle2, Eraser, MessageCircle, Printer } from "lucide-react"
import { useI18n } from "@lebanonpos/shared"
import { formatCurrency } from "../lib/currency"

interface Sale {
  number: string
  total: number
  totalLbp: number
  customerName?: string
  items?: any[]
}

interface Props {
  sales: Sale[]
  onNewSale: () => void
  onPrintReceipt: (sale: Sale) => void
  onWhatsApp?: (sale: Sale) => void
}

export default function LastSaleBanner({ sales, onNewSale, onPrintReceipt, onWhatsApp }: Props) {
  const { t } = useI18n()
  if (sales.length === 0) return null

  return (
    <div className="flex flex-col gap-1">
      {sales.map((sale, i) => (
        <div
          key={sale.number}
          className="flex items-center gap-2 rounded-lg border px-3 py-1.5"
          style={{
            background: i === 0 ? "var(--brand-soft)" : "var(--surface-2)",
            borderColor: i === 0 ? "var(--brand-border)" : "var(--border)",
          }}
        >
          <CheckCircle2 size={13} className="shrink-0" style={{ color: i === 0 ? "var(--brand)" : "var(--text-3)" }} />
          <span className="text-[11px] font-semibold min-w-0 flex-1" style={{ color: "var(--text)" }}>
            {sale.number}
            <span className="ml-1.5 font-bold tabular-nums" style={{ color: i === 0 ? "var(--brand-text)" : "var(--text-2)" }}>
              {formatCurrency(sale.total)}
            </span>
            {sale.customerName && (
              <span className="ml-1 text-[10px] opacity-50" style={{ color: "var(--text-3)" }}>{sale.customerName}</span>
            )}
          </span>
          {i === 0 && (
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={onNewSale}
                className="flex h-6 items-center gap-1 rounded-md px-2 text-[10px] font-bold text-white transition hover:opacity-90"
                style={{ background: "var(--brand)" }}
              >
                <Eraser size={10} />
                {t("pos.new_sale")}
              </button>
              <button
                type="button"
                onClick={() => onPrintReceipt(sale)}
                className="flex h-6 items-center gap-1 rounded-md border px-2 text-[10px] font-bold transition hover:opacity-80"
                style={{ borderColor: "var(--brand-border)", color: "var(--brand-text)", background: "white" }}
              >
                <Printer size={10} />
              </button>
              {onWhatsApp && (
                <button
                  type="button"
                  onClick={() => onWhatsApp(sale)}
                  className="flex h-6 items-center gap-1 rounded-md border px-2 text-[10px] font-bold transition hover:opacity-80"
                  style={{ borderColor: "var(--border)", color: "#25D366", background: "white" }}
                >
                  <MessageCircle size={10} />
                </button>
              )}
            </div>
          )}
          {i > 0 && (
            <button
              type="button"
              onClick={() => onPrintReceipt(sale)}
              className="flex h-6 w-6 items-center justify-center rounded-md text-[10px] font-bold transition hover:opacity-80"
              style={{ color: "var(--text-3)" }}
              title={t("pos.print")}
            >
              <Printer size={10} />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
