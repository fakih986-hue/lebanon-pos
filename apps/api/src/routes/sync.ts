import { Router } from "express"
import type { ServerResponse } from "node:http"
import bcrypt from "bcryptjs"
import { randomUUID } from "node:crypto"
import { z } from "zod"
import prisma from "../lib/prisma.js"

/** True only on the authoritative cloud instance (Railway), false on hubs. */
const IS_CLOUD = !["true", "1"].includes(process.env.IS_LOCAL_SERVER || "")

import { decrementProductStock } from "../lib/inventory.js"
import { applyPolicyChange, resolveLinePolicy, StockPolicyMismatchError } from "../lib/stockPolicy.js"
import { settleCloseOfDate } from "../lib/dailyClose.js"
import { verifyAttestation, type AttestationResult } from "../lib/hubAttestation.js"
import { checkApproval, useApproval, type ApprovalSeen } from "../lib/approvals.js"
import { createHash } from "node:crypto"
import { localGateBlockers, recordSyncClient, RETIRED_CLIENT_MESSAGE, StockPolicyGateError, POLICY_GATE_WINDOW_DAYS, type GateBlocker } from "../lib/policyGate.js"
import { LEGACY_REV } from "../lib/stockPolicy.js"
import { observeEvidence, transportOf } from "../lib/evidence.js"
import { claimedActorOf, describeEffects, actorLimitations, redactSecrets } from "../lib/refusedReview.js"
import { checkDevice, checkSession, type SessionResult } from "../lib/credentials.js"
import { identityGateBlockers, isHubServer } from "../lib/identityGate.js"
import { tokenKind } from "../middleware/auth.js"
import { recordStockMovement, recordStockMovementOnce, UNALLOCATED_RETURN_NOTE } from "../lib/ledger.js"
import { effectivePermissions, recordedActorRule, requiredPermissionForOp, shiftOpAllowed } from "../lib/permissions.js"
import { json, requireAuth, type AuthRequest, serializeDecimals } from "../middleware/auth.js"
import { can } from "../middleware/permission.js"
import { requireCloudOrJwtAuth } from "../middleware/cloudAuth.js"
import { requireTokenKinds } from "../middleware/auth.js"
// CONTAINMENT: till sync is for store staff, the hub's own screen and a hub's cloud link — never an
// ordering-app customer, a delivery driver or the owner portal.
const staffSync = [requireCloudOrJwtAuth, requireTokenKinds("staff", "hub-local", "bridge")]
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
/** Clients that understand an unknown (null) daily-close cost and its costStatus send this header. */
export const UNKNOWN_COST_HEADER = "x-titan-unknown-cost"
/**
 * Older hubs and tills store a pulled daily close as it comes (non-null cost columns; history
 * printed with toFixed): they get no costStatus and no unknown figures (their own default applies).
 */
export function shapeDailyClosesForClient(rows: any[], req: { headers?: Record<string, unknown> }): any[] {
  if (req.headers?.[UNKNOWN_COST_HEADER] === "1") return rows
  return rows.map((row) => {
    const { costStatus: _s, ...rest } = row
    for (const k of ["costOfGoods", "returnedCost", "grossMargin", "netProfit"]) if (rest[k] === null) delete rest[k]
    return rest
  })
}
/**
 * SPRINT-1 (schema 3): Product.stockPolicy and SaleItem.stockPolicy reach only clients that send
 * x-titan-sync-schema >= 3. Older hubs insert pulled rows verbatim and have no such column.
 */
/**
 * SPRINT-1 (schema 3): a pulling hub keeps its OWN product ids (it never adopts this server's), so
 * every pulled record that names a product also carries the product's syncId: the hub translates
 * it to its own id. (Hubs used to store this server's numeric productId verbatim, so a refund on the
 * hub restocked a product id that does not exist there.)
 */
export async function attachProductSyncIds(tenantId: string, data: { sales?: any[]; refunds?: any[]; batches?: any[]; adjustments?: any[] }) {
  const ids = new Set<number>()
  const note = (v: unknown) => { const n = Number(v); if (Number.isInteger(n) && n > 0) ids.add(n) }
  for (const s of data.sales ?? []) for (const i of s.items ?? []) note(i.productId)
  for (const r of data.refunds ?? []) for (const i of r.items ?? []) note(i.productId)
  for (const b of data.batches ?? []) note(b.productId)
  for (const a of data.adjustments ?? []) note(a.productId)
  if (ids.size === 0) return
  const rows = await prisma.product.findMany({ where: { tenantId, id: { in: [...ids] } }, select: { id: true, syncId: true } })
  const sync = new Map(rows.map((p) => [p.id, p.syncId]))
  const tag = (o: any) => { const sid = sync.get(Number(o?.productId)); if (sid) o.productSyncId = sid }
  for (const s of data.sales ?? []) for (const i of s.items ?? []) tag(i)
  for (const r of data.refunds ?? []) for (const i of r.items ?? []) tag(i)
  for (const b of data.batches ?? []) tag(b)
  for (const a of data.adjustments ?? []) tag(a)
}

export function shapeProductsForSchema(rows: any[], schema: number): any[] {
  if (schema >= 3) return rows
  // SPRINT-1: an older client knows only stock-counted products. A made-to-order product reaches it
  // with stock 0, so it cannot sell one (it would sell it from stock it does not have).
  return rows.map(({ stockPolicy: p, stockPolicyVersion: _v, stockPolicyChangedAt: _c, stockPolicyHistory: _h, stockPolicyRev: _r, ...product }: any) =>
    p === "untracked" ? { ...product, stock: 0 } : product)
}
const withoutLinePolicy = (sale: any) => Array.isArray(sale?.items) ? { ...sale, items: sale.items.map(({ stockPolicy: _p, stockPolicyConflict: _c, stockPolicyRev: _r, ...item }: any) => item) } : sale
export function shapeSalesForSchema(rows: any[], schema: number): any[] {
  if (schema >= 3) return rows
  if (schema >= 2) return rows.map(withoutLinePolicy)
  rows = rows.map(withoutLinePolicy)
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
    "pin",
  ]),
  payload: z.unknown().optional(),
  // SPRINT-2 envelope (v1): evidence sent by the client, outside the immutable command. Recorded
  // as claimed in observe mode; never part of the operation identity.
  // SPRINT-2 C: `session` is the staff session the operation was completed under (a till); `relayed`
  // is what a hub recorded when it accepted the operation (a hub's cloud link). Both observed only.
  // `valued: "server"` (a hub's cloud link only): the hub applied this operation under server
  // valuation (docs/LEGACY-TILL-COMPAT.md); without it the cloud values the operation itself.
  // SPRINT-2 D: `fwd.att` (a hub's cloud link only) is the hub's signed attestation (lib/hubAttestation.ts).
  // SPRINT-2 E: `approval` is a manager approval id (lib/approvals.ts) for this record and its values.
  ev: z.object({ v: z.number().int().optional(), offline: z.boolean().optional(), session: z.string().max(4096).optional(), relayed: z.record(z.unknown()).optional(), valued: z.literal("server").optional(), approval: z.string().max(64).optional(), fwd: z.object({ att: z.string().max(16384).optional() }).optional() }).passthrough().optional(),
})

const syncPushSchema = z.object({
  deviceId: z.string().optional(),
  operations: z.array(syncOperationSchema).max(100),
})

type SyncOperationInput = z.infer<typeof syncOperationSchema>

// SPRINT-2: what stands between this store and enforce-checkout (settings.manage).
router.get("/identity-gate", requireAuth, requireTokenKinds("staff"), async (req: AuthRequest, res: ServerResponse) => {
  if (!(await can(req, "settings.manage"))) { json(res, { error: "Needs the Settings permission." }, 403); return }
  const blockers = isHubServer() ? [] : await identityGateBlockers(req.auth!.tenantId)
  json(res, { allowed: !isHubServer() && blockers.length === 0, hubServer: isHubServer(), blockers })
})

// SPRINT-2: switch this store between observe and enforce-checkout. Only an explicit decision by a
// signed-in staff member with settings.manage, with a note; audited. Never switched automatically.
router.post("/identity-mode", requireAuth, requireTokenKinds("staff"), async (req: AuthRequest, res: ServerResponse) => {
  const body = z.object({ mode: z.enum(["observe", "enforce-checkout"]), note: z.string().trim().min(3).max(500) }).safeParse(req.body)
  if (!body.success) { json(res, { error: "Choose observe or enforce-checkout and write a note.", code: "INVALID" }, 400); return }
  const tenantId = req.auth!.tenantId
  const who = await prisma.staffUser.findFirst({ where: { id: req.auth!.userId, tenantId, active: true }, select: { name: true, role: true, permissions: true } })
  if (!who || !effectivePermissions(who.permissions as any, who.role).includes("settings.manage")) { json(res, { error: "Needs the Settings permission.", code: "FORBIDDEN" }, 403); return }
  const before = (await prisma.tenant.findUnique({ where: { id: tenantId }, select: { staffSessionMode: true } }))?.staffSessionMode ?? "observe"
  if (body.data.mode === "enforce-checkout") {
    // The activation gate: refused (not warned) until every trading client is inside the boundary.
    if (isHubServer()) { json(res, { error: "Staff identity enforcement can only be switched on at the cloud, for stores whose registers connect directly to it. Hub forwarding is not covered yet.", code: "HUB_SERVER" }, 409); return }
    const blockers = await identityGateBlockers(tenantId)
    if (blockers.length > 0) {
      await prisma.auditEvent.create({ data: { tenantId, action: "security.identity_mode.refused", entity: "settings", summary: `Enforcement not switched on: ${blockers.length} till(s) or hub(s) are outside the enforcement boundary`, metadata: { blockers } as any, userId: req.auth!.userId, userName: who.name, userRole: who.role as any } }).catch(() => undefined)
      json(res, { error: "Enforcement cannot be switched on yet: every till that still trades must be upgraded and enrolled, and the store must not use a hub. Upgrade and enroll them, or retire the ones no longer in use.", code: "IDENTITY_GATE", blockers }, 409)
      return
    }
  }
  await prisma.tenant.update({ where: { id: tenantId }, data: { staffSessionMode: body.data.mode } })
  await prisma.auditEvent.create({ data: { tenantId, action: "security.identity_mode.changed", entity: "settings", summary: `${who.name} changed staff identity mode from ${before} to ${body.data.mode}: ${body.data.note}`, metadata: { before, after: body.data.mode, note: body.data.note } as any, userId: req.auth!.userId, userName: who.name, userRole: who.role as any } }).catch(() => undefined)
  json(res, { ok: true, mode: body.data.mode, before })
})

router.get("/status", requireAuth, requireTokenKinds("staff", "hub-local"), async (req: AuthRequest, res: ServerResponse) => {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.auth!.tenantId },
      select: {
        name: true, subdomain: true, suspended: true,
        licenseStatus: true, licenseReason: true, licenseMessage: true,
        suspendedAt: true, offlineGraceDays: true, leaseExpiresAt: true,
        policyVersion: true, staffSessionMode: true,
      },
    })
    if (!tenant) { json(res, { error: "Tenant not found" }, 404); return }
    json(res, tenant)
  } catch (err) {
    console.error("Tenant status error:", err)
    json(res, { error: "Failed to get tenant status" }, 500)
  }
})

/**
 * SPRINT-2 C (observe): a session presented for another device, or an operation naming a different
 * staff member than the session that sent it, is recorded for review. Nothing is refused.
 */
async function auditObservedSession(tenantId: string, op: { id: string; entity: string; action: string; payload?: unknown }, s: SessionResult) {
  const { claimedActor } = await import("../lib/evidence.js")
  const actor = claimedActor(op.entity, op.action, op.payload)
  const problems: string[] = []
  if (s.check === "other-device") problems.push("staff session belongs to another device")
  if (s.check === "other-store") problems.push("staff session belongs to another store")
  if (s.staffId && actor.id && s.staffId !== actor.id && s.check !== "invalid") problems.push("operation names a different staff member than its session")
  if (problems.length === 0) return
  try {
    await prisma.auditEvent.create({ data: {
      tenantId, action: "security.session.observed", entity: op.entity,
      summary: `${op.action} ${op.entity}: ${problems.join("; ")} (observe mode — applied)`,
      metadata: { opId: op.id, sessionStaffId: s.staffId, sessionCheck: s.check, actorIdClaimed: actor.id } as any,
      userId: s.staffId ?? "system", userName: "", userRole: "Cashier" as any,
    } })
  } catch { /* best-effort audit */ }
}

