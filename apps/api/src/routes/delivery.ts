import { Router } from "express"
import type { IncomingMessage, ServerResponse } from "node:http"
import prisma from "../lib/prisma.js"
import { requireAuth, type AuthRequest } from "../middleware/auth.js"

const router = Router()

type Req = IncomingMessage & { body?: unknown; query: Record<string, string | string[] | undefined>; params?: Record<string, string> }

function json(res: ServerResponse, data: unknown, statusCode = 200) {
  res.statusCode = statusCode
  res.setHeader("Content-Type", "application/json")
  res.end(JSON.stringify(data))
}

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
    const body = req.body as { status?: string; assignedTo?: string; assignedName?: string; notes?: string; paidAmount?: number; cancelledReason?: string }
    const updateData: Record<string, unknown> = {}

    if (body.status) updateData.status = body.status
    if (body.status === "Delivered") updateData.deliveredAt = new Date()
    if (body.status === "Cancelled") updateData.cancelledAt = new Date()
    if (body.assignedTo !== undefined) updateData.assignedTo = body.assignedTo
    if (body.assignedName !== undefined) updateData.assignedName = body.assignedName
    if (body.notes !== undefined) updateData.notes = body.notes
    if (body.paidAmount !== undefined) updateData.paidAmount = body.paidAmount
    if (body.cancelledReason !== undefined) updateData.cancelledReason = body.cancelledReason

    const order = await prisma.deliveryOrder.update({
      where: { id: req.params?.id as string },
      data: updateData as any,
      include: { items: true },
    })

    if (order.tenantId !== tenantId) {
      json(res, { error: "Not found" }, 404)
      return
    }

    json(res, order)
  } catch (err) {
    console.error("Delivery order update error:", err)
    json(res, { error: "Failed to update order" }, 500)
  }
})

export default router
