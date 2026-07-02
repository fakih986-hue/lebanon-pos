import { Router } from "express"
import type { IncomingMessage, ServerResponse } from "node:http"
import bcrypt from "bcryptjs"
import { createHash } from "crypto"
import crypto from "crypto"
import jwt from "jsonwebtoken"
import { z } from "zod"
import prisma from "../lib/prisma.js"
import { Prisma } from "../generated/prisma/index.js"
import { decrementProductStock } from "../lib/inventory.js"
import { requireAuth, json, type AuthRequest } from "../middleware/auth.js"
import { broadcastToTenant, broadcastToUser, getConnectedDrivers } from "../ws/index.js"

const router = Router()

class ValidationError extends Error {
  statusCode = 400
  constructor(message: string) { super(message) }
}

function validate<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data)
  if (!result.success) {
    const first = result.error.errors[0]
    throw new ValidationError(first?.message ?? "Validation failed")
  }
  return result.data
}

const createDriverSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  mobile: z.string().max(50).optional().default(""),
  code: z.string().min(1, "Code is required").max(50),
  pin: z.string().min(4, "PIN must be at least 4 characters").max(100),
})

const updateDriverSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  mobile: z.string().max(50).optional(),
  code: z.string().min(1).max(50).optional(),
  pin: z.string().min(4).max(100).optional(),
  active: z.boolean().optional(),
})

const createOrderSchema = z.object({
  tenantId: z.string().min(1, "tenantId is required"),
  customerName: z.string().min(1, "customerName is required").max(200),
  customerPhone: z.string().min(1, "customerPhone is required").max(50),
  address: z.string().min(1, "address is required").max(500),
  locationLat: z.number().optional(),
  locationLng: z.number().optional(),
  deliveryNote: z.string().max(500).optional(),
  customerId: z.string().optional(),
  items: z.array(z.object({
    productId: z.number().int().positive(),
    quantity: z.number().positive(),
  })).min(1, "At least one item is required"),
})

const updateOrderSchema = z.object({
  status: z.string().optional(),
  assignedTo: z.string().optional(),
  assignedName: z.string().optional(),
  driverId: z.string().nullable().optional(),
  notes: z.string().optional(),
  paidAmount: z.number().min(0).optional(),
  cancelledReason: z.string().optional(),
})

const driverStatusSchema = z.object({
  status: z.enum(["OutForDelivery", "Delivered"]),
  paidAmount: z.number().min(0).optional(),
})

const updateSettingsSchema = z.object({
  deliveryFee: z.number().min(0).optional(),
  whatsAppAdmin: z.string().max(100).optional(),
  whatsAppDriverEnabled: z.boolean().optional(),
  assignMode: z.enum(["manual", "broadcast"]).optional(),
  assignTimeout: z.number().int().min(1).max(60).optional(),
  defaultDriverId: z.string().optional(),
})

const signupSchema = z.object({
  tenantId: z.string().min(1, "tenantId is required"),
  name: z.string().min(1, "Name is required").max(200),
  mobile: z.string().min(1, "Mobile is required").max(50),
  pin: z.string().min(4, "PIN must be at least 4 characters").max(100),
})

const loginSchema = z.object({
  tenantId: z.string().min(1, "tenantId is required"),
  mobile: z.string().min(1, "Mobile is required").max(50),
  pin: z.string().min(1, "PIN is required").max(100),
})

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
    const { name, mobile, code, pin } = validate(createDriverSchema, req.body)
    const existing = await prisma.staffUser.findFirst({
      where: { code, role: "Driver", tenantId: req.auth!.tenantId },
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
        pin: await bcrypt.hash(pin, 12),
        role: "Driver",
        active: true,
      },
      select: { id: true, name: true, mobile: true, code: true, active: true, createdAt: true },
    })
    json(res, driver, 201)
  } catch (err) {
    if (err instanceof ValidationError) { json(res, { error: err.message }, 400); return }
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
    const body = validate(updateDriverSchema, req.body)
    const updateData: Record<string, unknown> = {}
    if (body.name !== undefined) updateData.name = body.name
    if (body.mobile !== undefined) updateData.mobile = body.mobile
    if (body.code !== undefined) {
      if (body.code !== existing.code) {
        const dup = await prisma.staffUser.findFirst({ where: { code: body.code, role: "Driver", id: { not: driverId }, tenantId: req.auth!.tenantId } })
        if (dup) { json(res, { error: "Code already in use" }, 409); return }
      }
      updateData.code = body.code
    }
    if (body.active !== undefined) updateData.active = body.active
    if (body.pin !== undefined) updateData.pin = await bcrypt.hash(body.pin, 10)

    const driver = await prisma.staffUser.update({
      where: { id: driverId },
      data: updateData as any,
      select: { id: true, name: true, mobile: true, code: true, active: true, createdAt: true },
    })
    json(res, driver)
  } catch (err) {
    if (err instanceof ValidationError) { json(res, { error: err.message }, 400); return }
    console.error("Update driver error:", err)
    json(res, { error: "Failed to update driver" }, 500)
  }
})

