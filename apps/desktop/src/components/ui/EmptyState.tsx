import type { LucideIcon } from "lucide-react"
import { cn } from "../../lib/utils"

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
  className?: string
}

export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-300 px-6 py-12 text-center",
        className
      )}
    >
      <Icon size={40} className="mb-3 text-zinc-300" />
      <p className="text-sm font-semibold text-zinc-600">{title}</p>
      {description ? (
        <p className="mt-1 text-sm text-zinc-400">{description}</p>
      ) : null}
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-4 rounded-lg bg-zinc-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-zinc-800"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  )
}
