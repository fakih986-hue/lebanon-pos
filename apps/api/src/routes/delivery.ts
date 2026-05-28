import { Router } from "express"
import type { IncomingMessage, ServerResponse } from "node:http"
import bcrypt from "bcryptjs"
import { createHash } from "crypto"
import jwt from "jsonwebtoken"
import prisma from "../lib/prisma.js"
import { requireAuth, type AuthRequest, signToken } from "../middleware/auth.js"
import { broadcastToTenant, broadcastToUser, getConnectedDrivers } from "../ws/index.js"

const router = Router()

type Req = IncomingMessage & { body?: unknown; query: Record<string, string | string[] | undefined>; params?: Record<string, string> }

function json(res: ServerResponse, data: unknown, statusCode = 200) {
  res.statusCode = statusCode
  res.setHeader("Content-Type", "application/json")
  res.end(JSON.stringify(data))
}

// ── Driver Management (admin auth) ──

// List drivers for this tenant
router.get("/drivers", requireAuth, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const drivers = await prisma.staffUser.findMany({
      where: { tenantId: req.auth!.tenantId, role: "Driver" },
      select: { id: true, name: true, mobile: true, code: true, active: true, createdAt: true },
      orderBy: { name: "asc" },
    })
    json(res, drivers)
  } catch (err) {
    console.error("List drivers error:", err)
    json(res, { error: "Failed to list drivers" }, 500)
  }
})

// Create driver
router.post("/drivers", requireAuth, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const { name, mobile, code, pin } = req.body as { name?: string; mobile?: string; code?: string; pin?: string }
    if (!name || !code || !pin) {
      json(res, { error: "Name, code, and PIN are required" }, 400)
      return
    }
    if (pin.length < 4) {
      json(res, { error: "PIN must be at least 4 characters" }, 400)
      return
    }
    const existing = await prisma.staffUser.findFirst({
      where: { code, role: "Driver" },
    })
    if (existing) {
      json(res, { error: "Driver with this code already exists" }, 409)
      return
    }
    const driver = await prisma.staffUser.create({
      data: {
        tenantId: req.auth!.tenantId,
        name,
        mobile: mobile ?? "",
        code,
        pin: await bcrypt.hash(pin, 10),
        role: "Driver",
        active: true,
      },
      select: { id: true, name: true, mobile: true, code: true, active: true, createdAt: true },
    })
    json(res, driver, 201)
  } catch (err) {
    console.error("Create driver error:", err)
    json(res, { error: "Failed to create driver" }, 500)
  }
})

// Update driver
router.patch("/drivers/:id", requireAuth, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const driverId = req.params?.id as string
    const existing = await prisma.staffUser.findFirst({
      where: { id: driverId, tenantId: req.auth!.tenantId, role: "Driver" },
    })
    if (!existing) {
      json(res, { error: "Driver not found" }, 404)
      return
    }
    const { name, mobile, code, pin, active } = req.body as { name?: string; mobile?: string; code?: string; pin?: string; active?: boolean }
    const updateData: Record<string, unknown> = {}
    if (name !== undefined) updateData.name = name
    if (mobile !== undefined) updateData.mobile = mobile
    if (code !== undefined) {
      if (code !== existing.code) {
        const dup = await prisma.staffUser.findFirst({ where: { code, role: "Driver", id: { not: driverId } } })
        if (dup) { json(res, { error: "Code already in use" }, 409); return }
      }
      updateData.code = code
    }
    if (active !== undefined) updateData.active = active
    if (pin !== undefined) updateData.pin = await bcrypt.hash(pin, 10)

    const driver = await prisma.staffUser.update({
      where: { id: driverId },
      data: updateData as any,
      select: { id: true, name: true, mobile: true, code: true, active: true, createdAt: true },
    })
    json(res, driver)
  } catch (err) {
    console.error("Update driver error:", err)
    json(res, { error: "Failed to update driver" }, 500)
  }
})

