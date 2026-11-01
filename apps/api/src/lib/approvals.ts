/**
 * SPRINT-2 Phase E — online manager approval (docs/SPRINT-2-AUTHORIZATION-MATRIX.md §4).
 *
 * The person at the register stays the actor. A manager authenticates again, here, with their PIN, for
 * ONE command (entity, action, record id) with its material values, on one enrolled register, for the
 * person signed in there, and for one or more permissions. The approval is single use: the first
 * operation presenting it within its lifetime uses it, and only that operation may present it again
 * (an exact retry). Changing any material value, the action, the record or the person means another
 * approval.
 *
 * Material values (materialOf): the ONE builder used both when the approval is requested and when an
 * operation presents it. Every field of the command is material except an explicit list of fields that
 * cannot change what the command does: timestamps, display names and receipt numbers (NONMATERIAL), and
 * valuation the server derives itself (VALUATION). A field nobody listed is therefore covered: lines,
 * quantities, prices, discounts, totals, tender, the source sale, payout direction, reason and note,
 * currency and rate, customer, shift, lots, the actor ids.
 *
 * Lifetime (policy): APPROVAL_SECONDS from the manager's PIN check until the operation first reaches
 * the server the register talks to (the hub, for a hub's registers). That server records the approval
 * as it checked it (ApprovalSeen, with the material digest and when it was used); forwarding it later
 * does not check the lifetime again (a consumed approval stays valid), and the cloud compares the
 * digest with the command it receives. An approval not used within its lifetime is refused; the
 * operation is kept for a manager's review, never lost or re-charged.
 *
 * Online only. There is no offline manager approval (the offline elevated-action policy is unchanged).
 */
import { createHash, randomUUID } from "node:crypto"
import prisma from "./prisma.js"

export const APPROVAL_SECONDS = 120

/** What may be approved, and with which permissions (existing permissions; no thresholds). */
export const APPROVABLE: Record<string, string[]> = {
  "sale:create": ["sales.discount", "sales.price_override", "inventory.manage"],
  "sale:void": ["sales.void"],
  "refund:create": ["sales.refund"],
  "cash-movement:create": ["cash.manage"],
  "inventory:adjust": ["inventory.adjust"],
}

/** Fields that cannot change what a command does (anywhere in it). */
export const NONMATERIAL = new Set([
  // when it was written (the register stamps these at commit, after the approval)
  "createdAt", "updatedAt", "completedAt", "startedAt", "syncedAt", "at",
  // display copies of what an id already identifies, and receipt numbers
  "cashier", "cashierName", "customerName", "recordedBy", "recordedByName", "resolvedByName", "productName", "name", "barcode",
  "saleNumber", "refundNumber", "shiftNumber", "expenseNumber",
])
/** Valuation the server derives itself (never trusted from a register). */
export const VALUATION = new Set(["cost", "unitCost", "profit", "totalCost", "valueImpact", "totalValueImpact", "fallbackUnitCost"])
/** A held line's stock-policy decision: material only to an approval of that decision (inventory.manage). */
const POLICY_DECISION = new Set(["stockPolicy", "stockPolicyResolution"])

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object") return `{${Object.keys(value as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`
  return JSON.stringify(value ?? null)
}

function strip(value: unknown, decisionIsMaterial: boolean): unknown {
  if (Array.isArray(value)) return value.map((v) => strip(v, decisionIsMaterial))
  if (!value || typeof value !== "object") return value === undefined ? null : value
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (NONMATERIAL.has(k) || VALUATION.has(k)) continue
    if (POLICY_DECISION.has(k) && !(decisionIsMaterial && k === "stockPolicyResolution")) continue
    if (v === undefined) continue
    out[k] = strip(v, decisionIsMaterial)
  }
  return out
}

/**
 * The material values of a command: what a manager approves. null when the action cannot be approved.
 * Numbers are compared as numbers ("3" and 3 are the same price); lines keep their order.
 */
export function materialOf(entity: string, action: string, payload: unknown, permissions: string[] = []): Record<string, unknown> | null {
  if (!APPROVABLE[`${entity}:${action}`]) return null
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null
  const material = strip(JSON.parse(JSON.stringify(payload)), permissions.includes("inventory.manage")) as Record<string, unknown>
  return { entity, action, ...material }
}
export const materialDigest = (material: Record<string, unknown>) => createHash("sha256").update(canonical(material)).digest("hex")

export type ApprovalCheck = "valid" | "unknown" | "other-store" | "other-device" | "other-record" | "other-actor" | "changed" | "expired" | "cancelled" | "used-by-another-operation" | "approver-inactive" | "approver-lacks-permission"
/**
 * An approval as the receiving server checked it. Recorded with the operation and, for a hub, signed and
 * forwarded: `materialDigest` lets the cloud check the approval was for the command it receives, and
 * `consumedAt` (within `expiresAt`) says the approval was used in time where it was checked.
 */
export type ApprovalSeen = {
  check: ApprovalCheck; id: string; permission: string | null; permissions?: string[]
  approverId: string | null; approverName: string | null; requestedById?: string | null
  materialDigest?: string | null; issuedAt?: string | null; expiresAt?: string | null; consumedAt?: string | null
}

const permissionsOf = (a: { permission: string; permissions?: string[] | null }) => (a.permissions && a.permissions.length ? a.permissions : [a.permission])

