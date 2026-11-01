/**
 * SPRINT-2 Phase F — review of uncertain queued work (one queue: the server's refused work).
 *
 * What a reviewer needs to decide about a held operation, without re-deriving it from logs:
 *  - category: why it is held, in terms of identity and authority (device revoked, staff deactivated,
 *    PIN reset or session revoked, permission missing, session expired or ended, offline claim, hub key
 *    revoked or no attestation, invalid approval, price below list, stale staff copy);
 *  - money: what the register says was collected or paid out (claimed by the register; the server
 *    did not record it): it is never collected again because a review is pending;
 *  - previewToken: a digest of the operation and the server's state the reviewer saw. A decision
 *    taken on an older preview is refused (STALE_PREVIEW): the reviewer looks again.
 * Decisions are whole: apply the operation as sent, or decline it. Partial repairs are not supported.
 */
import { createHash } from "node:crypto"

export type ReviewCategory =
  | "device-revoked" | "staff-deactivated" | "pin-reset-or-session-revoked" | "permission-missing" | "session-expired-or-ended"
  | "offline-claim" | "hub-key-revoked" | "hub-unattested" | "approval-invalid" | "close-conflict" | "price-below-list" | "stale-staff" | "identity-missing" | "topology" | "other"

export function reviewCategory(reason: string | null): ReviewCategory {
  const r = reason ?? ""
  if (/^TOPOLOGY_[A-Z_]+:/.test(r)) return "topology"
  if (/^APPROVAL_INVALID:/.test(r)) return "approval-invalid"
  if (/^CLOSE_CONFLICT:/.test(r)) return "close-conflict"
  if (/^PRICE_OVERRIDE:/.test(r)) return "price-below-list"
  if (/^STALE_STAFF:/.test(r)) return "stale-staff"
  if (/^HUB_UNSUPPORTED:/.test(r)) return /\(revoked\)/.test(r) ? "hub-key-revoked" : "hub-unattested"
  if (/^SESSION_REVIEW:/.test(r)) return "session-expired-or-ended"
  if (/^OFFLINE_REVIEW:/.test(r)) return /not an active staff member/.test(r) ? "staff-deactivated" : /not allowed|lacks/.test(r) ? "permission-missing" : "offline-claim"
  if (/^IDENTITY_REQUIRED:/.test(r)) {
    if (/device credential revoked|\(revoked\)/.test(r)) return "device-revoked"
    if (/staff-inactive|not an active staff member/.test(r)) return "staff-deactivated"
    if (/staff-revoked/.test(r)) return "pin-reset-or-session-revoked"
    if (/not allowed to sell/.test(r)) return "permission-missing"
    return "identity-missing"
  }
  if (/permission|lacks/i.test(r)) return "permission-missing"
  return "other"
}

/** What the register says was collected or paid out with this operation (a claim). */
export function moneyEffect(entity: string, action: string, payload: unknown): { direction: "collected" | "paid-out" | "none"; amountUsd: number; method: string | null } {
  const p = (payload ?? {}) as Record<string, unknown>
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const s = (v: unknown) => (typeof v === "string" ? v : null)
  if (entity === "sale" && action === "create") return { direction: "collected", amountUsd: n(p.total), method: s(p.paymentMethod) }
  if (entity === "sale" && action === "void") return { direction: "paid-out", amountUsd: 0, method: null }
  if (entity === "refund" && action === "create") return { direction: "paid-out", amountUsd: n(p.total), method: s(p.method) }
  if (entity === "cash-movement") return { direction: p.direction === "In" ? "collected" : "paid-out", amountUsd: n(p.amountUsd), method: "Cash" }
  if (entity === "supplier-payment") return { direction: "paid-out", amountUsd: n(p.amount), method: s(p.method) }
  if (entity === "debt" && action === "payment") return { direction: "collected", amountUsd: n(p.amount), method: s(p.method) }
  if (entity === "expense") return { direction: "paid-out", amountUsd: n(p.amount), method: s(p.paymentMethod) }
  return { direction: "none", amountUsd: 0, method: null }
}

export const DISMISS_OUTCOMES = ["nothing-to-correct", "manual-correction-acknowledged", "money-recovered-attested"] as const

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object") return `{${Object.keys(value as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`
  return JSON.stringify(value ?? null)
}
/** A digest of what the reviewer saw: the operation as held and the server's current effects. */
export function previewTokenOf(row: { id: string; status: string; error: string | null; attempts: number; payload: unknown }, effects: unknown): string {
  return createHash("sha256").update(canonical({ id: row.id, status: row.status, error: row.error, attempts: row.attempts, payload: row.payload, effects })).digest("hex").slice(0, 32)
}
