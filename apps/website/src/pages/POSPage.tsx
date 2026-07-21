import { Link } from "react-router"
import { Reveal } from "../components/Reveal"
import { TiltCard } from "../components/TiltCard"
import { Magnetic } from "../components/Magnetic"
import { DemoCarousel } from "../components/DemoCarousel"
import { Seo } from "../components/Seo"
import { softwareAppJsonLd } from "../lib/seo"

const FEATURES = [
  { icon: "M12 6v12m-8-6h16", title: "Offline-first checkout", desc: "Runs entirely on the local machine — sales keep ringing up with no internet, and sync catches up automatically once it's back." },
  { icon: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4", title: "Inventory & batches", desc: "Stock levels, receiving, expiry-tracked batches, reorder points, and supplier records in one place." },
  { icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z", title: "Customers & debts", desc: "Track customer balances and store credit — a daily reality in Lebanese retail — without side spreadsheets." },
  { icon: "M13 10V3L4 14h7v7l9-11h-7z", title: "Delivery & driver app", desc: "A dedicated driver flow for delivery orders, plus a public customer ordering site for online orders." },
  { icon: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15", title: "Real-time sync", desc: "Multiple registers and devices stay in sync live over WebSocket, with secure device pairing for new hardware." },
  { icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4", title: "Multi-tenant by design", desc: "One platform safely running many independent stores — admin tooling included, not bolted on later." },
]

const CHIPS = ["Barcode scanning", "AI product images", "Daily close", "Cash drawer", "Refunds & holds", "Expenses", "Stock counts", "Arabic & English", "LBP + USD dual currency", "Receipt printing"]

// Trust mechanics — all provable in the product, no adoption claims.
const TRUST = [
  {
    title: "The store owns its system",
    desc: "Titan POS runs on a local hub in the store — the register, database, and other devices all work off that machine. The internet going down is an inconvenience, not an outage.",
  },
  {
    title: "Per-user permissions, server-enforced",
    desc: "Choose exactly what each staff member can do — checkout only, discounts, refunds, cash drawer, settings. Sensitive actions are re-checked by the server, so limits hold even against a tampered device.",
  },
  {
    title: "An audit trail that answers questions",
    desc: "Logins, voids, refunds, permission changes, shift opens and closes — recorded with who and when. When something looks off at day's end, you can trace it instead of arguing about it.",
  },
  {
    title: "Backups + a live cloud copy",
    desc: "The hub syncs continuously to the cloud, safe backup export strips secrets before it leaves the machine, and only paired, approved devices can connect to the store's data.",
  },
]

const SLIDES = [
  { label: "Checkout & cart", src: "/screenshots/pos-checkout.png" },
  { label: "Inventory & products", src: "/screenshots/pos-products.png" },
  { label: "Admin dashboard", src: "/screenshots/pos-dashboard.png" },
  { label: "Customers & debts", src: "/screenshots/pos-customers.png" },
  { label: "Security & settings", src: "/screenshots/pos-settings.png" },
]

export default function POSPage() {
  return (
    <div className="pt-40 pb-16">
      <Seo
        title="Titan POS — Offline-first point of sale for Lebanon"
        description="Offline-first checkout, inventory & batches, customers & debts, suppliers, and delivery on one desktop platform. Keeps selling with no internet and syncs to the cloud. Arabic & English, USD + LBP."
        path="/pos"
        jsonLd={softwareAppJsonLd({
          name: "Titan POS",
          path: "/pos",
          category: "BusinessApplication",
          description:
            "Offline-first point of sale for mini markets, supermarkets, and small retail — checkout, inventory, customers, debts, suppliers, and delivery on one machine.",
        })}
      />
      <div className="max-w-6xl mx-auto px-5 sm:px-8">
        {/* ── Hero ── */}
        <Reveal>
          <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#e9c766] bg-[#d4af37]/[0.08] border border-[#d4af37]/25 rounded-full px-4 py-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#d4af37] animate-pulse" />
            Retail & Hospitality
          </span>
        </Reveal>
        <Reveal delay={100}>
          <h1 className="font-display font-bold tracking-tight leading-[1.1] sm:leading-[0.95] text-[clamp(2.6rem,7vw,5.5rem)] mt-7">
            The register that
            <br />
            <span className="text-gradient">never stops selling.</span>
          </h1>
        </Reveal>
        <Reveal delay={200}>
          <p className="text-lg sm:text-xl text-slate-400 mt-7 max-w-2xl leading-relaxed">
            Titan POS is built for mini markets, supermarkets, and small retail — checkout, inventory,
            customers, and delivery on one machine, online or not.
          </p>
        </Reveal>

        {/* ── Coverflow demo ── */}
        <Reveal delay={280} className="mt-20">
          <DemoCarousel slides={SLIDES} />
          <p className="text-xs text-slate-600 mt-4 text-center">Real product screenshots from the live platform.</p>
        </Reveal>

        {/* ── Features ── */}
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

        {/* Trust — how it holds up when things go wrong */}
        <Reveal className="mt-28">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 mb-3">Built to be trusted</p>
          <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight mb-12">
            Good on a demo day.<br /><span className="text-gradient">Better on a bad one.</span>
          </h2>
        </Reveal>
        <div className="grid sm:grid-cols-2 gap-5">
          {TRUST.map((f, i) => (
            <Reveal key={f.title} delay={(i % 2) * 100}>
              <div className="glass glass-hover rounded-2xl p-8 h-full">
                <div className="w-8 h-[2px] bg-gradient-to-r from-[#e9c766] to-transparent mb-5" />
                <h3 className="font-display text-lg font-bold mb-3">{f.title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{f.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>

        {/* ── Capability chips ── */}
        <Reveal className="mt-20">
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
              <h2 className="font-display text-3xl sm:text-4xl font-bold mb-4">Want a walkthrough?</h2>
              <p className="text-slate-400 max-w-xl mx-auto mb-9">Get in touch and we'll show you Titan POS running against a real store setup — live, not slides.</p>
              <Magnetic>
                <Link to="/contact" className="inline-flex items-center gap-2 px-8 py-4 shine rounded-2xl bg-gradient-to-r from-[#e9c766] to-[#a4841f] text-[#0b0803] font-semibold shadow-[0_8px_40px_-8px_rgba(212,175,55,0.45)]">
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
