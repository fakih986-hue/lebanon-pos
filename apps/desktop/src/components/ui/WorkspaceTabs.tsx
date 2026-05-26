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

export default function WorkspaceTabs<T extends string>({
  tabs,
  active,
  onChange,
  className,
}: WorkspaceTabsProps<T>) {
  return (
    <section
      className={cn(
        "rounded-lg border border-zinc-200 bg-white p-2 shadow-sm",
        className
      )}
    >
      <div className="flex gap-2 overflow-x-auto [scrollbar-width:thin]">
        {tabs.map((tab) => {
          const selected = active === tab.label

          return (
            <button
              key={tab.label}
              type="button"
              onClick={() => onChange(tab.label)}
              className={cn(
                "flex h-11 min-w-32 items-center justify-center gap-2 rounded-lg px-4 text-sm font-bold transition",
                selected
                  ? "bg-zinc-950 text-white"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"
              )}
            >
              {tab.icon}
              {tab.label}
              {typeof tab.count === "number" ? (
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs",
                    selected
                      ? "bg-white/15 text-white"
                      : "bg-zinc-100 text-zinc-600"
                  )}
                >
                  {tab.count}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
    </section>
  )
}
