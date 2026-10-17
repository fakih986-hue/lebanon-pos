// Hub write-through checkout that can never ring the same cart twice.
//
// The hub commits the sale (and its stock) atomically; the till finalizes locally only once the
// hub confirms. If the confirmation is lost (the hub committed, then became unreachable), the
// till used to keep the cart and report "hub down" — and the next attempt, or the same cart after
// a reload, built a NEW sale id, which the hub accepted as a second sale.
//
// Now the sale about to be sent is saved first, per store (immutable tenant), as the pending hub
// sale with a fingerprint of its cart:
//   same cart again      -> the SAME sale (id, number) is sent: the hub acknowledges it once;
//   a different cart     -> the pending attempt is settled on the hub first, terminally:
//                           committed -> finalized here and the new cart is NOT charged;
//                           cancelled (the hub guarantees it can never commit afterwards) ->
//                           forgotten, the new cart proceeds; hub unreachable -> blocked.
// "Not found" is never treated as settled: the original request may still be on its way.
import { cancelHubCheckoutAttempt, commitSaleToHub, getCurrentTenantId, pullFromServer, SyncStorageError } from "./sync.service"
import { finalizeCommittedSale, getSales, type Sale } from "./sales.service"
import { consumeInventoryBatches, type ConsumeBatchInput } from "./inventoryBatch.service"
import { decreaseProductStock } from "./product.service"
import { recordDebtSale, type RecordDebtSaleInput } from "./customer.service"

export const PENDING_HUB_SALE_KEY = "lebanonpos.hub-checkout-pending.v1"

export type PendingHubSale = {
  sale: Sale
  fingerprint: string
  lots: ConsumeBatchInput[]
  stock: Array<{ productId: number; quantity: number }>
  debt: Omit<RecordDebtSaleInput, "saleId"> | null
  at: string
}
export type HubCheckoutOutcome =
  /** Committed by the hub and finalized here. */
  | { status: "committed"; sale: Sale; reused: boolean }
  /** Refused by the hub (e.g. insufficient stock): nothing recorded, the cart stays. */
  | { status: "rejected"; error: string }
  /** The hub may have this sale: nothing finalized, the cart stays — do not take payment again. */
  | { status: "unconfirmed"; sale: Sale }
  /** An earlier unconfirmed sale had gone through: finalized now; the current cart was not charged. */
  | { status: "previous_committed"; sale: Sale }

function tenantKey() {
  let t: string | null
  try { t = getCurrentTenantId() } catch { t = null }
  return t ? `tenant:${t}` : "unbound"
}
function readAll(): Record<string, PendingHubSale> {
  try {
    const v = JSON.parse(localStorage.getItem(PENDING_HUB_SALE_KEY) ?? "{}")
    return v && typeof v === "object" && !Array.isArray(v) ? v : {}
  } catch { return {} }
}
function writePending(p: PendingHubSale | null) {
  const all = readAll()
  if (p) all[tenantKey()] = p
  else delete all[tenantKey()]
  localStorage.setItem(PENDING_HUB_SALE_KEY, JSON.stringify(all))
}

/** The sale this till sent to the hub without a confirmation (this store only). */
export function getPendingHubSale(): PendingHubSale | null {
  return readAll()[tenantKey()] ?? null
}

/** What identifies "the same cart": lines, quantities, prices, payment and customer, total. */
export function cartFingerprint(input: {
  items: Array<{ id: number; quantity: number; unitPrice: number }>
  paymentMethod: string
  customerId?: string
  total: number
}) {
  const lines = input.items.map((i) => `${i.id}x${i.quantity}@${i.unitPrice}`).sort().join("|")
  return `${lines}#${input.paymentMethod}#${input.customerId ?? ""}#${input.total}`
}

/**
 * Settle this store's pending hub sale terminally (also used by the POS "check now" action):
 * committed -> recorded here; cancelled -> forgotten (it can never commit); unreachable -> kept.
 */
export async function settlePendingHubSale(cancel: typeof cancelHubCheckoutAttempt = cancelHubCheckoutAttempt): Promise<{ state: "none" | "committed" | "cancelled" | "unreachable"; sale?: Sale }> {
  const pending = getPendingHubSale()
  if (!pending) return { state: "none" }
  const result = await cancel(pending.sale.id)
  if (result === "committed") {
    try { finalizeLocal(pending) } catch (error) {
      console.error("[hub checkout] local finalize failed; refreshing from the hub:", error)
      pullFromServer().catch(() => {})
    }
    writePending(null)
    return { state: "committed", sale: pending.sale }
  }
  if (result === "cancelled") {
    writePending(null)
    return { state: "cancelled", sale: pending.sale }
  }
  return { state: "unreachable", sale: pending.sale }
}

/** Record the hub-committed sale here once (lots, sale, debt, stock); a second call does nothing. */
function finalizeLocal(p: PendingHubSale) {
  if (getSales().some((s) => s.id === p.sale.id)) return
  consumeInventoryBatches(p.lots, { skipSync: true, movementIdPrefix: `mv-sale-${p.sale.id}` })
  finalizeCommittedSale(p.sale)
  if (p.debt) recordDebtSale({ ...p.debt, saleId: p.sale.id })
  decreaseProductStock(p.stock)
}

export async function checkoutViaHub(input: {
  fingerprint: string
  /** Builds the new sale (a fresh id and number) — only called when no pending sale is reused. */
  build: () => Sale
  lots: ConsumeBatchInput[]
  stock: Array<{ productId: number; quantity: number }>
  debt?: Omit<RecordDebtSaleInput, "saleId">
}, deps: { commit?: typeof commitSaleToHub; cancel?: typeof cancelHubCheckoutAttempt } = {}): Promise<HubCheckoutOutcome> {
  const commit = deps.commit ?? commitSaleToHub
  const pending = getPendingHubSale()

  if (pending && pending.fingerprint !== input.fingerprint) {
    const settled = await settlePendingHubSale(deps.cancel)
    if (settled.state === "committed") return { status: "previous_committed", sale: pending.sale }
    if (settled.state !== "cancelled") return { status: "unconfirmed", sale: pending.sale }
  }

  let current: PendingHubSale
  const reused = !!pending && pending.fingerprint === input.fingerprint
  if (reused) {
    current = pending!
  } else {
    current = { sale: input.build(), fingerprint: input.fingerprint, lots: input.lots, stock: input.stock, debt: input.debt ?? null, at: new Date().toISOString() }
    try { writePending(current) } catch (error) { throw new SyncStorageError(`wt-${current.sale.id}`, error) } // nothing sent yet
  }

  const result = await commit(current.sale as unknown as { id: string } & Record<string, unknown>)
  if (result.status === "committed") {
    // The hub owns this sale now. A local finalize that fails (storage) does not undo that: the
    // sale is reported as committed and this till's copy is refreshed from the hub.
    try { finalizeLocal(current) } catch (error) {
      console.error("[hub checkout] local finalize failed; refreshing from the hub:", error)
      pullFromServer().catch(() => {})
    }
    writePending(null)
    return { status: "committed", sale: current.sale, reused }
  }
  if (result.status === "rejected") {
    writePending(null)
    return { status: "rejected", error: result.error }
  }
  return { status: "unconfirmed", sale: current.sale }
}
