// Midnight Gold v2 prototypes — builder.
//
//   node docs/design/build-prototypes.cjs            → offline kit in docs/design/prototypes/
//   node docs/design/build-prototypes.cjs canvas     → Superdesign import files in .superdesign/tmp/canvas/
//
// Offline kit: every asset is local (fonts, compiled Tailwind CSS, inline SVG
// icons, logo) so the prototypes render with the network disabled. Each screen
// is built in English and Arabic (RTL); theme via ?theme=light|dark; QA
// self-check via ?qa=1 (writes a JSON report into #qa-report).
// Spec: docs/design/DESIGN-SYSTEM.md.
const fs = require("fs")
const path = require("path")

const REPO = path.resolve(__dirname, "../..")
const MODE = process.argv[2] === "canvas" ? "canvas" : "offline"
const OUT = MODE === "canvas" ? path.join(REPO, ".superdesign/tmp/canvas") : path.join(__dirname, "prototypes")
const ASSETS = path.join(OUT, "assets")
const LOGO_URL = "https://vgbujcuwptvheqijyjbe.supabase.co/storage/v1/object/public/hmac-uploads/projects/14f044a4-5f7e-4a67-928b-a6a8801bea37/brand-assets/apps-desktop-public-titan-logo.png/titan-logo.png"
fs.mkdirSync(OUT, { recursive: true })

// ── Icons: inline SVG from the app's own lucide-react package (ISC) ─────────
const pnpm = path.join(REPO, "node_modules/.pnpm")
const lucideDir = path.join(pnpm, fs.readdirSync(pnpm).find((d) => d.startsWith("lucide-react@")), "node_modules/lucide-react/dist/esm/icons")
const iconCache = new Map()
function icon(name, size = 18, color = "currentColor") {
  if (!iconCache.has(name)) {
    const src = fs.readFileSync(path.join(lucideDir, `${name}.mjs`), "utf8")
    const node = Function(`return ${/const __iconNode = (\[[\s\S]*?\]);/.exec(src)[1]}`)()
    iconCache.set(name, node.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).filter(([k]) => k !== "key").map(([k, v]) => `${k}="${v}"`).join(" ")}/>`).join(""))
  }
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconCache.get(name)}</svg>`
}
// Directional icons mirror in RTL; neutral ones don't (design system §9).
const dirIcon = (name, size, color) => icon(name, size, color).replace('class="ic"', 'class="ic dir"')

// ── Tokens (design system §3) ──────────────────────────────────────────────
const TOKENS = `
:root,[data-theme=dark]{color-scheme:dark;--page-bg:#0B0E14;--surface:#12161F;--surface-2:#171C27;--surface-3:#1E2430;--surface-hover:#1A2029;
--border:rgba(148,163,184,.10);--border-strong:rgba(148,163,184,.22);--text:#F4F6FA;--text-2:#9AA4B8;--text-3:#7C879B;
--brand:#D4A843;--brand-hover:#E4BC5C;--brand-soft:rgba(212,168,67,.12);--brand-border:rgba(212,168,67,.40);--brand-contrast:#2C1F05;--brand-text:#E4BC5C;
--ok:#34D399;--ok-soft:rgba(52,211,153,.12);--warn:#FBBF24;--warn-soft:rgba(251,191,36,.12);--err:#F87171;--err-soft:rgba(248,113,113,.12);--info:#60A5FA;--info-soft:rgba(96,165,250,.12);
--rail-bg:linear-gradient(180deg,#0A0F18,#05070D);--rail-text:#C4CBD8;--plate:#05070D;
--elev-1:0 1px 2px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.04);--elev-3:0 16px 40px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.05);--scrim:rgba(5,7,13,.78)}
[data-theme=light]{color-scheme:light;--page-bg:#F7F5F1;--surface:#FFFFFF;--surface-2:#F6F4EF;--surface-3:#ECE8E1;--surface-hover:#F4F1EB;
--border:#E8E4DC;--border-strong:#D3CCC0;--text:#1C1917;--text-2:#57534E;--text-3:#635D55;
--brand:#996d14;--brand-hover:#7E5A10;--brand-soft:rgba(156,111,20,.10);--brand-border:rgba(156,111,20,.40);--brand-contrast:#FFFFFF;--brand-text:#6B4C0A;
--ok:#137639;--ok-soft:rgba(22,163,74,.10);--warn:#a44c09;--warn-soft:rgba(180,83,9,.10);--err:#b91c1c;--err-soft:rgba(220,38,38,.09);--info:#0e6d93;--info-soft:rgba(14,122,165,.10);
--rail-bg:linear-gradient(180deg,#0A0F18,#05070D);--rail-text:#C4CBD8;--plate:#05070D;
--elev-1:0 1px 2px rgba(28,25,23,.06);--elev-3:0 16px 40px rgba(28,25,23,.16);--scrim:rgba(28,25,23,.45)}
*{box-sizing:border-box}
html,body{margin:0;background:var(--page-bg);color:var(--text);font-family:"Inter","IBM Plex Sans Arabic",system-ui,sans-serif;font-size:14px;line-height:20px}
[dir=rtl] body,[dir=rtl] .root{font-family:"IBM Plex Sans Arabic","Inter",system-ui,sans-serif;line-height:22px}
[dir=rtl] .ic.dir{transform:scaleX(-1)}
.ic{flex-shrink:0;display:inline-block;vertical-align:middle}
.num{font-variant-numeric:tabular-nums;unicode-bidi:isolate}
.cap{font-size:12px;line-height:16px;font-weight:500;color:var(--text-2)}
.meta{color:var(--text-3)}
.sub{font-size:16px;line-height:24px;font-weight:600}
.title{font-size:20px;line-height:28px;font-weight:600}
.stat{font-size:28px;line-height:34px;font-weight:600}
.total{font-size:44px;line-height:48px;font-weight:700;letter-spacing:-.01em}
.hero{font-size:64px;line-height:68px;font-weight:700;letter-spacing:-.02em}
[dir=rtl] .total,[dir=rtl] .hero{letter-spacing:0}
.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;box-shadow:var(--elev-1)}
.inset{background:var(--surface-2);border:1px solid var(--border);border-radius:8px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:40px;padding:0 16px;border-radius:8px;font:inherit;font-weight:600;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--text);white-space:nowrap;cursor:pointer}
.btn-sm{min-height:32px;padding:0 12px;font-size:13px}
.btn-touch{min-height:48px}
.btn-primary{background:var(--brand);border-color:var(--brand);color:var(--brand-contrast)}
.btn-ghost{background:transparent;border-color:transparent;color:var(--text-2)}
.btn-danger{background:var(--err-soft);border-color:transparent;color:var(--err)}
.btn-pay{width:100%;min-height:64px;border-radius:12px;background:var(--brand);color:var(--brand-contrast);font:inherit;font-size:18px;font-weight:700;border:0;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 20px;cursor:pointer}
.btn[disabled]{opacity:.5;cursor:not-allowed}
.btn:focus-visible,.btn-pay:focus-visible,.field:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid var(--brand);outline-offset:2px}
.field{width:100%;min-height:40px;border-radius:8px;background:var(--surface-2);border:1px solid var(--border-strong);color:var(--text);padding:8px 12px;font:inherit}
.field-row{display:flex;align-items:center;gap:8px}
.focus{outline:2px solid var(--brand);outline-offset:2px}
.label{display:block;font-size:12px;line-height:16px;font-weight:600;color:var(--text-2);margin-bottom:6px}
.help{font-size:12px;line-height:16px;color:var(--text-3);margin-top:6px}
.error{font-size:12px;line-height:16px;color:var(--err);margin-top:6px;display:flex;gap:6px;align-items:center}
.invalid{border-color:var(--err)!important}
.pill{display:inline-flex;align-items:center;gap:6px;min-height:24px;padding:0 10px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}
.badge{display:inline-flex;align-items:center;gap:4px;min-height:20px;padding:0 8px;border-radius:6px;font-size:12px;font-weight:600;white-space:nowrap}
.t-ok{background:var(--ok-soft);color:var(--ok)}.t-warn{background:var(--warn-soft);color:var(--warn)}.t-err{background:var(--err-soft);color:var(--err)}.t-info{background:var(--info-soft);color:var(--info)}.t-gold{background:var(--brand-soft);color:var(--brand-text)}.t-mute{background:var(--surface-3);color:var(--text-2)}
.dot{width:8px;height:8px;border-radius:999px;display:inline-block}
.tbl{width:100%;border-collapse:collapse}
.tbl th{font-size:12px;font-weight:600;color:var(--text-2);background:var(--surface-2);text-align:start;padding:10px 16px;white-space:nowrap}
.tbl td{padding:10px 16px;border-top:1px solid var(--border);vertical-align:middle}
.tbl .r{text-align:end}
.scroll-x{overflow-x:auto;position:relative}
.sel{background:var(--brand-soft);box-shadow:inset 3px 0 0 var(--brand)}
[dir=rtl] .sel{box-shadow:inset -3px 0 0 var(--brand)}
.tab{min-height:44px;display:inline-flex;align-items:center;gap:6px;color:var(--text-2);font-weight:600;border-bottom:2px solid transparent;white-space:nowrap}
.tab.on{color:var(--text);border-color:var(--brand)}
.kbd{font-size:11px;font-weight:600;color:var(--text-2);border:1px solid var(--border-strong);border-bottom-width:2px;border-radius:5px;padding:0 5px;background:var(--surface-2)}
.banner{display:flex;align-items:center;gap:12px;border-radius:12px;padding:12px 16px;flex-wrap:wrap}
.banner > .grow{flex:1;min-width:220px}
.plate{background:var(--plate);display:inline-grid;place-items:center;border:1px solid rgba(212,168,67,.25)}
.seg{display:grid;gap:4px;padding:4px;border-radius:10px;background:var(--surface-2);border:1px solid var(--border)}
.seg > *{display:flex;align-items:center;justify-content:center;gap:6px;min-height:40px;border-radius:8px;font-weight:600;color:var(--text-2)}
.seg > .on{background:var(--surface);box-shadow:var(--elev-1);color:var(--text)}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}

/* ── Shell (§2): 232px sidebar ≥1200 · 64px rail 768–1199 · bottom nav <768 ── */
.shell{display:grid;grid-template-columns:232px minmax(0,1fr);min-height:100vh}
.side{background-color:#05070D;background-image:var(--rail-bg);border-inline-end:1px solid rgba(148,163,184,.12);display:flex;flex-direction:column;gap:4px;padding:16px 12px;color:var(--rail-text);position:sticky;top:0;height:100vh}
.side .nav{display:flex;align-items:center;gap:12px;min-height:44px;border-radius:8px;padding:0 12px;font-weight:600;color:var(--rail-text)}
.side .nav.on{background:rgba(212,168,67,.14);box-shadow:inset 3px 0 0 #D4A843;color:#F4F6FA}
[dir=rtl] .side .nav.on{box-shadow:inset -3px 0 0 #D4A843}
.side .who{margin-top:auto}
.main{min-width:0;display:flex;flex-direction:column}
.topbar{min-height:64px;display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px;padding:10px 24px;border-bottom:1px solid var(--border);background:var(--page-bg);position:sticky;top:0;z-index:30}
.topbar .tools{display:flex;align-items:center;gap:8px;margin-inline-start:auto;flex-wrap:wrap}
.tabs{display:flex;gap:24px;padding:0 24px;border-bottom:1px solid var(--border);overflow-x:auto}
.content{padding:24px;display:flex;flex-direction:column;gap:16px}
.bottom-nav{display:none}
@media (max-width:1199px){
  .shell{grid-template-columns:64px minmax(0,1fr)}
  .side{padding:16px 8px;align-items:center}
  .side .lbl,.side .brand-text,.side .who .who-text{display:none}
  .side .nav{padding:0;justify-content:center;width:44px}
}
@media (max-width:767px){
  .shell{grid-template-columns:minmax(0,1fr)}
  .side{display:none}
  .topbar{padding:10px 16px}
  .topbar .hide-sm{display:none}
  .tabs{padding:0 16px;gap:18px}
  .content{padding:16px 16px 88px}
  .bottom-nav{display:grid;grid-template-columns:repeat(5,1fr);position:fixed;inset-inline:0;bottom:0;background:var(--surface);border-top:1px solid var(--border);z-index:40;padding:6px 4px calc(6px + env(safe-area-inset-bottom))}
  .bottom-nav a{display:flex;flex-direction:column;align-items:center;gap:2px;font-size:11px;font-weight:600;color:var(--text-2);text-decoration:none;min-height:48px;justify-content:center}
  .bottom-nav a.on{color:var(--brand-text)}
}
/* ── Layout helpers ── */
.cols-2{display:grid;grid-template-columns:minmax(0,1fr) 480px;gap:16px;align-items:start}
.cols-2b{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:16px;align-items:start}
.cols-side{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:16px;align-items:start}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:16px}
.stack{display:flex;flex-direction:column;gap:16px}
@media (max-width:1199px){.cols-2,.cols-2b,.cols-side{grid-template-columns:minmax(0,1fr)}}
/* ── Register (§8) ── */
.register{display:grid;grid-template-columns:minmax(0,1fr) 440px;min-height:calc(100vh - 48px)}
.strip{--brand-text:#E4BC5C;--brand-soft:rgba(212,168,67,.16);--ok:#34D399;--ok-soft:rgba(52,211,153,.14);--warn:#FBBF24;--warn-soft:rgba(251,191,36,.14);--err:#F87171;--err-soft:rgba(248,113,113,.14);--border:rgba(148,163,184,.18);min-height:48px;display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px;padding:6px 16px;border-bottom:1px solid rgba(148,163,184,.14);background:#05070D;color:#F4F6FA}
.strip .tools{display:flex;align-items:center;gap:8px;margin-inline-start:auto}
.strip .btn-ghost{color:#C4CBD8}
.prod-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.tile{border-radius:16px;padding:14px;min-height:124px;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);box-shadow:var(--elev-1);text-align:start;font:inherit;color:inherit;cursor:pointer}
.rail{background:var(--surface);border-inline-start:1px solid var(--border);display:flex;flex-direction:column;min-height:0}
.paybar{display:none}
.register.simple{grid-template-columns:minmax(0,1fr) 420px}
@media (max-width:1199px){.register,.register.simple{grid-template-columns:minmax(0,1fr) 380px}}
@media (max-width:899px){
  .register,.register.simple{grid-template-columns:minmax(0,1fr)}
  .rail{border-inline-start:0;border-top:1px solid var(--border)}
  .strip .hide-sm{display:none}
  .paybar{display:flex;position:fixed;inset-inline:0;bottom:0;z-index:40;padding:10px 12px calc(10px + env(safe-area-inset-bottom));background:var(--surface);border-top:1px solid var(--border);box-shadow:var(--elev-3)}
  .register .with-paybar{padding-bottom:96px}
  .hide-sm{display:none}
}
@media (max-width:479px){.total{font-size:36px;line-height:40px}.hero{font-size:48px;line-height:52px}}
`

