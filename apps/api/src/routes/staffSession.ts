/**
 * SPRINT-2 Phase C — staff sessions for enrolled devices (observe mode).
 *
 * POST /api/auth/staff-session      x-device-credential + { pin, staffId? } → a session for that
 *                                    person on that device. A PIN is required every time: there is no
 *                                    way to obtain a session for someone else without their PIN.
 *                                    Opening one ends the device's previous session ("switched").
 * POST /api/auth/staff-session/end  x-device-credential + { session } → ends it ("signed-out").
 *
 * The till's connection token (Authorization) is NOT used or changed here: transport identity and
 * the acting person stay separate.
 */
import { Router } from "express"
import bcrypt from "bcryptjs"
import { createHash } from "node:crypto"
import { z } from "zod"
import type { ServerResponse } from "node:http"
import prisma from "../lib/prisma.js"
import { json, type AuthRequest } from "../middleware/auth.js"
import { checkDevice, checkSession, openStaffSession } from "../lib/credentials.js"

const router = Router()
const sha256 = (pin: string) => createHash("sha256").update(pin).digest("hex")
const deviceCredential = (req: AuthRequest) => {
  const h = req.headers["x-device-credential"]
  return typeof h === "string" && h ? h : undefined
}

router.post("/staff-session", async (req: AuthRequest, res: ServerResponse) => {
  const parsed = z.object({ pin: z.string().min(1).max(32), staffId: z.string().min(1).optional() }).safeParse(req.body)
  if (!parsed.success) { json(res, { error: "PIN is required" }, 400); return }
  const token = deviceCredential(req)
  const claimedTenant = typeof req.headers["x-tenant-id"] === "string" ? String(req.headers["x-tenant-id"]) : ""
  // The device credential names its store; the device record must be enrolled and current.
  const tenantId = await tenantOfDeviceCredential(token)
  if (!tenantId) { json(res, { error: "This device is not enrolled.", code: "DEVICE_NOT_ENROLLED" }, 401); return }
  if (claimedTenant && claimedTenant !== tenantId) { json(res, { error: "This device belongs to another store.", code: "DEVICE_OTHER_STORE" }, 403); return }
  const device = await checkDevice(token, tenantId)
  if (device.check !== "valid" || !device.deviceId) {
    json(res, { error: device.check === "revoked" ? "This device was revoked." : "This device's enrollment is no longer valid. Enroll it again.", code: "DEVICE_NOT_ENROLLED" }, 401)
    return
  }
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { suspended: true } })
  if (!tenant || tenant.suspended) { json(res, { error: "Tenant suspended", code: "TENANT_SUSPENDED" }, 403); return }

  const { pin, staffId } = parsed.data
  const candidates = await prisma.staffUser.findMany({
    where: { tenantId, active: true, role: { not: "Driver" }, ...(staffId ? { id: staffId } : {}) },
    select: { id: true, name: true, role: true, pin: true, tokenVersion: true },
  })
  const matched: typeof candidates = []
  for (const c of candidates) if (c.pin.startsWith("$2") ? await bcrypt.compare(pin, c.pin) : c.pin === sha256(pin)) matched.push(c)
  if (matched.length === 0) {
    await audit(tenantId, "staff.session.refused", `Staff session refused on device ${device.name || device.deviceId}: wrong PIN`, { deviceId: device.deviceId })
    json(res, { error: "Invalid credentials" }, 401)
    return
  }
  if (matched.length > 1) {
    json(res, { error: "This PIN belongs to more than one staff member. Choose who is signing in.", code: "AMBIGUOUS_PIN", candidates: matched.map((u) => ({ id: u.id, name: u.name })) }, 409)
    return
  }
  const staff = matched[0]
  const s = await openStaffSession(tenantId, device.deviceId, staff)
  await audit(tenantId, "staff.session.started", `${staff.name} started a session on ${device.name || "a device"} (PIN checked by this server)`, { deviceId: device.deviceId, staffId: staff.id, sessionId: s.sessionId }, staff)
  json(res, { session: s.token, sessionId: s.sessionId, authTime: s.authTime.toISOString(), expiresAt: s.expiresAt.toISOString(), deviceId: device.deviceId, staff: { id: staff.id, name: staff.name, role: staff.role } })
})

router.post("/staff-session/end", async (req: AuthRequest, res: ServerResponse) => {
  const session = (req.body as { session?: unknown } | undefined)?.session
  const token = deviceCredential(req)
  const tenantId = await tenantOfDeviceCredential(token)
  if (!tenantId || typeof session !== "string") { json(res, { error: "Not enrolled" }, 401); return }
  const device = await checkDevice(token, tenantId)
  const s = await checkSession(session, tenantId, device.deviceId)
  // Only the device the session belongs to can end it.
  if (!s.sessionId || (s.check !== "valid" && s.check !== "staff-inactive" && s.check !== "staff-revoked")) { json(res, { ok: true, ended: false }); return }
  const n = await prisma.staffSession.updateMany({ where: { id: s.sessionId, tenantId, endedAt: null }, data: { endedAt: new Date(), endReason: "signed-out" } })
  json(res, { ok: true, ended: n.count > 0 })
})

/** The store named inside a device credential (signature checked by checkDevice afterwards). */
async function tenantOfDeviceCredential(token: string | undefined): Promise<string | null> {
  if (!token) return null
  try {
    const part = token.split(".")[1]
    const tid = JSON.parse(Buffer.from(part, "base64url").toString("utf8"))?.tid
    if (typeof tid !== "string" || !tid) return null
    return (await checkDevice(token, tid)).check === "invalid" ? null : tid
  } catch { return null }
}

async function audit(tenantId: string, action: string, summary: string, metadata: Record<string, unknown>, who?: { id: string; name: string; role: string }) {
  try {
    await prisma.auditEvent.create({ data: { tenantId, action, entity: "security", summary, metadata: metadata as any, userId: who?.id ?? "system", userName: who?.name ?? "", userRole: (who?.role ?? "Cashier") as any } })
  } catch { /* best-effort audit */ }
}

export default router
