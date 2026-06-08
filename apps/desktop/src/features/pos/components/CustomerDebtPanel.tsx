import { useEffect, useState } from "react"
import { ChevronDown, MessageCircle, Users } from "lucide-react"
import { useNavigate } from "react-router"
import { getCustomerLedger, subscribeLedger, type CustomerLedger } from "../services/customer.service"
import { formatCurrency, formatLbpCurrency, usdToLbp } from "../lib/currency"
import { getSettings } from "../services/settings.service"
import { openWhatsApp, debtReminderMessage } from "../lib/whatsapp"

export default function CustomerDebtPanel({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const [customers, setCustomers] = useState<CustomerLedger[]>(getCustomerLedger())
  const navigate = useNavigate()
  const rate = getSettings().usdToLbpRate
  const overdue = customers.filter((c) => c.overdue).sort((a, b) => b.balance - a.balance).slice(0, 5)

  useEffect(() => subscribeLedger(() => setCustomers(getCustomerLedger())), [])

  if (overdue.length === 0) return null

  function handleWhatsApp(c: CustomerLedger) {
    openWhatsApp(c.mobile, debtReminderMessage({
      storeName: getSettings().storeName,
      customerName: c.name,
      balance: c.balance,
      oldestDays: c.oldestUnpaidDays,
    }))
  }

  return (
    <div>
      <button type="button" onClick={onToggle} className="flex w-full items-center justify-between px-4 py-2.5 text-[12px] font-bold hover:opacity-80"
        style={{ color: "var(--text-2)", background: expanded ? "var(--surface-2)" : "transparent" }}>
        <span className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: "var(--rose)" }} />
          <Users size={14} style={{ color: "#EF4444" }} />
          Overdue
          <span className="text-[10px] text-rose-400">{overdue.length}</span>
        </span>
        <ChevronDown size={14} className={`transition ${expanded ? "rotate-180" : ""}`} style={{ color: "var(--text-3)" }} />
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-1">
          {overdue.map((c) => (
            <div key={c.id} className="flex items-center gap-2 py-1">
              <span className="flex-1 min-w-0 text-[11px] font-semibold truncate" style={{ color: "var(--text)" }}>{c.name}</span>
              <span style={{ color: "var(--rose)" }} className="text-[10px] font-bold tabular-nums shrink-0">
                {formatCurrency(c.balance)}
              </span>
              <span style={{ color: "var(--rose)" }} className="text-[10px] tabular-nums shrink-0 opacity-60">{c.oldestUnpaidDays}d</span>
              <button onClick={() => handleWhatsApp(c)} className="flex h-6 w-6 items-center justify-center rounded-md transition hover:opacity-80" title="WhatsApp"
                style={{ color: "#25D366" }}>
                <MessageCircle size={12} />
              </button>
            </div>
          ))}
          <div className="flex items-center justify-between pt-1">
            <button
              onClick={() => overdue.forEach((c, i) => setTimeout(() => handleWhatsApp(c), i * 600))}
              className="text-[10px] font-bold hover:underline"
              style={{ color: "#25D366" }}
            >
              Remind All ({overdue.length})
            </button>
            <button onClick={() => navigate("/customers")}
              className="text-[10px] font-bold hover:underline" style={{ color: "var(--text-3)" }}>
              View All →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