// ── Document ───────────────────────────────────────────────────────────────
const QA_SCRIPT = `
(function(){
  if(!/[?&]qa=1/.test(location.search))return;
  function lum(c){var m=c.match(/[\\d.]+/g);if(!m)return null;var a=m[3]===undefined?1:+m[3];var v=[m[0],m[1],m[2]].map(function(x){x/=255;return x<=.03928?x/12.92:Math.pow((x+.055)/1.055,2.4)});return {l:.2126*v[0]+.7152*v[1]+.0722*v[2],a:a,rgb:[+m[0],+m[1],+m[2]]}}
  function bgOf(el){var stack=[];while(el&&el.nodeType===1){var c=getComputedStyle(el).backgroundColor;var p=lum(c);if(p&&p.a>0){stack.push(p);if(p.a>=1)break}el=el.parentElement}var base=[11,14,20];var root=lum(getComputedStyle(document.body).backgroundColor);if(root)base=root.rgb;for(var i=stack.length-1;i>=0;i--){var s=stack[i];base=base.map(function(b,k){return s.rgb[k]*s.a+b*(1-s.a)})}return base}
  function L(rgb){var v=rgb.map(function(x){x/=255;return x<=.03928?x/12.92:Math.pow((x+.055)/1.055,2.4)});return .2126*v[0]+.7152*v[1]+.0722*v[2]}
  setTimeout(function(){document.fonts.ready.then(function(){
    var low=[];var seen=0;
    document.querySelectorAll('.root *').forEach(function(el){
      if(!el.childNodes.length)return;var own=[].some.call(el.childNodes,function(n){return n.nodeType===3&&n.textContent.trim()});if(!own)return;
      var r=el.getBoundingClientRect();if(!r.width||!r.height)return;var cs=getComputedStyle(el);if(cs.visibility==='hidden'||+cs.opacity===0)return;
      seen++;var fg=lum(cs.color);if(!fg)return;var bg=bgOf(el);var fgc=fg.rgb.map(function(x,k){return x*fg.a+bg[k]*(1-fg.a)});
      var a=L(fgc),b=L(bg);var ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);var size=parseFloat(cs.fontSize);var bold=+cs.fontWeight>=600;
      var need=(size>=24||(size>=18.66&&bold))?3:4.5;if(el.closest('[disabled]'))need=0;
      if(ratio<need)low.push({text:el.textContent.trim().slice(0,40),ratio:Math.round(ratio*100)/100,need:need});
    });
    var unnamed=[].filter.call(document.querySelectorAll('button,a,input,select,textarea'),function(el){if(el.type==='hidden')return false;var n=(el.getAttribute('aria-label')||el.textContent||'').trim();if(n)return false;if(el.id&&document.querySelector('label[for="'+el.id+'"]'))return false;return !el.closest('label')}).map(function(el){return el.outerHTML.slice(0,60)});
    var lang=document.documentElement.lang;
    var report={screen:document.title,theme:document.documentElement.dataset.theme,lang:lang,dir:document.documentElement.dir,viewport:innerWidth+'x'+innerHeight,
      overflowX:document.documentElement.scrollWidth>innerWidth+1?document.documentElement.scrollWidth:0,
      overflowBy:(function(){var w=null;document.querySelectorAll('.root *').forEach(function(el){var r=el.getBoundingClientRect();if(r.right>innerWidth+1||r.left<-1){if(!w||r.width<w.width)w={tag:el.tagName,cls:typeof el.className==='string'?el.className.slice(0,40):'',width:Math.round(r.width)}}});return w})(),
      brokenImages:[].filter.call(document.images,function(i){return !i.complete||!i.naturalWidth}).length,
      icons:document.querySelectorAll('svg.ic').length,
      fontLatin:document.fonts.check('600 16px Inter'),fontArabic:document.fonts.check('600 16px "IBM Plex Sans Arabic"'),
      textNodesChecked:seen,lowContrast:low.slice(0,12),lowContrastCount:low.length,unnamedControls:unnamed.slice(0,8)};
    var pre=document.createElement('pre');pre.id='qa-report';pre.textContent=JSON.stringify(report);document.body.appendChild(pre);
  })},300);
})();`

function doc({ title, lang, body }) {
  const dir = lang === "ar" ? "rtl" : "ltr"
  const head = MODE === "offline"
    ? `<link rel="stylesheet" href="assets/fonts.css">\n<link rel="stylesheet" href="assets/tailwind.css">`
    : `<script src="https://cdn.tailwindcss.com"></script>\n<link rel="preconnect" href="https://fonts.googleapis.com">\n<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap" rel="stylesheet">`
  const boot = `(function(){var m=/[?&]theme=(light|dark)/.exec(location.search);document.documentElement.dataset.theme=m?m[1]:'dark'})();`
  return `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${head}
<style>${TOKENS}</style>
<script>${boot}</script>
</head>
<body>
<div class="root">
${body}
</div>
${MODE === "offline" ? `<script>${QA_SCRIPT}</script>` : ""}
</body>
</html>
`
}

const logoSrc = () => (MODE === "offline" ? "assets/titan-logo.png" : LOGO_URL)
const logo = (size = 32) =>
  `<span class="plate" style="width:${size}px;height:${size}px;border-radius:${Math.round(size * 0.22)}px"><img src="${logoSrc()}" alt="Titan POS" width="${Math.round(size * 0.82)}" height="${Math.round(size * 0.82)}" style="object-fit:contain"></span>`