// Customer-facing: create delivery order (no auth)
router.post("/order", async (req: Req, res: ServerResponse) => {
  try {
    const body = req.body as {
      tenantId?: string
      customerName?: string
      customerPhone?: string
      address?: string
      locationLat?: number
      locationLng?: number
      deliveryNote?: string
      deliveryFee?: number
      customerId?: string
      items?: Array<{ productId: number; productName: string; barcode: string; quantity: number; unitPrice: number }>
    }

    if (!body.tenantId || !body.customerName || !body.customerPhone || !body.address || !body.items?.length) {
      json(res, { error: "tenantId, customerName, customerPhone, address, and items are required" }, 400)
      return
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: body.tenantId } })
    if (!tenant) {
      json(res, { error: "Invalid tenant" }, 404)
      return
    }

    const itemsTotal = body.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0)
    const deliveryFee = body.deliveryFee ?? 0
    const total = itemsTotal + deliveryFee

    const orderCount = await prisma.deliveryOrder.count({ where: { tenantId: body.tenantId } })
    const orderNumber = `DEL-${String(orderCount + 1).padStart(6, "0")}`

    const order = await prisma.deliveryOrder.create({
      data: {
        tenantId: body.tenantId,
        orderNumber,
        customerName: body.customerName,
        customerPhone: body.customerPhone,
        address: body.address,
        locationLat: body.locationLat ?? null,
        locationLng: body.locationLng ?? null,
        deliveryNote: body.deliveryNote ?? "",
        itemsTotal,
        deliveryFee,
        total,
        customerId: body.customerId || null,
        items: {
          create: body.items.map((i) => ({
            productId: i.productId,
            productName: i.productName,
            barcode: i.barcode,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            total: i.quantity * i.unitPrice,
          })),
        },
      },
      include: { items: true },
    })

    // Notify admin via WebSocket
    broadcastToTenant(body.tenantId, "order:new", { order })

    // Check settings for assign mode and default driver
    const settings = await prisma.appSettings.findUnique({
      where: { tenantId: body.tenantId },
      select: { assignMode: true, defaultDriverId: true },
    })

    // Auto-assign if default driver is configured
    if (settings?.defaultDriverId) {
      const driver = await prisma.staffUser.findUnique({
        where: { id: settings.defaultDriverId },
        select: { name: true },
      })
      if (driver) {
        const assigned = await prisma.deliveryOrder.update({
          where: { id: order.id },
          data: {
            driverId: settings.defaultDriverId,
            assignedName: driver.name,
            assignedTo: driver.name,
            driverAssignedAt: new Date(),
            status: "Confirmed",
          },
          include: { items: true },
        })
        broadcastToTenant(body.tenantId, "order:updated", { order: assigned })
        broadcastToUser(settings.defaultDriverId, "order:updated", { order: assigned })
        json(res, { order: assigned }, 201)
        return
      }
    }

    // If broadcast mode (no default driver), notify available drivers
    if (settings?.assignMode === "broadcast") {
      broadcastToTenant(body.tenantId, "order:available", { order })
    }

    json(res, { order }, 201)
  } catch (err) {
    console.error("Delivery order creation error:", err)
    json(res, { error: "Failed to create delivery order" }, 500)
  }
})

// Customer-facing: check order status
router.get("/order/:orderNumber/status", async (req: Req, res: ServerResponse) => {
  try {
    const order = await prisma.deliveryOrder.findFirst({
      where: { orderNumber: req.params?.orderNumber as string },
      select: { orderNumber: true, status: true, createdAt: true, total: true, customerName: true },
    })
    if (!order) {
      json(res, { error: "Order not found" }, 404)
      return
    }
    json(res, order)
  } catch (err) {
    console.error("Delivery order status error:", err)
    json(res, { error: "Failed to fetch order status" }, 500)
  }
})

// Customer-facing: lookup tenant by subdomain
router.get("/tenant", async (req: Req, res: ServerResponse) => {
  try {
    const subdomain = (req.query as Record<string, string>)?.subdomain
    if (!subdomain) {
      json(res, { error: "subdomain query param required" }, 400)
      return
    }
    const tenant = await prisma.tenant.findUnique({
      where: { subdomain },
      select: { id: true, name: true },
    })
    if (!tenant) {
      json(res, { error: "Store not found" }, 404)
      return
    }
    json(res, tenant)
  } catch (err) {
    console.error("Tenant lookup error:", err)
    json(res, { error: "Failed to find store" }, 500)
  }
})

// Customer-facing: list products for ordering
router.get("/products", async (req: Req, res: ServerResponse) => {
  try {
    const tenantId = (req.query as Record<string, string>)?.tenantId
    if (!tenantId) {
      json(res, { error: "tenantId query param required" }, 400)
      return
    }
    const products = await prisma.product.findMany({
      where: { tenantId, isParent: false },
      select: {
        id: true, name: true, price: true, barcode: true, category: true,
        image: true, stock: true, isParent: true, parentId: true, variantName: true,
        parent: { select: { name: true, image: true } },
      },
      orderBy: { name: "asc" },
    })
    json(res, products)
  } catch (err) {
    console.error("Delivery products error:", err)
    json(res, { error: "Failed to fetch products" }, 500)
  }
})