// SPRINT-0 price policy: a sale line below the product's current catalogue price (or a
// sell-at-cost sale) needs sales.price_override on the pushing account. A wholesale price is
// honoured for a sale to a named customer. Unknown products are left to the sale handler.
async function priceOverrideViolationFor(tenantId: string, payload: unknown): Promise<string | null> {
  const p = (payload ?? {}) as Record<string, unknown>
  if (p.soldAtCost === true) return "PRICE_OVERRIDE: a sale at cost needs a manager's price-override permission."
  const items = Array.isArray(p.items) ? (p.items as Array<Record<string, unknown>>) : []
  for (const item of items) {
    const syncId = typeof item.productSyncId === "string" && item.productSyncId ? item.productSyncId : null
    const id = Number(item.id)
    const product = syncId
      ? await prisma.product.findFirst({ where: { tenantId, syncId }, select: { name: true, price: true, wholesalePrice: true } })
      : Number.isInteger(id) && id > 0 ? await prisma.product.findFirst({ where: { tenantId, id }, select: { name: true, price: true, wholesalePrice: true } }) : null
    if (!product) continue
    const list = Number(product.price)
    const wholesale = Number(product.wholesalePrice ?? 0)
    const floor = wholesale > 0 && p.customerId ? Math.min(list, wholesale) : list
    const unit = Number(item.unitPrice)
    if (Number.isFinite(unit) && unit < floor - 0.005) {
      return `PRICE_OVERRIDE: "${product.name}" was sold at ${unit}, below its price ${floor}. A manager must approve price changes.`
    }
  }
  return null
}

type SaleActor = { id: string; name: string; permissions: string[] }
/** Why this sale is not routine (a discount, a price below the catalogue, a sale at cost), or null. */
async function saleElevation(tenantId: string, payload: unknown): Promise<string | null> {
  if (requiredPermissionForOp("sale", "create", payload)) return "a discount"
  return (await priceOverrideViolationFor(tenantId, payload)) ? "a price below the catalogue or a sale at cost" : null
}

/**
 * SPRINT-2 enforce-checkout gate for one sale pushed by a register. The person authorized as is:
 *  - "session":         from a current staff session this server opened for this enrolled device;
 *  - "stale-session":   from such a session that has since expired or ended (completed work), for a
 *                       ROUTINE sale only;
 *  - "offline-claimed": the person the register NAMES on a sale it says it completed offline (the
 *                       offline flag is a claim, not a credential), for a ROUTINE sale only, checked
 *                       against that person's CURRENT standing in this store (the register's clock is
 *                       not proof of when it happened).
 * Everything else is refused and kept for a manager's review — never authorized as the connecting
 * account, never downgraded to legacy, never labelled verified.
 */
async function checkoutIdentity(tenantId: string, device: { check: string; deviceId: string | null } | null, session: SessionResult | null, ev: { offline?: unknown; session?: unknown } | undefined, payload: unknown):
  Promise<{ refuse: string } | { actor: SaleActor; basis: "session" | "stale-session" | "offline-claimed" }> {
  const seller = async (id: string | null): Promise<SaleActor | string> => {
    if (!id) return "the sale does not record who made it (no staff id)"
    const staff = await prisma.staffUser.findFirst({ where: { id, tenantId }, select: { id: true, name: true, role: true, permissions: true, active: true } })
    if (!staff) return "the person it names is not a staff member of this store"
    if (!staff.active) return `${staff.name} is not an active staff member now`
    const permissions = effectivePermissions(staff.permissions as any, staff.role)
    if (!permissions.includes("sales.checkout")) return `${staff.name} is not allowed to sell (sales.checkout)`
    return { id: staff.id, name: staff.name, permissions }
  }
  if (ev?.offline === true && !ev?.session) {
    const p = (payload ?? {}) as Record<string, unknown>
    const named = await seller(typeof p.cashierId === "string" && p.cashierId ? p.cashierId : null)
    if (typeof named === "string") return { refuse: `OFFLINE_REVIEW: a sale the register says it completed offline; ${named}. Kept for a manager's review.` }
    const elevated = await saleElevation(tenantId, payload)
    if (elevated) return { refuse: `OFFLINE_REVIEW: a sale the register says ${named.name} completed offline with ${elevated}; an offline claim cannot authorize that. Kept for a manager's review.` }
    return { actor: named, basis: "offline-claimed" }
  }
  if (!device || device.check !== "valid") return { refuse: `IDENTITY_REQUIRED: this store requires an enrolled register for sales (device credential ${device?.check ?? "absent"})` }
  if (!session || session.check === "absent") return { refuse: "IDENTITY_REQUIRED: this store requires the person selling to sign in with a server PIN check (no staff session)" }
  if (session.check !== "valid" || !session.staffId) return { refuse: `IDENTITY_REQUIRED: the staff session is not valid (${session.check})` }
  const actor = await seller(session.staffId)
  if (typeof actor === "string") return { refuse: `IDENTITY_REQUIRED: ${actor}` }
  if (session.expired || session.ended) {
    const elevated = await saleElevation(tenantId, payload)
    if (elevated) return { refuse: `SESSION_REVIEW: a sale with ${elevated} arrived on ${actor.name}'s session after it ${session.ended ? "was signed out" : "expired"}; a past session cannot authorize that. Kept for a manager's review.` }
    return { actor, basis: "stale-session" }
  }
  return { actor, basis: "session" }
}

/**
 * The permission rules for one sync operation, checked for `actorPermissions` (the pushing account;
 * or, for a manager's review of refused work, the reviewing manager). null = a store-level relay,
 * whose operations were authorized where they were made.
 */
function makeOpAuthorizer(tenantId: string, actorPermissions: string[] | null, actorId: string, approved: string[] = []) {
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
  const priceOverrideViolation = (payload: unknown) => priceOverrideViolationFor(tenantId, payload)

  async function authorizeOp(op: { entity: string; action: string; payload?: unknown }): Promise<string | null> {
    // a manager's valid approval for THIS operation grants its permission for this operation only
    if (actorPermissions && approved.length) actorPermissions = [...new Set([...actorPermissions, ...approved])]
    if (actorPermissions) {
      const required = requiredPermissionForOp(op.entity, op.action, op.payload)
      const anyOf = required == null ? [] : Array.isArray(required) ? required : [required]
      if (anyOf.length > 0 && !anyOf.some((p) => actorPermissions!.includes(p))) return `You don't have permission to ${op.action} ${op.entity}`
      if (op.entity === "sale" && op.action === "create" && !actorPermissions.includes("sales.price_override")) {
        const price = await priceOverrideViolation(op.payload)
        if (price) return price
      }
      if (op.entity === "shift" && !shiftOpAllowed(op.action, actorPermissions, actorId, op.action === "close" ? await shiftOpener(op.payload) : null)) {
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
      if (rule.kind === "permission" && rule.permission && !perms.includes(rule.permission) && !approved.includes(rule.permission)) return `The recorded staff member lacks ${rule.permission}`
    }
    return null
  }
  return authorizeOp
}

/**
 * Applies one operation exactly once: the claim row is inserted and locked, the effects run and
 * appliedAt is set in ONE transaction, so a concurrent or repeated delivery (a till retry, a hub
 * re-forward, a manager applying refused work) can never apply it twice.
 */
async function applyOnce(tenantId: string, op: { id: string; entity: string; action: string; payload?: unknown }, ctx: Parameters<typeof processOperation>[5], onApplied?: (tx: typeof prisma) => Promise<void>): Promise<"applied" | "duplicate"> {
  await syncTestHooks.beforeClaim?.(op.id)
  return prisma.$transaction(async (tx) => {
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
      // A manager declined this operation on review: it never applies, whoever sends it again.
      if (claim.status === "Dismissed") throw new DismissedOperationError(op.id)
      if (claim.status !== "Processing" && !sameOperation(claim, op)) throw new OperationIdReuseError(op.id)
      await syncTestHooks.afterClaim?.(op.id)
      if (claim.appliedAt) return "duplicate" as const

      await processOperation(tenantId, op.entity, op.action, op.payload as any, tx as typeof prisma, ctx)

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
          // applied under this server's valuation: its forwarded figures are this server's
          serverValued: true,
          status: "Pending",
          syncedAt: null,
          lastAttemptAt: new Date(),
          error: null,
        },
      })
      await onApplied?.(tx as typeof prisma)
      return "applied" as const
  })
}

