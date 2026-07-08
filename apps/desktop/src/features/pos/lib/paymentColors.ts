/**
 * Payment-method color ramp (Midnight Gold design system).
 *
 * Single source for every chart/badge that colors by payment method —
 * muted hues that sit calmly on dark surfaces, same family as the product
 * category accents. Semantic anchors: Cash≈success, Debt≈warning.
 */
export type PaymentColor = { solid: string; soft: string; text: string }

export const PAYMENT_COLORS: Record<string, PaymentColor> = {
  Cash:   { solid: "#5CB894", soft: "rgba(92,184,148,0.15)",  text: "#9AD9BF" },
  Card:   { solid: "#7D8CD9", soft: "rgba(125,140,217,0.15)", text: "#B3BCE8" },
  Wallet: { solid: "#A186C9", soft: "rgba(161,134,201,0.15)", text: "#C9B8E3" },
  Debt:   { solid: "#C9A25C", soft: "rgba(201,162,92,0.15)",  text: "#E0C591" },
}

export const PAYMENT_COLOR_FALLBACK: PaymentColor = {
  solid: "#8B94A3",
  soft: "rgba(139,148,163,0.15)",
  text: "#B4BAC6",
}

export function paymentColor(method: string): PaymentColor {
  return PAYMENT_COLORS[method] ?? PAYMENT_COLOR_FALLBACK
}
