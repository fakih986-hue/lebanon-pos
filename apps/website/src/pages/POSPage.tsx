import { Link } from "react-router"
import { Reveal } from "../components/Reveal"
import { Magnetic } from "../components/Magnetic"
import { DemoCarousel } from "../components/DemoCarousel"
import { WorkflowShowcase, type Workflow } from "../components/WorkflowShowcase"
import { Seo } from "../components/Seo"
import { softwareAppJsonLd } from "../lib/seo"

// ── The gallery at the top (quick "what it looks like") ──
const SLIDES = [
  { label: "Checkout & cart", src: "/screenshots/pos-checkout.png" },
  { label: "Inventory & products", src: "/screenshots/pos-products.png" },
  { label: "Admin dashboard", src: "/screenshots/pos-dashboard.png" },
  { label: "Customers & debts", src: "/screenshots/pos-customers.png" },
  { label: "Security & settings", src: "/screenshots/pos-settings.png" },
]

// ── One real screen per real workflow ──
const WORKFLOWS: Workflow[] = [
  {
    eyebrow: "At the register",
    title: "Checkout that keeps up with the queue",
    desc: "The cashier scans or taps, takes payment in USD or LBP, and prints — without waiting on a server or the internet.",
    points: [
      "Barcode scan or tap-to-add, with quick product search",
      "Dual currency at the drawer — USD + LBP with quick-cash notes",
      "Hold a cart, start another, come back — nothing is lost",
      "Discounts, refunds and voids only for staff you allow",
      "Print or reprint a receipt on demand",
    ],
    img: "/screenshots/pos-checkout.png", imgAlt: "Titan POS checkout and cart screen", w: 1440, h: 900,
    frameUrl: "titan-suite.net — checkout",
  },
  {
    eyebrow: "For the owner",
    title: "See the store without standing in it",
    desc: "Open the dashboard from anywhere and read the day at a glance — what sold, what's low, where the cash is.",
    points: [
      "Today's sales, margin and transaction count",
      "Best and worst movers, so you buy the right stock",
      "Low-stock and out-of-stock surfaced before customers notice",
      "Cash position and expenses, not just revenue",
    ],
    img: "/screenshots/pos-dashboard.png", imgAlt: "Titan POS owner dashboard", w: 2547, h: 1163,
    frameUrl: "titan-suite.net — dashboard",
  },
  {
    eyebrow: "Stock control",
    title: "Know what's on the shelf — and what's expiring",
    desc: "Receive against suppliers, track expiry-dated batches, and reconcile counts — so the number on screen matches the shelf.",
    points: [
      "Receive stock against a supplier and update costs",
      "Expiry-tracked batches for perishables and pharma-style goods",
      "Reorder points that flag what to buy back",
      "Stock counts and adjustments that reconcile to the ledger",
    ],
    img: "/screenshots/pos-products.png", imgAlt: "Titan POS inventory and products screen", w: 1440, h: 900,
    frameUrl: "titan-suite.net — products",
  },
  {
    eyebrow: "Customers & credit",
    title: "Run the tab without the notebook",
    desc: "Store credit and customer debt are a daily reality in Lebanese retail. Titan keeps the ledger, so you don't keep it on paper.",
    points: [
      "A running balance per customer",
      "Sell on credit at checkout, record payments against the debt",
      "See who owes what, and how long it's been",
      "No side spreadsheet, no arguments at month-end",
    ],
    img: "/screenshots/pos-customers.png", imgAlt: "Titan POS customers and debts screen", w: 2552, h: 1152,
    frameUrl: "titan-suite.net — customers",
  },
  {
    eyebrow: "The hub",
    title: "One machine runs the store. Every device stays in sync.",
    desc: "Titan POS runs on a local hub — the register and the database live on that machine. Other tills, the back office and the driver phone all work off it, and it mirrors to the cloud.",
    points: [
      "The hub is the register and the server — no dependency on someone else's uptime",
      "Add tills and devices as browsers; secure pairing approves each one",
      "Keeps selling fully offline, then syncs to the cloud when the line returns",
      "Per-user permissions are re-checked on the server, not just hidden on screen",
    ],
    img: "/screenshots/pos-settings.png", imgAlt: "Titan POS security and settings screen", w: 2552, h: 1070,
    frameUrl: "titan-suite.net — settings",
  },
]

// ── Daily close — a workflow with no single screen, told as steps ──
const CLOSE_STEPS = [
  { n: "01", title: "Open with a float", desc: "Start the shift by recording the cash you put in the drawer." },
  { n: "02", title: "Cash in / cash out, logged", desc: "Every drawer movement during the day is recorded with who did it." },
  { n: "03", title: "Count the drawer", desc: "At close, count what's actually there and enter it." },
  { n: "04", title: "Variance, surfaced", desc: "Titan compares counted vs. expected and shows the difference — it doesn't hide it. The day locks with a report you can reopen." },
]

// ── Who it's for ──
const WHO_FOR = [
  { title: "Mini-markets & groceries", desc: "Fast checkout, dual currency, and customer tabs — on a single machine that keeps working when the internet doesn't." },
  { title: "Supermarkets & multi-branch", desc: "Several registers and devices in sync, staff roles and permissions, and the stock depth to run real aisles." },
  { title: "Retail & specialty shops", desc: "Barcodes, receipts, refunds and holds, batches and reorder points — the everyday retail toolkit, done properly." },
  { title: "Counter-service & takeaway", desc: "Quick add, quick pay, quick print — with expenses, cash drawer and daily close behind the counter." },
]

