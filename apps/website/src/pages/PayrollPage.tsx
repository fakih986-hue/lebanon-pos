import { Link } from "react-router"
import { Reveal } from "../components/Reveal"
import { Magnetic } from "../components/Magnetic"
import { DemoCarousel } from "../components/DemoCarousel"
import { WorkflowShowcase, type Workflow } from "../components/WorkflowShowcase"
import { Seo } from "../components/Seo"
import { softwareAppJsonLd } from "../lib/seo"

// ── The gallery at the top ──
const SLIDES = [
  { label: "Dashboard", src: "/screenshots/hr-dashboard.png" },
  { label: "Employee directory", src: "/screenshots/hr-employees.png" },
  { label: "Org chart", src: "/screenshots/hr-orgchart.png" },
  { label: "Payroll run", src: "/screenshots/hr-payroll.png" },
  { label: "Attendance & leave", src: "/screenshots/hr-attendance.png" },
]

// ── One real screen per real workflow ──
const WORKFLOWS: Workflow[] = [
  {
    eyebrow: "Every person, one record",
    title: "One profile that holds the whole story",
    desc: "Stop stitching a person together from folders and chats. Each employee is a single record — and everything about them hangs off it.",
    points: [
      "Employment history, contracts and compensation",
      "Documents and company assets assigned to them",
      "Attendance, leave balances and requests",
      "Their full payroll history, in one place",
    ],
    img: "/screenshots/hr-employees.png", imgAlt: "Titan HR employee directory", w: 1440, h: 900,
    frameUrl: "titan-suite.net — people",
    crop: { zoom: 1.4, pos: "45% 25%", aspect: "4 / 3" },
  },
  {
    eyebrow: "Time & leave",
    title: "Attendance and leave people actually use",
    desc: "Clocking, shifts, requests and balances in one flow — so time data is something you manage, not chase.",
    points: [
      "Clock in / out with shift templates",
      "Leave requests with live balances",
      "Absence detection instead of silent gaps",
      "Approvals that reach the right manager",
    ],
    img: "/screenshots/hr-attendance.png", imgAlt: "Titan HR attendance and leave", w: 1440, h: 900,
    frameUrl: "titan-suite.net — attendance",
    crop: { zoom: 1.5, pos: "50% 20%", aspect: "4 / 3" },
  },
  {
    eyebrow: "Approvals & structure",
    title: "Requests route up the org you define",
    desc: "Build your real reporting structure once, and approvals follow it — no request left sitting in the wrong inbox.",
    points: [
      "Define the reporting lines in an org chart",
      "Multi-step approvals follow those lines",
      "Managers approve leave and changes for their team",
      "Every decision is recorded — who approved, and when",
    ],
    img: "/screenshots/hr-orgchart.png", imgAlt: "Titan HR org chart", w: 1440, h: 900,
    frameUrl: "titan-suite.net — org",
    crop: { zoom: 1.6, pos: "55% 12%", aspect: "4 / 3" },
  },
  {
    eyebrow: "Payroll",
    title: "Payroll that explains every number",
    desc: "Each line on a payslip traces to a rule you can open and read. Nothing statutory is applied as fact until it's been reviewed.",
    points: [
      "Every number traces to a named rule — rate, formula, inputs",
      "Rules awaiting accountant verification are flagged, not silently applied",
      "Salary and bank changes are attributable and reviewable",
      "Export the evidence for your accountant to verify against",
    ],
    img: "/screenshots/hr-payroll.png", imgAlt: "Titan HR payroll run", w: 1440, h: 900,
    frameUrl: "titan-suite.net — payroll",
    crop: { zoom: 1.45, pos: "38% 26%", aspect: "4 / 3" },
  },
  {
    eyebrow: "For HR & managers",
    title: "The month, at a glance",
    desc: "Open the dashboard and see what needs you today — approvals waiting, documents expiring, leave coming up.",
    points: [
      "Pending approvals in one queue",
      "Documents and contracts nearing expiry",
      "Upcoming leave and headcount at a glance",
      "What needs attention, before it becomes a problem",
    ],
    img: "/screenshots/hr-dashboard.png", imgAlt: "Titan HR dashboard", w: 1440, h: 900,
    frameUrl: "titan-suite.net — dashboard",
    crop: { zoom: 1.5, pos: "68% 55%", aspect: "4 / 3" },
  },
]

