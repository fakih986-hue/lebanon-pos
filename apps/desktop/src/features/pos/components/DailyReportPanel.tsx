import { useMemo } from "react"
import { ChevronDown, MessageCircle, WalletCards } from "lucide-react"
import { formatCurrency, formatLbpCurrency, usdToLbp } from "../lib/currency"
import { getSettings } from "../services/settings.service"
import { getSalesMetrics, getPaymentMix } from "../services/sales.service"
import { getExpenseTotals } from "../services/expense.service"
import { openWhatsAppShare } from "../lib/whatsapp"

export default function DailyReportPanel({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const previewRevenue = getSalesMetrics().todayNetRevenue
  const data = useMemo(() => {
    if (!expanded) return null
    const m = getSalesMetrics()
    const mix = getPaymentMix()
    const e = getExpenseTotals()
    return { m, mix, e }
  }, [expanded])

  const settings = getSettings()
  const rate = settings.usdToLbpRate

  function handleShare() {
    if (!data) return
    const msg = `Daily Report — ${settings.storeName}\n\nSales: $${data.m.todayNetRevenue.toFixed(2)}\nCash: $${data.mix.Cash.toFixed(2)}\nCard: $${data.mix.Card.toFixed(2)}\nWallet: $${data.mix.Wallet.toFixed(2)}\nDebt: $${data.mix.Debt.toFixed(2)}\nExpenses: $${data.e.today.toFixed(2)}\nProfit: $${data.m.todayProfit.toFixed(2)}`
    openWhatsAppShare(msg)
  }

  return (
    <div>
      <button type="button" onClick={onToggle} className="flex w-full items-center justify-between px-4 py-2.5 text-[12px] font-bold hover:opacity-80"
        style={{ color: "var(--text-2)", background: expanded ? "var(--surface-2)" : "transparent" }}>
        <span className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: "var(--amber)" }} />
          <WalletCards size={14} style={{ color: "var(--text-3)" }} />
          Daily Report
          <span className="text-[10px] opacity-50">${previewRevenue.toFixed(0)}</span>
        </span>
        <ChevronDown size={14} className={`transition ${expanded ? "rotate-180" : ""}`} style={{ color: "var(--text-3)" }} />
      </button>

      {expanded && data && (
        <div className="px-4 pb-3 space-y-1 text-[11px]">
          <div className="flex justify-between" style={{ color: "var(--text-2)" }}><span>Sales</span><span className="font-bold tabular-nums">{formatCurrency(data.m.todayNetRevenue)}</span></div>
          <div className="flex justify-between ml-4" style={{ color: "var(--text-3)" }}><span>Cash</span><span className="tabular-nums">{formatCurrency(data.mix.Cash)}</span></div>
          <div className="flex justify-between ml-4" style={{ color: "var(--text-3)" }}><span>Card</span><span className="tabular-nums">{formatCurrency(data.mix.Card)}</span></div>
          <div className="flex justify-between ml-4" style={{ color: "var(--text-3)" }}><span>Wallet</span><span className="tabular-nums">{formatCurrency(data.mix.Wallet)}</span></div>
          <div className="flex justify-between ml-4" style={{ color: "var(--text-3)" }}><span>Debt</span><span className="tabular-nums">{formatCurrency(data.mix.Debt)}</span></div>
          <div className="flex justify-between" style={{ color: "var(--rose)" }}><span>Expenses</span><span className="font-bold tabular-nums">{formatCurrency(data.e.today)}</span></div>
          <div className="border-t pt-1 flex justify-between text-[12px]" style={{ borderColor: "var(--border)" }}>
            <span style={{ color: "var(--text)" }}>Profit</span>
            <span className={`font-black tabular-nums ${data.m.todayProfit >= 0 ? "" : "text-[var(--rose)]"}`} style={{ color: data.m.todayProfit >= 0 ? "#22C55E" : "var(--rose)" }}>
              {formatCurrency(data.m.todayProfit)}
            </span>
          </div>
          <div className="text-right text-[10px]" style={{ color: "var(--text-3)" }}>
            {formatLbpCurrency(usdToLbp(data.m.todayProfit, rate))}
          </div>
          <button onClick={handleShare} className="flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11px] font-bold transition hover:opacity-80"
            style={{ border: "1px solid var(--border)", color: "#25D366" }}>
            <MessageCircle size={12} /> Share
          </button>
        </div>
      )}
    </div>
  )
}