// Customer-facing: create delivery order (no auth)
router.post("/order", async (req: any, res: ServerResponse) => {
  try {
    const body = validate(createOrderSchema, req.body)

    const tenant = await prisma.tenant.findUnique({ where: { id: body.tenantId } })
    if (!tenant) {
      json(res, { error: "Invalid tenant" }, 404)
      return
    }

    const normalizedItems = new Map<number, number>()
    for (const item of body.items) {
      const productId = Number(item.productId)
      const quantity = Number(item.quantity)
      if (!Number.isInteger(productId) || productId <= 0 || !Number.isFinite(quantity) || quantity <= 0) {
        json(res, { error: "Each item must include a valid productId and quantity" }, 400)
        return
      }
      normalizedItems.set(productId, (normalizedItems.get(productId) ?? 0) + quantity)
    }

    const productIds = [...normalizedItems.keys()]
    const products = await prisma.product.findMany({
      where: { tenantId: body.tenantId, id: { in: productIds }, isParent: false },
      select: { id: true, name: true, barcode: true, price: true, stock: true },
    })

    if (products.length !== productIds.length) {
      json(res, { error: "One or more products are not available for this store" }, 400)
      return
    }

    for (const product of products) {
      const quantity = normalizedItems.get(product.id) ?? 0
      if (product.stock < quantity) {
        json(res, { error: `${product.name} does not have enough stock` }, 409)
        return
      }
    }

    const settings = await prisma.appSettings.findUnique({
      where: { tenantId: body.tenantId },
      select: { deliveryFee: true, assignMode: true, defaultDriverId: true },
    })

    const resolvedItems = products.map((product) => {
      const quantity = normalizedItems.get(product.id) ?? 0
      const unitPrice = product.price  // Prisma Decimal — exact precision
      const total = unitPrice.mul(quantity).toDecimalPlaces(2)
      return {
        productId: product.id,
        productName: product.name,
        barcode: product.barcode ?? "",
        quantity,
        unitPrice,
        total,
      }
    })
    const itemsTotal = resolvedItems.reduce(
      (sum, i) => sum.add(i.total),
      new Prisma.Decimal(0)
    )
    const deliveryFee = settings?.deliveryFee ?? new Prisma.Decimal(0)
    const total = itemsTotal.add(deliveryFee).toDecimalPlaces(2)

    const orderCount = await prisma.deliveryOrder.count({ where: { tenantId: body.tenantId } })
    const suffix = crypto.randomInt(1000, 9999)
    const orderNumber = `DEL-${String(orderCount + 1).padStart(6, "0")}-${suffix}`

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
          create: resolvedItems,
        },
      },
      include: { items: true },
    })

    // Notify admin via WebSocket
    broadcastToTenant(body.tenantId, "order:new", { order })

    // Check settings for assign mode and default driver
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
    if (err instanceof ValidationError) { json(res, { error: err.message }, 400); return }
    console.error("Delivery order creation error:", err)
    json(res, { error: "Failed to create delivery order" }, 500)
  }
})

// Customer-facing: check order status (full details for tracking page)
router.get("/order/:orderNumber/status", async (req: any, res: ServerResponse) => {
  try {
    const q = (req.query as Record<string, string>) ?? {}
    const tenantIdFromQuery = q.tenantId
    const tenantSubdomain = q.tenantSubdomain ?? q.subdomain
    let tenantId: string | undefined = tenantIdFromQuery

    if (!tenantId && tenantSubdomain) {
      const tenant = await prisma.tenant.findUnique({
        where: { subdomain: tenantSubdomain },
        select: { id: true },
      })
      tenantId = tenant?.id
    }

    if (!tenantId) {
      json(res, { error: "tenantId or tenantSubdomain query param required" }, 400)
      return
    }
    const scopedTenantId = tenantId

    const order = await prisma.deliveryOrder.findFirst({
      where: { orderNumber: req.params?.orderNumber as string, tenantId: scopedTenantId },
      include: {
        items: true,
        driver: { select: { name: true, mobile: true, code: true } },
      },
    })
    if (!order) {
      json(res, { error: "Order not found" }, 404)
      return
    }
    json(res, {
      orderNumber: order.orderNumber,
      status: order.status,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      address: order.address,
      deliveryNote: order.deliveryNote,
      itemsTotal: order.itemsTotal,
      deliveryFee: order.deliveryFee,
      total: order.total,
      paymentMethod: order.paymentMethod,
      paidAmount: order.paidAmount,
      changeRequired: order.changeRequired,
      createdAt: order.createdAt,
      deliveredAt: order.deliveredAt,
      cancelledAt: order.cancelledAt,
      cancelledReason: order.cancelledReason,
      driverName: order.driver?.name ?? order.assignedName ?? null,
      driverPhone: order.driver?.mobile ?? null,
      items: order.items.map((i) => ({
        productName: i.productName,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        total: i.total,
      })),
    })
  } catch (err) {
    console.error("Delivery order status error:", err)
    json(res, { error: "Failed to fetch order status" }, 500)
  }
})

