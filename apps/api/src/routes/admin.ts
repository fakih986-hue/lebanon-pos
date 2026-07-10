import { Router } from "express"
import { timingSafeEqual, randomInt, createHash } from "crypto"
import { z } from "zod"
import bcrypt from "bcryptjs"
import type { ServerResponse } from "node:http"
import prisma from "../lib/prisma.js"
import { signToken, requireAuth, json } from "../middleware/auth.js"
import type { AuthRequest } from "../middleware/auth.js"
import { generateCloudApiKey } from "../lib/cloudKey.js"

const router = Router()

function requireAdmin(req: AuthRequest, res: ServerResponse, next: (err?: unknown) => void) {
  if (!req.auth || req.auth.userId !== "__admin__") {
    json(res, { error: "Admin access required" }, 403)
    return
  }
  next()
}

/** Generate a random numeric PIN of the given length */
function generateRandomPin(length = 6): string {
  return Array.from({ length }, () => randomInt(0, 10)).join("")
}

const createTenantSchema = z.object({
  storeName: z.string().trim().min(1, "Store name is required"),
  subdomain: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{3,}$/, "Subdomain must be 3+ alphanumeric or hyphen characters"),
  adminName: z.string().trim().min(1, "Admin name is required"),
  adminMobile: z.string().trim().min(1, "Mobile is required"),
  adminPin: z.string().trim().min(4, "PIN must be at least 4 characters"),
})

const updateTenantSchema = z.object({
  name: z.string().trim().min(1).optional(),
  subdomain: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{3,}$/).optional(),
  suspended: z.boolean().optional(),
  licenseReason: z.string().optional(),
  licenseMessage: z.string().optional(),
  offlineGraceDays: z.number().int().min(1).max(90).optional(),
  planName: z.string().optional(),
  trialStartDate: z.string().optional(),
  trialEndDate: z.string().optional(),
  subscriptionStart: z.string().optional(),
  subscriptionEnd: z.string().optional(),
  renewalDate: z.string().optional(),
  billingContact: z.string().optional(),
  internalNotes: z.string().optional(),
})

const loginSchema = z.object({
  password: z.string().min(1, "Password is required"),
})

router.post("/login", async (req: AuthRequest, res: ServerResponse) => {
  try {
    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) {
      json(res, { error: "Password is required" }, 400)
      return
    }
    const { password } = parsed.data
    const masterPassword = process.env.ADMIN_PASSWORD ?? ""
    const masterHash = process.env.ADMIN_PASSWORD_HASH ?? ""

    let passwordsMatch = false

    if (masterHash) {
      // Bcrypt comparison (production mode)
      passwordsMatch = masterPassword.length > 0 && Buffer.from(password ?? "").length > 0 && await bcrypt.compare(password ?? "", masterHash)
    } else if (masterPassword) {
      // Fallback: plaintext comparison (first-run, before hash is generated)
      passwordsMatch = password === masterPassword
      // Generate bcrypt hash for future use
      const newHash = await bcrypt.hash(masterPassword, 12)
      if (process.env.NODE_ENV !== "production") {
        console.log("[admin] ADMIN_PASSWORD_HASH:", newHash)
      }
    }

    if (!passwordsMatch) {
      json(res, { error: "Invalid admin credentials" }, 401)
      return
    }
    const token = signToken({ userId: "__admin__", tenantId: "", role: "Admin" })
    json(res, { token })
  } catch (err) {
    console.error("Admin login error:", err)
    json(res, { error: "Admin login failed" }, 500)
  }
})

router.get("/tenants", requireAuth, requireAdmin, async (_req: AuthRequest, res: ServerResponse) => {
  try {
    const tenants = await prisma.tenant.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        subdomain: true,
        suspended: true,
        createdAt: true,
        _count: { select: { users: true, products: true, sales: true } },
      },
    })
    json(res, tenants)
  } catch (err) {
    console.error("List tenants error:", err)
    json(res, { error: "Failed to list tenants" }, 500)
  }
})

