import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { BrowserFrame } from "./BrowserFrame"

export type DemoSlide = {
  src?: string
  label: string
}

/**
 * 3D coverflow of real product screens, each dressed in browser chrome. The
 * active slide opens fullscreen in a lightbox; side slides click to navigate.
 * Slides without `src` render as labeled glass frames.
 */
export function DemoCarousel({ slides, intervalMs = 4500 }: { slides: DemoSlide[]; intervalMs?: number }) {
  const [index, setIndex] = useState(0)
  // Lightbox navigates through the slides that have real screenshots
  const srcSlides = slides.filter((s): s is DemoSlide & { src: string } => !!s.src)
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)
  const lightbox = lightboxIdx !== null ? srcSlides[lightboxIdx] : null

  const lightboxPrev = () => setLightboxIdx((i) => (i === null ? i : (i - 1 + srcSlides.length) % srcSlides.length))
  const lightboxNext = () => setLightboxIdx((i) => (i === null ? i : (i + 1) % srcSlides.length))

  useEffect(() => {
    if (lightbox) return
    const id = setInterval(() => setIndex((i) => (i + 1) % slides.length), intervalMs)
    return () => clearInterval(id)
  }, [slides.length, intervalMs, lightbox])

  useEffect(() => {
    if (!lightbox) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxIdx(null)
      if (e.key === "ArrowLeft") lightboxPrev()
      if (e.key === "ArrowRight") lightboxNext()
    }
    window.addEventListener("keydown", onKey)
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = ""
    }
  }, [lightbox])

  return (
    <div>
      <div className="relative h-[320px] sm:h-[460px]" style={{ perspective: "1500px" }}>
        {slides.map((slide, i) => {
          let offset = i - index
          if (offset > slides.length / 2) offset -= slides.length
          if (offset < -slides.length / 2) offset += slides.length
          const abs = Math.abs(offset)
          const visible = abs <= 2
          const active = abs === 0

          return (
            <div
              key={i}
              onClick={() => (active && slide.src ? setLightboxIdx(srcSlides.findIndex((s) => s.src === slide.src)) : setIndex(i))}
              className="absolute inset-x-0 mx-auto w-[86%] sm:w-[74%] h-full cursor-pointer group/slide"
              style={{
                transform: `translateX(${offset * 32}%) translateZ(${-abs * 190}px) rotateY(${offset * -15}deg)`,
                opacity: visible ? (active ? 1 : 0.4) : 0,
                zIndex: 10 - abs,
                pointerEvents: visible ? "auto" : "none",
                transition: "transform 0.75s cubic-bezier(0.16,1,0.3,1), opacity 0.75s ease",
                transformStyle: "preserve-3d",
              }}
            >
              <div className={`relative w-full h-full transition-shadow duration-500 rounded-xl ${active ? "shadow-[0_30px_100px_-20px_rgba(212,175,55,0.3)]" : ""}`}>
                <BrowserFrame className="h-full flex flex-col">
                  {slide.src ? (
                    <div className="relative flex-1 overflow-hidden">
                      <img
                        src={slide.src}
                        alt={slide.label}
                        className="absolute inset-0 w-full h-full object-cover object-top"
                        draggable={false}
                      />
                      {active && (
                        <div className="absolute inset-0 flex items-end justify-end p-3 opacity-0 group-hover/slide:opacity-100 transition-opacity duration-300">
                          <span className="text-[11px] font-semibold text-white bg-black/70 backdrop-blur rounded-lg px-3 py-1.5 border border-white/10 inline-flex items-center gap-1.5">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" /></svg>
                            Expand
                          </span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-slate-900/80 to-[#050403]">
                      <div className="w-16 h-16 rounded-2xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center">
                        <svg className="w-7 h-7 text-[#e9c766]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 10.5l4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
                        </svg>
                      </div>
                      <p className="text-sm text-slate-400 font-medium font-display tracking-wide">{slide.label}</p>
                    </div>
                  )}
                </BrowserFrame>
              </div>
            </div>
          )
        })}
      </div>

      {/* Label + dots */}
      <div className="flex flex-col items-center gap-3 mt-6">
        <p className="font-display text-sm font-semibold text-[#e9c766] tracking-wide">{slides[index].label}</p>
        <div className="flex items-center gap-1.5">
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => setIndex(i)}
              aria-label={`Show slide ${i + 1}`}
              className={`h-1.5 rounded-full transition-all duration-300 ${i === index ? "w-8 bg-gradient-to-r from-[#e9c766] to-[#a4841f]" : "w-1.5 bg-white/20 hover:bg-white/40"}`}
            />
          ))}
        </div>
      </div>

      {/* Lightbox — portaled to document.body so its z-index isn't trapped
         inside the page-enter wrapper's transform-induced stacking context */}
      {lightbox && createPortal(
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 backdrop-blur-md p-4 sm:p-10"
          style={{ animation: "pageIn 0.25s ease both" }}
          onClick={() => setLightboxIdx(null)}
        >
          <button
            aria-label="Close"
            className="absolute top-5 right-5 w-11 h-11 rounded-xl glass flex items-center justify-center text-slate-300 hover:text-white transition-colors z-10"
            onClick={() => setLightboxIdx(null)}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>

          {/* Prev / Next */}
          {srcSlides.length > 1 && (
            <>
              <button
                aria-label="Previous screenshot"
                className="absolute left-3 sm:left-6 top-1/2 -translate-y-1/2 w-12 h-12 rounded-xl glass flex items-center justify-center text-slate-300 hover:text-[#e9c766] hover:border-[#d4af37]/40 transition-colors z-10"
                onClick={(e) => { e.stopPropagation(); lightboxPrev() }}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
              </button>
              <button
                aria-label="Next screenshot"
                className="absolute right-3 sm:right-6 top-1/2 -translate-y-1/2 w-12 h-12 rounded-xl glass flex items-center justify-center text-slate-300 hover:text-[#e9c766] hover:border-[#d4af37]/40 transition-colors z-10"
                onClick={(e) => { e.stopPropagation(); lightboxNext() }}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
              </button>
            </>
          )}
          <div className="max-w-6xl w-full" onClick={(e) => e.stopPropagation()}>
            <BrowserFrame>
              <img src={lightbox.src} alt={lightbox.label} className="w-full max-h-[82vh] object-contain bg-[#050403]" />
            </BrowserFrame>
            <p className="text-center text-sm text-slate-400 mt-4 font-display tracking-wide">
              {lightbox.label}
              {srcSlides.length > 1 && (
                <span className="text-slate-600 ml-3">{(lightboxIdx ?? 0) + 1} / {srcSlides.length}</span>
              )}
            </p>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
