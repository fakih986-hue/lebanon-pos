// Receipt printer geometry, per device (each register has its own printer).
// Kept out of AppSettings on purpose: store settings sync to the server, and
// the server rejects unknown settings fields; paper width is not a store-wide fact.

export type ReceiptPaperMm = 58 | 80

export type ReceiptPrinter = {
  /** Roll width. */
  paperMm: ReceiptPaperMm
  /** Width the printer can actually print on (80 mm rolls usually 72 mm, 58 mm rolls 48 mm). */
  printableMm: number
  /** Extra safe margin inside the printable width, each side. */
  marginMm: number
}

const KEY = "lebanonpos.receipt-printer.v1"
export const DEFAULT_PRINTABLE_MM: Record<ReceiptPaperMm, number> = { 80: 72, 58: 48 }
export const DEFAULT_RECEIPT_PRINTER: ReceiptPrinter = { paperMm: 80, printableMm: 72, marginMm: 2 }

/** Clamp to what a roll can physically hold: printable ≤ paper, margins leave at least 30 mm of text. */
export function normalizeReceiptPrinter(p: Partial<ReceiptPrinter>): ReceiptPrinter {
  const paperMm: ReceiptPaperMm = p.paperMm === 58 ? 58 : 80
  const printable = Number(p.printableMm)
  const printableMm = Math.min(paperMm, Math.max(30, Number.isFinite(printable) && printable > 0 ? printable : DEFAULT_PRINTABLE_MM[paperMm]))
  const margin = Number(p.marginMm)
  const marginMm = Math.min((printableMm - 30) / 2, Math.max(0, Number.isFinite(margin) ? margin : DEFAULT_RECEIPT_PRINTER.marginMm))
  return { paperMm, printableMm, marginMm: Math.round(marginMm * 10) / 10 }
}

export function getReceiptPrinter(): ReceiptPrinter {
  try {
    const raw = localStorage.getItem(KEY)
    return normalizeReceiptPrinter(raw ? JSON.parse(raw) : {})
  } catch {
    return DEFAULT_RECEIPT_PRINTER
  }
}

export function setReceiptPrinter(p: Partial<ReceiptPrinter>): ReceiptPrinter {
  const next = normalizeReceiptPrinter({ ...getReceiptPrinter(), ...p })
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* storage unavailable: defaults apply */ }
  return next
}

/**
 * Page CSS shared by every printed receipt. The body is exactly the printable
 * width, centred on the roll, with the safe margin inside it; long text wraps
 * instead of being clipped.
 */
export function receiptPageCss(p: ReceiptPrinter = getReceiptPrinter()): string {
  const small = p.printableMm < 60
  return `
    @page { size: ${p.paperMm}mm auto; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body { width: ${p.printableMm}mm; margin: 0 auto; padding: 3mm ${p.marginMm}mm; font-family: Arial, "Noto Naskh Arabic", "Segoe UI", Tahoma, sans-serif; color: #000; font-size: ${small ? 11 : 12}px; line-height: 1.3; overflow-wrap: anywhere; }
    h1 { font-size: ${small ? 16 : 18}px; margin: 0 0 4px; text-align: center; font-weight: 900; }
    p { margin: 2px 0; text-align: center; }
    .muted { color: #333; font-size: ${small ? 10 : 11}px; }
    .rule { border-top: 1px dashed #000; margin: 8px 0; }
    .item { padding: 4px 0; border-bottom: 1px solid #ddd; }
    .item-name { font-weight: 700; }
    .item-meta { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0 8px; }
    .item-code { color: #333; font-size: ${small ? 9 : 10}px; }
    .line { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 0 8px; padding: 3px 0; border-bottom: 1px solid #eee; }
    .line > :last-child { margin-inline-start: auto; text-align: end; font-weight: 700; }
    .line.total { font-size: ${small ? 14 : 16}px; font-weight: 700; border-bottom: 0; }
    .line.warn { color: #5a4300; }
  `
}