// POS: list delivery orders
router.get("/orders", requireAuth, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const tenantId = req.auth!.tenantId
    const q = (req.query as Record<string, string>) ?? {}
    const statusFilter = q.status
    const where: Record<string, unknown> = { tenantId }
    if (statusFilter && statusFilter !== "All") where.status = statusFilter

    const orders = await prisma.deliveryOrder.findMany({
      where: where as any,
      include: { items: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    })
    json(res, orders)
  } catch (err) {
    console.error("Delivery orders list error:", err)
    json(res, { error: "Failed to fetch orders" }, 500)
  }
})

// POS: update delivery order status
router.patch("/orders/:id", requireAuth, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const tenantId = req.auth!.tenantId
    const body = req.body as {
      status?: string; assignedTo?: string; assignedName?: string; driverId?: string;
      notes?: string; paidAmount?: number; cancelledReason?: string
    }
    const updateData: Record<string, unknown> = {}

    if (body.status) updateData.status = body.status
    if (body.status === "Delivered") updateData.deliveredAt = new Date()
    if (body.status === "Cancelled") updateData.cancelledAt = new Date()
    if (body.assignedTo !== undefined) updateData.assignedTo = body.assignedTo
    if (body.assignedName !== undefined) updateData.assignedName = body.assignedName
    if (body.notes !== undefined) updateData.notes = body.notes
    if (body.paidAmount !== undefined) updateData.paidAmount = body.paidAmount
    if (body.cancelledReason !== undefined) updateData.cancelledReason = body.cancelledReason

    // Handle driver assignment
    if (body.driverId !== undefined) {
      updateData.driverId = body.driverId
      updateData.driverAssignedAt = new Date()
      if (body.driverId) {
        const driver = await prisma.staffUser.findUnique({
          where: { id: body.driverId },
          select: { name: true },
        })
        if (driver) updateData.assignedName = driver.name
      } else {
        updateData.assignedName = null
      }
    }

    // Verify ownership before mutating
    const existing = await prisma.deliveryOrder.findFirst({
      where: { id: req.params?.id as string, tenantId },
      select: { id: true },
    })
    if (!existing) {
      json(res, { error: "Not found" }, 404)
      return
    }

    const order = await prisma.deliveryOrder.update({
      where: { id: existing.id },
      data: updateData as any,
      include: { items: true },
    })

    // Broadcast changes via WebSocket
    broadcastToTenant(tenantId, "order:updated", { order })
    if (order.driverId) {
      broadcastToUser(order.driverId, "order:updated", { order })
    }

    json(res, order)
  } catch (err) {
    console.error("Delivery order update error:", err)
    json(res, { error: "Failed to update order" }, 500)
  }
})

// ── Driver API (JWT auth, role=Driver) ──

function requireDriver(req: AuthRequest, res: ServerResponse, next: () => void) {
  if (req.auth?.role !== "Driver") {
    json(res, { error: "Driver access required" }, 403)
    return
  }
  next()
}

// Admin: get online driver IDs
router.get("/drivers/online", requireAuth, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const online = getConnectedDrivers(req.auth!.tenantId)
    json(res, online)
  } catch (err) {
    console.error("Online drivers error:", err)
    json(res, { error: "Failed to get online drivers" }, 500)
  }
})

// Driver: get available (unassigned) orders
router.get("/driver/orders/available", requireAuth, requireDriver, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const orders = await prisma.deliveryOrder.findMany({
      where: { tenantId: req.auth!.tenantId, driverId: null, status: "Pending" },
      include: { items: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    })
    json(res, orders)
  } catch (err) {
    console.error("Available orders error:", err)
    json(res, { error: "Failed to fetch available orders" }, 500)
  }
})

// Driver: get my assigned orders
router.get("/driver/orders", requireAuth, requireDriver, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const orders = await prisma.deliveryOrder.findMany({
      where: { driverId: req.auth!.userId },
      include: { items: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    })
    json(res, orders)
  } catch (err) {
    console.error("Driver orders error:", err)
    json(res, { error: "Failed to fetch orders" }, 500)
  }
})