router.get("/tenants/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.params?.id },
      select: { id: true, name: true, subdomain: true, suspended: true, cloudApiKey: true, createdAt: true, licenseStatus: true, policyVersion: true },
    })
    if (!tenant) { json(res, { error: "Tenant not found" }, 404); return }
    // Mask cloud API key — only show first 8 and last 4 chars
    const masked = {
      ...tenant,
      cloudApiKey: tenant.cloudApiKey
        ? `${tenant.cloudApiKey.substring(0, 8)}...${tenant.cloudApiKey.substring(tenant.cloudApiKey.length - 4)}`
        : "",
    }
    json(res, masked)
  } catch (err) {
    console.error("Get tenant error:", err)
    json(res, { error: "Failed to get tenant" }, 500)
  }
})

router.put("/tenants/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const parsed = updateTenantSchema.safeParse(req.body)
    if (!parsed.success) {
      json(res, { error: parsed.error.errors[0].message }, 400)
      return
    }
    const tenant = await prisma.tenant.findUnique({ where: { id: req.params?.id } })
    if (!tenant) { json(res, { error: "Tenant not found" }, 404); return }
    if (parsed.data.subdomain && parsed.data.subdomain !== tenant.subdomain) {
      const existing = await prisma.tenant.findUnique({ where: { subdomain: parsed.data.subdomain } })
      if (existing) { json(res, { error: "Subdomain is already taken" }, 409); return }
    }
    // Build update data
    const { suspended, licenseReason, licenseMessage, offlineGraceDays, ...rest } = parsed.data
    const data: any = { ...rest }
    if (typeof suspended === "boolean") {
      data.suspended = suspended
      data.licenseStatus = suspended ? "suspended" : "active"
      data.suspendedAt = suspended ? new Date() : null
      data.leaseExpiresAt = null
      data.policyVersion = { increment: 1 }
    }
    if (licenseReason !== undefined) data.licenseReason = licenseReason
    if (licenseMessage !== undefined) data.licenseMessage = licenseMessage
    if (offlineGraceDays !== undefined) data.offlineGraceDays = offlineGraceDays
    // Subscription fields: forward directly
    if (parsed.data.planName !== undefined) data.planName = parsed.data.planName
    if (parsed.data.trialStartDate !== undefined) data.trialStartDate = parsed.data.trialStartDate ? new Date(parsed.data.trialStartDate) : null
    if (parsed.data.trialEndDate !== undefined) data.trialEndDate = parsed.data.trialEndDate ? new Date(parsed.data.trialEndDate) : null
    if (parsed.data.subscriptionStart !== undefined) data.subscriptionStart = parsed.data.subscriptionStart ? new Date(parsed.data.subscriptionStart) : null
    if (parsed.data.subscriptionEnd !== undefined) data.subscriptionEnd = parsed.data.subscriptionEnd ? new Date(parsed.data.subscriptionEnd) : null
    if (parsed.data.renewalDate !== undefined) data.renewalDate = parsed.data.renewalDate ? new Date(parsed.data.renewalDate) : null
    if (parsed.data.billingContact !== undefined) data.billingContact = parsed.data.billingContact
    if (parsed.data.internalNotes !== undefined) data.internalNotes = parsed.data.internalNotes

    // Record audit event for license state changes
    if (typeof suspended === "boolean" && suspended !== tenant.suspended) {
      const action = suspended ? "tenant.suspend" : "tenant.resume"
      await prisma.auditEvent.create({
        data: {
          tenantId: tenant.id,
          action, entity: "tenant",
          summary: `Store "${tenant.name}" ${suspended ? "suspended" : "resumed"} by admin`,
          userId: req.auth!.userId, userName: "Admin", userRole: "Admin",
        },
      })
    }

    const updated = await prisma.tenant.update({
      where: { id: req.params?.id },
      data,
      select: { id: true, name: true, subdomain: true, suspended: true, licenseStatus: true, licenseReason: true, licenseMessage: true, suspendedAt: true, offlineGraceDays: true, policyVersion: true, planName: true, trialStartDate: true, trialEndDate: true, subscriptionStart: true, subscriptionEnd: true, renewalDate: true, billingContact: true, internalNotes: true, createdAt: true },
    })
    json(res, updated)
  } catch (err) {
    console.error("Update tenant error:", err)
    json(res, { error: "Failed to update tenant" }, 500)
  }
})

