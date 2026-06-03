import { Router } from "express"
import type { Response } from "express"
import { createHash } from "crypto"
import { z } from "zod"
import prisma from "../lib/prisma.js"
import { signToken, requireAuth, type AuthRequest } from "../middleware/auth.js"

function json(res: Response, data: unknown, statusCode = 200) {
  res.statusCode = statusCode
  res.setHeader("Content-Type", "application/json")
  res.end(JSON.stringify(data))
}

const router = Router()

function requireAdmin(req: AuthRequest, res: Response, next: () => void) {
  if (!req.auth || req.auth.userId !== "__admin__") {
    json(res, { error: "Admin access required" }, 403)
    return
  }
  next()
}

function hashSha256Pin(pin: string) {
  return createHash("sha256").update(pin).digest("base64")
}

const createTenantSchema = z.object({
  storeName: z.string().trim().min(1, "Store name is required"),
  subdomain: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{3,}$/, "Subdomain must be 3+ alphanumeric or hyphen characters"),
  adminName: z.string().trim().min(1, "Admin name is required"),
  adminMobile: z.string().trim().min(1, "Mobile is required"),
  adminPin: z.string().trim().min(4, "PIN must be at least 4 characters"),
})

router.post("/login", async (req: any, res: any) => {
  try {
    const { password } = req.body || {}
    const masterPassword = process.env.ADMIN_PASSWORD
    if (!masterPassword || password !== masterPassword) {
      res.status(401).json({ error: "Invalid admin credentials" })
      return
    }
    const token = signToken({ userId: "__admin__", tenantId: "", role: "Admin" })
    res.json({ token })
  } catch (err) {
    console.error("Admin login error:", err)
    res.status(500).json({ error: "Admin login failed" })
  }
})

router.get("/tenants", requireAuth, requireAdmin, async (req: AuthRequest, res: any) => {
  try {
    const tenants = await prisma.tenant.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        subdomain: true,
        createdAt: true,
        _count: { select: { users: true, products: true, sales: true } },
      },
    })
    res.json(tenants)
  } catch (err) {
    console.error("List tenants error:", err)
    res.status(500).json({ error: "Failed to list tenants" })
  }
})

router.post("/tenants", requireAuth, requireAdmin, async (req: any, res: any) => {
  try {
    const parsed = createTenantSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message })
      return
    }
    const { storeName, subdomain, adminName, adminMobile, adminPin } = parsed.data

    const existing = await prisma.tenant.findUnique({ where: { subdomain } })
    if (existing) {
      res.status(409).json({ error: "Subdomain is already taken" })
      return
    }

    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { name: storeName, subdomain },
      })
      const user = await tx.staffUser.create({
        data: {
          tenantId: tenant.id,
          name: adminName,
          mobile: adminMobile,
          pin: hashSha256Pin(adminPin),
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

    res.status(201).json({
      tenant: {
        id: result.tenant.id,
        name: result.tenant.name,
        subdomain: result.tenant.subdomain,
      },
      credentials: {
        subdomain,
        pin: adminPin,
      },
      userToken,
    })
  } catch (err) {
    console.error("Create tenant error:", err)
    res.status(500).json({ error: "Failed to create tenant" })
  }
})

export default router
