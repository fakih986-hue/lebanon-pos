// Builds docs/design/qa/review.html: the register slice for visual review
// (Full POS, Simple POS, payment review, receipt; desktop and mobile).
// Capture first: QA_REVIEW=1 node docs/design/qa-app.cjs docs/design/qa/review
const fs = require("fs")
const path = require("path")
const dir = path.resolve(__dirname, "qa")
const rows = [
  ["Full POS", "Grid, cart rail, cash tender ($20 + 200,000 LBP)", "review-full-pos.en.dark.desktop", "Phone: grid with the fixed pay bar; cart in a sheet", "review-full-pos.en.dark.mobile"],
  ["Full POS: cart", "Arabic, light, right-to-left", "review-full-pos.ar.light.desktop", "Phone: cart sheet with the tender", "review-cart-sheet.en.dark.mobile"],
  ["Simple POS", "Full-screen scan and cart, large tender", "review-simple-pos.en.dark.desktop", "Phone", "review-simple-pos.en.dark.mobile"],
  ["Payment review", "Amount due, paid, change in the currency handed back", "review-payment.en.dark.desktop", "Phone", "review-payment.en.dark.mobile"],
  ["Simple POS: review opens above it", "Simple POS stays mounted (inert) behind the dialog", "review-simple-review.en.dark.desktop", "Phone", "review-simple-review.en.dark.mobile"],
  ["Simple POS header at 360 px (Arabic)", "", null, "Clear sale fits as an icon button with its name", "review-simple-header.ar.dark.mobile-360"],
  ["Clear sale confirmation in Simple POS", "", null, "Phone, Arabic: the confirmation is on top (it was hidden behind Simple POS)", "five-clear.ar.dark.mobile"],
  ["One latest-sale panel", "", null, "Phone, after two sales: one row, replaced, with Sales history", "review-latest-sale.en.dark.mobile"],
  ["Payment review (Arabic)", "", null, "Phone, light, right-to-left", "review-payment.ar.light.mobile"],
  ["Receipt", "Sale complete panel (does not take focus)", "review-receipt.en.dark.desktop", "Phone", "review-receipt.en.dark.mobile"],
  ["Printed receipt", "80 mm, from the register's Print receipt", "review-printed-receipt.en.desktop", "", null],
  ["Printed receipt: fit check, 80 mm roll", "Register and reprint at 72 mm printable, margin 2 and 0 mm; long English and Arabic names, large totals, rounding lines", "receipt-fit-80.desktop", "", null],
  ["Printed receipt: fit check, 58 mm roll", "48 mm printable, margin 2 and 4 mm (browser render; confirm on the physical printer with Settings › Print test receipt)", "receipt-fit-58.desktop", "", null],
  ["Payment review: Pay bar", "", null, "Phone: Pay bar hidden and inert while review is open", "pay-bar-hidden.en.dark.mobile"],
]
const fig = (name, caption, w) => name && fs.existsSync(path.join(dir, "review", `${name}.png`))
  ? `<figure style="max-width:${w}px"><figcaption>${caption}</figcaption><img src="review/${name}.png" alt="${name}"></figure>` : ""
const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Register slice: visual review</title>
<style>body{font-family:system-ui;background:#0B0E14;color:#F4F6FA;margin:24px}h1{font-size:20px;margin:0 0 4px}p.lead{color:#9AA4B8;font-size:14px;margin:0 0 20px}h2{font-size:16px;margin:28px 0 10px}.row{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap}figure{margin:0;background:#12161F;border:1px solid #1E2430;border-radius:10px;padding:8px;flex:1 1 auto}figcaption{font-size:12px;color:#9AA4B8;margin-bottom:6px}img{width:100%;border-radius:6px;display:block}</style></head><body>
<h1>Register slice: visual review</h1><p class="lead">Running app (Vite dev server, local dev mode, demo catalogue). Each capture is a fresh browser profile at its own size from the first paint: desktop 1440×900, phone 390×844. Same sale throughout: $6.72, paid $20 + 200,000 LBP.</p>
${rows.map(([title, dCap, d, mCap, m]) => `<h2>${title}</h2><div class="row">${fig(d, "Desktop · " + dCap, 960)}${fig(m, mCap, 300)}</div>`).join("\n")}
</body></html>`
fs.writeFileSync(path.join(dir, "review.html"), html)
console.log("review.html written")
