import type { ReactNode } from "react"
import { cn } from "../../lib/utils"

export type WorkspaceTabItem<T extends string> = {
  value?: T
  label: string
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
      className={cn("flex overflow-x-auto [scrollbar-width:none]", className)}
      style={{ borderBottom: "1px solid var(--border)" }}
    >
      {tabs.map((tab) => {
        const value = tab.value ?? (tab.label as T)
        const selected = active === value
        return (
          <button
            key={value}
            type="button"
            onClick={() => onChange(value)}
            aria-pressed={selected}
            aria-label={`${tab.label}${typeof tab.count === "number" ? ` (${tab.count})` : ""}`}
            className={cn(
              "flex h-10 items-center gap-2 whitespace-nowrap px-4 text-[13px] font-bold transition relative",
              selected
                ? "text-[var(--brand)]"
                : "text-[var(--text-2)] hover:text-[var(--text)]"
            )}
            style={selected ? {
              boxShadow: "inset 0 -2px 0 var(--brand)",
            } : undefined}
          >
            {tab.icon}
            {tab.label}
            {typeof tab.count === "number" && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none"
                style={selected
                  ? { background: "var(--brand-soft)", color: "var(--brand-text)" }
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
