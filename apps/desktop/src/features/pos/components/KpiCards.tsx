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
  { key: "products", icon: PackageCheck, bg: "var(--success-soft)", fg: "var(--success)" },
  { key: "stock",    icon: Boxes,        bg: "var(--info-soft)",    fg: "var(--info)"    },
  { key: "value",    icon: Layers3,      bg: "var(--brand-soft)",   fg: "var(--brand)"   },
  { key: "reorder",  icon: AlertTriangle,bg: "var(--danger-soft)",  fg: "var(--danger)"  },
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
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
              style={{ background: card.bg }}
            >
              <Icon size={19} strokeWidth={2} style={{ color: card.fg }} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-3)" }}>
                {item.label}
              </p>
              <p
                className="text-[22px] font-bold tabular-nums leading-tight"
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
