import { Router } from "express"
import type { ServerResponse } from "node:http"
import bcrypt from "bcryptjs"
import { randomUUID } from "node:crypto"
import { z } from "zod"
import prisma from "../lib/prisma.js"

/** True only on the authoritative cloud instance (Railway), false on hubs. */
const IS_CLOUD = !["true", "1"].includes(process.env.IS_LOCAL_SERVER || "")

import { decrementProductStock } from "../lib/inventory.js"
import { recordStockMovement, recordStockMovementOnce } from "../lib/ledger.js"
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
    "cash-movement",
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
  deviceId: z.string().optional(),
  operations: z.array(syncOperationSchema).max(100),
})

type SyncOperationInput = z.infer<typeof syncOperationSchema>

router.get("/status", requireAuth, async (req: AuthRequest, res: ServerResponse) => {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.auth!.tenantId },
      select: {
        name: true, subdomain: true, suspended: true,
        licenseStatus: true, licenseReason: true, licenseMessage: true,
        suspendedAt: true, offlineGraceDays: true, leaseExpiresAt: true,
        policyVersion: true,
      },
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

  // ── License check: block business writes on server side ──────────────
  // Never trust desktop-only enforcement. Server also blocks writes when
  // tenant is read_only or suspended after grace expiry.
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { licenseStatus: true, suspendedAt: true, offlineGraceDays: true },
  })
  if (tenant) {
    // Treat null/undefined/active as not blocked
    const status = (tenant.licenseStatus || "active")
    const isBlocked =
      status === "read_only" ||
      status === "recovery" ||
      (status === "suspended" && tenant.suspendedAt &&
        (Date.now() - new Date(tenant.suspendedAt).getTime()) > ((tenant.offlineGraceDays ?? 7) * 24 * 60 * 60 * 1000))

    if (isBlocked) {
      json(res, { error: "Store is currently suspended. Contact support.", code: "LICENSE_BLOCKED" }, 403)
      return
    }
  }

  // ── Device approval check (local hub only) ──────────────────────────
  const isLocalHub = ["true", "1"].includes(process.env.IS_LOCAL_SERVER || "")
  const deviceId = parsed.data.deviceId
  if (isLocalHub && deviceId) {
    const device = await prisma.device.findUnique({
      where: { tenantId_deviceId: { tenantId, deviceId } },
    })
    if (!device || device.status !== "APPROVED") {
      await prisma.auditEvent.create({
        data: {
          tenantId,
          action: "sync.rejected.unapproved-device",
          entity: "device",
          summary: `Sync push rejected: device ${deviceId} is not approved`,
          metadata: { deviceId },
          userId: "system",
          userName: "system",
          userRole: "Admin",
        },
      })
      json(res, { error: "This device is not approved to sync with this hub. Contact the hub owner to pair your device.", code: "DEVICE_NOT_APPROVED" }, 403)
      return
    }
    await prisma.device.update({
      where: { id: device!.id },
      data: { lastSeenAt: new Date(), lastIp: req.socket?.remoteAddress || "" },
    })
  } else if (isLocalHub && !deviceId) {
    json(res, { error: "deviceId is required for hub sync", code: "DEVICE_ID_REQUIRED" }, 400)
    return
  }

  const results: Array<{ id: string; status: "ok" | "error" | "rejected"; error?: string }> = []
  const activities: Array<{ entity: string; action: string; summary: string }> = []

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
        await processOperation(tenantId, op.entity, op.action, op.payload as any, tx as typeof prisma, { deviceId: deviceId ?? null, userId: req.auth!.userId })

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
      const summary = buildActivitySummary(op.entity, op.action, op.payload)
      if (summary) activities.push({ entity: op.entity, action: op.action, summary })
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
    // Live activity feed — friendly, human-readable summaries of what just
    // happened, broadcast alongside the raw data-changed signal so other
    // devices can show "X sold Y" instantly instead of just silently
    // re-pulling. Includes the sender's deviceId so a device can filter out
    // its own actions (seeing "you sold X" right after doing it is noise).
    if (activities.length > 0) {
      try { broadcastToTenant(tenantId, "sync:activity", { activities, deviceId: deviceId ?? null, at: new Date().toISOString() }) } catch { /* no-op */ }
    }
  }

  json(res, { results })
})

