import { Reveal } from "./Reveal"
import { TiltCard } from "./TiltCard"
import { Parallax } from "./Parallax"
import { BrowserFrame } from "./BrowserFrame"

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
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#e9c766] mb-4">{wf.eyebrow}</p>
          <h3 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight mb-5">{wf.title}</h3>
          <p className="text-slate-400 leading-relaxed text-[15px] mb-6">{wf.desc}</p>
          {wf.points && (
            <ul className="space-y-2.5">
              {wf.points.map((p) => (
                <li key={p} className="flex items-start gap-3 text-[15px] text-slate-300">
                  <svg aria-hidden="true" className="w-5 h-5 text-[#e9c766] shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="relative lg:[direction:ltr]">
          <div className="absolute -inset-6 bg-[#d4af37]/[0.08] blur-3xl rounded-full pointer-events-none" />
          <Parallax speed={flip ? -0.05 : 0.05}>
            <TiltCard max={6}>
              <BrowserFrame url={wf.frameUrl}>
                <img
                  src={wf.img}
                  alt={wf.imgAlt}
                  width={wf.w}
                  height={wf.h}
                  className="w-full block h-auto"
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                />
              </BrowserFrame>
            </TiltCard>
          </Parallax>
        </div>
      </div>
    </Reveal>
  )
}
