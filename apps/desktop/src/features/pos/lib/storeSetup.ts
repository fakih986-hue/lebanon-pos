import { getProductsSync } from "../services/product.service"
import { getSales } from "../services/sales.service"
import { getInventoryBatches } from "../services/inventoryBatch.service"
import { getDailyCloses } from "../services/dailyClose.service"

// POS-FIRST-SETUP-CATALOG-1B: decide whether a store is fresh (safe for first
// setup), active (already trading — steer to Receive/Import), or a mixed state
// worth a review. Pure detection over simple signals + local flags for the
// non-nagging first-run prompt. No mutation of business data.

export type StoreStatus = "fresh" | "active" | "review"
export type StoreState = { status: StoreStatus; reasons: string[] }

export type StoreSignals = {
  productCount: number
  salesCount: number
  dailyCloseCount: number
  /** batches from real receiving/adjustments (activity) */
  receivedBatchCount: number
  /** batches created by opening setup (OPENING-*) — setup-in-progress, not activity */
  openingBatchCount: number
}

export function detectStoreState(s: StoreSignals): StoreState {
  const active: string[] = []
  if (s.salesCount > 0) active.push(`${s.salesCount} sale(s) recorded`)
  if (s.receivedBatchCount > 0) active.push(`${s.receivedBatchCount} received stock batch(es)`)
  if (s.dailyCloseCount > 0) active.push(`${s.dailyCloseCount} daily close(s)`)
  if (active.length > 0) return { status: "active", reasons: active }

  // No trading activity.
  if (s.productCount === 0 && s.openingBatchCount === 0) {
    return { status: "fresh", reasons: ["No products, sales, or stock yet"] }
  }

  // Catalog and/or opening stock exists but the store hasn't traded → review.
  const reasons: string[] = []
  if (s.productCount > 0) reasons.push(`${s.productCount} product(s) already in the catalog`)
  if (s.openingBatchCount > 0) reasons.push(`${s.openingBatchCount} opening batch(es) already added`)
  reasons.push("No sales or received stock yet")
  return { status: "review", reasons }
}

const isOpeningBatch = (n: string | undefined) => (n ?? "").startsWith("OPENING-")

/** Live convenience wrapper — reads the current stores and classifies them. */
export function getStoreState(): StoreState {
  const batches = getInventoryBatches()
  return detectStoreState({
    productCount: getProductsSync().length,
    salesCount: getSales().length,
    dailyCloseCount: getDailyCloses().length,
    receivedBatchCount: batches.filter((b) => !isOpeningBatch(b.batchNumber)).length,
    openingBatchCount: batches.filter((b) => isOpeningBatch(b.batchNumber)).length,
  })
}

// ── First-run prompt flags (device-local; the prompt must not nag) ──
const SETUP_DONE_KEY = "lebanonpos.setup-completed.v1"
const PROMPT_DISMISS_KEY = "lebanonpos.setup-prompt-dismissed.v1"

export function isSetupCompleted(): boolean {
  try { return localStorage.getItem(SETUP_DONE_KEY) === "1" } catch { return false }
}
export function markSetupCompleted(): void {
  try { localStorage.setItem(SETUP_DONE_KEY, "1") } catch { /* private mode */ }
}
export function dismissSetupPrompt(): void {
  try { localStorage.setItem(PROMPT_DISMISS_KEY, "1") } catch { /* private mode */ }
}
function isPromptDismissed(): boolean {
  try { return localStorage.getItem(PROMPT_DISMISS_KEY) === "1" } catch { return false }
}

/** Show the non-blocking first-run prompt only on a genuinely fresh store the
 *  owner hasn't already set up or dismissed. */
export function shouldShowFirstRunPrompt(): boolean {
  if (isSetupCompleted() || isPromptDismissed()) return false
  return getStoreState().status === "fresh"
}
