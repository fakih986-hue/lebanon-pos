// Builds docs/design/qa/stock-review.html: Products, the lot drawer and Receiving for visual
// review (desktop and Arabic/phone), plus the receiving recovery and payment states.
// Images are embedded, so the page opens anywhere (also as a static snapshot).
// Capture first: QA_STOCK=1 node docs/design/qa-app.cjs docs/design/qa/stock-after
const fs = require("fs")
const path = require("path")
const dir = path.resolve(__dirname, "qa")
const rows = [
  ["Products", "English, dark: views with counts, filters, sortable table", "products.en.dark.desktop", "Phone, Arabic, dark", "products.ar.dark.mobile"],
  ["Products (Arabic)", "Arabic, light, right-to-left", "products.ar.light.desktop", "Phone, English", "products.en.dark.mobile"],
  ["Product drawer: edit", "Edit Pepsi Can from its details: name, category, supplier, barcode + aliases, price/cost with margin, reorder; stock changes only through receiving, sales and adjustments", "products-edit.en.dark.desktop", "Phone, Arabic: full-height sheet, Save/Cancel pinned", "products-edit.ar.dark.mobile"],
  ["Product drawer: create", "Add product, Save with nothing filled: focus goes to the first problem, each field says what is missing", "products-editor.en.dark.desktop", "", null],
  ["Product details", "Pepsi Can: lots, actions (Edit, Receive, Adjust or count, Archive)", "products-detail.en.dark.desktop", "", null],
  ["Lot details", "Expiry, stock tiles, movement trace (received, then a damaged-stock adjustment)", "lot-drawer.en.dark.desktop", "Phone, Arabic: the reference sits under the movement type", "lot-drawer.ar.dark.mobile"],
  ["Lot details (Arabic)", "Arabic, light, right-to-left", "lot-drawer.ar.light.desktop", "", null],
  ["Receiving", "Empty delivery: scan bar, rows, supplier and payment, summary", "receiving.en.dark.desktop", "Phone, English", "receiving.en.dark.mobile"],
  ["Receiving (Arabic)", "Arabic, dark", "receiving.ar.dark.desktop", "", null],
  ["Receiving: rows that need attention", "Two scans merged (qty 2), an unknown code waiting for a decision; Save went to that row", "receiving-problems.en.dark.desktop", "Phone, Arabic, light", "receiving-problems.ar.light.mobile"],
  ["Receiving: saved before a crash", "Reopened after the app closed mid-save: the received row is removed and the page says so", "receiving-recovered.en.dark.desktop", "", null],
  ["Receiving: payment failed", "Saved through the page with the payment write failing: stock, purchase order and payment shown separately; the PO stays unpaid with Retry payment", "receiving-ui-payment-failed.en.dark.desktop", "Phone, Arabic", "receiving-ui-payment-failed.ar.dark.mobile"],
  ["Receiving: payment retried", "Retry payment pressed: the result stays on the page (“PO-… is recorded and settled”) until dismissed, no toast", "receiving-payment-retried.en.dark.desktop", "", null],
  ["Temporary messages", "A toast (here: Print labels with pop-ups blocked) now takes its own strip under the page instead of floating over it; Clear delivery and the header stay clear. Save and payment outcomes are inline only", "receiving-toast.en.dark.desktop", "Phone, Arabic: the strip sits above the bottom navigation; nothing underneath", "receiving-toast.ar.dark.mobile"],
  ["Receiving: interrupted save", "The lots failed to write after stock was written: rows kept and marked, Save blocked", "receiving-unknown.en.dark.desktop", "Phone, Arabic", "receiving-unknown.ar.dark.mobile"],
  ["Review what was saved", "Effects found per row (stock before/now/expected, lot, movement), purchase order, payment, sync operations; Complete / Undo / Close by hand", "receiving-review.en.dark.desktop", "Phone, Arabic", "receiving-review.ar.dark.mobile"],
  ["Review: repair not safe", "Three Pepsi sold from a lot whose receive was never sent: Complete and Undo refused with the reason; Close by hand remains", "receiving-review-blocked.en.dark.desktop", "", null],
  ["Review: permission", "A user who may receive but not adjust stock: Complete allowed, Undo and Close by hand need inventory.adjust", "receiving-review-receiver.en.dark.desktop", "", null],
  ["Review: completed", "After Complete: one lot of 6, one purchase order, one payment; stock not added twice", "receiving-review-completed.en.dark.desktop", "", null],
]
const fig = (name, caption, w) => name && fs.existsSync(path.join(dir, "stock-after", `${name}.png`))
  ? `<figure style="max-width:${w}px"><figcaption>${caption}</figcaption><img src="data:image/png;base64,${fs.readFileSync(path.join(dir, "stock-after", `${name}.png`)).toString("base64")}" alt="${name}"></figure>` : ""
const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Stock workspace review</title>
<style>body{font-family:system-ui;background:#0B0E14;color:#F4F6FA;margin:24px}h1{font-size:20px;margin:0 0 4px}p.lead{color:#9AA4B8;font-size:14px;margin:0 0 20px;max-width:900px}h2{font-size:16px;margin:28px 0 10px}.row{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap}figure{margin:0;background:#12161F;border:1px solid #1E2430;border-radius:10px;padding:8px;flex:1 1 auto}figcaption{font-size:12px;color:#9AA4B8;margin-bottom:6px}img{width:100%;border-radius:6px;display:block}</style></head><body>
<h1>Stock workspace: Products, Lots, Receiving</h1><p class="lead">Running app (Vite dev server, local dev mode, demo catalogue with a seeded delivery from Malia Group: Pepsi expiring in 5 days, Labneh in 20, Chips expired). Each capture is a fresh browser profile at its own size: desktop 1440×900, phone 390×844.</p>
${rows.map(([title, dCap, d, mCap, m]) => `<h2>${title}</h2><div class="row">${fig(d, "Desktop · " + dCap, 960)}${fig(m, mCap, 300)}</div>`).join("\n")}
</body></html>`
fs.writeFileSync(path.join(dir, "stock-review.html"), html)
console.log("wrote", path.join(dir, "stock-review.html"))
