import { Router } from "express"
import prisma from "../lib/prisma"
import { signToken, type AuthRequest, requireAuth } from "../middleware/auth"

const router = Router()

router.post("/login", async (req, res) => {
  try {
    const { pin, tenantSubdomain } = req.body
    if (!pin) {
      res.status(400).json({ error: "PIN is required" })
      return
    }

    const user = await prisma.staffUser.findFirst({
      where: { pin, active: true },
      include: { tenant: true },
    })

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

router.get("/me", requireAuth, async (req: AuthRequest, res) => {
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
