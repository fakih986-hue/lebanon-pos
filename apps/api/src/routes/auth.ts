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

    // When several users share the same PIN, prefer the highest-privilege role.
    const rolePriority: Record<string, number> = { Admin: 4, Manager: 3, Cashier: 2, Driver: 1 }
    const betterRole = (a: any, b: any) =>
      (rolePriority[b.role] ?? 0) > (rolePriority[a.role] ?? 0) ? b : a

    // Collect ALL users in scope that match this PIN (sha256 or bcrypt), then pick best role.
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