/**
 * Delete a tenant and ALL of its data. Children are removed in FK-dependency
 * order inside a transaction; tables with onDelete:Cascade (sale items, tender,
 * refund items, delivery-order items, stock-count lines, PO items) are removed
 * automatically when their parent is deleted.
 */
async function deleteTenantCascade(tenantId: string) {
  await prisma.$transaction(async (tx) => {
    const where = { tenantId }
    // 1. Records that reference customers / staff / products / suppliers
    await tx.deliveryOrder.deleteMany({ where })       // → deliveryOrderItem cascades
    await tx.saleRefund.deleteMany({ where })          // → refundItem cascades
    await tx.sale.deleteMany({ where })                // → saleItem + saleTender cascade
    await tx.debtPayment.deleteMany({ where })
    await tx.debtSale.deleteMany({ where })
    await tx.expense.deleteMany({ where })
    await tx.shift.deleteMany({ where })
    await tx.stockAdjustment.deleteMany({ where })
    await tx.stockCountSession.deleteMany({ where })   // → stockCountLine cascades
    await tx.inventoryBatch.deleteMany({ where })
    await tx.purchaseOrder.deleteMany({ where })       // → purchaseOrderItem cascades
    await tx.supplierPayment.deleteMany({ where })
    await tx.auditEvent.deleteMany({ where })
    await tx.dailyClose.deleteMany({ where })
    await tx.syncOperation.deleteMany({ where })
    // 2. Products self-reference via parentId — break the link before deleting
    await tx.product.updateMany({ where, data: { parentId: null } })
    await tx.product.deleteMany({ where })
    // 3. Now the principals
    await tx.customer.deleteMany({ where })
    await tx.supplier.deleteMany({ where })
    await tx.staffUser.deleteMany({ where })
    await tx.appSettings.deleteMany({ where })
    // 4. Finally the tenant itself
    await tx.tenant.delete({ where: { id: tenantId } })
  })
}

router.delete("/tenants/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const id = req.params?.id
    if (!id) { json(res, { error: "Tenant id required" }, 400); return }
    const tenant = await prisma.tenant.findUnique({ where: { id }, select: { id: true } })
    if (!tenant) { json(res, { error: "Tenant not found" }, 404); return }
    await deleteTenantCascade(id)
    json(res, { ok: true, deleted: id })
  } catch (err) {
    console.error("Delete tenant error:", err)
    json(res, { error: "Failed to delete tenant" }, 500)
  }
})

router.post("/tenants", requireAuth, requireAdmin, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const parsed = createTenantSchema.safeParse(req.body)
    if (!parsed.success) {
      json(res, { error: parsed.error.errors[0].message }, 400)
      return
    }
    const { storeName, subdomain, adminName, adminMobile, adminPin } = parsed.data

    const existing = await prisma.tenant.findUnique({ where: { subdomain } })
    if (existing) {
      json(res, { error: "Subdomain is already taken" }, 409)
      return
    }

    // Generate a random PIN if the caller sent the insecure default "0000" or left it empty
    const effectivePin = (!adminPin || adminPin === "0000") ? generateRandomPin(6) : adminPin
    // Per-tenant cloud sync key — handed to the store and entered in Settings → Cloud
    const cloudApiKey = generateCloudApiKey()

    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { name: storeName, subdomain, cloudApiKey },
      })
      const user = await tx.staffUser.create({
        data: {
          tenantId: tenant.id,
          name: adminName,
          mobile: adminMobile,
          // bcrypt — consistent with staff PINs from seed.ts
          pin: await bcrypt.hash(effectivePin, 12),
          role: "Admin",
          active: true,
        },
      })
      await tx.appSettings.create({
        data: {
          tenantId: tenant.id,
          storeName,
          branchName: "Main Branch",
          phone: adminMobile,
          address: "",
          vatRate: 0.11,
          usdToLbpRate: 89500,
          receiptFooter: "Thank you for your visit!",
          lowStockThreshold: 10,
        },
      })
      return { tenant, user }
    })

    const userToken = signToken({
      userId: result.user.id,
      tenantId: result.tenant.id,
      role: result.user.role,
    })

    json(res, {
      tenant: {
        id: result.tenant.id,
        name: result.tenant.name,
        subdomain: result.tenant.subdomain,
      },
      credentials: {
        tenantId:    result.tenant.id,   // operator enters this in Settings → Cloud
        subdomain,
        pin:         effectivePin,        // plain-text shown once
        cloudApiKey,                      // plain-text shown once — per-tenant sync key
      },
      userToken,
    }, 201)
  } catch (err) {
    console.error("Create tenant error:", err)
    json(res, { error: "Failed to create tenant" }, 500)
  }
})

