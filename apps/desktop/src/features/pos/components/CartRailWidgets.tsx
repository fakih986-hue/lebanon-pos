import { useState } from "react"
import CashDrawerPanel from "./CashDrawerPanel"
import DailyReportPanel from "./DailyReportPanel"
import CustomerDebtPanel from "./CustomerDebtPanel"
import ExpensePanel from "./ExpensePanel"

export default function CartRailWidgets() {
  const [expanded, setExpanded] = useState<string | null>(() => {
    try { return localStorage.getItem("lebanonpos.cart-widget-expanded") } catch { return null }
  })

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = prev === key ? null : key
      localStorage.setItem("lebanonpos.cart-widget-expanded", next ?? "")
      return next
    })
  }

  return (
    <div className="shrink-0 border-b" style={{ borderColor: "var(--border)" }}>
      <CashDrawerPanel expanded={expanded === "drawer"} onToggle={() => toggle("drawer")} />
      <DailyReportPanel expanded={expanded === "report"} onToggle={() => toggle("report")} />
      <ExpensePanel expanded={expanded === "expense"} onToggle={() => toggle("expense")} />
      <CustomerDebtPanel expanded={expanded === "debt"} onToggle={() => toggle("debt")} />
    </div>
  )
}
