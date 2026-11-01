/**
 * SPRINT-2 Phase E — online manager approval (lib/approvals.ts).
 *
 * POST /api/approvals              connection token + x-device-credential (an enrolled register of this
 *                                  store) [+ x-staff-session: the person at the register] + { entity,
 *                                  action, payload, permission, pin, approverId? }. The manager's PIN is
 *                                  checked now; they must hold `permission`, which must be one this
 *                                  action can be approved with. Returns a single-use approval id bound to
 *                                  this register, this record and its material values. The register's
 *                                  signed-in person and its connection are not changed.
 * POST /api/approvals/:id/cancel   same register: an unused approval is withdrawn (staff switch).
 *
 * Too many wrong PINs from one register: refused for a while (APPROVAL_LOCKED). Never returns or
 * records a PIN, a verifier or a token.
 */
import { Router } from "express"
import { z } from "zod"
import type { ServerResponse } from "node:http"
import prisma from "../lib/prisma.js"
import { json, requireAuth, tokenKind, type AuthRequest } from "../middleware/auth.js"
import { checkDevice, checkSession } from "../lib/credentials.js"
import { verifyStaffPin } from "../lib/staffPin.js"
import { APPROVABLE, APPROVAL_SECONDS, createApproval, materialOf } from "../lib/approvals.js"

const router = Router()
const MAX_FAILURES = 5
const LOCK_MINUTES = 10

const bodySchema = z.object({
  entity: z.string().min(1).max(40),
  action: z.string().min(1).max(40),
  payload: z.record(z.unknown()),
  permission: z.string().min(1).max(60),
  pin: z.string().min(1).max(32),
  approverId: z.string().min(1).max(64).optional(),
})

const header = (req: AuthRequest, name: string) => { const h = req.headers[name]; return typeof h === "string" && h ? h : undefined }

router.post("/", requireAuth, async (req: AuthRequest, res: ServerResponse) => {
  const kind = tokenKind(req.auth)
  if (kind !== "staff" && kind !== "hub-local") { json(res, { error: "Sign this register in to the store first.", code: "NOT_STAFF" }, 403); return }
  const tenantId = req.auth!.tenantId
  const parsed = bodySchema.safeParse(req.body)
  if (!parsed.success) { json(res, { error: "The action, its values, the permission and the manager's PIN are required.", code: "INVALID" }, 400); return }
  const { entity, action, payload, permission, pin, approverId } = parsed.data
  const allowed = APPROVABLE[`${entity}:${action}`]
  if (!allowed || !allowed.includes(permission)) { json(res, { error: "This action cannot be approved by a manager.", code: "NOT_APPROVABLE" }, 400); return }
  const material = materialOf(entity, action, payload)
  if (!material || typeof material.id !== "string" || !material.id) { json(res, { error: "The record to approve has no id.", code: "INVALID" }, 400); return }

  const device = await checkDevice(header(req, "x-device-credential"), tenantId)
  if (device.check !== "valid" || !device.deviceId) {
    json(res, { error: device.check === "other-store" ? "This register belongs to another store." : "Manager approval needs an enrolled register. Enroll this register first.", code: device.check === "other-store" ? "DEVICE_OTHER_STORE" : "DEVICE_NOT_ENROLLED" }, 403)
    return
  }
  const since = new Date(Date.now() - LOCK_MINUTES * 60_000)
  const failures = await prisma.auditEvent.count({ where: { tenantId, action: "approval.refused", createdAt: { gte: since }, metadata: { path: ["deviceId"], equals: device.deviceId } } })
  if (failures >= MAX_FAILURES) { json(res, { error: `Too many wrong PINs on this register. Try again in ${LOCK_MINUTES} minutes.`, code: "APPROVAL_LOCKED" }, 429); return }

  const session = await checkSession(header(req, "x-staff-session"), tenantId, device.deviceId)
  const requestedById = session.check === "valid" ? session.staffId : null

  const who = await verifyStaffPin(tenantId, pin, approverId)
  if (!who.ok) {
    if (who.code === "AMBIGUOUS_PIN") { json(res, { error: "This PIN belongs to more than one person. Choose who is approving.", code: "AMBIGUOUS_PIN", candidates: who.candidates }, 409); return }
    if (who.code === "INACTIVE") {
      await audit(tenantId, "approval.refused", `Manager approval refused: ${who.name} is no longer active (${entity} ${action})`, { deviceId: device.deviceId, entity, action, recordId: material.id })
      json(res, { error: `${who.name} is no longer an active staff member.`, code: "APPROVER_INACTIVE" }, 403); return
    }
    await audit(tenantId, "approval.refused", `Manager approval refused on ${device.name || "a register"}: wrong PIN (${entity} ${action})`, { deviceId: device.deviceId, entity, action, recordId: material.id })
    json(res, { error: "Wrong PIN.", code: "INVALID_PIN", remaining: Math.max(0, MAX_FAILURES - failures - 1) }, 401)
    return
  }
  if (!who.staff.permissions.includes(permission as any)) {
    await audit(tenantId, "approval.refused", `${who.staff.name} cannot approve ${entity} ${action} (${permission})`, { deviceId: device.deviceId, entity, action, recordId: material.id, approverId: who.staff.id })
    json(res, { error: `${who.staff.name} is not allowed to approve this (${permission}).`, code: "APPROVER_LACKS_PERMISSION" }, 403)
    return
  }
  if (requestedById && requestedById === who.staff.id) { json(res, { error: "The person signed in cannot approve their own action.", code: "SELF_APPROVAL" }, 403); return }

  const approval = await createApproval({ tenantId, deviceId: device.deviceId, entity, action, payload, permission, approver: { id: who.staff.id, name: who.staff.name }, requestedById, sessionChecked: !!requestedById })
  await audit(tenantId, "approval.granted", `${who.staff.name} approved ${entity} ${action} ${material.id} on ${device.name || "a register"} (${permission}); PIN checked by this server`, { approvalId: approval.id, deviceId: device.deviceId, entity, action, recordId: material.id, approverId: who.staff.id, requestedById, material }, who.staff)
  json(res, { approvalId: approval.id, expiresAt: approval.expiresAt.toISOString(), lifetimeSeconds: APPROVAL_SECONDS, permission, approver: { id: who.staff.id, name: who.staff.name }, material })
})

router.post("/:id/cancel", requireAuth, async (req: AuthRequest, res: ServerResponse) => {
  const tenantId = req.auth!.tenantId
  const device = await checkDevice(header(req, "x-device-credential"), tenantId)
  if (device.check !== "valid" || !device.deviceId) { json(res, { error: "Not an enrolled register.", code: "DEVICE_NOT_ENROLLED" }, 403); return }
  const n = await prisma.managerApproval.updateMany({ where: { id: String(req.params?.id ?? ""), tenantId, deviceId: device.deviceId, usedByOpId: null, cancelledAt: null }, data: { cancelledAt: new Date() } })
  json(res, { ok: true, cancelled: n.count === 1 })
})

async function audit(tenantId: string, action: string, summary: string, metadata: Record<string, unknown>, who?: { id: string; name: string; role: string }) {
  try {
    await prisma.auditEvent.create({ data: { tenantId, action, entity: "security", summary, metadata: metadata as any, userId: who?.id ?? "system", userName: who?.name ?? "", userRole: (who?.role ?? "Cashier") as any } })
  } catch { /* best-effort audit */ }
}

export default router
