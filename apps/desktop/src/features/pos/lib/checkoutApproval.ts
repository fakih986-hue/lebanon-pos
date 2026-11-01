// SPRINT-2 E: a manager's approval at checkout (POSPage, Full and Simple POS). Pure decisions, kept here
// so they are tested apart from the page: which permissions this sale needs that the person signed in
// lacks (the server's rules, no thresholds), what an approval at checkout is for (anything that changes
// the sale), and which sale is approved and sent (built once: the same sale, never a rebuilt one).
import type { Permission } from "../services/security.service"

type Line = { id: number; quantity: number; price: number }
type ProductPrice = { id: number; price: number; wholesalePrice?: number | null }

/**
 * A line's floor: its catalogue price, or the wholesale price for a named customer (as the server's
 * price-override rule). Below it is a price override.
 */
export function listFloor(item: Line, products: ProductPrice[], hasCustomer: boolean): number {
  const p = products.find((x) => x.id === item.id)
  if (!p) return item.price
  const wholesale = Number(p.wholesalePrice ?? 0)
  return wholesale > 0 && hasCustomer ? Math.min(p.price, wholesale) : p.price
}

/** The permissions this sale needs that the person signed in does not hold. */
export function checkoutApprovalNeeded(i: {
  discountTotal: number; canDiscount: boolean; canOverridePrice: boolean; sellAtCost: boolean
  items: Line[]; products: ProductPrice[]; hasCustomer: boolean
}): Permission[] {
  const needed: Permission[] = []
  if (i.discountTotal > 0 && !i.canDiscount) needed.push("sales.discount")
  if (!i.canOverridePrice && (i.sellAtCost || i.items.some((item) => item.price < listFloor(item, i.products, i.hasCustomer) - 0.005))) needed.push("sales.price_override")
  return needed
}

/** What an approval at checkout is for: lines, prices, discount, totals, tender, customer, payment. */
export function checkoutFingerprint(i: {
  items: Line[]; discountTotal: number; subtotal: number; tax: number; total: number; sellAtCost: boolean
  paymentMethod: string; customerId: string | null; paidUsd: number; paidLbp: number
}): string {
  return JSON.stringify({
    items: i.items.map((item) => [item.id, item.quantity, item.price]), discountTotal: i.discountTotal, subtotal: i.subtotal, tax: i.tax, total: i.total,
    sellAtCost: i.sellAtCost, paymentMethod: i.paymentMethod, customer: i.customerId, paidUsd: i.paidUsd, paidLbp: i.paidLbp,
  })
}

/**
 * The sale to approve and send, in order: the sale this register already sent the hub for the same cart
 * (its confirmation was lost: resent exactly, with the approval it carried, if any); the sale kept for
 * this exact checkout when a manager was asked; else the sale just built.
 */
export function saleForCheckout<S extends { id: string }>(i: {
  built: S
  pending: { sale: S; fingerprint: string; approvalId?: string } | null
  hubFingerprint: string
  kept: { fingerprint: string; sale: S } | null
  fingerprint: string
}): { sale: S; approvalId?: string } {
  if (i.pending && i.pending.fingerprint === i.hubFingerprint) return { sale: i.pending.sale, ...(i.pending.approvalId ? { approvalId: i.pending.approvalId } : {}) }
  if (i.kept && i.kept.fingerprint === i.fingerprint) return { sale: i.kept.sale }
  return { sale: i.built }
}
