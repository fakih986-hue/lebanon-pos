import { useMemo, useState } from "react"
import { Reveal } from "../components/Reveal"
import { Magnetic } from "../components/Magnetic"

// ─────────────────────────────────────────────────────────────────────────────
// OWNER CONFIG — set these before go-live.
//  • CONTACT_EMAIL: where demo requests land (already live).
//  • WHATSAPP_NUMBER: full international number, digits only, no "+" or spaces
//    (e.g. "9613123456"). Leave "" until you have a REAL business number — while
//    empty, every WhatsApp option is hidden so nothing ever links to a fake one.
// ─────────────────────────────────────────────────────────────────────────────
const CONTACT_EMAIL = "hello@titan-suite.net"
const WHATSAPP_NUMBER = "" // ← owner: put the business WhatsApp number here

type Interest = "Titan POS" | "Titan HR & Payroll" | "Both"

const INTERESTS: Interest[] = ["Titan POS", "Titan HR & Payroll", "Both"]
const BUSINESS_TYPES = [
  "Mini-market / grocery",
  "Supermarket",
  "Retail shop",
  "Restaurant / café",
  "Pharmacy",
  "Company / office (HR)",
  "Other",
]

export default function ContactPage() {
  const [interest, setInterest] = useState<Interest>("Titan POS")
  const [businessType, setBusinessType] = useState("")
  const [size, setSize] = useState("")
  const [name, setName] = useState("")
  const [company, setCompany] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  const hasWhatsApp = WHATSAPP_NUMBER.trim().length > 0

  const body = useMemo(() => [
    `Product interest: ${interest}`,
    `Business type: ${businessType || "—"}`,
    `Stores / employees: ${size || "—"}`,
    `Name: ${name || "—"}`,
    `Company: ${company || "—"}`,
    `Phone / WhatsApp: ${phone || "—"}`,
    `Email: ${email || "—"}`,
    "",
    "Message:",
    message || "—",
  ].join("\n"), [interest, businessType, size, name, company, phone, email, message])

  const subject = `Demo request — ${company || name || "Titan"}`
  const mailtoHref = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  const waHref = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(`Hi Titan — I'd like a demo.\n\n${body}`)}`

  function validate(): boolean {
    if (!name.trim()) { setError("Please add your name."); return false }
    if (!email.trim() && !phone.trim()) { setError("Add an email or a phone number so we can reach you."); return false }
    setError("")
    return true
  }

  function submitEmail(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    window.location.href = mailtoHref
  }

  function submitWhatsApp() {
    if (!validate()) return
    window.open(waHref, "_blank", "noopener,noreferrer")
  }

  return (
    <div className="pt-32 sm:pt-40 pb-16">
      <div className="max-w-5xl mx-auto px-5 sm:px-8">
        {/* ── Hero ── */}
        <Reveal>
          <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#e9c766] bg-[#d4af37]/[0.08] border border-[#d4af37]/25 rounded-full px-4 py-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#d4af37] animate-pulse" />
            Book a demo
          </span>
        </Reveal>
        <Reveal delay={100}>
          <h1 className="font-display font-bold tracking-tight leading-[1.1] sm:leading-[0.95] text-[clamp(2.4rem,7vw,4.75rem)] mt-6">
            See it against <span className="text-gradient">your setup.</span>
          </h1>
        </Reveal>
        <Reveal delay={180}>
          <p className="text-base sm:text-lg text-slate-400 mt-6 max-w-2xl leading-relaxed">
            Tell us a little about your business and we'll walk you through Titan POS or Titan HR against a
            real workflow — not a slide deck. We usually reply within one business day.
          </p>
        </Reveal>

        {/* ── Fast contact cards ── */}
        <Reveal delay={240} className="mt-10">
          <div className="grid sm:grid-cols-3 gap-3">
            {hasWhatsApp && (
              <a href={`https://wa.me/${WHATSAPP_NUMBER}`} target="_blank" rel="noopener noreferrer"
                className="glass glass-hover rounded-2xl p-5 flex items-center gap-3.5 group">
                <span className="w-10 h-10 rounded-xl bg-[#d4af37]/10 border border-[#d4af37]/25 flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 text-[#e9c766]" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>
                </span>
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500 font-semibold">WhatsApp</p>
                  <p className="font-display font-bold text-[15px] group-hover:text-[#e9c766] transition-colors">Message us</p>
                </div>
              </a>
            )}
            <a href={`mailto:${CONTACT_EMAIL}`}
              className="glass glass-hover rounded-2xl p-5 flex items-center gap-3.5 group">
              <span className="w-10 h-10 rounded-xl bg-[#d4af37]/10 border border-[#d4af37]/25 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-[#e9c766]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" /></svg>
              </span>
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500 font-semibold">Email</p>
                <p className="font-display font-bold text-[15px] truncate group-hover:text-[#e9c766] transition-colors">{CONTACT_EMAIL}</p>
              </div>
            </a>
            <a href="#demo-form"
              className="glass glass-hover rounded-2xl p-5 flex items-center gap-3.5 group">
              <span className="w-10 h-10 rounded-xl bg-[#d4af37]/10 border border-[#d4af37]/25 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-[#e9c766]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" /></svg>
              </span>
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500 font-semibold">Walkthrough</p>
                <p className="font-display font-bold text-[15px] group-hover:text-[#e9c766] transition-colors">Book a demo</p>
              </div>
            </a>
          </div>
        </Reveal>

        {/* ── Lead form ── */}
        <Reveal delay={280} className="mt-8" >
          <div id="demo-form" className="shimmer-border scroll-mt-28">
            <form onSubmit={submitEmail} className="shimmer-inner p-6 sm:p-10">
              <h2 className="font-display text-2xl sm:text-3xl font-bold mb-2">Request a walkthrough</h2>
              <p className="text-sm text-slate-400 mb-8">We'll review your setup and show the product against a real workflow.</p>

              {/* Product interest */}
              <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 mb-2.5">What are you interested in?</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-6">
                {INTERESTS.map((opt) => {
                  const active = interest === opt
                  return (
                    <button key={opt} type="button" onClick={() => setInterest(opt)}
                      aria-pressed={active}
                      className="rounded-xl border px-3 py-3 text-sm font-semibold transition"
                      style={active
                        ? { background: "rgba(212,175,55,0.14)", borderColor: "rgba(212,175,55,0.5)", color: "#e9c766" }
                        : { background: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.1)", color: "#94a3b8" }}>
                      {opt}
                    </button>
                  )
                })}
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Name<span className="text-[#e9c766]"> *</span></label>
                  <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Company / store</label>
                  <input className="field" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Business name" autoComplete="organization" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Business type</label>
                  <select className="field" value={businessType} onChange={(e) => setBusinessType(e.target.value)}>
                    <option value="">Select…</option>
                    {BUSINESS_TYPES.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">How many stores / employees?</label>
                  <input className="field" value={size} onChange={(e) => setSize(e.target.value)} placeholder="e.g. 1 store · 8 staff" inputMode="text" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Phone / WhatsApp</label>
                  <input className="field" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+961 …" inputMode="tel" autoComplete="tel" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Email</label>
                  <input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Anything specific you want to see?</label>
                  <textarea className="field min-h-[110px] resize-y" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Current setup, pain points, timeline…" />
                </div>
              </div>

              {error && <p className="mt-4 text-sm font-semibold text-rose-400">{error}</p>}

              <div className="mt-7 flex flex-col sm:flex-row gap-3">
                <Magnetic>
                  <button type="submit"
                    className="inline-flex w-full sm:w-auto justify-center items-center gap-2 px-7 py-3.5 shine rounded-2xl bg-gradient-to-r from-[#e9c766] to-[#a4841f] text-[#0b0803] font-semibold text-sm shadow-[0_8px_40px_-8px_rgba(212,175,55,0.45)]">
                    Book a demo
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
                  </button>
                </Magnetic>
                {hasWhatsApp && (
                  <button type="button" onClick={submitWhatsApp}
                    className="inline-flex w-full sm:w-auto justify-center items-center gap-2 px-7 py-3.5 rounded-2xl glass glass-hover font-semibold text-sm">
                    Send on WhatsApp
                  </button>
                )}
              </div>
              <p className="mt-4 text-xs text-slate-600 leading-relaxed">
                Submitting opens your email app with the details pre-filled to {CONTACT_EMAIL} — nothing is sent
                until you press send. We only use your details to arrange the demo.
              </p>
            </form>
          </div>
        </Reveal>
      </div>
    </div>
  )
}
