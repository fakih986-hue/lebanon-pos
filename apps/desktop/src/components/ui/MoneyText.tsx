import {
  formatLbpRounded,
  formatUsdCurrency,
  usdToLbp,
} from "../../features/pos/lib/currency"

type MoneySize = "body" | "stat" | "display" | "total"
type MoneyTone = "default" | "secondary" | "profit" | "debt"

const sizeClass: Record<MoneySize, string> = {
  body: "",
  stat: "money-stat",
  display: "money-display",
  total: "money-total",
}

const toneClass: Record<MoneyTone, string> = {
  default: "money",
  secondary: "money-secondary",
  profit: "money money-profit",
  debt: "money money-debt",
}

interface MoneyTextProps {
  /** Amount in USD (canonical currency). */
  amount: number
  size?: MoneySize
  tone?: MoneyTone
  /** Render the LBP equivalent underneath (requires exchangeRate). */
  exchangeRate?: number
  /** Re-triggers the tick animation whenever this key changes. */
  tickKey?: string | number
  className?: string
}

/**
 * The single money renderer for the app (Midnight Gold design system).
 * Tabular numerals, never wraps, optional dual-currency USD-over-LBP stack.
 */
export default function MoneyText({
  amount,
  size = "body",
  tone = "default",
  exchangeRate,
  tickKey,
  className = "",
}: MoneyTextProps) {
  const usd = (
    <span
      key={tickKey}
      className={[toneClass[tone], sizeClass[size], tickKey !== undefined ? "money-tick" : "", className]
        .filter(Boolean)
        .join(" ")}
    >
      {formatUsdCurrency(amount)}
    </span>
  )

  if (exchangeRate === undefined) return usd

  return (
    <span className="money-stack">
      {usd}
      <span className="money-secondary" style={{ fontSize: "0.55em" }}>
        {formatLbpRounded(usdToLbp(amount, exchangeRate))}
      </span>
    </span>
  )
}