// ── Screen builders ────────────────────────────────────────────────────────
function makeScreens(lang) {
  const T = (en, ar) => (lang === "ar" ? ar : en)
  const lbp = (n) => `${n.toLocaleString("en-US")} ${T("LBP", "ل.ل")}`
  const usd = (n) => `$${n.toFixed(2)}`
  const capsule = (tone, label, iconName) =>
    `<button class="pill t-${tone}" style="min-height:32px;padding:0 12px;border:1px solid var(--border)" aria-label="${T("Sync and status", "المزامنة والحالة")}: ${label}">${tone === "ok" ? `<span class="dot" style="background:var(--ok)"></span>` : icon(iconName ?? "cloud-off", 14)}<span>${label}</span></button>`
  const NAV = [["sell", "shopping-cart", T("Sell", "البيع")], ["stock", "boxes", T("Stock", "المخزون")], ["money", "wallet", T("Money", "المال")], ["delivery", "truck", T("Delivery", "التوصيل")], ["admin", "shield", T("Admin", "الإدارة")]]
  const SHIFT = T("Shift #42 · open since 08:02", "الوردية #42 · مفتوحة منذ 08:02")

  function shell({ active, crumb, page, tabs = [], activeTab, actions = "", capsuleHtml, banner = "", content }) {
    const nav = NAV.map(([id, ic, label]) => `<a href="#${id}" id="nav-${id}" class="nav${id === active ? " on" : ""}" aria-label="${label}"${id === active ? ' aria-current="page"' : ""}>${icon(ic, 20, id === active ? "#D4A843" : "currentColor")}<span class="lbl">${label}</span></a>`).join("")
    const bottom = NAV.map(([id, ic, label]) => `<a href="#${id}" id="bnav-${id}" class="${id === active ? "on" : ""}"${id === active ? ' aria-current="page"' : ""}>${icon(ic, 20)}<span>${label}</span></a>`).join("")
    const tabBar = tabs.length ? `<nav class="tabs" aria-label="${T("Sections", "الأقسام")}">${tabs.map(([v, l, c]) => `<span class="tab${v === activeTab ? " on" : ""}"${v === activeTab ? ' aria-current="page"' : ""}>${l}${c ? `<span class="badge t-mute num">${c}</span>` : ""}</span>`).join("")}</nav>` : ""
    return `<div class="shell">
  <aside class="side" aria-label="${T("Main navigation", "التنقل الرئيسي")}">
    <div class="flex items-center gap-3 px-2 pb-4">${logo(36)}<div class="brand-text"><div class="font-semibold" style="font-size:15px;color:#F4F6FA">Titan POS</div><div class="cap" style="color:#9AA4B8">${T("Fakih Market · Hamra", "سوبرماركت فقيه · الحمرا")}</div></div></div>
    ${nav}
    <div class="who flex items-center gap-3" style="padding:10px;border-radius:10px;background:rgba(255,255,255,.04);border:1px solid rgba(148,163,184,.12)">
      <span style="width:32px;height:32px;border-radius:999px;background:#1E2430;display:grid;place-items:center;color:#F4F6FA" class="font-semibold">RF</span>
      <div class="who-text min-w-0"><div class="font-semibold" style="font-size:13px;color:#F4F6FA">${T("Rami Fakih", "رامي فقيه")}</div><div class="cap" style="color:#9AA4B8">${T("Owner", "المالك")}</div></div>
    </div>
  </aside>
  <main class="main">
    <header class="topbar">
      <div class="min-w-0"><div class="cap meta">${crumb}</div><h1 class="title" style="margin:0">${page}</h1></div>
      <div class="tools">
        ${capsuleHtml}
        <span class="pill t-mute hide-sm" style="min-height:32px">${icon("clock", 14)}${SHIFT}</span>
        <button class="btn btn-ghost btn-sm hide-sm">${icon("languages", 16)}${T("عربي", "EN")}</button>
        <button class="btn btn-ghost btn-sm" aria-label="${T("Theme", "المظهر")}">${icon("moon", 16)}</button>
        <button class="btn btn-ghost btn-sm" aria-label="${T("Lock", "قفل")}">${icon("lock", 16)}</button>
        ${actions}
      </div>
    </header>
    ${tabBar}
    <div class="content">
      ${banner}
      ${content}
    </div>
  </main>
  <nav class="bottom-nav" aria-label="${T("Main navigation", "التنقل الرئيسي")}">${bottom}</nav>
</div>`
  }

  function strip(capsuleHtml, extra = "") {
    return `<div class="strip">
    ${logo(28)}<span class="font-semibold">${T("Fakih Market", "سوبرماركت فقيه")}</span><span class="cap hide-sm" style="color:#9AA4B8">${T("Register 1 · Hamra", "الصندوق 1 · الحمرا")}</span>
    <span class="pill hide-sm" style="background:#1E2430;color:#C4CBD8">${icon("clock", 14)}${T("Shift #42 · Maya", "الوردية #42 · مايا")}</span>
    <div class="tools">
      ${capsuleHtml}
      <button class="btn btn-ghost btn-sm hide-sm">${icon("languages", 16)}${T("عربي", "EN")}</button>
      ${extra}
      <button class="btn btn-ghost btn-sm" aria-label="${T("Lock", "قفل")}">${icon("lock", 16)}</button>
    </div>
  </div>`
  }

  const cartLines = [
    [T("Almarai Laban 1 L", "لبن المراعي 1 ل"), 2, 1.85], [T("Ariel Pods 22", "آرييل كبسولات 22"), 1, 9.5],
    [T("Arabic bread", "خبز عربي"), 3, 0.95], [T("Pepsi 330 ml", "بيبسي 330 مل"), 6, 0.6],
  ]
  const lineRow = ([n, q, p], big = false) => `
      <div class="flex items-center gap-3" style="padding:${big ? "14px" : "12px"} 0;border-bottom:1px solid var(--border)">
        <div class="min-w-0" style="flex:1"><div class="font-semibold"${big ? ' style="font-size:16px"' : ""}>${n}</div><div class="cap num">${q} × ${usd(p)}</div></div>
        <div class="flex items-center inset" style="border-radius:10px">
          <button class="btn btn-ghost" style="min-height:${big ? 48 : 40}px;width:${big ? 48 : 40}px;padding:0" aria-label="${T("Decrease", "إنقاص")} ${n}">${icon("minus", 16)}</button>
          <span class="num font-semibold" style="width:28px;text-align:center">${q}</span>
          <button class="btn btn-ghost" style="min-height:${big ? 48 : 40}px;width:${big ? 48 : 40}px;padding:0" aria-label="${T("Increase", "زيادة")} ${n}">${icon("plus", 16)}</button>
        </div>
        <div class="num font-semibold" style="width:64px;text-align:end">${usd(q * p)}</div>
      </div>`
  // Money: subtotal 19.65, VAT 11% 2.16, total 21.81 → 1,951,995 ≈ 1,952,000 LBP; cash payable rounded up 1,955,000.
  // Paid $20 + 200,000 LBP = 1,990,000 LBP → change 35,000 LBP.

  const S = {}

  // 01 — Register checkout
  const products = [
    [T("Pepsi 330 ml", "بيبسي 330 مل"), 0.6, T("Drinks", "مشروبات"), 0], [T("Almarai Laban 1 L", "لبن المراعي 1 ل"), 1.85, T("Dairy", "ألبان"), 1], [T("Lays Salt 45 g", "ليز ملح 45 غ"), 0.9, T("Snacks", "تسالي"), 0],
    [T("Picon Cheese 8 pcs", "جبنة بيكون 8 قطع"), 2.4, T("Dairy", "ألبان"), 0], [T("Ariel Pods 22", "آرييل كبسولات 22"), 9.5, T("Household", "منزلية"), 0], [T("Water Sohat 1.5 L", "مياه صحة 1.5 ل"), 0.45, T("Drinks", "مشروبات"), 0],
    [T("Bonjus Orange 1 L", "بونجوس برتقال 1 ل"), 1.1, T("Drinks", "مشروبات"), 0], [T("Kitkat 4 finger", "كيت كات 4 أصابع"), 0.75, T("Snacks", "تسالي"), 1], [T("Arabic bread", "خبز عربي"), 0.95, T("Bakery", "مخبوزات"), 0],
  ]
  S["01-register-checkout"] = {
    title: T("Register — checkout", "الصندوق — الدفع"),
    body: `${strip(capsule("ok", T("Synced 1 min ago", "تمت المزامنة منذ دقيقة")), `<button class="btn btn-ghost btn-sm hide-sm">${icon("layout-dashboard", 16)}${T("Back office", "الإدارة")}</button>`)}
  <div class="register">
    <section class="with-paybar" style="padding:20px;display:flex;flex-direction:column;gap:14px;min-width:0" aria-label="${T("Products", "المنتجات")}">
      <label class="field-row field focus" style="min-height:56px;border-radius:12px;border-color:var(--brand-border)">${icon("scan-barcode", 22, "var(--brand)")}<span class="sr-only">${T("Scan or search", "امسح أو ابحث")}</span><input class="num" style="flex:1;min-width:0;background:transparent;border:0;color:var(--text);font:inherit;font-size:16px;outline:none" placeholder="${T("Scan a barcode or type a product name…", "امسح الباركود أو اكتب اسم المنتج…")}"><span class="hide-sm flex gap-2 items-center"><span class="kbd">Enter</span><span class="cap">${T("pay when empty", "للدفع عند الفراغ")}</span></span></label>
      <div class="flex items-center gap-2 cap" role="status" style="color:var(--ok);flex-wrap:wrap">${icon("circle-check", 16)}<span class="font-semibold" style="color:var(--text)">${T("Almarai Laban 1 L", "لبن المراعي 1 ل")}</span> ${T("added · only 3 left in lot L-0812 (exp 19 Oct)", "أُضيف · بقي 3 فقط في الدفعة L-0812 (تنتهي 19 تشرين الأول)")}</div>
      <div class="flex gap-2" style="overflow-x:auto">${[T("All", "الكل"), T("Favorites", "المفضلة"), T("Drinks", "مشروبات"), T("Dairy", "ألبان"), T("Snacks", "تسالي"), T("Bakery", "مخبوزات"), T("Household", "منزلية")].map((c, i) => `<span class="pill ${i === 0 ? "t-gold" : "t-mute"}" style="min-height:40px;padding:0 14px;font-size:13px">${c}</span>`).join("")}</div>
      <div class="prod-grid">
        ${products.map(([n, p, c, low]) => `<button class="tile"><span class="cap meta">${c}</span><span class="font-semibold" style="font-size:15px;margin-top:4px">${n}</span><span class="flex items-end justify-between" style="margin-top:auto;width:100%"><span class="num" style="font-size:18px;font-weight:700">${usd(p)}</span>${low ? `<span class="badge t-warn">${icon("triangle-alert", 12)}${T("Low", "قليل")}</span>` : ""}</span></button>`).join("")}
      </div>
      <div class="flex gap-4 cap meta hide-sm" style="margin-top:auto;flex-wrap:wrap"><span><span class="kbd">Ctrl</span> <span class="kbd">F</span> ${T("search", "بحث")}</span><span><span class="kbd">F2</span> ${T("exact cash", "المبلغ بالضبط")}</span><span><span class="kbd">F8</span> ${T("hold", "تعليق")}</span><span><span class="kbd">Esc</span> ${T("back", "رجوع")}</span></div>
    </section>
    <aside class="rail" aria-label="${T("Current sale", "البيع الحالي")}">
      <div class="flex items-center gap-3" style="padding:16px 20px;border-bottom:1px solid var(--border)">
        <span class="pill t-mute" style="min-height:32px">${icon("user", 14)}${T("Walk-in customer", "زبون عابر")}</span>
        <span class="flex gap-1" style="margin-inline-start:auto"><button class="btn btn-ghost btn-sm">${icon("pause", 14)}${T("Hold", "تعليق")}</button><button class="btn btn-ghost btn-sm">${icon("trash-2", 14)}${T("Clear", "مسح")}</button></span>
      </div>
      <div style="padding:8px 20px;flex:1">${cartLines.map((l) => lineRow(l)).join("")}</div>
      <div style="padding:16px 20px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:12px">
        <div class="flex justify-between cap num"><span>${T("Subtotal", "المجموع الفرعي")}</span><span>$19.65</span></div>
        <div class="flex justify-between cap num"><span>${T("VAT 11%", "ضريبة القيمة المضافة 11%")}</span><span>$2.16</span></div>
        <div class="flex items-end justify-between"><span class="cap" style="font-size:13px">${T("Total due", "المبلغ المستحق")}</span><div class="num" style="text-align:end"><div class="total">$21.81</div><div class="sub" style="color:var(--text-2)">${lbp(1952000)}</div></div></div>
        <div class="seg" style="grid-template-columns:repeat(4,minmax(0,1fr))" role="radiogroup" aria-label="${T("Payment method", "طريقة الدفع")}">${[["banknote", T("Cash", "نقداً")], ["credit-card", T("Card", "بطاقة")], ["wallet", T("Wallet", "محفظة")], ["hand-coins", T("Debt", "دين")]].map(([ic, m], i) => `<span role="radio" aria-checked="${i === 0}" class="${i === 0 ? "on" : ""}">${icon(ic, 16)}<span class="hide-xs">${m}</span></span>`).join("")}</div>
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px">
          <label><span class="label">${T("Paid USD", "المدفوع بالدولار")}</span><input class="field num" style="min-height:48px;font-size:18px;font-weight:600" value="$ 20"></label>
          <label><span class="label">${T("Paid LBP", "المدفوع بالليرة")}</span><input class="field num focus" style="min-height:48px;font-size:18px;font-weight:600" value="200,000"></label>
        </div>
        <div class="flex gap-2" style="flex-wrap:wrap">${[T("Exact $", "بالضبط $"), T("Exact LBP", "بالضبط ل.ل"), "$20", "$50", "100,000"].map((c) => `<button class="pill t-mute num" style="min-height:36px;border:0">${c}</button>`).join("")}</div>
        <div class="banner t-ok" role="status"><span class="cap" style="color:inherit">${T("Change due", "الباقي للزبون")}</span><span class="num font-semibold" style="margin-inline-start:auto;font-size:22px">${lbp(35000)}</span></div>
        <button class="btn-pay hide-sm"><span>${T("Pay", "ادفع")}</span><span class="num">$21.81 · ${lbp(1952000)}</span><span class="kbd" style="background:rgba(0,0,0,.12);color:var(--brand-contrast);border-color:rgba(0,0,0,.2)">Enter</span></button>
        <div class="cap meta">${T("Cash payable rounded up to 1,955,000 LBP (nearest 5,000 note).", "المبلغ النقدي مدوّر إلى 1,955,000 ل.ل (أقرب ورقة 5,000).")}</div>
      </div>
    </aside>
  </div>
  <div class="paybar"><button class="btn-pay"><span>${T("Pay", "ادفع")}</span><span class="num">$21.81</span><span class="num cap" style="color:inherit">${lbp(1952000)}</span></button></div>`,
  }

  // 02 — Payment review (offline)
  S["02-register-review-offline"] = {
    title: T("Register — payment review (offline)", "الصندوق — مراجعة الدفع (غير متصل)"),
    body: `${strip(capsule("warn", T("Offline — saved on this device · 7", "غير متصل — محفوظ على هذا الجهاز · 7")))}
  <div style="position:relative;min-height:calc(100vh - 48px)">
    <div class="banner t-warn" role="status" style="margin:16px">${icon("cloud-off", 18)}<div class="grow"><div class="font-semibold">${T("You are offline", "أنت غير متصل بالإنترنت")}</div><div class="cap" style="color:inherit">${T("Keep selling. Work is saved here and sent automatically when the connection returns (7 waiting).", "يمكنك متابعة البيع. تُحفظ العمليات هنا وتُرسل تلقائياً عند عودة الاتصال (7 بانتظار المزامنة).")}</div></div></div>
    <div role="dialog" aria-modal="true" aria-labelledby="review-title" style="position:absolute;inset:0;background:var(--scrim);display:grid;place-items:center;padding:16px">
      <div class="card" style="width:min(640px,100%);border-radius:16px;box-shadow:var(--elev-3);padding:28px;display:flex;flex-direction:column;gap:18px">
        <div class="flex items-center justify-between gap-2"><h2 id="review-title" class="title" style="margin:0">${T("Review payment", "مراجعة الدفع")}</h2><span class="badge t-warn">${icon("cloud-off", 12)}${T("Will sync later", "سيُزامن لاحقاً")}</span></div>
        <div class="inset" style="padding:20px;text-align:center;border-radius:12px">
          <div class="cap">${T("Amount due", "المبلغ المستحق")}</div>
          <div class="hero num" style="margin-top:6px">$21.81</div>
          <div class="sub num" style="color:var(--text-2)">${lbp(1952000)}</div>
          <div class="cap meta" style="margin-top:6px">${T("Cash payable rounded up to 1,955,000 LBP (nearest 5,000 note)", "المبلغ النقدي مدوّر إلى 1,955,000 ل.ل (أقرب ورقة 5,000)")}</div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px">
          <div class="inset" style="padding:14px"><div class="cap">${T("Paid", "المدفوع")}</div><div class="num font-semibold" style="font-size:18px">$20 + ${lbp(200000)}</div></div>
          <div class="inset t-ok" style="padding:14px;border-color:transparent"><div class="cap" style="color:inherit">${T("Change to give", "الباقي للزبون")}</div><div class="num font-semibold" style="font-size:22px">${lbp(35000)}</div></div>
        </div>
        <div class="cap">${T("4 items · Cash · Shift #42 · Maya", "4 أصناف · نقداً · الوردية #42 · مايا")}</div>
        <div class="flex gap-3" style="flex-wrap:wrap">
          <button class="btn btn-touch" style="flex:1;min-height:56px">${dirIcon("arrow-left", 18)}${T("Back", "رجوع")} <span class="kbd">Esc</span></button>
          <button class="btn btn-primary" style="flex:2;min-height:56px;font-size:17px">${T("Confirm and pay", "تأكيد ودفع")} <span class="num">$21.81</span> <span class="kbd" style="background:rgba(0,0,0,.12);color:var(--brand-contrast)">Enter</span></button>
        </div>
      </div>
    </div>
  </div>`,
  }

  // 03 — Products & lots
  const productRows = [
    [T("Almarai Laban 1 L", "لبن المراعي 1 ل"), "6281007030221", T("Dairy", "ألبان"), 1.85, 1.32, "29%", "27", "", T("2 lots · 1 expiring", "دفعتان · واحدة تنتهي")],
    [T("Pepsi 330 ml", "بيبسي 330 مل"), "5449000000996", T("Drinks", "مشروبات"), 0.6, 0.38, "37%", "214", "", T("3 lots", "3 دفعات")],
    [T("Picon Cheese 8 pcs", "جبنة بيكون 8 قطع"), "3073781024407", T("Dairy", "ألبان"), 2.4, 1.7, "29%", "41", "", T("2 lots", "دفعتان")],
    [T("Kitkat 4 finger", "كيت كات 4 أصابع"), "6294001820310", T("Snacks", "تسالي"), 0.75, 0.48, "36%", "6", "warn", T("1 lot", "دفعة")],
    [T("Bonjus Orange 1 L", "بونجوس برتقال 1 ل"), "5287000150013", T("Drinks", "مشروبات"), 1.1, 0.74, "33%", "0", "err", "—"],
    [T("Arabic bread", "خبز عربي"), "—", T("Bakery", "مخبوزات"), 0.95, 0.6, "37%", "60", "", T("untracked", "غير متتبَّع")],
  ]
  S["03-products-lots"] = {
    title: T("Stock — products & lots", "المخزون — المنتجات والدفعات"),
    body: shell({
      active: "stock", crumb: T("Stock", "المخزون"), page: T("Products", "المنتجات"),
      tabs: [["p", T("Products", "المنتجات"), "1,284"], ["l", T("Lots & counts", "الدفعات والجرد")], ["r", T("Receiving", "الاستلام")], ["s", T("Suppliers", "الموردون")]], activeTab: "p",
      actions: `<button class="btn btn-primary btn-sm">${icon("plus", 16)}${T("Add product", "إضافة منتج")}</button>`,
      capsuleHtml: capsule("warn", T("12 waiting to sync", "12 بانتظار المزامنة"), "cloud-upload"),
      content: `
      <div class="flex items-center gap-2" style="flex-wrap:wrap">
        <label class="field-row field" style="width:min(360px,100%)">${icon("search", 16, "var(--text-3)")}<span class="sr-only">${T("Search", "بحث")}</span><input style="flex:1;min-width:0;background:transparent;border:0;color:var(--text);font:inherit;outline:none" placeholder="${T("Search name, barcode or alias…", "ابحث بالاسم أو الباركود…")}"></label>
        ${[[T("All 1,284", "الكل 1,284"), "t-gold"], [T("Low stock 23", "مخزون قليل 23"), "t-warn"], [T("Expiring 9", "تنتهي 9"), "t-err"], [T("No barcode 14", "بلا باركود 14"), "t-mute"]].map(([f, t]) => `<button class="pill ${t}" style="min-height:32px;border:0">${f}</button>`).join("")}
      </div>
      <div class="cols-2">
        <div class="card scroll-x" style="overflow-y:hidden">
          <table class="tbl" style="min-width:640px"><thead><tr><th>${T("Product", "المنتج")}</th><th>${T("Category", "الفئة")}</th><th class="r">${T("Price", "السعر")}</th><th class="r">${T("Cost", "الكلفة")}</th><th class="r">${T("Margin", "الهامش")}</th><th class="r">${T("Stock", "المخزون")}</th><th class="r">${T("Lots", "الدفعات")}</th></tr></thead><tbody>
          ${productRows.map((r, i) => `<tr class="${i === 0 ? "sel" : ""}"><td><div class="font-semibold">${r[0]}</div><div class="cap num">${r[1]}</div></td><td style="color:var(--text-2)">${r[2]}</td><td class="r num">${usd(r[3])}</td><td class="r num" style="color:var(--text-2)">${usd(r[4])}</td><td class="r num" style="color:var(--text-2)">${r[5]}</td><td class="r">${r[7] ? `<span class="badge t-${r[7]} num">${r[6]}</span>` : `<span class="num">${r[6]}</span>`}</td><td class="r cap">${r[8]}</td></tr>`).join("")}
          </tbody></table>
        </div>
        <section class="card" style="box-shadow:var(--elev-3)" aria-labelledby="drawer-title">
          <div class="flex items-start gap-3" style="padding:16px 20px;border-bottom:1px solid var(--border)">
            <div style="flex:1;min-width:0"><h2 id="drawer-title" class="sub" style="margin:0">${T("Almarai Laban 1 L", "لبن المراعي 1 ل")}</h2><div class="cap num">6281007030221 · ${T("alias", "بديل")} 6281007030238 · ${T("Dairy", "ألبان")}</div></div>
            <button class="btn btn-ghost btn-sm" aria-label="${T("Close", "إغلاق")}">${icon("x", 16)}</button>
          </div>
          <div style="padding:16px 20px;display:flex;flex-direction:column;gap:14px">
            <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px">${[[T("On hand", "المتوفر"), "27"], [T("Reorder at", "إعادة الطلب عند"), "12"], [T("Avg cost", "متوسط الكلفة"), "$1.32"]].map(([k, v]) => `<div class="inset" style="padding:10px"><div class="cap">${k}</div><div class="num" style="font-size:22px;font-weight:600;line-height:30px">${v}</div></div>`).join("")}</div>
            <div class="flex items-center justify-between"><h3 class="sub" style="margin:0;font-size:15px">${T("Lots · first-expiry first", "الدفعات · الأقرب انتهاءً أولاً")}</h3><button class="btn btn-sm">${icon("package-plus", 14)}${T("Receive", "استلام")}</button></div>
            ${[["L-0812", T("received 02 Oct", "استُلمت 02 تشرين الأول"), T("exp 19 Oct · 3 days", "تنتهي 19 تشرين الأول · 3 أيام"), "err", 3, 24], ["L-0839", T("received 11 Oct", "استُلمت 11 تشرين الأول"), T("exp 08 Nov · 23 days", "تنتهي 08 تشرين الثاني · 23 يوماً"), "warn", 24, 24]].map(([id, r, e, t, left, init]) => `
            <div class="inset" style="padding:12px">
              <div class="flex items-center gap-2" style="flex-wrap:wrap"><span class="font-semibold num">${id}</span><span class="cap">${r}</span><span class="badge t-${t}" style="margin-inline-start:auto">${icon("calendar-clock", 12)}${e}</span></div>
              <div class="flex items-center gap-3 mt-2"><div style="flex:1;height:6px;border-radius:999px;background:var(--surface-3)" role="progressbar" aria-valuenow="${left}" aria-valuemax="${init}" aria-label="${id}"><div style="width:${(left / init) * 100}%;height:6px;border-radius:999px;background:var(--brand)"></div></div><span class="cap num">${T(`${left} of ${init} left`, `بقي ${left} من ${init}`)}</span></div>
            </div>`).join("")}
            <div class="banner t-info" style="font-size:13px">${icon("info", 16)}<span>${T("Stock matches lots and the movement ledger.", "المخزون مطابق للدفعات وسجل الحركات.")}</span></div>
            <div class="flex gap-2" style="flex-wrap:wrap"><button class="btn btn-sm">${icon("sliders-horizontal", 14)}${T("Adjust", "تعديل")}</button><button class="btn btn-sm">${icon("clipboard-check", 14)}${T("Count", "جرد")}</button><button class="btn btn-ghost btn-sm" style="margin-inline-start:auto">${icon("archive", 14)}${T("Archive", "أرشفة")}</button><button class="btn btn-primary btn-sm">${T("Save", "حفظ")}</button></div>
          </div>
        </section>
      </div>`,
    }),
  }

  // 04 — Receiving
  S["04-receiving"] = {
    title: T("Stock — receiving", "المخزون — الاستلام"),
    body: shell({
      active: "stock", crumb: T("Stock", "المخزون"), page: T("Receiving", "الاستلام"),
      tabs: [["p", T("Products", "المنتجات")], ["l", T("Lots & counts", "الدفعات والجرد")], ["r", T("Receiving", "الاستلام")], ["s", T("Suppliers", "الموردون")]], activeTab: "r",
      capsuleHtml: capsule("ok", T("Synced just now", "تمت المزامنة الآن")),
      content: `
      <div class="cols-side">
        <div class="card" style="overflow:hidden">
          <div class="flex items-center gap-3" style="padding:16px;flex-wrap:wrap">
            <label class="field-row field focus" style="flex:1;min-width:220px;min-height:48px;border-color:var(--brand-border)">${icon("scan-barcode", 20, "var(--brand)")}<span class="sr-only">${T("Scan items", "امسح الأصناف")}</span><input style="flex:1;min-width:0;background:transparent;border:0;color:var(--text);font:inherit;outline:none" placeholder="${T("Scan items into this delivery…", "امسح الأصناف في هذه الشحنة…")}"></label>
            <button class="btn">${icon("clipboard-paste", 16)}${T("Paste sheet", "لصق جدول")}</button>
          </div>
          <div class="scroll-x"><table class="tbl" style="min-width:720px"><thead><tr><th>${T("Item", "الصنف")}</th><th class="r">${T("Qty", "الكمية")}</th><th class="r">${T("Unit cost", "كلفة الوحدة")}</th><th class="r">${T("Sell price", "سعر البيع")}</th><th>${T("Lot", "الدفعة")}</th><th>${T("Expiry", "الانتهاء")}</th><th><span class="sr-only">${T("Remove", "إزالة")}</span></th></tr></thead><tbody>
          ${[[T("Almarai Laban 1 L", "لبن المراعي 1 ل"), T("matched · 6281007030221", "مطابق · 6281007030221"), "ok", "24", "$1.30", "$1.85", "L-0851", "09-11-2026"],
             [T("Picon Cheese 8 pcs", "جبنة بيكون 8 قطع"), T("matched", "مطابق"), "ok", "12", "$1.70", "$2.40", "L-0852", "15-01-2027"],
             [T("Unknown barcode 6291041500213", "باركود غير معروف 6291041500213"), T("new product or alias?", "منتج جديد أم بديل؟"), "warn", "6", "—", "—", "—", "—"],
             [T("Kitkat 4 finger", "كيت كات 4 أصابع"), T("cost +8% vs last delivery", "الكلفة +8% عن آخر شحنة"), "info", "48", "$0.52", "$0.80", "L-0853", "02-03-2027"]].map((r) => `
          <tr${r[2] === "warn" ? ' style="box-shadow:inset 3px 0 0 var(--warn)"' : ""}><td><div class="font-semibold">${r[0]}</div><span class="badge t-${r[2]}" style="margin-top:4px">${r[1]}</span></td><td class="r num">${r[3]}</td><td class="r num">${r[4]}</td><td class="r num">${r[5]}</td><td class="num">${r[6]}</td><td class="num">${r[7]}</td><td><button class="btn btn-ghost btn-sm" aria-label="${T("Remove row", "إزالة السطر")}">${icon("x", 14)}</button></td></tr>`).join("")}
          </tbody></table></div>
          <div class="flex items-center gap-2" style="padding:12px 16px;flex-wrap:wrap">
            <div class="banner t-warn" style="flex:1;min-width:240px;font-size:13px">${icon("circle-question-mark", 16)}<span>${T("1 row needs a decision before saving: link 6291041500213 to an existing product, or create a new one.", "سطر واحد يحتاج قراراً قبل الحفظ: اربط 6291041500213 بمنتج موجود أو أنشئ منتجاً جديداً.")}</span></div>
            <button class="btn btn-sm">${T("Link to product", "ربط بمنتج")}</button><button class="btn btn-sm">${T("Create new", "إنشاء جديد")}</button>
          </div>
        </div>
        <div class="stack">
          <div class="card" style="padding:16px;display:flex;flex-direction:column;gap:10px">
            <h2 class="sub" style="margin:0">${T("Supplier & invoice", "المورد والفاتورة")}</h2>
            <label><span class="label">${T("Supplier", "المورد")}</span><select class="field"><option>${T("Malia Group", "مجموعة ماليا")}</option></select></label>
            <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px"><label><span class="label">${T("Invoice", "الفاتورة")}</span><input class="field num" value="INV-77431"></label><label><span class="label">${T("Purchase order", "أمر الشراء")}</span><input class="field num" value="${T("PO-118 · partial", "PO-118 · جزئي")}"></label></div>
            <span class="label" style="margin:0">${T("Payment", "الدفع")}</span>
            <div class="seg" style="grid-template-columns:repeat(3,minmax(0,1fr))">${[T("On account", "على الحساب"), T("Cash", "نقداً"), T("Transfer", "تحويل")].map((m, i) => `<span class="${i === 0 ? "on" : ""}">${m}</span>`).join("")}</div>
            <div class="cap meta">${T("Adds $87.56 to Malia Group's balance. PO-118 already recorded $40.80 — only the difference is added.", "يضيف 87.56$ إلى رصيد مجموعة ماليا. سُجّل في PO-118 مبلغ 40.80$ — يُضاف الفرق فقط.")}</div>
          </div>
          <div class="card" style="padding:16px;display:flex;flex-direction:column;gap:8px">
            <h2 class="sub" style="margin:0">${T("Summary", "الملخص")}</h2>
            ${[[T("Ready rows", "أسطر جاهزة"), T("3 of 4", "3 من 4")], [T("Units", "الوحدات"), "84"], [T("Cost", "الكلفة"), "$87.56"], [T("Labels to print", "ملصقات للطباعة"), "84"]].map(([k, v]) => `<div class="flex justify-between"><span style="color:var(--text-2)">${k}</span><span class="num font-semibold">${v}</span></div>`).join("")}
            <button class="btn btn-primary" style="min-height:48px;margin-top:6px" disabled>${icon("check", 16)}${T("Save delivery", "حفظ الشحنة")}</button>
            <div class="cap meta">${T("Resolve 1 row to save. Rows stay here if you leave this page.", "حلّ سطراً واحداً للحفظ. تبقى الأسطر هنا إن غادرت الصفحة.")}</div>
          </div>
        </div>
      </div>`,
    }),
  }

  // 05 — Money › Today
  const bars = [42, 55, 38, 61, 70, 66, 48, 59, 73, 81, 64, 77, 88, 72]
  S["05-money-today"] = {
    title: T("Money — today", "المال — اليوم"),
    body: shell({
      active: "money", crumb: T("Money", "المال"), page: T("Today", "اليوم"),
      tabs: [["t", T("Today", "اليوم")], ["s", T("Shift & drawer", "الوردية والصندوق")], ["e", T("Expenses", "المصاريف")], ["c", T("Customers & debt", "الزبائن والديون")], ["r", T("Reports", "التقارير")]], activeTab: "t",
      actions: `<button class="btn btn-primary btn-sm">${icon("lock-keyhole", 16)}${T("Close the day", "إقفال اليوم")}</button>`,
      capsuleHtml: capsule("err", T("2 refunds need review", "مرتجعان بحاجة لمراجعة"), "octagon-alert"),
      banner: `<div class="banner t-err" role="alert">${icon("octagon-alert", 20)}<div class="grow"><div class="font-semibold" style="color:var(--text)">${T("2 refunds were rejected by the server", "رفض الخادم مرتجعَين")}</div><div class="cap" style="color:var(--text-2)">${T("Issued offline on Register 2, but another register had already refunded the same items. $32.40 left the drawer and is not on the server's books.", "صدرا دون اتصال على الصندوق 2 بينما أرجع صندوق آخر الأصناف نفسها. خرج 32.40$ من الصندوق وليس في دفاتر الخادم.")}</div></div><button class="btn btn-sm">${T("Review & settle", "مراجعة وتسوية")}</button></div>`,
      content: `
      <div class="kpis">${[[T("Net sales", "صافي المبيعات"), "$1,842.30", T("164.9M LBP", "164.9 مليون ل.ل"), "+12%", "ok"], [T("Gross profit", "إجمالي الربح"), "$486.10", T("26.4% margin", "هامش 26.4%"), "+4%", "ok"], [T("Cash in drawer", "النقد في الصندوق"), "$612.00", T("expected $618.50", "المتوقع 618.50$"), "−$6.50", "warn"], [T("Outstanding debt", "الديون المستحقة"), "$2,310.00", T("14 customers · 3 overdue", "14 زبوناً · 3 متأخرون"), "+$85", "err"]].map(([l, v, f, d, t]) => `
        <div class="card" style="padding:16px"><div class="flex items-center justify-between"><span class="cap">${l}</span><span class="badge t-${t} num">${d}</span></div><div class="stat num" style="margin-top:6px">${v}</div><div class="cap num meta">${f}</div></div>`).join("")}</div>
      <div class="cols-2b">
        <div class="card" style="padding:16px">
          <div class="flex items-center justify-between" style="flex-wrap:wrap;gap:8px"><h2 class="sub" style="margin:0">${T("Sales · last 14 days", "المبيعات · آخر 14 يوماً")}</h2><div class="flex gap-1">${[T("Day", "يوم"), T("Week", "أسبوع"), T("Month", "شهر")].map((x, i) => `<button class="pill ${i === 0 ? "t-gold" : "t-mute"}" style="border:0;min-height:28px">${x}</button>`).join("")}</div></div>
          <div style="height:200px;display:flex;align-items:flex-end;gap:8px;margin-top:16px;padding-bottom:4px;border-bottom:1px solid var(--border)" role="img" aria-label="${T("Daily sales bar chart, rising to today", "مخطط المبيعات اليومية")}">${bars.map((h, i) => `<div style="flex:1;height:${h * 2}px;border-radius:6px 6px 2px 2px;background:${i === bars.length - 1 ? "var(--brand)" : "var(--surface-3)"}"></div>`).join("")}</div>
          <div class="flex justify-between cap num meta" style="margin-top:8px"><span>${T("03 Oct", "03 تشرين الأول")}</span><span>${T("Today", "اليوم")}</span></div>
          <div class="flex gap-4 mt-4" style="flex-wrap:wrap">${[[T("Cash", "نقداً"), "68%", "#5CB894"], [T("Card", "بطاقة"), "14%", "#7D8CD9"], [T("Wallet", "محفظة"), "6%", "#A186C9"], [T("Debt", "دين"), "12%", "#C9A25C"]].map(([m, p, c]) => `<span class="flex items-center gap-2 cap"><span class="dot" style="background:${c}"></span>${m} <span class="num" style="color:var(--text)">${p}</span></span>`).join("")}</div>
        </div>
        <div class="card" style="padding:16px;display:flex;flex-direction:column;gap:10px">
          <h2 class="sub" style="margin:0">${T("Needs attention · by money at risk", "يحتاج انتباهاً · حسب المبلغ المعرّض")}</h2>
          ${[["octagon-alert", "err", T("2 rejected refunds", "مرتجعان مرفوضان"), T("$32.40 · settle before closing", "32.40$ · سوِّها قبل الإقفال")], ["hand-coins", "err", T("3 overdue customers", "3 زبائن متأخرون"), T("$940 over 60 days", "940$ لأكثر من 60 يوماً")], ["calendar-clock", "warn", T("9 lots expire this week", "9 دفعات تنتهي هذا الأسبوع"), T("$118 at cost", "118$ بسعر الكلفة")], ["wallet", "warn", T("Drawer short $6.50", "نقص في الصندوق 6.50$"), T("Shift #42 · Maya", "الوردية #42 · مايا")], ["package-search", "warn", T("23 products below reorder", "23 منتجاً تحت حد الطلب"), T("draft PO ready", "مسودة أمر شراء جاهزة")]].map(([ic, t, a, b]) => `
          <button class="inset flex items-center gap-3" style="padding:10px 12px;font:inherit;color:inherit;text-align:start;cursor:pointer"><span class="badge t-${t}" style="min-height:28px;width:28px;justify-content:center;padding:0">${icon(ic, 14)}</span><span style="flex:1"><span class="font-semibold" style="display:block">${a}</span><span class="cap num">${b}</span></span>${dirIcon("chevron-right", 16, "var(--text-3)")}</button>`).join("")}
        </div>
      </div>`,
    }),
  }

  // 06 — Admin › Devices & sync
  S["06-admin-devices-sync"] = {
    title: T("Admin — devices & sync", "الإدارة — الأجهزة والمزامنة"),
    body: shell({
      active: "admin", crumb: T("Admin", "الإدارة"), page: T("Devices & sync", "الأجهزة والمزامنة"),
      tabs: [["t", T("Team & permissions", "الفريق والصلاحيات")], ["s", T("Store settings", "إعدادات المتجر")], ["d", T("Devices & sync", "الأجهزة والمزامنة"), "3"], ["b", T("Backup & recovery", "النسخ والاستعادة")], ["a", T("About & updates", "حول والتحديثات")]], activeTab: "d",
      capsuleHtml: capsule("err", T("3 changes rejected", "3 تغييرات مرفوضة"), "file-x"),
      banner: `<div class="banner t-warn" role="status">${icon("badge-alert", 20)}<div class="grow"><div class="font-semibold" style="color:var(--text)">${T("Licence renewal due in 4 days", "تجديد الترخيص خلال 4 أيام")}</div><div class="cap" style="color:var(--text-2)">${T("After that this store becomes read-only: selling stops, but reports and exports keep working. Offline registers keep selling until their 7-day lease ends.", "بعدها يصبح المتجر للقراءة فقط: يتوقف البيع وتبقى التقارير والتصدير متاحة. تتابع الصناديق غير المتصلة البيع حتى انتهاء مهلة 7 أيام.")}</div></div><button class="btn btn-sm">${T("Renew", "تجديد")}</button></div>`,
      content: `
      <div class="cols-2b">
        <div class="stack">
          <div class="card" style="padding:16px">
            <div class="flex items-center justify-between" style="flex-wrap:wrap;gap:8px"><h2 class="sub" style="margin:0">${T("Sync queue", "قائمة المزامنة")}</h2><div class="flex gap-2"><button class="btn btn-sm">${icon("refresh-cw", 14)}${T("Sync now", "زامن الآن")}</button><button class="btn btn-sm">${icon("file-down", 14)}${T("Diagnostics", "تشخيص")}</button></div></div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-top:12px">${[[T("Waiting", "بانتظار"), "12", "warn"], [T("Retrying", "إعادة محاولة"), "1", "warn"], [T("Rejected", "مرفوضة"), "3", "err"], [T("Synced today", "زومنت اليوم"), "418", "ok"]].map(([l, v, t]) => `<div class="inset" style="padding:12px"><div class="cap">${l}</div><div class="num" style="font-size:22px;font-weight:600;line-height:30px;color:var(--${t})">${v}</div></div>`).join("")}</div>
          </div>
          <div class="card" style="overflow:hidden">
            <div class="flex items-center" style="padding:14px 16px;flex-wrap:wrap;gap:6px"><h2 class="sub" style="margin:0">${T("Rejected changes", "التغييرات المرفوضة")}</h2><span class="cap" style="margin-inline-start:auto">${T("Nothing here is deleted until it is resolved", "لا يُحذف شيء هنا قبل حلّه")}</span></div>
            ${[[T("Refund R-30412 · $18.40", "مرتجع R-30412 · 18.40$"), T("Already refunded on Register 1", "أُرجع مسبقاً على الصندوق 1"), true, T("Settle in Money", "سوِّه في المال")], [T("Refund R-30417 · $14.00", "مرتجع R-30417 · 14.00$"), T("Already refunded on Register 1", "أُرجع مسبقاً على الصندوق 1"), true, T("Settle in Money", "سوِّه في المال")], [T("Price update · Tide 3 kg", "تحديث سعر · تايد 3 كغ"), T("Product was archived on another device", "أُرشف المنتج على جهاز آخر"), false, T("Retry or discard", "إعادة أو تجاهل")]].map(([a, b, money, act]) => `
            <div class="flex items-center gap-3" style="padding:10px 16px;border-top:1px solid var(--border);flex-wrap:wrap">
              <span class="badge ${money ? "t-err" : "t-mute"}" style="min-height:28px;width:28px;justify-content:center;padding:0">${icon(money ? "hand-coins" : "file-x", 14)}</span>
              <div style="flex:1;min-width:200px"><div class="font-semibold num">${a}</div><div class="cap">${b}${money ? ` · <span style="color:var(--err)">${T("money already changed hands", "المال سُلِّم بالفعل")}</span>` : ""}</div></div>
              <button class="btn btn-sm">${act}</button></div>`).join("")}
          </div>
        </div>
        <div class="stack">
          <div class="card" style="padding:16px;display:flex;flex-direction:column;gap:10px">
            <h2 class="sub" style="margin:0">${T("This device", "هذا الجهاز")}</h2>
            <div class="seg" style="grid-template-columns:repeat(3,minmax(0,1fr))" role="radiogroup" aria-label="${T("Connection mode", "نمط الاتصال")}">${[T("Store hub", "خادم المتجر"), T("Connect to hub", "اتصال بالخادم"), T("Cloud", "السحابة")].map((m, i) => `<span role="radio" aria-checked="${i === 0}" class="${i === 0 ? "on" : ""}" style="font-size:13px">${m}</span>`).join("")}</div>
            ${[[T("Hub address", "عنوان الخادم"), "192.168.1.20:3015"], [T("LAN access", "الوصول المحلي"), T("On — 3 paired devices", "مفعّل — 3 أجهزة مقترنة")], [T("Cloud", "السحابة"), T("pos.titan-suite.net · reachable", "pos.titan-suite.net · متاحة")], [T("Last full pull", "آخر سحب كامل"), T("Today 07:58", "اليوم 07:58")]].map(([k, v]) => `<div class="flex justify-between gap-3" style="flex-wrap:wrap"><span style="color:var(--text-2)">${k}</span><span class="num font-semibold">${v}</span></div>`).join("")}
          </div>
          <div class="card" style="overflow:hidden">
            <div class="flex items-center" style="padding:14px 16px"><h2 class="sub" style="margin:0">${T("Paired devices", "الأجهزة المقترنة")}</h2><button class="btn btn-sm" style="margin-inline-start:auto">${icon("qr-code", 14)}${T("Pair a device", "إقران جهاز")}</button></div>
            ${[[T("Register 2", "الصندوق 2"), T("Last seen 2 min ago", "آخر ظهور منذ دقيقتين"), "ok", T("Online", "متصل")], [T("Maya's phone", "هاتف مايا"), T("Last seen 1 h ago", "آخر ظهور منذ ساعة"), "warn", T("Idle", "خامل")], [T("Driver · Ali", "السائق · علي"), T("Last seen yesterday", "آخر ظهور أمس"), "mute", T("Offline", "غير متصل")]].map(([n, s, t, l]) => `<div class="flex items-center gap-3" style="padding:8px 16px;border-top:1px solid var(--border)"><div style="flex:1"><div class="font-semibold">${n}</div><div class="cap">${s}</div></div><span class="badge t-${t}">${l}</span><button class="btn btn-ghost btn-sm" aria-label="${T("More", "المزيد")} ${n}">${icon("ellipsis", 16)}</button></div>`).join("")}
          </div>
        </div>
      </div>`,
    }),
  }

  // 07 — System states board
  const states = [
    ["1", "err", "lock", T("Read-only — contact support", "للقراءة فقط — تواصل مع الدعم"), T("Licence blocked. Selling and edits are off; reports and exports still work.", "الترخيص موقوف. البيع والتعديل متوقفان؛ التقارير والتصدير متاحة.")],
    ["2", "err", "hand-coins", T("2 refunds need review", "مرتجعان بحاجة لمراجعة"), T("Server rejected offline refunds. Never hidden; a manager settles each one.", "رفض الخادم مرتجعات دون اتصال. لا تُخفى أبداً؛ يسوّيها المدير.")],
    ["3", "err", "file-x", T("3 changes rejected", "3 تغييرات مرفوضة"), T("Other rejected operations. Review, retry or discard (never for money).", "عمليات مرفوضة أخرى. راجِع أو أعد أو تجاهل (ليس للمال).")],
    ["4", "info", "life-buoy", T("Recovered 1 interrupted refund", "استُعيد مرتجع متوقف"), T("Shown once after restart, with what happened.", "يظهر مرة بعد إعادة التشغيل مع ما حدث.")],
    ["5", "warn", "cloud-off", T("Offline — saved on this device", "غير متصل — محفوظ على هذا الجهاز"), T("Selling continues. Nothing blocks.", "البيع مستمر. لا شيء يتوقف.")],
    ["6", "warn", "cloud-upload", T("12 waiting to sync", "12 بانتظار المزامنة"), T("Counts only — pending is not an error.", "عدد فقط — الانتظار ليس خطأ.")],
    ["7", "warn", "badge-alert", T("Licence: 4 days left", "الترخيص: بقي 4 أيام"), T("Owner pages only, with a renew action.", "في صفحات المالك فقط مع زر تجديد.")],
    ["9", "ok", "check", T("Synced 2 min ago", "تمت المزامنة منذ دقيقتين"), T("Quiet: a dot, no colour wash.", "هادئ: نقطة فقط بلا تلوين.")],
  ]
  S["07-system-states"] = {
    title: T("System states", "حالات النظام"),
    body: `<div class="content" style="max-width:1440px;margin:0 auto">
  <div><div class="cap meta">${T("Design system v2 · §6", "نظام التصميم v2 · §6")}</div><h1 class="title" style="margin:0">${T("System states — one model everywhere", "حالات النظام — نموذج واحد في كل مكان")}</h1><p style="color:var(--text-2);margin:4px 0 0">${T("Status capsule (always visible) → inline banner (only when the page is affected) → row badge (on the exact item).", "كبسولة الحالة (ظاهرة دائماً) ← شريط تنبيه (عند تأثر الصفحة فقط) ← شارة على العنصر نفسه.")}</p></div>
  <div class="cols-2b">
    <div class="card scroll-x">
      <table class="tbl" style="min-width:560px"><thead><tr><th>${T("Priority", "الأولوية")}</th><th>${T("Capsule", "الكبسولة")}</th><th>${T("Behaviour", "السلوك")}</th></tr></thead><tbody>
      ${states.map(([p, t, ic, l, d]) => `<tr><td class="num cap">${p}</td><td><span class="pill t-${t}" style="min-height:32px;padding:0 12px">${t === "ok" ? `<span class="dot" style="background:var(--ok)"></span>` : icon(ic, 14)}${l}</span></td><td style="color:var(--text-2)">${d}</td></tr>`).join("")}
      <tr><td class="num cap">8</td><td><span class="pill t-warn" style="min-height:32px;padding:0 12px">${icon("clock", 14)}${T("Shift closed", "الوردية مغلقة")}</span></td><td style="color:var(--text-2)">${T("Lives on the shift chip, not the capsule. The register shows one action: Open shift.", "تظهر على شارة الوردية. يعرض الصندوق إجراءً واحداً: فتح وردية.")}</td></tr>
      </tbody></table>
    </div>
    <div class="stack">
      <div class="card" style="padding:16px;display:flex;flex-direction:column;gap:10px">
        <h2 class="sub" style="margin:0">${T("Inline banners", "أشرطة التنبيه")}</h2>
        <div class="banner t-err" role="alert">${icon("lock", 18)}<div class="grow"><div class="font-semibold" style="color:var(--text)">${T("This store is read-only", "هذا المتجر للقراءة فقط")}</div><div class="cap" style="color:var(--text-2)">${T("The licence has ended. You can still view reports and export data.", "انتهى الترخيص. لا يزال بإمكانك عرض التقارير وتصدير البيانات.")}</div></div><button class="btn btn-sm">${T("Contact support", "تواصل مع الدعم")}</button></div>
        <div class="banner t-info" role="status">${icon("life-buoy", 18)}<div class="grow"><div class="font-semibold" style="color:var(--text)">${T("Restoring this store's data…", "جارٍ استعادة بيانات المتجر…")}</div><div class="cap num" style="color:var(--text-2)">${T("Products 1,284 / 1,284 · Sales 3,912 / 8,040 · keep this window open", "المنتجات 1,284 / 1,284 · المبيعات 3,912 / 8,040 · أبقِ النافذة مفتوحة")}</div><div style="height:6px;border-radius:999px;background:var(--surface-3);margin-top:8px" role="progressbar" aria-valuenow="48" aria-valuemax="100" aria-label="${T("Restore progress", "تقدم الاستعادة")}"><div style="width:48%;height:6px;border-radius:999px;background:var(--info)"></div></div></div></div>
        <div class="banner t-warn" role="status">${icon("clock", 18)}<div class="grow"><div class="font-semibold" style="color:var(--text)">${T("Shift closed", "الوردية مغلقة")}</div><div class="cap" style="color:var(--text-2)">${T("Open a shift to sell or refund.", "افتح وردية للبيع أو الإرجاع.")}</div></div><button class="btn btn-primary btn-sm">${T("Open shift", "فتح وردية")}</button></div>
      </div>
      <div class="card" style="padding:16px;display:flex;flex-direction:column;gap:12px">
        <h2 class="sub" style="margin:0">${T("Permission", "الصلاحيات")}</h2>
        <div class="flex items-center gap-2" style="flex-wrap:wrap"><button class="btn btn-sm" disabled aria-describedby="perm-note">${icon("lock", 14)}${T("Refund", "إرجاع")}</button><span id="perm-note" class="cap">${T("Needs: Refunds — ask a manager", "يتطلب: صلاحية الإرجاع — اطلب من المدير")}</span></div>
        <div class="inset" style="padding:20px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:8px">
          <span class="badge t-mute" style="min-height:40px;width:40px;justify-content:center;padding:0;border-radius:12px">${icon("shield-off", 20)}</span>
          <div class="sub">${T("Accounting is for managers", "المحاسبة للمدراء")}</div>
          <div class="cap" style="max-width:320px">${T("This page needs the Accounting permission. Switch to a user who has it.", "تتطلب هذه الصفحة صلاحية المحاسبة. بدّل إلى مستخدم يملكها.")}</div>
          <button class="btn btn-primary btn-sm">${icon("users", 14)}${T("Switch user", "تبديل المستخدم")}</button>
        </div>
      </div>
      <div class="card" style="padding:16px;display:flex;flex-direction:column;gap:10px">
        <h2 class="sub" style="margin:0">${T("Empty & loading", "فارغ وجارٍ التحميل")}</h2>
        <div class="inset" style="padding:20px;text-align:center;border-style:dashed"><div class="font-semibold">${T("No receipts today", "لا إيصالات اليوم")}</div><div class="cap">${T("Sales you ring up appear here.", "تظهر هنا المبيعات التي تسجلها.")}</div></div>
        <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px" aria-hidden="true">${[1, 2, 3].map(() => `<div class="inset" style="height:64px;background:linear-gradient(90deg,var(--surface-2),var(--surface-3),var(--surface-2))"></div>`).join("")}</div>
      </div>
    </div>
  </div>
</div>`,
  }

  // 08 — Simple POS (scan → cart → pay → receipt)
  S["08-simple-pos"] = {
    title: T("Simple POS", "نقطة البيع المبسطة"),
    body: `${strip(capsule("warn", T("Offline · 3 waiting", "غير متصل · 3 بانتظار")), `<span class="pill t-gold hide-sm">${icon("zap", 14)}${T("Simple mode", "الوضع المبسط")}</span>`)}
  <div class="register simple">
    <section class="with-paybar" style="padding:24px;display:flex;flex-direction:column;gap:16px;min-width:0" aria-label="${T("Scan and cart", "المسح والسلة")}">
      <label class="field-row field focus" style="min-height:72px;border-radius:16px;border-color:var(--brand-border);padding:0 20px">${icon("scan-barcode", 28, "var(--brand)")}<span class="sr-only">${T("Scan", "امسح")}</span><input style="flex:1;min-width:0;background:transparent;border:0;color:var(--text);font:inherit;font-size:20px;outline:none" placeholder="${T("Scan the next item", "امسح الصنف التالي")}"></label>
      <div class="banner t-ok" role="status" style="font-size:15px">${icon("circle-check", 20)}<span><span class="font-semibold">${T("Pepsi 330 ml", "بيبسي 330 مل")}</span> × 6 · $3.60</span><button class="btn btn-sm" style="margin-inline-start:auto">${icon("rotate-ccw", 14)}${T("Undo", "تراجع")}</button></div>
      <div class="card" style="padding:4px 20px">${cartLines.map((l) => lineRow(l, true)).join("")}</div>
      <div class="flex gap-2 cap meta" style="flex-wrap:wrap"><span><span class="kbd">Enter</span> ${T("pay", "ادفع")}</span><span><span class="kbd">+</span>/<span class="kbd">−</span> ${T("quantity of last item", "كمية آخر صنف")}</span><span><span class="kbd">Del</span> ${T("remove last item", "حذف آخر صنف")}</span></div>
    </section>
    <aside class="rail" aria-label="${T("Payment", "الدفع")}" style="padding:24px;gap:16px">
      <div><div class="cap" style="font-size:13px">${T("Total due · 12 items", "المستحق · 12 صنفاً")}</div><div class="hero num">$21.81</div><div class="sub num" style="color:var(--text-2)">${lbp(1952000)}</div></div>
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">
        <button class="btn btn-touch" style="min-height:72px;flex-direction:column;gap:2px">${icon("banknote", 22)}<span>${T("Exact $", "بالضبط $")}</span><span class="cap num">$21.81</span></button>
        <button class="btn btn-touch" style="min-height:72px;flex-direction:column;gap:2px">${icon("banknote", 22)}<span>${T("Exact LBP", "بالضبط ل.ل")}</span><span class="cap num">1,955,000</span></button>
        <button class="btn btn-touch" style="min-height:72px;flex-direction:column;gap:2px">${icon("credit-card", 22)}<span>${T("Card", "بطاقة")}</span><span class="cap num">$21.81</span></button>
        <button class="btn btn-touch" style="min-height:72px;flex-direction:column;gap:2px">${icon("calculator", 22)}<span>${T("Other amount", "مبلغ آخر")}</span><span class="cap">${T("change calculated", "يُحسب الباقي")}</span></button>
      </div>
      <label class="flex items-center gap-3 inset" style="padding:12px 14px;cursor:pointer"><input type="checkbox" checked style="width:20px;height:20px;accent-color:var(--brand)"><span><span class="font-semibold" style="display:block">${T("Print receipt", "طباعة الإيصال")}</span><span class="cap">${T("80 mm · Arabic + English · both currencies", "80 مم · عربي + إنكليزي · بالعملتين")}</span></span></label>
      <button class="btn-pay hide-sm" style="margin-top:auto"><span>${T("Pay", "ادفع")}</span><span class="num">$21.81</span><span class="kbd" style="background:rgba(0,0,0,.12);color:var(--brand-contrast);border-color:rgba(0,0,0,.2)">Enter</span></button>
      <button class="btn btn-ghost btn-sm hide-sm" style="align-self:center">${icon("layout-grid", 14)}${T("Switch to full register", "التبديل إلى الصندوق الكامل")}</button>
    </aside>
  </div>
  <div class="paybar"><button class="btn-pay"><span>${T("Pay", "ادفع")}</span><span class="num">$21.81</span><span class="num cap" style="color:inherit">${lbp(1952000)}</span></button></div>`,
  }

  // 09 — Settings form (Admin › Store settings)
  const field = (label, value, opts = {}) => `<label style="display:block"><span class="label">${label}</span>${opts.select ? `<select class="field">${opts.select.map((o) => `<option${o === value ? " selected" : ""}>${o}</option>`).join("")}</select>` : `<input class="field${opts.num ? " num" : ""}${opts.error ? " invalid" : ""}" value="${value}"${opts.dir ? ` dir="${opts.dir}"` : ""}${opts.error ? ` aria-invalid="true" aria-describedby="${opts.id}-err"` : ""}>`}${opts.help ? `<span class="help" style="display:block">${opts.help}</span>` : ""}${opts.error ? `<span id="${opts.id}-err" class="error">${icon("circle-alert", 14)}${opts.error}</span>` : ""}</label>`
  S["09-settings-form"] = {
    title: T("Admin — store settings", "الإدارة — إعدادات المتجر"),
    body: shell({
      active: "admin", crumb: T("Admin", "الإدارة"), page: T("Store settings", "إعدادات المتجر"),
      tabs: [["t", T("Team & permissions", "الفريق والصلاحيات")], ["s", T("Store settings", "إعدادات المتجر")], ["d", T("Devices & sync", "الأجهزة والمزامنة")], ["b", T("Backup & recovery", "النسخ والاستعادة")], ["a", T("About & updates", "حول والتحديثات")]], activeTab: "s",
      capsuleHtml: capsule("ok", T("Synced 1 min ago", "تمت المزامنة منذ دقيقة")),
      content: `
      <form class="cols-side" onsubmit="return false" aria-label="${T("Store settings", "إعدادات المتجر")}">
        <div class="stack">
          <section class="card" style="padding:20px;display:flex;flex-direction:column;gap:14px" aria-labelledby="sec-profile">
            <div><h2 id="sec-profile" class="sub" style="margin:0">${T("Store profile", "ملف المتجر")}</h2><p class="cap" style="margin:2px 0 0">${T("Printed on receipts and shown on the login screen.", "يُطبع على الإيصالات ويظهر في شاشة الدخول.")}</p></div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px">
              ${field(T("Store name (English)", "اسم المتجر (إنكليزي)"), "Fakih Market", { dir: "ltr" })}
              ${field(T("Store name (Arabic)", "اسم المتجر (عربي)"), "سوبرماركت فقيه", { dir: "rtl" })}
              ${field(T("Branch", "الفرع"), T("Hamra", "الحمرا"))}
              ${field(T("Phone", "الهاتف"), "+961 1 345 678", { num: true, dir: "ltr" })}
            </div>
          </section>
          <section class="card" style="padding:20px;display:flex;flex-direction:column;gap:14px" aria-labelledby="sec-money">
            <div><h2 id="sec-money" class="sub" style="margin:0">${T("Money & tax", "المال والضرائب")}</h2><p class="cap" style="margin:2px 0 0">${T("Changes apply to new sales only. Past receipts keep their original rate.", "تُطبق التغييرات على المبيعات الجديدة فقط. تحتفظ الإيصالات السابقة بسعرها الأصلي.")}</p></div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px">
              ${field(T("Exchange rate (LBP per $1)", "سعر الصرف (ل.ل لكل 1$)"), "89,500", { num: true, dir: "ltr", help: T("Last changed 14 Oct by Rami · 89,700 before", "آخر تغيير 14 تشرين الأول بواسطة رامي · كان 89,700") })}
              ${field(T("VAT rate (%)", "نسبة الضريبة (%)"), "110", { num: true, dir: "ltr", id: "vat", error: T("VAT must be between 0 and 30%.", "يجب أن تكون الضريبة بين 0 و30%.") })}
              ${field(T("Cash rounding (LBP)", "تدوير النقد (ل.ل)"), T("Up to nearest 5,000", "للأعلى إلى أقرب 5,000"), { select: [T("Up to nearest 5,000", "للأعلى إلى أقرب 5,000"), T("Up to nearest 1,000", "للأعلى إلى أقرب 1,000"), T("No rounding", "بدون تدوير")] })}
              ${field(T("Prices entered in", "إدخال الأسعار بـ"), T("USD", "الدولار"), { select: [T("USD", "الدولار"), T("LBP", "الليرة")] })}
            </div>
          </section>
          <section class="card" style="padding:20px;display:flex;flex-direction:column;gap:14px" aria-labelledby="sec-receipt">
            <div><h2 id="sec-receipt" class="sub" style="margin:0">${T("Receipt & printer", "الإيصال والطابعة")}</h2></div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px">
              ${field(T("Printer", "الطابعة"), "Xprinter XP-80C", { select: ["Xprinter XP-80C", T("Browser print", "طباعة المتصفح")] })}
              ${field(T("Paper width", "عرض الورق"), "80 mm", { select: ["80 mm", "58 mm"] })}
              ${field(T("Footer (English)", "التذييل (إنكليزي)"), "Thank you — exchanges within 7 days", { dir: "ltr" })}
              ${field(T("Footer (Arabic)", "التذييل (عربي)"), "شكراً لزيارتكم — الاستبدال خلال 7 أيام", { dir: "rtl" })}
            </div>
            <div class="flex gap-6" style="flex-wrap:wrap">${[[T("Show both currencies", "إظهار العملتين"), true], [T("Print cash-rounding line", "طباعة سطر التدوير"), true], [T("Open drawer on cash sale", "فتح الدرج عند البيع النقدي"), false]].map(([l, on]) => `<label class="flex items-center gap-2" style="cursor:pointer;min-height:44px"><input type="checkbox"${on ? " checked" : ""} style="width:20px;height:20px;accent-color:var(--brand)"><span>${l}</span></label>`).join("")}</div>
            <div class="flex gap-2"><button class="btn btn-sm" type="button">${icon("printer", 14)}${T("Print test receipt", "طباعة إيصال تجريبي")}</button></div>
          </section>
        </div>
        <div class="stack">
          <div class="card" style="padding:16px;display:flex;flex-direction:column;gap:10px">
            <h2 class="sub" style="margin:0">${T("Receipt preview", "معاينة الإيصال")}</h2>
            <div style="background:#fff;color:#111;border-radius:6px;padding:14px;font-size:12px;line-height:17px;font-family:'Inter','IBM Plex Sans Arabic',sans-serif;box-shadow:var(--elev-1)" aria-label="${T("Receipt preview", "معاينة الإيصال")}">
              <div style="text-align:center;font-weight:700">Fakih Market · سوبرماركت فقيه</div>
              <div style="text-align:center;color:#555">Hamra · +961 1 345 678</div>
              <div style="border-top:1px dashed #999;margin:8px 0"></div>
              <div class="flex justify-between"><span>Pepsi 330 ml × 6</span><span class="num">$3.60</span></div>
              <div class="flex justify-between"><span>Ariel Pods 22</span><span class="num">$9.50</span></div>
              <div style="border-top:1px dashed #999;margin:8px 0"></div>
              <div class="flex justify-between" style="font-weight:700"><span>Total · المجموع</span><span class="num">$21.81</span></div>
              <div class="flex justify-between"><span>LBP @ 89,500</span><span class="num">1,952,000</span></div>
              <div class="flex justify-between" style="color:#555"><span>Cash payable · مدوّر</span><span class="num">1,955,000</span></div>
              <div style="text-align:center;margin-top:8px;color:#555">Thank you — exchanges within 7 days<br>شكراً لزيارتكم — الاستبدال خلال 7 أيام</div>
            </div>
          </div>
          <div class="card" style="padding:16px;display:flex;flex-direction:column;gap:6px">
            <h2 class="sub" style="margin:0">${T("Who can change this", "من يمكنه التعديل")}</h2>
            <div class="cap">${T("Owners and staff with Store settings permission. Every change is saved to the audit log and synced to all registers.", "المالكون والموظفون الذين لديهم صلاحية الإعدادات. يُحفظ كل تغيير في سجل التدقيق ويُزامن مع كل الصناديق.")}</div>
          </div>
        </div>
        <div class="card" style="grid-column:1/-1;position:sticky;bottom:12px;padding:12px 16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;box-shadow:var(--elev-3)" role="region" aria-label="${T("Unsaved changes", "تغييرات غير محفوظة")}">
          <span class="badge t-warn">${icon("circle-dot", 12)}${T("3 unsaved changes", "3 تغييرات غير محفوظة")}</span>
          <span class="cap">${T("Fix 1 error before saving.", "صحّح خطأً واحداً قبل الحفظ.")}</span>
          <span style="margin-inline-start:auto" class="flex gap-2"><button class="btn btn-sm" type="button">${T("Discard", "تجاهل")}</button><button class="btn btn-primary btn-sm" type="submit" disabled>${T("Save changes", "حفظ التغييرات")}</button></span>
        </div>
      </form>`,
    }),
  }
  return S
}

