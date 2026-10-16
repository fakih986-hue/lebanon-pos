// Builds the Midnight Gold v2 prototype drafts (one HTML document per screen)
// from a shared token sheet + shell, so every preview is consistent by construction.
// Spec: docs/design/DESIGN-SYSTEM.md. Run: node docs/design/build-prototypes.cjs
const fs = require("fs")
const path = require("path")
const OUT = path.join(__dirname, "prototypes")
const LOGO = "https://vgbujcuwptvheqijyjbe.supabase.co/storage/v1/object/public/hmac-uploads/projects/14f044a4-5f7e-4a67-928b-a6a8801bea37/brand-assets/apps-desktop-public-titan-logo.png/titan-logo.png"

const TOKENS = `
:root{--page-bg:#0B0E14;--surface:#12161F;--surface-2:#171C27;--surface-3:#1E2430;--surface-hover:#1A2029;
--border:rgba(148,163,184,.10);--border-strong:rgba(148,163,184,.18);--text:#F4F6FA;--text-2:#9AA4B8;--text-3:#5F6B80;
--brand:#D4A843;--brand-hover:#E4BC5C;--brand-soft:rgba(212,168,67,.12);--brand-border:rgba(212,168,67,.35);--brand-contrast:#2C1F05;
--ok:#34D399;--ok-soft:rgba(52,211,153,.12);--warn:#FBBF24;--warn-soft:rgba(251,191,36,.12);--err:#F87171;--err-soft:rgba(248,113,113,.12);--info:#60A5FA;--info-soft:rgba(96,165,250,.12);
--elev-1:0 1px 2px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.04);--elev-3:0 16px 40px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.05)}
*{box-sizing:border-box}
html,body{margin:0;background:var(--page-bg);color:var(--text);font-family:"Inter","IBM Plex Sans Arabic",system-ui,sans-serif;font-size:14px;line-height:20px}
[dir=rtl]{font-family:"IBM Plex Sans Arabic","Inter",system-ui,sans-serif;line-height:22px}
.num{font-variant-numeric:tabular-nums;unicode-bidi:isolate}
.cap{font-size:12px;line-height:16px;font-weight:500;color:var(--text-2)}
.sub{font-size:16px;line-height:24px;font-weight:600}
.title{font-size:20px;line-height:28px;font-weight:600}
.stat{font-size:28px;line-height:34px;font-weight:600}
.total{font-size:44px;line-height:48px;font-weight:700;letter-spacing:-.01em}
.hero{font-size:64px;line-height:68px;font-weight:700;letter-spacing:-.02em}
.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;box-shadow:var(--elev-1)}
.inset{background:var(--surface-2);border:1px solid var(--border);border-radius:8px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:40px;padding:0 16px;border-radius:8px;font-weight:600;font-size:14px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--text);white-space:nowrap}
.btn-sm{height:32px;padding:0 12px;font-size:13px}
.btn-primary{background:var(--brand);border-color:var(--brand);color:var(--brand-contrast)}
.btn-ghost{background:transparent;border-color:transparent;color:var(--text-2)}
.btn-danger{background:var(--err-soft);border-color:transparent;color:var(--err)}
.btn-pay{width:100%;height:64px;border-radius:12px;background:var(--brand);color:var(--brand-contrast);font-size:18px;font-weight:700;border:0;display:flex;align-items:center;justify-content:space-between;padding:0 20px}
.btn[disabled]{opacity:.45}
.input{height:40px;border-radius:8px;background:var(--surface-2);border:1px solid var(--border-strong);color:var(--text);padding:0 12px;display:flex;align-items:center;gap:8px}
.focus{outline:2px solid var(--brand);outline-offset:2px}
.pill{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px;border-radius:999px;font-size:12px;font-weight:600}
.badge{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 8px;border-radius:6px;font-size:12px;font-weight:600}
.t-ok{background:var(--ok-soft);color:var(--ok)}.t-warn{background:var(--warn-soft);color:var(--warn)}.t-err{background:var(--err-soft);color:var(--err)}.t-info{background:var(--info-soft);color:var(--info)}.t-gold{background:var(--brand-soft);color:var(--brand)}.t-mute{background:var(--surface-3);color:var(--text-2)}
.dot{width:8px;height:8px;border-radius:999px;display:inline-block}
.row{display:grid;align-items:center;border-bottom:1px solid var(--border);min-height:44px}
.th{font-size:12px;font-weight:600;color:var(--text-2);background:var(--surface-2)}
.sel{background:var(--brand-soft);box-shadow:inset 3px 0 0 var(--brand)}
[dir=rtl] .sel{box-shadow:inset -3px 0 0 var(--brand)}
.tab{height:44px;display:inline-flex;align-items:center;gap:6px;color:var(--text-2);font-weight:600;border-bottom:2px solid transparent}
.tab.on{color:var(--text);border-color:var(--brand)}
.kbd{font-size:11px;font-weight:600;color:var(--text-2);border:1px solid var(--border-strong);border-bottom-width:2px;border-radius:5px;padding:0 5px;background:var(--surface-2)}
.banner{display:flex;align-items:center;gap:12px;border-radius:12px;padding:12px 16px;border:1px solid var(--border)}
`

function doc({ title, dir = "ltr", lang = "en", body }) {
  return `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://code.iconify.design/iconify-icon/2.1.0/iconify-icon.min.js"></script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${TOKENS}</style>
</head>
<body>
${body}
</body>
</html>
`
}
const icon = (name, size = 18, color = "currentColor") =>
  `<iconify-icon icon="lucide:${name}" width="${size}" height="${size}" style="color:${color}"></iconify-icon>`
const logo = (size = 32) =>
  `<span style="width:${size}px;height:${size}px;border-radius:${Math.round(size * 0.22)}px;background:#05070D;display:inline-grid;place-items:center;border:1px solid rgba(212,168,67,.25)"><img src="${LOGO}" alt="Titan POS" style="width:${Math.round(size * 0.82)}px;height:${Math.round(size * 0.82)}px;object-fit:contain"></span>`

