import { useEffect, useRef } from "react"

/**
 * A soft gold light that follows the cursor across the whole page — barely
 * perceptible on its own, but makes the dark surface feel lit rather than flat.
 * Desktop-only; disabled for touch and reduced-motion.
 */
export function Spotlight() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    if (window.matchMedia("(pointer: coarse)").matches) return

    let raf = 0
    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        el.style.background = `radial-gradient(650px circle at ${e.clientX}px ${e.clientY}px, rgba(212,175,55,0.055), transparent 65%)`
      })
    }
    window.addEventListener("mousemove", onMove)
    return () => {
      window.removeEventListener("mousemove", onMove)
      cancelAnimationFrame(raf)
    }
  }, [])

  return <div ref={ref} className="fixed inset-0 pointer-events-none z-[5]" aria-hidden="true" />
}