// Customer-facing: lookup tenant by subdomain
router.get("/tenant", async (req: any, res: ServerResponse) => {
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
router.get("/products", async (req: any, res: ServerResponse) => {
  try {
    const q = (req.query as Record<string, string>) ?? {}
    const tenantId = q.tenantId
    if (!tenantId) {
      json(res, { error: "tenantId query param required" }, 400)
      return
    }
    const skip = Math.max(0, parseInt(q.skip ?? "0") || 0)
    const limit = Math.min(500, Math.max(1, parseInt(q.limit ?? "500") || 500))
    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where: { tenantId, isParent: false },
        select: {
          id: true, name: true, price: true, barcode: true, category: true,
          image: true, stock: true, isParent: true, parentId: true, variantName: true,
          parent: { select: { name: true, image: true } },
        },
        orderBy: { name: "asc" },
        skip,
        take: limit,
      }),
      prisma.product.count({ where: { tenantId, isParent: false } }),
    ])
    const result = products.map(p => ({
      ...p,
      image: p.image ? true : false,
      parent: p.parent ? { ...p.parent, image: p.parent.image ? true : false } : null,
    }))
    res.setHeader("X-Total-Count", total.toString())
    json(res, result)
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
    const skip = Math.max(0, parseInt(q.skip ?? "0") || 0)
    const limit = Math.min(200, Math.max(1, parseInt(q.limit ?? "100") || 100))
    const where: Record<string, unknown> = { tenantId }
    if (statusFilter && statusFilter !== "All") where.status = statusFilter

    const [orders, total] = await Promise.all([
      prisma.deliveryOrder.findMany({
        where: where as any,
        include: { items: true },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.deliveryOrder.count({ where: where as any }),
    ])
    res.setHeader("X-Total-Count", total.toString())
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
    const body = validate(updateOrderSchema, req.body)
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
      select: { id: true, status: true },
    })
    if (!existing) {
      json(res, { error: "Not found" }, 404)
      return
    }

    const order = await prisma.$transaction(async (tx) => {
      // Atomic status transition: use updateMany with a status guard so
      // concurrent requests cannot both decrement stock (only the first
      // request that transitions to Delivered will do so).
      const updateResult = await tx.deliveryOrder.updateMany({
        where: { id: existing.id, status: { notIn: ["Cancelled", "Delivered"] } },
        data: { ...updateData, updatedAt: new Date() } as any,
      })

      const updated = await tx.deliveryOrder.findUnique({
        where: { id: existing.id },
        include: { items: true },
      })

      if (updateResult.count > 0 && body.status === "Delivered" && updated && updated.items.length > 0) {
        await decrementProductStock(tx, tenantId, updated.items.map((i: any) => ({ productId: i.productId, productName: i.productName, quantity: i.quantity })))
      }

      return updated!
    })

    // Broadcast changes via WebSocket
    broadcastToTenant(tenantId, "order:updated", { order })
    if (order.driverId) {
      broadcastToUser(order.driverId, "order:updated", { order })
    }

    json(res, order)
  } catch (err) {
    if (err instanceof ValidationError) { json(res, { error: err.message }, 400); return }
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

function requireCustomerAuth(req: AuthRequest, res: ServerResponse, next: () => void) {
  const header = req.headers.authorization
  if (!header?.startsWith("Bearer ")) {
    json(res, { error: "Authentication required" }, 401)
    return
  }
  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET!) as any
    if (!payload.customerId || payload.role !== "Customer") {
      json(res, { error: "Customer access required" }, 403)
      return
    }
    req.auth = { userId: payload.customerId, tenantId: payload.tenantId, role: payload.role as any }
    next()
  } catch {
    json(res, { error: "Invalid or expired token" }, 401)
  }
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
      select: { id: true, driverId: true, tenantId: true, status: true, total: true },
    })
    if (!order) {
      json(res, { error: "Order not found" }, 404)
      return
    }
    if (order.driverId !== req.auth!.userId) {
      json(res, { error: "Order not assigned to you" }, 403)
      return
    }

    const { status: newStatus, paidAmount } = validate(driverStatusSchema, req.body)

    const updateData: Record<string, unknown> = { status: newStatus }
    if (newStatus === "Delivered") {
      updateData.deliveredAt = new Date()
      if (typeof paidAmount === "number") {
        const totalDecimal = order.total as Prisma.Decimal
        const changeDecimal = totalDecimal.gt(paidAmount)
          ? new Prisma.Decimal(0)
          : new Prisma.Decimal(paidAmount).sub(totalDecimal)
        updateData.paidAmount = paidAmount
        updateData.changeRequired = changeDecimal.toDecimalPlaces(2)
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Atomic status transition: use updateMany with a status guard so
      // concurrent driver requests cannot both decrement stock.
      const updateResult = await tx.deliveryOrder.updateMany({
        where: { id: orderId, status: { notIn: ["Cancelled", "Delivered"] } },
        data: { ...updateData, updatedAt: new Date() } as any,
      })

      const result = await tx.deliveryOrder.findUnique({
        where: { id: orderId },
        include: { items: true },
      })

      if (updateResult.count > 0 && newStatus === "Delivered" && result && result.items.length > 0) {
        await decrementProductStock(tx, order.tenantId, result.items.map((i: any) => ({ productId: i.productId, productName: i.productName, quantity: i.quantity })))
      }

      return result!
    })

    // Notify tenant and customer tracking page
    broadcastToTenant(order.tenantId, "order:updated", { order: updated })

    json(res, updated)
  } catch (err) {
    if (err instanceof ValidationError) { json(res, { error: err.message }, 400); return }
    console.error("Driver order update error:", err)
    json(res, { error: "Failed to update order" }, 500)
  }
})