// ── Documents & assets — a workflow told without a single screen ──
const DOCS_ASSETS = [
  { title: "Documents that don't lapse quietly", desc: "Contracts, IDs and permits with expiry dates and renewal reminders — so nothing important expires without warning." },
  { title: "Assets with a custody trail", desc: "Track what's been handed to whom — laptops, phones, keys — with full custody history." },
  { title: "Offboarding with a checklist", desc: "When someone leaves, the return checklist makes sure assets come back and access is closed." },
]

// ── Who it's for ──
const WHO_FOR = [
  { title: "HR teams", desc: "People, documents, leave, onboarding and offboarding in one workspace — instead of a folder, a spreadsheet, and a group chat." },
  { title: "Accountants", desc: "Rule-traceable payroll and attributable changes, exportable as evidence — so you verify against records, not screenshots and memory." },
  { title: "Managers", desc: "Approve leave and changes for your team, see who reports to you, and act without waiting on HR to relay it." },
  { title: "Employees", desc: "Request leave, watch your balance, and reach your own documents and payroll history — self-service, not email threads." },
]

// ── Why Titan is different ──
const WHY = [
  {
    title: "Lebanon-first payroll",
    desc: "A rule-driven engine built for the local reality first — with the architecture to expand beyond it. Rules you can read, not a black box translated from another market.",
  },
  {
    title: "People and payroll, one system",
    desc: "The profile, the contract, the attendance and the payslip are the same record — so numbers aren't re-keyed between an HR tool and a payroll tool, and they can't drift apart.",
  },
  {
    title: "Built to be reviewed",
    desc: "Every payroll, salary, bank and role change is attributable and exportable. Audit that's useful, not noisy — so a review ends in evidence, not a debate.",
  },
]

const CHIPS = ["Multi-step approvals", "Org chart", "Timesheets", "Performance cycles", "Benefits", "Careers portal & ATS", "Custom fields", "Import & migration", "Webhooks & integrations", "Manager self-service"]