// ─── POST /api/sync/validate-stock ───────────────────────────────────────────
// Preflight check for connected clients (CONNECT_TO_HUB mode): asks the hub
// whether a cart's requested quantities are actually available RIGHT NOW,
// against live product.stock — not whatever the client's local cache last
// pulled. Exists specifically to close the race where two devices both see
// "10 in stock" locally, one sells it all, and the other's stale cart would
// otherwise complete a checkout the hub can never actually honor. Read-only:
// does not reserve or lock anything, so a sale can still theoretically race
// between this check and the real push — the atomic server-side decrement in
// the "sale"/"create" handler above remains the ultimate backstop.
const validateStockSchema = z.object({
  items: z.array(z.object({
    productId: z.number(),
    quantity: z.number(),
  })).min(1),
})

router.post("/validate-stock", requireCloudOrJwtAuth, async (req: AuthRequest, res: ServerResponse) => {
  const tenantId = req.auth!.tenantId
  const parsed = validateStockSchema.safeParse(req.body)
  if (!parsed.success) {
    json(res, { error: "Invalid request", details: parsed.error.flatten() }, 400)
    return
  }

  const { items } = parsed.data
  const productIds = [...new Set(items.map((i) => i.productId))]
  const products = await prisma.product.findMany({
    where: { tenantId, id: { in: productIds } },
    select: { id: true, name: true, stock: true, archived: true },
  })
  const byId = new Map(products.map((p) => [p.id, p]))

  const insufficientItems: Array<{ productId: number; name: string; available: number; requested: number }> = []
  for (const item of items) {
    const product = byId.get(item.productId)
    const available = product ? Number(product.stock) : 0
    if (!product || product.archived || available < item.quantity) {
      insufficientItems.push({
        productId: item.productId,
        name: product?.name ?? `Product #${item.productId}`,
        available: product && !product.archived ? available : 0,
        requested: item.quantity,
      })
    }
  }

  json(res, { ok: insufficientItems.length === 0, insufficientItems })
})