// ── Status capsule (design system §6) ──────────────────────────────────────
const capsule = (tone, label, extra = "") =>
  `<button class="pill t-${tone}" style="height:32px;padding:0 12px;border:1px solid var(--border)" aria-label="Sync and status">${tone === "ok" ? `<span class="dot" style="background:var(--ok)"></span>` : icon(tone === "err" ? "alert-octagon" : tone === "warn" ? "cloud-off" : "refresh-cw", 14)}<span>${label}</span>${extra}</button>`

// ── Back-office shell (design system §2) ───────────────────────────────────
const NAV = [
  ["sell", "shopping-cart", "Sell"], ["stock", "boxes", "Stock"], ["money", "wallet", "Money"],
  ["delivery", "truck", "Delivery"], ["admin", "shield", "Admin"],
]
function shell({ active, crumb, page, tabs = [], activeTab, actions = "", capsuleHtml, banner = "", content }) {
  const nav = NAV.map(([id, ic, label]) => `
      <div class="flex items-center gap-3 h-11 rounded-lg px-3 ${id === active ? "sel" : ""}" style="color:${id === active ? "var(--text)" : "var(--text-2)"}">
        ${icon(ic, 20, id === active ? "var(--brand)" : "currentColor")}<span class="font-semibold">${label}</span>
        ${id === "money" && capsuleHtml && capsuleHtml.includes("refunds need review") ? `<span class="badge t-err ms-auto num">2</span>` : ""}
      </div>`).join("")
  const tabBar = tabs.length ? `<div class="flex items-end gap-6 px-6" style="border-bottom:1px solid var(--border)">${tabs.map(([v, l, c]) => `<span class="tab ${v === activeTab ? "on" : ""}">${l}${c ? `<span class="badge t-mute num">${c}</span>` : ""}</span>`).join("")}</div>` : ""
  return `<div style="display:flex;min-height:900px;width:1440px">
  <aside style="width:232px;flex-shrink:0;background:linear-gradient(180deg,#0A0F18,#05070D);border-inline-end:1px solid var(--border);display:flex;flex-direction:column;padding:16px 12px;gap:4px">
    <div class="flex items-center gap-3 px-2 pb-4">${logo(36)}<div><div class="font-semibold" style="font-size:15px">Titan POS</div><div class="cap" style="color:var(--text-3)">Fakih Market · Hamra</div></div></div>
    ${nav}
    <div style="margin-top:auto" class="inset p-3 flex items-center gap-3">
      <span style="width:32px;height:32px;border-radius:999px;background:var(--surface-3);display:grid;place-items:center" class="font-semibold">RF</span>
      <div class="min-w-0"><div class="font-semibold" style="font-size:13px">Rami Fakih</div><div class="cap">Owner</div></div>
    </div>
  </aside>
  <main style="flex:1;min-width:0;display:flex;flex-direction:column">
    <header style="height:64px;display:flex;align-items:center;gap:12px;padding:0 24px;border-bottom:1px solid var(--border);background:var(--page-bg)">
      <div class="min-w-0"><div class="cap" style="color:var(--text-3)">${crumb}</div><div class="title">${page}</div></div>
      <div class="flex items-center gap-2" style="margin-inline-start:auto">
        ${capsuleHtml}
        <span class="pill t-mute" style="height:32px">${icon("clock", 14)}Shift #42 · open since 08:02</span>
        <button class="btn btn-ghost btn-sm" aria-label="Language">${icon("languages", 16)}EN</button>
        <button class="btn btn-ghost btn-sm" aria-label="Theme">${icon("moon", 16)}</button>
        <button class="btn btn-ghost btn-sm" aria-label="Lock">${icon("lock", 16)}</button>
        ${actions}
      </div>
    </header>
    ${tabBar}
    <div style="padding:24px;display:flex;flex-direction:column;gap:16px">
      ${banner}
      ${content}
    </div>
  </main>
</div>`
}

const money = (usd, lbp, big = false) =>
  `<div class="num"><div class="${big ? "total" : "font-semibold"}">${usd}</div><div class="${big ? "sub" : "cap"}" style="color:var(--text-2)">${lbp}</div></div>`

const pages = {}

