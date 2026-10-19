// Builds docs/design/qa/accounts-review.html: Customers, Suppliers and Receipts for visual review
// (desktop and Arabic/phone), with payment, statement, return, permission, empty and error states.
// Images are embedded, so the page opens anywhere (also as a static snapshot).
// Capture first: QA_ACCT=1 node docs/design/qa-app.cjs docs/design/qa/accounts-after
const fs = require("fs")
const path = require("path")
const dir = path.resolve(__dirname, "qa")
const sections = [
  ["Customers", [
    ["Customers", "English, dark: stat tiles, views with counts, owed-by-age chips, table with credit-limit use and overdue badges", "customers.en.dark.desktop", "Phone, Arabic: one card per customer", "customers.ar.dark.mobile"],
    ["Customers (light)", "English, light", "customers.en.light.desktop", "", null],
    ["Customer details", "Balance, sold on account, paid, oldest unpaid; credit limit; owed by age; reminders and statement; running-balance statement", "customers-detail.en.dark.desktop", "Phone, Arabic, light", "customers-detail.ar.light.mobile"],
    ["Payment history", "The same drawer, Payments: date, method, reference, amount", "customers-payments.en.dark.desktop", "", null],
    ["Receive payment: more than is owed", "$300 against $107.50: the field says so and offers “Record $107.50 instead”; nothing is recorded", "customers-pay-over.en.dark.desktop", "Phone, Arabic: entering a payment", "customers-pay.ar.dark.mobile"],
    ["Receive payment: recorded", "$40 from Rami Khoury: the result stays on the page and the details reopen with the new balance", "customers-paid.en.dark.desktop", "", null],
    ["Receive payment: storage full", "The device could not save the change for sync: nothing was recorded or sent, and the drawer says so (code on the last line)", "customers-pay-failed.en.dark.desktop", "", null],
    ["Add customer", "Save with nothing filled: focus goes to the first problem; each field says what is missing", "customers-editor.en.dark.desktop", "", null],
    ["Archived", "Archived customers are listed again and can be restored; Delete appears only for a customer with no sales on account or payments", "customers-archived.en.dark.desktop", "", null],
    ["No customers yet", "Empty state with one action", "customers-empty.en.dark.desktop", "", null],
  ]],
  ["Suppliers", [
    ["Supplier accounts", "Tabs Accounts / Purchase orders; what you owe first", "suppliers.en.dark.desktop", "Phone: low-priority columns drop out", "suppliers.en.dark.mobile"],
    ["Supplier accounts (Arabic)", "Arabic, light, right-to-left", "suppliers.ar.light.desktop", "", null],
    ["Supplier details", "Owed, purchases, paid; contact; open purchase orders, each with its own Pay; statement with what you owe after each line", "suppliers-detail.en.dark.desktop", "", null],
    ["Edit supplier", "Same supplier, new details: name, mobile, contact, address, notes. Orders and payments keep the name they were recorded under", "suppliers-edit.en.dark.desktop", "Phone, Arabic", "suppliers-edit.ar.dark.mobile"],
    ["Edit supplier: saved", "After Save: the new name and details, the same balance ($181.20), the same orders and statement", "suppliers-edited.en.dark.desktop", "", null],
    ["Purchase orders", "Filter by payment status; owed per order", "suppliers-orders.en.dark.desktop", "Phone, Arabic", "suppliers-orders.ar.dark.mobile"],
    ["Purchase order", "Lines, totals, supplier invoice no., payments against it", "suppliers-order.en.dark.desktop", "", null],
    ["Pay supplier", "Against one purchase order (or the balance, oldest first); never more than is owed", "suppliers-pay.en.dark.desktop", "Phone, Arabic", "suppliers-pay.ar.dark.mobile"],
    ["No purchase orders yet", "Empty state: orders come from Receiving", "suppliers-empty.en.dark.desktop", "", null],
  ]],
  ["Receipts", [
    ["Receipts", "Today's tiles (USD and LBP), search, payment, cashier, sort, period, status with counts; refunded, voided and cash-rounded receipts marked", "receipts.en.dark.desktop", "Phone, Arabic: one card per receipt", "receipts.ar.dark.mobile"],
    ["Grouped by day", "English, light", "receipts-grouped.en.light.desktop", "", null],
    ["Receipt with a refund", "Lines (returned quantities), totals, LBP at the sale's own rate, tender and change, the refund itself", "receipts-detail.en.dark.desktop", "Phone, Arabic, light: a cash-rounded sale (payable 335,000 LBP)", "receipts-detail.ar.light.mobile"],
    ["Return items", "Quantity per line, capped at what can still be returned; refund amount as it will be recorded; method shown", "receipts-return.en.dark.desktop", "", null],
    ["Voided receipt", "Marked voided; returns disabled with the reason", "receipts-voided.en.dark.desktop", "", null],
    ["Permission", "A cashier who may reprint but not refund or void: both visible, disabled, with the reason", "receipts-cashier.en.dark.desktop", "", null],
    ["No receipts yet", "Empty state", "receipts-empty.en.dark.desktop", "", null],
  ]],
]
const fig = (name, caption, w) => name && fs.existsSync(path.join(dir, "accounts-after", `${name}.png`))
  ? `<figure style="max-width:${w}px"><figcaption>${caption}</figcaption><img src="data:image/png;base64,${fs.readFileSync(path.join(dir, "accounts-after", `${name}.png`)).toString("base64")}" alt="${name}"></figure>` : ""
const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Accounts and receipts review</title>
<style>body{font-family:system-ui;background:#0B0E14;color:#F4F6FA;margin:24px}h1{font-size:20px;margin:0 0 4px}h2.group{font-size:18px;margin:36px 0 4px;color:#D4A843}p.lead{color:#9AA4B8;font-size:14px;margin:0 0 20px;max-width:900px}h3{font-size:16px;margin:28px 0 10px}.row{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap}figure{margin:0;background:#12161F;border:1px solid #1E2430;border-radius:10px;padding:8px;flex:1 1 auto}figcaption{font-size:12px;color:#9AA4B8;margin-bottom:6px}img{width:100%;border-radius:6px;display:block}</style></head><body>
<h1>Customers, Suppliers, Receipts</h1><p class="lead">Running app (Vite dev server, local dev mode, demo catalogue). Demo accounts: four customers (one archived) with debts aged 2 to 95 days, four suppliers (one archived) with purchase orders unpaid, partly paid and paid, nine receipts (cash, card, wallet, on account, refunded, voided, cash-rounded, sold at cost). Each capture is a fresh browser profile at its own size: desktop 1440×900, phone 390×844.</p>
${sections.map(([group, rows]) => `<h2 class="group">${group}</h2>` + rows.map(([title, dCap, d, mCap, m]) => `<h3>${title}</h3><div class="row">${fig(d, "Desktop · " + dCap, 960)}${fig(m, mCap, 300)}</div>`).join("\n")).join("\n")}
</body></html>`
fs.writeFileSync(path.join(dir, "accounts-review.html"), html)
console.log("wrote", path.join(dir, "accounts-review.html"))
