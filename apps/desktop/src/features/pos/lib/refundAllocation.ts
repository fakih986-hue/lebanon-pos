/**
 * REFUND-INTEGRITY-1 — shared refund / void allocation rules.
 *
 * THIS FILE IS DUPLICATED BYTE-FOR-BYTE in:
 *   apps/api/src/lib/refundAllocation.ts
 *   apps/desktop/src/features/pos/lib/refundAllocation.ts
 * Both apps' test suites run packages/shared/test-vectors/refund-allocation.json
 * against their own copy, and assert the two files are identical. Edit both.
 *
 * Rules (see docs/REFUND-INTEGRITY.md):
 * - A sale line is "tracked" when it carries a client-stamped lineId. Tracked
 *   lines refund individually and restore the lots recorded on the line, in
 *   original consumption order, net of earlier refunds of that line.
 * - Lines without a lineId (sales made before line identity existed) are
 *   pooled per product within the sale under legacyLineKey(productId). They
 *   restore product stock only — no lot is guessed for them.
 * - Any part of a tracked line not covered by a recorded lot ("untracked"
 *   stock) also restores product stock only.
 * - A request without a usable line key is spread across that product's lines
 *   in sale order (compatibility with clients that predate line identity).
 * - A sale with any refund cannot be voided.
 */

export const QTY_EPSILON = 1e-6
export const MONEY_EPSILON = 0.005

/** One slice of stock consumption. batchId null = untracked stock (no lot). */
export type AllocationSlice = {
  batchId: string | null
  quantity: number
  unitCost?: number
}

export type RefundableLine = {
  /** lineId for tracked lines, legacyLineKey(productId) for pooled legacy lines. */
  key: string
  productId: number
  soldQuantity: number
  /** null = legacy pool: product stock only, never lots. */
  allocations: AllocationSlice[] | null
}

export type PriorRefundLine = {
  key: string
  quantity: number
  allocations: AllocationSlice[] | null
}

export type RefundRequestLine = {
  /** Line key the client believes it is refunding. Optional for old clients. */
  key?: string | null
  productId: number
  quantity: number
}

export type PlannedRefundLine = {
  key: string
  productId: number
  quantity: number
  /** null = legacy pool (product stock only). Slices with batchId null restore product stock only. */
  allocations: AllocationSlice[] | null
}

export type RefundRuleCode =
  | "REFUND_EXCEEDS_REFUNDABLE"
  | "REFUND_LINE_NOT_IN_SALE"
  | "REFUND_INVALID_QUANTITY"
  | "REFUND_EXCEEDS_SALE_TOTAL"
  | "REFUND_INVALID_AMOUNT"
  | "REFUND_EMPTY"
  | "VOID_HAS_REFUNDS"
  | "REFUND_SALE_VOIDED"

export class RefundRuleError extends Error {
  readonly code: RefundRuleCode
  constructor(code: RefundRuleCode, message: string) {
    super(`${code}: ${message}`)
    this.code = code
    this.name = "RefundRuleError"
  }
}

