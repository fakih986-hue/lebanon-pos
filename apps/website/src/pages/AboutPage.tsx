import { Reveal } from "../components/Reveal"
import { TiltCard } from "../components/TiltCard"
import { Seo } from "../components/Seo"

export default function AboutPage() {
  return (
    <div className="pt-40 pb-16">
      <Seo
        title="The founder — Titan"
        description="Behind Titan: Mohammad Fakih, founder, with over 10 years in IT infrastructure and information security — and why that background shapes how Titan handles money, data, and trust."
        path="/about"
      />
      <div className="max-w-4xl mx-auto px-5 sm:px-8">
        <Reveal>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 mb-4">The founder</p>
          <h1 className="font-display font-bold tracking-tight leading-[1.1] sm:leading-[0.95] text-[clamp(2.6rem,7vw,5rem)]">
            Behind <span className="text-gradient">Titan.</span>
          </h1>
        </Reveal>

        <Reveal delay={140} className="mt-16">
          <TiltCard max={4}>
            <div className="shimmer-border">
              <div className="shimmer-inner p-9 sm:p-12">
                <div className="flex flex-col sm:flex-row gap-8 sm:items-start">
                  <div className="relative shrink-0">
                    <div className="w-36 h-36 rounded-3xl overflow-hidden ring-2 ring-[#d4af37]/40 relative">
                      <img
                        src="/brand/founder.jpg"
                        alt="Mohammad Fakih, founder of Titan"
                        className="w-full h-full object-cover"
                        draggable={false}
                      />
                    </div>
                    <div className="absolute inset-0 rounded-3xl bg-[#d4af37]/25 blur-2xl -z-10" />
                  </div>
                  <div>
                    <h2 className="font-display text-3xl font-bold">Mohammad Fakih</h2>
                    <p className="text-[#e9c766] text-sm font-semibold mt-1.5 tracking-wide">Founder, Titan</p>
                    <p className="text-slate-400 leading-relaxed mt-5 text-[15px]">
                      Mohammad has spent over 10 years in IT infrastructure and information security —
                      currently Regional IT & Security Technical Manager at Basmeh &amp; Zeitooneh for Relief
                      and Development, one of Lebanon's larger relief and development organizations, where
                      he's kept mission-critical systems running across multiple sites for nearly a decade.
                    </p>
                    <p className="text-slate-400 leading-relaxed mt-4 text-[15px]">
                      He holds a Master's in Computer Science and a Bachelor's in Information Technology
                      from the Lebanese International University, alongside certifications including CISSP,
                      MCITP, and CCNA — with hands-on experience across network administration, cloud
                      infrastructure, cybersecurity, and systems architecture in both private and public
                      sector deployments.
                    </p>
                    <p className="text-slate-400 leading-relaxed mt-4 text-[15px]">
                      Titan grew out of that same instinct: build systems that hold up under real
                      operational pressure — not just in a demo.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </TiltCard>
        </Reveal>

      </div>
    </div>
  )
}
