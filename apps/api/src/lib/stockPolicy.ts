import { randomUUID } from "node:crypto"

/**
 * SPRINT-1: stock-policy revisions — one identity scheme for every database (till, hub, cloud).
 *
 * A product's policy is identified by a REVISION ID, never by a counter: each change mints a new id
 * (a UUID, minted by whoever makes the change — till, hub or cloud) recorded with its parent. An id
 * means exactly one policy everywhere, because it is created once with its policy and every
 * database copies it, never re-mints it. ("initial" is a product's first policy, the one it was
 * created with; existing products got it from the migration.) `stockPolicyVersion` is only the
 * number of known revisions, for display.
 *
 * Authority and concurrent edits: a change whose parent is the receiving database's current
 * revision fast-forwards it. A change made concurrently elsewhere (its parent is no longer current)
 * is RECORDED as a branch — sales sold under it keep resolving to its policy — but does not change
 * the current policy; an audit event makes the conflict visible. The cloud is the authority: a hub
 * adopts the cloud's current revision once the cloud has seen the hub's own, and keeps its own until
 * then (the cloud decides when it arrives). Histories are merged by revision id, never overwritten.
 */
export type Policy = "tracked" | "untracked"
export type PolicyRev = { rev: string; policy: Policy; parentRev: string | null; at: string | null }
export const INITIAL_REV = "initial"
export const asPolicy = (p: unknown): Policy => (p === "untracked" ? "untracked" : "tracked")
const validPolicy = (p: unknown): p is Policy => p === "tracked" || p === "untracked"

type PolicyState = { stockPolicy: string; stockPolicyRev?: string | null; stockPolicyHistory?: unknown }

/** Every revision this database knows for a product (its current one included). */
export function policyRevs(p: PolicyState): PolicyRev[] {
  const list: PolicyRev[] = Array.isArray(p.stockPolicyHistory)
    ? (p.stockPolicyHistory as any[]).filter((e) => e && typeof e.rev === "string" && e.rev && validPolicy(e.policy))
        .map((e) => ({ rev: e.rev, policy: e.policy, parentRev: typeof e.parentRev === "string" ? e.parentRev : null, at: typeof e.at === "string" ? e.at : null }))
    : []
  const current = p.stockPolicyRev || INITIAL_REV
  if (!list.some((e) => e.rev === current)) list.unshift({ rev: current, policy: asPolicy(p.stockPolicy), parentRev: null, at: null })
  return list
}

/** Union by revision id (the first list wins on the — impossible — case of one id with two policies). */
export function mergeRevs(a: PolicyRev[], b: PolicyRev[]): PolicyRev[] {
  const out = [...a]
  for (const e of b) if (!out.some((x) => x.rev === e.rev)) out.push(e)
  return out
}

export class StockPolicyMismatchError extends Error {
  constructor(name: string) { super(`STOCK_POLICY_MISMATCH: "${name}" was sent with a stock setting that does not match its revision; not applied.`); this.name = "StockPolicyMismatchError" }
}
/** Retryable: the sale names a revision this database has not received yet (or none, after changes). */
export class StockPolicyHeldError extends Error {
  constructor(name: string, rev: string | null) {
    super(`STOCK_POLICY_HELD: "${name}" was sold under a stock setting ${rev ? `(${rev}) ` : ""}this server does not know${rev ? " yet" : " (older till, setting changed since)"}. The sale is kept and retried; nothing was applied.`)
    this.name = "StockPolicyHeldError"
  }
}

/**
 * A product.update's policy fields → the columns to write (empty = no policy change).
 * `payload` may carry stockPolicy, stockPolicyRev (the change's id) and stockPolicyParentRev.
 */
