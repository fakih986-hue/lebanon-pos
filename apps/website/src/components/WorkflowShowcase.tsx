import { Link } from "react-router"
import { Reveal } from "./Reveal"
import { TiltCard } from "./TiltCard"
import { Parallax } from "./Parallax"
import { BrowserFrame } from "./BrowserFrame"
import { Magnetic } from "./Magnetic"

export type Workflow = {
  eyebrow: string
  title: string
  desc: string
  points?: string[]
  img: string
  imgAlt: string
  /** Natural pixel dimensions — reserve the right aspect ratio, no layout shift. */
  w: number
  h: number
  frameUrl?: string
  /**
   * Optional zoom-crop window so the showcase shows the exact widget the copy
   * talks about instead of an unreadable full-screen minimap. `zoom` oversizes
   * the capture (1.5 = 150%), `pos` picks the region ("30% 12%"), `aspect` sets
   * the window shape ("4 / 3"). The full capture stays available in the
   * carousel/lightbox above.
   */
  crop?: { zoom: number; pos: string; aspect: string }
  /** Optional inline text CTA under the copy (used on the homepage showcases). */
  cta?: { label: string; to: string }
}

/** The screenshot itself — either a full capture or a zoom-crop window onto it. */
function Shot({ wf }: { wf: Workflow }) {
  if (!wf.crop) {
    return (
      <img
        src={wf.img}
        alt={wf.imgAlt}
        width={wf.w}
        height={wf.h}
        className="w-full block h-auto shot-warm"
        loading="lazy"
        decoding="async"
        draggable={false}
      />
    )
  }
  const { zoom, pos, aspect } = wf.crop
  const [px, py] = pos.split(" ").map((v) => parseFloat(v))
  return (
    <div className="relative overflow-hidden" style={{ aspectRatio: aspect }}>
      <img
        src={wf.img}
        alt={wf.imgAlt}
        className="absolute shot-warm max-w-none"
        style={{
          width: `${zoom * 100}%`,
          height: `${zoom * 100}%`,
          objectFit: "cover",
          objectPosition: pos,
          left: `${-(zoom - 1) * px}%`,
          top: `${-(zoom - 1) * py}%`,
        }}
        loading="lazy"
        decoding="async"
        draggable={false}
      />
    </div>
  )
}

/**
 * Alternating "copy ↔ screenshot" band that ties one real product screen to one
 * buyer workflow. Mirrors the homepage showcase styling for a consistent premium
 * feel. `flip` swaps which side the image sits on down the page.
 */
export function WorkflowShowcase({ wf, flip }: { wf: Workflow; flip: boolean }) {
  return (
    <Reveal>
      <div className={`grid lg:grid-cols-2 gap-10 lg:gap-14 items-center ${flip ? "lg:[direction:rtl]" : ""}`}>
        <div className="lg:[direction:ltr]">
          {/* Eyebrows stay quiet slate — gold is reserved for CTAs and key words */}
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 mb-4">{wf.eyebrow}</p>
          <h3 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight mb-5">{wf.title}</h3>
          <p className="text-slate-400 leading-relaxed text-[15px] mb-6">{wf.desc}</p>
          {wf.points && (
            <ul className="space-y-2.5">
              {wf.points.map((p) => (
                <li key={p} className="flex items-start gap-3 text-[15px] text-slate-300">
                  <svg aria-hidden="true" className="w-5 h-5 text-[#8f6a14] shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          )}
          {wf.cta && (
            <Magnetic>
              <Link to={wf.cta.to} className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-[#e9c766] hover:gap-3.5 transition-all">
                {wf.cta.label}
                <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
              </Link>
            </Magnetic>
          )}
        </div>
        <div className="relative lg:[direction:ltr]">
          <div className="absolute -inset-6 bg-[#d4af37]/[0.08] blur-3xl rounded-full pointer-events-none" />
          <Parallax speed={flip ? -0.05 : 0.05}>
            <TiltCard max={6}>
              <BrowserFrame url={wf.frameUrl}>
                <Shot wf={wf} />
              </BrowserFrame>
            </TiltCard>
          </Parallax>
        </div>
      </div>
    </Reveal>
  )
}
