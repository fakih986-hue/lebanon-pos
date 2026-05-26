import { Router } from "express"
import prisma from "../lib/prisma"
import { requireAuth, type AuthRequest } from "../middleware/auth"

const router = Router()

router.post("/push", requireAuth, async (req: AuthRequest, res) => {
  const { operations } = req.body as { operations: Array<{
    id: string
    entity: string
    action: string
    payload?: Record<string, unknown>
  }> }
  const tenantId = req.auth!.tenantId

  if (!Array.isArray(operations)) {
    res.status(400).json({ error: "operations must be an array" })
    return
  }

  const results: Array<{ id: string; status: "ok" | "error"; error?: string }> = []

  for (const op of operations) {
    try {
      await processOperation(tenantId, op.entity, op.action, op.payload)
      await prisma.syncOperation.create({
        data: {
          id: op.id,
          tenantId,
          entity: op.entity,
          action: op.action,
          summary: `${op.action} ${op.entity}`,
          payload: (op.payload ?? {}) as any,
          status: "Synced",
          syncedAt: new Date(),
        },
      })
      results.push({ id: op.id, status: "ok" })
    } catch (err) {
      results.push({ id: op.id, status: "error", error: (err as Error).message })
    }
  }

  res.json({ results })
})

router.get("/pull", requireAuth, async (req: AuthRequest, res) => {
  const tenantId = req.auth!.tenantId
  const since = req.query.since as string | undefined

  const where: Record<string, unknown> = { tenantId }
  if (since) {
    where.createdAt = { gte: new Date(since) }
  }

  const [
    products, sales, refunds, customers, debtSales, debtPayments,
    suppliers, purchaseOrders, supplierPayments, users, shifts,
    auditEvents, settings, expenses, batches, adjustments,
    counts, dailyCloses,
  ] = await Promise.all([
    prisma.product.findMany({ where: { tenantId } }),
    prisma.sale.findMany({ where: { tenantId }, include: { items: true, tender: true } }),
    prisma.saleRefund.findMany({ where: { tenantId }, include: { items: true } }),
    prisma.customer.findMany({ where: { tenantId } }),
    prisma.debtSale.findMany({ where: { tenantId } }),
    prisma.debtPayment.findMany({ where: { tenantId } }),
    prisma.supplier.findMany({ where: { tenantId } }),
    prisma.purchaseOrder.findMany({ where: { tenantId } }),
    prisma.supplierPayment.findMany({ where: { tenantId } }),
    prisma.staffUser.findMany({ where: { tenantId } }),
    prisma.shift.findMany({ where: { tenantId } }),
    prisma.auditEvent.findMany({ where: { tenantId } }),
    prisma.appSettings.findUnique({ where: { tenantId } }),
    prisma.expense.findMany({ where: { tenantId } }),
    prisma.inventoryBatch.findMany({ where: { tenantId } }),
    prisma.stockAdjustment.findMany({ where: { tenantId } }),
    prisma.stockCountSession.findMany({ where: { tenantId }, include: { lines: true } }),
    prisma.dailyClose.findMany({ where: { tenantId } }),
  ])

  res.json({
    products, sales, refunds, customers, debtSales, debtPayments,
    suppliers, purchaseOrders, supplierPayments, users, shifts,
    auditEvents, settings: settings ?? null, expenses, batches,
    adjustments, stockCounts: counts, dailyCloses,
  })
})

async function processOperation(
  tenantId: string,
  entity: string,
  action: string,
  payload?: Record<string, unknown>
) {
  switch (entity) {
    case "product": {
      if (action === "create" || action === "update") {
        const data = { ...payload, tenantId } as Record<string, unknown>
        const barcode = data.barcode as string
        if (barcode) {
          await prisma.product.upsert({
            where: { tenantId_barcode: { tenantId, barcode } },
            create: data as any,
            update: data as any,
          })
        } else {
          await prisma.product.create({ data: data as any })
        }
      } else if (action === "delete") {
        await prisma.product.deleteMany({ where: { tenantId, id: payload?.id as number } })
      }
      break
    }
    case "sale": {
      if (action === "create") {
        const data = payload as any
        await prisma.sale.create({
          data: {
            ...data,
            tenantId,
            items: { create: data.items ?? [] },
            tender: data.tender ? { create: data.tender } : undefined,
          } as any,
        })
      }
      break
    }
    case "refund": {
      if (action === "create") {
        const data = payload as any
        await prisma.saleRefund.create({
          data: {
            ...data,
            tenantId,
            items: { create: data.items ?? [] },
          } as any,
        })
      }
      break
    }
    case "customer": {
      if (action === "create" || action === "update") {
        await prisma.customer.upsert({
          where: { id: payload?.id as string },
          create: { ...payload, tenantId } as any,
          update: { ...payload } as any,
        })
      } else if (action === "delete") {
        await prisma.customer.deleteMany({ where: { tenantId, id: payload?.id as string } })
      }
      break
    }
    case "supplier": {
      if (action === "create" || action === "update") {
        await prisma.supplier.upsert({
          where: { id: payload?.id as string },
          create: { ...payload, tenantId } as any,
          update: { ...payload } as any,
        })
      } else if (action === "delete") {
        await prisma.supplier.deleteMany({ where: { tenantId, id: payload?.id as string } })
      }
      break
    }
    case "staff": {
      if (action === "create" || action === "update") {
        await prisma.staffUser.upsert({
          where: { id: payload?.id as string },
          create: { ...payload, tenantId } as any,
          update: { ...payload } as any,
        })
      }
      break
    }
    case "expense": {
      if (action === "create") {
        await prisma.expense.create({ data: { ...payload, tenantId } as any })
      }
      break
    }
    case "inventory": {
      if (action === "receive") {
        await prisma.inventoryBatch.create({ data: { ...payload, tenantId } as any })
      }
      break
    }
    case "shift": {
      if (action === "open") {
        await prisma.shift.create({ data: { ...payload, tenantId } as any })
      } else if (action === "close") {
        await prisma.shift.update({
          where: { id: payload?.id as string },
          data: { ...payload, status: "Closed", closedAt: new Date() } as any,
        })
      }
      break
    }
    case "settings": {
      if (action === "create" || action === "update") {
        await prisma.appSettings.upsert({
          where: { tenantId },
          create: { ...payload, tenantId } as any,
          update: { ...payload } as any,
        })
      }
      break
    }
    case "daily-close": {
      if (action === "close") {
        await prisma.dailyClose.create({ data: { ...payload, tenantId } as any })
      }
      break
    }
    default:
      console.warn(`Unknown sync entity: ${entity}`)
  }
}

export default router
