// Builds docs/design/qa/stock-review.html: Products, the lot drawer and Receiving for visual
// review (desktop and Arabic/phone), plus the receiving recovery states.
// Capture first: QA_STOCK=1 node docs/design/qa-app.cjs docs/design/qa/stock-after
const fs = require("fs")
const path = require("path")
const dir = path.resolve(__dirname, "qa")
const rows = [
  ["Products", "English, dark: views with counts, filters, sortable table", "products.en.dark.desktop", "Phone, Arabic, dark", "products.ar.dark.mobile"],
  ["Products (Arabic)", "Arabic, light, right-to-left", "products.ar.light.desktop", "Phone, English", "products.en.dark.mobile"],
  ["Lot details", "Expiry, stock tiles, movement trace (received, then a damaged-stock adjustment)", "lot-drawer.en.dark.desktop", "Phone, Arabic: the reference sits under the movement type", "lot-drawer.ar.dark.mobile"],
  ["Lot details (Arabic)", "Arabic, light, right-to-left", "lot-drawer.ar.light.desktop", "", null],
  ["Receiving", "Empty delivery: scan bar, rows, supplier and payment, summary", "receiving.en.dark.desktop", "Phone, English", "receiving.en.dark.mobile"],
  ["Receiving (Arabic)", "Arabic, dark", "receiving.ar.dark.desktop", "", null],
  ["Receiving: rows that need attention", "Two scans merged (qty 2), an unknown code waiting for a decision; Save went to that row", "receiving-problems.en.dark.desktop", "Phone, Arabic, light", "receiving-problems.ar.light.mobile"],
  ["Receiving: saved before a crash", "Reopened after the app closed mid-save: the received row is removed and the page says so", "receiving-recovered.en.dark.desktop", "", null],
  ["Receiving: interrupted save", "Outcome unknown: rows kept and marked, Save blocked until someone checks Lots and decides", "receiving-unknown.en.dark.desktop", "Phone, Arabic", "receiving-unknown.ar.dark.mobile"],
]
const fig = (name, caption, w) => name && fs.existsSync(path.join(dir, "stock-after", `${name}.png`))
  ? `<figure style="max-width:${w}px"><figcaption>${caption}</figcaption><img src="stock-after/${name}.png" alt="${name}"></figure>` : ""
const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Stock workspace review</title>
<style>body{font-family:system-ui;background:#0B0E14;color:#F4F6FA;margin:24px}h1{font-size:20px;margin:0 0 4px}p.lead{color:#9AA4B8;font-size:14px;margin:0 0 20px;max-width:900px}h2{font-size:16px;margin:28px 0 10px}.row{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap}figure{margin:0;background:#12161F;border:1px solid #1E2430;border-radius:10px;padding:8px;flex:1 1 auto}figcaption{font-size:12px;color:#9AA4B8;margin-bottom:6px}img{width:100%;border-radius:6px;display:block}</style></head><body>
<h1>Stock workspace: Products, Lots, Receiving</h1><p class="lead">Running app (Vite dev server, local dev mode, demo catalogue with a seeded delivery from Malia Group: Pepsi expiring in 5 days, Labneh in 20, Chips expired). Each capture is a fresh browser profile at its own size: desktop 1440×900, phone 390×844.</p>
${rows.map(([title, dCap, d, mCap, m]) => `<h2>${title}</h2><div class="row">${fig(d, "Desktop · " + dCap, 960)}${fig(m, mCap, 300)}</div>`).join("\n")}
</body></html>`
fs.writeFileSync(path.join(dir, "stock-review.html"), html)
console.log("wrote", path.join(dir, "stock-review.html"))
