import { Router } from "express"
import type { ServerResponse } from "node:http"
import bcrypt from "bcryptjs"
import { z } from "zod"
import prisma from "../lib/prisma.js"

import { decrementProductStock } from "../lib/inventory.js"
import { json, requireAuth, type AuthRequest } from "../middleware/auth.js"
import { requireCloudOrJwtAuth } from "../middleware/cloudAuth.js"
import { broadcastToTenant } from "../ws/index.js"
const router = Router()

const syncOperationSchema = z.object({
  id: z.string().min(1),
  entity: z.enum([
    "sale",
    "refund",
    "product",
    "customer",
    "debt",
    "expense",
    "daily-close",
    "supplier",
    "purchase-order",
    "supplier-payment",
    "staff",
    "shift",
    "inventory",
    "settings",
    "delivery-order",
  ]),
  action: z.enum([
    "create",
    "update",
    "delete",
    "receive",
    "payment",
    "close",
    "open",
    "adjust",
    "count",
    "void",
  ]),
  payload: z.unknown().optional(),
})

const syncPushSchema = z.object({
  operations: z.array(syncOperationSchema).max(100),
})

type SyncOperationInput = z.infer<typeof syncOperationSchema>

router.get("/status", requireAuth, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.auth!.tenantId },
      select: { name: true, subdomain: true, suspended: true },
    })
    if (!tenant) { json(res, { error: "Tenant not found" }, 404); return }
    json(res, tenant)
  } catch (err) {
    console.error("Tenant status error:", err)
    json(res, { error: "Failed to get tenant status" }, 500)
  }
})

router.post("/push", requireCloudOrJwtAuth, async (req: AuthRequest, res: ServerResponse) => {
  const parsed = syncPushSchema.safeParse(req.body)
  const tenantId = req.auth!.tenantId

  if (!parsed.success) {
    json(res, { error: "Invalid sync payload", details: parsed.error.flatten() }, 400)
    return
  }

  const { operations } = parsed.data
  const results: Array<{ id: string; status: "ok" | "error"; error?: string }> = []

  for (const op of operations) {
    try {
      const existingOperation = await prisma.syncOperation.findFirst({
        where: { id: op.id, tenantId },
        select: { id: true, status: true },
      })

      if (existingOperation?.status === "Synced") {
        results.push({ id: op.id, status: "ok" })
        continue
      }

      validateSyncOperation(op)

      // Cashiers cannot void sales or issue refunds — requires Manager+
      if (["void"].includes(op.action) && ["sale", "refund"].includes(op.entity)) {
        if (req.auth!.role === "Cashier") {
          results.push({ id: op.id, status: "error", error: "Only managers can void transactions" })
          continue
        }
      }

      await prisma.$transaction(async (tx) => {
        await processOperation(tenantId, op.entity, op.action, op.payload as any, tx as typeof prisma)

        const operationData = {
          entity: op.entity,
          action: op.action,
          summary: `${op.action} ${op.entity}`,
          payload: (op.payload ?? {}) as any,
          status: "Synced",
          syncedAt: new Date(),
          lastAttemptAt: new Date(),
          error: null,
        }

        if (existingOperation) {
          await (tx as any).syncOperation.update({
            where: { id: op.id },
            data: operationData,
          })
        } else {
          await (tx as any).syncOperation.create({
            data: { id: op.id, tenantId, ...operationData },
          })
        }
      })

      results.push({ id: op.id, status: "ok" })
    } catch (err) {
      const errorMessage = (err as Error).message

      await prisma.syncOperation
        .upsert({
          where: { id: op.id },
          create: {
            id: op.id,
            tenantId,
            entity: op.entity,
            action: op.action,
            summary: `${op.action} ${op.entity}`,
            payload: (op.payload ?? {}) as any,
            status: "Failed",
            attempts: 1,
            lastAttemptAt: new Date(),
            error: errorMessage,
          },
          update: {
            status: "Failed",
            attempts: { increment: 1 },
            lastAttemptAt: new Date(),
            error: errorMessage,
          },
        })
        .catch((syncLogError: unknown) => {
          console.error("Failed to record sync error:", syncLogError)
        })

      results.push({ id: op.id, status: "error", error: errorMessage })
    }
  }

  // Notify all connected devices in this tenant that data has changed
  if (results.some((r) => r.status === "ok")) {
    try { broadcastToTenant(tenantId, "sync:data-changed", {}) } catch { /* no-op */ }
  }

  json(res, { results })
})

