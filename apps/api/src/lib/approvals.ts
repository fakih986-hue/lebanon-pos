/**
 * SPRINT-2 Phase E — online manager approval (docs/SPRINT-2-AUTHORIZATION-MATRIX.md §4).
 *
 * The person at the register stays the actor. A manager authenticates again, here, with their PIN, for
 * ONE business record (entity, action, record id) with its material values (amounts, lines, currency,
 * method), on one enrolled register, for one permission. The approval is single use: the first
 * operation presenting it within its lifetime uses it, and only that operation may present it again
 * (an exact retry). Editing the material values, the action or the record means another approval.
 *
 * Lifetime (policy): APPROVAL_SECONDS from the manager's PIN check until the operation first reaches
 * this server. An approved operation delayed past that (the register lost its connection) is not
 * applied on the approval: it is refused and kept for a manager's review, never lost or re-charged.
 *
 * Online only. There is no offline manager approval (the offline elevated-action policy is unchanged).
 */
import { createHash, randomUUID } from "node:crypto"
import prisma from "./prisma.js"

export const APPROVAL_SECONDS = 120

/** What may be approved, and with which permission (existing permissions; no thresholds). */
export const APPROVABLE: Record<string, string[]> = {
  "sale:create": ["sales.discount", "sales.price_override", "inventory.manage"],
  "sale:void": ["sales.void"],
  "refund:create": ["sales.refund"],
  "cash-movement:create": ["cash.manage"],
  "inventory:adjust": ["inventory.adjust"],
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object") return `{${Object.keys(value as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`
  return JSON.stringify(value ?? null)
}
const num = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(v))
const str = (v: unknown) => (v === undefined || v === null ? null : String(v))

/**
 * The material values of an operation: what a manager approves. Timestamps, names and display text are
 * not material; amounts, quantities, prices, lines, method, direction and the record are.
 */
export function materialOf(entity: string, action: string, payload: unknown): Record<string, unknown> | null {
  const p = (payload ?? {}) as Record<string, any>
  const lines = (items: unknown) => (Array.isArray(items) ? items : []).map((i: any) => ({
    line: str(i?.saleLineId ?? i?.lineId), product: str(i?.productSyncId ?? i?.id ?? i?.productId), quantity: num(i?.quantity), unitPrice: num(i?.unitPrice), total: num(i?.total), discount: num(i?.discount ?? i?.discountAmount),
  })).sort((a, b) => canonical(a).localeCompare(canonical(b)))
  switch (`${entity}:${action}`) {
    case "sale:create": return { id: str(p.id), total: num(p.total), subtotal: num(p.subtotal), discountTotal: num(p.discountTotal ?? p.discount), paymentMethod: str(p.paymentMethod), items: lines(p.items) }
    case "sale:void": return { id: str(p.id) }
    case "refund:create": return { id: str(p.id), saleId: str(p.saleId), method: str(p.method), total: num(p.total), items: lines(p.items).map(({ total: _t, discount: _d, ...l }) => l) }
    case "cash-movement:create": return { id: str(p.id), type: str(p.type), direction: str(p.direction), amountUsd: num(p.amountUsd), amountLbp: num(p.amountLbp) }
    case "inventory:adjust": return { id: str(p.id), product: str(p.productSyncId ?? p.productId), quantityChange: num(p.quantityChange), reason: str(p.reason) }
    default: return null
  }
}
export const materialDigest = (material: Record<string, unknown>) => createHash("sha256").update(canonical(material)).digest("hex")

export type ApprovalCheck = "valid" | "unknown" | "other-store" | "other-device" | "other-record" | "changed" | "expired" | "cancelled" | "used-by-another-operation" | "approver-inactive" | "approver-lacks-permission"
export type ApprovalSeen = { check: ApprovalCheck; id: string; permission: string | null; approverId: string | null; approverName: string | null }

export async function createApproval(i: { tenantId: string; deviceId: string; entity: string; action: string; payload: unknown; permission: string; approver: { id: string; name: string }; requestedById: string | null; sessionChecked: boolean }) {
  const material = materialOf(i.entity, i.action, i.payload)!
  const now = new Date()
  return prisma.managerApproval.create({ data: {
    id: randomUUID(), tenantId: i.tenantId, deviceId: i.deviceId, entity: i.entity, action: i.action, recordId: String(material.id ?? ""),
    materialDigest: materialDigest(material), material: material as any, permission: i.permission,
    approverId: i.approver.id, approverName: i.approver.name, requestedById: i.requestedById, sessionChecked: i.sessionChecked,
    createdAt: now, expiresAt: new Date(now.getTime() + APPROVAL_SECONDS * 1000),
  } })
}

/**
 * Checks an approval presented with an operation received from `deviceId` (the enrolled register whose
 * credential came with it). The approver's standing is checked again now.
 */
export async function checkApproval(tenantId: string, approvalId: unknown, op: { id: string; entity: string; action: string; payload?: unknown }, deviceId: string | null): Promise<ApprovalSeen | null> {
  if (typeof approvalId !== "string" || !approvalId) return null
  const a = await prisma.managerApproval.findUnique({ where: { id: approvalId } })
  const seen = (check: ApprovalCheck): ApprovalSeen => ({ check, id: approvalId, permission: a?.permission ?? null, approverId: a?.approverId ?? null, approverName: a?.approverName ?? null })
  if (!a) return seen("unknown")
  if (a.tenantId !== tenantId) return { check: "other-store", id: approvalId, permission: null, approverId: null, approverName: null }
  if (!deviceId || a.deviceId !== deviceId) return seen("other-device")
  const material = materialOf(op.entity, op.action, op.payload)
  if (a.entity !== op.entity || a.action !== op.action || !material || String(material.id ?? "") !== a.recordId) return seen("other-record")
  if (materialDigest(material) !== a.materialDigest) return seen("changed")
  if (a.usedByOpId && a.usedByOpId !== op.id) return seen("used-by-another-operation")
  if (!a.usedByOpId) {
    if (a.cancelledAt) return seen("cancelled")
    if (a.expiresAt.getTime() < Date.now()) return seen("expired")
  }
  const approver = await prisma.staffUser.findFirst({ where: { id: a.approverId, tenantId }, select: { active: true, role: true, permissions: true } })
  if (!approver || !approver.active) return seen("approver-inactive")
  const { effectivePermissions } = await import("./permissions.js")
  if (!effectivePermissions(approver.permissions as any, approver.role).includes(a.permission as any)) return seen("approver-lacks-permission")
  return seen("valid")
}

/** Marks the approval used by `opId` (in the transaction that applies it). Idempotent for that op. */
export async function useApproval(db: Pick<typeof prisma, "managerApproval">, approvalId: string, opId: string): Promise<boolean> {
  const n = await db.managerApproval.updateMany({ where: { id: approvalId, OR: [{ usedByOpId: null }, { usedByOpId: opId }] }, data: { usedAt: new Date(), usedByOpId: opId } })
  return n.count === 1
}
