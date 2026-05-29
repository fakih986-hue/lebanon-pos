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
