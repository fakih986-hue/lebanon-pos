import { Router } from "express"
import type { IncomingMessage, ServerResponse } from "node:http"
import bcrypt from "bcryptjs"
import { createHash } from "crypto"
import prisma from "../lib/prisma.js"

import { signToken, type AuthRequest, requireAuth } from "../middleware/auth.js"
const router = Router()

function hashSha256Pin(pin: string) {
  return createHash("sha256").update(pin).digest("base64")
}

router.post("/tenant/setup", async (req: IncomingMessage & { body?: unknown }, res: ServerResponse) => {
  try {
    const {
      storeName,
      subdomain,
      adminName,
      adminMobile,
      adminPin,
    } = req.body as {
      storeName?: string
      subdomain?: string
      adminName?: string
      adminMobile?: string
      adminPin?: string
    }
    const cleanStoreName = storeName?.trim()
    const cleanSubdomain = subdomain
      ?.trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
    const cleanAdminName = adminName?.trim()
    const cleanAdminMobile = adminMobile?.trim()
    const cleanAdminPin = adminPin?.trim()

    if (
      !cleanStoreName ||
      !cleanSubdomain ||
      !cleanAdminName ||
      !cleanAdminMobile ||
      !cleanAdminPin
    ) {
      res.statusCode = 400; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ error: "Store, subdomain, admin, mobile, and PIN are required" }))
      return
    }

    if (cleanSubdomain.length < 3 || cleanAdminPin.length < 4) {
      res.statusCode = 400; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ error: "Subdomain must be 3+ chars and PIN must be 4+ chars" }))
      return
    }

    const existingTenant = await prisma.tenant.findUnique({
      where: { subdomain: cleanSubdomain },
    })

    if (existingTenant) {
      res.statusCode = 409; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ error: "Subdomain is already taken" }))
      return
    }

    const result = await prisma.$transaction(async (tx: any) => {
      const tenant = await tx.tenant.create({
        data: { name: cleanStoreName, subdomain: cleanSubdomain },
      })
      const user = await tx.staffUser.create({
        data: {
          tenantId: tenant.id,
          name: cleanAdminName,
          mobile: cleanAdminMobile,
          pin: await bcrypt.hash(cleanAdminPin, 10),
          role: "Admin",
          active: true,
        },
      })

      await tx.appSettings.create({
        data: {
          tenantId: tenant.id,
          storeName: cleanStoreName,
          branchName: "Main Branch",
          phone: cleanAdminMobile,
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

    res.statusCode = 201; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({
      token,
      tenant: result.tenant,
      user: {
        id: result.user.id,
        name: result.user.name,
        role: result.user.role,
        tenantId: result.user.tenantId,
        tenantName: result.tenant.name,
      },
    }))
  } catch (err) {
    console.error("Tenant setup error:", err)
    res.statusCode = 500; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ error: "Tenant setup failed" }))
  }
})