export function applyPolicyChange(cur: PolicyState & { name: string }, payload: Record<string, unknown>, now = new Date()):
  { data: Record<string, unknown>; branch: PolicyRev | null } {
  if (!validPolicy(payload.stockPolicy)) return { data: {}, branch: null }
  const claimed = payload.stockPolicy
  const revs = policyRevs(cur)
  const current = cur.stockPolicyRev || INITIAL_REV
  let rev = typeof payload.stockPolicyRev === "string" && payload.stockPolicyRev.trim() ? payload.stockPolicyRev.trim() : null
  if (!rev) {
    // No revision (an older client): a change made here, on top of the current revision.
    if (claimed === asPolicy(cur.stockPolicy)) return { data: {}, branch: null }
    rev = randomUUID()
  }
  const known = revs.find((e) => e.rev === rev)
  if (known) {
    if (known.policy !== claimed) throw new StockPolicyMismatchError(cur.name)
    return { data: {}, branch: null } // replay, or a record of a revision already known
  }
  const parentRev = typeof payload.stockPolicyParentRev === "string" && payload.stockPolicyParentRev ? payload.stockPolicyParentRev : current
  const entry: PolicyRev = { rev, policy: claimed, parentRev, at: now.toISOString() }
  const history = [...revs, entry]
  if (parentRev === current) {
    return { data: { stockPolicy: claimed, stockPolicyRev: rev, stockPolicyHistory: history, stockPolicyVersion: history.length, stockPolicyChangedAt: now }, branch: null }
  }
  return { data: { stockPolicyHistory: history, stockPolicyVersion: history.length }, branch: entry }
}

/** A pulled product (from the cloud) merged into this hub's row. */
export function adoptPulledPolicy(local: PolicyState, incoming: PolicyState): Record<string, unknown> {
  const localRevs = policyRevs(local)
  const incomingRevs = policyRevs(incoming)
  const history = mergeRevs(incomingRevs, localRevs)
  const localCurrent = local.stockPolicyRev || INITIAL_REV
  const cloudHasSeenOurs = incomingRevs.some((e) => e.rev === localCurrent)
  return cloudHasSeenOurs
    ? { stockPolicy: asPolicy(incoming.stockPolicy), stockPolicyRev: incoming.stockPolicyRev || INITIAL_REV, stockPolicyHistory: history, stockPolicyVersion: history.length }
    : { stockPolicy: asPolicy(local.stockPolicy), stockPolicyRev: localCurrent, stockPolicyHistory: history, stockPolicyVersion: history.length }
}

/**
 * The policy a sale line was SOLD under. The line names its revision; this database's record of
 * that revision decides (a claim only has to agree). Unknown revision → held (retryable, nothing
 * applied). No revision (older tills): established only if the product never changed policy.
 */
export function resolveLinePolicy(product: (PolicyState & { name: string }) | null, item: { stockPolicy?: unknown; stockPolicyRev?: unknown },
  resolution: { policy: Policy } | null = null):
  { policy: Policy; rev: string | null; conflict: "changed" | "resolved" | null } {
  if (!product) return { policy: "tracked", rev: null, conflict: null }
  // A held line settled by an authorized manager (audited by the caller): their explicit decision
  // is the line's policy on every server it reaches, so the hub and the cloud record the same.
  if (resolution) return { policy: resolution.policy, rev: typeof item.stockPolicyRev === "string" && item.stockPolicyRev ? item.stockPolicyRev : null, conflict: "resolved" }
  const today = asPolicy(product.stockPolicy)
  const revs = policyRevs(product)
  const claimed = validPolicy(item.stockPolicy) ? item.stockPolicy : null
  const rev = typeof item.stockPolicyRev === "string" && item.stockPolicyRev ? item.stockPolicyRev : null
  if (rev) {
    const e = revs.find((x) => x.rev === rev)
    if (!e) throw new StockPolicyHeldError(product.name, rev)
    if (claimed && claimed !== e.policy) throw new StockPolicyMismatchError(product.name)
    return { policy: e.policy, rev, conflict: e.policy !== today ? "changed" : null }
  }
  if (revs.length === 1) return { policy: revs[0].policy, rev: revs[0].rev, conflict: null }
  throw new StockPolicyHeldError(product.name, null)
}
