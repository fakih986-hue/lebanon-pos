import { memo } from "react"
import type { LucideIcon } from "lucide-react"
import { formatNumber } from "../lib/currency"

interface Department {
  name: string
  label: string
  Icon: LucideIcon
  productCount: number
  stockCount?: number
}

interface Props {
  departments: Department[]
  selected: string
  onSelect: (name: string) => void
}

const DepartmentTabs = memo(function DepartmentTabs({ departments, selected, onSelect }: Props) {
  return (
    <div
      role="tablist"
      className="flex gap-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{ borderBottom: "1px solid var(--border)" }}
    >
      {departments.map((dept) => {
        const active = selected === dept.name
        const Icon = dept.Icon

        return (
          <button
            key={dept.name}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(dept.name)}
            className={`relative flex h-10 shrink-0 touch-manipulation items-center gap-2 px-4 text-[12px] font-semibold transition-all ${
              active ? "" : "hover:opacity-80"
            }`}
            style={{
              background: active ? "var(--surface-2)" : "transparent",
              borderBottom: active ? "2px solid var(--brand)" : "2px solid transparent",
              color: active ? "var(--text)" : "var(--text-3)",
            }}
          >
            <Icon size={14} />
            <span className="whitespace-nowrap">{dept.label}</span>
            <span
              className="rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums leading-none"
              style={{
                background: active ? "var(--brand-soft)" : "var(--surface-3)",
                color: active ? "var(--brand-text)" : "var(--text-3)",
              }}
            >
              {formatNumber(dept.productCount)}
            </span>
          </button>
        )
      })}
    </div>
  )
})

export default DepartmentTabs