// ── 1. Register — checkout (EN, synced) ────────────────────────────────────
const products = [
  ["Pepsi 330 ml", "$0.60", "Drinks", ""], ["Almarai Laban 1 L", "$1.85", "Dairy", "low"], ["Lays Salt 45 g", "$0.90", "Snacks", ""],
  ["Picon Cheese 8 pcs", "$2.40", "Dairy", ""], ["Ariel Pods 22", "$9.50", "Household", ""], ["Water Sohat 1.5 L", "$0.45", "Drinks", ""],
  ["Bonjus Orange 1 L", "$1.10", "Drinks", ""], ["Kitkat 4 finger", "$0.75", "Snacks", "low"], ["Tide 3 kg", "$11.90", "Household", ""],
  ["Arabic bread", "$0.95", "Bakery", ""], ["Eggs 30", "$4.80", "Dairy", ""], ["Nescafé 3in1 x10", "$2.95", "Drinks", ""],
]
pages["01-register-checkout"] = doc({
  title: "Register — checkout",
  body: `<div style="width:1440px;height:900px;display:flex;flex-direction:column;background:var(--page-bg)">
  <div style="height:48px;display:flex;align-items:center;gap:12px;padding:0 16px;border-bottom:1px solid var(--border);background:#05070D">
    ${logo(28)}<span class="font-semibold">Fakih Market</span><span class="cap" style="color:var(--text-3)">Register 1 · Hamra</span>
    <span class="pill t-mute ms-4">${icon("clock", 14)}Shift #42 · Maya</span>
    <div class="flex items-center gap-2" style="margin-inline-start:auto">
      ${capsule("ok", "Synced 1 min ago")}
      <button class="btn btn-ghost btn-sm">${icon("languages", 16)}عربي</button>
      <button class="btn btn-ghost btn-sm">${icon("layout-dashboard", 16)}Back office</button>
      <button class="btn btn-ghost btn-sm" aria-label="Lock">${icon("lock", 16)}</button>
    </div>
  </div>
  <div style="flex:1;display:grid;grid-template-columns:1fr 440px;min-height:0">
    <section style="padding:20px;display:flex;flex-direction:column;gap:14px;min-width:0">
      <div class="input focus" style="height:56px;border-radius:12px;border-color:var(--brand-border)">${icon("scan-barcode", 22, "var(--brand)")}<span style="font-size:16px;color:var(--text-3)">Scan a barcode or type a product name…</span><span class="ms-auto flex gap-2"><span class="kbd">Enter</span><span class="cap">to pay when empty</span></span></div>
      <div class="flex items-center gap-2 cap" style="color:var(--ok)">${icon("check-circle-2", 16, "var(--ok)")}<span class="font-semibold" style="color:var(--text)">Almarai Laban 1 L</span> added · only 3 left in lot L-0812 (exp 19 Oct)</div>
      <div class="flex gap-2">${["All", "Favorites", "Drinks", "Dairy", "Snacks", "Bakery", "Household"].map((c, i) => `<span class="pill ${i === 0 ? "t-gold" : "t-mute"}" style="height:36px;padding:0 14px;font-size:13px">${c}</span>`).join("")}</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">
        ${products.map(([n, p, c, low]) => `<div class="card" style="border-radius:16px;padding:14px;height:132px;display:flex;flex-direction:column">
          <div class="cap" style="color:var(--text-3)">${c}</div>
          <div class="font-semibold" style="font-size:15px;margin-top:4px">${n}</div>
          <div class="flex items-end justify-between" style="margin-top:auto"><span class="num" style="font-size:18px;font-weight:700">${p}</span>${low ? `<span class="badge t-warn">${icon("alert-triangle", 12)}Low</span>` : ""}</div>
        </div>`).join("")}
      </div>
      <div class="flex gap-4 cap" style="margin-top:auto;color:var(--text-3)"><span><span class="kbd">Ctrl</span> <span class="kbd">F</span> search</span><span><span class="kbd">F2</span> exact cash</span><span><span class="kbd">F8</span> hold</span><span><span class="kbd">Esc</span> back</span></div>
    </section>
    <aside style="background:var(--surface);border-inline-start:1px solid var(--border);display:flex;flex-direction:column;min-height:0">
      <div style="padding:16px 20px;border-bottom:1px solid var(--border)" class="flex items-center gap-3">
        <span class="pill t-mute" style="height:32px">${icon("user", 14)}Walk-in customer</span>
        <span class="ms-auto flex gap-1"><button class="btn btn-ghost btn-sm">${icon("pause", 14)}Hold</button><button class="btn btn-ghost btn-sm">${icon("trash-2", 14)}Clear</button></span>
      </div>
      <div style="padding:8px 20px;flex:1;overflow:hidden">
        ${[["Almarai Laban 1 L", 2, "$3.70"], ["Ariel Pods 22", 1, "$9.50"], ["Arabic bread", 3, "$2.85"], ["Pepsi 330 ml", 6, "$3.60"]].map(([n, q, t]) => `
        <div class="flex items-center gap-3" style="padding:12px 0;border-bottom:1px solid var(--border)">
          <div class="min-w-0" style="flex:1"><div class="font-semibold">${n}</div><div class="cap num">${q} × ${(parseFloat(t.slice(1)) / q).toFixed(2)}</div></div>
          <div class="flex items-center inset" style="height:40px;border-radius:10px"><button class="btn btn-ghost" style="height:38px;width:40px;padding:0" aria-label="Decrease">${icon("minus", 16)}</button><span class="num font-semibold" style="width:28px;text-align:center">${q}</span><button class="btn btn-ghost" style="height:38px;width:40px;padding:0" aria-label="Increase">${icon("plus", 16)}</button></div>
          <div class="num font-semibold" style="width:64px;text-align:end">${t}</div>
        </div>`).join("")}
      </div>
      <div style="padding:16px 20px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:12px">
        <div class="flex justify-between cap num"><span>Subtotal</span><span>$19.65</span></div>
        <div class="flex justify-between cap num"><span>VAT 11%</span><span>$2.16</span></div>
        <div class="flex items-end justify-between"><span class="cap" style="font-size:13px">Total due</span><div class="num" style="text-align:end"><div class="total">$21.81</div><div class="sub" style="color:var(--text-2)">1,952,000 LBP</div></div></div>
        <div class="inset" style="display:grid;grid-template-columns:repeat(4,1fr);padding:4px;gap:4px;border-radius:10px">
          ${["Cash", "Card", "Wallet", "Debt"].map((m, i) => `<span class="flex items-center justify-center gap-2 font-semibold" style="height:40px;border-radius:8px;${i === 0 ? "background:var(--surface);box-shadow:var(--elev-1);color:var(--text)" : "color:var(--text-2)"}">${icon(["banknote", "credit-card", "wallet", "hand-coins"][i], 16)}${m}</span>`).join("")}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div><div class="cap mb-1">Paid USD</div><div class="input num" style="height:48px;font-size:18px;font-weight:600">$ 20</div></div>
          <div><div class="cap mb-1">Paid LBP</div><div class="input num focus" style="height:48px;font-size:18px;font-weight:600">200,000</div></div>
        </div>
        <div class="flex gap-2">${["Exact $", "Exact LBP", "$20", "$50", "100,000"].map((c) => `<span class="pill t-mute num" style="height:32px">${c}</span>`).join("")}</div>
        <div class="banner" style="background:var(--ok-soft);border-color:transparent"><span class="cap" style="color:var(--ok)">Change due</span><span class="num ms-auto font-semibold" style="font-size:22px;color:var(--ok)">35,000 LBP</span></div>
        <button class="btn-pay"><span>Pay</span><span class="num">$21.81 · 1,952,000 LBP</span><span class="kbd" style="background:rgba(0,0,0,.12);color:var(--brand-contrast);border-color:rgba(0,0,0,.2)">Enter</span></button>
        <div class="cap" style="color:var(--text-3)">Cash payable rounded up to 1,955,000 LBP (nearest 5,000 note).</div>
      </div>
    </aside>
  </div>
</div>`,
})