router.get("/pull", requireCloudOrJwtAuth, async (req: AuthRequest, res: ServerResponse) => {
  try {
  const tenantId = req.auth!.tenantId
  const since = req.query.since as string | undefined
  const sinceDate = since ? new Date(since) : undefined

  // Helper to build a date filter for models with createdAt only
  const createdFilter = sinceDate ? { gte: sinceDate } : undefined
  // Helper for models with updatedAt — include records created OR updated since last sync
  const updatedFilter = sinceDate
    ? { OR: [{ createdAt: { gte: sinceDate } }, { updatedAt: { gte: sinceDate } }] }
    : {}

  const [
    products, sales, refunds, customers, debtSales, debtPayments,
    suppliers, purchaseOrders, supplierPayments, users, shifts,
    auditEvents, settings, expenses, batches, adjustments,
    counts, dailyCloses, deliveryOrders,
  ] = await Promise.all([
    prisma.product.findMany({
      where: { tenantId, ...(sinceDate ? updatedFilter : {}) },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.sale.findMany({
      where: { tenantId, ...(createdFilter ? { createdAt: createdFilter } : {}) },
      include: { items: true, tender: true },
      orderBy: { createdAt: "desc" },
      take: 2000,
    }),
    prisma.saleRefund.findMany({
      where: { tenantId, ...(createdFilter ? { createdAt: createdFilter } : {}) },
      include: { items: true },
      orderBy: { createdAt: "desc" },
      take: 1000,
    }),
    prisma.customer.findMany({
      where: { tenantId, ...(sinceDate ? updatedFilter : {}) },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.debtSale.findMany({
      where: { tenantId, ...(createdFilter ? { createdAt: createdFilter } : {}) },
      orderBy: { createdAt: "desc" },
      take: 2000,
    }),
    prisma.debtPayment.findMany({
      where: { tenantId, ...(createdFilter ? { createdAt: createdFilter } : {}) },
      orderBy: { createdAt: "desc" },
      take: 2000,
    }),
    prisma.supplier.findMany({
      where: { tenantId, ...(sinceDate ? updatedFilter : {}) },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.purchaseOrder.findMany({
      where: { tenantId, ...(createdFilter ? { createdAt: createdFilter } : {}) },
      orderBy: { createdAt: "desc" },
      take: 1000,
    }),
    prisma.supplierPayment.findMany({
      where: { tenantId, ...(createdFilter ? { createdAt: createdFilter } : {}) },
      orderBy: { createdAt: "desc" },
      take: 1000,
    }),
    prisma.staffUser.findMany({
      where: { tenantId, ...(createdFilter ? { createdAt: createdFilter } : {}) },
    }),
    prisma.shift.findMany({
      where: { tenantId, ...(createdFilter ? { openedAt: createdFilter } : {}) },
      orderBy: { openedAt: "desc" },
      take: 500,
    }),
    prisma.auditEvent.findMany({
      where: { tenantId, ...(createdFilter ? { createdAt: createdFilter } : {}) },
      orderBy: { createdAt: "desc" },
      take: 2000,
    }),
    prisma.appSettings.findUnique({ where: { tenantId } }),
    prisma.expense.findMany({
      where: { tenantId, ...(createdFilter ? { createdAt: createdFilter } : {}) },
      orderBy: { createdAt: "desc" },
      take: 1000,
    }),
    prisma.inventoryBatch.findMany({
      where: { tenantId, ...(createdFilter ? { receivedAt: createdFilter } : {}) },
      orderBy: { receivedAt: "desc" },
      take: 1000,
    }),
    prisma.stockAdjustment.findMany({
      where: { tenantId, ...(createdFilter ? { createdAt: createdFilter } : {}) },
      orderBy: { createdAt: "desc" },
      take: 1000,
    }),
    prisma.stockCountSession.findMany({
      where: { tenantId, ...(createdFilter ? { createdAt: createdFilter } : {}) },
      include: { lines: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.dailyClose.findMany({
      where: { tenantId, ...(createdFilter ? { createdAt: createdFilter } : {}) },
      orderBy: { createdAt: "desc" },
      take: 365,
    }),
    prisma.deliveryOrder.findMany({
      where: { tenantId, ...(sinceDate ? updatedFilter : {}) },
      include: { items: true },
      orderBy: { updatedAt: "desc" },
      take: 500,
    }),
  ])

  json(res, {
    products, sales, refunds, customers, debtSales, debtPayments,
    suppliers, purchaseOrders, supplierPayments, users, shifts,
    auditEvents, settings: settings ? [settings] : [], expenses, batches,
    adjustments, stockCounts: counts, dailyCloses, deliveryOrders,
  })
  } catch (err) {
    console.error("Sync pull error:", err)
    json(res, { error: "Failed to pull sync data" }, 500)
  }
})

async function processOperation(
  tenantId: string,
  entity: string,
  action: string,
  payload?: Record<string, unknown>,
  db: typeof prisma = prisma
) {
  switch (entity) {
    case "product": {
      if (action === "create" || action === "update") {
        const items = Array.isArray(payload) ? payload : [payload]
        for (const item of items) {
          const data = { ...item, tenantId } as Record<string, unknown>
          const barcode = data.barcode as string
          if (barcode) {
            await db.product.upsert({
              where: { tenantId_barcode: { tenantId, barcode } },
              create: data as any,
              update: data as any,
            })
          } else {
            await db.product.create({ data: data as any })
          }
        }
      } else if (action === "delete") {
        await db.product.deleteMany({ where: { tenantId, id: payload?.id as number } })
      }
      break
    }
    case "sale": {
      if (action === "void") {
        const id = payload?.id as string
        const saleNumber = payload?.saleNumber as string
        if (id) {
          const sale = await db.sale.findFirst({
            where: { id, tenantId, status: { not: "Voided" } },
            include: { items: true },
          })

          await db.sale.updateMany({
            where: { id, tenantId },
            data: { status: "Voided" },
          })

          for (const item of sale?.items ?? []) {
            await db.product.updateMany({
              where: { tenantId, id: item.productId },
              data: { stock: { increment: item.quantity } },
            })
          }

          // Clean up tender record to prevent stale tender data in reports
          await db.saleTender.deleteMany({ where: { saleId: id } })

          // If this was a debt sale, remove the DebtSale record too
          if (saleNumber) {
            await db.debtSale.deleteMany({
              where: { saleNumber, tenantId },
            })
          } else {
            const saleData = sale ?? await db.sale.findFirst({ where: { id, tenantId }, select: { saleNumber: true } })
            if (saleData?.saleNumber) {
              await db.debtSale.deleteMany({
                where: { saleNumber: saleData.saleNumber, tenantId },
              })
            }
          }
        }
      } else if (action === "create") {
        const data = payload as any
        const prismaItems = (data.items ?? []).map((item: any) => ({
          productId: Number(item.id),
          productName: item.name,
          barcode: item.barcode,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.total,
          cost: item.cost ?? 0,
        }))
        const { saleId: _s, ...prismaTender } = data.tender ?? {}
        const hasTender = Object.keys(prismaTender).length > 0
        const { items: _i, tender: _t, ...saleData } = data

        if (!saleData.id || prismaItems.length === 0) {
          throw new Error("Sale sync requires an id and at least one item")
        }

        // Check if sale already exists to avoid double-decrementing stock on retry
        const existingSale = await db.sale.findUnique({
          where: { id: saleData.id },
          select: { id: true },
        })

        await db.sale.upsert({
          where: { id: saleData.id },
          update: { ...saleData, tenantId },
          create: {
            ...saleData,
            tenantId,
            items: { create: prismaItems },
            tender: hasTender ? { create: prismaTender } : undefined,
          } as any,
        })

        await db.saleItem.deleteMany({ where: { saleId: saleData.id } })
        await db.saleItem.createMany({
          data: prismaItems.map((item: any) => ({ ...item, saleId: saleData.id })),
        })

        await db.saleTender.deleteMany({ where: { saleId: saleData.id } })
        if (hasTender) {
          await db.saleTender.create({
            data: { ...prismaTender, saleId: saleData.id },
          } as any)
        }

        // Only decrement stock for NEW sales (avoid double-decrement on retry)
        if (!existingSale) {
          await decrementProductStock(db, tenantId, prismaItems.map((i: any) => ({ productId: i.productId, productName: i.productName, quantity: i.quantity })))
        }
      }
      break
    }
    case "refund": {
      if (action === "create") {
        const data = payload as any
        const methodMap: Record<string, string> = {
          "Debt Credit": "Debt_Credit",
          "Refund Credit": "Debt_Credit",
        }
        const prismaItems = (data.items ?? []).map((item: any) => ({
          productId: Number(item.id),
          productName: item.name,
          barcode: item.barcode,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.total,
          cost: item.cost ?? 0,
        }))
        const { items: _i, ...refundData } = data
        await db.saleRefund.upsert({
          where: { id: refundData.id as string },
          update: refundData,
          create: {
            ...refundData,
            method: methodMap[refundData.method as string] ?? refundData.method,
            tenantId,
            items: { create: prismaItems },
          } as any,
        })
      }
      break
    }
    case "customer": {
      if (action === "create" || action === "update") {
        await db.customer.upsert({
          where: { id: payload?.id as string },
          create: { ...payload, tenantId } as any,
          update: { ...payload } as any,
        })
      } else if (action === "delete") {
        await db.customer.deleteMany({ where: { tenantId, id: payload?.id as string } })
      }
      break
    }
    case "supplier": {
      if (action === "create" || action === "update") {
        await db.supplier.upsert({
          where: { id: payload?.id as string },
          create: { ...payload, tenantId } as any,
          update: { ...payload } as any,
        })
      } else if (action === "delete") {
        await db.supplier.deleteMany({ where: { tenantId, id: payload?.id as string } })
      }
      break
    }
    case "staff": {
      if (action === "create" || action === "update") {
        const securePayload = await hashStaffPayload(payload)
        await db.staffUser.upsert({
          where: { id: payload?.id as string },
          create: { ...securePayload, tenantId } as any,
          update: { ...securePayload } as any,
        })
      }
      break
    }
    case "expense": {
      if (action === "create") {
        await db.expense.upsert({
          where: { id: payload?.id as string },
          update: payload as any,
          create: { ...payload, tenantId } as any,
        })
      }
      break
    }
    case "debt": {
      if (action === "create") {
        const { items: _i, ...debtData } = payload ?? {}
        await db.debtSale.upsert({
          where: { id: debtData.id as string },
          update: debtData,
          create: { ...debtData, tenantId } as any,
        })
      } else if (action === "payment") {
        await db.debtPayment.upsert({
          where: { id: payload?.id as string },
          update: payload as any,
          create: { ...payload, tenantId } as any,
        })
      } else if (action === "delete") {
        const id = payload?.id as string
        const saleNumber = payload?.saleNumber as string
        if (id) {
          await db.debtSale.deleteMany({ where: { id, tenantId } })
        } else if (saleNumber) {
          await db.debtSale.deleteMany({ where: { saleNumber, tenantId } })
        }
      }
      break
    }
    case "inventory": {
      if (action === "receive") {
        const items = Array.isArray(payload) ? payload : [payload]
        for (const item of items) {
          const { id: batchId, ...batchData } = item ?? {}
          await db.inventoryBatch.upsert({
            where: { id: batchId as string },
            update: batchData,
            create: { ...item, tenantId } as any,
          })
        }
      } else if (action === "adjust") {
        await db.stockAdjustment.upsert({
          where: { id: payload?.id as string },
          update: payload as any,
          create: { ...payload, tenantId } as any,
        })
      } else if (action === "count") {
        const data = payload as any
        const { lines: _l, ...sessionData } = data
        const prismaLines = (data.lines ?? []).map((line: any) => ({
          productId: Number(line.productId ?? line.id),
          productName: line.productName ?? line.name,
          barcode: line.barcode,
          category: line.category ?? "",
          expectedQuantity: line.expectedQuantity ?? 0,
          countedQuantity: line.countedQuantity ?? null,
          variance: line.variance ?? 0,
          valueImpact: line.valueImpact ?? 0,
        }))
        await db.stockCountSession.upsert({
          where: { id: sessionData.id as string },
          update: sessionData,
          create: {
            ...sessionData,
            tenantId,
            lines: { create: prismaLines },
          } as any,
        })
      }
      break
    }
    case "purchase-order": {
      if (action === "create" || action === "update") {
        const { items, ...poData } = payload ?? {}
        await db.purchaseOrder.upsert({
          where: { id: payload?.id as string },
          create: { ...poData, tenantId } as any,
          update: { ...poData } as any,
        })
        // Persist line items — delete existing then re-insert (idempotent)
        if (Array.isArray(items) && items.length > 0) {
          await db.purchaseOrderItem.deleteMany({
            where: { purchaseOrderId: payload?.id as string, tenantId },
          })
          await db.purchaseOrderItem.createMany({
            data: items.map((item: any) => ({
              id: item.id ?? undefined,
              tenantId,
              purchaseOrderId: payload?.id as string,
              productName: item.name ?? item.productName ?? "",
              barcode: item.barcode ?? "",
              quantity: item.quantity ?? 0,
              unitCost: item.unitCost ?? 0,
              unitPrice: item.unitPrice ?? item.price ?? 0,
              total: item.total ?? 0,
            })),
          })
        }
      }
      break
    }
    case "supplier-payment": {
      if (action === "payment" || action === "create") {
        await db.supplierPayment.upsert({
          where: { id: payload?.id as string },
          update: payload as any,
          create: { ...payload, tenantId } as any,
        })
      }
      break
    }
    case "shift": {
      if (action === "open") {
        await db.shift.upsert({
          where: { id: payload?.id as string },
          update: payload as any,
          create: { ...payload, tenantId } as any,
        })
      } else if (action === "close") {
        await db.shift.updateMany({
          where: { id: payload?.id as string, tenantId },
          data: { ...payload, status: "Closed", closedAt: new Date() } as any,
        })
      }
      break
    }
    case "settings": {
      if (action === "create" || action === "update") {
        const data = Array.isArray(payload) ? payload[0] ?? {} : payload ?? {}
        await db.appSettings.upsert({
          where: { tenantId },
          create: { ...data, tenantId } as any,
          update: { ...data } as any,
        })
      }
      break
    }
    case "daily-close": {
      if (action === "close") {
        await db.dailyClose.upsert({
          where: { id: payload?.id as string },
          update: payload as any,
          create: { ...payload, tenantId } as any,
        })
      }
      break
    }
    case "delivery-order": {
      if (action === "create") {
        const data = payload as any
        const { items: _i, ...orderData } = data
        const prismaItems = (data.items ?? []).map((item: any) => ({
          productId: Number(item.productId ?? item.id),
          productName: item.productName ?? item.name,
          barcode: item.barcode,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.total ?? item.quantity * item.unitPrice,
        }))
        await db.deliveryOrder.upsert({
          where: { id: orderData.id as string },
          update: orderData,
          create: {
            ...orderData,
            tenantId,
            items: { create: prismaItems },
          } as any,
        })
      } else if (action === "update") {
        // Only update fields that belong to this tenant
        await db.deliveryOrder.updateMany({
          where: { id: payload?.id as string, tenantId },
          data: payload as any,
        })
      }
      break
    }
    default:
      console.warn(`Unknown sync entity: ${entity}`)
  }
}

function validateSyncOperation(op: SyncOperationInput) {
  const allowedActions: Record<SyncOperationInput["entity"], SyncOperationInput["action"][]> = {
    sale: ["create", "void"],
    refund: ["create"],
    product: ["create", "update", "delete"],
    customer: ["create", "update", "delete"],
    debt: ["create", "payment", "delete"],
    expense: ["create"],
    "daily-close": ["close"],
    supplier: ["create", "update", "delete"],
    "purchase-order": ["create", "update"],
    "supplier-payment": ["create", "payment"],
    staff: ["create", "update"],
    shift: ["open", "close"],
    inventory: ["receive", "adjust", "count"],
    settings: ["create", "update"],
    "delivery-order": ["create", "update"],
  }

  if (!allowedActions[op.entity].includes(op.action)) {
    throw new Error(`Unsupported sync operation: ${op.entity}.${op.action}`)
  }

  if (!op.payload || (typeof op.payload !== "object" && !Array.isArray(op.payload))) {
    throw new Error(`Sync operation ${op.id} requires a payload`)
  }

  if (op.entity === "sale" && op.action === "create") {
    const payload = op.payload as Record<string, unknown>
    if (!payload.id || !Array.isArray(payload.items) || payload.items.length === 0) {
      throw new Error("Sale sync requires an id and at least one item")
    }
  }
}

async function hashStaffPayload(payload?: Record<string, unknown>) {
  const data = { ...(payload ?? {}) }
  const pin = typeof data.pin === "string" ? data.pin : ""

  if (pin && !pin.startsWith("$2") && !isSha256Base64(pin)) {
    data.pin = await bcrypt.hash(pin, 12)
  }

  return data
}

function isSha256Base64(value: string) {
  return /^[A-Za-z0-9+/]{43}=$/.test(value)
}

export default router
