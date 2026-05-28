import type { LucideIcon } from "lucide-react"
import { cn } from "../../lib/utils"

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
  className?: string
}

export default function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center", className)}
      style={{ borderColor: "var(--border)" }}
    >
      <div
        className="flex h-12 w-12 items-center justify-center rounded-xl mb-4"
        style={{ background: "var(--surface-2)" }}
      >
        <Icon size={22} style={{ color: "var(--text-3)" }} />
      </div>
      <p className="text-[14px] font-semibold" style={{ color: "var(--text-2)" }}>{title}</p>
      {description && <p className="mt-1 text-[13px]" style={{ color: "var(--text-3)" }}>{description}</p>}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="btn btn-primary btn-md mt-5"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
