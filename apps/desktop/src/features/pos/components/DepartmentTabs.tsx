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
      className="flex gap-2 overflow-x-auto p-2 [scrollbar-width:none] md:min-h-0 md:flex-col md:overflow-y-auto md:overflow-x-hidden"
      style={{ background: "var(--surface-2)" }}
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
            className={`flex min-h-[58px] min-w-[112px] touch-manipulation shrink-0 items-center gap-2 rounded-lg border px-3 text-left transition-all md:w-full ${
              active ? "shadow-sm" : "hover:bg-white"
            }`}
            style={active ? {
              background: "#ffffff",
              borderColor: "var(--brand)",
              color: "var(--brand-text)",
            } : {
              background: "var(--surface)",
              borderColor: "var(--border)",
              color: "var(--text-2)",
            }}
          >
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
              style={active
                ? { background: "var(--brand)", color: "white" }
                : { background: "var(--surface-3)", color: "var(--text-3)" }
              }
            >
              <Icon size={18} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-black leading-tight">
                {dept.label}
              </span>
              <span className="mt-1 block text-[11px] font-bold leading-none opacity-70">
                {formatNumber(dept.productCount)} items
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
})

export default DepartmentTabs