// ─── GET /api/sync/sale-committed/:saleId ────────────────────────────────────
// Idempotency confirm-before-re-ring for server-authoritative checkout. When a
// connected client's write-through commit times out (the hub may have committed
// the sale but the response was lost), the client calls this BEFORE letting the
// cashier re-ring — so a committed-but-unacked sale is finalized rather than
// duplicated. Returns whether a non-voided sale with this id exists on the hub.
router.get("/sale-committed/:saleId", requireCloudOrJwtAuth, async (req: AuthRequest, res: ServerResponse) => {
  const tenantId = req.auth!.tenantId
  const saleId = ((req as any).params?.saleId as string) || ""
  if (!saleId) { json(res, { error: "saleId required" }, 400); return }
  const sale = await prisma.sale.findFirst({
    where: { id: saleId, tenantId, status: { not: "Voided" } },
    select: { id: true },
  })
  json(res, { committed: !!sale })
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
  // InventoryBatch has no createdAt — it uses receivedAt (set once) plus
  // updatedAt (bumped on every quantityRemaining/status change). Filter on
  // BOTH so a batch consumed by a sale is surfaced to other devices, not just
  // freshly-received batches (POS-SYNC-AUTHORITY-1).
  const batchUpdatedFilter = sinceDate
    ? { OR: [{ receivedAt: { gte: sinceDate } }, { updatedAt: { gte: sinceDate } }] }
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
      where: { tenantId, ...(sinceDate ? batchUpdatedFilter : {}) },
      orderBy: { updatedAt: "desc" },
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
  db: typeof prisma = prisma,
  // POS-SYNC-AUTHORITY-2A — source attribution for the stock ledger (record-only).
  source: { deviceId?: string | null; userId?: string | null } = {}
) {
  // Helper: resolve a product ID from cross-device sync. The phone may use a
  // different local ID than the hub. Falls back to barcode lookup.
  const resolveProductId = async (idOrProduct: any): Promise<number> => {
    // Cross-system product resolution for child records (sale items, batches,
    // adjustments, count lines). Match order mirrors the product handler:
    // productSyncId (stable cross-DB identity) → numeric id (local/aligned) →
    // barcode (legacy fallback). A child payload created on a hub carries a
    // hub-local productId that is meaningless on cloud, so productSyncId is the
    // only reliable cross-system link — but we always return THIS database's
    // own numeric id for the local FK.
    const syncId = idOrProduct?.productSyncId ?? idOrProduct?.syncId
    if (syncId) {
      const bySync = await db.product.findFirst({ where: { tenantId, syncId: String(syncId) }, select: { id: true } })
      if (bySync) return bySync.id
    }
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

  // registerId/deviceId are client-side attribution metadata the desktop app
  // attaches to sale/shift/expense/cash-movement/daily-close/purchase-order/
  // supplier-payment payloads — none of those Prisma models have columns for
  // them (that shift attribution already lives on Shift/DailyClose, keyed by
  // shiftId), so forwarding them into any prisma.<model>.create()/update()
  // throws "Unknown argument". Strip them once here instead of per-case below.
  const stripClientMeta = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stripClientMeta)
    if (value && typeof value === "object") {
      const { registerId: _reg, deviceId: _dev, ...rest } = value as Record<string, unknown>
      return rest
    }
    return value
  }
  payload = stripClientMeta(payload) as Record<string, unknown> | undefined

  // Record a stock movement for the audit trail (POS-SYNC-AUTHORITY-2A ledger,
  // RECORD-ONLY — does not change any stock outcome). Delegates to the shared
  // writer, threading source attribution (deviceId/userId from the push request,
  // userName from the payload's cashier when present).
  const cashier = (payload as any)?.cashier as string | undefined
  const recordMovement = (productId: number, type: string, quantity: number, reference: string, note = "") =>
    recordStockMovement(db, tenantId, {
      productId, type, quantity, reference, note,
      deviceId: source.deviceId ?? null,
      userId: source.userId ?? null,
      userName: cashier ?? null,
    })

  switch (entity) {
    case "product": {
      // Identity model (POS-SYNC-IDENTITY-1): products are matched ACROSS
      // databases by the stable `syncId`, NEVER by the numeric `id` (which is
      // each database's own local PK and legitimately differs hub vs cloud).
      // Match order everywhere: syncId → numeric id (legacy/aligned rows) →
      // barcode (legacy fallback). The incoming numeric id is never written
      // as an identity key (it would rewrite a local PK).
      if (action === "update") {
        // Partial patches (archive/restore send {id?, syncId?, archived}).
        const items = Array.isArray(payload) ? payload : [payload]
        for (const item of items) {
          const { id, syncId, tenantId: _t, ...patch } = { ...item } as Record<string, unknown>
          if (syncId) {
            const r = await db.product.updateMany({ where: { tenantId, syncId: syncId as string }, data: patch as any })
            if (r.count > 0) continue
            // syncId given but no local row yet — fall through to legacy match
          }
          if (id !== undefined) {
            await db.product.updateMany({ where: { tenantId, id: id as number }, data: patch as any })
          } else if (patch.barcode) {
            await db.product.updateMany({ where: { tenantId, barcode: patch.barcode as string }, data: patch as any })
          }
        }
      } else if (action === "create") {
        const items = Array.isArray(payload) ? payload : [payload]
        for (const item of items) {
          // The client's numeric id is local-only and must never be forwarded
          // (an explicit id in an INSERT bypasses the sequence and collides).
          const { id: _localId, ...rest } = item as Record<string, unknown>
          let syncId = (rest.syncId as string | null | undefined) || undefined
          const barcode = (rest.barcode as string | null | undefined) || undefined

          // 1. Already known by syncId → treat as an update, never a duplicate.
          if (syncId) {
            const bySync = await db.product.findFirst({ where: { tenantId, syncId }, select: { id: true } })
            if (bySync) {
              const { syncId: _s, ...patch } = rest as Record<string, unknown>
              await db.product.updateMany({ where: { tenantId, syncId }, data: patch as any })
              continue
            }
          }

          // 2. Barcode collision rule: a product with this barcode already
          //    exists → it's the SAME logical product. Adopt that row (do not
          //    create a duplicate). Keep its existing syncId if it has one;
          //    otherwise assign the incoming/generated one.
          if (barcode) {
            const byBarcode = await db.product.findFirst({ where: { tenantId, barcode }, select: { id: true, syncId: true } })
            if (byBarcode) {
              const finalSyncId = byBarcode.syncId ?? syncId ?? (IS_CLOUD ? randomUUID() : undefined)
              const { id: _i, syncId: _s, ...patch } = rest as Record<string, unknown>
              await db.product.update({
                where: { id: byBarcode.id },
                data: { ...patch, ...(finalSyncId ? { syncId: finalSyncId } : {}) } as any,
              })
              continue
            }
          }

          // 3. Genuinely new product. On the authoritative cloud, mint a syncId
          //    if the (legacy) client didn't send one. On a hub, leave it null
          //    — the row adopts the cloud's syncId on the next pull.
          if (!syncId && IS_CLOUD) syncId = randomUUID()
          const data = { ...rest, tenantId } as Record<string, unknown>
          if (syncId) data.syncId = syncId; else delete data.syncId
          const created = await db.product.create({ data: data as any })
          // POS-SYNC-AUTHORITY-2A (record-only): opening-balance movement for a
          // new product created with non-zero initial stock, so the ledger's
          // sum matches Product.stock from t0. Idempotent by opening:<id>.
          const openStock = Number((created as any)?.stock ?? 0)
          if (openStock !== 0) {
            await recordStockMovementOnce(db, tenantId, {
              productId: (created as any).id,
              type: "Opening",
              quantity: openStock,
              reference: `opening:${(created as any).syncId ?? (created as any).id}`,
              note: "Opening stock (product created)",
              deviceId: source.deviceId ?? null,
              userId: source.userId ?? null,
              userName: cashier ?? null,
            })
          }
        }
      } else if (action === "delete") {
        // Silently convert product.delete to archive — preserve history
        const syncId = (payload as any)?.syncId as string | undefined
        const payloadId = (payload as any)?.id
        const payloadBarcode = (payload as any)?.barcode
        let done = false
        if (syncId) {
          const r = await db.product.updateMany({ where: { tenantId, syncId }, data: { archived: true } as any })
          done = r.count > 0
        }
        if (!done && payloadId) {
          await db.product.updateMany({ where: { tenantId, id: payloadId as number }, data: { archived: true } as any })
        } else if (!done && payloadBarcode) {
          await db.product.updateMany({ where: { tenantId, barcode: payloadBarcode as string }, data: { archived: true } as any })
        }
        // Never cascade delete — inventory batches, stock movements, and count lines remain intact
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
        const touchedBatchIds = new Set<string>()
        const rawItems = data.items ?? []
        for (let i = 0; i < rawItems.length; i++) {
          const item = rawItems[i]
          const resolvedProductId = prismaItems[i]?.productId
          for (const allocation of item.batchAllocations ?? []) {
            const quantity = Number(allocation.quantity ?? 0)
            if (quantity <= 0) continue

            if (!allocation.batchId || allocation.batchId === "legacy-stock") {
              // The client's local batch cache didn't think any real batch
              // covered this quantity. Trusting that blindly is how stock
              // silently diverged from batch tracking in the past: the
              // aggregate decrement above always runs regardless, but a
              // skipped "legacy-stock" allocation never touches a real
              // batch — so if the client's cache was simply stale (not
              // genuinely out of batch-tracked stock), the two numbers
              // permanently drift apart. The server has authoritative batch
              // data, so it gets a real chance here to consume from actual
              // open batches (FEFO) before conceding the shortfall is truly
              // untracked/legacy stock.
              let remaining = quantity
              if (resolvedProductId) {
                const openBatches = await db.inventoryBatch.findMany({
                  where: { tenantId, productId: resolvedProductId, status: "Open", quantityRemaining: { gt: 0 } },
                  orderBy: [{ expiryDate: "asc" }, { receivedAt: "asc" }],
                  select: { id: true, quantityRemaining: true },
                })
                for (const batch of openBatches) {
                  if (remaining <= 0) break
                  const take = Math.min(remaining, Number(batch.quantityRemaining))
                  if (take <= 0) continue
                  const result = await db.inventoryBatch.updateMany({
                    where: { id: batch.id, tenantId, quantityRemaining: { gte: take } },
                    data: { quantityRemaining: { decrement: take } },
                  })
                  if (result.count > 0) {
                    remaining -= take
                    touchedBatchIds.add(batch.id)
                  }
                }
              }
              // Whatever's left (remaining > 0) is genuinely untracked
              // legacy stock — no real batch exists to decrement, matching
              // the prior behavior for that portion.
              continue
            }

            const result = await db.inventoryBatch.updateMany({
              where: { id: allocation.batchId, tenantId, quantityRemaining: { gte: quantity } },
              data: { quantityRemaining: { decrement: quantity } },
            })
            if (result.count === 0) {
              throw new Error(`Insufficient stock in batch ${allocation.batchId}`)
            }
            touchedBatchIds.add(allocation.batchId)
          }
        }
        // Update status for any batches that were exhausted (both
        // client-specified and server-side FEFO-fallback-consumed ones)
        for (const batchId of touchedBatchIds) {
          await db.inventoryBatch.updateMany({
            where: { id: batchId, tenantId, quantityRemaining: { lte: 0 } },
            data: { status: "Consumed" },
          })
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

        // Idempotency guard: if refund already exists, skip stock changes
        const existing = await db.saleRefund.findUnique({
          where: { id: data.id as string },
          select: { id: true },
        })
        if (existing) break

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
        // Restore product stock + batch quantities for refunded items
        for (const item of prismaItems) {
          const originalItem = (data.items ?? []).find((i: any) => i.barcode === item.barcode)
          await db.product.updateMany({
            where: { tenantId, id: item.productId },
            data: { stock: { increment: item.quantity }, updatedAt: new Date() },
          })
          await recordMovement(item.productId, "Refund", item.quantity, data.id as string)
          // Restore batch quantities from original sale allocations if available
          if (originalItem?.batchAllocations && Array.isArray(originalItem.batchAllocations)) {
            for (const alloc of originalItem.batchAllocations) {
              if (alloc.batchId && alloc.batchId !== "legacy-stock") {
                await db.inventoryBatch.updateMany({
                  where: { id: alloc.batchId, tenantId },
                  data: { quantityRemaining: { increment: alloc.quantity }, status: "Open" } as any,
                })
              }
            }
          } else {
            // Fallback: restore to newest open batch for this product
            const newestBatch = await db.inventoryBatch.findFirst({
              where: { tenantId, productId: item.productId },
              orderBy: { receivedAt: "desc" },
            })
            if (newestBatch) {
              await db.inventoryBatch.updateMany({
                where: { id: newestBatch.id, tenantId },
                data: { quantityRemaining: { increment: item.quantity }, status: "Open" } as any,
              })
            }
            console.log(`[sync] Refund ${data.id}: no batchAllocations — restored ${item.quantity} to newest batch ${newestBatch?.id ?? "N/A"} for product ${item.productId}`)
          }
        }
      }
      break
    }
    case "customer": {
      if (action === "create") {
        await db.customer.upsert({
          where: { id: payload?.id as string },
          create: { ...payload, tenantId } as any,
          update: { ...payload } as any,
        })
      } else if (action === "update") {
        // Partial patches (e.g. archiveCustomer/restoreCustomer send only
        // {id, archived}) can't go through upsert — Prisma validates the
        // create AND update shapes up front even though only update runs,
        // so a partial payload always threw "Argument name is missing".
        // Same defect class already fixed for "product"; found here via a
        // live round-trip check against production during the 1.0.20
        // rollout, not caught by the earlier sync-stress harness because
        // its customer/supplier tests didn't happen to exercise archive.
        const { id, ...patch } = (payload ?? {}) as Record<string, unknown>
        if (id !== undefined) {
          await db.customer.updateMany({ where: { tenantId, id: id as string }, data: patch as any })
        }
      } else if (action === "delete") {
        await db.customer.deleteMany({ where: { tenantId, id: payload?.id as string } })
      }
      break
    }
    case "supplier": {
      if (action === "create") {
        await db.supplier.upsert({
          where: { id: payload?.id as string },
          create: { ...payload, tenantId } as any,
          update: { ...payload } as any,
        })
      } else if (action === "update") {
        const { id, ...patch } = (payload ?? {}) as Record<string, unknown>
        if (id !== undefined) {
          await db.supplier.updateMany({ where: { tenantId, id: id as string }, data: patch as any })
        }
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
            const pinMatches = u.pin.startsWith("$2")
              ? bcrypt.compareSync(rawPin, u.pin)
              : u.pin === rawPin
            if (pinMatches) {
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
          // Resolve the local numeric productId via the shared resolver
          // (productSyncId → numeric id → barcode). productSyncId is a
          // cross-system hint only — it is NOT an InventoryBatch column, so it
          // must be stripped from the persisted row.
          const productId = await resolveProductId(item)
          const { id: batchId, productSyncId: _ps, ...batchData } = { ...item, productId } as Record<string, unknown>
          await db.inventoryBatch.upsert({
            where: { id: batchId as string },
            update: batchData as any,
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
        const adj = payload as any
        // Resolve the local numeric productId (productSyncId → id → barcode),
        // and strip productSyncId — it is a cross-system hint, not a column.
        const resolvedPid = await resolveProductId(adj)
        const { productSyncId: _ps, ...adjData } = adj as Record<string, unknown>
        const persisted = { ...adjData, ...(resolvedPid > 0 ? { productId: resolvedPid } : {}) }
        await db.stockAdjustment.upsert({
          where: { id: payload?.id as string },
          update: persisted as any,
          create: { ...persisted, tenantId } as any,
        })
        await recordMovement(resolvedPid || Number(adj.productId ?? adj.id), "Adjustment", Number(adj.quantityChange ?? 0), adj.id as string, adj.reason ?? "")
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
        const raw = Array.isArray(payload) ? payload[0] ?? {} : payload ?? {}
        // registerName is per-device (which register this terminal identifies
        // as), not a tenant-wide setting — AppSettings has no column for it,
        // and syncing it would let one device's register name stomp on the
        // shared settings row. registerId is already stripped globally above.
        const { registerName: _rn, ...data } = raw as Record<string, unknown>
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
    case "cash-movement": {
      if (action === "create") {
        await db.cashMovement.upsert({
          where: { id: payload?.id as string },
          update: { ...payload } as any,
          create: { ...payload, tenantId } as any,
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
    "cash-movement": ["create"],
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

/**
 * Builds a friendly, human-readable description of a successful sync
 * operation for the live cross-device activity feed. Returns null for
 * entities/actions that aren't interesting to surface (e.g. settings,
 * staff PIN changes) — the feed should only show genuinely notable
 * store activity, not every internal sync detail.
 */
function buildActivitySummary(entity: string, action: string, payload: unknown): string | null {
  const p = (payload ?? {}) as Record<string, unknown>

  if (entity === "sale" && action === "create") {
    const cashier = typeof p.cashier === "string" && p.cashier ? p.cashier : "Someone"
    const items = Array.isArray(p.items) ? p.items : []
    const itemDesc = items.length === 1
      ? `${(items[0] as any).quantity ?? ""}x ${(items[0] as any).name ?? "item"}`.trim()
      : `${items.length} item${items.length === 1 ? "" : "s"}`
    return `${cashier} sold ${itemDesc || "an item"}`
  }
  if (entity === "sale" && action === "void") {
    const saleNumber = typeof p.saleNumber === "string" ? p.saleNumber : undefined
    return `A sale was voided${saleNumber ? ` (${saleNumber})` : ""}`
  }
  if (entity === "refund" && action === "create") {
    const customerName = typeof p.customerName === "string" && p.customerName ? ` for ${p.customerName}` : ""
    return `A refund was processed${customerName}`
  }
  if (entity === "product" && action === "create") {
    const name = typeof p.name === "string" ? p.name : undefined
    return name ? `"${name}" was added as a new product` : null
  }
  if (entity === "debt" && action === "payment") {
    const customerName = typeof p.customerName === "string" && p.customerName ? ` from ${p.customerName}` : ""
    return `A debt payment was recorded${customerName}`
  }
  if (entity === "inventory" && action === "receive") {
    const batchNumber = typeof p.batchNumber === "string" ? p.batchNumber : undefined
    return `Stock was received${batchNumber ? ` (batch ${batchNumber})` : ""}`
  }

  return null
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
