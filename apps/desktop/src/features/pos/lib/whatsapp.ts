/**
 * WhatsApp deep-link helpers.
 * Opens wa.me with a prefilled message — works on desktop (WhatsApp Web/app)
 * and mobile, no API keys or paid integration required.
 */

/** Normalize a Lebanese (or international) number to wa.me digit format. */
export function normalizeWhatsAppNumber(raw: string): string {
  let n = (raw || "").replace(/[^\d+]/g, "")
  if (n.startsWith("+")) n = n.slice(1)
  // Local Lebanese number starting with 0 → +961
  if (n.startsWith("0")) n = "961" + n.slice(1)
  // Bare 8-digit local mobile (e.g. 70123456 / 3xxxxxx) → prefix 961
  else if (n.length >= 7 && n.length <= 8) n = "961" + n
  return n
}

export function buildWhatsAppLink(number: string, message: string): string {
  const n = normalizeWhatsAppNumber(number)
  return `https://wa.me/${n}?text=${encodeURIComponent(message)}`
}

export function openWhatsApp(number: string, message: string) {
  const url = buildWhatsAppLink(number, message)
  window.open(url, "_blank", "noopener,noreferrer")
}

/** Open WhatsApp with a message but no preset recipient — user picks the contact. */
export function openWhatsAppShare(message: string) {
  window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer")
}

/** Receipt summary for sharing to a customer. */
export function receiptMessage(opts: {
  storeName: string
  saleNumber: string
  total: number
  totalLbp: number
  items: { name: string; quantity: number; total: number }[]
  footer?: string
}): string {
  const { storeName, saleNumber, total, totalLbp, items, footer } = opts
  const lines = [
    `🧾 ${storeName}`,
    `Receipt ${saleNumber}`,
    ``,
    ...items.map((i) => `${i.quantity}× ${i.name} — $${i.total.toFixed(2)}`),
    ``,
    `TOTAL: $${total.toFixed(2)}  /  ${Math.round(totalLbp).toLocaleString()} LBP`,
  ]
  if (footer) { lines.push(``, footer) }
  return lines.join("\n")
}

/** Nightly close summary for the owner. */
export function dailySummaryMessage(opts: {
  storeName: string
  date: string
  netSales: number
  grossMargin: number
  expenses: number
  netProfit: number
  cashIn: number
  outstanding?: number
}): string {
  const { storeName, date, netSales, grossMargin, expenses, netProfit, cashIn, outstanding } = opts
  const lines = [
    `📊 ${storeName} — Daily Summary`,
    date,
    ``,
    `Net sales:     $${netSales.toFixed(2)}`,
    `Gross margin:  $${grossMargin.toFixed(2)}`,
    `Expenses:      $${expenses.toFixed(2)}`,
    `Net profit:    $${netProfit.toFixed(2)}`,
    `Cash in:       $${cashIn.toFixed(2)}`,
  ]
  if (typeof outstanding === "number") lines.push(`Debt outstanding: $${outstanding.toFixed(2)}`)
  return lines.join("\n")
}

/** Purchase order message to send a supplier. */
export function purchaseOrderMessage(opts: {
  storeName: string
  supplierName: string
  items: { name: string; quantity: number }[]
}): string {
  const { storeName, supplierName, items } = opts
  return [
    `🛒 Order from ${storeName}`,
    `To: ${supplierName}`,
    ``,
    ...items.map((i) => `• ${i.name} × ${i.quantity}`),
    ``,
    `Please confirm availability & price. Shukran!`,
  ].join("\n")
}

/** Friendly debt reminder message. */
export function debtReminderMessage(opts: {
  storeName: string
  customerName: string
  balance: number
  oldestDays?: number
}): string {
  const { storeName, customerName, balance, oldestDays } = opts
  const overdue = oldestDays && oldestDays >= 30 ? ` (oldest ${oldestDays} days)` : ""
  return [
    `Marhaba ${customerName} 👋`,
    ``,
    `This is a friendly reminder from ${storeName}.`,
    `Your current balance is $${balance.toFixed(2)}${overdue}.`,
    ``,
    `Please settle it whenever convenient. Thank you! 🙏`,
  ].join("\n")
}
