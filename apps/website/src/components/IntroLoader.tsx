import { useEffect, useState } from "react"

const FLAG = "titan-intro-played"

/** True while the cinematic intro will still run this session. */
export function introPending(): boolean {
  try { return !sessionStorage.getItem(FLAG) } catch { return false }
}

/**
 * First-load cinematic: black screen, the Titan shield pulls into focus with a
 * gold light sweep and the wordmark letter-spaces open, then the whole curtain
 * lifts to reveal the site. Plays once per session; skipped for reduced motion.
 * Dispatches "titan:intro-done" so the hero can time its own entrance.
 */
export function IntroLoader() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (reduced || !introPending()) {
      window.dispatchEvent(new Event("titan:intro-done"))
      return
    }
    try { sessionStorage.setItem(FLAG, "1") } catch { /* private mode */ }
    setShow(true)
    document.body.style.overflow = "hidden"

    let doneFired = false
    const fireDone = () => { if (!doneFired) { doneFired = true; window.dispatchEvent(new Event("titan:intro-done")) } }
    const dismiss = () => {
      fireDone()
      setShow(false)
      document.body.style.overflow = ""
    }

    // Tightened timeline (was 1500/2400ms): hero can start at 1000ms, curtain
    // clears at ~1650ms — premium but noticeably less blocking.
    const doneAt = setTimeout(fireDone, 1000)
    const gone = setTimeout(dismiss, 1650)

    // Let the user skip straight through — any tap, click, or key.
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === "Enter" || e.key === " ") dismiss() }
    window.addEventListener("pointerdown", dismiss)
    window.addEventListener("keydown", onKey)

    return () => {
      clearTimeout(doneAt); clearTimeout(gone)
      window.removeEventListener("pointerdown", dismiss)
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = ""
    }
  }, [])

  if (!show) return null

  return (
    <div
      className="fixed inset-0 z-[300] bg-[#050403] flex flex-col items-center justify-center cursor-pointer"
      style={{ animation: "introLift 0.7s cubic-bezier(0.7, 0, 0.3, 1) 1.1s both" }}
      aria-hidden="true"
    >
      <div className="relative" style={{ animation: "introLogo 0.9s cubic-bezier(0.16, 1, 0.3, 1) both" }}>
        <img src="/brand/titan-mark.webp" alt="" width={160} height={160} className="w-32 h-32 sm:w-40 sm:h-40" decoding="async" draggable={false} />
        {/* travelling light sweep across the mark */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div
            className="absolute top-0 h-full w-1/2 bg-gradient-to-r from-transparent via-white/25 to-transparent"
            style={{ animation: "introSweep 0.8s ease-in-out 0.45s both", mixBlendMode: "overlay" }}
          />
        </div>
        <div className="absolute inset-0 bg-[#d4af37]/25 blur-3xl -z-10" />
      </div>
      <p
        className="font-display font-bold text-lg text-[#e9c766] mt-6 pl-[0.55em]"
        style={{ animation: "introLetters 0.9s cubic-bezier(0.16, 1, 0.3, 1) 0.3s both" }}
      >
        TITAN
      </p>
      <p className="absolute bottom-8 text-[11px] uppercase tracking-[0.25em] text-slate-600">Tap to skip</p>
    </div>
  )
}
