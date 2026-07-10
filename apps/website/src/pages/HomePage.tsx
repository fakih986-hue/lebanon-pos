import { useEffect, useState } from "react"
import { Link } from "react-router"
import { Reveal } from "../components/Reveal"
import { TiltCard } from "../components/TiltCard"
import { Magnetic } from "../components/Magnetic"
import { Counter } from "../components/Counter"
import { BrowserFrame } from "../components/BrowserFrame"
import { Parallax } from "../components/Parallax"
import { introPending } from "../components/IntroLoader"

/** Headline words rise one-by-one, waiting for the intro curtain if it's playing. */
function KineticLine({ words, gradient = false, baseDelay = 0 }: { words: string; gradient?: boolean; baseDelay?: number }) {
  const [go, setGo] = useState(false)

  useEffect(() => {
    if (!introPending()) { const t = setTimeout(() => setGo(true), 120); return () => clearTimeout(t) }
    const onDone = () => setGo(true)
    window.addEventListener("titan:intro-done", onDone)
    const fallback = setTimeout(() => setGo(true), 2600)
    return () => { window.removeEventListener("titan:intro-done", onDone); clearTimeout(fallback) }
  }, [])

  // Gradient lines must animate as one element â€” child transforms/filters break
  // background-clip:text â€” so they get a wipe reveal instead of per-word rise.
  if (gradient) {
    return (
      <span
        className={`text-gradient ${go ? "line-wipe" : "word-hidden"}`}
        style={{ animationDelay: `${baseDelay}ms` }}
      >
        {words}
      </span>
    )
  }

  return (
    <span>
      {words.split(" ").map((w, i) => (
        <span key={i} className={go ? "word-rise" : "word-hidden"} style={{ animationDelay: `${baseDelay + i * 90}ms` }}>
          {w}{"Â "}
        </span>
      ))}
    </span>
  )
}

const MARQUEE = [
  "Offline-first", "Multi-tenant", "Real-time sync", "Lebanon-first", "Inventory & batches",
  "Payroll engine", "Attendance & leave", "Delivery & drivers", "Audit trails", "Cloud + local hybrid",
]

const PRODUCTS = [
  {
    to: "/pos",
    tag: "Retail & Hospitality",
    name: "Titan POS",
    desc: "Offline-first checkout, inventory, customers, debts, suppliers, and delivery â€” one desktop platform that keeps selling even when the internet doesn't.",
    accent: "from-[#e9c766] to-[#a4841f]",
    glow: "group-hover:shadow-[0_0_60px_-15px_rgba(212,175,55,0.4)]",
  },
  {
    to: "/payroll",
    tag: "People Operations",
    name: "Titan HR & Payroll",
    desc: "A Lebanon-first HR operating system â€” employees, attendance, leave, documents, assets, and an accountant-verified payroll engine in one workspace.",
    accent: "from-[#d4af37] to-[#7a5c10]",
    glow: "group-hover:shadow-[0_0_60px_-15px_rgba(212,175,55,0.35)]",
  },
]

const PILLARS = [
  { n: "01", title: "Built to actually run", desc: "Not demos, not prototypes â€” platforms that are live today, handling real sales and real payroll runs for real businesses." },
  { n: "02", title: "Offline is a feature", desc: "Titan POS runs entirely on the local machine. Bad connection? Sales keep ringing up. The cloud catches up the moment you're back." },
  { n: "03", title: "Trust over shortcuts", desc: "Payroll, money, and inventory don't get to be 'roughly right'. Every number traces to a rule, every change to a person." },
]

