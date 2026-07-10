import { useRef, type ReactNode } from "react"

/** Element leans toward the cursor while hovered, springs back on leave. */
export function Magnetic({ children, strength = 0.35, className = "" }: { children: ReactNode; strength?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)

  function onMove(e: React.MouseEvent) {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = (e.clientX - rect.left - rect.width / 2) * strength
    const y = (e.clientY - rect.top - rect.height / 2) * strength
    el.style.transform = `translate(${x}px, ${y}px)`
    el.style.transition = "transform 0.1s linear"
  }

  function onLeave() {
    const el = ref.current
    if (!el) return
    el.style.transform = "translate(0, 0)"
    el.style.transition = "transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)"
  }

  return (
    <div ref={ref} onMouseMove={onMove} onMouseLeave={onLeave} className={`inline-block ${className}`}>
      {children}
    </div>
  )
}
