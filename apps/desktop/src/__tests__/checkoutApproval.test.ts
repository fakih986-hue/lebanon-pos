import { describe, expect, it } from "vitest"
import { checkoutApprovalNeeded, checkoutFingerprint, listFloor, saleForCheckout } from "../features/pos/lib/checkoutApproval"

// SPRINT-2 batch: the checkout-approval decisions POSPage makes (Full POS and Simple POS): what this sale
// needs approved, what an approval is for, and which sale is approved and sent.
const products = [{ id: 1, price: 5, wholesalePrice: 4 }, { id: 2, price: 3, wholesalePrice: null }]
const base = { discountTotal: 0, canDiscount: false, canOverridePrice: false, sellAtCost: false, items: [{ id: 1, quantity: 2, price: 5 }], products, hasCustomer: false }

describe("which permissions a sale needs approved (the server's rules, no thresholds)", () => {
  it("nothing for a routine sale; a discount of any size; a price below list or a sale at cost", () => {
    expect(checkoutApprovalNeeded(base)).toEqual([])
    expect(checkoutApprovalNeeded({ ...base, discountTotal: 0.01 })).toEqual(["sales.discount"])
    expect(checkoutApprovalNeeded({ ...base, items: [{ id: 1, quantity: 1, price: 4.99 }] })).toEqual(["sales.price_override"])
    expect(checkoutApprovalNeeded({ ...base, sellAtCost: true })).toEqual(["sales.price_override"])
    expect(checkoutApprovalNeeded({ ...base, discountTotal: 1, items: [{ id: 1, quantity: 1, price: 4 }] })).toEqual(["sales.discount", "sales.price_override"])
    // a price above list is not an override
    expect(checkoutApprovalNeeded({ ...base, items: [{ id: 1, quantity: 1, price: 6 }] })).toEqual([])
  })
  it("a permission held is never asked for", () => {
    expect(checkoutApprovalNeeded({ ...base, discountTotal: 1, canDiscount: true, sellAtCost: true, canOverridePrice: true })).toEqual([])
  })
  it("the wholesale price is the floor only for a named customer", () => {
    expect(listFloor({ id: 1, quantity: 1, price: 4 }, products, false)).toBe(5)
    expect(listFloor({ id: 1, quantity: 1, price: 4 }, products, true)).toBe(4)
    expect(checkoutApprovalNeeded({ ...base, hasCustomer: true, items: [{ id: 1, quantity: 1, price: 4 }] })).toEqual([])
    expect(listFloor({ id: 2, quantity: 1, price: 1 }, products, true)).toBe(3)
  })
})

describe("what an approval at checkout is for", () => {
  const f = { items: [{ id: 1, quantity: 2, price: 5 }], discountTotal: 1, subtotal: 9, tax: 0, total: 9, sellAtCost: false, paymentMethod: "Cash", customerId: null as string | null, paidUsd: 10, paidLbp: 0 }
  it("any change to lines, quantities, prices, discount, tender, customer or payment is another sale", () => {
    const same = checkoutFingerprint(f)
    expect(checkoutFingerprint({ ...f })).toBe(same)
    for (const changed of [
      { ...f, items: [{ id: 2, quantity: 2, price: 5 }] }, { ...f, items: [{ id: 1, quantity: 1, price: 10 }] }, { ...f, discountTotal: 2, subtotal: 8, tax: 1 },
      { ...f, paidUsd: 20 }, { ...f, paidLbp: 89500 }, { ...f, customerId: "c-1" }, { ...f, paymentMethod: "Card" }, { ...f, sellAtCost: true },
    ]) expect(checkoutFingerprint(changed)).not.toBe(same)
  })
})

describe("which sale is approved and sent", () => {
  const built = { id: "new" }, sent = { id: "sent-before" }, kept = { id: "kept" }
  it("the sale already sent for this cart (with its approval), else the sale kept for this checkout, else the new one", () => {
    expect(saleForCheckout({ built, pending: { sale: sent, fingerprint: "hub", approvalId: "a1" }, hubFingerprint: "hub", kept: { fingerprint: "f", sale: kept }, fingerprint: "f" })).toEqual({ sale: sent, approvalId: "a1" })
    expect(saleForCheckout({ built, pending: { sale: sent, fingerprint: "hub" }, hubFingerprint: "hub", kept: null, fingerprint: "f" })).toEqual({ sale: sent })
    expect(saleForCheckout({ built, pending: { sale: sent, fingerprint: "other cart" }, hubFingerprint: "hub", kept: { fingerprint: "f", sale: kept }, fingerprint: "f" })).toEqual({ sale: kept })
    // the cart changed since the manager was asked: a new sale (the old approval is not for it)
    expect(saleForCheckout({ built, pending: null, hubFingerprint: "hub", kept: { fingerprint: "f", sale: kept }, fingerprint: "g" })).toEqual({ sale: built })
  })
})
