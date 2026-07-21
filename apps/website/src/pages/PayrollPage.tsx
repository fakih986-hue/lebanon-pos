import { Link } from "react-router"
import { Reveal } from "../components/Reveal"
import { TiltCard } from "../components/TiltCard"
import { Magnetic } from "../components/Magnetic"
import { DemoCarousel } from "../components/DemoCarousel"
import { Seo } from "../components/Seo"
import { softwareAppJsonLd } from "../lib/seo"

const FEATURES = [
  { icon: "M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z", title: "Employee 360", desc: "One profile per person — employment history, contracts, compensation, documents, assets, attendance, leave, and payroll history in one place." },
  { icon: "M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0z", title: "Lebanon-first payroll", desc: "A rule-driven payroll engine: every number traces to an explicit rule you can open and read. Rules awaiting accountant verification are flagged — never silently applied." },
  { icon: "M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z", title: "Attendance & leave", desc: "Clock in/out, shift templates, leave requests and balances, absence detection, and approval workflows that actually get used." },
  { icon: "M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z", title: "Documents & assets", desc: "Expiry tracking, renewal reminders, and full custody history for company assets — down to the return checklist on offboarding." },
  { icon: "M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z", title: "Recruitment & onboarding", desc: "A public careers portal, applicant tracking, and unified onboarding/offboarding checklists." },
  { icon: "M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z", title: "Audit you can trust", desc: "Every payroll, salary, bank, and role change is attributable and reviewable — audit that's useful, not noisy." },
]

const CHIPS = ["Multi-step approvals", "Org chart", "Timesheets", "Performance cycles", "Benefits", "Careers portal & ATS", "Custom fields", "Import & migration", "Webhooks & integrations", "Manager self-service"]

const SLIDES = [
  { label: "Dashboard", src: "/screenshots/hr-dashboard.png" },
  { label: "Employee directory", src: "/screenshots/hr-employees.png" },
  { label: "Org chart", src: "/screenshots/hr-orgchart.png" },
  { label: "Payroll run", src: "/screenshots/hr-payroll.png" },
  { label: "Attendance & leave", src: "/screenshots/hr-attendance.png" },
]

export default function PayrollPage() {
  return (
    <div className="pt-40 pb-16">
      <Seo
        title="Titan HR & Payroll — Lebanon-first HR operating system"
        description="A complete HR operating system — employees, contracts, attendance, leave, documents, assets, and a rule-traceable payroll engine built for accountant review. Lebanon-first, multi-country-ready."
        path="/payroll"
        jsonLd={softwareAppJsonLd({
          name: "Titan HR & Payroll",
          path: "/payroll",
          category: "BusinessApplication",
          description:
            "A Lebanon-first HR operating system — employees, attendance, leave, documents, assets, and a rule-traceable payroll engine built for accountant review.",
        })}
      />
      <div className="max-w-6xl mx-auto px-5 sm:px-8">
        <Reveal>
          <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#e9c766] bg-[#d4af37]/[0.08] border border-[#d4af37]/25 rounded-full px-4 py-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#d4af37] animate-pulse" />
            People Operations
          </span>
        </Reveal>
        <Reveal delay={100}>
          <h1 className="font-display font-bold tracking-tight leading-[1.1] sm:leading-[0.95] text-[clamp(2.6rem,7vw,5.5rem)] mt-7">
            Payroll that can
            <br />
            <span className="text-gradient">explain itself.</span>
          </h1>
        </Reveal>
        <Reveal delay={200}>
          <p className="text-lg sm:text-xl text-slate-400 mt-7 max-w-2xl leading-relaxed">
            Titan HR is a complete HR operating system — people, contracts, attendance, leave, assets,
            documents, payroll, and approvals in one workspace. Built Lebanon-first, multi-country-ready.
          </p>
        </Reveal>

        <Reveal delay={280} className="mt-20">
          <DemoCarousel slides={SLIDES} />
          <p className="text-xs text-slate-600 mt-4 text-center">Real product screenshots from the live platform.</p>
        </Reveal>

        {/* How the numbers earn trust — honest about what's verified and what isn't */}
        <Reveal className="mt-28">
          <div className="shimmer-border">
            <div className="shimmer-inner p-10 sm:p-14">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#e9c766] mb-4">The trust model</p>
              <h2 className="font-display text-2xl sm:text-3xl font-bold mb-8">Rule-traceable, accountant-reviewable.</h2>
              <div className="grid sm:grid-cols-3 gap-8">
                <div>
                  <h3 className="font-display font-bold mb-2.5 text-[15px]">Every number has a source</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">Each line on a payslip traces to a named rule — rate, formula, and inputs — that you can open and inspect. No black-box totals.</p>
                </div>
                <div>
                  <h3 className="font-display font-bold mb-2.5 text-[15px]">Unverified means flagged</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">Statutory rules carry a verification status. Anything not yet reviewed by an accountant is marked as such — visibly — rather than silently applied as fact.</p>
                </div>
                <div>
                  <h3 className="font-display font-bold mb-2.5 text-[15px]">Built for review</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">Runs, salary changes, and rule edits are attributable and exportable, so your accountant verifies against evidence — not screenshots and memory. Titan is software, not legal or tax advice.</p>
                </div>
              </div>
            </div>
          </div>
        </Reveal>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mt-28">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={(i % 3) * 100}>
              <TiltCard className="h-full">
                <div className="glass glass-hover shine rounded-2xl p-7 h-full">
                  <div className="w-11 h-11 rounded-xl bg-[#d4af37]/10 border border-[#d4af37]/25 flex items-center justify-center mb-5">
                    <svg className="w-5 h-5 text-[#e9c766]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={f.icon} /></svg>
                  </div>
                  <h3 className="font-display font-bold mb-2.5">{f.title}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">{f.desc}</p>
                </div>
              </TiltCard>
            </Reveal>
          ))}
        </div>

        <Reveal className="mt-20">
          <div className="flex flex-wrap gap-2.5 justify-center">
            {CHIPS.map((c) => (
              <span key={c} className="text-[13px] text-slate-300 glass rounded-full px-4 py-2 hover:border-[#d4af37]/40 hover:text-white transition-colors cursor-default">
                {c}
              </span>
            ))}
          </div>
        </Reveal>

        <Reveal className="mt-28">
          <div className="shimmer-border">
            <div className="shimmer-inner p-12 sm:p-16 text-center">
              <h2 className="font-display text-3xl sm:text-4xl font-bold mb-4">See how every number explains itself.</h2>
              <p className="text-slate-400 max-w-xl mx-auto mb-9">Walk through the rule-traceable payroll engine with us — and bring your accountant. It's built to be reviewed.</p>
              <Magnetic>
                <Link to="/contact" className="inline-flex items-center gap-2 px-8 py-4 shine rounded-2xl bg-gradient-to-r from-[#d4af37] to-[#8f6a14] text-[#0b0803] font-semibold shadow-[0_8px_40px_-8px_rgba(212,175,55,0.45)]">
                  Book a demo
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
                </Link>
              </Magnetic>
            </div>
          </div>
        </Reveal>
      </div>
    </div>
  )
}
