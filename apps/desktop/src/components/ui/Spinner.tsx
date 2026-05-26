import { cn } from "../../lib/utils"

interface SpinnerProps {
  size?: number
  label?: string
  className?: string
}

export default function Spinner({ size = 10, label, className }: SpinnerProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3", className)}>
      <div
        className="animate-spin rounded-full border-4 border-emerald-200 border-t-emerald-600"
        style={{ width: size * 4, height: size * 4 }}
      />
      {label ? <p className="text-sm font-medium text-emerald-700">{label}</p> : null}
    </div>
  )
}