// ── Delivery Settings (admin auth) ──

// Get delivery settings for this tenant (public, used by ordering app)
router.get("/settings", async (req: any, res: ServerResponse) => {
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
    const body = validate(updateSettingsSchema, req.body)
    const updateData: Record<string, unknown> = {}
    if (body.deliveryFee !== undefined) updateData.deliveryFee = body.deliveryFee
    if (body.whatsAppAdmin !== undefined) updateData.whatsAppAdmin = body.whatsAppAdmin
    if (body.whatsAppDriverEnabled !== undefined) updateData.whatsAppDriverEnabled = body.whatsAppDriverEnabled
    if (body.assignMode !== undefined) updateData.assignMode = body.assignMode
    if (body.assignTimeout !== undefined) updateData.assignTimeout = body.assignTimeout
    if (body.defaultDriverId !== undefined) updateData.defaultDriverId = body.defaultDriverId

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true },
    })
    const settings = await prisma.appSettings.upsert({
      where: { tenantId },
      update: updateData as any,
      create: { tenantId, storeName: tenant?.name ?? "", ...updateData } as any,
    })
    json(res, settings)
  } catch (err) {
    if (err instanceof ValidationError) { json(res, { error: err.message }, 400); return }
    console.error("Delivery settings update error:", err)
    json(res, { error: "Failed to update delivery settings" }, 500)
  }
})

// ── Driver: Accept an unassigned order (first-responder) ──

router.post("/driver/orders/:id/accept", requireAuth, requireDriver, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const orderId = req.params?.id as string
    const driverId = req.auth!.userId
    const tenantId = req.auth!.tenantId

    const driver = await prisma.staffUser.findFirst({
      where: { id: driverId, tenantId, role: "Driver", active: true },
      select: { name: true },
    })
    if (!driver) {
      json(res, { error: "Driver not found" }, 404)
      return
    }

    const updated = await prisma.$transaction(async (tx) => {
      const claim = await tx.deliveryOrder.updateMany({
        where: {
          id: orderId,
          tenantId,
          driverId: null,
          status: { in: ["Pending", "Confirmed"] },
        },
        data: {
          driverId,
          assignedName: driver.name,
          assignedTo: driver.name,
          driverAssignedAt: new Date(),
          updatedAt: new Date(),
          status: "Confirmed",
        },
      })

      if (claim.count !== 1) {
        const current = await tx.deliveryOrder.findFirst({
          where: { id: orderId, tenantId },
          select: { id: true, driverId: true, status: true },
        })
        if (!current) {
          throw Object.assign(new Error("Order not found"), { statusCode: 404 })
        }
        if (current.driverId) {
          throw Object.assign(new Error("Order already assigned"), {
            statusCode: 409,
            assignedTo: current.driverId,
          })
        }
        throw Object.assign(new Error("Order is not available for acceptance"), { statusCode: 400 })
      }

      return tx.deliveryOrder.findUniqueOrThrow({
        where: { id: orderId },
        include: { items: true },
      })
    })

    // Notify: order:assigned to drivers channel (so other drivers hide their Accept button)
    broadcastToTenant(tenantId, "order:assigned", { orderId: updated.id, driverId })
    // Notify: order:updated to the assigning driver
    broadcastToUser(driverId, "order:updated", { order: updated })
    // Notify admin
    broadcastToTenant(tenantId, "order:updated", { order: updated })

    json(res, updated)
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode
    if (statusCode) {
      const assignedTo = (err as { assignedTo?: string }).assignedTo
      json(res, { error: (err as Error).message, ...(assignedTo ? { assignedTo } : {}) }, statusCode)
      return
    }
    console.error("Driver accept order error:", err)
    json(res, { error: "Failed to accept order" }, 500)
  }
})