export default function PayrollPage() {
  return (
    <div className="pt-40 pb-16">
      <Seo
        title="Titan HR & Payroll — Lebanon-first HR operating system"
        description="See how a team runs on Titan HR: employee 360, attendance & leave, approvals routed up your org, payroll that explains every number, documents & assets, and an audit trail built for accountant review. Lebanon-first."
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
        {/* ── Hero ── */}
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
            Follow a team through the month — hiring, attendance, leave, approvals and payday — in one
            workspace where every number traces back to a rule you can read.
          </p>
        </Reveal>
        <Reveal delay={280}>
          <div className="mt-8 flex flex-col sm:flex-row gap-3 sm:items-center">
            <Magnetic>
              <Link to="/contact" className="inline-flex w-full sm:w-auto justify-center items-center gap-2 px-7 py-3.5 shine rounded-2xl bg-gradient-to-r from-[#e9c766] to-[#a4841f] text-[#0b0803] font-semibold text-sm shadow-[0_8px_40px_-8px_rgba(212,175,55,0.45)]">
                Request HR demo
                <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
              </Link>
            </Magnetic>
            <Link to="/contact" className="inline-flex w-full sm:w-auto justify-center items-center gap-2 px-7 py-3.5 rounded-2xl glass glass-hover font-semibold text-sm">
              Talk to Titan
            </Link>
          </div>
        </Reveal>

        {/* ── Coverflow demo ── */}
        <Reveal delay={340} className="mt-20">
          <DemoCarousel slides={SLIDES} />
          <p className="text-xs text-slate-500 mt-4 text-center">Real product screenshots from the live platform.</p>
        </Reveal>

        {/* ── Workflows ── */}
        <Reveal className="mt-32">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 mb-3">A month on Titan HR</p>
          <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight max-w-2xl">
            Not a feature list. <span className="text-gradient">The way a team actually runs.</span>
          </h2>
        </Reveal>
        <div className="mt-16 space-y-24 lg:space-y-32">
          {WORKFLOWS.map((wf, i) => (
            <WorkflowShowcase key={wf.title} wf={wf} flip={i % 2 === 1} />
          ))}
        </div>

        {/* ── Documents & assets ── */}
        <Reveal className="mt-32">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 mb-3">Documents & assets</p>
          <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight mb-12">The paperwork, tracked — not piled.</h2>
        </Reveal>
        <div className="grid sm:grid-cols-3 gap-5">
          {DOCS_ASSETS.map((d, i) => (
            <Reveal key={d.title} delay={(i % 3) * 100}>
              <div className="glass glass-hover rounded-2xl p-8 h-full">
                <div className="w-8 h-[2px] bg-gradient-to-r from-[#e9c766] to-transparent mb-5" />
                <h3 className="font-display text-lg font-bold mb-3">{d.title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{d.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>

        {/* ── Trust model (auditability) ── */}
        <Reveal className="mt-32">
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

        {/* ── Who it's for ── */}
        <Reveal className="mt-32">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 mb-3">Who it's for</p>
          <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight mb-12">One system, four points of view.</h2>
        </Reveal>
        <div className="grid sm:grid-cols-2 gap-5">
          {WHO_FOR.map((w, i) => (
            <Reveal key={w.title} delay={(i % 2) * 100}>
              <div className="glass glass-hover rounded-2xl p-8 h-full">
                <h3 className="font-display text-lg font-bold mb-3">{w.title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{w.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>

        {/* ── Why Titan is different ── */}
        <Reveal className="mt-32">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 mb-3">Why Titan HR</p>
          <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight mb-12">Numbers you can defend.</h2>
        </Reveal>
        {/* Editorial rows — a different shape from the card grids above */}
        <div className="border-t border-white/[0.07]">
          {WHY.map((w, i) => (
            <Reveal key={w.title} delay={i * 100}>
              <div className="grid sm:grid-cols-12 gap-4 sm:gap-8 items-baseline py-9 border-b border-white/[0.07]">
                <span className="sm:col-span-2 font-display text-4xl sm:text-5xl font-bold text-gradient leading-none">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="sm:col-span-4 font-display text-xl sm:text-2xl font-bold tracking-tight">{w.title}</h3>
                <p className="sm:col-span-6 text-[15px] text-slate-400 leading-relaxed">{w.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>

        {/* ── Capability chips ── */}
        <Reveal className="mt-24">
          <p className="text-center text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 mb-6">Everything else it does</p>
          <div className="flex flex-wrap gap-2.5 justify-center">
            {CHIPS.map((c) => (
              <span key={c} className="text-[13px] text-slate-300 glass rounded-full px-4 py-2 hover:border-[#d4af37]/40 hover:text-white transition-colors cursor-default">
                {c}
              </span>
            ))}
          </div>
        </Reveal>

        {/* ── CTA ── */}
        <Reveal className="mt-28">
          <div className="shimmer-border">
            <div className="shimmer-inner p-12 sm:p-16 text-center">
              <h2 className="font-display text-3xl sm:text-4xl font-bold mb-4">See how every number explains itself.</h2>
              <p className="text-slate-400 max-w-xl mx-auto mb-9">Walk through the rule-traceable payroll engine with us — and bring your accountant. It's built to be reviewed.</p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
                <Magnetic>
                  <Link to="/contact" className="inline-flex w-full sm:w-auto justify-center items-center gap-2 px-8 py-4 shine rounded-2xl bg-gradient-to-r from-[#e9c766] to-[#a4841f] text-[#0b0803] font-semibold shadow-[0_8px_40px_-8px_rgba(212,175,55,0.45)]">
                    Request HR demo
                    <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
                  </Link>
                </Magnetic>
                <Link to="/contact" className="inline-flex w-full sm:w-auto justify-center items-center gap-2 px-8 py-4 rounded-2xl glass glass-hover font-semibold">
                  Talk to Titan
                </Link>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </div>
  )
}