// ── Assets (offline kit) ───────────────────────────────────────────────────
function buildAssets(htmlFiles) {
  fs.mkdirSync(path.join(ASSETS, "fonts"), { recursive: true })
  const desktop = path.join(REPO, "apps/desktop/node_modules/@fontsource")
  const faces = []
  for (const w of [400, 500, 600, 700]) {
    fs.copyFileSync(path.join(desktop, `inter/files/inter-latin-${w}-normal.woff2`), path.join(ASSETS, "fonts", `inter-latin-${w}.woff2`))
    fs.copyFileSync(path.join(desktop, `ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-${w}-normal.woff2`), path.join(ASSETS, "fonts", `plex-arabic-${w}.woff2`))
    faces.push(`@font-face{font-family:"Inter";font-style:normal;font-weight:${w};font-display:swap;src:url(fonts/inter-latin-${w}.woff2) format("woff2")}`)
    faces.push(`@font-face{font-family:"IBM Plex Sans Arabic";font-style:normal;font-weight:${w};font-display:swap;src:url(fonts/plex-arabic-${w}.woff2) format("woff2")}`)
  }
  fs.writeFileSync(path.join(ASSETS, "fonts.css"), `/* Inter + IBM Plex Sans Arabic (OFL-1.1), bundled for offline use */\n${faces.join("\n")}\n`)
  fs.copyFileSync(path.join(REPO, "apps/desktop/public/titan-logo.png"), path.join(ASSETS, "titan-logo.png"))
  // Tailwind utilities actually used by the prototypes, compiled locally.
  const nodeDir = path.join(pnpm, fs.readdirSync(pnpm).find((d) => d.startsWith("@tailwindcss+node@")), "node_modules/@tailwindcss/node")
  const oxideDir = path.join(pnpm, fs.readdirSync(pnpm).find((d) => d.startsWith("@tailwindcss+oxide@")), "node_modules/@tailwindcss/oxide")
  const { compile } = require(path.join(nodeDir, "dist/index.js"))
  const { Scanner } = require(path.join(oxideDir, "index.js"))
  return (async () => {
    // theme (spacing / weight scales) + utilities; no preflight, so token CSS is untouched
    const compiler = await compile(`@import "tailwindcss/theme";
@import "tailwindcss/utilities";`, { base: path.join(REPO, "apps/desktop"), onDependency: () => {} })
    const scanner = new Scanner({})
    // Pass contents (file paths are not read reliably on Windows by the scanner).
    const candidates = scanner.scanFiles(htmlFiles.map((file) => ({ content: fs.readFileSync(file, "utf8"), extension: "html" })))
    fs.writeFileSync(path.join(ASSETS, "tailwind.css"), compiler.build(candidates))
  })()
}

// ── Build ──────────────────────────────────────────────────────────────────
const written = []
for (const lang of ["en", "ar"]) {
  for (const [name, screen] of Object.entries(makeScreens(lang))) {
    const file = path.join(OUT, `${name}${lang === "ar" ? ".ar" : ""}.html`)
    fs.writeFileSync(file, doc({ title: screen.title, lang, body: screen.body }))
    written.push(file)
  }
}
const done = MODE === "offline" ? buildAssets(written) : Promise.resolve()
done.then(() => console.log(`${MODE}: ${written.length} screens → ${path.relative(REPO, OUT)}`)).catch((e) => { console.error(e); process.exit(1) })
