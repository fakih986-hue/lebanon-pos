import { Reveal } from "../components/Reveal"
import { Magnetic } from "../components/Magnetic"

export default function ContactPage() {
  return (
    <div className="pt-40 pb-16">
      <div className="max-w-3xl mx-auto px-5 sm:px-8 text-center">
        <Reveal>
          <h1 className="font-display font-bold tracking-tight leading-[0.95] text-[clamp(2.6rem,8vw,6rem)]">
            Let's <span className="text-gradient">talk.</span>
          </h1>
        </Reveal>
        <Reveal delay={100}>
          <p className="text-lg sm:text-xl text-slate-400 mt-7 max-w-xl mx-auto leading-relaxed">
            Want a walkthrough of Titan POS or Titan HR? Reach out and we'll set up a live demo against a
            real setup.
          </p>
        </Reveal>

        <Reveal delay={180} className="mt-16">
          <div className="shimmer-border max-w-lg mx-auto">
            <div className="shimmer-inner p-10 sm:p-12">
              <div className="w-14 h-14 rounded-2xl bg-[#d4af37]/10 border border-[#d4af37]/25 flex items-center justify-center mx-auto mb-6">
                <svg className="w-6 h-6 text-[#e9c766]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" /></svg>
              </div>
              <p className="text-xs uppercase tracking-[0.25em] text-slate-500 font-semibold mb-2">Email</p>
              <Magnetic>
                <a href="mailto:hello@titan-suite.net" className="font-display text-xl sm:text-2xl font-bold hover:text-[#e9c766] transition-colors">
                  hello@titan-suite.net
                </a>
              </Magnetic>
              <p className="text-xs text-slate-600 mt-8">Phone / WhatsApp contact coming soon.</p>
            </div>
          </div>
        </Reveal>
      </div>
    </div>
  )
}