// ── API Key Rotation ────────────────────────────────────────
router.post("/tenants/:id/rotate-key", requireAuth, requireAdmin, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.params?.id },
      select: { id: true, name: true },
    })
    if (!tenant) { json(res, { error: "Tenant not found" }, 404); return }
    const newKey = generateCloudApiKey()
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { cloudApiKey: newKey, policyVersion: { increment: 1 } },
    })
    // Return new key fully (one-time, explicit rotation action)
    json(res, { tenantId: tenant.id, cloudApiKey: newKey })
  } catch (err) {
    console.error("Rotate API key error:", err)
    json(res, { error: "Failed to rotate API key" }, 500)
  }
})

// ── Staff user management ─────────────────────────────────────────────

const resetPinSchema = z.object({
  pin: z.string().trim().min(4, "PIN must be at least 4 characters").optional(),
})

router.get("/tenants/:id/users", requireAuth, requireAdmin, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const tenant = await prisma.tenant.findUnique({ where: { id: req.params?.id }, select: { id: true } })
    if (!tenant) { json(res, { error: "Tenant not found" }, 404); return }
    const users = await prisma.staffUser.findMany({
      where: { tenantId: req.params?.id },
      orderBy: { name: "asc" },
      select: { id: true, name: true, mobile: true, code: true, role: true, active: true, createdAt: true },
    })
    json(res, users)
  } catch (err) {
    console.error("List tenant users error:", err)
    json(res, { error: "Failed to list tenant users" }, 500)
  }
})

router.post("/tenants/:id/users/:userId/reset-pin", requireAuth, requireAdmin, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const tenant = await prisma.tenant.findUnique({ where: { id: req.params?.id }, select: { id: true } })
    if (!tenant) { json(res, { error: "Tenant not found" }, 404); return }
    const user = await prisma.staffUser.findFirst({
      where: { id: req.params?.userId, tenantId: req.params?.id },
      select: { id: true, name: true },
    })
    if (!user) { json(res, { error: "User not found in this tenant" }, 404); return }
    const parsed = resetPinSchema.safeParse(req.body)
    if (!parsed.success) {
      json(res, { error: parsed.error.errors[0].message }, 400)
      return
    }
    const newPin = parsed.data.pin ?? generateRandomPin(6)

    // ── Enforce PIN uniqueness per tenant ────────────────────────────
    const existingUsers = await prisma.staffUser.findMany({
      where: { tenantId: req.params?.id, id: { not: user.id } },
      select: { id: true, name: true, pin: true },
    })
    const sha256Hash = createHash("sha256").update(newPin).digest("base64")
    for (const u of existingUsers) {
      const matches = u.pin.startsWith("$2")
        ? await bcrypt.compare(newPin, u.pin)
        : u.pin === sha256Hash
      if (matches) {
        json(res, { error: `PIN is already in use by ${u.name}` }, 409)
        return
      }
    }

    await prisma.staffUser.update({
      where: { id: user.id },
      data: { pin: await bcrypt.hash(newPin, 12), pinVersion: { increment: 1 }, tokenVersion: { increment: 1 } },
    })
    json(res, { userId: user.id, name: user.name, pin: newPin })
  } catch (err) {
    console.error("Reset PIN error:", err)
    json(res, { error: "Failed to reset PIN" }, 500)
  }
})

export default router
