import { cn } from "../../lib/utils"

interface SpinnerProps {
  size?: number
  label?: string
  className?: string
}

export default function Spinner({ size = 10, label, className }: SpinnerProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3", className)} role="status" aria-label={label ?? "Loading"}>
      <div
        className="animate-spin rounded-full border-4"
        style={{ width: size * 4, height: size * 4, borderColor: "var(--brand-soft)", borderTopColor: "var(--brand)" }}
      />
      {label ? <p className="text-sm font-medium" style={{ color: "var(--brand-text)" }}>{label}</p> : null}
    </div>
  )
}