// Driver: update order status (OutForDelivery, Delivered)
router.patch("/driver/orders/:id/status", requireAuth, requireDriver, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const orderId = req.params?.id as string
    const order = await prisma.deliveryOrder.findUnique({
      where: { id: orderId },
      select: { id: true, driverId: true, tenantId: true, status: true },
    })
    if (!order) {
      json(res, { error: "Order not found" }, 404)
      return
    }
    if (order.driverId !== req.auth!.userId) {
      json(res, { error: "Order not assigned to you" }, 403)
      return
    }

    const allowedStatuses = ["OutForDelivery", "Delivered"]
    const { status: newStatus } = req.body as { status?: string }
    if (!newStatus || !allowedStatuses.includes(newStatus)) {
      json(res, { error: "You can only set OutForDelivery or Delivered" }, 400)
      return
    }

    const updateData: Record<string, unknown> = { status: newStatus }
    if (newStatus === "Delivered") updateData.deliveredAt = new Date()

    const updated = await prisma.deliveryOrder.update({
      where: { id: orderId },
      data: updateData as any,
      include: { items: true },
    })

    json(res, updated)
  } catch (err) {
    console.error("Driver order update error:", err)
    json(res, { error: "Failed to update order" }, 500)
  }
})

// ── Delivery Settings (admin auth) ──

// Get delivery settings for this tenant (public, used by ordering app)
router.get("/settings", async (req: Req, res: ServerResponse) => {
  try {
    const tenantId = (req.query as Record<string, string>)?.tenantId
    if (!tenantId) {
      json(res, { error: "tenantId query param required" }, 400)
      return
    }
    const settings = await prisma.appSettings.findUnique({
      where: { tenantId },
      select: {
        deliveryFee: true,
        whatsAppAdmin: true,
        whatsAppDriverEnabled: true,
        assignMode: true,
        assignTimeout: true,
        defaultDriverId: true,
      },
    })
    json(res, settings ?? { deliveryFee: 2.0, whatsAppAdmin: "", whatsAppDriverEnabled: false, assignMode: "manual", assignTimeout: 5, defaultDriverId: "" })
  } catch (err) {
    console.error("Delivery settings fetch error:", err)
    json(res, { error: "Failed to fetch delivery settings" }, 500)
  }
})

// Update delivery settings (admin auth)
router.patch("/settings", requireAuth, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const tenantId = req.auth!.tenantId
    const body = req.body as {
      deliveryFee?: number
      whatsAppAdmin?: string
      whatsAppDriverEnabled?: boolean
      assignMode?: string
      assignTimeout?: number
      defaultDriverId?: string
    }
    const updateData: Record<string, unknown> = {}
    if (body.deliveryFee !== undefined) updateData.deliveryFee = body.deliveryFee
    if (body.whatsAppAdmin !== undefined) updateData.whatsAppAdmin = body.whatsAppAdmin
    if (body.whatsAppDriverEnabled !== undefined) updateData.whatsAppDriverEnabled = body.whatsAppDriverEnabled
    if (body.assignMode !== undefined) updateData.assignMode = body.assignMode
    if (body.assignTimeout !== undefined) updateData.assignTimeout = body.assignTimeout
    if (body.defaultDriverId !== undefined) updateData.defaultDriverId = body.defaultDriverId

    const settings = await prisma.appSettings.upsert({
      where: { tenantId },
      update: updateData as any,
      create: { tenantId, ...updateData } as any,
    })
    json(res, settings)
  } catch (err) {
    console.error("Delivery settings update error:", err)
    json(res, { error: "Failed to update delivery settings" }, 500)
  }
})

// ── Driver: Accept an unassigned order (first-responder) ──

router.post("/driver/orders/:id/accept", requireAuth, requireDriver, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const orderId = req.params?.id as string
    const driverId = req.auth!.userId

    const order = await prisma.deliveryOrder.findUnique({
      where: { id: orderId },
      select: { id: true, driverId: true, tenantId: true, status: true },
    })
    if (!order) {
      json(res, { error: "Order not found" }, 404)
      return
    }
    if (order.driverId) {
      json(res, { error: "Order already assigned", assignedTo: order.driverId }, 409)
      return
    }
    if (order.status !== "Pending" && order.status !== "Confirmed") {
      json(res, { error: "Order is not available for acceptance" }, 400)
      return
    }

    const driver = await prisma.staffUser.findUnique({
      where: { id: driverId },
      select: { name: true },
    })
    if (!driver) {
      json(res, { error: "Driver not found" }, 404)
      return
    }

    const updated = await prisma.deliveryOrder.update({
      where: { id: orderId },
      data: {
        driverId,
        assignedName: driver.name,
        assignedTo: driver.name,
        driverAssignedAt: new Date(),
        status: "Confirmed",
      },
      include: { items: true },
    })

    // Notify: order:assigned to drivers channel (so other drivers hide their Accept button)
    broadcastToTenant(order.tenantId, "order:assigned", { orderId: updated.id, driverId })
    // Notify: order:updated to the assigning driver
    broadcastToUser(driverId, "order:updated", { order: updated })
    // Notify admin
    broadcastToTenant(order.tenantId, "order:updated", { order: updated })

    json(res, updated)
  } catch (err) {
    console.error("Driver accept order error:", err)
    json(res, { error: "Failed to accept order" }, 500)
  }
})

