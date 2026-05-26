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
        className="animate-spin rounded-full border-4 border-zinc-200 border-t-zinc-950"
        style={{ width: size * 4, height: size * 4 }}
      />
      {label ? <p className="text-sm font-medium text-zinc-500">{label}</p> : null}
    </div>
  )
}
