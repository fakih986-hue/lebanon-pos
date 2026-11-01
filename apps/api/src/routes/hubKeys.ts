/**
 * SPRINT-2 Phase D — enrolled hub signing keys (the cloud side; lib/hubAttestation.ts).
 *
 * POST /api/hub-keys/enroll      the store's hub link (x-cloud-key) + { kid, publicPem, pin, staffId? }.
 *                                The PIN of an active staff member of THIS store with settings.manage is
 *                                checked here, by the cloud: the cloud key alone (what every sync carries)
 *                                can never enroll a key. The new key becomes the store's ACTIVE key; the
 *                                previous one is ROTATED (accepted only for what it signed before).
 * GET  /api/hub-keys             settings.manage: the store's keys (no key material).
 * POST /api/hub-keys/:kid/revoke settings.manage + { note }: never accepted again.
 */
import { Router } from "express"
import { createPublicKey } from "node:crypto"
import { z } from "zod"
import type { ServerResponse } from "node:http"
import prisma from "../lib/prisma.js"
import { json, requireAuth, type AuthRequest } from "../middleware/auth.js"
import { requireCloudOrJwtAuth } from "../middleware/cloudAuth.js"
import { requirePermission } from "../middleware/permission.js"
import { verifyStaffPin } from "../lib/staffPin.js"

const router = Router()

const enrollSchema = z.object({
  kid: z.string().regex(/^hub-[0-9a-f-]{36}$/),
  publicPem: z.string().min(50).max(1000),
  pin: z.string().min(1).max(32),
  staffId: z.string().min(1).max(64).optional(),
})

router.post("/enroll", requireCloudOrJwtAuth, async (req: AuthRequest, res: ServerResponse) => {
  if (req.auth?.userId !== "cloud-bridge") { json(res, { error: "Only the store's hub can enroll its key.", code: "HUB_LINK_REQUIRED" }, 403); return }
  const tenantId = req.auth.tenantId
  const parsed = enrollSchema.safeParse(req.body)
  if (!parsed.success) { json(res, { error: "kid, publicPem and the owner's PIN are required", code: "INVALID" }, 400); return }
  const { kid, publicPem, pin, staffId } = parsed.data
  try {
    const k = createPublicKey(publicPem)
    if (k.asymmetricKeyType !== "ec" || (k.asymmetricKeyDetails as { namedCurve?: string } | undefined)?.namedCurve !== "prime256v1") throw new Error("not P-256")
  } catch { json(res, { error: "The key must be an EC P-256 public key.", code: "INVALID_KEY" }, 400); return }
  const who = await verifyStaffPin(tenantId, pin, staffId)
  if (!who.ok) {
    await audit(tenantId, "hub.key.refused", `A hub key enrollment was refused: ${who.code === "AMBIGUOUS_PIN" ? "the PIN belongs to more than one person" : "wrong PIN"}`, { kid })
    if (who.code === "AMBIGUOUS_PIN") { json(res, { error: "This PIN belongs to more than one staff member. Choose who is authorizing.", code: "AMBIGUOUS_PIN", candidates: who.candidates }, 409); return }
    json(res, { error: "Invalid credentials", code: "INVALID_PIN" }, 401); return
  }
  if (!who.staff.permissions.includes("settings.manage")) {
    await audit(tenantId, "hub.key.refused", `${who.staff.name} may not enroll a hub key (settings.manage)`, { kid, staffId: who.staff.id })
    json(res, { error: `${who.staff.name} is not allowed to enroll a hub (Settings permission).`, code: "FORBIDDEN" }, 403); return
  }
  if (await prisma.hubKey.findUnique({ where: { kid } })) { json(res, { error: "This key is already enrolled.", code: "KEY_EXISTS" }, 409); return }
  const now = new Date()
  await prisma.$transaction([
    prisma.hubKey.updateMany({ where: { tenantId, status: "ACTIVE" }, data: { status: "ROTATED", rotatedAt: now } }),
    prisma.hubKey.create({ data: { kid, tenantId, publicPem, status: "ACTIVE", enrolledById: who.staff.id, enrolledAt: now } }),
  ])
  await audit(tenantId, "hub.key.enrolled", `${who.staff.name} enrolled the hub's signing key ${kid}`, { kid, staffId: who.staff.id })
  json(res, { ok: true, kid, enrolledAt: now.toISOString(), enrolledBy: { id: who.staff.id, name: who.staff.name } })
})

router.get("/", requireAuth, requirePermission("settings.manage"), async (req: AuthRequest, res: ServerResponse) => {
  const keys = await prisma.hubKey.findMany({ where: { tenantId: req.auth!.tenantId }, orderBy: { enrolledAt: "desc" }, select: { kid: true, status: true, enrolledById: true, enrolledAt: true, rotatedAt: true, revokedAt: true, revokedById: true, revokeNote: true } })
  json(res, { keys })
})

router.post("/:kid/revoke", requireAuth, requirePermission("settings.manage"), async (req: AuthRequest, res: ServerResponse) => {
  const note = String((req.body as { note?: unknown } | undefined)?.note ?? "").trim()
  if (note.length < 3) { json(res, { error: "Write why the key is revoked (at least 3 characters).", code: "INVALID" }, 400); return }
  const tenantId = req.auth!.tenantId
  const n = await prisma.hubKey.updateMany({ where: { kid: String(req.params?.kid ?? ""), tenantId, status: { not: "REVOKED" } }, data: { status: "REVOKED", revokedAt: new Date(), revokedById: req.auth!.userId, revokeNote: note } })
  if (n.count === 0) { json(res, { error: "Not found", code: "NOT_FOUND" }, 404); return }
  await audit(tenantId, "hub.key.revoked", `Hub key ${req.params?.kid} revoked: ${note}`, { kid: req.params?.kid, by: req.auth!.userId })
  json(res, { ok: true })
})

async function audit(tenantId: string, action: string, summary: string, metadata: Record<string, unknown>) {
  try {
    await prisma.auditEvent.create({ data: { tenantId, action, entity: "security", summary, metadata: metadata as any, userId: "system", userName: "", userRole: "Admin" } })
  } catch { /* best-effort audit */ }
}

export default router