// ── 2. Register — payment review, Arabic RTL, offline ──────────────────────
pages["02-register-review-ar-offline"] = doc({
  title: "Register — review (Arabic, offline)", dir: "rtl", lang: "ar",
  body: `<div style="width:1440px;height:900px;position:relative;background:var(--page-bg)">
  <div style="height:48px;display:flex;align-items:center;gap:12px;padding:0 16px;border-bottom:1px solid var(--border);background:#05070D">
    ${logo(28)}<span class="font-semibold">سوبرماركت فقيه</span><span class="cap" style="color:var(--text-3)">الصندوق 1 · الحمرا</span>
    <div class="flex items-center gap-2" style="margin-inline-start:auto">
      ${capsule("warn", "غير متصل — محفوظ على هذا الجهاز", `<span class="num" style="opacity:.8">· 7</span>`)}
      <button class="btn btn-ghost btn-sm">${icon("languages", 16)}EN</button>
    </div>
  </div>
  <div class="banner" style="margin:16px;background:var(--warn-soft);border-color:transparent">${icon("cloud-off", 18, "var(--warn)")}<div><div class="font-semibold">أنت غير متصل بالإنترنت</div><div class="cap">يمكنك متابعة البيع. تُحفظ العمليات هنا وتُرسل تلقائياً عند عودة الاتصال (7 بانتظار المزامنة).</div></div></div>
  <div style="position:absolute;inset:48px 0 0 0;background:rgba(5,7,13,.78);display:grid;place-items:center">
    <div class="card" style="width:640px;border-radius:16px;box-shadow:var(--elev-3);padding:32px;display:flex;flex-direction:column;gap:20px">
      <div class="flex items-center justify-between"><div class="title">مراجعة الدفع</div><span class="badge t-warn">${icon("cloud-off", 12)}سيُزامن لاحقاً</span></div>
      <div class="inset" style="padding:20px;text-align:center;border-radius:12px">
        <div class="cap">المبلغ المستحق</div>
        <div class="hero num" style="margin-top:6px">$21.81</div>
        <div class="sub num" style="color:var(--text-2)">1,952,000 ل.ل</div>
        <div class="cap" style="margin-top:6px;color:var(--text-3)">المبلغ النقدي مدوّر إلى <span class="num">1,955,000</span> ل.ل (أقرب ورقة 5,000)</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="inset" style="padding:14px"><div class="cap">المدفوع</div><div class="num font-semibold" style="font-size:18px">$20 + 200,000 ل.ل</div></div>
        <div class="inset" style="padding:14px;background:var(--ok-soft);border-color:transparent"><div class="cap" style="color:var(--ok)">الباقي للزبون</div><div class="num font-semibold" style="font-size:22px;color:var(--ok)">35,000 ل.ل</div></div>
      </div>
      <div class="cap">4 أصناف · نقداً · الوردية #42 · مايا</div>
      <div class="flex gap-3">
        <button class="btn" style="height:56px;flex:1">${icon("arrow-right", 18)}رجوع <span class="kbd">Esc</span></button>
        <button class="btn btn-primary" style="height:56px;flex:2;font-size:17px">تأكيد ودفع <span class="num">$21.81</span> <span class="kbd" style="background:rgba(0,0,0,.12);color:var(--brand-contrast)">Enter</span></button>
      </div>
    </div>
  </div>
</div>`,
})

