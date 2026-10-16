import { CheckCircle2, Eraser, History, MessageCircle, Printer } from "lucide-react"
import { Link } from "react-router"
import { useI18n } from "@lebanonpos/shared"
import { formatCurrency } from "../lib/currency"

interface Props {
  sales: { number: string; total: number; totalLbp: number; customerName?: string; items?: any[] }[]
  onNewSale: () => void
  onPrintReceipt: (sale: any) => void
  onWhatsApp?: (sale: any) => void
}

export default function LastSaleBanner({ sales, onNewSale, onPrintReceipt, onWhatsApp }: Props) {
  const { t } = useI18n()
  if (sales.length === 0) return null

  // Midnight Gold v2: ONE latest-sale row (neutral, 14px, 44px secondary actions
  // with accessible names), replaced after each sale. Older receipts live in
  // Sales history. The gold primary stays the Pay button.
  return (
    <div className="flex flex-col gap-1" aria-label={t("pos.v2.recent_receipts")}>
      {sales.slice(0, 1).map((sale, i) => (
        <div key={sale.number} className="flex items-center gap-1 rounded-lg border px-2 sm:gap-2 sm:px-3"
          style={{ minHeight: 48, background: "var(--surface)", borderColor: "var(--border)" }}>
          <CheckCircle2 size={16} className="hidden shrink-0 sm:block" style={{ color: i === 0 ? "var(--v2-ok)" : "var(--text-3)" }} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-[14px]" style={{ color: "var(--text)" }}>
            <span className="num font-semibold" style={{ whiteSpace: "nowrap" }}>{sale.number}</span>
            <span className="num ms-2 hidden min-[400px]:inline" style={{ color: "var(--text-2)" }}>{formatCurrency(sale.total)}</span>
            {sale.customerName && <span className="ms-2" style={{ color: "var(--text-2)" }}>{sale.customerName}</span>}
          </span>
          {i === 0 && (
            <button type="button" onClick={onNewSale} className="mg2-btn mg2-btn-ghost" style={{ minHeight: 44 }} aria-label={t("pos.new_sale")} title={t("pos.new_sale")}>
              <Eraser size={14} /><span className="hidden sm:inline">{t("pos.new_sale")}</span>
            </button>
          )}
          <button type="button" onClick={() => onPrintReceipt(sale)} className="mg2-btn mg2-btn-ghost" style={{ minHeight: 44, width: 44, padding: 0 }}
            aria-label={`${t("pos.print")} ${sale.number}`} title={t("pos.print")}>
            <Printer size={16} />
          </button>
          {i === 0 && onWhatsApp && (
            <button type="button" onClick={() => onWhatsApp(sale)} className="mg2-btn mg2-btn-ghost" style={{ minHeight: 44, width: 44, padding: 0 }}
              aria-label={`WhatsApp ${sale.number}`} title="WhatsApp">
              <MessageCircle size={16} />
            </button>
          )}
          <Link to="/sales" className="mg2-btn mg2-btn-ghost" style={{ minHeight: 44, width: 44, padding: 0 }}
            aria-label={t("pos.v2.sales_history")} title={t("pos.v2.sales_history")}>
            <History size={16} />
          </Link>
        </div>
      ))}
    </div>
  )
}
