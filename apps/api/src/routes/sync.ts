import { Router } from "express"
import type { ServerResponse } from "node:http"
import bcrypt from "bcryptjs"
import { randomUUID } from "node:crypto"
import { z } from "zod"
import prisma from "../lib/prisma.js"

/** True only on the authoritative cloud instance (Railway), false on hubs. */
const IS_CLOUD = !["true", "1"].includes(process.env.IS_LOCAL_SERVER || "")

import { decrementProductStock } from "../lib/inventory.js"
import { recordStockMovement, recordStockMovementOnce, UNALLOCATED_RETURN_NOTE } from "../lib/ledger.js"
import { effectivePermissions, recordedActorRule, requiredPermissionForOp, shiftOpAllowed } from "../lib/permissions.js"
import { json, requireAuth, type AuthRequest } from "../middleware/auth.js"
import { requireCloudOrJwtAuth } from "../middleware/cloudAuth.js"
import { broadcastToTenant } from "../ws/index.js"
import {
  buildRefundableLines, planRefund, planVoidRestoration, assertRefundAmount, resolveRefundRate,
  legacyLineKey, isLegacyLineKey, normalizeAllocations, roundQty, RefundRuleError,
  type AllocationSlice, type PriorRefundLine,
} from "../lib/refundAllocation.js"

/** A persisted RefundItem as a prior-refund line (pre-migration rows → legacy pool). */
function toPriorRefundLine(it: any): PriorRefundLine {
  const key = typeof it?.saleLineId === "string" && it.saleLineId ? it.saleLineId : legacyLineKey(Number(it?.productId))
  return {
    key,
    quantity: Number(it?.quantity) || 0,
    allocations: isLegacyLineKey(key) ? null : normalizeAllocations(it?.batchAllocations),
  }
}

/**
 * REFUND-INTEGRITY-1 compatibility gate. Hubs older than this release re-insert
 * pulled sale/refund rows verbatim, so unknown columns would make every new sale
 * fail to import ("Unknown argument lineId"). Only clients that declare sync
 * schema >= 2 receive the new fields.
 */
export const SYNC_SCHEMA_HEADER = "x-titan-sync-schema"
function clientSyncSchema(req: { headers?: Record<string, unknown> }): number {
  const value = Number(req.headers?.[SYNC_SCHEMA_HEADER])
  return Number.isFinite(value) ? value : 1
}
export function shapeSalesForSchema(rows: any[], schema: number): any[] {
  if (schema >= 2) return rows
  return rows.map(({ refundVersion: _v, ...sale }: any) => ({
    ...sale,
    ...(Array.isArray(sale.items) ? { items: sale.items.map(({ lineId: _l, lineIndex: _i, batchAllocations: _b, ...item }: any) => item) } : {}),
  }))
}
export function shapeRefundsForSchema(rows: any[], schema: number): any[] {
  if (schema >= 2) return rows
  return rows.map(({ exchangeRate: _r, rateSource: _s, ...refund }: any) => ({
    ...refund,
    ...(Array.isArray(refund.items) ? { items: refund.items.map(({ saleLineId: _l, batchAllocations: _b, ...item }: any) => item) } : {}),
  }))
}