// ── 3. Products & lots ─────────────────────────────────────────────────────
const productRows = [
  ["Almarai Laban 1 L", "6281007030221", "Dairy", "$1.85", "$1.32", "29%", "27", "", "2 lots · 1 expiring"],
  ["Pepsi 330 ml", "5449000000996", "Drinks", "$0.60", "$0.38", "37%", "214", "", "3 lots"],
  ["Picon Cheese 8 pcs", "3073781024407", "Dairy", "$2.40", "$1.70", "29%", "41", "", "2 lots"],
  ["Ariel Pods 22", "8001090206926", "Household", "$9.50", "$7.10", "25%", "18", "", "1 lot"],
  ["Kitkat 4 finger", "6294001820310", "Snacks", "$0.75", "$0.48", "36%", "6", "warn", "1 lot"],
  ["Bonjus Orange 1 L", "5287000150013", "Drinks", "$1.10", "$0.74", "33%", "0", "err", "—"],
  ["Arabic bread", "—", "Bakery", "$0.95", "$0.60", "37%", "60", "", "untracked"],
]
pages["03-products-lots"] = doc({
  title: "Stock — products & lots",
  body: shell({
    active: "stock", crumb: "Stock", page: "Products",
    tabs: [["p", "Products", "1,284"], ["l", "Lots & counts"], ["r", "Receiving"], ["s", "Suppliers"]], activeTab: "p",
    actions: `<button class="btn btn-primary btn-sm">${icon("plus", 16)}Add product</button>`,
    capsuleHtml: capsule("warn", "12 waiting to sync"),
    content: `
    <div class="flex items-center gap-2">
      <div class="input" style="width:360px">${icon("search", 16, "var(--text-3)")}<span style="color:var(--text-3)">Search name, barcode or alias…</span></div>
      ${["All 1,284", "Low stock 23", "Expiring 9", "No barcode 14", "Archived"].map((f, i) => `<span class="pill ${i === 0 ? "t-gold" : i === 1 ? "t-warn" : i === 2 ? "t-err" : "t-mute"}" style="height:32px">${f}</span>`).join("")}
      <button class="btn btn-sm" style="margin-inline-start:auto">${icon("upload", 14)}Import</button><button class="btn btn-sm">${icon("download", 14)}Export</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 480px;gap:16px;align-items:start">
      <div class="card" style="overflow:hidden">
        <div class="row th" style="grid-template-columns:2.4fr 1fr .9fr .8fr .8fr .7fr .7fr;padding:0 16px"><span>Product</span><span>Category</span><span style="text-align:end">Price</span><span style="text-align:end">Cost</span><span style="text-align:end">Margin</span><span style="text-align:end">Stock</span><span style="text-align:end">Lots</span></div>
        ${productRows.map((r, i) => `<div class="row ${i === 0 ? "sel" : ""}" style="grid-template-columns:2.4fr 1fr .9fr .8fr .8fr .7fr .7fr;padding:0 16px">
          <div><div class="font-semibold">${r[0]}</div><div class="cap num" style="color:var(--text-3)">${r[1]}</div></div>
          <span style="color:var(--text-2)">${r[2]}</span><span class="num" style="text-align:end">${r[3]}</span><span class="num" style="text-align:end;color:var(--text-2)">${r[4]}</span><span class="num" style="text-align:end;color:var(--text-2)">${r[5]}</span>
          <span style="text-align:end">${r[7] ? `<span class="badge t-${r[7]} num">${r[6]}</span>` : `<span class="num">${r[6]}</span>`}</span><span class="cap" style="text-align:end">${r[8]}</span></div>`).join("")}
      </div>
      <div class="card" style="box-shadow:var(--elev-3)">
        <div style="padding:16px 20px;border-bottom:1px solid var(--border)" class="flex items-start gap-3">
          <div style="flex:1"><div class="sub">Almarai Laban 1 L</div><div class="cap num">6281007030221 · alias 6281007030238 · Dairy</div></div>
          <button class="btn btn-ghost btn-sm" aria-label="Close">${icon("x", 16)}</button>
        </div>
        <div style="padding:16px 20px;display:flex;flex-direction:column;gap:14px">
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
            <div class="inset" style="padding:10px"><div class="cap">On hand</div><div class="stat num" style="font-size:22px">27</div></div>
            <div class="inset" style="padding:10px"><div class="cap">Reorder at</div><div class="stat num" style="font-size:22px">12</div></div>
            <div class="inset" style="padding:10px"><div class="cap">Avg cost</div><div class="stat num" style="font-size:22px">$1.32</div></div>
          </div>
          <div class="flex items-center justify-between"><div class="sub" style="font-size:15px">Lots · first-expiry first</div><button class="btn btn-sm">${icon("package-plus", 14)}Receive</button></div>
          ${[["L-0812", "received 02 Oct", "exp 19 Oct", "err", "3 days", 3, 24], ["L-0839", "received 11 Oct", "exp 08 Nov", "warn", "23 days", 24, 24]].map(([id, r, e, t, d, left, init]) => `
          <div class="inset" style="padding:12px">
            <div class="flex items-center gap-2"><span class="font-semibold num">${id}</span><span class="cap">${r}</span><span class="badge t-${t}" style="margin-inline-start:auto">${icon("calendar-clock", 12)}${e} · ${d}</span></div>
            <div class="flex items-center gap-3 mt-2"><div style="flex:1;height:6px;border-radius:999px;background:var(--surface-3)"><div style="width:${(left / init) * 100}%;height:6px;border-radius:999px;background:var(--brand)"></div></div><span class="cap num">${left} of ${init} left</span></div>
          </div>`).join("")}
          <div class="banner t-info" style="border-color:transparent;font-size:13px">${icon("info", 16)}<span>Stock matches lots and the movement ledger.</span></div>
          <div class="flex gap-2"><button class="btn btn-sm">${icon("sliders-horizontal", 14)}Adjust</button><button class="btn btn-sm">${icon("clipboard-check", 14)}Count</button><button class="btn btn-ghost btn-sm" style="margin-inline-start:auto">${icon("archive", 14)}Archive</button><button class="btn btn-primary btn-sm">Save</button></div>
        </div>
      </div>
    </div>`,
  }),
})

