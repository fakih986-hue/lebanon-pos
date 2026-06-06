import { AlertTriangle, Boxes, Layers3, PackageCheck } from "lucide-react"
import { useI18n } from "@lebanonpos/shared"
import { formatCurrency, formatNumber } from "../lib/currency"

type Props = {
  totalProducts: number
  totalStock: number
  totalValue: number
  urgentReorderCount: number
}

const cards = [
  {
    key: "products",
    icon: PackageCheck,
    gradient: "linear-gradient(135deg,#10b981,#047857)",
    glow: "rgba(16,185,129,0.35)",
  },
  {
    key: "stock",
    icon: Boxes,
    gradient: "linear-gradient(135deg,#818cf8,#4338ca)",
    glow: "rgba(99,102,241,0.35)",
  },
  {
    key: "value",
    icon: Layers3,
    gradient: "linear-gradient(135deg,#fbbf24,#d97706)",
    glow: "rgba(251,191,36,0.35)",
  },
  {
    key: "reorder",
    icon: AlertTriangle,
    gradient: "linear-gradient(135deg,#fb923c,#dc2626)",
    glow: "rgba(249,115,22,0.35)",
  },
]

export default function KpiCards({ totalProducts, totalStock, totalValue, urgentReorderCount }: Props) {
  const { t } = useI18n()

  const values = [
    { label: t("pos.kpi.active_products"), value: formatNumber(totalProducts) },
    { label: t("pos.kpi.units_in_stock"),  value: formatNumber(totalStock)    },
    { label: t("pos.kpi.stock_value"),     value: formatCurrency(totalValue)  },
    {
      label: t("pos.kpi.reorder_needed"),
      value: formatNumber(urgentReorderCount),
      alert: urgentReorderCount > 0,
    },
  ]

  return (
    <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {cards.map((card, i) => {
        const Icon = card.icon
        const item = values[i]
        return (
          <div
            key={card.key}
            className="flex items-center gap-3 rounded-2xl border p-4 transition-shadow"
            style={{
              background: "var(--surface)",
              borderColor: "var(--border)",
              boxShadow: "var(--shadow-xs)",
            }}
          >
            <span
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
              style={{
                background: card.gradient,
                boxShadow: `0 4px 12px ${card.glow}`,
              }}
            >
              <Icon size={20} strokeWidth={1.9} color="white" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-3)" }}>
                {item.label}
              </p>
              <p
                className="text-[22px] font-black tabular-nums leading-tight"
                style={{ color: item.alert ? "var(--rose)" : "var(--text)" }}
              >
                {item.value}
              </p>
            </div>
          </div>
        )
      })}
    </section>
  )
}