export async function createApproval(i: { tenantId: string; deviceId: string; entity: string; action: string; payload: unknown; permissions: string[]; approver: { id: string; name: string }; requestedById: string | null; sessionChecked: boolean }) {
  const material = materialOf(i.entity, i.action, i.payload, i.permissions)!
  const now = new Date()
  return prisma.managerApproval.create({ data: {
    id: randomUUID(), tenantId: i.tenantId, deviceId: i.deviceId, entity: i.entity, action: i.action, recordId: String((i.payload as any)?.id ?? ""),
    materialDigest: materialDigest(material), material: material as any, permission: i.permissions[0], permissions: i.permissions,
    approverId: i.approver.id, approverName: i.approver.name, requestedById: i.requestedById, sessionChecked: i.sessionChecked,
    createdAt: now, expiresAt: new Date(now.getTime() + APPROVAL_SECONDS * 1000),
  } })
}

/**
 * Checks an approval presented with an operation received from `deviceId` (the enrolled register whose
 * credential came with it). `actor`: the person this server verified acting (a valid staff session),
 * else the person the command names. The approver's standing is checked again now.
 */
export async function checkApproval(tenantId: string, approvalId: unknown, op: { id: string; entity: string; action: string; payload?: unknown }, deviceId: string | null, actor: { sessionStaffId: string | null; claimedActorId: string | null } = { sessionStaffId: null, claimedActorId: null }): Promise<ApprovalSeen | null> {
  if (typeof approvalId !== "string" || !approvalId) return null
  const a = await prisma.managerApproval.findUnique({ where: { id: approvalId } })
  const seen = (check: ApprovalCheck): ApprovalSeen => a && a.tenantId === tenantId
    ? { check, id: approvalId, permission: a.permission, permissions: permissionsOf(a), approverId: a.approverId, approverName: a.approverName, requestedById: a.requestedById, materialDigest: a.materialDigest, issuedAt: a.createdAt.toISOString(), expiresAt: a.expiresAt.toISOString(), consumedAt: (a.usedAt ?? new Date()).toISOString() }
    : { check, id: approvalId, permission: null, approverId: null, approverName: null }
  if (!a) return seen("unknown")
  if (a.tenantId !== tenantId) return seen("other-store")
  if (!deviceId || a.deviceId !== deviceId) return seen("other-device")
  if (a.entity !== op.entity || a.action !== op.action || String((op.payload as any)?.id ?? "") !== a.recordId) return seen("other-record")
  const material = materialOf(op.entity, op.action, op.payload, permissionsOf(a))
  if (!material || materialDigest(material) !== a.materialDigest) return seen("changed")
  // the approval was for the person signed in when the manager approved: another person cannot use it
  if (a.requestedById) {
    const actorId = actor.sessionStaffId ?? actor.claimedActorId
    if (actorId && actorId !== a.requestedById) return seen("other-actor")
  }
  if (a.usedByOpId && a.usedByOpId !== op.id) return seen("used-by-another-operation")
  if (!a.usedByOpId) {
    if (a.cancelledAt) return seen("cancelled")
    if (a.expiresAt.getTime() < Date.now()) return seen("expired")
  }
  const approver = await prisma.staffUser.findFirst({ where: { id: a.approverId, tenantId }, select: { active: true, role: true, permissions: true } })
  if (!approver || !approver.active) return seen("approver-inactive")
  const { effectivePermissions } = await import("./permissions.js")
  const held = effectivePermissions(approver.permissions as any, approver.role) as string[]
  if (!permissionsOf(a).every((p) => held.includes(p))) return seen("approver-lacks-permission")
  return seen("valid")
}

/**
 * A hub's approval, as the hub checked it and signed it, for an operation forwarded to this server. The
 * hub vouches for the PIN check, the register and the lifetime; this server checks that the approval was
 * for THIS command (same material digest), that the hub says it was used in time, and that it was for
 * the permissions it grants. It does not re-check the lifetime: forwarding may happen much later.
 */
export function relayedApprovalHolds(seen: ApprovalSeen | undefined, op: { entity: string; action: string; payload?: unknown }): { holds: boolean; permissions: string[]; reason: string | null } {
  if (!seen || seen.check !== "valid") return { holds: false, permissions: [], reason: seen ? `hub-${seen.check}` : null }
  const permissions = Array.isArray(seen.permissions) && seen.permissions.length ? seen.permissions.map(String) : typeof seen.permission === "string" ? [seen.permission] : []
  const allowed = APPROVABLE[`${op.entity}:${op.action}`] ?? []
  if (!permissions.length || !permissions.every((p) => allowed.includes(p))) return { holds: false, permissions: [], reason: "not-approvable" }
  // an approval relayed by a hub of an earlier version carries no digest: its permission is not granted here
  if (typeof seen.materialDigest !== "string") return { holds: false, permissions: [], reason: "no-digest" }
  const material = materialOf(op.entity, op.action, op.payload, permissions)
  if (!material || materialDigest(material) !== seen.materialDigest) return { holds: false, permissions: [], reason: "changed" }
  if (seen.consumedAt && seen.expiresAt && Date.parse(seen.consumedAt) > Date.parse(seen.expiresAt)) return { holds: false, permissions: [], reason: "used-after-expiry" }
  return { holds: true, permissions, reason: null }
}

/** Marks the approval used by `opId` (in the transaction that applies it). Idempotent for that op. */
export async function useApproval(db: Pick<typeof prisma, "managerApproval">, approvalId: string, opId: string): Promise<boolean> {
  const n = await db.managerApproval.updateMany({ where: { id: approvalId, usedByOpId: null }, data: { usedAt: new Date(), usedByOpId: opId } })
  if (n.count === 1) return true
  // an exact retry of the operation that used it: when it was used stays as recorded
  return (await db.managerApproval.count({ where: { id: approvalId, usedByOpId: opId } })) === 1
}
