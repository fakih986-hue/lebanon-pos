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
      className={cn("flex gap-1 overflow-x-auto rounded-lg p-1 [scrollbar-width:none]", className)}
      style={{ background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "var(--shadow-xs)" }}
    >
      {tabs.map((tab) => {
        const value = tab.value ?? (tab.label as T)
        const selected = active === value
        return (
          <button
            key={value}
            type="button"
            onClick={() => onChange(value)}
            className={cn(
              "flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 text-[13px] font-black transition",
              selected
                ? "text-white"
                : "text-[var(--text-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
            )}
            style={selected ? { background: "var(--brand)", boxShadow: "0 10px 18px rgba(4,120,87,0.18)" } : undefined}
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
