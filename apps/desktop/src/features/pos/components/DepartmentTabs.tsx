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
      className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
            className={`flex h-9 shrink-0 touch-manipulation items-center gap-1.5 rounded-full border px-3 text-[12px] font-bold transition-all ${
              active ? "shadow-sm" : "hover:opacity-80"
            }`}
            style={active ? {
              background: "var(--brand)",
              borderColor: "var(--brand)",
              color: "#ffffff",
            } : {
              background: "var(--surface)",
              borderColor: "var(--border)",
              color: "var(--text-2)",
            }}
          >
            <Icon size={14} />
            <span className="whitespace-nowrap">{dept.label}</span>
            <span
              className="rounded-full px-1.5 py-0.5 text-[10px] font-black tabular-nums leading-none"
              style={active
                ? { background: "rgba(255,255,255,0.25)", color: "#fff" }
                : { background: "var(--surface-3)", color: "var(--text-3)" }
              }
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
