import { memo } from "react"
import type { LucideIcon } from "lucide-react"

import { formatNumber } from "../lib/currency"

interface Department {
  name: string
  label: string
  Icon: LucideIcon
  theme: {
    active: string
    inactive: string
    iconActive: string
    iconInactive: string
    countActive: string
    countInactive: string
  }
  productCount: number
}

interface Props {
  departments: Department[]
  selected: string
  onSelect: (name: string) => void
}

const DepartmentTabs = memo(function DepartmentTabs({
  departments,
  selected,
  onSelect,
}: Props) {
  return (
    <div role="tablist" className="flex gap-2 overflow-x-auto rounded-lg border border-zinc-200 bg-white p-2 shadow-sm">
      {departments.map((department) => {
        const active = selected === department.name
        const Icon = department.Icon
        const theme = department.theme

        return (
          <button
            key={department.name}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(department.name)}
            className={`flex h-12 touch-manipulation shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-bold transition focus:outline-none focus:ring-4 focus:ring-emerald-100 ${
              active ? theme.active : theme.inactive
            }`}
          >
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                active ? theme.iconActive : theme.iconInactive
              }`}
            >
              <Icon size={18} />
            </span>
            <span>{department.label}</span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs ${
                active ? theme.countActive : theme.countInactive
              }`}
            >
              {formatNumber(department.productCount)}
            </span>
          </button>
        )
      })}
    </div>
  )
})

export default DepartmentTabs
