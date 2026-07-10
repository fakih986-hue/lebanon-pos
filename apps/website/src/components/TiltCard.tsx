import { useRef, type ReactNode } from "react"

/**
 * Perspective tilt-on-hover card with a cursor-tracking glare. Pure transforms —
 * no re-renders while moving.
 */
export function TiltCard({ children, className = "", max = 9 }: { children: ReactNode; className?: string; max?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const glareRef = useRef<HTMLDivElement>(null)

  function onMove(e: React.MouseEvent) {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const px = (e.clientX - rect.left) / rect.width
    const py = (e.clientY - rect.top) / rect.height
    const rx = (0.5 - py) * max
    const ry = (px - 0.5) * max
    el.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg) translateZ(0)`
    el.style.transition = "transform 0.08s linear"
    if (glareRef.current) {
      glareRef.current.style.background = `radial-gradient(400px circle at ${px * 100}% ${py * 100}%, rgba(212,175,55,0.12), transparent 60%)`
      glareRef.current.style.opacity = "1"
    }
  }

  function onLeave() {
    const el = ref.current
    if (!el) return
    el.style.transform = "perspective(900px) rotateX(0deg) rotateY(0deg)"
    el.style.transition = "transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)"
    if (glareRef.current) glareRef.current.style.opacity = "0"
  }

  return (
    <div ref={ref} onMouseMove={onMove} onMouseLeave={onLeave} className={`relative will-change-transform ${className}`}>
      <div ref={glareRef} className="absolute inset-0 rounded-2xl pointer-events-none transition-opacity duration-300 opacity-0 z-10" />
      {children}
    </div>
  )
}