// ── 4. Receiving ───────────────────────────────────────────────────────────
pages["04-receiving"] = doc({
  title: "Stock — receiving",
  body: shell({
    active: "stock", crumb: "Stock", page: "Receiving",
    tabs: [["p", "Products"], ["l", "Lots & counts"], ["r", "Receiving"], ["s", "Suppliers"]], activeTab: "r",
    capsuleHtml: capsule("ok", "Synced just now"),
    content: `
    <div style="display:grid;grid-template-columns:1fr 360px;gap:16px;align-items:start">
      <div class="card" style="overflow:hidden">
        <div style="padding:16px" class="flex items-center gap-3">
          <div class="input focus" style="flex:1;height:48px;border-color:var(--brand-border)">${icon("scan-barcode", 20, "var(--brand)")}<span style="color:var(--text-3)">Scan items into this delivery…</span></div>
          <button class="btn">${icon("clipboard-paste", 16)}Paste sheet</button>
        </div>
        <div class="row th" style="grid-template-columns:2.2fr .7fr .8fr .8fr 1fr 1.1fr 40px;padding:0 16px"><span>Item</span><span style="text-align:end">Qty</span><span style="text-align:end">Unit cost</span><span style="text-align:end">Sell price</span><span>Lot</span><span>Expiry</span><span></span></div>
        ${[["Almarai Laban 1 L", "matched · 6281007030221", "ok", "24", "$1.30", "$1.85", "L-0851", "09 Nov 2026"],
           ["Picon Cheese 8 pcs", "matched", "ok", "12", "$1.70", "$2.40", "L-0852", "15 Jan 2027"],
           ["Unknown barcode 6291041500213", "new product or alias?", "warn", "6", "—", "—", "—", "—"],
           ["Kitkat 4 finger", "price changed: cost +8%", "info", "48", "$0.52", "$0.80", "L-0853", "02 Mar 2027"]].map((r) => `
        <div class="row" style="grid-template-columns:2.2fr .7fr .8fr .8fr 1fr 1.1fr 40px;padding:0 16px;${r[2] === "warn" ? "background:var(--warn-soft)" : ""}">
          <div><div class="font-semibold">${r[0]}</div><div class="cap"><span class="badge t-${r[2]}">${r[1]}</span></div></div>
          <span class="num" style="text-align:end">${r[3]}</span><span class="num" style="text-align:end">${r[4]}</span><span class="num" style="text-align:end">${r[5]}</span><span class="num">${r[6]}</span><span class="num">${r[7]}</span>
          <button class="btn btn-ghost btn-sm" aria-label="Remove row">${icon("x", 14)}</button></div>`).join("")}
        <div style="padding:12px 16px" class="flex items-center gap-2">
          <div class="banner t-warn" style="border-color:transparent;flex:1;font-size:13px">${icon("help-circle", 16)}<span>1 row needs a decision before saving: link <span class="num">6291041500213</span> to an existing product, or create a new one.</span></div>
          <button class="btn btn-sm">Link to product</button><button class="btn btn-sm">Create new</button>
        </div>
      </div>
      <div class="flex flex-col gap-4">
        <div class="card" style="padding:16px;display:flex;flex-direction:column;gap:10px">
          <div class="sub">Supplier & invoice</div>
          <div class="input">${icon("building-2", 16, "var(--text-3)")}Malia Group</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><div class="input num">INV-77431</div><div class="input num">PO-118 · partial</div></div>
          <div class="cap">Payment</div>
          <div class="inset" style="display:grid;grid-template-columns:1fr 1fr 1fr;padding:4px;gap:4px">${["On account", "Cash", "Transfer"].map((m, i) => `<span class="flex items-center justify-center font-semibold" style="height:34px;border-radius:6px;${i === 0 ? "background:var(--surface);color:var(--text)" : "color:var(--text-2)"}">${m}</span>`).join("")}</div>
          <div class="cap" style="color:var(--text-3)">Adds $87.56 to Malia Group's balance. PO-118 already recorded $40.80 — only the difference is added.</div>
        </div>
        <div class="card" style="padding:16px;display:flex;flex-direction:column;gap:8px">
          <div class="sub">Summary</div>
          ${[["Ready rows", "3 of 4"], ["Units", "84"], ["Cost", "$87.56"], ["Labels to print", "84"]].map(([k, v]) => `<div class="flex justify-between"><span style="color:var(--text-2)">${k}</span><span class="num font-semibold">${v}</span></div>`).join("")}
          <button class="btn btn-primary" style="height:48px;margin-top:6px" disabled>${icon("check", 16)}Save delivery</button>
          <div class="cap" style="color:var(--text-3)">Resolve 1 row to save. Rows stay here if you leave this page.</div>
        </div>
      </div>
    </div>`,
  }),
})

// ── 5. Money › Today (dashboard) ───────────────────────────────────────────
const bars = [42, 55, 38, 61, 70, 66, 48, 59, 73, 81, 64, 77, 88, 72]
pages["05-money-today"] = doc({
  title: "Money — today",
  body: shell({
    active: "money", crumb: "Money", page: "Today",
    tabs: [["t", "Today"], ["s", "Shift & drawer"], ["e", "Expenses"], ["c", "Customers & debt"], ["r", "Reports"]], activeTab: "t",
    actions: `<button class="btn btn-primary btn-sm">${icon("lock-keyhole", 16)}Close the day</button>`,
    capsuleHtml: capsule("err", "2 refunds need review"),
    banner: `<div class="banner" style="background:var(--err-soft);border-color:transparent">${icon("alert-octagon", 20, "var(--err)")}<div style="flex:1"><div class="font-semibold">2 refunds were rejected by the server</div><div class="cap">Issued offline on Register 2, but another register had already refunded the same items. $32.40 left the drawer and is not on the server's books.</div></div><button class="btn btn-sm">Review & settle</button></div>`,
    content: `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px">
      ${[["Net sales", "$1,842.30", "164.9M LBP", "+12%", "ok"], ["Gross profit", "$486.10", "26.4% margin", "+4%", "ok"], ["Cash in drawer", "$612.00", "expected $618.50", "−$6.50", "warn"], ["Outstanding debt", "$2,310.00", "14 customers · 3 overdue", "+$85", "err"]].map(([l, v, f, d, t]) => `
      <div class="card" style="padding:16px"><div class="flex items-center justify-between"><span class="cap">${l}</span><span class="badge t-${t} num">${d}</span></div><div class="stat num" style="margin-top:6px">${v}</div><div class="cap num" style="color:var(--text-3)">${f}</div></div>`).join("")}
    </div>
    <div style="display:grid;grid-template-columns:1.6fr 1fr;gap:16px">
      <div class="card" style="padding:16px">
        <div class="flex items-center justify-between"><div class="sub">Sales · last 14 days</div><div class="flex gap-1">${["Day", "Week", "Month"].map((x, i) => `<span class="pill ${i === 0 ? "t-gold" : "t-mute"}">${x}</span>`).join("")}</div></div>
        <div style="height:220px;display:flex;align-items:flex-end;gap:10px;margin-top:16px;padding-bottom:4px;border-bottom:1px solid var(--border)">${bars.map((h, i) => `<div style="flex:1;height:${h * 2.2}px;border-radius:6px 6px 2px 2px;background:${i === bars.length - 1 ? "var(--brand)" : "var(--surface-3)"}"></div>`).join("")}</div>
        <div class="flex justify-between cap num" style="margin-top:8px;color:var(--text-3)"><span>03 Oct</span><span>Today</span></div>
        <div class="flex gap-4 mt-4">${[["Cash", "68%", "#5CB894"], ["Card", "14%", "#7D8CD9"], ["Wallet", "6%", "#A186C9"], ["Debt", "12%", "#C9A25C"]].map(([m, p, c]) => `<span class="flex items-center gap-2 cap"><span class="dot" style="background:${c}"></span>${m} <span class="num" style="color:var(--text)">${p}</span></span>`).join("")}</div>
      </div>
      <div class="card" style="padding:16px;display:flex;flex-direction:column;gap:10px">
        <div class="sub">Needs attention · by money at risk</div>
        ${[["alert-octagon", "err", "2 rejected refunds", "$32.40 · settle before closing"], ["hand-coins", "err", "3 overdue customers", "$940 over 60 days"], ["calendar-clock", "warn", "9 lots expire this week", "$118 at cost"], ["wallet", "warn", "Drawer short $6.50", "Shift #42 · Maya"], ["package-search", "warn", "23 products below reorder", "draft PO ready"]].map(([ic, t, a, b]) => `
        <div class="inset flex items-center gap-3" style="padding:10px 12px">${`<span class="badge t-${t}" style="height:28px;width:28px;justify-content:center;padding:0">${icon(ic, 14)}</span>`}<div style="flex:1"><div class="font-semibold">${a}</div><div class="cap num">${b}</div></div>${icon("chevron-right", 16, "var(--text-3)")}</div>`).join("")}
      </div>
    </div>`,
  }),
})

