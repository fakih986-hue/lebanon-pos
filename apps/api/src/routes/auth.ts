import { Router } from "express"
import type { IncomingMessage, ServerResponse } from "node:http"
import bcrypt from "bcryptjs"
import { createHash } from "crypto"
import { z } from "zod"
import prisma from "../lib/prisma.js"

import { signToken, json, type AuthRequest, requireAuth } from "../middleware/auth.js"

const setupSchema = z.object({
  storeName: z.string().trim().min(1, "Store name is required"),
  subdomain: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{3,}$/, "Subdomain must be 3+ alphanumeric or hyphen characters"),
  adminName: z.string().trim().min(1, "Admin name is required"),
  adminMobile: z.string().trim().min(1, "Mobile is required"),
  adminPin: z.string().trim().min(4, "PIN must be at least 4 characters"),
})

const loginSchema = z.object({
  pin: z.string().trim().min(1, "PIN is required"),
  code: z.string().optional(),
  tenantSubdomain: z.string().trim().toLowerCase().optional(),
  role: z.enum(["Driver"]).optional(),
})

const router = Router()

function hashSha256Pin(pin: string) {
  return createHash("sha256").update(pin).digest("base64")
}

router.post("/tenant/setup", async (req: any, res: any) => {
  try {
    const parsed = setupSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message })
      return
    }
    const { storeName, subdomain, adminName, adminMobile, adminPin } = parsed.data

    const existingTenant = await prisma.tenant.findUnique({
      where: { subdomain },
    })

    if (existingTenant) {
      res.status(409).json({ error: "Subdomain is already taken" })
      return
    }

    const result = await prisma.$transaction(async (tx: any) => {
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

    const token = signToken({
      userId: result.user.id,
      tenantId: result.tenant.id,
      role: result.user.role,
    })

    res.status(201).json({
      token,
      tenant: result.tenant,
      user: {
        id: result.user.id,
        name: result.user.name,
        role: result.user.role,
        tenantId: result.user.tenantId,
        tenantName: result.tenant.name,
      },
    })
  } catch (err) {
    console.error("Tenant setup error:", err)
    res.status(500).json({ error: "Tenant setup failed" })
  }
})

router.post("/login", async (req: any, res: any) => {
  try {
    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message })
      return
    }
    const { pin, code, tenantSubdomain, role } = parsed.data

    if (role === "Driver") {
      if (!code) {
        res.status(400).json({ error: "Driver code is required" })
        return
      }
      const driver = await prisma.staffUser.findFirst({
        where: { code, role: "Driver", active: true },
        include: { tenant: true },
      })
      if (!driver) {
        res.status(401).json({ error: "Invalid credentials" })
        return
      }
      const pinMatches = driver.pin.startsWith("$2")
        ? await bcrypt.compare(pin, driver.pin)
        : driver.pin === pin || driver.pin === hashSha256Pin(pin)
      if (!pinMatches) {
        res.status(401).json({ error: "Invalid credentials" })
        return
      }
      const token = signToken({ userId: driver.id, tenantId: driver.tenantId, role: "Driver" })
      res.json({
        token, user: { id: driver.id, name: driver.name, role: "Driver", tenantId: driver.tenantId, tenantName: driver.tenant.name },
      })
      return
    }

    if (!tenantSubdomain) {
      const tenantCount = await prisma.tenant.count()
      if (tenantCount > 1) {
        res.status(400).json({ error: "Store subdomain is required" })
        return
      }
    }

    const tenantFilter = tenantSubdomain ? { tenant: { subdomain: tenantSubdomain } } : {}

    const rolePriority: Record<string, number> = { Admin: 4, Manager: 3, Cashier: 2, Driver: 1 }
    const betterRole = (a: any, b: any) =>
      (rolePriority[b.role] ?? 0) > (rolePriority[a.role] ?? 0) ? b : a

    const sha256Pin = hashSha256Pin(pin)
    const candidates = await prisma.staffUser.findMany({
      where: { active: true, ...tenantFilter },
      include: { tenant: true },
    })

    let user: any = null
    for (const candidate of candidates) {
      const matches = candidate.pin.startsWith("$2")
        ? await bcrypt.compare(pin, candidate.pin)
        : (candidate.pin === sha256Pin || candidate.pin === pin)
      if (matches) {
        user = user ? betterRole(user, candidate) : candidate
      }
    }

    if (!user) {
      res.status(401).json({ error: "Invalid credentials" })
      return
    }

    const token = signToken({
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
    })

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        tenantId: user.tenantId,
        tenantName: user.tenant.name,
      },
    })
  } catch (err) {
    console.error("Login error:", err)
    res.status(500).json({ error: "Login failed" })
  }
})

router.get("/me", requireAuth, async (req: AuthRequest, res: any) => {
  const user = await prisma.staffUser.findUnique({
    where: { id: req.auth!.userId },
    select: { id: true, name: true, mobile: true, role: true, active: true, tenantId: true },
  })
  if (!user) {
    res.status(404).json({ error: "User not found" })
    return
  }
  res.json(user)
})

export default router
