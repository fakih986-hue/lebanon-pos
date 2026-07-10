import { Router } from "express"
import { randomBytes } from "crypto"
import { z } from "zod"
import type { ServerResponse } from "node:http"
import prisma from "../lib/prisma.js"
import { json, type AuthRequest, requireAuth } from "../middleware/auth.js"

const pairSchema = z.object({
  code: z.string().min(1, "Pairing code is required"),
  deviceId: z.string().min(1, "deviceId is required"),
  deviceName: z.string().default(""),
})

const renameSchema = z.object({
  deviceId: z.string().min(1, "deviceId is required"),
  deviceName: z.string().min(1, "Device name is required"),
})

const revokeSchema = z.object({
  deviceId: z.string().min(1, "deviceId is required"),
})

const router = Router()

function generateCode(): string {
  return randomBytes(3).toString("hex").toUpperCase()
}

router.post("/device/generate-code", requireAuth, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const tenantId = req.auth!.tenantId
    const code = generateCode()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000)
    await prisma.pairingCode.create({
      data: { tenantId, code, expiresAt },
    })
    await prisma.auditEvent.create({
      data: {
        tenantId,
        action: "pairing.code.generated",
        entity: "device",
        summary: "Pairing code generated",
        userId: req.auth!.userId,
        userName: "system",
        userRole: "Admin",
      },
    })
    json(res, { ok: true, code, expiresAt: expiresAt.toISOString() })
  } catch (err) {
    json(res, { error: err instanceof Error ? err.message : "Failed to generate pairing code" }, 500)
  }
})

router.post("/device/pair", async (req: AuthRequest, res: ServerResponse) => {
  try {
    const body = pairSchema.parse(req.body)
    const now = new Date()
    const pairingCode = await prisma.pairingCode.findUnique({
      where: { code: body.code },
    })
    if (!pairingCode) { json(res, { error: "Invalid pairing code" }, 403); return }
    if (pairingCode.usedAt) { json(res, { error: "Pairing code already used" }, 403); return }
    if (now > pairingCode.expiresAt) { json(res, { error: "Pairing code has expired" }, 403); return }
    const tenantId = pairingCode.tenantId
    await prisma.pairingCode.update({
      where: { id: pairingCode.id },
      data: { usedAt: now, deviceId: body.deviceId, deviceName: body.deviceName },
    })
    await prisma.device.upsert({
      where: { tenantId_deviceId: { tenantId, deviceId: body.deviceId } },
      create: {
        tenantId,
        deviceId: body.deviceId,
        deviceName: body.deviceName,
        status: "APPROVED",
        firstSeenAt: now,
        lastSeenAt: now,
      },
      update: {
        deviceName: body.deviceName,
        status: "APPROVED",
        lastSeenAt: now,
      },
    })
    await prisma.auditEvent.create({
      data: {
        tenantId,
        action: "device.paired",
        entity: "device",
        summary: `Device ${body.deviceId} paired`,
        metadata: { deviceId: body.deviceId },
        userId: "system",
        userName: body.deviceName || "unknown",
        userRole: "Admin",
      },
    })
    json(res, { ok: true, deviceId: body.deviceId })
  } catch (err) {
    if (err instanceof z.ZodError) { json(res, { error: err.errors[0]?.message ?? "Invalid input" }, 400); return }
    json(res, { error: err instanceof Error ? err.message : "Pairing failed" }, 500)
  }
})

router.get("/device/list", requireAuth, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const tenantId = req.auth!.tenantId
    const devices = await prisma.device.findMany({
      where: { tenantId },
      orderBy: { lastSeenAt: "desc" },
    })
    json(res, devices)
  } catch (err) {
    json(res, { error: err instanceof Error ? err.message : "Failed to list devices" }, 500)
  }
})

router.post("/device/rename", requireAuth, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const body = renameSchema.parse(req.body)
    const tenantId = req.auth!.tenantId
    await prisma.device.update({
      where: { tenantId_deviceId: { tenantId, deviceId: body.deviceId } },
      data: { deviceName: body.deviceName },
    })
    await prisma.auditEvent.create({
      data: {
        tenantId,
        action: "device.renamed",
        entity: "device",
        summary: `Device ${body.deviceId} renamed to ${body.deviceName}`,
        metadata: { deviceId: body.deviceId, deviceName: body.deviceName },
        userId: req.auth!.userId,
        userName: "system",
        userRole: "Admin",
      },
    })
    json(res, { ok: true })
  } catch (err) {
    if (err instanceof z.ZodError) { json(res, { error: err.errors[0]?.message ?? "Invalid input" }, 400); return }
    json(res, { error: err instanceof Error ? err.message : "Failed to rename device" }, 500)
  }
})

router.post("/device/register-hub", requireAuth, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const tenantId = req.auth!.tenantId
    const body = z.object({
      deviceId: z.string().min(1),
      deviceName: z.string().default(""),
    }).parse(req.body)
    const now = new Date()
    await prisma.device.upsert({
      where: { tenantId_deviceId: { tenantId, deviceId: body.deviceId } },
      create: {
        tenantId,
        deviceId: body.deviceId,
        deviceName: body.deviceName,
        status: "APPROVED",
        firstSeenAt: now,
        lastSeenAt: now,
      },
      update: { status: "APPROVED", lastSeenAt: now },
    })
    await prisma.auditEvent.create({
      data: {
        tenantId,
        action: "device.hub.registered",
        entity: "device",
        summary: `Hub device ${body.deviceId} auto-registered`,
        metadata: { deviceId: body.deviceId },
        userId: req.auth!.userId,
        userName: "system",
        userRole: "Admin",
      },
    })
    json(res, { ok: true, deviceId: body.deviceId })
  } catch (err) {
    if (err instanceof z.ZodError) { json(res, { error: err.errors[0]?.message ?? "Invalid input" }, 400); return }
    json(res, { error: err instanceof Error ? err.message : "Registration failed" }, 500)
  }
})

router.post("/device/revoke", requireAuth, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const body = revokeSchema.parse(req.body)
    const tenantId = req.auth!.tenantId
    const device = await prisma.device.findUnique({
      where: { tenantId_deviceId: { tenantId, deviceId: body.deviceId } },
    })
    if (!device) { json(res, { error: "Device not found" }, 404); return }
    await prisma.device.update({
      where: { id: device.id },
      data: { status: "REVOKED" },
    })
    await prisma.auditEvent.create({
      data: {
        tenantId,
        action: "device.revoked",
        entity: "device",
        summary: `Device ${body.deviceId} revoked`,
        metadata: { deviceId: body.deviceId },
        userId: req.auth!.userId,
        userName: "system",
        userRole: "Admin",
      },
    })
    json(res, { ok: true })
  } catch (err) {
    if (err instanceof z.ZodError) { json(res, { error: err.errors[0]?.message ?? "Invalid input" }, 400); return }
    json(res, { error: err instanceof Error ? err.message : "Failed to revoke device" }, 500)
  }
})

export default router