// ── 6. Admin › Devices & sync ──────────────────────────────────────────────
pages["06-admin-devices-sync"] = doc({
  title: "Admin — devices & sync",
  body: shell({
    active: "admin", crumb: "Admin", page: "Devices & sync",
    tabs: [["t", "Team & permissions"], ["s", "Store settings"], ["d", "Devices & sync", "3"], ["b", "Backup & recovery"], ["a", "About & updates"]], activeTab: "d",
    capsuleHtml: capsule("err", "3 changes rejected"),
    banner: `<div class="banner" style="background:var(--warn-soft);border-color:transparent">${icon("badge-alert", 20, "var(--warn)")}<div style="flex:1"><div class="font-semibold">Licence renewal due in 4 days</div><div class="cap">After that this store becomes read-only: selling stops, but reports and exports keep working. Offline registers keep selling until their 7-day lease ends.</div></div><button class="btn btn-sm">Renew</button></div>`,
    content: `
    <div style="display:grid;grid-template-columns:1.5fr 1fr;gap:16px;align-items:start">
      <div class="flex flex-col gap-4">
        <div class="card" style="padding:16px">
          <div class="flex items-center justify-between"><div class="sub">Sync queue</div><div class="flex gap-2"><button class="btn btn-sm">${icon("refresh-cw", 14)}Sync now</button><button class="btn btn-sm">${icon("file-down", 14)}Diagnostics</button></div></div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px">
            ${[["Waiting", "12", "warn"], ["Retrying", "1", "warn"], ["Rejected", "3", "err"], ["Synced today", "418", "ok"]].map(([l, v, t]) => `<div class="inset" style="padding:12px"><div class="cap">${l}</div><div class="stat num" style="font-size:22px;color:var(--${t})">${v}</div></div>`).join("")}
          </div>
        </div>
        <div class="card" style="overflow:hidden">
          <div style="padding:14px 16px" class="flex items-center"><div class="sub">Rejected changes</div><span class="cap" style="margin-inline-start:auto">Nothing here is deleted until it is resolved</span></div>
          ${[["Refund R-30412 · $18.40", "Already refunded on Register 1", "money", "Settle in Money"], ["Refund R-30417 · $14.00", "Already refunded on Register 1", "money", "Settle in Money"], ["Price update · Tide 3 kg", "Product was archived on another device", "", "Retry · Discard"]].map(([a, b, kind, act]) => `
          <div class="row" style="grid-template-columns:auto 1fr auto;gap:12px;padding:10px 16px">
            <span class="badge ${kind ? "t-err" : "t-mute"}" style="height:28px;width:28px;justify-content:center;padding:0">${icon(kind ? "hand-coins" : "file-x", 14)}</span>
            <div><div class="font-semibold num">${a}</div><div class="cap">${b}${kind ? ` · <span style="color:var(--err)">money already changed hands</span>` : ""}</div></div>
            <button class="btn btn-sm">${act}</button></div>`).join("")}
        </div>
      </div>
      <div class="flex flex-col gap-4">
        <div class="card" style="padding:16px;display:flex;flex-direction:column;gap:10px">
          <div class="sub">This device</div>
          <div class="inset" style="padding:4px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px">${["Store hub", "Connect to hub", "Cloud"].map((m, i) => `<span class="flex items-center justify-center font-semibold" style="height:34px;border-radius:6px;font-size:13px;${i === 0 ? "background:var(--surface);color:var(--text)" : "color:var(--text-2)"}">${m}</span>`).join("")}</div>
          ${[["Hub address", "192.168.1.20:3015"], ["LAN access", "On — 3 paired devices"], ["Cloud", "pos.titan-suite.net · reachable"], ["Last full pull", "Today 07:58"]].map(([k, v]) => `<div class="flex justify-between"><span style="color:var(--text-2)">${k}</span><span class="num font-semibold">${v}</span></div>`).join("")}
        </div>
        <div class="card" style="overflow:hidden">
          <div style="padding:14px 16px" class="flex items-center"><div class="sub">Paired devices</div><button class="btn btn-sm" style="margin-inline-start:auto">${icon("qr-code", 14)}Pair a device</button></div>
          ${[["Register 2", "Last seen 2 min ago", "ok", "Online"], ["Maya's phone", "Last seen 1 h ago", "warn", "Idle"], ["Driver · Ali", "Last seen yesterday", "mute", "Offline"]].map(([n, s, t, l]) => `<div class="row" style="grid-template-columns:1fr auto auto;gap:10px;padding:8px 16px"><div><div class="font-semibold">${n}</div><div class="cap">${s}</div></div><span class="badge t-${t}">${l}</span><button class="btn btn-ghost btn-sm" aria-label="More">${icon("more-horizontal", 16)}</button></div>`).join("")}
        </div>
      </div>
    </div>`,
  }),
})

