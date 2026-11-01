/** Café batch: a configured line's options and preparation note as one line of text (cart, receipts, reprints). */
export type LineOptionsSource = { modifiers?: Array<{ name?: string; nameAr?: string }> | null; note?: string | null }
export function lineOptionsText(item: LineOptionsSource, locale: string = "en"): string {
  const names = (Array.isArray(item?.modifiers) ? item.modifiers : []).map((m) => (locale === "ar" && m?.nameAr ? m.nameAr : m?.name ?? "")).filter(Boolean)
  const note = typeof item?.note === "string" ? item.note.trim() : ""
  return [names.join(", "), note ? `“${note}”` : ""].filter(Boolean).join(" · ")
}
/** A cart line's key: its configuration (a drink with options) or its product (one line per product). */
export type CartKey = number | string
export const cartKeyOf = (item: { id: number; lineKey?: string }): CartKey => item.lineKey ?? item.id