export function roundQty(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

export function legacyLineKey(productId: number): string {
  return `legacy-product:${productId}`
}

export function isLegacyLineKey(key: unknown): boolean {
  return typeof key === "string" && key.startsWith("legacy-product:")
}

/** Coerce stored/wire allocations. "legacy-stock" and missing ids become untracked (null). */
export function normalizeAllocations(raw: unknown): AllocationSlice[] | null {
  if (!Array.isArray(raw)) return null
  const out: AllocationSlice[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue
    const record = entry as Record<string, unknown>
    const quantity = Number(record.quantity)
    if (!Number.isFinite(quantity) || quantity <= QTY_EPSILON) continue
    const batchId =
      typeof record.batchId === "string" && record.batchId && record.batchId !== "legacy-stock"
        ? record.batchId
        : null
    const unitCost = Number(record.unitCost)
    out.push({
      batchId,
      quantity: roundQty(quantity),
      ...(record.unitCost !== undefined && Number.isFinite(unitCost) ? { unitCost } : {}),
    })
  }
  return out
}

/**
 * Turn a sale's items into refundable lines. Tracked lines keep their own
 * identity; legacy lines are pooled per product, in order of first appearance.
 */
export function buildRefundableLines(
  items: Array<{ lineId?: string | null; productId: number; quantity: number; allocations?: unknown }>
): RefundableLine[] {
  const lines: RefundableLine[] = []
  const pools = new Map<number, RefundableLine>()
  for (const item of items) {
    const quantity = roundQty(Number(item.quantity) || 0)
    if (item.lineId) {
      lines.push({
        key: item.lineId,
        productId: item.productId,
        soldQuantity: quantity,
        allocations: normalizeAllocations(item.allocations) ?? [],
      })
      continue
    }
    const pool = pools.get(item.productId)
    if (pool) {
      pool.soldQuantity = roundQty(pool.soldQuantity + quantity)
    } else {
      const created: RefundableLine = {
        key: legacyLineKey(item.productId),
        productId: item.productId,
        soldQuantity: quantity,
        allocations: null,
      }
      pools.set(item.productId, created)
      lines.push(created)
    }
  }
  return lines
}

export function refundedQuantity(key: string, prior: PriorRefundLine[]): number {
  return roundQty(prior.filter((p) => p.key === key).reduce((sum, p) => sum + (Number(p.quantity) || 0), 0))
}

export function refundableQuantity(line: RefundableLine, prior: PriorRefundLine[]): number {
  return Math.max(0, roundQty(line.soldQuantity - refundedQuantity(line.key, prior)))
}

/** Tracked line slices, with any quantity not covered by a lot made explicit as untracked. */
function completeSlices(line: RefundableLine): AllocationSlice[] {
  const slices = (line.allocations ?? []).map((s) => ({ ...s }))
  const covered = roundQty(slices.reduce((sum, s) => sum + s.quantity, 0))
  if (line.soldQuantity - covered > QTY_EPSILON) {
    slices.push({ batchId: null, quantity: roundQty(line.soldQuantity - covered) })
  }
  return slices
}

/** Which lots a refund of `quantity` from `line` restores, net of earlier refunds. */
export function planLineRestoration(
  line: RefundableLine,
  prior: PriorRefundLine[],
  quantity: number
): AllocationSlice[] | null {
  if (!Number.isFinite(quantity) || quantity <= QTY_EPSILON) {
    throw new RefundRuleError("REFUND_INVALID_QUANTITY", `Refund quantity must be positive for line ${line.key}`)
  }
  const available = refundableQuantity(line, prior)
  if (quantity - available > QTY_EPSILON) {
    throw new RefundRuleError(
      "REFUND_EXCEEDS_REFUNDABLE",
      `Line ${line.key}: requested ${roundQty(quantity)}, only ${available} still refundable`
    )
  }
  if (line.allocations === null) return null

  // Quantity already restored per lot by earlier refunds of this line.
  const restored = new Map<string, number>()
  for (const p of prior) {
    if (p.key !== line.key) continue
    const priorSlices = normalizeAllocations(p.allocations) ?? [{ batchId: null, quantity: Number(p.quantity) || 0 }]
    for (const s of priorSlices) {
      const k = s.batchId ?? ""
      restored.set(k, roundQty((restored.get(k) ?? 0) + s.quantity))
    }
  }

  const plan: AllocationSlice[] = []
  let remaining = roundQty(quantity)
  for (const slice of completeSlices(line)) {
    if (remaining <= QTY_EPSILON) break
    const k = slice.batchId ?? ""
    const alreadyBack = restored.get(k) ?? 0
    const consumedHere = Math.min(alreadyBack, slice.quantity)
    restored.set(k, roundQty(alreadyBack - consumedHere))
    const net = roundQty(slice.quantity - consumedHere)
    if (net <= QTY_EPSILON) continue
    const take = roundQty(Math.min(remaining, net))
    plan.push({ batchId: slice.batchId, quantity: take, ...(slice.unitCost !== undefined ? { unitCost: slice.unitCost } : {}) })
    remaining = roundQty(remaining - take)
  }
  if (remaining > QTY_EPSILON) {
    // Prior restorations exceeded what the recorded lots allow (inconsistent
    // history). Refuse rather than invent a lot.
    throw new RefundRuleError("REFUND_EXCEEDS_REFUNDABLE", `Line ${line.key}: recorded lots cannot cover ${remaining}`)
  }
  return plan
}

/**
 * Plan a whole refund. Requests naming a known line key refund that line.
 * Requests without one are spread across the product's lines in sale order.
 */
export function planRefund(
  lines: RefundableLine[],
  prior: PriorRefundLine[],
  request: RefundRequestLine[]
): PlannedRefundLine[] {
  const working = prior.slice()
  const planned: PlannedRefundLine[] = []

  for (const req of request) {
    const quantity = roundQty(Number(req.quantity))
    if (!Number.isFinite(quantity) || quantity < -QTY_EPSILON) {
      throw new RefundRuleError("REFUND_INVALID_QUANTITY", `Invalid refund quantity for product ${req.productId}`)
    }
    if (quantity <= QTY_EPSILON) continue

    const direct = req.key ? lines.find((l) => l.key === req.key) : undefined
    const candidates = direct ? [direct] : lines.filter((l) => l.productId === req.productId)
    if (candidates.length === 0) {
      throw new RefundRuleError("REFUND_LINE_NOT_IN_SALE", `Product ${req.productId} is not part of this sale`)
    }

    let remaining = quantity
    for (const line of candidates) {
      if (remaining <= QTY_EPSILON) break
      const take = roundQty(Math.min(remaining, refundableQuantity(line, working)))
      if (take <= QTY_EPSILON) continue
      const allocations = planLineRestoration(line, working, take)
      planned.push({ key: line.key, productId: line.productId, quantity: take, allocations })
      working.push({ key: line.key, quantity: take, allocations })
      remaining = roundQty(remaining - take)
    }
    if (remaining > QTY_EPSILON) {
      throw new RefundRuleError(
        "REFUND_EXCEEDS_REFUNDABLE",
        `Product ${req.productId}: ${remaining} more than remains refundable on this sale`
      )
    }
  }

  if (planned.length === 0) throw new RefundRuleError("REFUND_EMPTY", "Refund has no items")
  return planned
}

/** A void restores every line in full. Refused once any refund exists. */
export function planVoidRestoration(lines: RefundableLine[], prior: PriorRefundLine[]): PlannedRefundLine[] {
  if (prior.some((p) => (Number(p.quantity) || 0) > QTY_EPSILON)) {
    throw new RefundRuleError("VOID_HAS_REFUNDS", "This sale already has refunds; refund the remaining items instead of voiding")
  }
  return lines
    .filter((line) => line.soldQuantity > QTY_EPSILON)
    .map((line) => ({
      key: line.key,
      productId: line.productId,
      quantity: line.soldQuantity,
      allocations: planLineRestoration(line, prior, line.soldQuantity),
    }))
}

/** Remaining refundable money on a sale, and validation of a new refund amount. */
export function refundableAmount(saleTotal: number, priorRefundTotals: number[]): number {
  const refunded = priorRefundTotals.reduce((sum, value) => sum + (Number(value) || 0), 0)
  return Math.max(0, Math.round((Number(saleTotal) - refunded) * 10000) / 10000)
}

export function assertRefundAmount(saleTotal: number, priorRefundTotals: number[], amount: number): void {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new RefundRuleError("REFUND_INVALID_AMOUNT", `Invalid refund amount ${amount}`)
  }
  const remaining = refundableAmount(saleTotal, priorRefundTotals)
  if (amount - remaining > MONEY_EPSILON) {
    throw new RefundRuleError("REFUND_EXCEEDS_SALE_TOTAL", `Refund ${amount} exceeds remaining refundable ${remaining}`)
  }
}

/** Original sale rate only. Never invents a rate for sales that recorded none. */
export function resolveRefundRate(saleTenderRate: unknown): {
  exchangeRate: number | null
  rateSource: "sale_tender" | "unavailable"
} {
  const rate = Number(saleTenderRate)
  if (saleTenderRate !== null && saleTenderRate !== undefined && Number.isFinite(rate) && rate > 0) {
    return { exchangeRate: rate, rateSource: "sale_tender" }
  }
  return { exchangeRate: null, rateSource: "unavailable" }
}