/** DebtSale.saleId (document-reference fix) reaches only schema-2 clients; old hubs re-insert pulled rows verbatim. */
export function shapeDebtSalesForSchema(rows: any[], schema: number): any[] {
  if (schema >= 2) return rows
  return rows.map(({ saleId: _s, ...debt }: any) => debt)
}

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

  // ── Permission enforcement (POS-PERMISSIONS-1 phase 3) ──────────────
  // Load the acting staff user's effective permissions once. When there is no
  // matching staff row (cloud-bridge / system relays), enforcement is skipped —
  // those ops were already authorized on the originating device. Role fallback
  // (via effectivePermissions) keeps pre-1.0.44 clients and empty columns working.
  let actorPermissions: string[] | null = null
  try {
    const actor = await prisma.staffUser.findUnique({
      where: { id: req.auth!.userId },
      select: { role: true, permissions: true },
    })
    if (actor) actorPermissions = effectivePermissions(actor.permissions, actor.role)
  } catch { actorPermissions = null }

  // Returns a refusal message, or null when the op may run. Two checks:
  //  1. the pushing account (actorPermissions, when it is a staff user);
  //  2. the staff user the record names as acting (closedById, recordedById…).
  //     The sync token is the store/device account, not the cashier's PIN
  //     session, so this id is CLIENT-ASSERTED and unauthenticated: it catches
  //     an honest client recording a disallowed action, not a modified client
  //     (docs/PERMISSIONS-ENFORCEMENT.md). An acting user the server cannot
  //     find fails closed ("error", retried later, e.g. once that staff record
  //     has synced).
  const permsOf = new Map<string, string[] | null>()
  async function staffPermissions(userId: string) {
    if (!permsOf.has(userId)) {
      const u = await prisma.staffUser.findFirst({ where: { id: userId, tenantId }, select: { role: true, permissions: true } })
      permsOf.set(userId, u ? effectivePermissions(u.permissions, u.role) : null)
    }
    return permsOf.get(userId)!
  }
  async function shiftOpener(payload: any) {
    const existing = payload?.id ? await prisma.shift.findFirst({ where: { id: String(payload.id), tenantId }, select: { openedById: true } }) : null
    return existing?.openedById ?? (typeof payload?.openedById === "string" ? payload.openedById : null)
  }
  async function authorizeOp(op: { entity: string; action: string; payload?: unknown }): Promise<string | null> {
    if (actorPermissions) {
      const required = requiredPermissionForOp(op.entity, op.action, op.payload)
      if (required && !actorPermissions.includes(required)) return `You don't have permission to ${op.action} ${op.entity}`
      if (op.entity === "shift" && !shiftOpAllowed(op.action, actorPermissions, req.auth!.userId, op.action === "close" ? await shiftOpener(op.payload) : null)) {
        return op.action === "close" ? "Only the person who opened this shift or a manager can close it" : "Opening a shift needs the Checkout or Shifts permission"
      }
    }
    const rule = recordedActorRule(op.entity, op.action, op.payload)
    if (rule) {
      const perms = await staffPermissions(rule.userId)
      if (!perms) return "The staff member recorded on this operation is not known to the server yet"
      if (rule.kind === "shift-open" && !shiftOpAllowed("open", perms, rule.userId, null)) return "The recorded staff member cannot open a shift"
      if (rule.kind === "shift-close" && !shiftOpAllowed("close", perms, rule.userId, await shiftOpener(op.payload))) {
        return "Only the person who opened this shift or a manager can close it"
      }
      if (rule.kind === "permission" && rule.permission && !perms.includes(rule.permission)) return `The recorded staff member lacks ${rule.permission}`
    }
    return null
  }

  const results: Array<{ id: string; status: "ok" | "error" | "rejected"; error?: string }> = []
  const activities: Array<{ entity: string; action: string; summary: string }> = []

  // SYNC-DEDUPE-2: "applied on this server" (appliedAt) is separate from onward delivery to the
  // cloud (status: Pending = still to forward, Synced = forwarded). Each operation is claimed
  // inside the same transaction that applies it: the claim row is inserted (ON CONFLICT DO
  // NOTHING) and locked (FOR UPDATE), so concurrent duplicates wait for each other and the
  // effects are applied once; the transaction that applies them also records appliedAt, so the
  // effects and "applied" commit together or not at all. A duplicate of an applied operation is
  // acknowledged without re-running it, and never touches its forwarding state.
  for (const op of operations) {
    try {
      validateSyncOperation(op)

      // Already applied here (a lost response, a client retry, a hub re-forward): acknowledge.
      const applied = await prisma.syncOperation.findFirst({ where: { id: op.id, tenantId, appliedAt: { not: null } }, select: { entity: true, action: true, payload: true } })
      if (applied) {
        // Only the same operation is acknowledged: an id reused for something else is refused.
        if (!sameOperation(applied, op)) throw new OperationIdReuseError(op.id)
        results.push({ id: op.id, status: "ok" })
        continue
      }

      // POS-PERMISSIONS-1: server-enforce the money/admin-sensitive subset so a
      // tampered client can't bypass in-app limits. Only fires for a real staff
      // actor (actorPermissions != null) and only for mapped ops; everything
      // else passes through unchanged.
      const denial = await authorizeOp(op)
      if (denial) {
        try {
          await prisma.auditEvent.create({
            data: {
              tenantId, action: "security.permission.denied", entity: op.entity,
              summary: `Blocked ${op.action} ${op.entity}: ${denial}`,
              metadata: { reason: denial, userId: req.auth!.userId },
              userId: req.auth!.userId, userName: "", userRole: req.auth!.role as any,
            },
          })
        } catch { /* best-effort audit */ }
        results.push({ id: op.id, status: "error", error: denial })
        continue
      }

      await syncTestHooks.beforeClaim?.(op.id)
      const outcome = await prisma.$transaction(async (tx) => {
        const summary = `${op.action} ${op.entity}`
        const payloadJson = JSON.stringify(op.payload ?? {})
        // Claim: a concurrent duplicate blocks here until this transaction commits or rolls back.
        await (tx as typeof prisma).$executeRaw`
          INSERT INTO "SyncOperation" ("id", "tenantId", "entity", "action", "summary", "payload", "status", "attempts", "createdAt")
          VALUES (${op.id}, ${tenantId}, ${op.entity}, ${op.action}, ${summary}, ${payloadJson}::jsonb, 'Processing', 0, now())
          ON CONFLICT ("id") DO NOTHING`
        const [claim] = await (tx as typeof prisma).$queryRaw<Array<{ tenantId: string; appliedAt: Date | null; entity: string; action: string; payload: unknown; status: string }>>`
          SELECT "tenantId", "appliedAt", "entity", "action", "payload", "status" FROM "SyncOperation" WHERE "id" = ${op.id} FOR UPDATE`
        if (!claim || claim.tenantId !== tenantId) throw new TenantScopeError(`sync operation ${op.id} belongs to another store`)
        // An existing row (applied, or an earlier failed attempt) must be this same operation; our
        // own claim row ('Processing', inserted above) always is.
        // A checkout attempt the till cancelled can never commit afterwards.
        if (claim.status === "Cancelled") throw new CheckoutCancelledError(op.id)
        if (claim.status !== "Processing" && !sameOperation(claim, op)) throw new OperationIdReuseError(op.id)
        await syncTestHooks.afterClaim?.(op.id)
        if (claim.appliedAt) return "duplicate" as const

        await processOperation(tenantId, op.entity, op.action, op.payload as any, tx as typeof prisma, { deviceId: deviceId ?? null, userId: req.auth!.userId })

        // Applied (same transaction) and queued for onward delivery: the cloud sync bridge
        // forwards status Pending and marks it Synced once the cloud acknowledges it.
        await (tx as any).syncOperation.update({
          where: { id: op.id },
          data: {
            entity: op.entity,
            action: op.action,
            summary,
            payload: (op.payload ?? {}) as any,
            appliedAt: new Date(),
            status: "Pending",
            syncedAt: null,
            lastAttemptAt: new Date(),
            error: null,
          },
        })
        return "applied" as const
      })

      results.push({ id: op.id, status: "ok" })
      if (outcome === "applied") {
        const summary = buildActivitySummary(op.entity, op.action, op.payload)
        if (summary) activities.push({ entity: op.entity, action: op.action, summary })
      }
    } catch (err) {
      const errorMessage = (err as Error).message

      // Classify rejection errors — these are non-retryable business conflicts
      const isRejected =
        // REFUND-INTEGRITY-1: refund/void rule violations are business
        // conflicts with a stable code prefix (e.g. "REFUND_EXCEEDS_REFUNDABLE: …").
        err instanceof RefundRuleError ||
        err instanceof TenantScopeError ||
        err instanceof OperationIdReuseError ||
        err instanceof CheckoutCancelledError ||
        errorMessage.includes("Insufficient stock") ||
        errorMessage.includes("was voided") ||
        errorMessage.includes("Insufficient stock in batch") ||
        errorMessage.includes("PIN is already in use by")
      const opStatus = isRejected ? "Rejected" : "Failed"

      // Record the failure — but never on a row that was applied (it would stop its onward
      // delivery and misreport an applied operation as rejected), nor on another store's row.
      try {
        const row = await prisma.syncOperation.findUnique({ where: { id: op.id }, select: { tenantId: true, appliedAt: true } })
        if (!row) {
          await prisma.syncOperation.create({
            data: {
              id: op.id, tenantId, entity: op.entity, action: op.action, summary: `${op.action} ${op.entity}`,
              payload: (op.payload ?? {}) as any, status: opStatus, attempts: isRejected ? 5 : 1, lastAttemptAt: new Date(), error: errorMessage,
            },
          })
        } else if (row.tenantId === tenantId && !row.appliedAt && !(err instanceof OperationIdReuseError) && !(err instanceof CheckoutCancelledError)) {
          await prisma.syncOperation.updateMany({
            where: { id: op.id, tenantId, appliedAt: null },
            data: { status: opStatus, attempts: isRejected ? 5 : { increment: 1 }, lastAttemptAt: new Date(), error: errorMessage },
          })
        }
      } catch (syncLogError) {
        console.error("Failed to record sync error:", syncLogError)
      }

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
// ─── Write-through checkout attempts (attempt id = the operation id, wt-<saleId>) ─────
// A till that lost the answer to a write-through sale must settle that attempt before charging
// a different cart. "Not found" is not an answer: the original request may still be on its way.
//   GET  .../checkout-attempt/:opId          -> committed | cancelled | open (open = unresolved)
//   POST .../checkout-attempt/:opId/cancel   -> committed | cancelled — TERMINAL. It takes the
//        same claim lock as the push: if the original request is applying it, cancel waits and
//        answers committed; otherwise it records Cancelled and the push is refused if it arrives.
const saleIdOfAttempt = (opId: string) => (opId.startsWith("wt-") ? opId.slice(3) : null)
async function attemptState(tenantId: string, opId: string) {
  const row = await prisma.syncOperation.findUnique({ where: { id: opId }, select: { tenantId: true, appliedAt: true, status: true } })
  if (row && row.tenantId !== tenantId) return { state: "foreign" as const }
  const saleId = saleIdOfAttempt(opId)
  const sale = saleId ? await prisma.sale.findFirst({ where: { id: saleId, tenantId }, select: { id: true } }) : null
  if (row?.appliedAt || sale) return { state: "committed" as const }
  if (row?.status === "Cancelled") return { state: "cancelled" as const }
  return { state: "open" as const }
}
router.get("/checkout-attempt/:opId", requireCloudOrJwtAuth, async (req: AuthRequest, res: ServerResponse) => {
  const opId = ((req as any).params?.opId as string) || ""
  if (!opId.startsWith("wt-")) { json(res, { error: "not a checkout attempt" }, 400); return }
  const r = await attemptState(req.auth!.tenantId, opId)
  if (r.state === "foreign") { json(res, { error: "not found" }, 404); return }
  json(res, r)
})
router.post("/checkout-attempt/:opId/cancel", requireCloudOrJwtAuth, async (req: AuthRequest, res: ServerResponse) => {
  const tenantId = req.auth!.tenantId
  const opId = ((req as any).params?.opId as string) || ""
  if (!opId.startsWith("wt-")) { json(res, { error: "not a checkout attempt" }, 400); return }
  try {
    const state = await prisma.$transaction(async (tx) => {
      await (tx as typeof prisma).$executeRaw`
        INSERT INTO "SyncOperation" ("id", "tenantId", "entity", "action", "summary", "payload", "status", "attempts", "createdAt")
        VALUES (${opId}, ${tenantId}, 'sale', 'create', 'checkout attempt cancelled', '{}'::jsonb, 'Cancelled', 0, now())
        ON CONFLICT ("id") DO NOTHING`
      // Waits here while the original request holds the claim (it is applying the sale).
      const [row] = await (tx as typeof prisma).$queryRaw<Array<{ tenantId: string; appliedAt: Date | null }>>`
        SELECT "tenantId", "appliedAt" FROM "SyncOperation" WHERE "id" = ${opId} FOR UPDATE`
      if (!row || row.tenantId !== tenantId) return "foreign" as const
      const saleId = saleIdOfAttempt(opId)
      const sale = saleId ? await (tx as typeof prisma).sale.findFirst({ where: { id: saleId, tenantId }, select: { id: true } }) : null
      if (row.appliedAt || sale) return "committed" as const
      await (tx as any).syncOperation.update({ where: { id: opId }, data: { status: "Cancelled", error: "Cancelled by the till", lastAttemptAt: new Date() } })
      return "cancelled" as const
    })
    if (state === "foreign") { json(res, { error: "not found" }, 404); return }
    json(res, { state })
  } catch (err) {
    json(res, { error: (err as Error).message }, 500)
  }
})

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
    products, sales: shapeSalesForSchema(sales, clientSyncSchema(req as any)), refunds: shapeRefundsForSchema(refunds, clientSyncSchema(req as any)), customers, debtSales: shapeDebtSalesForSchema(debtSales, clientSyncSchema(req as any)), debtPayments,
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
      items: entity === "sales" ? shapeSalesForSchema(items, clientSyncSchema(req as any))
        : entity === "refunds" ? shapeRefundsForSchema(items, clientSyncSchema(req as any))
        : entity === "debt-sales" ? shapeDebtSalesForSchema(items, clientSyncSchema(req as any))
        : items,
      hasMore,
      nextCursor: nextCursor ?? null,
    })
  } catch (err) {
    console.error(`Sync pull-full error:`, err)
    json(res, { error: "Failed to pull full data" }, 500)
  }
})

