import { Reveal } from "../components/Reveal"
import { TiltCard } from "../components/TiltCard"

const VALUES = [
  { n: "01", title: "Built to run, not to demo", desc: "Every Titan product is judged by whether it survives a real business day — not by how it looks in a pitch." },
  { n: "02", title: "Lebanon-first, not Lebanon-only", desc: "We start with the market we understand best, and build the architecture to expand beyond it from day one." },
  { n: "03", title: "Trust over shortcuts", desc: "Payroll, money, and inventory don't get to be 'roughly right.' If we're not sure, we say so instead of guessing." },
]

export default function CompanyPage() {
  return (
    <div className="pt-40 pb-16">
      <div className="max-w-5xl mx-auto px-5 sm:px-8">
        <Reveal>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 mb-4">The company</p>
          <h1 className="font-display font-bold tracking-tight leading-[0.95] text-[clamp(2.6rem,7vw,5.5rem)]">
            About <span className="text-gradient">Titan.</span>
          </h1>
        </Reveal>
        <Reveal delay={120}>
          <p className="text-lg sm:text-xl text-slate-400 mt-7 max-w-2xl leading-relaxed">
            Titan builds commercial-grade software for businesses that can't afford to be down — point of
            sale for the shop floor, and HR & payroll for the people behind it.
          </p>
        </Reveal>

        <Reveal delay={200} className="mt-20">
          <div className="shimmer-border">
            <div className="shimmer-inner p-10 sm:p-14">
              <h2 className="font-display text-2xl font-bold mb-5">Why Titan exists</h2>
              <p className="text-slate-400 leading-relaxed text-[15px]">
                Most small and mid-sized businesses in Lebanon are stuck choosing between software that's too
                simple to run their real operations, or enterprise systems built for markets that don't reflect
                theirs — different currency handling, different labor rules, spotty internet, and workflows that
                don't map to Western retail or HR software. Titan is built the other way around: start from what
                a real market and mini-market, or a real HR team, actually needs day to day, and make the software
                fit that — not the other way around.
              </p>
            </div>
          </div>
        </Reveal>

        <div className="grid sm:grid-cols-3 gap-5 mt-20">
          {VALUES.map((v, i) => (
            <Reveal key={v.n} delay={i * 120}>
              <TiltCard className="h-full">
                <div className="relative glass glass-hover shine rounded-2xl p-8 h-full overflow-hidden">
                  <span className="font-display absolute -top-5 -right-2 text-[6.5rem] font-bold text-outline leading-none">{v.n}</span>
                  <h3 className="font-display font-bold mb-3 relative">{v.title}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed relative">{v.desc}</p>
                </div>
              </TiltCard>
            </Reveal>
          ))}
        </div>
      </div>
    </div>
  )
}