// ── 7. System states board ─────────────────────────────────────────────────
const stateRows = [
  ["1", "err", "lock", "Read-only — contact support", "Licence blocked. Selling and edits are off; reports and exports still work."],
  ["2", "err", "hand-coins", "2 refunds need review", "Server rejected offline refunds. Never hidden; a manager settles each one."],
  ["3", "err", "file-x", "3 changes rejected", "Other rejected operations. Review, retry or discard (never for money)."],
  ["4", "info", "life-buoy", "Recovered 1 interrupted refund", "Shown once after restart: completed or rolled back, with what happened."],
  ["5", "warn", "cloud-off", "Offline — saved on this device", "Selling continues. Nothing blocks."],
  ["6", "warn", "upload-cloud", "12 waiting to sync", "Counts only — pending is not an error."],
  ["7", "warn", "badge-alert", "Licence: 4 days left", "Owner pages only, with a renew action."],
  ["9", "ok", "check", "Synced 2 min ago", "Quiet: a dot, no colour wash."],
]
pages["07-system-states"] = doc({
  title: "System states",
  body: `<div style="width:1440px;padding:32px;display:flex;flex-direction:column;gap:24px;background:var(--page-bg)">
  <div><div class="cap" style="color:var(--text-3)">Design system v2 · §6</div><div class="title">System states — one model everywhere</div><div style="color:var(--text-2)">Status capsule (always visible) → inline banner (only when the page is affected) → row badge (on the exact item).</div></div>
  <div style="display:grid;grid-template-columns:1.2fr 1fr;gap:24px;align-items:start">
    <div class="card" style="overflow:hidden">
      <div class="row th" style="grid-template-columns:48px 300px 1fr;padding:0 16px"><span>Priority</span><span>Capsule</span><span>Behaviour</span></div>
      ${stateRows.map(([p, t, ic, l, d]) => `<div class="row" style="grid-template-columns:48px 300px 1fr;padding:10px 16px"><span class="num cap">${p}</span><span><span class="pill t-${t}" style="height:32px;padding:0 12px">${t === "ok" ? `<span class="dot" style="background:var(--ok)"></span>` : icon(ic, 14)}${l}</span></span><span style="color:var(--text-2)">${d}</span></div>`).join("")}
      <div class="row" style="grid-template-columns:48px 300px 1fr;padding:10px 16px"><span class="num cap">8</span><span><span class="pill t-warn" style="height:32px;padding:0 12px">${icon("clock", 14)}Shift closed</span></span><span style="color:var(--text-2)">Lives on the shift chip, not the capsule. Register shows one action: Open shift.</span></div>
    </div>
    <div class="flex flex-col gap-4">
      <div class="card" style="padding:16px;display:flex;flex-direction:column;gap:10px">
        <div class="sub">Inline banners</div>
        <div class="banner" style="background:var(--err-soft);border-color:transparent">${icon("lock", 18, "var(--err)")}<div style="flex:1"><div class="font-semibold">This store is read-only</div><div class="cap">The licence has ended. You can still view reports and export data.</div></div><button class="btn btn-sm">Contact support</button></div>
        <div class="banner" style="background:var(--info-soft);border-color:transparent">${icon("life-buoy", 18, "var(--info)")}<div style="flex:1"><div class="font-semibold">Restoring this store's data…</div><div class="cap num">Products 1,284 / 1,284 · Sales 3,912 / 8,040 · keep this window open</div><div style="height:6px;border-radius:999px;background:var(--surface-3);margin-top:8px"><div style="width:48%;height:6px;border-radius:999px;background:var(--info)"></div></div></div></div>
        <div class="banner" style="background:var(--warn-soft);border-color:transparent">${icon("clock", 18, "var(--warn)")}<div style="flex:1"><div class="font-semibold">Shift closed</div><div class="cap">Open a shift to sell or refund.</div></div><button class="btn btn-primary btn-sm">Open shift</button></div>
      </div>
      <div class="card" style="padding:16px;display:flex;flex-direction:column;gap:12px">
        <div class="sub">Permission</div>
        <div class="flex items-center gap-2"><button class="btn btn-sm" disabled>${icon("lock", 14)}Refund</button><span class="cap">Needs: Refunds — ask a manager</span></div>
        <div class="inset" style="padding:20px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:8px">
          <span class="badge t-mute" style="height:40px;width:40px;justify-content:center;padding:0;border-radius:12px">${icon("shield-off", 20)}</span>
          <div class="sub">Accounting is for managers</div>
          <div class="cap" style="max-width:320px">This page needs the <span style="color:var(--text)">Accounting</span> permission. Switch to a user who has it.</div>
          <button class="btn btn-primary btn-sm">${icon("users", 14)}Switch user</button>
        </div>
      </div>
      <div class="card" style="padding:16px;display:flex;flex-direction:column;gap:10px">
        <div class="sub">Empty & loading</div>
        <div class="inset" style="padding:20px;text-align:center;border-style:dashed"><div class="font-semibold">No receipts today</div><div class="cap">Sales you ring up appear here.</div></div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">${[1, 2, 3].map(() => `<div class="inset" style="height:64px;background:linear-gradient(90deg,var(--surface-2),var(--surface-3),var(--surface-2))"></div>`).join("")}</div>
      </div>
    </div>
  </div>
</div>`,
})

for (const [name, html] of Object.entries(pages)) {
  fs.writeFileSync(path.join(OUT, `${name}.html`), html)
}
console.log(Object.keys(pages).map((n) => `${n}.html`).join("\n"))