/** A push referenced a record id that belongs to another tenant. Never retried. */
/** Test-only pauses around the claim (real-Postgres race tests); never set in production code. */
export const syncTestHooks: { beforeClaim?: (opId: string) => Promise<void>; afterClaim?: (opId: string) => Promise<void> } = {}

/** A write-through checkout attempt the till cancelled: it can never commit afterwards. */
export class CheckoutCancelledError extends Error {
  constructor(id: string) { super(`CHECKOUT_CANCELLED: checkout attempt ${id} was cancelled by the till`); this.name = "CheckoutCancelledError" }
}

/** An operation id the server already holds for a different entity, action or payload. */
export class OperationIdReuseError extends Error {
  constructor(id: string) { super(`OPERATION_ID_REUSED: sync operation ${id} was already used for a different change`); this.name = "OperationIdReuseError" }
}

/** Key-order-independent JSON (Postgres jsonb does not keep key order). */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.keys(value as object).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(",")}}`
  }
  return JSON.stringify(value ?? null)
}
/** The stored operation and the incoming one are the same change (entity, action, payload). */
function sameOperation(stored: { entity: string; action: string; payload: unknown }, incoming: { entity: string; action: string; payload?: unknown }) {
  return stored.entity === incoming.entity && stored.action === incoming.action
    && canonicalJson(stored.payload ?? {}) === canonicalJson(JSON.parse(JSON.stringify(incoming.payload ?? {})))
}

export class TenantScopeError extends Error {
  constructor(message: string) { super(`TENANT_SCOPE: ${message}`); this.name = "TenantScopeError" }
}

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
      const product = await matchProductByBarcode(barcode)
      if (product) return product.id
    }
    return pid || 0
  }

  // POS-BARCODE-ALIAS-1: resolve a product by barcode considering BOTH the
  // primary `barcode` and `barcodeAliases`. A barcode belongs to exactly one
  // product (client + server guards keep aliases unique across products), so a
  // primary match wins; otherwise fall back to an alias match. `via` lets
  // callers avoid overwriting an owner's primary barcode on an alias match.
  const matchProductByBarcode = async (barcode: string | null | undefined) => {
    if (!barcode) return null
    const byPrimary = await db.product.findFirst({
      where: { tenantId, barcode: String(barcode) },
      select: { id: true, syncId: true },
    })
    if (byPrimary) return { ...byPrimary, via: "primary" as const }
    const byAlias = await db.product.findFirst({
      where: { tenantId, barcodeAliases: { has: String(barcode) } },
      select: { id: true, syncId: true },
    })
    if (byAlias) return { ...byAlias, via: "alias" as const }
    return null
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

  // RELEASE-BLOCKER (document references): record ids are unique across the
  // whole database, but every write here belongs to ONE tenant. Several
  // handlers upsert by id alone, so an id that already belongs to another
  // tenant would overwrite that tenant's row. Refuse it.
  const ID_MODELS: Record<string, string> = {
    sale: "sale", refund: "saleRefund", shift: "shift", expense: "expense", customer: "customer", supplier: "supplier", staff: "staffUser",
    "purchase-order": "purchaseOrder", "supplier-payment": "supplierPayment", "daily-close": "dailyClose",
    "delivery-order": "deliveryOrder", "cash-movement": "cashMovement",
  }
  const guardModel = entity === "debt" ? (action === "payment" ? "debtPayment" : "debtSale")
    : entity === "inventory" ? (action === "adjust" ? "stockAdjustment" : action === "count" ? "stockCountSession" : undefined)
    : ID_MODELS[entity]
  const guardId = (payload as any)?.id
  if (guardModel && typeof guardId === "string" && guardId) {
    const owner = await (db as any)[guardModel].findUnique({ where: { id: guardId }, select: { tenantId: true } })
    // An existing row may only be written by its own tenant. A row whose tenant
    // cannot be read is NOT treated as writable: missing ownership is a refusal.
    if (owner && owner.tenantId !== tenantId) throw new TenantScopeError(`${entity} ${guardId} belongs to another store`)
  }

  // A debt belongs to a SALE (by id), not to a sale number: numbers are display
  // references and two sales may share one. Rows from before the link existed
  // (saleId null) are matched only when they unambiguously belong to the sale:
  // same number AND same customer, and the same total if that is still not one row.
  const removeDebtOfSale = async (s: { id: string; saleNumber: string; customerId: string | null; total: unknown }) => {
    await db.debtSale.deleteMany({ where: { tenantId, saleId: s.id } as any })
    if (!s.customerId) return
    const legacy = await db.debtSale.findMany({ where: { tenantId, saleId: null, saleNumber: s.saleNumber, customerId: s.customerId } as any, select: { id: true, total: true } })
    const match = legacy.length === 1 ? legacy : legacy.filter((d) => Number(d.total) === Number(s.total))
    if (match.length === 1) await db.debtSale.deleteMany({ where: { tenantId, id: match[0].id } })
    else if (match.length > 1) console.warn(`[sync] void ${s.id}: ${match.length} unlinked debts share ${s.saleNumber}; none removed automatically`)
  }

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
          // POS-SYNC-HARDEN-2 + RECEIVE-1: a product.update NEVER changes stock.
          // `stock` is stripped from the patch unconditionally — every real stock
          // change goes through an approved stock op (sale/refund/void/receive/
          // adjustment/count/reconciliation-repair). Receiving now raises the
          // aggregate in the inventory/receive handler itself, so there is no
          // longer any trusted-marker exception here.
          // `_stockUpdate` is a now-defunct transition marker — discard it so it
          // is never persisted (and never trusted). `stock` is always stripped.
          const { id, syncId, tenantId: _t, _stockUpdate: _defunct, stock: _stock, ...patch } = { ...item } as Record<string, unknown>
          if (_stock !== undefined) {
            console.warn(`[sync] product.update: ignored a 'stock' field (server-side guard) for product ${syncId ?? id ?? patch.barcode ?? "?"} — stock only changes via approved stock operations.`)
          }
          if (syncId) {
            const r = await db.product.updateMany({ where: { tenantId, syncId: syncId as string }, data: patch as any })
            if (r.count > 0) continue
            // syncId given but no local row yet — fall through to legacy match
          }
          if (id !== undefined) {
            await db.product.updateMany({ where: { tenantId, id: id as number }, data: patch as any })
          } else if (patch.barcode) {
            // POS-BARCODE-ALIAS-1: legacy barcode-keyed update — match primary OR
            // alias. When matched via an alias, drop `barcode` from the patch so
            // the owner's primary barcode is never rewritten with the alias value.
            const match = await matchProductByBarcode(patch.barcode as string)
            if (match) {
              const data =
                match.via === "alias"
                  ? (() => {
                      const { barcode: _b, ...rest2 } = patch
                      return rest2
                    })()
                  : patch
              await db.product.updateMany({ where: { tenantId, id: match.id }, data: data as any })
            }
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
            const match = await matchProductByBarcode(barcode)
            if (match?.via === "primary") {
              const finalSyncId = match.syncId ?? syncId ?? (IS_CLOUD ? randomUUID() : undefined)
              const { id: _i, syncId: _s, ...patch } = rest as Record<string, unknown>
              await db.product.update({
                where: { id: match.id },
                data: { ...patch, ...(finalSyncId ? { syncId: finalSyncId } : {}) } as any,
              })
              continue
            }
            if (match?.via === "alias") {
              // POS-BARCODE-ALIAS-1: the barcode is already an ALIAS of another
              // product → it is the same logical product. Skip creating a
              // duplicate; do NOT overwrite the owner (its primary barcode differs).
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
          // REFUND-INTEGRITY-1: take the same per-sale lock as refunds FIRST,
          // then read the sale, so a concurrent void or refund that committed
          // while we waited is visible (no double void, no void over a refund).
          await db.sale.updateMany({ where: { id, tenantId }, data: { refundVersion: { increment: 1 } } as any })
          const sale = await db.sale.findFirst({
            where: { id, tenantId, status: { not: "Voided" } },
            include: { items: true },
          })

          // Refuse to void a sale that already has refunds (the void would
          // restore the refunded quantity a second time); restore recorded lots.
          let planned: ReturnType<typeof planVoidRestoration> = []
          if (sale) {
            const priorRefunds = await db.saleRefund.findMany({
              where: { tenantId, saleId: sale.id },
              include: { items: true },
            })
            const lines = buildRefundableLines(sale.items.map((it: any) => ({
              lineId: it.lineId, productId: it.productId, quantity: Number(it.quantity), allocations: it.batchAllocations,
            })))
            planned = planVoidRestoration(lines, priorRefunds.flatMap((r: any) => (r.items ?? []).map((it: any) => toPriorRefundLine(it))))
          }

          await db.sale.updateMany({
            where: { id, tenantId },
            data: { status: "Voided" },
          })

          for (const p of planned) {
            await db.product.updateMany({
              where: { tenantId, id: p.productId },
              data: { stock: { increment: p.quantity }, updatedAt: new Date() },
            })
            // Record the void as a Refund movement (stock comes back)
            await recordMovement(p.productId, "Refund", p.quantity, `void:${id}`, `Void sale ${saleNumber ?? id}`)
            for (const slice of p.allocations ?? []) {
              if (!slice.batchId) continue
              await db.inventoryBatch.updateMany({
                where: { id: slice.batchId, tenantId },
                data: { quantityRemaining: { increment: slice.quantity }, status: "Open" } as any,
              })
            }
          }

          // Clean up tender record to prevent stale tender data in reports
          await db.saleTender.deleteMany({ where: { saleId: id } })

          // If this was a debt sale, remove ITS DebtSale (never every debt that
          // happens to share the display number; never for a sale this tenant
          // does not have).
          const voided = sale ?? await db.sale.findFirst({ where: { id, tenantId }, select: { id: true, saleNumber: true, customerId: true, total: true } })
          if (voided) await removeDebtOfSale(voided as any)
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

        // Decrement product stock
        await decrementProductStock(db, tenantId, prismaItems.map((i: any) => ({ productId: i.productId, productName: i.productName, quantity: i.quantity })))
        // Atomic batch decrement — updateMany with quantityRemaining >= quantity is atomic.
        // REFUND-INTEGRITY-1: record the lots ACTUALLY consumed per line (including
        // FEFO-fallback lots the client never knew about, and any untracked
        // remainder as batchId null) so refunds and voids restore from the
        // server's own record instead of trusting client-supplied allocations.
        const touchedBatchIds = new Set<string>()
        const rawItems = data.items ?? []
        const appliedByLine: AllocationSlice[][] = rawItems.map(() => [])
        for (let i = 0; i < rawItems.length; i++) {
          const item = rawItems[i]
          const resolvedProductId = prismaItems[i]?.productId
          const applied = appliedByLine[i]
          for (const allocation of item.batchAllocations ?? []) {
            const quantity = Number(allocation.quantity ?? 0)
            if (quantity <= 0) continue
            const sliceCost = Number.isFinite(Number(allocation.unitCost)) ? Number(allocation.unitCost) : undefined

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
                  select: { id: true, quantityRemaining: true, unitCost: true },
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
                    applied.push({ batchId: batch.id, quantity: roundQty(take), unitCost: Number(batch.unitCost ?? 0) })
                  }
                }
              }
              // Whatever's left (remaining > 0) is genuinely untracked
              // legacy stock — no real batch exists to decrement, matching
              // the prior behavior for that portion.
              if (remaining > 0) {
                applied.push({ batchId: null, quantity: roundQty(remaining), ...(sliceCost !== undefined ? { unitCost: sliceCost } : {}) })
              }
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
            applied.push({ batchId: allocation.batchId, quantity: roundQty(quantity), ...(sliceCost !== undefined ? { unitCost: sliceCost } : {}) })
          }
        }

        // Persist the sale with line identity + applied allocations. A lineId is
        // only stored when the client stamped one (and only once per sale);
        // lines without one remain legacy lines (pooled per product on refund).
        const seenLineIds = new Set<string>()
        const itemsToCreate = prismaItems.map((it: any, i: number) => {
          const rawLineId = rawItems[i]?.lineId
          const lineId = typeof rawLineId === "string" && rawLineId && !seenLineIds.has(rawLineId) ? rawLineId : null
          if (lineId) seenLineIds.add(lineId)
          return { ...it, lineId, lineIndex: i, batchAllocations: appliedByLine[i] }
        })
        await db.sale.create({
          data: {
            ...saleData,
            tenantId,
            items: { create: itemsToCreate },
            tender: hasTender ? { create: prismaTender } : undefined,
          } as any,
        })
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
        // REFUND-INTEGRITY-1 — the server decides what a refund restores:
        // quantities are checked against the persisted sale minus every prior
        // refund, lots come from the sale's recorded allocations (client
        // allocations are ignored), and the rate is the ORIGINAL sale's rate.
        const data = payload as any
        const refundId = typeof data?.id === "string" ? data.id : ""
        const saleId = typeof data?.saleId === "string" ? data.saleId : ""
        if (!refundId || !saleId) throw new Error("Refund sync requires an id and saleId")

        // Idempotency: a retried refund never re-applies stock, lots, or money.
        const existing = await db.saleRefund.findUnique({ where: { id: refundId }, select: { id: true } })
        if (existing) break

        // Serialize concurrent refunds/voids of this sale BEFORE reading it: the
        // row lock taken by this update is held until commit, and every read
        // below is a new statement (READ COMMITTED), so it sees whatever a
        // transaction we waited on committed — a void, or an earlier refund.
        // Reading first and locking second let a refund proceed against a
        // sale that had just been voided.
        const locked = await db.sale.updateMany({
          where: { id: saleId, tenantId },
          data: { refundVersion: { increment: 1 } } as any,
        })
        // Retryable (not rejected): the sale may still be on its way.
        if (locked.count === 0) throw new Error(`Refund ${refundId}: sale ${saleId} not found yet`)
        const sale = await db.sale.findFirst({
          where: { id: saleId, tenantId },
          include: { items: true, tender: true },
        })
        if (!sale) throw new Error(`Refund ${refundId}: sale ${saleId} not found yet`)
        if (sale.status === "Voided") {
          throw new RefundRuleError("REFUND_SALE_VOIDED", `Sale ${sale.saleNumber} was already voided`)
        }
        const priorRefunds = await db.saleRefund.findMany({
          where: { tenantId, saleId: sale.id },
          include: { items: true },
        })

        const lines = buildRefundableLines(sale.items.map((it: any) => ({
          lineId: it.lineId, productId: it.productId, quantity: Number(it.quantity), allocations: it.batchAllocations,
        })))
        const prior = priorRefunds.flatMap((r: any) => (r.items ?? []).map((it: any) => toPriorRefundLine(it)))
        const request = await Promise.all((data.items ?? []).map(async (item: any) => ({
          key: typeof item?.saleLineId === "string" ? item.saleLineId : null,
          productId: await resolveProductId(item),
          quantity: Number(item?.quantity),
        })))
        const planned = planRefund(lines, prior, request)
        const total = Number(data.total)
        assertRefundAmount(Number(sale.total), priorRefunds.map((r: any) => Number(r.total)), total)
        const rate = resolveRefundRate(sale.tender?.exchangeRate ?? null)

        const saleItemFor = (key: string) =>
          sale.items.find((it: any) => it.lineId === key) ??
          sale.items.find((it: any) => !it.lineId && legacyLineKey(it.productId) === key)
        const methodMap: Record<string, string> = { "Debt Credit": "Debt_Credit", "Refund Credit": "Debt_Credit" }

        await db.saleRefund.create({
          data: {
            id: refundId,
            tenantId,
            refundNumber: String(data.refundNumber ?? refundId),
            saleId: sale.id,
            saleNumber: sale.saleNumber,
            customerId: data.customerId ?? sale.customerId ?? null,
            customerName: data.customerName ?? sale.customerName ?? null,
            method: methodMap[data.method as string] ?? data.method,
            reason: String(data.reason ?? "Customer return"),
            total,
            cashier: String(data.cashier ?? ""),
            cashierId: data.cashierId ?? null,
            shiftId: data.shiftId ?? null,
            shiftNumber: data.shiftNumber ?? null,
            exchangeRate: rate.exchangeRate,
            rateSource: rate.rateSource,
            ...(data.createdAt ? { createdAt: data.createdAt } : {}),
            items: {
              create: planned.map((p) => {
                const si: any = saleItemFor(p.key)
                return {
                  productId: p.productId,
                  productName: si?.productName ?? "",
                  barcode: si?.barcode ?? "",
                  quantity: p.quantity,
                  unitPrice: si?.unitPrice ?? 0,
                  cost: si?.cost ?? 0,
                  total: Number(si?.unitPrice ?? 0) * p.quantity,
                  saleLineId: p.key,
                  ...(p.allocations ? { batchAllocations: p.allocations } : {}),
                }
              }),
            },
          } as any,
        })

        for (const p of planned) {
          await db.product.updateMany({
            where: { tenantId, id: p.productId },
            data: { stock: { increment: p.quantity }, updatedAt: new Date() },
          })
          // Legacy lines and untracked slices restore product stock only — no
          // lot is guessed. That stock is tagged so the reconciliation report
          // shows it as an explained exception ("unallocated return") instead
          // of an unexplained stock-vs-lots mismatch.
          const unallocated = p.allocations === null
            ? p.quantity
            : roundQty(p.allocations.filter((s) => !s.batchId).reduce((sum, s) => sum + s.quantity, 0))
          const allocated = roundQty(p.quantity - unallocated)
          if (allocated > 0) await recordMovement(p.productId, "Refund", allocated, refundId)
          if (unallocated > 0) await recordMovement(p.productId, "Refund", unallocated, refundId, `${UNALLOCATED_RETURN_NOTE} ${sale.saleNumber}`)
          for (const slice of p.allocations ?? []) {
            if (!slice.batchId) continue
            await db.inventoryBatch.updateMany({
              where: { id: slice.batchId, tenantId },
              data: { quantityRemaining: { increment: slice.quantity }, status: "Open" } as any,
            })
          }
        }

        // The customer credit of a debt refund is part of the refund itself.
        if ((methodMap[data.method as string] ?? data.method) === "Debt_Credit" && sale.customerId && total > 0) {
          await db.debtPayment.create({
            data: {
              id: `refund-credit:${refundId}`, tenantId, customerId: sale.customerId, amount: total,
              method: "Refund Credit", reference: `${String(data.refundNumber ?? refundId)} return for ${sale.saleNumber}`,
              ...(data.createdAt ? { createdAt: data.createdAt } : {}),
            } as any,
          })
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
        // Only a supplier's own details change: never its id, tenant or history (orders and
        // payments reference it by id and keep the name they were recorded under).
        const { id } = (payload ?? {}) as Record<string, unknown>
        const data: Record<string, unknown> = {}
        for (const k of ["name", "mobile", "contact", "address", "notes"] as const) {
          if (typeof payload?.[k] === "string") data[k] = payload[k]
        }
        if (typeof payload?.archived === "boolean") data.archived = payload.archived
        if (typeof data.name === "string" && !data.name.trim()) throw new Error("Supplier name is required")
        if (id !== undefined && Object.keys(data).length > 0) {
          await db.supplier.updateMany({ where: { tenantId, id: id as string }, data: data as any })
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
        const { items: _i, ...debtData } = (payload ?? {}) as Record<string, any>
        // Link the debt to its sale. Clients do not send saleId (a hub on the
        // previous release would reject the unknown column), so resolve it:
        // the sale with this number AND customer, only if exactly one exists.
        if (debtData.saleId) {
          const own = await db.sale.findFirst({ where: { id: String(debtData.saleId), tenantId }, select: { id: true } })
          if (!own) delete debtData.saleId
        }
        if (!debtData.saleId && debtData.saleNumber && debtData.customerId) {
          const matches = await db.sale.findMany({ where: { tenantId, saleNumber: String(debtData.saleNumber), customerId: String(debtData.customerId) }, select: { id: true }, take: 2 })
          if (matches.length === 1) debtData.saleId = matches[0].id
        }
        await db.debtSale.upsert({
          where: { id: debtData.id as string },
          update: debtData,
          create: { ...debtData, tenantId } as any,
        })
      } else if (action === "payment") {
        // REFUND-REVIEW: a refund's customer credit is created by the refund
        // handler itself (same transaction), so a rejected refund can never
        // leave its credit behind. Older clients still send the credit as a
        // separate "Refund Credit" payment referencing "<R-number> return for
        // <S-number>": apply it only once its refund exists, and never twice.
        // Refund numbers are per-device references, not unique: match the
        // sale number and customer too.
        const refundRef = typeof payload?.reference === "string" ? /^(\S+) return for (\S+)/.exec(payload.reference) : null
        if (payload?.method === "Refund Credit" && refundRef) {
          const refund = await db.saleRefund.findFirst({
            where: { tenantId, refundNumber: refundRef[1], saleNumber: refundRef[2], ...(payload.customerId ? { customerId: String(payload.customerId) } : {}) },
            select: { id: true },
          })
          // Retryable: the refund may still be syncing. If it was rejected, this
          // credit is never applied (it exhausts its retries visibly instead).
          if (!refund) throw new Error(`Refund credit ${refundRef[1]} waits for its refund to be accepted`)
          const already = await db.debtPayment.findFirst({ where: { tenantId, reference: String(payload.reference) }, select: { id: true } })
          if (already) break
        }
        await db.debtPayment.upsert({
          where: { id: payload?.id as string },
          update: payload as any,
          create: { ...payload, tenantId } as any,
        })
      } else if (action === "delete") {
        const id = payload?.id as string
        const saleNumber = payload?.saleNumber as string
        // REFUND-REVIEW: voiding a debt sale also sends this delete, BEFORE the
        // void itself. The void handler removes the debt when it accepts the
        // void, so only honour the delete once the sale is actually voided —
        // a rejected void must not erase the customer's debt.
        // The gate is THIS debt's sale (by id when linked); an unlinked debt
        // only looks at sales with its number and customer, and is kept while
        // any of them is still live. A display number alone never picks "some
        // sale with that number".
        const debtRow = id ? await db.debtSale.findFirst({ where: { id, tenantId }, select: { saleId: true, saleNumber: true, customerId: true } as any }) as any : null
        const number = debtRow?.saleNumber ?? saleNumber
        const linkedSales = debtRow?.saleId
          ? await db.sale.findMany({ where: { tenantId, id: debtRow.saleId }, select: { status: true } })
          : number
            ? await db.sale.findMany({ where: { tenantId, saleNumber: number, ...(debtRow?.customerId ? { customerId: debtRow.customerId } : {}) }, select: { status: true } })
            : []
        if (linkedSales.some((s) => s.status !== "Voided")) break
        if (id) {
          await db.debtSale.deleteMany({ where: { id, tenantId } })
        } else if (saleNumber) {
          const unlinked = await db.debtSale.findMany({ where: { tenantId, saleNumber, saleId: null } as any, select: { id: true }, take: 2 })
          if (unlinked.length === 1) await db.debtSale.deleteMany({ where: { tenantId, id: unlinked[0].id } })
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
          // POS-FIRST-SETUP-CATALOG-1A: `opening` is a transient flag (not an
          // InventoryBatch column) — strip it from the persisted row and use it
          // only to tag the ledger movement as Opening vs Receive.
          const { id: batchId, productSyncId: _ps, opening: _opening, ...batchData } = { ...item, productId } as Record<string, unknown>
          const isOpening = (item as any).opening === true
          const qty = Number((item as any).quantityRemaining ?? (item as any).initialQuantity ?? 0)
          // POS-SYNC-RECEIVE-1: the receive handler is authoritative for the
          // aggregate. The batch id (client-generated, stable) is the idempotency
          // anchor: increment Product.stock + record the Receive movement ONLY on
          // first creation of the batch. A retry (batch already exists) updates
          // metadata only and never re-increments. Stock is no longer carried by
          // product.create/product.update in the receive flow.
          const existingBatch = await db.inventoryBatch.findUnique({ where: { id: batchId as string }, select: { id: true, tenantId: true } })
          // Receive carries an ARRAY of lots, so the per-operation guard above does not see these ids.
          if (existingBatch && existingBatch.tenantId !== tenantId) throw new TenantScopeError(`inventory batch ${batchId} belongs to another store`)
          if (!existingBatch) {
            await db.inventoryBatch.create({ data: { ...batchData, id: batchId, tenantId } as any })
            if (productId > 0 && qty !== 0) {
              await db.product.updateMany({ where: { tenantId, id: productId }, data: { stock: { increment: qty }, updatedAt: new Date() } as any })
            }
            await recordStockMovementOnce(db, tenantId, {
              productId, type: isOpening ? "Opening" : "Receive", quantity: qty, reference: batchId as string,
              note: isOpening ? `Opening stock ${(item as any).batchNumber ?? ""}` : `Batch ${(item as any).batchNumber ?? ""}`,
              deviceId: source.deviceId ?? null, userId: source.userId ?? null, userName: cashier ?? null,
            })
          } else {
            // Metadata correction for an already-received batch — NEVER re-increment stock, and
            // never rewrite its quantities: a resent receive (uncertain response, a retried
            // delivery) carries the quantities as received, and writing them back would undo
            // every sale, refund and adjustment applied to this lot since.
            const { quantityRemaining: _qr, initialQuantity: _iq, status: _st, productId: _pid, tenantId: _tid, ...meta } = batchData as Record<string, unknown>
            if (Object.keys(meta).length > 0) {
              await db.inventoryBatch.updateMany({ where: { id: batchId as string, tenantId }, data: meta as any })
            }
          }
        }
      } else if (action === "update") {
        // REFUND-REVIEW: clients used to push their whole lot table here as
        // ABSOLUTE quantities (after sales, refunds and voids). Applying them let
        // one device's stale copy overwrite every other device's sales. Lot
        // quantities now move only through server-authoritative handlers
        // (sale, refund, void, receive, adjust), so absolute quantities and
        // Open/Consumed statuses sent here are ignored — including from older
        // clients. The only accepted change is marking a lot Expired.
        const items = Array.isArray(payload) ? payload : [payload]
        for (const item of items) {
          if (!item?.id || item.status !== "Expired") continue
          await db.inventoryBatch.updateMany({
            where: { id: item.id as string, tenantId, status: "Open" },
            data: { status: "Expired" } as any,
          })
        }
      } else if (action === "adjust") {
        const adj = payload as any
        // Resolve the local numeric productId (productSyncId → id → barcode),
        // and strip productSyncId — it is a cross-system hint, not a column.
        const resolvedPid = await resolveProductId(adj)
        const { productSyncId: _ps, ...adjData } = adj as Record<string, unknown>
        const persisted = { ...adjData, ...(resolvedPid > 0 ? { productId: resolvedPid } : {}) }
        // REFUND-REVIEW: adjustments (counts, write-offs, corrections) used to be
        // recorded here without ever changing server stock or lots — the next
        // hub-authoritative pull then silently reverted them on every device.
        // The adjustment id is the idempotency anchor: stock, lots and the
        // ledger move only when the adjustment is first created. A concurrent
        // duplicate fails on the primary key and rolls back.
        const existingAdjustment = await db.stockAdjustment.findUnique({ where: { id: payload?.id as string }, select: { id: true } })
        if (existingAdjustment) {
          await db.stockAdjustment.update({ where: { id: payload?.id as string }, data: persisted as any })
          break
        }
        await db.stockAdjustment.create({ data: { ...persisted, tenantId } as any })
        const delta = Number(adj.quantityChange ?? 0)
        if (resolvedPid > 0 && Number.isFinite(delta) && delta !== 0) {
          await db.product.updateMany({
            where: { tenantId, id: resolvedPid },
            data: { stock: { increment: delta }, updatedAt: new Date() } as any,
          })
          // Allocations carry magnitudes; the direction is the sign of quantityChange.
          for (const slice of normalizeAllocations(adj.batchAllocations) ?? []) {
            if (!slice.batchId) continue
            if (delta > 0) {
              const known = await db.inventoryBatch.findUnique({ where: { id: slice.batchId }, select: { id: true } })
              if (known) {
                await db.inventoryBatch.updateMany({
                  where: { id: slice.batchId, tenantId },
                  data: { quantityRemaining: { increment: slice.quantity }, initialQuantity: { increment: slice.quantity }, status: "Open" } as any,
                })
              } else {
                const raw = (adj.batchAllocations as any[]).find((a: any) => a?.batchId === slice.batchId) ?? {}
                await db.inventoryBatch.create({
                  data: {
                    id: slice.batchId, tenantId, batchNumber: String(raw.batchNumber ?? slice.batchId), productId: resolvedPid,
                    productName: String(adj.productName ?? ""), barcode: String(adj.barcode ?? ""),
                    initialQuantity: slice.quantity, quantityRemaining: slice.quantity, unitCost: slice.unitCost ?? 0, unitPrice: 0,
                    ...(raw.expiryDate ? { expiryDate: raw.expiryDate } : {}),
                  } as any,
                })
              }
            } else {
              const taken = await db.inventoryBatch.updateMany({
                where: { id: slice.batchId, tenantId, quantityRemaining: { gte: slice.quantity } },
                data: { quantityRemaining: { decrement: slice.quantity } },
              })
              if (taken.count === 0) {
                // The server's lot holds less than the device thought: take what
                // is there rather than going negative. The reconciliation report
                // shows the remainder as stock not covered by lots.
                await db.inventoryBatch.updateMany({ where: { id: slice.batchId, tenantId }, data: { quantityRemaining: 0 } })
              }
              await db.inventoryBatch.updateMany({
                where: { id: slice.batchId, tenantId, quantityRemaining: { lte: 0 } },
                data: { status: "Consumed" },
              })
            }
          }
        }
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
        // A close records the closing figures; it never rewrites who opened the shift or its float.
        const { openedById: _ob, openedByName: _on, openedAt: _oa, openingFloatUsd: _of, tenantId: _t, ...closeData } = (payload ?? {}) as Record<string, unknown>
        await db.shift.updateMany({
          where: { id: payload?.id as string, tenantId },
          data: { ...closeData, status: "Closed", closedAt: new Date() } as any,
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
