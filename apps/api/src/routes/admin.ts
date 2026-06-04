import { Router } from "express"
import { timingSafeEqual, randomInt, randomBytes } from "crypto"
import { z } from "zod"
import bcrypt from "bcryptjs"
import type { ServerResponse } from "node:http"
import prisma from "../lib/prisma.js"
import { signToken, requireAuth, json } from "../middleware/auth.js"
import type { AuthRequest } from "../middleware/auth.js"

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

/** Generate a per-tenant cloud sync API key (64-char hex) */
function generateCloudApiKey(): string {
  return randomBytes(32).toString("hex")
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
})

router.post("/login", async (req: AuthRequest, res: ServerResponse) => {
  try {
    const { password } = (req.body as { password?: string }) || {}
    const masterPassword = process.env.ADMIN_PASSWORD ?? ""
    // Always run timingSafeEqual to prevent timing attacks (even when password missing)
    const inputBuf = Buffer.from(password ?? "")
    const masterBuf = Buffer.from(masterPassword)
    const passwordsMatch =
      inputBuf.length > 0 &&
      masterBuf.length > 0 &&
      inputBuf.length === masterBuf.length &&
      timingSafeEqual(inputBuf, masterBuf)
    if (!masterPassword || !passwordsMatch) {
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
      select: { id: true, name: true, subdomain: true, suspended: true, createdAt: true },
    })
    if (!tenant) { json(res, { error: "Tenant not found" }, 404); return }
    json(res, tenant)
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
    const updated = await prisma.tenant.update({
      where: { id: req.params?.id },
      data: parsed.data,
      select: { id: true, name: true, subdomain: true, suspended: true, createdAt: true },
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

export default router