export default function HomePage() {
  return (
    <div>
      {/* â”€â”€ Hero â”€â”€ */}
      <section className="relative min-h-[92svh] md:min-h-[100svh] flex items-start md:items-center px-4 sm:px-8 pt-24 sm:pt-28 pb-12 sm:pb-16 overflow-hidden">
        <div className="max-w-6xl mx-auto w-full">
          <Reveal>
            <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#e9c766] bg-[#d4af37]/[0.08] border border-[#d4af37]/25 rounded-full px-4 py-2 mb-8">
              <span className="w-1.5 h-1.5 rounded-full bg-[#d4af37] animate-pulse" />
              Software for real businesses
            </span>
          </Reveal>

          <h1 className="font-display font-bold tracking-tight leading-[1.08] sm:leading-[0.95] text-[clamp(2.18rem,11vw,4.5rem)] md:text-[clamp(3.8rem,9vw,7rem)] max-w-[11ch] sm:max-w-none">
            <KineticLine words="Run the business." />
            <br />
            <KineticLine words="We run the software." gradient baseDelay={320} />
          </h1>

          <Reveal delay={220}>
            <p className="mt-6 sm:mt-8 text-base sm:text-xl text-slate-400 max-w-xl leading-relaxed">
              Titan builds the systems that keep a business moving â€” point of sale on the floor,
              HR & payroll behind the scenes. Commercial-grade, Lebanon-first.
            </p>
          </Reveal>

          <Reveal delay={340}>
            <div className="mt-9 sm:mt-12 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
              <Magnetic>
                <Link to="/pos" className="inline-flex w-full sm:w-auto justify-center items-center gap-2 px-7 py-3.5 shine rounded-2xl bg-gradient-to-r from-[#e9c766] to-[#a4841f] text-[#0b0803] font-semibold text-sm shadow-[0_8px_40px_-8px_rgba(212,175,55,0.45)] hover:shadow-[0_8px_50px_-6px_rgba(212,175,55,0.6)] transition-shadow">
                  Explore Titan POS
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
                </Link>
              </Magnetic>
              <Magnetic>
                <Link to="/payroll" className="inline-flex w-full sm:w-auto justify-center items-center gap-2 px-7 py-3.5 rounded-2xl glass glass-hover font-semibold text-sm">
                  Explore Titan HR
                </Link>
              </Magnetic>
            </div>
          </Reveal>

        </div>

        {/* Scroll hint */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 hidden sm:flex flex-col items-center gap-2 text-slate-600">
          <span className="text-[10px] uppercase tracking-[0.3em]">Scroll</span>
          <div className="w-[1px] h-10 bg-gradient-to-b from-slate-600 to-transparent" />
        </div>
      </section>

      {/* â”€â”€ Marquee â”€â”€ */}
      <section className="py-6 border-y border-white/[0.05] overflow-hidden">
        <div className="marquee-track">
          {[...MARQUEE, ...MARQUEE].map((item, i) => (
            <span key={i} className="flex items-center gap-6 px-6 text-sm font-medium text-slate-500 whitespace-nowrap font-display tracking-wide">
              {item}
              <span className="w-1 h-1 rounded-full bg-[#d4af37]/50" />
            </span>
          ))}
        </div>
      </section>

      {/* â”€â”€ Products â”€â”€ */}
      <section className="px-5 sm:px-8 py-28">
        <div className="max-w-6xl mx-auto">
          <Reveal>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 mb-3">The suite</p>
            <h2 className="font-display text-3xl sm:text-5xl font-bold tracking-tight mb-16">Two platforms.<br /><span className="text-gradient">One standard.</span></h2>
          </Reveal>

          <div className="grid sm:grid-cols-2 gap-6">
            {PRODUCTS.map((p, i) => (
              <Reveal key={p.to} delay={i * 120}>
                <TiltCard>
                  <Link to={p.to} className={`group block glass rounded-2xl p-9 h-full transition-shadow duration-500 ${p.glow}`}>
                    <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${p.accent} mb-6 group-hover:scale-110 transition-transform duration-300`} />
                    <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500 mb-3">{p.tag}</p>
                    <h3 className="font-display text-2xl sm:text-3xl font-bold mb-4">{p.name}</h3>
                    <p className="text-sm text-slate-400 leading-relaxed">{p.desc}</p>
                    <span className="inline-flex items-center gap-1.5 mt-7 text-sm font-semibold text-[#e9c766] group-hover:gap-3 transition-all duration-300">
                      Enter platform
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
                    </span>
                  </Link>
                </TiltCard>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* â”€â”€ Showcase: real screens, editorial layout â”€â”€ */}
      <section className="px-5 sm:px-8 pb-28">
        <div className="max-w-6xl mx-auto space-y-24">
          {[
            {
              eyebrow: "Titan POS",
              title: "The register, live.",
              desc: "Barcode-first checkout with dual-currency totals (USD + LBP), favorites, quick sale, and a cart that keeps moving even when the internet doesn't. This is the screen a cashier lives in all day â€” built to be fast at hour nine, not just minute one.",
              img: "/screenshots/pos-checkout.png",
              url: "pos.titan-suite.net",
              to: "/pos",
              cta: "Explore Titan POS",
              flip: false,
            },
            {
              eyebrow: "Titan HR",
              title: "Payroll with receipts.",
              desc: "Every payroll run traces back to verified statutory rules â€” and when a rule isn't legally verified yet, the platform says so out loud instead of guessing. 90 runs on record, every number explainable.",
              img: "/screenshots/hr-payroll.png",
              url: "titan-hr â€” payroll",
              to: "/payroll",
              cta: "Explore Titan HR",
              flip: true,
            },
          ].map((block) => (
            <Reveal key={block.title}>
              <div className={`grid lg:grid-cols-2 gap-10 lg:gap-14 items-center ${block.flip ? "lg:[direction:rtl]" : ""}`}>
                <div className="lg:[direction:ltr]">
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#e9c766] mb-4">{block.eyebrow}</p>
                  <h3 className="font-display text-3xl sm:text-4xl font-bold tracking-tight mb-5">{block.title}</h3>
                  <p className="text-slate-400 leading-relaxed text-[15px] mb-8">{block.desc}</p>
                  <Magnetic>
                    <Link to={block.to} className="inline-flex items-center gap-2 text-sm font-semibold text-[#e9c766] hover:gap-3.5 transition-all">
                      {block.cta}
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
                    </Link>
                  </Magnetic>
                </div>
                <div className="relative lg:[direction:ltr]">
                  <div className="absolute -inset-6 bg-[#d4af37]/[0.08] blur-3xl rounded-full pointer-events-none" />
                  <Parallax speed={block.flip ? -0.05 : 0.05}>
                    <TiltCard max={6}>
                      <BrowserFrame url={block.url}>
                        <img src={block.img} alt={block.title} className="w-full block" draggable={false} />
                      </BrowserFrame>
                    </TiltCard>
                  </Parallax>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* â”€â”€ Stats â”€â”€ */}
      <section className="px-5 sm:px-8 pb-28">
        <div className="max-w-6xl mx-auto">
          <div className="shimmer-border">
            <div className="shimmer-inner grid grid-cols-2 lg:grid-cols-4 gap-px overflow-hidden rounded-[calc(1.25rem-1px)]">
              {[
                { to: 2, suffix: "", label: "Platforms live" },
                { to: 7, suffix: "", label: "Apps in the POS suite" },
                { to: 3, suffix: "", label: "Stores running today" },
                { to: 100, suffix: "%", label: "Offline-capable checkout" },
              ].map((s) => (
                <div key={s.label} className="p-8 sm:p-10 text-center bg-white/[0.015]">
                  <p className="font-display text-4xl sm:text-5xl font-bold text-gradient">
                    <Counter to={s.to} suffix={s.suffix} />
                  </p>
                  <p className="mt-3 text-xs uppercase tracking-[0.2em] text-slate-500">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* â”€â”€ Pillars â”€â”€ */}
      <section className="px-5 sm:px-8 pb-28">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-3 gap-6">
            {PILLARS.map((p, i) => (
              <Reveal key={p.n} delay={i * 120}>
                <div className="relative glass glass-hover shine rounded-2xl p-8 h-full overflow-hidden">
                  <span className="font-display absolute -top-4 -right-2 text-[5.5rem] sm:text-[7rem] font-bold text-outline leading-none">{p.n}</span>
                  <h3 className="font-display text-xl font-bold mb-3 relative">{p.title}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed relative max-w-[90%]">{p.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* â”€â”€ CTA â”€â”€ */}
      <section className="px-5 sm:px-8 pb-10">
        <div className="max-w-4xl mx-auto text-center">
          <Reveal>
            <h2 className="font-display text-3xl sm:text-5xl font-bold tracking-tight">
              See it <span className="text-gradient">running live.</span>
            </h2>
            <p className="mt-5 text-slate-400 max-w-lg mx-auto">Get a walkthrough of Titan POS or Titan HR against a real setup â€” not a slide deck.</p>
            <Magnetic className="mt-10">
              <Link to="/contact" className="inline-flex items-center gap-2 px-8 py-4 shine rounded-2xl bg-gradient-to-r from-[#e9c766] to-[#a4841f] text-[#0b0803] font-semibold shadow-[0_8px_40px_-8px_rgba(212,175,55,0.45)]">
                Request a demo
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
              </Link>
            </Magnetic>
          </Reveal>
        </div>
      </section>
    </div>
  )
}