router.post("/login", async (req: IncomingMessage & { body?: unknown }, res: ServerResponse) => {
  try {
    const { pin, code, tenantSubdomain, role } = req.body as { pin?: string; code?: string; tenantSubdomain?: string; role?: string }
    if (!pin) {
      res.statusCode = 400; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ error: "PIN is required" }))
      return
    }
    const cleanTenantSubdomain =
      typeof tenantSubdomain === "string"
        ? tenantSubdomain.trim().toLowerCase()
        : ""

    // Driver login uses code+PIN (no subdomain needed)
    if (role === "Driver") {
      if (!code) {
        res.statusCode = 400; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ error: "Driver code is required" }))
        return
      }
      const driver = await prisma.staffUser.findFirst({
        where: { code, role: "Driver", active: true },
        include: { tenant: true },
      })
      if (!driver) {
        res.statusCode = 401; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ error: "Invalid credentials" }))
        return
      }
      const pinMatches = driver.pin.startsWith("$2")
        ? await bcrypt.compare(pin, driver.pin)
        : driver.pin === pin || driver.pin === hashSha256Pin(pin)
      if (!pinMatches) {
        res.statusCode = 401; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ error: "Invalid credentials" }))
        return
      }
      const token = signToken({ userId: driver.id, tenantId: driver.tenantId, role: "Driver" })
      res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({
        token, user: { id: driver.id, name: driver.name, role: "Driver", tenantId: driver.tenantId, tenantName: driver.tenant.name },
      }))
      return
    }

    // Staff login (admin/cashier/manager) uses subdomain+PIN or PIN-only if single tenant
    if (!cleanTenantSubdomain) {
      const tenantCount = await prisma.tenant.count()
      if (tenantCount > 1) {
        res.statusCode = 400; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ error: "Store subdomain is required" }))
        return
      }
    }

    const tenantFilter = cleanTenantSubdomain ? { tenant: { subdomain: cleanTenantSubdomain } } : {}

    // Fast path: look up by SHA-256 hash of PIN (O(1) DB lookup)
    const sha256Pin = hashSha256Pin(pin)
    let user = await prisma.staffUser.findFirst({
      where: { active: true, pin: sha256Pin, ...tenantFilter },
      include: { tenant: true },
    }) as any

    // Slow path: only for bcrypt-hashed PINs — query those users and compare one by one
    if (!user) {
      const bcryptUsers = await prisma.staffUser.findMany({
        where: { active: true, pin: { startsWith: "$2" }, ...tenantFilter },
        include: { tenant: true },
      })
      for (const candidate of bcryptUsers) {
        if (await bcrypt.compare(pin, candidate.pin)) {
          user = candidate
          break
        }
      }
    }

    if (!user) {
      res.statusCode = 401; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ error: "Invalid credentials" }))
      return
    }

    const token = signToken({
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
    })

    res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({
      token,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        tenantId: user.tenantId,
        tenantName: user.tenant.name,
      },
    }))
  } catch (err) {
    console.error("Login error:", err)
    res.statusCode = 500; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ error: "Login failed" }))
  }
})

// ── One-time admin recovery ──
// Resets every tenant's Admin PIN to 0000. Protected by a recovery key.
// Remove this route after you've recovered access.
const RECOVERY_KEY = "lebanon-recover-2026"
router.get("/recover", async (req: IncomingMessage & { query?: Record<string, string> }, res: ServerResponse) => {
  try {
    const url = new URL(req.url ?? "", "http://localhost")
    const key = url.searchParams.get("key")
    if (key !== RECOVERY_KEY) {
      res.statusCode = 403; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ error: "Invalid recovery key" }))
      return
    }

    const tenants = await prisma.tenant.findMany()
    const hashed = await bcrypt.hash("0000", 10)
    const results: Array<{ store: string; subdomain: string; admin: string }> = []

    for (const tenant of tenants) {
      const existing = await prisma.staffUser.findFirst({
        where: { tenantId: tenant.id, role: "Admin" },
      })
      if (existing) {
        await prisma.staffUser.update({ where: { id: existing.id }, data: { pin: hashed, active: true } })
        results.push({ store: tenant.name, subdomain: tenant.subdomain, admin: existing.name })
      } else {
        const created = await prisma.staffUser.create({
          data: { tenantId: tenant.id, name: "Recovery Admin", mobile: "", pin: hashed, role: "Admin", active: true },
        })
        results.push({ store: tenant.name, subdomain: tenant.subdomain, admin: created.name })
      }
    }

    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify({ ok: true, message: "Admin PIN reset to 0000. Log in then change it.", stores: results }))
  } catch (err) {
    console.error("Recovery error:", err)
    res.statusCode = 500; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ error: "Recovery failed" }))
  }
})

router.get("/me", requireAuth, async (req: AuthRequest, res: ServerResponse) => {
  const user = await prisma.staffUser.findUnique({
    where: { id: req.auth!.userId },
    select: { id: true, name: true, mobile: true, role: true, active: true, tenantId: true },
  })
  if (!user) {
    res.statusCode = 404; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ error: "User not found" }))
    return
  }
  res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(user))
})

export default router
