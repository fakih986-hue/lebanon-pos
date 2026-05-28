import { memo } from "react"
import type { LucideIcon } from "lucide-react"
import { formatNumber } from "../lib/currency"

interface Department {
  name: string
  label: string
  Icon: LucideIcon
  productCount: number
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
      className="flex gap-1.5 overflow-x-auto rounded-xl p-1.5 [scrollbar-width:none]"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
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
            className="flex h-10 touch-manipulation shrink-0 items-center gap-2 rounded-lg px-3 text-[13px] font-semibold transition-all"
            style={active ? {
              background: "var(--brand)",
              color: "#fff",
              boxShadow: "0 2px 8px rgba(16,185,129,0.3)",
            } : {
              background: "transparent",
              color: "var(--text-2)",
            }}
          >
            <Icon size={15} />
            <span>{dept.label}</span>
            <span
              className="rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none"
              style={active
                ? { background: "rgba(255,255,255,0.2)", color: "#fff" }
                : { background: "var(--surface-2)", color: "var(--text-3)" }
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
