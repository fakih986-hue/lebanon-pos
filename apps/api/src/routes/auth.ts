import { Router } from "express"
import type { IncomingMessage, ServerResponse } from "node:http"
import bcrypt from "bcryptjs"
import { createHash, timingSafeEqual } from "crypto"
import { z } from "zod"
import prisma from "../lib/prisma.js"

import { signToken, json, type AuthRequest, requireAuth } from "../middleware/auth.js"
import { getCloudStatus } from "../services/cloudSync.js"

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

    const adminPinHash = await bcrypt.hash(adminPin, 12)

    const result = await prisma.$transaction(async (tx: any) => {
      const tenant = await tx.tenant.create({
        data: { name: storeName, subdomain },
      })
      const user = await tx.staffUser.create({
        data: {
          tenantId: tenant.id,
          name: adminName,
          mobile: adminMobile,
          pin: adminPinHash,
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
      if (!tenantSubdomain) {
        res.status(400).json({ error: "Store subdomain is required" })
        return
      }
      const driver = await prisma.staffUser.findFirst({
        where: { code, role: "Driver", active: true, tenant: { subdomain: tenantSubdomain } },
        include: { tenant: true },
      })
      if (!driver) {
        res.status(401).json({ error: "Invalid credentials" })
        return
      }
      if (driver.tenant?.suspended) {
        res.status(403).json({ error: "Tenant suspended", code: "TENANT_SUSPENDED" })
        return
      }
      const pinMatches = driver.pin.startsWith("$2")
        ? await bcrypt.compare(pin, driver.pin)
        : driver.pin === hashSha256Pin(pin)
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

    let effectiveSubdomain = tenantSubdomain

    if (!effectiveSubdomain) {
      const tenantCount = await prisma.tenant.count()
      if (tenantCount > 1) {
        // On the hub, fall back to the cloud-configured tenant
        const { tenantId } = getCloudStatus()
        if (tenantId) {
          const cloudTenant = await prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { subdomain: true },
          })
          if (cloudTenant?.subdomain) {
            effectiveSubdomain = cloudTenant.subdomain
          } else {
            res.status(400).json({ error: "Store subdomain is required" })
            return
          }
        } else {
          res.status(400).json({ error: "Store subdomain is required" })
          return
        }
      }
    }

    const tenantFilter = effectiveSubdomain ? { tenant: { subdomain: effectiveSubdomain } } : {}

    // ── Check tenant suspension before proceeding ──────────────────────
    if (effectiveSubdomain) {
      const tenant = await prisma.tenant.findUnique({
        where: { subdomain: effectiveSubdomain },
        select: { suspended: true },
      })
      if (tenant?.suspended) {
        res.status(403).json({ error: "Tenant suspended", code: "TENANT_SUSPENDED" })
        return
      }
    }

    // Fast path: code-based lookup using the indexed code column
    if (code) {
      const candidate = await prisma.staffUser.findFirst({
        where: { code, active: true, ...tenantFilter },
        include: { tenant: true },
      })
      if (candidate) {
        const pinMatches = candidate.pin.startsWith("$2")
          ? await bcrypt.compare(pin, candidate.pin)
          : candidate.pin === hashSha256Pin(pin)
        if (pinMatches) {
          const token = signToken({ userId: candidate.id, tenantId: candidate.tenantId, role: candidate.role })
          res.json({
            token, user: { id: candidate.id, name: candidate.name, role: candidate.role, tenantId: candidate.tenantId, tenantName: candidate.tenant.name },
          })
          // Migrate legacy SHA-256 PIN to bcrypt
          if (!candidate.pin.startsWith("$2")) {
            prisma.staffUser.update({ where: { id: candidate.id }, data: { pin: await bcrypt.hash(pin, 12) } }).catch((e) => console.error("[auth] PIN migration failed:", e))
          }
          return
        }
      }
      res.status(401).json({ error: "Invalid credentials" })
      return
    }

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
        : candidate.pin === sha256Pin
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
  try {
    const user = await prisma.staffUser.findUnique({
      where: { id: req.auth!.userId },
      select: { id: true, name: true, mobile: true, role: true, active: true, tenantId: true },
    })
    if (!user) {
      res.status(404).json({ error: "User not found" })
      return
    }
    res.json(user)
  } catch (err) {
    console.error("[auth] /me error:", err)
    res.status(500).json({ error: "Internal server error" })
  }
})

// ── Super admin code verification ──────────────────────────────────
// Rate limiter: max 5 attempts per IP per minute
const verifyRateLimit = new Map<string, { count: number; resetAt: number }>()
setInterval(() => {
  const now = Date.now()
  for (const [ip, entry] of verifyRateLimit) {
    if (entry.resetAt < now) verifyRateLimit.delete(ip)
  }
}, 60_000)

router.post("/verify-super-admin-code", async (req: any, res: any) => {
  try {
    const ip = req.socket?.remoteAddress ?? "unknown"
    const now = Date.now()
    const entry = verifyRateLimit.get(ip)
    if (entry && entry.resetAt > now) {
      if (entry.count >= 5) {
        res.status(429).json({ error: "Too many attempts. Try again later." })
        return
      }
      entry.count++
    } else {
      verifyRateLimit.set(ip, { count: 1, resetAt: now + 60_000 })
    }

    const { code } = (req.body ?? {}) as { code?: string }
    if (!code || typeof code !== "string" || code.length < 4) {
      res.status(400).json({ error: "Code must be at least 4 characters" })
      return
    }

    const storedBcrypt = process.env.SUPER_ADMIN_BCRYPT
    if (!storedBcrypt) {
      res.status(503).json({ error: "Super admin code not configured" })
      return
    }

    const valid = await bcrypt.compare(code, storedBcrypt)
    res.json({ valid })
  } catch (err) {
    console.error("Verify super admin code error:", err)
    res.status(500).json({ error: "Verification failed" })
  }
})

export default router