// ── Customer Account API ──

// Customer signup (creates account or adds PIN to existing customer)
router.post("/customer/signup", async (req: any, res: ServerResponse) => {
  try {
    const { tenantId, name, mobile, pin } = validate(signupSchema, req.body)
    const existing = await prisma.customer.findFirst({ where: { tenantId, mobile } })
    if (existing) {
      if (existing.pin) {
        json(res, { error: "Account already exists with this phone number. Please login." }, 409)
        return
      }
      const updated = await prisma.customer.update({
        where: { id: existing.id },
        data: { name, pin: await bcrypt.hash(pin, 12) },
        select: { id: true, name: true, mobile: true },
      })
      json(res, { customer: updated }, 200)
      return
    }
    const customer = await prisma.customer.create({
      data: { tenantId, name, mobile, pin: await bcrypt.hash(pin, 12) },
      select: { id: true, name: true, mobile: true },
    })
    json(res, { customer }, 201)
  } catch (err) {
    if (err instanceof ValidationError) { json(res, { error: err.message }, 400); return }
    console.error("Customer signup error:", err)
    json(res, { error: "Failed to create account" }, 500)
  }
})

// Customer login
router.post("/customer/login", async (req: any, res: ServerResponse) => {
  try {
    const { tenantId, mobile, pin } = validate(loginSchema, req.body)
    const customer = await prisma.customer.findFirst({
      where: { tenantId, mobile },
      select: { id: true, name: true, mobile: true, pin: true },
    })
    if (!customer || !customer.pin) {
      json(res, { error: "No account found with this phone number" }, 401)
      return
    }
    const pinValid = await bcrypt.compare(pin, customer.pin)
    if (!pinValid) {
      json(res, { error: "Invalid PIN" }, 401)
      return
    }
    const token = jwt.sign(
      { customerId: customer.id, tenantId, role: "Customer" },
      process.env.JWT_SECRET!,
      { expiresIn: "30d" },
    )
    json(res, {
      token,
      customer: { id: customer.id, name: customer.name, mobile: customer.mobile },
    })
  } catch (err) {
    if (err instanceof ValidationError) { json(res, { error: err.message }, 400); return }
    console.error("Customer login error:", err)
    json(res, { error: "Failed to login" }, 500)
  }
})

// Customer: get my orders
router.get("/customer/orders", requireCustomerAuth, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const payload = req.auth!
    const orders = await prisma.deliveryOrder.findMany({
      where: { customerId: payload.userId as string, tenantId: payload.tenantId },
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

// Public: serve product image (no auth — customer-facing)
router.get("/public/image/:productId", async (req: any, res: ServerResponse) => {
  try {
    const productId = Number(req.params?.productId)
    if (isNaN(productId)) {
      json(res, { error: "Invalid product ID" }, 400)
      return
    }
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { image: true },
    })
    if (!product?.image) {
      json(res, { error: "No image found" }, 404)
      return
    }
    const match = product.image.match(/^data:(image\/[\w+-]+);base64,(.+)$/)
    if (!match) {
      json(res, { error: "Invalid image data" }, 500)
      return
    }
    const mime = match[1]
    const buffer = Buffer.from(match[2], "base64")
    res.writeHead(200, {
      "Content-Type": mime,
      "Content-Length": buffer.length.toString(),
      "Cache-Control": "public, max-age=86400, immutable",
    })
    res.end(buffer)
  } catch (err) {
    console.error("Public image error:", err)
    json(res, { error: "Failed to serve image" }, 500)
  }
})

export default router
