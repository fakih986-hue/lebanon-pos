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
    "held-sale",
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
  const results: Array<{ id: string; status: "ok" | "error" | "rejected"; error?: string }> = []

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

        // Mark as Pending so the cloud sync bridge picks it up and pushes to Railway.
        // (The phone already has it synced — this is for the hub→Railway direction.)
        const operationData = {
          entity: op.entity,
          action: op.action,
          summary: `${op.action} ${op.entity}`,
          payload: (op.payload ?? {}) as any,
          status: "Pending",
          syncedAt: null,
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

      // Classify rejection errors — these are non-retryable business conflicts
      const isRejected =
        errorMessage.includes("Insufficient stock") ||
        errorMessage.includes("was voided") ||
        errorMessage.includes("Insufficient stock in batch") ||
        errorMessage.includes("PIN is already in use by")
      const opStatus = isRejected ? "Rejected" : "Failed"

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
            status: opStatus,
            attempts: isRejected ? 5 : 1,
            lastAttemptAt: new Date(),
            error: errorMessage,
          },
          update: {
            status: opStatus,
            attempts: isRejected ? 5 : { increment: 1 },
            lastAttemptAt: new Date(),
            error: errorMessage,
          },
        })
        .catch((syncLogError: unknown) => {
          console.error("Failed to record sync error:", syncLogError)
        })

      results.push({ id: op.id, status: isRejected ? "rejected" : "error", error: errorMessage })
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
  if (since && (!sinceDate || isNaN(sinceDate.getTime()))) {
    json(res, { error: "Invalid 'since' date parameter" }, 400)
    return
  }

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
    counts, dailyCloses, deliveryOrders, deletions,
  ] = await Promise.all([
    prisma.product.findMany({
      where: { tenantId, ...(sinceDate ? updatedFilter : {}) },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.sale.findMany({
      where: { tenantId, ...(createdFilter ? { createdAt: createdFilter } : {}) },
      include: { items: true, tender: true },
      orderBy: { createdAt: "desc" },
      take: sinceDate ? 2000 : undefined,
    }),
    prisma.saleRefund.findMany({
      where: { tenantId, ...(createdFilter ? { createdAt: createdFilter } : {}) },
      include: { items: true },
      orderBy: { createdAt: "desc" },
      take: sinceDate ? 1000 : undefined,
    }),
    prisma.customer.findMany({
      where: { tenantId, ...(sinceDate ? updatedFilter : {}) },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.debtSale.findMany({
      where: { tenantId, ...(createdFilter ? { createdAt: createdFilter } : {}) },
      orderBy: { createdAt: "desc" },
      take: sinceDate ? 2000 : undefined,
    }),
    prisma.debtPayment.findMany({
      where: { tenantId, ...(createdFilter ? { createdAt: createdFilter } : {}) },
      orderBy: { createdAt: "desc" },
      take: sinceDate ? 2000 : undefined,
    }),
    prisma.supplier.findMany({
      where: { tenantId, ...(sinceDate ? updatedFilter : {}) },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.purchaseOrder.findMany({
      where: { tenantId, ...(createdFilter ? { createdAt: createdFilter } : {}) },
      orderBy: { createdAt: "desc" },
      take: sinceDate ? 1000 : undefined,
    }),
    prisma.supplierPayment.findMany({
      where: { tenantId, ...(createdFilter ? { createdAt: createdFilter } : {}) },
      orderBy: { createdAt: "desc" },
      take: sinceDate ? 1000 : undefined,
    }),
    prisma.staffUser.findMany({
      where: { tenantId, ...(createdFilter ? { createdAt: createdFilter } : {}) },
    }),
    prisma.shift.findMany({
      where: { tenantId, ...(createdFilter ? { openedAt: createdFilter } : {}) },
      orderBy: { openedAt: "desc" },
      take: sinceDate ? 500 : undefined,
    }),
    prisma.auditEvent.findMany({
      where: { tenantId, ...(createdFilter ? { createdAt: createdFilter } : {}) },
      orderBy: { createdAt: "desc" },
      take: sinceDate ? 2000 : undefined,
    }),
    prisma.appSettings.findUnique({ where: { tenantId } }),
    prisma.expense.findMany({
      where: { tenantId, ...(createdFilter ? { createdAt: createdFilter } : {}) },
      orderBy: { createdAt: "desc" },
      take: sinceDate ? 1000 : undefined,
    }),
    prisma.inventoryBatch.findMany({
      where: { tenantId, ...(createdFilter ? { receivedAt: createdFilter } : {}) },
      orderBy: { receivedAt: "desc" },
      take: sinceDate ? 1000 : undefined,
    }),
    prisma.stockAdjustment.findMany({
      where: { tenantId, ...(createdFilter ? { createdAt: createdFilter } : {}) },
      orderBy: { createdAt: "desc" },
      take: sinceDate ? 1000 : undefined,
    }),
    prisma.stockCountSession.findMany({
      where: { tenantId, ...(createdFilter ? { createdAt: createdFilter } : {}) },
      include: { lines: true },
      orderBy: { createdAt: "desc" },
      take: sinceDate ? 200 : undefined,
    }),
    prisma.dailyClose.findMany({
      where: { tenantId, ...(createdFilter ? { createdAt: createdFilter } : {}) },
      orderBy: { createdAt: "desc" },
      take: sinceDate ? 365 : undefined,
    }),
    prisma.deliveryOrder.findMany({
      where: { tenantId, ...(sinceDate ? updatedFilter : {}) },
      include: { items: true },
      orderBy: { updatedAt: "desc" },
      take: sinceDate ? 500 : undefined,
    }),
    prisma.syncOperation.findMany({
      where: {
        tenantId,
        action: "delete",
        ...(createdFilter ? { createdAt: createdFilter } : {}),
      },
      select: { entity: true, payload: true, createdAt: true },
      orderBy: { createdAt: "asc" },
      take: sinceDate ? 1000 : undefined,
    }),
  ])

  json(res, {
    serverTime: new Date().toISOString(),
    products, sales, refunds, customers, debtSales, debtPayments,
    suppliers, purchaseOrders, supplierPayments, users, shifts,
    auditEvents, settings: settings ? [settings] : [], expenses, batches,
    adjustments, stockCounts: counts, dailyCloses, deliveryOrders,
    deletions: deletions.map((op) => ({
      entity: op.entity,
      id: (op.payload as any)?.id,
      saleNumber: (op.payload as any)?.saleNumber,
      deletedAt: op.createdAt,
    })),
  })
  } catch (err) {
    console.error("Sync pull error:", err)
    json(res, { error: "Failed to pull sync data" }, 500)
  }
})

// ─── Per-entity paginated full pull (cursor-based) ──────────────────────────

type EntityConfig = {
  include?: Record<string, any>
  cursorType: "string" | "number"
}

const PULL_FULL_ENTITIES: Record<string, EntityConfig> = {
  products:          { cursorType: "number" },
  sales:             { cursorType: "string", include: { items: true, tender: true } },
  refunds:           { cursorType: "string", include: { items: true } },
  customers:         { cursorType: "string" },
  "debt-sales":      { cursorType: "string" },
  "debt-payments":   { cursorType: "string" },
  suppliers:         { cursorType: "string" },
  "purchase-orders": { cursorType: "string" },
  "supplier-payments": { cursorType: "string" },
  batches:           { cursorType: "string" },
  adjustments:       { cursorType: "string" },
  "stock-counts":    { cursorType: "string", include: { lines: true } },
  "daily-closes":    { cursorType: "string" },
  "delivery-orders": { cursorType: "string", include: { items: true } },
  expenses:          { cursorType: "string" },
  users:             { cursorType: "string" },
  shifts:            { cursorType: "string" },
  "audit-events":    { cursorType: "string" },
}

const MODEL_MAP: Record<string, string> = {
  products:          "product",
  sales:             "sale",
  refunds:           "saleRefund",
  customers:         "customer",
  "debt-sales":      "debtSale",
  "debt-payments":   "debtPayment",
  suppliers:         "supplier",
  "purchase-orders": "purchaseOrder",
  "supplier-payments": "supplierPayment",
  batches:           "inventoryBatch",
  adjustments:       "stockAdjustment",
  "stock-counts":    "stockCountSession",
  "daily-closes":    "dailyClose",
  "delivery-orders": "deliveryOrder",
  expenses:          "expense",
  users:             "staffUser",
  shifts:            "shift",
  "audit-events":    "auditEvent",
}

router.get("/pull/full/:entity", requireCloudOrJwtAuth, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const tenantId = req.auth!.tenantId
    const entity = ((req as any).params?.entity as string) || ""

    const rawCursor = req.query.cursor as string | undefined
    const rawLimit = req.query.limit as string | undefined
    const limit = Math.min(Math.max(1, Number(rawLimit) || 5000), 10000)

    // Special entities that don't follow findMany pattern
    if (entity === "settings") {
      const settings = await prisma.appSettings.findUnique({ where: { tenantId } })
      json(res, { entity, items: settings ? [settings] : [], hasMore: false, nextCursor: null })
      return
    }
    if (entity === "deletions") {
      const cursor = rawCursor ?? undefined
      const where: any = { tenantId, action: "delete" }
      if (cursor) where.id = { gt: cursor }
      const items = await prisma.syncOperation.findMany({
        where,
        orderBy: { id: "asc" },
        take: limit + 1,
        select: { entity: true, payload: true, createdAt: true, id: true },
      })
      const hasMore = items.length > limit
      if (hasMore) items.pop()
      const nextCursor = hasMore ? items[items.length - 1]?.id : null
      json(res, { entity, items, hasMore, nextCursor: nextCursor ?? null })
      return
    }

    const config = PULL_FULL_ENTITIES[entity as keyof typeof PULL_FULL_ENTITIES]
    if (!config) {
      json(res, { error: `Unknown entity: ${entity}` }, 400)
      return
    }

    const modelName = MODEL_MAP[entity as keyof typeof MODEL_MAP] as string
    const model = (prisma as any)[modelName]
    if (!model) {
      json(res, { error: `No model for entity: ${entity}` }, 500)
      return
    }

    const cursor = rawCursor
      ? config.cursorType === "number"
        ? Number(rawCursor)
        : rawCursor
      : undefined

    const where: any = { tenantId }
    if (cursor !== undefined) {
      where.id = config.cursorType === "number" ? { gt: cursor as number } : { gt: cursor as string }
    }

    const items = await model.findMany({
      where,
      orderBy: { id: "asc" },
      take: limit + 1,
      ...(config.include ? { include: config.include } : {}),
    })

    const hasMore = items.length > limit
    if (hasMore) items.pop()
    const nextCursor = hasMore ? items[items.length - 1]?.id : null

    json(res, {
      entity,
      items,
      hasMore,
      nextCursor: nextCursor ?? null,
    })
  } catch (err) {
    console.error(`Sync pull-full error:`, err)
    json(res, { error: "Failed to pull full data" }, 500)
  }
})

async function processOperation(
  tenantId: string,
  entity: string,
  action: string,
  payload?: Record<string, unknown>,
  db: typeof prisma = prisma
) {
  // Helper: resolve a product ID from cross-device sync. The phone may use a
  // different local ID than the hub. Falls back to barcode lookup.
  const resolveProductId = async (idOrProduct: any): Promise<number> => {
    let pid = Number(idOrProduct.productId ?? idOrProduct.id ?? idOrProduct)
    if (pid > 0) {
      const exists = await db.product.findFirst({ where: { tenantId, id: pid }, select: { id: true } })
      if (exists) return pid
    }
    const barcode = idOrProduct.barcode
    if (barcode) {
      const product = await db.product.findFirst({ where: { tenantId, barcode }, select: { id: true } })
      if (product) return product.id
    }
    return pid || 0
  }

  // Record a stock movement for the audit trail (ledger-based stock)
  const recordMovement = async (productId: number, type: string, quantity: number, reference: string, note = "") => {
    if (!productId || productId <= 0) return
    const stockMovement = (db as any).stockMovement
    if (!stockMovement) return
    // Calculate running balance
    const lastMovement = await stockMovement.findFirst({
      where: { tenantId, productId },
      orderBy: { createdAt: "desc" },
      select: { balance: true },
    })
    const prevBalance = lastMovement?.balance ?? 0
    const balance = prevBalance + quantity
    await stockMovement.create({
      data: { tenantId, productId, type, quantity, balance, reference, note },
    })
  }

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
        const productId = payload?.id as number
        if (tenantId && productId) {
          await db.inventoryBatch.deleteMany({ where: { tenantId, productId } })
          await db.stockAdjustment.deleteMany({ where: { tenantId, productId } })
          await (db as any).stockMovement.deleteMany({ where: { tenantId, productId } })
          const countSessions = await db.stockCountSession.findMany({
            where: { tenantId },
            select: { id: true },
          })
          if (countSessions.length > 0) {
            await db.stockCountLine.deleteMany({
              where: { productId, sessionId: { in: countSessions.map(s => s.id) } },
            })
          }
        }
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
              data: { stock: { increment: item.quantity }, updatedAt: new Date() },
            })
            // Record the void as a Refund movement (stock comes back)
            await recordMovement(item.productId, "Refund", item.quantity, `void:${id}`, `Void sale ${saleNumber ?? id}`)
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
        const prismaItems = await Promise.all((data.items ?? []).map(async (item: any) => ({
          productId: await resolveProductId(item),
          productName: item.name,
          barcode: item.barcode,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.total,
          cost: item.cost ?? 0,
        })))
        const { saleId: _s, ...prismaTender } = data.tender ?? {}
        const hasTender = Object.keys(prismaTender).length > 0
        const { items: _i, tender: _t, ...saleData } = data

        if (!saleData.id || prismaItems.length === 0) {
          throw new Error("Sale sync requires an id and at least one item")
        }

        // Check if sale already exists to avoid double-decrementing stock on retry
        const existingSale = await db.sale.findUnique({
          where: { id: saleData.id },
          select: { id: true, status: true },
        })

        if (existingSale) {
          // Guard: never revive a voided sale
          if (existingSale.status === "Voided") {
            throw new Error(`Sale ${saleData.id} was voided — cannot re-create`)
          }
          // Sale already exists — this is a safe retry. Skip upsert + stock
          // decrement so a duplicate "create" cannot alter sale items or
          // corrupt product stock.
          break
        }

        await db.sale.create({
          data: {
            ...saleData,
            tenantId,
            items: { create: prismaItems },
            tender: hasTender ? { create: prismaTender } : undefined,
          } as any,
        })

        // Decrement product stock
        await decrementProductStock(db, tenantId, prismaItems.map((i: any) => ({ productId: i.productId, productName: i.productName, quantity: i.quantity })))
        // Atomic batch decrement — updateMany with quantityRemaining >= quantity is atomic
        for (const item of data.items ?? []) {
          for (const allocation of item.batchAllocations ?? []) {
            if (!allocation.batchId || allocation.batchId === "legacy-stock") continue
            const quantity = Number(allocation.quantity ?? 0)
            if (quantity <= 0) continue
            const result = await db.inventoryBatch.updateMany({
              where: { id: allocation.batchId, tenantId, quantityRemaining: { gte: quantity } },
              data: { quantityRemaining: { decrement: quantity } },
            })
            if (result.count === 0) {
              throw new Error(`Insufficient stock in batch ${allocation.batchId}`)
            }
          }
        }
        // Update status for any batches that were exhausted
        for (const item of data.items ?? []) {
          for (const allocation of item.batchAllocations ?? []) {
            if (!allocation.batchId || allocation.batchId === "legacy-stock") continue
            if (Number(allocation.quantity ?? 0) <= 0) continue
            await db.inventoryBatch.updateMany({
              where: { id: allocation.batchId, tenantId, quantityRemaining: { lte: 0 } },
              data: { status: "Consumed" },
            })
          }
        }
        // Record stock movements for audit trail
        for (const item of prismaItems) {
          await recordMovement(item.productId, "Sale", -item.quantity, saleData.id as string)
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
        const prismaItems = await Promise.all((data.items ?? []).map(async (item: any) => {
          return {
            productId: await resolveProductId(item),
            productName: item.name,
            barcode: item.barcode,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            total: item.total,
            cost: item.cost ?? 0,
          }
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
        // Restore product stock for refunded items
        for (const item of prismaItems) {
          await db.product.updateMany({
            where: { tenantId, id: item.productId },
            data: { stock: { increment: item.quantity }, updatedAt: new Date() },
          })
          await recordMovement(item.productId, "Refund", item.quantity, refundData.id as string)
        }
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

        // ── Enforce PIN uniqueness per tenant ────────────────────────
        const rawPin = payload?.pin as string | undefined
        if (rawPin && !rawPin.startsWith("$2")) {
          const existing = await db.staffUser.findMany({
            where: { tenantId, id: { not: securePayload.id as string | undefined } },
            select: { id: true, name: true, pin: true },
          })
          for (const u of existing) {
            // Both SHA-256 → direct comparison is reliable
            if (!u.pin.startsWith("$2") && u.pin === rawPin) {
              throw new Error(`PIN is already in use by ${u.name}`)
            }
          }
        }

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
          // Resolve product ID by barcode for cross-device sync
          let productId = Number(item?.productId ?? item?.id)
          if (productId) {
            const exists = await db.product.findFirst({ where: { tenantId, id: productId }, select: { id: true } })
            if (!exists) productId = 0 // trigger barcode fallback
          }
          if ((!productId || isNaN(productId)) && item?.barcode) {
            const product = await db.product.findFirst({
              where: { tenantId, barcode: item.barcode },
              select: { id: true },
            })
            if (product) productId = product.id
          }
          const { id: batchId, ...batchData } = { ...item, productId }
          await db.inventoryBatch.upsert({
            where: { id: batchId as string },
            update: batchData,
            create: { ...batchData, id: batchId, tenantId } as any,
          })
          // Record the stock movement (quantity is the net change)
          await recordMovement(productId, "Receive", Number(item.quantityRemaining ?? item.initialQuantity ?? 0), batchId as string, `Batch ${item.batchNumber ?? ""}`)
        }
      } else if (action === "update") {
        const items = Array.isArray(payload) ? payload : [payload]
        for (const item of items) {
          if (!item?.id) continue
          await db.inventoryBatch.updateMany({
            where: { id: item.id as string, tenantId },
            data: {
              quantityRemaining: item.quantityRemaining,
              status: item.status,
            } as any,
          })
        }
      } else if (action === "adjust") {
        await db.stockAdjustment.upsert({
          where: { id: payload?.id as string },
          update: payload as any,
          create: { ...payload, tenantId } as any,
        })
        const adj = payload as any
        await recordMovement(Number(adj.productId ?? adj.id), "Adjustment", Number(adj.quantityChange ?? 0), adj.id as string, adj.reason ?? "")
      } else if (action === "count") {
        const data = payload as any
        const { lines: _l, ...sessionData } = data
        const prismaLines = await Promise.all((data.lines ?? []).map(async (line: any) => ({
          productId: await resolveProductId(line),
          productName: line.productName ?? line.name,
          barcode: line.barcode,
          category: line.category ?? "",
          expectedQuantity: line.expectedQuantity ?? 0,
          countedQuantity: line.countedQuantity ?? null,
          variance: line.variance ?? 0,
          valueImpact: line.valueImpact ?? 0,
        })))
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
    case "held-sale": {
      // Held sales are ephemeral UI state; no server-side processing needed
      break
    }
    case "delivery-order": {
      if (action === "create") {
        const data = payload as any
        const { items: _i, ...orderData } = data
        const prismaItems = await Promise.all((data.items ?? []).map(async (item: any) => ({
          productId: await resolveProductId(item),
          productName: item.productName ?? item.name,
          barcode: item.barcode,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.total ?? item.quantity * item.unitPrice,
        })))
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
        await db.deliveryOrder.updateMany({
          where: { id: payload?.id as string, tenantId },
          data: { ...payload, updatedAt: new Date() } as any,
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
    inventory: ["receive", "adjust", "count", "update"],
    settings: ["create", "update"],
    "delivery-order": ["create", "update"],
    "held-sale": ["create", "delete"],
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
