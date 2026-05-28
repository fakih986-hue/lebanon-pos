import type { ReactNode } from "react"
import { cn } from "../../lib/utils"

export type WorkspaceTabItem<T extends string> = {
  label: T
  icon?: ReactNode
  count?: number
}

type WorkspaceTabsProps<T extends string> = {
  tabs: WorkspaceTabItem<T>[]
  active: T
  onChange: (tab: T) => void
  className?: string
}

export default function WorkspaceTabs<T extends string>({ tabs, active, onChange, className }: WorkspaceTabsProps<T>) {
  return (
    <div
      className={cn("flex gap-1 rounded-xl p-1 [scrollbar-width:none] overflow-x-auto", className)}
      style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
    >
      {tabs.map((tab) => {
        const selected = active === tab.label
        return (
          <button
            key={tab.label}
            type="button"
            onClick={() => onChange(tab.label)}
            className={cn(
              "flex h-9 items-center justify-center gap-2 rounded-lg px-4 text-[13px] font-semibold transition whitespace-nowrap",
              selected
                ? "text-white shadow-sm"
                : "text-[var(--text-2)] hover:text-[var(--text)]"
            )}
            style={selected ? { background: "var(--text)", boxShadow: "var(--shadow-sm)" } : undefined}
          >
            {tab.icon}
            {tab.label}
            {typeof tab.count === "number" && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none"
                style={selected
                  ? { background: "rgba(255,255,255,0.15)", color: "white" }
                  : { background: "var(--surface-3)", color: "var(--text-3)" }
                }
              >
                {tab.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