router.post("/push", staffSync, async (req: AuthRequest, res: ServerResponse) => {
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
  // SPRINT-2: only the store-level relays may skip it. Any other account must be an ACTIVE staff
  // member of THIS store; a token of another kind (an ordering-app customer, an unknown id) is
  // refused outright instead of running with no permission checks at all.
  let actorPermissions: string[] | null = null
  if (req.auth!.userId !== "cloud-bridge" && req.auth!.userId !== "__admin__") {
    let actor: { role: string; permissions: unknown; tenantId: string; active: boolean } | null = null
    try {
      actor = typeof req.auth!.userId === "string" && req.auth!.userId
        ? await prisma.staffUser.findUnique({ where: { id: req.auth!.userId }, select: { role: true, permissions: true, tenantId: true, active: true } }) as any
        : null
    } catch { actor = null }
    if (!actor || actor.tenantId !== tenantId || actor.active === false) {
      json(res, { error: "This account cannot sync store operations.", code: "NOT_STAFF" }, 401)
      return
    }
    actorPermissions = effectivePermissions(actor.permissions as any, actor.role)
  }

  // SPRINT-1 upgrade gate: remember which clients trade, and with which sync schema. Recorded once
  // the device is approved and the account is known (an unapproved device cannot close the gate); never blocks the push.
  const pushSchema = clientSyncSchema(req as any)
  // A hub's link is trusted per operation (below); any other account by its cost visibility.
  const pushIsBridge = req.auth!.userId === "cloud-bridge"
  const pushCostTrusted = !pushIsBridge && await can(req, "reports.cost")
  let retiredClient = false
  try {
    const schema = pushSchema
    const isBridge = req.auth!.userId === "cloud-bridge"
    const key = isBridge ? `hub-bridge@${schema}` : parsed.data.deviceId ? `device:${parsed.data.deviceId}` : `user:${req.auth!.userId}`
    let label = isBridge ? `Store hub (sync ${schema})` : parsed.data.deviceId ?? `Account ${req.auth!.userId}`
    if (!isBridge && parsed.data.deviceId) {
      const d = await prisma.device.findUnique({ where: { tenantId_deviceId: { tenantId, deviceId: parsed.data.deviceId } }, select: { deviceName: true } }).catch(() => null)
      if (d?.deviceName) label = d.deviceName
    }
    retiredClient = (await recordSyncClient(prisma, tenantId, key, label, schema)).retired
  } catch (e) { console.error("[sync] could not record the sync client:", e) }


  // Returns a refusal message, or null when the op may run. Two checks:
  //  1. the pushing account (actorPermissions, when it is a staff user);
  //  2. the staff user the record names as acting (closedById, recordedById…).
  //     The sync token is the store/device account, not the cashier's PIN
  //     session, so this id is CLIENT-ASSERTED and unauthenticated: it catches
  //     an honest client recording a disallowed action, not a modified client
  //     (docs/PERMISSIONS-ENFORCEMENT.md). An acting user the server cannot
  //     find fails closed ("error", retried later, e.g. once that staff record
  //     has synced).
  const authorizeOp = makeOpAuthorizer(tenantId, actorPermissions, req.auth!.userId)

  const results: Array<{ id: string; status: "ok" | "error" | "rejected"; error?: string }> = []
  const activities: Array<{ entity: string; action: string; summary: string }> = []

  // SYNC-DEDUPE-2: "applied on this server" (appliedAt) is separate from onward delivery to the
  // cloud (status: Pending = still to forward, Synced = forwarded). Each operation is claimed
  // inside the same transaction that applies it: the claim row is inserted (ON CONFLICT DO
  // NOTHING) and locked (FOR UPDATE), so concurrent duplicates wait for each other and the
  // effects are applied once; the transaction that applies them also records appliedAt, so the
  // effects and "applied" commit together or not at all. A duplicate of an applied operation is
  // acknowledged without re-running it, and never touches its forwarding state.
  // SPRINT-2 C (observe): the device credential sent with this request (transport identity stays the
  // Authorization token). A hub's cloud link relays instead: its tills' sessions are the hub's to check.
  const pushKind = tokenKind(req.auth)
  const deviceHeader = typeof req.headers["x-device-credential"] === "string" ? String(req.headers["x-device-credential"]) : undefined
  const deviceSeen = pushKind === "bridge" ? null : await checkDevice(deviceHeader, tenantId)
  // SPRINT-2: this store's identity mode (observe unless an authorized person explicitly enabled it).
  const storeMode = (await prisma.tenant.findUnique({ where: { id: tenantId }, select: { staffSessionMode: true } }))?.staffSessionMode ?? "observe"
  for (const op of operations) {
    try {
      validateSyncOperation(op)
      // An account without cost visibility: its cost figures are replaced by this server's valuation
      // BEFORE the operation is applied, kept (Refused work) or forwarded. A hub would otherwise relay
      // the till's figures to the cloud, which takes its hub link's cost as sent (the deployed cloud
      // also needs them present: it values a missing line cost at 0 and requires lot and adjustment value).
      // A hub's link: only an operation the hub marks as applied under server valuation keeps the
      // hub's figures. An older hub (1.0.51 and before) and work it queued before an upgrade carry no
      // mark: those figures may be a till's own, so this server values the operation instead.
      const opCostTrusted = pushIsBridge ? (op as any).ev?.valued === "server" : pushCostTrusted
      if (!opCostTrusted) op.payload = await withServerCost(tenantId, op.entity, op.action, op.payload)

      // Already applied here (a lost response, a client retry, a hub re-forward): acknowledge.
      const applied = await prisma.syncOperation.findFirst({ where: { id: op.id, tenantId, appliedAt: { not: null } }, select: { entity: true, action: true, payload: true } })
      if (applied) {
        // Only the same operation is acknowledged: an id reused for something else is refused.
        if (!sameOperation(applied, op)) throw new OperationIdReuseError(op.id)
        results.push({ id: op.id, status: "ok" })
        continue
      }
      // Declined by a manager on review (refused-work recovery): never applies, never reopens.
      const dismissed = await prisma.syncOperation.findFirst({ where: { id: op.id, tenantId, status: "Dismissed" }, select: { error: true } })
      if (dismissed) throw new DismissedOperationError(op.id, dismissalOf(dismissed.error))

      // SPRINT-1: a retired till on an older version may not CHECK OUT: its live (write-through,
      // "wt-") sale is refused before it completes, so no payment is taken for a sale this store
      // cannot record. Sales it already completed offline (queued) are recorded below as what
      // they were (sold from stock), so no paid sale is ever stranded.
      if (retiredClient && op.entity === "sale" && op.action === "create" && String(op.id).startsWith("wt-")) {
        await prisma.auditEvent.create({ data: {
          tenantId, action: "sync.retired_client_refused", entity: "device",
          summary: `A retired till (${deviceId ?? "unknown device"}) on an older version tried to check out; the sale was refused before payment.`,
          metadata: { deviceId: deviceId ?? null, operationId: op.id, syncSchema: pushSchema },
          userId: req.auth!.userId, userName: "", userRole: req.auth!.role as any,
        } }).catch(() => undefined)
        results.push({ id: op.id, status: "rejected", error: RETIRED_CLIENT_MESSAGE })
        continue
      }

      const sessionSeen: SessionResult | null = deviceSeen ? await checkSession((op as any).ev?.session, tenantId, deviceSeen.deviceId) : null
      // SPRINT-2 D: a hub's forwarded operation: its signature over this exact command and its own evidence.
      const attested: AttestationResult | null = pushKind === "bridge"
        ? await verifyAttestation(tenantId, (op as any).ev?.fwd?.att, { id: op.id, entity: op.entity, action: op.action, digest: commandDigest(op.entity, op.action, op.payload) })
        : null
      const hubIdentity = storeMode === "enforce-checkout" && op.entity === "sale" && op.action === "create" && attested?.check === "valid" ? attestedIdentity(attested.srv) : null
      // SPRINT-2 E: a manager's online approval, checked against the register that sent the operation. A
      // hub's forwarded operation carries the approval as the hub checked it (inside its attestation).
      const approvalSeen: ApprovalSeen | null = pushKind !== "bridge" ? await checkApproval(tenantId, (op as any).ev?.approval, op, deviceSeen?.deviceId ?? null) : null
      const relayedApproval = pushKind === "bridge" && attested?.check === "valid" ? (attested.srv?.approval as ApprovalSeen | undefined) : undefined
      const approved: string[] = approvalSeen?.check === "valid" && approvalSeen.permission ? [approvalSeen.permission]
        : relayedApproval?.check === "valid" && typeof relayedApproval.permission === "string" ? [relayedApproval.permission] : []
      // SPRINT-2 enforcement (ordinary checkout, stores that enabled it): a register's sale needs this
      // store's enrolled device and a staff session; the actor is the session's person and the rules
      // run against THEIR permissions, not the connecting account's. Missing or invalid evidence is
      // refused and kept for review — never downgraded to legacy. A sale claimed as completed offline,
      // or arriving on a session that has since expired or ended, applies only if it is routine and
      // the person it names may sell NOW; otherwise it is kept for review (see checkoutIdentity).
      const gate = storeMode === "enforce-checkout" && op.entity === "sale" && op.action === "create" && (pushKind === "staff" || pushKind === "hub-local")
        ? await checkoutIdentity(tenantId, deviceSeen, sessionSeen, (op as any).ev, op.payload)
        // an enrolled hub's attested sale: the same rules, on what the hub recorded and signed (the hub
        // vouches for its device and session checks; the person's standing is checked here, now)
        : hubIdentity ? await checkoutIdentity(tenantId, hubIdentity.device, hubIdentity.session, hubIdentity.ev, op.payload)
        : null
      // Without a valid attestation a hub's forwarded sale cannot be attributed to anyone: in an
      // enforcing store it is kept for review rather than applied on the hub link's store-level authority.
      const hubOutside = storeMode === "enforce-checkout" && op.entity === "sale" && op.action === "create" && pushKind === "bridge" && attested?.check !== "valid"
        ? `HUB_UNSUPPORTED: this store enforces staff sessions; a sale forwarded by a hub needs the hub's valid attestation (${attested?.check ?? "absent"}). Kept for a manager's review.`
        : null
      const enforcedActor = gate && "actor" in gate ? gate.actor : null

      // POS-PERMISSIONS-1: server-enforce the money/admin-sensitive subset so a
      // tampered client can't bypass in-app limits. Only fires for a real staff
      // actor (actorPermissions != null) and only for mapped ops; everything
      // else passes through unchanged.
      const ruled = hubOutside ? hubOutside
        : gate && "refuse" in gate ? gate.refuse
        : enforcedActor ? await makeOpAuthorizer(tenantId, enforcedActor.permissions, enforcedActor.id, approved)(op)
        : approved.length ? await makeOpAuthorizer(tenantId, actorPermissions, req.auth!.userId, approved)(op)
        : await authorizeOp(op)
      // an approval that does not hold is said so; the operation is kept for a manager's review
      const denial = ruled && approvalSeen && approvalSeen.check !== "valid" ? `APPROVAL_INVALID: the manager approval presented is ${approvalSeen.check}; ${ruled}` : ruled
      if (denial) {
        try {
          await prisma.auditEvent.create({
            data: {
              tenantId, action: "security.permission.denied", entity: op.entity,
              summary: `Blocked ${op.action} ${op.entity}: ${denial}`,
              metadata: { reason: denial, userId: req.auth!.userId, opId: op.id, deviceId: deviceId ?? null, syncSchema: pushSchema, sessionStaffId: sessionSeen?.staffId ?? null, sessionCheck: sessionSeen?.check ?? null, deviceCheck: deviceSeen?.check ?? null },
              userId: req.auth!.userId, userName: "", userRole: req.auth!.role as any,
            },
          })
        } catch { /* best-effort audit */ }
        // Keep the refused work: its payload and reason stay on the server as an unapplied
        // "Refused" row (never forwarded, never pruned) that a manager can list. The till keeps
        // its own copy too. A later push of the same op, once permitted, applies it normally.
        try {
          const row = await prisma.syncOperation.findUnique({ where: { id: op.id }, select: { tenantId: true, appliedAt: true } })
          const error = `${denial} (pushed by account ${req.auth!.userId}${deviceId ? `, device ${deviceId}` : ""})`
          if (!row) {
            await prisma.syncOperation.create({
              data: { id: op.id, tenantId, entity: op.entity, action: op.action, summary: `${op.action} ${op.entity}`, payload: (op.payload ?? {}) as any, status: "Refused", attempts: 1, lastAttemptAt: new Date(), error },
            })
          } else if (row.tenantId === tenantId && !row.appliedAt) {
            // never reopens work a manager is resolving or has declined
            await prisma.syncOperation.updateMany({ where: { id: op.id, tenantId, appliedAt: null, status: { notIn: ["Resolving", "Dismissed"] } }, data: { status: "Refused", attempts: { increment: 1 }, lastAttemptAt: new Date(), error } })
          }
        } catch (keepErr) { console.error("Failed to keep refused operation:", keepErr) }
        // A refused price is a money decision a manager settles (never retried); other refusals
        // stay retryable (the permission may be granted later).
        results.push({ id: op.id, status: /^(PRICE_OVERRIDE|IDENTITY_REQUIRED|OFFLINE_REVIEW|SESSION_REVIEW|HUB_UNSUPPORTED|APPROVAL_INVALID):/.test(denial) ? "rejected" : "error", error: denial })
        continue
      }

      const outcome = await applyOnce(tenantId, op, { deviceId: deviceId ?? null, userId: req.auth!.userId, syncSchema: pushSchema, costTrusted: opCostTrusted }, async (tx) => {
        // SPRINT-2 Phase B (observe): what this server knows about the operation, in the same
        // transaction (never an applied operation without its evidence row, or the reverse).
        if ((tx as any).operationEvidence) {
          await (tx as any).operationEvidence.createMany({ skipDuplicates: true, data: [observeEvidence({
            opId: op.id, tenantId, entity: op.entity, action: op.action, payload: op.payload,
            kind: tokenKind(req.auth), accountId: typeof req.auth!.userId === "string" ? req.auth!.userId : null,
            deviceId: deviceId ?? null, transport: transportOf(req as any),
            acceptedBy: ["true", "1"].includes(process.env.IS_LOCAL_SERVER || "") ? "hub" : "cloud",
            envelope: (op as any).ev ?? null,
            device: deviceSeen, session: sessionSeen, relayed: (op as any).ev?.relayed ?? null, attestation: attested, approval: approvalSeen,
            enforced: !!gate && "basis" in gate && gate.basis === "session",
          })] })
        }
        // the approval is used by this operation only (a concurrent other operation presenting it fails here)
        if (approvalSeen?.check === "valid" && !(await useApproval(tx as any, approvalSeen.id, op.id))) throw new Error("APPROVAL_INVALID: the manager approval was used by another operation")
        // Enforced: the sale is recorded as made by the session's person (the payload's cashier
        // fields were written by the register). The stored operation itself is not changed.
        if (enforcedActor) {
          const saleId = (op.payload as { id?: unknown } | undefined)?.id
          if (typeof saleId === "string") await (tx as any).sale.updateMany({ where: { tenantId, id: saleId }, data: { cashierId: enforcedActor.id, cashier: enforcedActor.name } })
        }
      })

      results.push({ id: op.id, status: "ok" })
      if (outcome === "applied" && sessionSeen) await auditObservedSession(tenantId, op, sessionSeen)
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
        err instanceof DismissedOperationError ||
        errorMessage.includes("Insufficient stock") ||
        errorMessage.includes("was voided") ||
        errorMessage.includes("Insufficient stock in batch") ||
        errorMessage.includes("PIN is already in use by") ||
        errorMessage.startsWith("ONE_ADMIN:") ||
        errorMessage.startsWith("LAST_ADMIN:") ||
        err instanceof StockPolicyMismatchError ||
        err instanceof StockPolicyGateError ||
        err instanceof StaleStaffError ||
        err instanceof InvalidPurchasePriceError
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
        } else if (row.tenantId === tenantId && !row.appliedAt && !(err instanceof OperationIdReuseError) && !(err instanceof CheckoutCancelledError) && !(err instanceof DismissedOperationError)) {
          await prisma.syncOperation.updateMany({
            where: { id: op.id, tenantId, appliedAt: null, status: { notIn: ["Resolving", "Dismissed"] } },
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

// ─── SPRINT-1: store-wide upgrade gate for stock-policy changes ───────────────
/** This server's blockers, plus — on a hub with a cloud — the cloud's (unreachable cloud = blocked). */
async function policyGateBlockers(tenantId: string, opts: { localOnly?: boolean } = {}): Promise<GateBlocker[]> {
  const blockers = await localGateBlockers(prisma, tenantId)
  if (!opts.localOnly && ["true", "1"].includes(process.env.IS_LOCAL_SERVER || "")) {
    const { cloudPolicyGateBlockers } = await import("../services/cloudSync.js")
    const cloud = await cloudPolicyGateBlockers()
    if (cloud === null) blockers.push({ id: "cloud", label: "Cloud (not reachable: cannot confirm its tills are upgraded)", syncSchema: 0, lastSeenAt: new Date().toISOString(), source: "cloud" })
    else blockers.push(...(cloud as unknown as GateBlocker[]))
  }
  return blockers
}

router.get("/policy-gate", staffSync, async (req: AuthRequest, res: ServerResponse) => {
  // a hub asking (its bridge) gets this server's own clients: it adds them to its own
  const blockers = await policyGateBlockers(req.auth!.tenantId, { localOnly: req.auth!.userId === "cloud-bridge" })
  json(res, { allowed: blockers.length === 0, blockers, windowDays: POLICY_GATE_WINDOW_DAYS })
})

/** The owner retires a client that no longer trades (audited). Pushing again re-activates it. */
router.post("/clients/:id/retire", staffSync, async (req: AuthRequest, res: ServerResponse) => {
  const tenantId = req.auth!.tenantId
  if (!(await can(req, "inventory.manage"))) { json(res, { error: "Retiring a till needs the Manage inventory permission." }, 403); return }
  const note = typeof (req.body as any)?.note === "string" ? (req.body as any).note.trim() : ""
  if (note.length < 3) { json(res, { error: "A note is required (why this till or hub no longer trades)." }, 400); return }
  const id = String((req.params as any).id)
  if ((req.query as any)?.source === "cloud" && ["true", "1"].includes(process.env.IS_LOCAL_SERVER || "")) {
    const { retireCloudClient } = await import("../services/cloudSync.js")
    const r = await retireCloudClient(id, { note: `${note} (from a hub, by ${req.auth!.userId})` })
    json(res, r.body ?? {}, r.status)
    return
  }
  const row = await prisma.syncClient.findFirst({ where: { id, tenantId } })
  if (!row) { json(res, { error: "Unknown till or hub." }, 404); return }
  await prisma.syncClient.update({ where: { id }, data: { retiredAt: new Date(), retiredBy: req.auth!.userId, retiredNote: note } })
  await prisma.auditEvent.create({ data: {
    tenantId, action: "sync.client_retired", entity: "device",
    summary: `"${row.label}" (sync ${row.syncSchema}, last seen ${row.lastSeenAt.toISOString()}) was retired from the upgrade check. Note: ${note}`,
    metadata: { clientId: id, clientKey: row.clientKey, syncSchema: row.syncSchema, lastSeenAt: row.lastSeenAt.toISOString(), note },
    userId: req.auth!.userId, userName: "", userRole: req.auth!.role as any,
  } })
  json(res, { ok: true })
})

/** The owner re-admits a retired till that is still on an older version (audited): it may check out again, and closes the gate again. */
router.post("/clients/:id/readmit", staffSync, async (req: AuthRequest, res: ServerResponse) => {
  const tenantId = req.auth!.tenantId
  if (!(await can(req, "inventory.manage"))) { json(res, { error: "Re-admitting a till needs the Manage inventory permission." }, 403); return }
  const note = typeof (req.body as any)?.note === "string" ? (req.body as any).note.trim() : ""
  if (note.length < 3) { json(res, { error: "A note is required." }, 400); return }
  const id = String((req.params as any).id)
  const row = await prisma.syncClient.findFirst({ where: { id, tenantId } })
  if (!row) { json(res, { error: "Unknown till or hub." }, 404); return }
  await prisma.syncClient.update({ where: { id }, data: { retiredAt: null, retiredBy: null, retiredNote: null } })
  await prisma.auditEvent.create({ data: {
    tenantId, action: "sync.client_readmitted", entity: "device",
    summary: `"${row.label}" (sync ${row.syncSchema}) was re-admitted: it may check out again and counts in the upgrade check. Note: ${note}`,
    metadata: { clientId: id, clientKey: row.clientKey, syncSchema: row.syncSchema, note },
    userId: req.auth!.userId, userName: "", userRole: req.auth!.role as any,
  } })
  json(res, { ok: true })
})

/** SPRINT-2 Phase B: what the server recorded about one operation (observe mode). Staff with reports.view. */
// ─── Refused-work review (containment) ───────────────────────────────────────
// Operations this server refused for permissions are kept (status "Refused"). A manager reviews
// each one — original command (secrets hidden), the till's claimed local effect, what applying it
// here would do now, the reason, and what is known about who did it — and either APPLIES it under
// their own authority (the same apply-once claim as a push: never twice) or DISMISSES it (it then
// never applies, whoever resends it). Both need a signed-in staff member holding the permission the
// operation itself requires, and a note; both are audited.

/** Permissions that can decide about some refused work (see reviewPermissionsFor). */
const REVIEW_PERMISSIONS = ["settings.manage", "sales.price_override", "inventory.adjust", "inventory.manage", "inventory.receive", "customers.manage", "sales.refund", "sales.void", "delivery.manage", "staff.manage", "accounting.manage", "shifts.manage"]

/** Permissions a reviewer must hold to decide about this operation (any one of them). */
function reviewPermissionsFor(entity: string, action: string, payload: unknown, reason: string | null): string[] {
  if (reason?.startsWith("PRICE_OVERRIDE:")) return ["sales.price_override"]
  // A sale refused for missing identity: a manager decides (it may be applied under their authority).
  if (/^(IDENTITY_REQUIRED|OFFLINE_REVIEW|SESSION_REVIEW|HUB_UNSUPPORTED):/.test(reason ?? "")) return ["sales.void", "settings.manage"]
  // a failed approval: whoever may do the action itself decides
  const required = requiredPermissionForOp(entity, action, payload)
  const anyOf = required == null ? [] : Array.isArray(required) ? required : [required]
  return anyOf.length > 0 ? anyOf.map(String) : ["settings.manage"]
}

async function staffReviewer(req: AuthRequest): Promise<{ id: string; name: string; permissions: string[] } | null> {
  if (tokenKind(req.auth) !== "staff") return null
  const u = await prisma.staffUser.findFirst({ where: { id: req.auth!.userId, tenantId: req.auth!.tenantId, active: true }, select: { id: true, name: true, role: true, permissions: true } })
  return u ? { id: u.id, name: u.name, permissions: effectivePermissions(u.permissions as any, u.role) } : null
}

/** The reason as refused (without the account/device suffix the row's error carries). */
const refusalReason = (error: string | null) => (error ?? "").split(" | ")[0].replace(/ \(pushed by account [^)]*\)$/, "") || null

/** Who pushed it and from which device: recorded by the server when it refused it. */
async function refusalOrigins(tenantId: string) {
  const denials = await prisma.auditEvent.findMany({ where: { tenantId, action: "security.permission.denied" }, orderBy: { createdAt: "desc" }, take: 2000, select: { metadata: true } })
  const out = new Map<string, { userId: string | null; deviceId: string | null; syncSchema?: number }>()
  for (const d of denials) {
    const m = (d.metadata ?? {}) as Record<string, unknown>
    if (typeof m.opId === "string" && !out.has(m.opId)) out.set(m.opId, { userId: typeof m.userId === "string" ? m.userId : null, deviceId: typeof m.deviceId === "string" ? m.deviceId : null, syncSchema: typeof m.syncSchema === "number" ? m.syncSchema : undefined })
  }
  return out
}

router.get("/refused", staffSync, async (req: AuthRequest, res: ServerResponse) => {
  const tenantId = req.auth!.tenantId
  const reviewer = await staffReviewer(req)
  const viewerPerms = reviewer?.permissions ?? []
  // Reports sees everything; anyone else sees only the work they are allowed to decide about.
  const seesAll = viewerPerms.includes("reports.view")
  if (!seesAll && !REVIEW_PERMISSIONS.some((p) => viewerPerms.includes(p))) { json(res, { error: "Needs the Reports permission or a manager permission.", code: "FORBIDDEN" }, 403); return }
  const rows = await prisma.syncOperation.findMany({
    where: { tenantId, status: { in: ["Refused", "Resolving"] }, appliedAt: null },
    orderBy: { createdAt: "desc" }, take: 200,
    select: { id: true, entity: true, action: true, status: true, payload: true, error: true, attempts: true, createdAt: true, lastAttemptAt: true },
  })
  const origins = await refusalOrigins(tenantId)
  const staff = new Map((await prisma.staffUser.findMany({ where: { tenantId }, select: { id: true, name: true } })).map((s) => [s.id, s.name]))
  const operations = []
  for (const r of rows) {
    const pushed = origins.get(r.id) ?? { userId: null, deviceId: null }
    const claimed = claimedActorOf(r.entity, r.action, r.payload)
    const reason = refusalReason(r.error)
    const needs = reviewPermissionsFor(r.entity, r.action, r.payload, reason)
    if (!seesAll && !needs.some((p) => viewerPerms.includes(p))) continue
    operations.push({
      id: r.id, entity: r.entity, action: r.action, status: r.status, reason, attempts: r.attempts,
      refusedAt: r.createdAt, lastAttemptAt: r.lastAttemptAt,
      pushedBy: pushed.userId ? { id: pushed.userId, name: staff.get(pushed.userId) ?? null } : null,
      deviceId: pushed.deviceId,
      claimedActor: { ...claimed, knownName: claimed.id ? staff.get(claimed.id) ?? null : null },
      limitations: actorLimitations(pushed.userId, claimed, pushed.deviceId, r.payload),
      effects: await describeEffects(tenantId, r.entity, r.action, r.payload),
      payload: redactSecrets(r.payload),
      requiredPermissions: needs,
      canResolve: needs.some((p) => viewerPerms.includes(p)),
    })
  }
  json(res, { operations })
})

router.post("/refused/:id/resolve", staffSync, async (req: AuthRequest, res: ServerResponse) => {
  const tenantId = req.auth!.tenantId
  const body = z.object({ decision: z.enum(["apply", "dismiss"]), note: z.string().trim().min(3).max(500) }).safeParse(req.body)
  if (!body.success) { json(res, { error: "Choose apply or dismiss and write a note (at least 3 characters).", code: "INVALID" }, 400); return }
  const reviewer = await staffReviewer(req)
  if (!reviewer) { json(res, { error: "Sign in as a staff member to review refused work.", code: "NOT_STAFF" }, 403); return }
  const id = String((req.params as Record<string, string>).id)
  const row = await prisma.syncOperation.findFirst({ where: { id, tenantId }, select: { id: true, entity: true, action: true, payload: true, status: true, error: true, appliedAt: true } })
  if (!row) { json(res, { error: "Not found", code: "NOT_FOUND" }, 404); return }
  if (row.status !== "Refused" || row.appliedAt) { json(res, { error: "This operation is no longer waiting for review.", code: "NOT_REFUSED", status: row.appliedAt ? "applied" : row.status }, 409); return }
  const reason = refusalReason(row.error)
  const needs = reviewPermissionsFor(row.entity, row.action, row.payload, reason)
  if (!needs.some((p) => reviewer.permissions.includes(p))) { json(res, { error: `Deciding about this needs: ${needs.join(" or ")}.`, code: "FORBIDDEN" }, 403); return }
  // Exactly one decision: Refused -> Resolving is taken by one request only.
  const taken = await prisma.syncOperation.updateMany({ where: { id, tenantId, status: "Refused", appliedAt: null }, data: { status: "Resolving" } })
  if (taken.count !== 1) { json(res, { error: "Someone else is deciding about this operation.", code: "NOT_REFUSED" }, 409); return }
  const origin: { userId: string | null; deviceId: string | null; syncSchema?: number } = (await refusalOrigins(tenantId)).get(id) ?? { userId: null, deviceId: null }
  const audit = (action: string, summary: string, extra: Record<string, unknown> = {}) => prisma.auditEvent.create({ data: {
    tenantId, action, entity: row.entity, summary,
    metadata: { opId: id, reviewerId: reviewer.id, note: body.data.note, originalReason: reason, pushedBy: origin.userId, deviceId: origin.deviceId, ...extra } as any,
    userId: reviewer.id, userName: reviewer.name, userRole: (req.auth!.role ?? "Manager") as any,
  } }).catch(() => undefined)
  const back = (error: string) => prisma.syncOperation.updateMany({ where: { id, tenantId, status: "Resolving" }, data: { status: "Refused", error } })

  if (body.data.decision === "dismiss") {
    await prisma.syncOperation.updateMany({ where: { id, tenantId, status: "Resolving" }, data: { status: "Dismissed", error: `${row.error ?? ""} | dismissed by ${reviewer.name}: ${body.data.note}` } })
    await audit("sync.refused.dismissed", `${reviewer.name} declined refused ${row.action} ${row.entity}: ${body.data.note}`)
    json(res, { ok: true, decision: "dismiss", status: "Dismissed" })
    return
  }
  const op = { id, entity: row.entity, action: row.action, payload: row.payload ?? {} }
  // The reviewer's own authority must allow the operation (the same rules as a push by them).
  const refusal = await makeOpAuthorizer(tenantId, reviewer.permissions, reviewer.id)(op)
  if (refusal) { await back(row.error ?? ""); json(res, { error: refusal, code: "FORBIDDEN" }, 403); return }
  try {
    const outcome = await applyOnce(tenantId, op, reviewApplyCtx(origin.deviceId, reviewer.id, origin.syncSchema), reviewApplyHook(req, tenantId, op, reviewer.id, origin.deviceId))
    await audit("sync.refused.applied", `${reviewer.name} applied refused ${row.action} ${row.entity}: ${body.data.note}`, { outcome })
    try { broadcastToTenant(tenantId, "sync:data-changed", {}) } catch { /* no-op */ }
    json(res, { ok: true, decision: "apply", outcome })
  } catch (err) {
    const message = (err as Error).message
    await back(`${row.error ?? ""} | apply on review failed: ${message}`)
    json(res, { error: message, code: "APPLY_FAILED" }, 409)
  }
})

/** A manager applying refused work runs as themselves, with the sync schema the till pushed it with. */
// Refused work was pushed by an account that lacked a permission: its cost figures are not taken.
const reviewApplyCtx = (deviceId: string | null, userId: string, syncSchema?: number) => ({ deviceId, userId, syncSchema, costTrusted: false })
/** Evidence for work applied on a manager's review: the reviewer's account applied it; the actor is still only claimed. */
const reviewApplyHook = (req: AuthRequest, tenantId: string, op: { id: string; entity: string; action: string; payload?: unknown }, reviewerId: string, deviceId: string | null) => async (tx: typeof prisma) => {
  if (!(tx as any).operationEvidence) return
  const row = observeEvidence({ opId: op.id, tenantId, entity: op.entity, action: op.action, payload: op.payload, kind: "staff", accountId: reviewerId, deviceId, transport: transportOf(req as any), acceptedBy: ["true", "1"].includes(process.env.IS_LOCAL_SERVER || "") ? "hub" : "cloud", envelope: null })
  row.limitations.push("applied-on-manager-review")
  await (tx as any).operationEvidence.createMany({ skipDuplicates: true, data: [row] })
}


router.get("/evidence/:opId", staffSync, async (req: AuthRequest, res: ServerResponse) => {
  if (!(await can(req, "reports.view"))) { json(res, { error: "Needs the Reports permission." }, 403); return }
  const row = await prisma.operationEvidence.findFirst({ where: { opId: String((req.params as any).opId), tenantId: req.auth!.tenantId } })
  if (!row) { json(res, { error: "No evidence recorded for this operation." }, 404); return }
  json(res, row)
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

router.post("/validate-stock", staffSync, async (req: AuthRequest, res: ServerResponse) => {
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
    select: { id: true, name: true, stock: true, archived: true, stockPolicy: true },
  })
  const byId = new Map(products.map((p) => [p.id, p]))

  const insufficientItems: Array<{ productId: number; name: string; available: number; requested: number }> = []
  for (const item of items) {
    const product = byId.get(item.productId)
    const available = product ? Number(product.stock) : 0
    if (product && !product.archived && product.stockPolicy === "untracked") continue // made to order: no stock to check
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
router.get("/checkout-attempt/:opId", staffSync, async (req: AuthRequest, res: ServerResponse) => {
  const opId = ((req as any).params?.opId as string) || ""
  if (!opId.startsWith("wt-")) { json(res, { error: "not a checkout attempt" }, 400); return }
  const r = await attemptState(req.auth!.tenantId, opId)
  if (r.state === "foreign") { json(res, { error: "not found" }, 404); return }
  json(res, r)
})
router.post("/checkout-attempt/:opId/cancel", staffSync, async (req: AuthRequest, res: ServerResponse) => {
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

router.get("/sale-committed/:saleId", staffSync, async (req: AuthRequest, res: ServerResponse) => {
  const tenantId = req.auth!.tenantId
  const saleId = ((req as any).params?.saleId as string) || ""
  if (!saleId) { json(res, { error: "saleId required" }, 400); return }
  const sale = await prisma.sale.findFirst({
    where: { id: saleId, tenantId, status: { not: "Voided" } },
    select: { id: true },
  })
  json(res, { committed: !!sale })
})

// SPRINT-0: staff and customer PIN hashes are verifiers. Only a hub's sync connection
// (authenticated by the store's cloud key → "cloud-bridge") receives them: the hub verifies PINs
// for its LAN tills. Staff sessions (tills, back office, cashiers) never do. A till verifies
// offline with the verifier it writes itself after a successful online login (security.service
// unlockWithPin), so withholding server hashes does not change what works offline.
/** SPRINT-0: cost data a caller without reports.cost does not receive through sync (selling prices,
 *  including the wholesale price the till needs, stay). */
const SYNC_COST_KEYS = new Set(["cost", "profit", "margin", "marginPct", "totalCost", "unitCost", "fallbackUnitCost", "valueImpact", "totalValueImpact", "costTotal", "costOfGoods", "returnedCost", "grossMargin", "netProfit", "costStatus"])
export function withoutCost<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutCost) as T
  if (value && typeof value === "object" && !(value instanceof Date) && !("toNumber" in (value as object))) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (!SYNC_COST_KEYS.has(k)) out[k] = withoutCost(v)
    return out as T
  }
  return value
}

/**
 * COMPAT (1.0.50/1.0.51 tills, docs/LEGACY-TILL-COMPAT.md): those tills keep their OWN offline
 * verifier through a full pull only when the server's staff record carries a bcrypt-looking pin
 * ("$2…"); with no pin at all they drop it, and offline unlock stops after every full pull. Staff
 * records therefore carry this placeholder instead of the verifier. It matches no PIN (not a bcrypt
 * hash, not a SHA-256 hash, never typed digits) and reveals nothing, and every staff token gets the
 * same one: no client version claim can recover a real verifier.
 */
export const WITHHELD_PIN = "$2-withheld"

export function redactVerifiers<T>(rows: T[], req: AuthRequest, placeholder = false): T[] {
  if (req.auth?.userId === "cloud-bridge") return rows
  return rows.map((r) => {
    if (!r || typeof r !== "object" || !("pin" in (r as object))) return r
    const { pin: _pin, ...rest } = r as Record<string, unknown>
    return (placeholder ? { ...rest, pin: WITHHELD_PIN } : rest) as T
  })
}

router.get("/pull", staffSync, async (req: AuthRequest, res: ServerResponse) => {
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
    // Staff changed since the last pull too, not only new staff: a PIN reset, a role or permission
    // change, a deactivation must reach hubs and tills (they verify PINs against this copy).
    prisma.staffUser.findMany({
      where: { tenantId, ...(sinceDate ? updatedFilter : {}) },
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

  if (clientSyncSchema(req as any) >= 3) await attachProductSyncIds(tenantId, { sales, refunds, batches, adjustments })
  const showCost = await can(req, "reports.cost")
  const body = {
    serverTime: new Date().toISOString(),
    products: shapeProductsForSchema(products, clientSyncSchema(req as any)), sales: shapeSalesForSchema(sales, clientSyncSchema(req as any)), refunds: shapeRefundsForSchema(refunds, clientSyncSchema(req as any)), customers: redactVerifiers(customers, req), debtSales: shapeDebtSalesForSchema(debtSales, clientSyncSchema(req as any)), debtPayments,
    suppliers, purchaseOrders, supplierPayments, users: redactVerifiers(users, req, true), shifts,
    auditEvents, settings: settings ? [settings] : [], expenses, batches,
    adjustments, stockCounts: counts, dailyCloses: shapeDailyClosesForClient(dailyCloses, req as any), deliveryOrders,
    deletions: deletions.map((op) => ({
      entity: op.entity,
      id: (op.payload as any)?.id,
      saleNumber: (op.payload as any)?.saleNumber,
      deletedAt: op.createdAt,
    })),
  }
  // A caller without cost visibility gets no cost data and no purchase records (purchase prices).
  json(res, showCost ? body : { ...(withoutCost(serializeDecimals(body)) as Record<string, unknown>), purchaseOrders: [], supplierPayments: [] })
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
  "cash-movements":  { cursorType: "string" },
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
  "cash-movements":  "cashMovement",
}

router.get("/pull/full/:entity", staffSync, async (req: AuthRequest, res: ServerResponse) => {
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

    const showCostFull = await can(req, "reports.cost")
    const purchaseEntity = entity === "purchase-orders" || entity === "supplier-payments"
    json(res, {
      entity,
      items: !showCostFull && purchaseEntity ? [] : (showCostFull ? (x: any) => x : (x: any) => withoutCost(serializeDecimals(x)))(entity === "sales" ? shapeSalesForSchema(items, clientSyncSchema(req as any))
        : entity === "products" ? shapeProductsForSchema(items, clientSyncSchema(req as any))
        : entity === "refunds" ? shapeRefundsForSchema(items, clientSyncSchema(req as any))
        : entity === "debt-sales" ? shapeDebtSalesForSchema(items, clientSyncSchema(req as any))
        : entity === "daily-closes" ? shapeDailyClosesForClient(items, req as any)
        : entity === "users" || entity === "customers" ? redactVerifiers(items, req, entity === "users")
        : items),
      hasMore,
      nextCursor: nextCursor ?? null,
    })
  } catch (err) {
    console.error(`Sync pull-full error:`, err)
    json(res, { error: "Failed to pull full data" }, 500)
  }
})

/** A push referenced a record id that belongs to another tenant. Never retried. */
/** The partial unique index "one active admin per store" refused a write (Prisma P2002 / SQL 23505). */
export function isOneAdminViolation(err: unknown): boolean {
  const e = err as { code?: string; meta?: unknown; message?: string }
  const text = `${JSON.stringify(e?.meta ?? "")} ${e?.message ?? ""}`
  if (!(e?.code === "P2002" || e?.code === "23505" || /unique constraint/i.test(e?.message ?? ""))) return false
  if (/one_active_admin/.test(text)) return true
  // Prisma names the fields, not the index: on StaffUser the only unique constraint on tenantId
  // alone is this index (the mobile one is tenantId + mobile).
  const target = (e?.meta as { target?: unknown } | undefined)?.target
  return (Array.isArray(target) && target.length === 1 && target[0] === "tenantId") || /fields: (`tenantId`)/.test(e?.message ?? "")
}

/** Test-only pauses around the claim (real-Postgres race tests); never set in production code. */
export const syncTestHooks: { beforeClaim?: (opId: string) => Promise<void>; afterClaim?: (opId: string) => Promise<void> } = {}

/** A write-through checkout attempt the till cancelled: it can never commit afterwards. */
export class CheckoutCancelledError extends Error {
  constructor(id: string) { super(`CHECKOUT_CANCELLED: checkout attempt ${id} was cancelled by the till`); this.name = "CheckoutCancelledError" }
}
/** A manager declined this operation when reviewing refused work (non-retryable). */
export class DismissedOperationError extends Error {
  constructor(id: string, decision?: string | null) {
    super(`DISMISSED: ${decision ?? "a manager declined it on review"}. The server did not apply operation ${id}; nothing this register already did (stock changed, cash paid out or taken) was undone - correct it on this register if needed.`)
    this.name = "DismissedOperationError"
  }
}
/** "declined by <name>: <note>" from a dismissed row's error. */
export function dismissalOf(error: string | null | undefined): string | null {
  const m = /\| dismissed by ([^|:]+): ([^|]*)$/.exec(error ?? "")
  return m ? `declined by ${m[1].trim()} on review ("${m[2].trim()}")` : null
}

/** An operation id the server already holds for a different entity, action or payload. */
export class OperationIdReuseError extends Error {
  constructor(id: string) { super(`OPERATION_ID_REUSED: sync operation ${id} was already used for a different change`); this.name = "OperationIdReuseError" }
}

/** A receive whose unit cost is not a usable purchase price (negative, not a number, out of range). */
export class InvalidPurchasePriceError extends Error {
  constructor(value: unknown) { super(`INVALID_PURCHASE_PRICE: a received unit cost must be a number from 0 up (got ${JSON.stringify(value)})`); this.name = "InvalidPurchasePriceError" }
}
/** The purchase price a receive states, or undefined when it states none (missing, null, empty). */
export function purchasePrice(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined
  const n = typeof value === "number" || typeof value === "string" ? Number(value) : NaN
  if (!Number.isFinite(n) || n < 0 || n >= 1e14) throw new InvalidPurchasePriceError(value)
  return n
}

/** A daily close's cost figures: valuation (the server's when it can compute them). */
const DAY_COST_KEYS = ["costOfGoods", "returnedCost", "grossMargin", "netProfit"] as const

/**
 * A day's cost figures from this server's own records of the sales and refunds a close counted
 * (the till's accounting summary, recomputed): null when the close names none, or when any of them
 * is not here yet or has no recorded cost (the figures would be incomplete).
 */
async function dayCloseValuation(db: typeof prisma, tenantId: string, expenses: number, saleIds: unknown, refundIds: unknown) {
  if (!Array.isArray(saleIds) || !Array.isArray(refundIds)) return null
  const ids = (list: unknown[]) => [...new Set(list.filter((v): v is string => typeof v === "string" && v.length > 0))]
  const sIds = ids(saleIds), rIds = ids(refundIds)
  const sales = await db.sale.findMany({ where: { tenantId, id: { in: sIds } }, select: { id: true, profit: true, items: { select: { cost: true, quantity: true } } } })
  const refunds = await db.saleRefund.findMany({ where: { tenantId, id: { in: rIds } }, select: { saleId: true, total: true, items: { select: { cost: true, quantity: true, unitPrice: true } } } })
  if (sales.length !== sIds.length || refunds.length !== rIds.length) return null
  const known = (v: unknown) => v !== null && v !== undefined && Number.isFinite(Number(v))
  if (sales.some((sale) => !known(sale.profit) || sale.items.some((i) => !known(i.cost)))) return null
  if (refunds.some((r) => r.items.some((i) => !known(i.cost)))) return null
  const refundedSales = await db.sale.findMany({ where: { tenantId, id: { in: [...new Set(refunds.map((r) => r.saleId).filter(Boolean))] as string[] } }, select: { id: true, subtotal: true, items: { select: { total: true } } } })
  const soldCost = sales.reduce((sum, sale) => sum + sale.items.reduce((s, i) => s + Number(i.cost) * Number(i.quantity), 0), 0)
  let returnedCost = 0, refundMargin = 0
  for (const r of refunds) {
    const cost = r.items.reduce((s, i) => s + Number(i.cost) * Number(i.quantity), 0)
    const sale = refundedSales.find((x) => x.id === r.saleId)
    const gross = sale ? sale.items.reduce((s, i) => s + Number(i.total), 0) : 0
    const refundGross = r.items.reduce((s, i) => s + Number(i.unitPrice) * Number(i.quantity), 0)
    const preTax = sale && gross > 0 ? refundGross * (Number(sale.subtotal) / gross) : Number(r.total)
    returnedCost += cost
    refundMargin += preTax - cost
  }
  const round = (n: number) => Math.round(n * 10000) / 10000
  const grossMargin = sales.reduce((sum, sale) => sum + Number(sale.profit), 0) - refundMargin
  return { costOfGoods: round(Math.max(0, soldCost - returnedCost)), returnedCost: round(returnedCost), grossMargin: round(grossMargin), netProfit: round(grossMargin - expenses) }
}

/**
 * The digest of an operation's business command: the payload without valuation fields (server-computed:
 * cost, profit, lot-slice cost, value impact, a close's cost figures) and without the stock-policy
 * decision fields — the same normalization as the operation's identity (sameOperation). Server
 * valuation and manager decisions therefore never change it; a changed quantity, price, recipient or
 * action does.
 */
export function commandDigest(entity: string, action: string, payload: unknown): string {
  return createHash("sha256").update(canonicalJson(withoutPolicyDecision(withoutClientCost(entity, action, JSON.parse(JSON.stringify(payload ?? {})))))).digest("hex")
}

/** The device and session checks an enrolled hub recorded and signed for a forwarded operation. */
function attestedIdentity(srv: Record<string, unknown> | null) {
  const lim = Array.isArray(srv?.limitations) ? (srv!.limitations as unknown[]).map(String) : []
  const s = (k: string) => (typeof srv?.[k] === "string" ? (srv![k] as string) : null)
  return {
    device: s("deviceCheck") ? { check: s("deviceCheck")!, deviceId: s("enrolledDeviceId") } : null,
    session: s("sessionCheck") ? { check: s("sessionCheck") as SessionResult["check"], sessionId: s("sessionId"), staffId: s("sessionStaffId"), authTime: s("sessionAuthTime") ? new Date(s("sessionAuthTime")!) : null, expired: lim.includes("session-expired-at-receipt"), ended: lim.includes("session-ended-before-receipt") } : null,
    ev: { offline: s("evidence") === "offline-claimed", session: s("sessionCheck") && s("sessionCheck") !== "absent" ? "attested" : undefined },
  }
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
  // Valuation the client sent is not part of the operation's identity (it may have been replaced, above).
  const norm = (payload: unknown) => canonicalJson(withoutPolicyDecision(withoutClientCost(incoming.entity, incoming.action, payload ?? {})))
  return stored.entity === incoming.entity && stored.action === incoming.action
    && norm(stored.payload) === norm(JSON.parse(JSON.stringify(incoming.payload ?? {})))
}
/**
 * The operation as this server values it (docs/LEGACY-TILL-COMPAT.md): the client's cost figures are
 * dropped and replaced with this server's valuation — line cost and the sale's cost and profit (the
 * product cost here; on apply, the lots the line consumed), adjustment value and the cost of a lot it
 * creates, count line and total value. Lot slices of a sale lose their cost (the server takes it from
 * the lot itself). A receive's unit cost is not a valuation but the purchase price: it is kept.
 */
export async function withServerCost(tenantId: string, entity: string, action: string, payload: unknown): Promise<any> {
  const p = withoutClientCost(entity, action, payload)
  if (!p || typeof p !== "object") return p
  const known = new Map<string, number>()
  const costOf = async (ref: any): Promise<number> => {
    const syncId = ref?.productSyncId ?? ref?.syncId
    const id = Number(ref?.productId ?? ref?.id)
    const barcode = ref?.barcode ? String(ref.barcode) : ""
    const key = `${syncId ?? ""}|${id}|${barcode}`
    if (known.has(key)) return known.get(key)!
    const select = { cost: true } as const
    const product = (syncId ? await prisma.product.findFirst({ where: { tenantId, syncId: String(syncId) }, select }) : null)
      ?? (Number.isInteger(id) && id > 0 ? await prisma.product.findFirst({ where: { tenantId, id }, select }) : null)
      ?? (barcode ? await prisma.product.findFirst({ where: { tenantId, OR: [{ barcode }, { barcodeAliases: { has: barcode } }] }, select }) : null)
    const cost = Number(product?.cost) || 0
    known.set(key, cost)
    return cost
  }
  if (entity === "sale" && (action === "create" || action === "update") && Array.isArray(p.items)) {
    p.items = await Promise.all(p.items.map(async (i: any) => i && typeof i === "object" ? { ...i, cost: await costOf(i) } : i))
    const cost = p.items.reduce((sum: number, i: any) => sum + (Number(i?.cost) || 0) * (Number(i?.quantity) || 0), 0)
    return { ...p, cost, profit: (Number(p.total) || 0) - cost }
  }
  if (entity === "inventory" && action === "adjust") {
    const cost = await costOf(p)
    return { ...p, valueImpact: (Number(p.quantityChange) || 0) * cost, ...(Array.isArray(p.batchAllocations) ? { batchAllocations: p.batchAllocations.map((a: any) => a && typeof a === "object" ? { ...a, unitCost: cost } : a) } : {}) }
  }
  if (entity === "inventory" && action === "count" && Array.isArray(p.lines)) {
    const lines = await Promise.all(p.lines.map(async (l: any) => l && typeof l === "object" ? { ...l, valueImpact: (Number(l.variance) || 0) * await costOf(l) } : l))
    return { ...p, lines, totalValueImpact: lines.reduce((sum: number, l: any) => sum + (Number(l?.valueImpact) || 0), 0) }
  }
  return p
}

/**
 * The valuation figures a client puts in an operation (docs/LEGACY-TILL-COMPAT.md): sale and line cost
 * and profit, lot-slice cost, adjustment and count value, a daily close's cost figures. Without them the server (hub or cloud) values
 * the operation itself. A receive's unit cost (the purchase price) is business input, not valuation:
 * it stays, and is part of the operation's identity.
 */
export function withoutClientCost(entity: string, action: string, payload: unknown): any {
  if (!payload || typeof payload !== "object") return payload
  const omit = (o: any, keys: string[]) => { if (!o || typeof o !== "object") return o; const out = { ...o }; for (const k of keys) delete out[k]; return out }
  const slices = (list: unknown) => Array.isArray(list) ? list.map((a) => omit(a, ["unitCost"])) : list
  const p = payload as any
  if (entity === "sale" && (action === "create" || action === "update")) {
    return { ...omit(p, ["cost", "profit"]), ...(Array.isArray(p.items) ? { items: p.items.map((i: any) => ({ ...omit(i, ["cost"]), ...(i && "batchAllocations" in i ? { batchAllocations: slices(i.batchAllocations) } : {}) })) } : {}) }
  }
  if (entity === "inventory" && action === "adjust") return { ...omit(p, ["valueImpact"]), ...("batchAllocations" in p ? { batchAllocations: slices(p.batchAllocations) } : {}) }
  if (entity === "inventory" && action === "count") return { ...omit(p, ["totalValueImpact"]), ...(Array.isArray(p.lines) ? { lines: p.lines.map((l: any) => omit(l, ["valueImpact"])) } : {}) }
  if (entity === "daily-close" && action === "close") return omit(p, [...DAY_COST_KEYS, "costStatus"])
  return payload
}
/**
 * SPRINT-1: a held sale is re-sent under the same operation id with a manager's decision on its
 * lines (stockPolicyResolution, and the decided stockPolicy). That is the same operation: the
 * server decides the line policy anyway (from its record or an authorized decision).
 */
function withoutPolicyDecision(payload: any): any {
  if (!payload || !Array.isArray(payload.items)) return payload
  // (also the "legacy" stamp this server adds to an older till's lines: its retry carries none)
  return { ...payload, items: payload.items.map((i: any) => { if (!i || typeof i !== "object") return i; const { stockPolicy: _p, stockPolicyResolution: _r, ...rest } = i; if (rest.stockPolicyRev === LEGACY_REV) delete rest.stockPolicyRev; return rest }) }
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
  source: { deviceId?: string | null; userId?: string | null; syncSchema?: number; costTrusted?: boolean } = {}
) {
  // Cost a client sends is taken only from an account that can see cost (or a hub's link); anyone
  // else was never sent cost, so whatever it sends (0, a stale value, a made-up one) is replaced by
  // the server's own product cost (docs/LEGACY-TILL-COMPAT.md).
  const costTrusted = source.costTrusted !== false
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
  // the operation as submitted (stored and forwarded): a server valuation is written back into it
  const submitted = payload as any
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
          // SPRINT-1: the policy changes only through its revision rules (lib/stockPolicy.ts).
          const policyIn = { stockPolicy: patch.stockPolicy, stockPolicyRev: patch.stockPolicyRev, stockPolicyParentRev: patch.stockPolicyParentRev }
          normalizeProductFields(patch)
          delete patch.stockPolicy
          if (typeof policyIn.stockPolicy === "string") {
            const policySelect = { id: true, name: true, stockPolicy: true, stockPolicyRev: true, stockPolicyHistory: true }
            const cur = syncId
              ? await db.product.findFirst({ where: { tenantId, syncId: syncId as string }, select: policySelect })
              : id !== undefined ? await db.product.findFirst({ where: { tenantId, id: id as number }, select: policySelect }) : null
            if (cur) {
              const { data: policyData, branch } = applyPolicyChange(cur, policyIn)
              if (Object.keys(policyData).length > 0 && source.userId !== "cloud-bridge") {
                const blockers = await policyGateBlockers(tenantId)
                if (blockers.length > 0) throw new StockPolicyGateError(blockers)
              }
              Object.assign(patch, policyData)
              if (branch) {
                await db.auditEvent.create({ data: {
                  tenantId, action: "product.stock_policy_conflict", entity: "product",
                  summary: `"${cur.name}": a stock-setting change (${branch.policy}) was made elsewhere at the same time as another one. It is recorded (sales made under it keep it), but the current setting stays ${cur.stockPolicy}; please check.`,
                  metadata: { productId: cur.id, rev: branch.rev, parentRev: branch.parentRev, policy: branch.policy, currentRev: cur.stockPolicyRev, currentPolicy: cur.stockPolicy },
                  userId: "__system__", userName: "Sync", userRole: "Admin",
                } })
              }
            }
          }
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
          normalizeProductFields(rest)
          let syncId = (rest.syncId as string | null | undefined) || undefined
          const barcode = (rest.barcode as string | null | undefined) || undefined

          // 1. Already known by syncId → treat as an update, never a duplicate.
          if (syncId) {
            const bySync = await db.product.findFirst({ where: { tenantId, syncId }, select: { id: true } })
            if (bySync) {
              const { syncId: _s, stockPolicy: _sp, ...patch } = rest as Record<string, unknown>
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
              const { id: _i, syncId: _s, stockPolicy: _sp, ...patch } = rest as Record<string, unknown>
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
            // SPRINT-1: a made-to-order line never returns to stock (its policy when sold decides).
            if ((sale?.items as any[] | undefined)?.find((it: any) => (it.lineId ?? legacyLineKey(it.productId)) === p.key)?.stockPolicy === "untracked") continue
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
        if (source.syncSchema !== undefined && source.syncSchema < 3 && source.userId !== "cloud-bridge") {
          for (const item of data.items ?? []) if (item && !item.stockPolicyRev) { item.stockPolicyRev = LEGACY_REV; item.stockPolicy = "tracked" }
        }
        const prismaItems = await Promise.all((data.items ?? []).map(async (item: any) => {
          const productId = await resolveProductId(item)
          // SPRINT-1: the line's stock policy is the SERVER's product policy at sale time (a client
          // cannot declare a packaged item untracked to skip stock control).
          const product = productId ? await db.product.findFirst({ where: { tenantId, id: productId }, select: { name: true, stockPolicy: true, stockPolicyRev: true, stockPolicyHistory: true, cost: true } }) : null
          const resolved = resolveLinePolicy(product, item, await authorizedResolution(db, tenantId, item))
          return {
            productId,
            productName: item.name,
            barcode: typeof item.barcode === "string" ? item.barcode : "",
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            total: item.total,
            // A till without cost visibility sends no cost (or a 0 / stale one): the server's product cost is used.
            cost: costTrusted && Number.isFinite(Number(item.cost)) && item.cost !== null && item.cost !== "" ? item.cost : Number(product?.cost ?? 0),
            costFromServer: !(costTrusted && Number.isFinite(Number(item.cost)) && item.cost !== null && item.cost !== ""),
            stockPolicy: resolved.policy,
            stockPolicyConflict: resolved.conflict,
            stockPolicyRev: resolved.rev,
          }
        }))
        // Lines whose cost the till did not send are valued by the server once their lots are known (below).
        const serverCosted = (prismaItems as any[]).map((i) => i.costFromServer === true)
        const productCosts = (prismaItems as any[]).map((i) => Number(i.cost) || 0)
        for (const i of prismaItems as any[]) delete i.costFromServer
        const policyConflicts = (prismaItems as any[]).filter((i) => i.stockPolicyConflict)
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
        await decrementProductStock(db, tenantId, { byLinePolicy: true }, prismaItems.filter((i: any) => i.stockPolicy !== "untracked").map((i: any) => ({ productId: i.productId, productName: i.productName, quantity: i.quantity })))
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
          if (prismaItems[i]?.stockPolicy === "untracked") continue // no lots for made-to-order lines
          for (const allocation of item.batchAllocations ?? []) {
            const quantity = Number(allocation.quantity ?? 0)
            if (quantity <= 0) continue
            const sliceCost = costTrusted && Number.isFinite(Number(allocation.unitCost)) ? Number(allocation.unitCost) : undefined

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
            // A server-valued slice costs what its lot was bought at.
            const lotCost = sliceCost ?? (serverCosted[i] ? Number((await db.inventoryBatch.findFirst({ where: { id: allocation.batchId, tenantId }, select: { unitCost: true } }))?.unitCost ?? productCosts[i]) : undefined)
            if (sliceCost === undefined && lotCost !== undefined) allocation.unitCost = lotCost
            applied.push({ batchId: allocation.batchId, quantity: roundQty(quantity), ...(lotCost !== undefined ? { unitCost: lotCost } : {}) })
          }
        }

        // Server valuation of a line the till did not cost: the lots it consumed at their purchase
        // price, and the product cost for quantity no lot covers. Written back into the operation so a
        // hub forwards the figures it recorded.
        if (serverCosted.some(Boolean)) {
          for (let i = 0; i < prismaItems.length; i++) {
            if (!serverCosted[i]) continue
            const quantity = Number((prismaItems[i] as any).quantity) || 0
            const slices = appliedByLine[i]
            const covered = slices.reduce((sum, s) => sum + Number(s.quantity), 0)
            const value = slices.reduce((sum, s) => sum + Number(s.quantity) * (s.unitCost ?? productCosts[i]), 0) + Math.max(0, quantity - covered) * productCosts[i]
            const cost = quantity > 0 ? Math.round((value / quantity) * 10000) / 10000 : productCosts[i]
            ;(prismaItems[i] as any).cost = cost
            if (rawItems[i] && typeof rawItems[i] === "object") rawItems[i].cost = cost
          }
          const cost = Math.round((prismaItems as any[]).reduce((sum, it) => sum + Number(it.cost) * Number(it.quantity), 0) * 10000) / 10000
          data.cost = saleData.cost = cost
          data.profit = saleData.profit = Number(data.total ?? 0) - cost
          if (submitted && typeof submitted === "object") { submitted.cost = data.cost; submitted.profit = data.profit }
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
        for (const c of policyConflicts) {
          const res = c.stockPolicyConflict === "resolved" ? rawItems[prismaItems.indexOf(c)]?.stockPolicyResolution : null
          if (res) {
            await db.auditEvent.create({ data: {
              tenantId, action: "sale.stock_policy_resolved", entity: "sale",
              summary: `${saleData.saleNumber ?? saleData.id}: "${c.productName}" was held (the stock setting it was sold under was not known here). ${res.resolvedByName ?? "A manager"} recorded it as ${c.stockPolicy === "untracked" ? "made to order (no stock)" : "tracked (stock taken)"}. The customer had already paid ${Number(saleData.total ?? 0).toFixed(2)}. Note: ${String(res.note ?? "")}`,
              metadata: { saleId: saleData.id, productId: c.productId, rev: c.stockPolicyRev, appliedPolicy: c.stockPolicy, resolvedBy: res.resolvedBy, note: res.note, resolvedAt: res.at, total: saleData.total },
              userId: String(res.resolvedBy), userName: String(res.resolvedByName ?? ""), userRole: "Manager",
            } })
            continue
          }
          await db.auditEvent.create({ data: {
            tenantId, action: "sale.stock_policy_conflict", entity: "sale",
            summary: `${saleData.saleNumber ?? saleData.id}: "${c.productName}" was sold as ${c.stockPolicy}, but its stock setting changed before the sale synced. Applied the setting it was sold under; please check its stock.`,
            metadata: { saleId: saleData.id, productId: c.productId, appliedPolicy: c.stockPolicy, rev: c.stockPolicyRev, conflict: c.stockPolicyConflict },
            userId: "__system__", userName: "Sync", userRole: "Admin",
          } })
        }
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
          // SPRINT-1: a financial refund of a made-to-order line (its policy when sold) restores
          // nothing physical: the drink was made and cannot go back on the shelf.
          if ((saleItemFor(p.key) as any)?.stockPolicy === "untracked") continue
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
      // STAFF-AUTH: explicit field groups (see applyStaffWrite). A device sends its whole local copy
      // of a staff member with any edit; only what each group's rule allows is applied.
      if (action === "create" || action === "update" || action === "pin") {
        await applyStaffWrite(db, tenantId, action, (payload ?? {}) as Record<string, unknown>)
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
          // The unit cost on a receive is the delivery's actual purchase price: business input from an
          // account allowed to receive (inventory.receive), kept from any client whether or not it may
          // see cost. Only a receive that states no price is valued at the server's product cost.
          const price = purchasePrice((item as any).unitCost)
          if (price !== undefined) batchData.unitCost = price
          else if (productId > 0) batchData.unitCost = Number((await db.product.findFirst({ where: { tenantId, id: productId }, select: { cost: true } }))?.cost) || 0
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
        const persisted: Record<string, unknown> = { ...adjData, ...(resolvedPid > 0 ? { productId: resolvedPid } : {}) }
        // valueImpact (quantity × cost) is derived, never an input: the server values every
        // adjustment from its own product cost. A till without cost visibility sends null, 0 or a
        // stale figure; any submitted value is ignored.
        const adjProductCost = resolvedPid > 0 ? Number((await db.product.findFirst({ where: { tenantId, id: resolvedPid }, select: { cost: true } }))?.cost) || 0 : 0
        persisted.valueImpact = (Number(adj.quantityChange) || 0) * adjProductCost
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
                    initialQuantity: slice.quantity, quantityRemaining: slice.quantity, unitCost: costTrusted ? slice.unitCost ?? adjProductCost : adjProductCost, unitPrice: 0,
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
        // valueImpact is derived (variance × the server's product cost), never taken from the client.
        const prismaLines = await Promise.all((data.lines ?? []).map(async (line: any) => {
          const productId = await resolveProductId(line)
          const cost = productId > 0 ? Number((await db.product.findFirst({ where: { tenantId, id: productId }, select: { cost: true } }))?.cost) || 0 : 0
          return {
            productId,
            productName: line.productName ?? line.name,
            barcode: line.barcode,
            category: line.category ?? "",
            expectedQuantity: line.expectedQuantity ?? 0,
            countedQuantity: line.countedQuantity ?? null,
            variance: line.variance ?? 0,
            valueImpact: (Number(line.variance) || 0) * cost,
          }
        }))
        sessionData.totalValueImpact = prismaLines.reduce((sum: number, l: any) => sum + l.valueImpact, 0)
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
        // saleIds/refundIds: what the till counted (not columns). The cost figures are the server's
        // when it holds all of them; a cost-visible till's when it does not; otherwise unknown (null,
        // never 0). Written back so a hub forwards what it recorded.
        const { saleIds, refundIds, ...close } = (payload ?? {}) as any
        const valued = await dayCloseValuation(db, tenantId, Number(close.expenses) || 0, saleIds, refundIds)
        const stated = DAY_COST_KEYS.every((k) => close[k] !== null && close[k] !== undefined && close[k] !== "" && Number.isFinite(Number(close[k])))
        const figures = valued ? { ...valued, costStatus: "server" }
          : costTrusted && stated ? { costStatus: close.costStatus === "server" && source.userId === "cloud-bridge" ? "server" : "complete" }
          : { costOfGoods: null, returnedCost: null, grossMargin: null, netProfit: null, costStatus: "incomplete" }
        Object.assign(close, figures)
        if (submitted && typeof submitted === "object") for (const k of [...DAY_COST_KEYS, "costStatus"]) submitted[k] = close[k]
        // closing a date again: this close replaces the earlier one (kept in the audit)
        await settleCloseOfDate(db as any, tenantId, close, () => true, "push")
        await db.dailyClose.upsert({
          where: { id: close.id as string },
          update: close,
          create: { ...close, tenantId } as any,
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
    staff: ["create", "update", "pin"],
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


// ─── Staff writes (STAFF-AUTH) ───────────────────────────────────────────────
// Field groups for a staff record coming from a device:
//  - profile (name, mobile, code): always applied.
//  - access (role, permissions, active): applied only when the sender names the server's current
//    roleVersion, by a conditional write (two devices editing from the same version: one applies,
//    the other is rejected). An older copy - an offline device after an owner-portal transfer, or a
//    1.0.49 device that does not send the version - is rejected as STALE_STAFF, never acknowledged.
//    Every applied access change revokes the person's sessions (tokenVersion). The store's active
//    Admin cannot be demoted or deactivated here (LAST_ADMIN): only the owner portal's atomic
//    transfer moves the role, and it is also the recovery action for a store with no admin.
//  - authentication (pin, pinVersion, tokenVersion, pinChanged): never taken from an update. A PIN
//    change is its own action ("pin") naming the PIN version it was made on. A 1.0.49 device sends
//    its PIN change inside an update (a SHA-256 hash): accepted at the current pinVersion (which it
//    then bumps), rejected as STALE_STAFF on an older one.
//  - device-only fields (lastVerifiedPinVersion, ...): dropped.
const STAFF_PROFILE = ["name", "mobile", "code"] as const
export class StaleStaffError extends Error {
  constructor(message: string) { super(`STALE_STAFF: ${message}`); this.name = "StaleStaffError" }
}

async function assertPinFree(db: typeof prisma, tenantId: string, rawPin: string, exceptId: string) {
  if (!rawPin || rawPin.startsWith("$2")) return
  const others = await db.staffUser.findMany({ where: { tenantId, id: { not: exceptId } }, select: { name: true, pin: true } })
  for (const u of others) {
    if (u.pin.startsWith("$2") ? bcrypt.compareSync(rawPin, u.pin) : u.pin === rawPin) throw new Error(`PIN is already in use by ${u.name}`)
  }
}
async function assertOneAdmin(db: typeof prisma, tenantId: string, id: string, role: unknown, active: unknown) {
  if (role !== "Admin" || active === false) return
  const other = await db.staffUser.findFirst({ where: { tenantId, role: "Admin", active: true, id: { not: id } }, select: { name: true } })
  if (other) throw new Error(`ONE_ADMIN: This store already has an admin (${other.name}). Make this person a Manager instead.`)
}
const sameAccess = (a: unknown, b: unknown) => {
  const set = (v: unknown) => JSON.stringify(Array.isArray(v) ? [...new Set(v.map(String))].sort() : v ?? null)
  return set(a) === set(b)
}

export async function applyStaffWrite(db: typeof prisma, tenantId: string, action: string, payload: Record<string, unknown>) {
  const id = String(payload.id ?? "")
  if (!id) throw new Error("Staff id is required")
  const current = await db.staffUser.findFirst({ where: { tenantId, id } })
  try {
    if (!current) {
      if (action === "pin") throw new Error("Staff member not found")
      // Creation (also an update for someone the server does not have yet): the device chooses
      // the profile, access and first PIN; versions start at the server's defaults.
      const pin = typeof payload.pin === "string" ? payload.pin : ""
      if (!pin) throw new Error("A new staff member needs a PIN")
      await assertPinFree(db, tenantId, pin, id)
      await assertOneAdmin(db, tenantId, id, payload.role, payload.active)
      const data: Record<string, unknown> = { id, tenantId, pin: (await hashStaffPayload({ pin })).pin }
      for (const k of STAFF_PROFILE) if (typeof payload[k] === "string") data[k] = payload[k]
      if (typeof payload.role === "string") data.role = payload.role
      if (Array.isArray(payload.permissions)) data.permissions = payload.permissions
      if (typeof payload.active === "boolean") data.active = payload.active
      if (typeof payload.createdAt === "string") data.createdAt = payload.createdAt
      await db.staffUser.create({ data: data as any })
      return
    }

    if (action === "pin") {
      // A PIN change made on the current PIN: anything older (a reset happened since) is refused.
      const base = Number(payload.basePinVersion)
      if (!Number.isInteger(base) || base !== current.pinVersion) {
        throw new StaleStaffError(`${current.name}'s PIN was changed elsewhere (e.g. reset by the owner); this older PIN change was not applied.`)
      }
      const pin = typeof payload.pin === "string" ? payload.pin : ""
      if (!pin) throw new Error("PIN is required")
      await assertPinFree(db, tenantId, pin, id)
      const { count } = await db.staffUser.updateMany({ where: { id, tenantId, pinVersion: base }, data: { pin: String((await hashStaffPayload({ pin })).pin), pinVersion: { increment: 1 }, pinChanged: true } })
      if (count === 0) throw new StaleStaffError(`${current.name}'s PIN was changed elsewhere at the same time; this PIN change was not applied.`)
      return
    }

    // create (a retry or a forward of someone the server already has) or update.
    const data: Record<string, unknown> = {}
    for (const k of STAFF_PROFILE) if (typeof payload[k] === "string") data[k] = payload[k]
    let guard: { roleVersion?: number; pinVersion?: number } = {}

    const wantsAccess =
      (typeof payload.role === "string" && payload.role !== current.role) ||
      (Array.isArray(payload.permissions) && !sameAccess(payload.permissions, current.permissions)) ||
      (typeof payload.active === "boolean" && payload.active !== current.active)
    if (wantsAccess) {
      if (typeof payload.roleVersion !== "number") {
        throw new StaleStaffError(`A role or access change to ${current.name} came from a device on an older app version (or an outdated copy) and was not applied. Update the device to 1.0.50, or change roles in the owner portal.`)
      }
      if (payload.roleVersion !== current.roleVersion) {
        throw new StaleStaffError(`${current.name}'s role or access was changed elsewhere since this device's copy; this change was not applied. Review it after the next sync.`)
      }
      const role = typeof payload.role === "string" ? payload.role : current.role
      const active = typeof payload.active === "boolean" ? payload.active : current.active
      if (current.role === "Admin" && current.active && (role !== "Admin" || !active)) {
        throw new Error(`LAST_ADMIN: ${current.name} is the store's admin and cannot be demoted or deactivated. Transfer the admin role in the owner portal first.`)
      }
      if (typeof payload.role === "string") data.role = payload.role
      if (Array.isArray(payload.permissions)) data.permissions = payload.permissions
      if (typeof payload.active === "boolean") data.active = payload.active
      data.roleVersion = { increment: 1 }
      data.tokenVersion = { increment: 1 } // revoke sessions issued under the old access
      guard.roleVersion = current.roleVersion
      await assertOneAdmin(db, tenantId, id, role, active)
    }

    // A 1.0.49 device's PIN change travels inside the update as a SHA-256 hash. A server-issued
    // (bcrypt) hash, or the current one, is just the device's copy: no PIN change intended.
    const legacyPin = typeof payload.pin === "string" ? payload.pin : ""
    if (legacyPin && legacyPin !== current.pin && isSha256Base64(legacyPin)) {
      if (payload.pinVersion !== current.pinVersion) {
        throw new StaleStaffError(`${current.name}'s PIN was changed elsewhere (e.g. reset by the owner); this device's change was made on an older copy and was not applied.`)
      }
      await assertPinFree(db, tenantId, legacyPin, id)
      data.pin = legacyPin
      data.pinVersion = { increment: 1 }
      data.pinChanged = true
      guard.pinVersion = current.pinVersion
    }

    if (Object.keys(data).length > 0) {
      // Conditional on the versions read above: a concurrent access change or PIN reset in between
      // makes this a stale write, rejected rather than applied over it.
      const { count } = await db.staffUser.updateMany({ where: { id, tenantId, ...guard }, data: data as any })
      if (count === 0) throw new StaleStaffError(`${current.name} was changed elsewhere at the same time; this change was not applied.`)
    }
  } catch (err) {
    // Two admin writes racing past the check: the database index keeps one.
    if (isOneAdminViolation(err)) throw new Error("ONE_ADMIN: This store already has an admin. Make this person a Manager instead.")
    throw err
  }
}

/**
 * SPRINT-1: a blank barcode means "no barcode" and is stored as NULL (many products may have
 * none; '' would collide on the unique (tenantId, barcode) index). Identity is syncId.
 * stockPolicy accepts only "tracked" | "untracked" (anything else is dropped).
 */
/**
 * SPRINT-1: a held line's resolution counts only when the manager named in it may manage
 * inventory in this store (the till checks too; the server does not take its word for it).
 */
async function authorizedResolution(db: typeof prisma, tenantId: string, item: any): Promise<{ policy: "tracked" | "untracked" } | null> {
  const r = item?.stockPolicyResolution
  if (!r || (r.policy !== "tracked" && r.policy !== "untracked") || typeof r.resolvedBy !== "string" || typeof r.note !== "string" || r.note.trim().length < 3) return null
  const staff = await db.staffUser.findFirst({ where: { id: r.resolvedBy, tenantId, active: true }, select: { role: true, permissions: true } })
  if (!staff || !effectivePermissions(staff.permissions as any, staff.role).includes("inventory.manage" as any)) return null
  return { policy: r.policy }
}

function normalizeProductFields(p: Record<string, unknown>) {
  if ("barcode" in p && (p.barcode == null || (typeof p.barcode === "string" && p.barcode.trim() === ""))) p.barcode = null
  if ("stockPolicy" in p && p.stockPolicy !== "tracked" && p.stockPolicy !== "untracked") delete p.stockPolicy
  // The policy version and change time are server-owned (bumped below when the policy changes).
  delete p.stockPolicyVersion
  delete p.stockPolicyChangedAt
  delete p.stockPolicyHistory
  // Revision ids are handled by product.update's revision rules; a create starts at "initial".
  delete p.stockPolicyRev
  delete p.stockPolicyParentRev
  if (Array.isArray(p.barcodeAliases)) p.barcodeAliases = (p.barcodeAliases as unknown[]).map((b) => String(b).trim()).filter(Boolean)
}

async function hashStaffPayload(payload?: Record<string, unknown>) {
  const data = { ...(payload ?? {}) }
  const pin = typeof data.pin === "string" ? data.pin : ""

  // A pin the server itself sent as WITHHELD_PIN (or any other "$2…" that is not a bcrypt hash)
  // must never be stored: it would lock the person out.
  if (pin.startsWith("$2") && !/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(pin)) throw new Error("Invalid PIN")
  if (pin && !pin.startsWith("$2") && !isSha256Base64(pin)) {
    data.pin = await bcrypt.hash(pin, 12)
  }

  return data
}

function isSha256Base64(value: string) {
  return /^[A-Za-z0-9+/]{43}=$/.test(value)
}

export default router
