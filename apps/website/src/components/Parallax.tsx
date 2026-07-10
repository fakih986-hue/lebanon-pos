import { useEffect, useRef, type ReactNode } from "react"

/**
 * Scroll-linked drift: children translate vertically at a fraction of scroll
 * speed relative to the viewport center, giving sections real depth. Positive
 * speed drifts with the scroll, negative against it. GPU transform only.
 */
export function Parallax({ children, speed = 0.08, className = "" }: { children: ReactNode; speed?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

    let raf = 0
    const update = () => {
      const rect = el.getBoundingClientRect()
      const offset = (rect.top + rect.height / 2 - window.innerHeight / 2) * -speed
      el.style.transform = `translate3d(0, ${offset.toFixed(1)}px, 0)`
    }
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(update)
    }
    update()
    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll)
    return () => {
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
      cancelAnimationFrame(raf)
    }
  }, [speed])

  return (
    <div ref={ref} className={`will-change-transform ${className}`}>
      {children}
    </div>
  )
}