// ── Why Titan is different (all provable in the product) ──
const WHY = [
  {
    title: "Lebanon-first, not translated",
    desc: "USD + LBP at the drawer with quick-cash notes, customer debt ledgers, and Arabic & English throughout. Built for how the market actually trades — not adapted from Western retail software.",
  },
  {
    title: "Offline is the default, not a mode",
    desc: "The register runs on the store's own hub. A dropped connection is an inconvenience, not an outage — sales keep ringing up and the cloud catches up automatically once you're back.",
  },
  {
    title: "The store owns its system",
    desc: "A live cloud copy, safe backup exports with secrets stripped, and device pairing so only approved hardware connects. Every void, refund, discount and cash movement is gated by permission and written to an audit trail.",
  },
]

const CHIPS = ["Barcode scanning", "AI product images", "Daily close", "Cash drawer", "Refunds & holds", "Expenses", "Stock counts", "Delivery & driver app", "Arabic & English", "LBP + USD dual currency", "Receipt printing"]

export default function POSPage() {
  return (
    <div className="pt-40 pb-16">
      <Seo
        title="Titan POS — Offline-first point of sale for Lebanon"
        description="See how a store runs on Titan POS: cashier checkout, owner dashboard, inventory & batches, customer debts, daily close, and a multi-device hub that keeps selling offline and syncs to the cloud. Arabic & English, USD + LBP."
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
            Follow a real store through its day — checkout, stock, customers, cash and close — all on one
            machine that keeps working whether the internet does or not.
          </p>
        </Reveal>
        <Reveal delay={280}>
          <div className="mt-8 flex flex-col sm:flex-row gap-3 sm:items-center">
            <Magnetic>
              <Link to="/contact" className="inline-flex w-full sm:w-auto justify-center items-center gap-2 px-7 py-3.5 shine rounded-2xl bg-gradient-to-r from-[#e9c766] to-[#a4841f] text-[#0b0803] font-semibold text-sm shadow-[0_8px_40px_-8px_rgba(212,175,55,0.45)]">
                Request POS demo
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
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
          <p className="text-xs text-slate-600 mt-4 text-center">Real product screenshots from the live platform.</p>
        </Reveal>

        {/* ── Workflows ── */}
        <Reveal className="mt-32">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 mb-3">A day on Titan POS</p>
          <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight max-w-2xl">
            Not a feature list. <span className="text-gradient">The way a store actually runs.</span>
          </h2>
        </Reveal>
        <div className="mt-16 space-y-24 lg:space-y-32">
          {WORKFLOWS.map((wf, i) => (
            <WorkflowShowcase key={wf.title} wf={wf} flip={i % 2 === 1} />
          ))}
        </div>

        {/* ── Daily close ── */}
        <Reveal className="mt-32">
          <div className="shimmer-border">
            <div className="shimmer-inner p-8 sm:p-12">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#e9c766] mb-3">End of day</p>
              <h2 className="font-display text-2xl sm:text-3xl font-bold mb-3">Close the day, down to the last note.</h2>
              <p className="text-sm text-slate-400 max-w-2xl mb-10">The drawer either balances or it tells you why. No end-of-night guessing.</p>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {CLOSE_STEPS.map((s) => (
                  <div key={s.n}>
                    <p className="font-display text-2xl font-bold text-gradient mb-2">{s.n}</p>
                    <h3 className="font-display font-bold text-[15px] mb-1.5">{s.title}</h3>
                    <p className="text-sm text-slate-400 leading-relaxed">{s.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Reveal>

        {/* ── Who it's for ── */}
        <Reveal className="mt-32">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 mb-3">Who it's for</p>
          <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight mb-12">Built for the way you sell.</h2>
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
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 mb-3">Why Titan POS</p>
          <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight mb-12">
            Good on a demo day. <span className="text-gradient">Better on a bad one.</span>
          </h2>
        </Reveal>
        <div className="grid lg:grid-cols-3 gap-5">
          {WHY.map((w, i) => (
            <Reveal key={w.title} delay={(i % 3) * 100}>
              <div className="glass glass-hover rounded-2xl p-8 h-full">
                <div className="w-8 h-[2px] bg-gradient-to-r from-[#e9c766] to-transparent mb-5" />
                <h3 className="font-display text-lg font-bold mb-3">{w.title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{w.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>

        {/* ── Capability chips ── */}
        <Reveal className="mt-24">
          <p className="text-center text-xs font-semibold uppercase tracking-[0.3em] text-slate-600 mb-6">Everything else it does</p>
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
              <h2 className="font-display text-3xl sm:text-4xl font-bold mb-4">See it against your store.</h2>
              <p className="text-slate-400 max-w-xl mx-auto mb-9">We'll run Titan POS through your real workflow — checkout, stock, customers and close — live, not slides.</p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
                <Magnetic>
                  <Link to="/contact" className="inline-flex w-full sm:w-auto justify-center items-center gap-2 px-8 py-4 shine rounded-2xl bg-gradient-to-r from-[#e9c766] to-[#a4841f] text-[#0b0803] font-semibold shadow-[0_8px_40px_-8px_rgba(212,175,55,0.45)]">
                    Request POS demo
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
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
