import type { ButtonHTMLAttributes, ReactNode } from "react"
import { cn } from "../../lib/utils"

const variants = {
  primary: "bg-zinc-950 text-white hover:bg-zinc-800 disabled:bg-zinc-300 disabled:text-zinc-500",
  secondary: "bg-white text-zinc-700 ring-1 ring-zinc-300 hover:bg-zinc-50 disabled:opacity-40",
  danger: "bg-rose-600 text-white hover:bg-rose-700 disabled:bg-rose-300",
  ghost: "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 disabled:opacity-40",
  emerald: "bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-300",
} as const

const sizes = {
  sm: "h-9 px-3 text-xs",
  md: "h-11 px-4 text-sm",
  lg: "h-12 px-5 text-sm",
  icon: "h-9 w-9",
} as const

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants
  size?: keyof typeof sizes
  children: ReactNode
}

export default function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-bold transition",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}