// ── Customer Account API ──

// Customer signup (creates account or adds PIN to existing customer)
router.post("/customer/signup", async (req: Req, res: ServerResponse) => {
  try {
    const { tenantId, name, mobile, pin } = req.body as { tenantId?: string; name?: string; mobile?: string; pin?: string }
    if (!tenantId || !name || !mobile || !pin) {
      json(res, { error: "tenantId, name, mobile, and pin are required" }, 400)
      return
    }
    if (pin.length < 4) {
      json(res, { error: "PIN must be at least 4 characters" }, 400)
      return
    }
    const existing = await prisma.customer.findFirst({ where: { tenantId, mobile } })
    if (existing) {
      if (existing.pin) {
        json(res, { error: "Account already exists with this phone number. Please login." }, 409)
        return
      }
      const updated = await prisma.customer.update({
        where: { id: existing.id },
        data: { name, pin: createHash("sha256").update(pin).digest("base64") },
        select: { id: true, name: true, mobile: true },
      })
      json(res, { customer: updated }, 200)
      return
    }
    const customer = await prisma.customer.create({
      data: { tenantId, name, mobile, pin: createHash("sha256").update(pin).digest("base64") },
      select: { id: true, name: true, mobile: true },
    })
    json(res, { customer }, 201)
  } catch (err) {
    console.error("Customer signup error:", err)
    json(res, { error: "Failed to create account" }, 500)
  }
})

// Customer login
router.post("/customer/login", async (req: Req, res: ServerResponse) => {
  try {
    const { tenantId, mobile, pin } = req.body as { tenantId?: string; mobile?: string; pin?: string }
    if (!tenantId || !mobile || !pin) {
      json(res, { error: "tenantId, mobile, and pin are required" }, 400)
      return
    }
    const customer = await prisma.customer.findFirst({
      where: { tenantId, mobile },
      select: { id: true, name: true, mobile: true, pin: true },
    })
    if (!customer || !customer.pin) {
      json(res, { error: "No account found with this phone number" }, 401)
      return
    }
    const hashed = createHash("sha256").update(pin).digest("base64")
    if (customer.pin !== hashed) {
      json(res, { error: "Invalid PIN" }, 401)
      return
    }
    const token = jwt.sign(
      { customerId: customer.id, tenantId, role: "Customer" },
      process.env.JWT_SECRET || "dev-secret-change-in-production",
      { expiresIn: "30d" },
    )
    json(res, {
      token,
      customer: { id: customer.id, name: customer.name, mobile: customer.mobile },
    })
  } catch (err) {
    console.error("Customer login error:", err)
    json(res, { error: "Failed to login" }, 500)
  }
})

// Customer: get my orders
router.get("/customer/orders", async (req: Req, res: ServerResponse) => {
  try {
    const authHeader = req.headers?.authorization
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      json(res, { error: "Authentication required" }, 401)
      return
    }
    let payload: { customerId?: string; tenantId?: string; role?: string }
    try {
      payload = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET || "dev-secret-change-in-production") as any
    } catch {
      json(res, { error: "Invalid or expired token" }, 401)
      return
    }
    if (!payload.customerId || payload.role !== "Customer") {
      json(res, { error: "Customer access required" }, 403)
      return
    }
    const orders = await prisma.deliveryOrder.findMany({
      where: { customerId: payload.customerId, tenantId: payload.tenantId },
      include: { items: true },
      orderBy: { createdAt: "desc" },
      take: 30,
    })
    json(res, orders)
  } catch (err) {
    console.error("Customer orders error:", err)
    json(res, { error: "Failed to fetch orders" }, 500)
  }
})

export default router
