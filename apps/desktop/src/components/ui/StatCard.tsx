import type { ReactNode } from "react"

interface StatCardProps {
  label: string
  /** Pre-formatted value node — typically a <MoneyText size="stat" />. */
  value: ReactNode
  /** Signed percentage, e.g. +12.4 / -3.1. Omit to hide the delta chip. */
  deltaPct?: number
  /** Optional slot under the value (sparkline, caption). */
  footer?: ReactNode
  icon?: ReactNode
  onClick?: () => void
}

/** Dashboard stat card (Midnight Gold): muted label, big tabular value, delta chip. */
export default function StatCard({ label, value, deltaPct, footer, icon, onClick }: StatCardProps) {
  const delta =
    deltaPct === undefined ? null : (
      <span className={deltaPct >= 0 ? "chip chip-success" : "chip chip-danger"}>
        {deltaPct >= 0 ? "▲" : "▼"} {Math.abs(deltaPct).toFixed(1)}%
      </span>
    )

  return (
    <div
      className={`card${onClick ? " card-hover" : ""}`}
      style={{ padding: "var(--sp-16)", cursor: onClick ? "pointer" : undefined }}
      onClick={onClick}
      role={onClick ? "button" : undefined}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: "var(--fs-meta)", fontWeight: 600, color: "var(--text-3)" }}>
          {label}
        </span>
        {icon}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: "var(--sp-8)" }}>
        {value}
        {delta}
      </div>
      {footer ? <div style={{ marginTop: "var(--sp-8)" }}>{footer}</div> : null}
    </div>
  )
}
