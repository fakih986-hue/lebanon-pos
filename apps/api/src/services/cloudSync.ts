/**
 * Cloud Sync Bridge
 *
 * Runs inside the local API server when IS_LOCAL_SERVER=true.
 * Two background loops:
 *   • Push every 5s — forwards pending SyncOperations to Railway
 *   • Pull every 30s — fetches Railway changes and upserts into local PostgreSQL
 *
 * Configuration:
 *   CLOUD_API_URL   — Railway base URL (env var, pre-baked into the installer)
 *   Tenant ID + API key — entered once in Settings → Cloud, persisted to
 *                         apps/api/data/cloud-config.json. Falls back to the
 *                         CLOUD_TENANT_ID / CLOUD_API_KEY env vars if the file
 *                         is absent (backward compatibility / server deploys).
 *
 * Sync state (lastPullAt) is persisted to apps/api/data/sync-state.json so it
 * survives restarts. A missing file triggers a full pull on first boot, which
 * populates the local DB from Railway.
 */

import fs   from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"
import prisma from "../lib/prisma.js"
import { broadcastToTenant } from "../ws/index.js"

// ─── Config ──────────────────────────────────────────────────────────────────

// Railway URL is always from env (pre-baked into the build / Railway dashboard)
const CLOUD_API_URL = process.env.CLOUD_API_URL?.replace(/\/+$/, "")

const PUSH_INTERVAL_MS  =  5_000   // 5s
const BATCH_SIZE        = 100
const MAX_ATTEMPTS      = 5
const FETCH_TIMEOUT_MS  = 20_000

/**
 * POS-SYNC-AUTHORITY-1 — single-hub inventory ownership.
 *
 * The store hub is authoritative for live inventory. Railway is a cloud
 * mirror/backup/dashboard, NOT the authority for in-store stock. So a normal
 * background cloud pull must never overwrite hub-owned inventory quantities
 * (Product.stock, InventoryBatch.quantityRemaining/status) on rows that already
 * exist locally — otherwise a stale cloud snapshot (e.g. cloud hasn't yet
 * received a just-completed hub sale) can "resurrect" sold stock.
 *
 * Ownership rules enforced here:
 *   • New products/batches that don't exist locally ARE created from cloud
 *     (first bootstrap / a genuinely new item added elsewhere) — creating can't
 *     resurrect anything.
 *   • Existing products: cloud may still update metadata (name, price, barcode,
 *     category, archived, …) but NOT `stock` during a normal pull.
 *   • Existing batches: cloud does NOT touch quantityRemaining/status during a
 *     normal pull (the whole update is skipped — the only mutable fields are
 *     inventory-owned).
 *   • Only an explicit force-restore (triggerFullPull) may overwrite existing
 *     inventory from cloud, and even then only when there are no pending/failed
 *     local stock operations (restoring over un-pushed local stock changes would
 *     discard the hub's own newer truth).
 *
 * Single-hub assumption: all in-store stock mutations happen at THIS hub. If a
 * second hub or a cloud-side dashboard edit ever needs to change stock, that
 * legitimately-cloud-originated change will NOT reach this hub under these rules
 * — that requires the revision/mutation model in POS-SYNC-AUTHORITY-2. See
 * stages/sync/inventory-ownership.md.
 */
const STOCK_RELATED_ENTITIES = new Set(["sale", "refund", "inventory", "product"])

// Persist lastPullAt next to the compiled output so it survives redeploys
const __dirname    = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR     = path.resolve(__dirname, "../../data")
const STATE_FILE   = path.join(DATA_DIR, "sync-state.json")
const CONFIG_FILE  = path.join(DATA_DIR, "cloud-config.json")

// ─── Runtime cloud credentials (tenant ID + API key) ──────────────────────────
// Loaded from cloud-config.json (written by Settings → Cloud) with env fallback.

interface CloudConfig { tenantId?: string; apiKey?: string }

let CLOUD_TENANT:  string | undefined
let CLOUD_API_KEY: string | undefined

function loadCloudConfig(): void {
  let fileCfg: CloudConfig = {}
  try {
    fileCfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")) as CloudConfig
  } catch { /* no file yet — use env fallback */ }
  CLOUD_TENANT  = fileCfg.tenantId || process.env.CLOUD_TENANT_ID
  CLOUD_API_KEY = fileCfg.apiKey   || process.env.CLOUD_API_KEY
}
loadCloudConfig()

/** Persist cloud credentials and (re)start the bridge with them. */
export function saveCloudConfig(tenantId: string, apiKey: string): void {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ tenantId, apiKey }, null, 2), { mode: 0o600 })
  restartCloudSyncBridge()
}

/**
 * Cloud-authoritative backfill of Product.syncId (POS-SYNC-IDENTITY-1).
 *
 * MUST run only on the authoritative cloud instance (Railway), never on a hub —
 * the caller in index.ts guards this on IS_LOCAL_SERVER being unset. The whole
 * point of cloud-authoritative backfill is that syncId is assigned in exactly
 * ONE place; hubs then adopt the cloud's value via pull reconciliation. If a
 * hub generated its own syncIds for existing products, hub and cloud would
 * disagree on identity — re-creating the divergence this feature removes.
 *
 * Idempotent: only touches rows where syncId IS NULL, so it is safe to run on
 * every boot. Each product gets a fresh UUID; because this is the single
 * authority, a random UUID is sufficient (no cross-database determinism needed).
 */
export async function backfillProductSyncIds(): Promise<void> {
  try {
    const missing = await prisma.product.findMany({
      where: { syncId: null },
      select: { id: true },
    })
    if (missing.length === 0) return
    for (const p of missing) {
      await prisma.product.update({ where: { id: p.id }, data: { syncId: randomUUID() } })
    }
    console.log(`[sync-identity] Backfilled syncId for ${missing.length} product(s) (cloud-authoritative).`)
  } catch (err) {
    console.error("[sync-identity] Product syncId backfill failed:", (err as Error).message)
  }
}

let _lastPushError: string | undefined
let _lastPullError: string | undefined
let _lastPushErrorAt: string | undefined
let _lastPullErrorAt: string | undefined
let _failedPushCount = 0
let _failedPullCount = 0
let _lastSuccessfulPushAt: string | undefined
let _lastSuccessfulPullAt: string | undefined

export function getCloudStatus(): {
  configured: boolean
  running: boolean
  tenantId?: string
  lastPullAt?: string
  lastPushAt?: string
  lastError?: string
  lastErrorAt?: string
  failedPushCount: number
  failedPullCount: number
} {
  return {
    configured: !!(CLOUD_API_URL && CLOUD_TENANT && CLOUD_API_KEY),
    running,
    tenantId:   CLOUD_TENANT,
    lastPullAt: readState().lastPullAt,
    lastPushAt: _lastSuccessfulPushAt,
    lastError:  _lastPushError || _lastPullError,
    lastErrorAt: _lastPushErrorAt || _lastPullErrorAt,
    failedPushCount: _failedPushCount,
    failedPullCount: _failedPullCount,
  }
}

/** Reload config from disk and restart the loops. */
export function restartCloudSyncBridge(): void {
  stopCloudSyncBridge()
  loadCloudConfig()
  startCloudSyncBridge()
}

// ─── State ───────────────────────────────────────────────────────────────────

interface SyncState {
  lastPullAt?: string
  /** Sorted, comma-joined labels of entities that failed on the most recent
   *  pull attempt — used to detect the same failure repeating so a single
   *  permanently-broken record (e.g. a historical debt sale referencing a
   *  hard-deleted customer) can't wedge the cursor forever. */
  lastFailedEntitiesSignature?: string
  consecutiveIdenticalFailures?: number
}

/** After this many consecutive pulls failing on the EXACT same set of
 *  entities, force-advance the cursor rather than block indefinitely — a
 *  transient issue (e.g. a customer that just hasn't synced down yet) only
 *  needs a few retries; a genuinely poisoned record needs a human, not an
 *  infinite retry loop that also blocks every other entity from progressing. */
const MAX_IDENTICAL_PULL_FAILURES = 5

function readState(): SyncState {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")) as SyncState
  } catch {
    return {}
  }
}

function writeState(state: SyncState): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
  } catch (err) {
    console.error("[cloud-sync] Failed to write sync state:", (err as Error).message)
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

let running    = false
let syncTimer: ReturnType<typeof setTimeout> | null = null
let _syncRunning = false  // guard to prevent overlapping loops

/**
 * Trigger an immediate full pull from Railway.
 * Used by /api/setup/pull-from-cloud so the connect flow doesn't wait 30s.
 */
export async function triggerFullPull(): Promise<void> {
  if (!CLOUD_API_URL || !CLOUD_API_KEY || !CLOUD_TENANT) {
    throw new Error("Cloud sync not configured (missing env vars)")
  }
  // Wait for background sync to finish before starting full pull,
  // preventing overlap with the sequential sync loop.
  while (_syncRunning) {
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  const state = readState()
  delete state.lastPullAt
  writeState(state)
  _syncRunning = true
  try {
    // Explicit operator-initiated restore — the ONLY path allowed to overwrite
    // existing hub inventory from cloud (still gated on no pending local stock
    // ops inside pullFromCloud).
    await pullFromCloud({ isRestore: true })
  } finally {
    _syncRunning = false
  }
}

export function startCloudSyncBridge(): void {
  if (!CLOUD_API_URL || !CLOUD_API_KEY || !CLOUD_TENANT) {
    console.log(
      "[cloud-sync] Disabled — set CLOUD_API_URL, CLOUD_API_KEY, and CLOUD_TENANT_ID to enable."
    )
    return
  }

  running = true
  console.log(
    `[cloud-sync] Bridge started → ${CLOUD_API_URL}  tenant=${CLOUD_TENANT}`
  )

  // Immediate full sync on startup so data is available right away
  syncLoop().catch(() => {})
}

export function stopCloudSyncBridge(): void {
  running = false
  if (syncTimer) { clearTimeout(syncTimer); syncTimer = null }
  console.log("[cloud-sync] Bridge stopped.")
}

// ─── Sequential sync loop: push → pull → wait → repeat ────────────────────

async function syncLoop(): Promise<void> {
  // Only do work if no other sync is in progress (a triggerFullPull/restore, or
  // a previous still-running tick). CRITICAL: we must ALWAYS reschedule the next
  // tick below, even when we skip the work — otherwise a single skipped tick
  // (e.g. one that fires while triggerFullPull holds _syncRunning) would break
  // the self-perpetuating setTimeout chain and permanently stop the background
  // bridge until the app restarts, with running=true and no error to show for
  // it. Skipping work is fine; skipping the reschedule is not.
  if (!_syncRunning) {
    _syncRunning = true
    try {
      await pushToCloud()
    } catch (err) {
      console.error("[cloud-sync] Push error:", (err as Error).message)
    }
    try {
      await pullFromCloud()
    } catch (err) {
      console.error("[cloud-sync] Pull error:", (err as Error).message)
    } finally {
      _syncRunning = false
    }
  }
  if (running) {
    syncTimer = setTimeout(syncLoop, PUSH_INTERVAL_MS)
    syncTimer.unref()
  }
}

// ─── Push: local pending ops → Railway ───────────────────────────────────────

async function pushToCloud(): Promise<void> {
  const tenantId = CLOUD_TENANT!

  // Cheap local check — skip network call when nothing is pending
  const pendingCount = await prisma.syncOperation.count({
    where: { tenantId, status: "Pending", attempts: { lt: MAX_ATTEMPTS } },
  })
  if (pendingCount === 0) return

  const pending = await prisma.syncOperation.findMany({
    where:   { tenantId, status: "Pending", attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { createdAt: "asc" },
    take:    BATCH_SIZE,
  })

  console.log(`[cloud-sync] Pushing ${pending.length} operation(s)…`)

  const res = await fetchCloud("/api/sync/push", {
    method: "POST",
    body:   JSON.stringify({
      operations: pending.map((op) => ({
        id:      op.id,
        entity:  op.entity,
        action:  op.action,
        payload: op.payload,
      })),
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    _lastPushError = `HTTP ${res.status}: ${text}`
    _lastPushErrorAt = new Date().toISOString()
    _failedPushCount++
    throw new Error(_lastPushError)
  }

  const { results } = (await res.json()) as {
    results: Array<{ id: string; status: "ok" | "error" | "rejected"; error?: string }>
  }

  let okCount  = 0
  let errCount = 0

  await Promise.all(
    results.map(async (r) => {
      if (r.status === "ok") {
        okCount++
        await prisma.syncOperation.updateMany({
          where: { id: r.id, tenantId },
          data:  { status: "Synced", syncedAt: new Date(), lastAttemptAt: new Date() },
        })
      } else if (r.status === "rejected") {
        errCount++
        _lastPushError = r.error ?? "Rejected by Railway"
        _lastPushErrorAt = new Date().toISOString()
        _failedPushCount++
        await prisma.syncOperation.updateMany({
          where: { id: r.id, tenantId },
          data:  {
            status:        "Rejected",
            attempts:      MAX_ATTEMPTS,
            lastAttemptAt: new Date(),
            error:         _lastPushError,
          },
        })
      } else {
        errCount++
        const current = await prisma.syncOperation.findFirst({
          where:  { id: r.id, tenantId },
          select: { attempts: true },
        })
        const newAttempts = (current?.attempts ?? 0) + 1
        _lastPushError = r.error ?? "Unknown error from Railway"
        _lastPushErrorAt = new Date().toISOString()
        _failedPushCount++
        await prisma.syncOperation.updateMany({
          where: { id: r.id, tenantId },
          data:  {
            status:        newAttempts >= MAX_ATTEMPTS ? "Failed" : "Pending",
            attempts:      newAttempts,
            lastAttemptAt: new Date(),
            error:         _lastPushError,
          },
        })
      }
    })
  )

  if (okCount > 0) {
    _lastSuccessfulPushAt = new Date().toISOString()
    _lastPushError = undefined
  }
  console.log(`[cloud-sync] Push done — ✓ ${okCount} synced, ✗ ${errCount} failed`)
}

// Convert Decimal-like objects { s, e, d } from JSON → plain numbers
function fixDecimalObjects(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value !== "object") return value
  if (Array.isArray(value)) { for (let i = 0; i < value.length; i++) value[i] = fixDecimalObjects(value[i]); return value }
  const obj = value as Record<string, unknown>
  // Catch Prisma Decimal objects { s, e, d } from Railway JSON
  if ("s" in obj && "e" in obj && "d" in obj && Array.isArray(obj.d) && typeof obj.s === "number" && typeof obj.e === "number") {
    const arr = obj.d as number[]
    const mantissa = arr
      .map((segment, index) => index === 0 ? String(segment) : String(segment).padStart(7, "0"))
      .join("")
    const exponent = Number(obj.e) - (mantissa.length - 1)
    return Number((obj.s < 0 ? "-" : "") + mantissa + "e" + exponent)
  }
  for (const k of Object.keys(obj)) obj[k] = fixDecimalObjects(obj[k])
  return obj
}

// ─── Pull: Railway changes → local PostgreSQL ────────────────────────────────

// Exported for tests only — exercises one incremental pull cycle directly,
// without triggerFullPull's deliberate cursor-reset-first behavior.
export async function pullFromCloud(opts: { isRestore?: boolean } = {}): Promise<void> {
  const tenantId = CLOUD_TENANT!
  const state    = readState()
  const since    = state.lastPullAt
  const pullStartedAt = new Date().toISOString()

  // POS-SYNC-AUTHORITY-1: only an explicit restore may overwrite existing hub
  // inventory — and even then, never while local stock changes are still
  // pending/failed to push (that would discard the hub's own newer truth).
  let applyInventoryToExisting = false
  if (opts.isRestore) {
    const pendingStockOps = await prisma.syncOperation.count({
      where: {
        tenantId,
        status:  { in: ["Pending", "Failed"] },
        entity:  { in: [...STOCK_RELATED_ENTITIES] },
      },
    })
    if (pendingStockOps > 0) {
      console.warn(`[cloud-sync] Restore requested but ${pendingStockOps} local stock op(s) pending/failed — NOT applying cloud inventory to existing rows (hub is authoritative; would discard un-pushed local stock).`)
    } else {
      applyInventoryToExisting = true
    }
  }

  const query = since ? `?since=${encodeURIComponent(since)}` : ""
  const res   = await fetchCloud(`/api/sync/pull${query}`)

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    _lastPullError = `HTTP ${res.status}: ${text}`
    _lastPullErrorAt = new Date().toISOString()
    _failedPullCount++
    throw new Error(_lastPullError)
  }

  const data = (await res.json()) as PullResponse
  fixDecimalObjects(data)

  // Strip Railway's updatedAt from all upserted entities so Prisma auto-sets
  // updatedAt to the hub's local time. This ensures the hub browser's incremental
  // pull finds records regardless of clock skew between Railway and the hub.
  for (const key of [
    "products", "customers", "users", "suppliers", "sales", "refunds",
    "debtSales", "debtPayments", "expenses", "purchaseOrders",
    "supplierPayments", "shifts", "batches", "adjustments",
    "stockCounts", "dailyCloses", "deliveryOrders",
  ] as const) {
    (data as any)[key]?.forEach((item: any) => { if (item) delete item.updatedAt })
  }

  const failed = await upsertPulledData(tenantId, data, { applyInventoryToExisting })

  if (failed.length > 0) {
    const signature = [...failed].sort().join(",")
    const isSameFailureAsLastTime = state.lastFailedEntitiesSignature === signature
    const consecutiveFailures = isSameFailureAsLastTime ? (state.consecutiveIdenticalFailures ?? 0) + 1 : 1

    if (consecutiveFailures >= MAX_IDENTICAL_PULL_FAILURES) {
      // The same entities have failed to upsert this many pulls in a row —
      // this isn't a transient "hasn't synced down yet" gap anymore, it's a
      // genuinely poisoned record (e.g. a historical row referencing a
      // hard-deleted parent). Blocking the cursor forever would also freeze
      // every OTHER entity's sync, which is worse than losing this one
      // record — so force-advance past it and log loudly for support to
      // investigate, instead of wedging the whole hub indefinitely.
      console.error(`[cloud-sync] Pull failed on the same entities ${consecutiveFailures} pulls in a row (${signature}) — forcing the cursor forward to avoid blocking all other sync. These specific records will NOT be retried automatically; needs manual investigation.`)
      // lastFailedEntitiesSignature/consecutiveIdenticalFailures are cleared
      // implicitly below — the unconditional writeState({lastPullAt}) after
      // this block replaces the whole state object, not merges it.
      _lastPullError = `Gave up retrying persistent failure — entities not synced: ${failed.join(", ")}`
      _lastPullErrorAt = new Date().toISOString()
      _failedPullCount++
      broadcastToTenant(tenantId, "sync:data-changed", {})
      // Fall through to advance the cursor below, same as a clean pull.
    } else {
      // Do NOT advance the cursor — an incremental pull only asks for records
      // created/updated after lastPullAt, so advancing it here would mean the
      // entities that just failed to upsert (e.g. staff/settings on a fresh
      // hub's first pull) are never fetched again on the next cycle. Leaving
      // the cursor where it was makes the next pull re-request the same
      // window, giving the failed entities another chance.
      writeState({ ...state, lastFailedEntitiesSignature: signature, consecutiveIdenticalFailures: consecutiveFailures })
      _lastPullError = `Partial pull failure — entities not synced: ${failed.join(", ")}`
      _lastPullErrorAt = new Date().toISOString()
      _failedPullCount++
      broadcastToTenant(tenantId, "sync:data-changed", {})
      console.error(`[cloud-sync] Pull incomplete${since ? ` (since ${since})` : " (full)"} — cursor NOT advanced (attempt ${consecutiveFailures}/${MAX_IDENTICAL_PULL_FAILURES}). Failed: ${failed.join(", ")}`)
      throw new Error(_lastPullError)
    }
  }

  // Prefer JSON serverTime (new API), fall back to HTTP Date header (always
  // server-accurate), then pullStartedAt (hub's clock — least accurate).
  const serverTime = (data as any).serverTime ?? res.headers.get("Date") ?? pullStartedAt
  writeState({ lastPullAt: serverTime })
  _lastSuccessfulPullAt = new Date().toISOString()
  _lastPullError = undefined
  broadcastToTenant(tenantId, "sync:data-changed", {})
  console.log(`[cloud-sync] Pull done${since ? ` (since ${since})` : " (full)"}`)
}

// ─── Upsert all pulled entities into local PostgreSQL ────────────────────────

/**
 * Upserts every entity from a pull response into the local database.
 * Returns the list of entity labels that failed to upsert (empty = fully
 * successful). The caller uses this to decide whether it's safe to advance
 * the pull cursor — a partial failure must NOT advance it, or the failed
 * records would never be re-fetched (the next incremental pull only asks
 * for records created/updated after the cursor).
 */
async function upsertPulledData(
  tenantId: string,
  data: PullResponse,
  opts: { applyInventoryToExisting: boolean } = { applyInventoryToExisting: false },
): Promise<string[]> {
  const failed: string[] = []
  const applyInventoryToExisting = opts.applyInventoryToExisting
  // POS-SYNC-AUTHORITY-1: on a normal pull the hub owns inventory quantities.
  // Strip `stock` from an update patch for an EXISTING product so cloud can't
  // overwrite hub stock; metadata fields still flow. Skipped fully for existing
  // batches (their only mutable fields are inventory-owned). Counters feed one
  // summary log line so it's visible when the guard is doing work.
  let skippedProductStockCount = 0
  let skippedBatchCount = 0
  const productMetadataPatch = (patch: Record<string, unknown>): Record<string, unknown> => {
    if (applyInventoryToExisting) return patch
    if (Object.prototype.hasOwnProperty.call(patch, "stock")) {
      const { stock: _stock, ...rest } = patch
      skippedProductStockCount++
      return rest
    }
    return patch
  }
  // Helper: run one upsert, log errors to file + stderr without stopping other entities
  const run = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn()
    } catch (err) {
      failed.push(label)
      const msg = `[cloud-sync] upsert ${label}: ${(err as Error).message}`
      console.error(msg)
      try { fs.appendFileSync(path.join(DATA_DIR, "sync-error.log"), `${new Date().toISOString()} ${msg}\n${(err as Error).stack ?? ""}\n`) } catch {}
    }
  }

  // Ensure tenant row exists locally — all other records have a FK to it.
  // Fetch the real name + subdomain from Railway so login works correctly.
  await run("tenant", async () => {
    const existing = await prisma.tenant.findUnique({ where: { id: tenantId } })
    if (!existing) {
      let name      = "Synced Store"
      let subdomain = tenantId.slice(0, 8)

      try {
        const infoRes = await fetchCloud("/api/setup/tenant-info")
        if (infoRes.ok) {
          const info = await infoRes.json() as { name: string; subdomain: string }
          name      = info.name
          subdomain = info.subdomain
        }
      } catch { /* use placeholders if endpoint unreachable */ }

      await prisma.tenant.create({
        data: { id: tenantId, name, subdomain },
      })
      console.log(`[cloud-sync] Created local tenant: "${name}" (subdomain: ${subdomain})`)
    }
  })

  for (const deletion of data.deletions ?? []) {
    await run(`delete:${String(deletion.entity)}`, async () => {
      const id = deletion.id
      const saleNumber = deletion.saleNumber
      if (id === undefined && saleNumber === undefined) return

      switch (deletion.entity) {
        case "product": {
          const productId = Number(id)
          if (tenantId && productId) {
            await prisma.inventoryBatch.deleteMany({ where: { tenantId, productId } })
            await prisma.stockAdjustment.deleteMany({ where: { tenantId, productId } })
            await (prisma as any).stockMovement.deleteMany({ where: { tenantId, productId } })
            const countSessions = await prisma.stockCountSession.findMany({
              where: { tenantId },
              select: { id: true },
            })
            if (countSessions.length > 0) {
              await prisma.stockCountLine.deleteMany({
                where: { productId, sessionId: { in: countSessions.map(s => s.id) } },
              })
            }
          }
          await prisma.product.deleteMany({ where: { tenantId, id: productId } })
          break
        }
        case "customer":
          await prisma.customer.deleteMany({ where: { tenantId, id: String(id) } })
          break
        case "supplier":
          await prisma.supplier.deleteMany({ where: { tenantId, id: String(id) } })
          break
        case "staff":
          await prisma.staffUser.deleteMany({ where: { tenantId, id: String(id) } })
          break
        case "sale":
          {
            const sale = await prisma.sale.findFirst({
              where: id !== undefined ? { tenantId, id: String(id) } : { tenantId, saleNumber: String(saleNumber) },
              select: { id: true },
            })
            if (sale) {
              await prisma.saleTender.deleteMany({ where: { saleId: sale.id } })
              await prisma.saleItem.deleteMany({ where: { saleId: sale.id } })
              await prisma.sale.deleteMany({ where: { tenantId, id: sale.id } })
            }
          }
          break
        case "refund":
          await prisma.refundItem.deleteMany({ where: { refundId: String(id) } })
          await prisma.saleRefund.deleteMany({ where: { tenantId, id: String(id) } })
          break
        case "debt":
          await prisma.debtSale.deleteMany({ where: { tenantId, id: String(id) } })
          await prisma.debtPayment.deleteMany({ where: { tenantId, id: String(id) } })
          break
        case "expense":
          await prisma.expense.deleteMany({ where: { tenantId, id: String(id) } })
          break
        case "purchase-order":
          await prisma.purchaseOrder.deleteMany({ where: { tenantId, id: String(id) } })
          break
        case "supplier-payment":
          await prisma.supplierPayment.deleteMany({ where: { tenantId, id: String(id) } })
          break
        case "shift":
          await prisma.shift.deleteMany({ where: { tenantId, id: String(id) } })
          break
        case "inventory":
          await prisma.inventoryBatch.deleteMany({ where: { tenantId, id: String(id) } })
          await prisma.stockAdjustment.deleteMany({ where: { tenantId, id: String(id) } })
          await prisma.stockCountLine.deleteMany({ where: { sessionId: String(id) } })
          await prisma.stockCountSession.deleteMany({ where: { tenantId, id: String(id) } })
          break
        case "daily-close":
          await prisma.dailyClose.deleteMany({ where: { tenantId, id: String(id) } })
          break
        case "delivery-order":
          await prisma.deliveryOrderItem.deleteMany({ where: { deliveryOrderId: String(id) } })
          await prisma.deliveryOrder.deleteMany({ where: { tenantId, id: String(id) } })
          break
      }
    })
  }

  // Settings (single record, no id field)
  for (const s of data.settings ?? []) {
    await run("settings", () =>
      prisma.appSettings.upsert({
        where:  { tenantId },
        create: { ...s, tenantId } as any,
        update: s as any,
      })
    )
  }

  // Products
  for (const p of data.products ?? []) {
    await run("product", async () => {
      // The incoming numeric id is Railway's local PK — it is NEVER adopted
      // locally (that would rewrite this hub's own PK and orphan child FKs).
      // Match order: syncId (the stable cross-system identity) → local numeric
      // id (only meaningful for already-aligned rows, e.g. products originally
      // pulled from cloud) → barcode (legacy fallback for pre-syncId rows).
      // Whatever match we find, we adopt the incoming syncId onto the local
      // row so this hub converges on the cloud's authoritative identity.
      const incomingSyncId = (p as any).syncId as string | null | undefined
      const { id: _incomingId, tenantId: _t, ...patch } = p as Record<string, unknown>

      // 1. Match by stable syncId
      if (incomingSyncId) {
        const bySync = await prisma.product.findFirst({
          where: { tenantId, syncId: incomingSyncId },
          select: { id: true },
        })
        if (bySync) {
          await prisma.product.update({ where: { id: bySync.id }, data: productMetadataPatch(patch) as any })
          return
        }
      }

      // 2. Match by local numeric id (aligned rows: pulled-from-cloud products)
      const productId = Number(_incomingId)
      if (Number.isFinite(productId) && productId > 0) {
        const existingById = await prisma.product.findFirst({
          where: { tenantId, id: productId },
          select: { id: true, syncId: true },
        })
        if (existingById) {
          // Only adopt syncId here if this local row doesn't already carry a
          // DIFFERENT one (guards the nullable-unique constraint and avoids
          // silently re-identifying a row).
          const data = (existingById.syncId && incomingSyncId && existingById.syncId !== incomingSyncId)
            ? { ...patch, syncId: existingById.syncId }
            : patch
          await prisma.product.update({ where: { id: productId }, data: productMetadataPatch(data) as any })
          return
        }
      }

      // 3. Legacy fallback: match by barcode. Never adopt the incoming numeric
      //    id (would rewrite this hub's PK). syncId IS adopted so the row gains
      //    its stable identity going forward.
      const barcode = (p as any).barcode
      if (barcode) {
        await prisma.product.upsert({
          where:  { tenantId_barcode: { tenantId, barcode } },
          create: { ...p, tenantId } as any,
          update: productMetadataPatch(patch) as any,
        })
        return
      }

      // 4. No match by any key — a genuinely new product from cloud. Create it
      //    (cloud's numeric id flows in here as a fresh insert; that's fine —
      //    it's a new local row, not an overwrite of an existing PK).
      await prisma.product.create({ data: { ...p, tenantId } as any })
    })
  }

  // Customers
  for (const c of data.customers ?? []) {
    await run("customer", () =>
      prisma.customer.upsert({
        where:  { id: (c as any).id },
        create: { ...c, tenantId } as any,
        update: c as any,
      })
    )
  }

  // Staff users
  for (const u of data.users ?? []) {
    await run("staffUser", () =>
      prisma.staffUser.upsert({
        where:  { id: (u as any).id },
        create: { ...u, tenantId } as any,
        update: u as any,
      })
    )
  }

  // Suppliers
  for (const s of data.suppliers ?? []) {
    await run("supplier", () =>
      prisma.supplier.upsert({
        where:  { id: (s as any).id },
        create: { ...s, tenantId } as any,
        update: s as any,
      })
    )
  }

  // Sales — upsert header, recreate items + tender
  // NOTE: stock is NOT decremented here — stock levels come from the products upsert above
  for (const sale of data.sales ?? []) {
    const { items, tender, ...saleData } = sale as any
    await run("sale", async () => {
      await prisma.sale.upsert({
        where:  { id: saleData.id },
        create: { ...saleData, tenantId } as any,
        update: { ...saleData }           as any,
      })
      if (Array.isArray(items) && items.length > 0) {
        await prisma.saleItem.deleteMany({ where: { saleId: saleData.id } })
        await prisma.saleItem.createMany({
          data: items.map((it: any) => ({ ...it, saleId: saleData.id })),
        })
      }
      if (tender) {
        await prisma.saleTender.deleteMany({ where: { saleId: saleData.id } })
        await prisma.saleTender.create({
          data: { ...tender, saleId: saleData.id } as any,
        })
      }
    })
  }

  // Refunds — upsert header, recreate items
  for (const r of data.refunds ?? []) {
    const { items, ...refundData } = r as any
    await run("refund", async () => {
      await prisma.saleRefund.upsert({
        where:  { id: refundData.id },
        create: { ...refundData, tenantId } as any,
        update: { ...refundData }           as any,
      })
      if (Array.isArray(items) && items.length > 0) {
        await prisma.refundItem.deleteMany({ where: { refundId: refundData.id } })
        await prisma.refundItem.createMany({
          data: items.map((it: any) => ({ ...it, refundId: refundData.id })),
        })
      }
    })
  }

  // Debt sales
  for (const d of data.debtSales ?? []) {
    await run("debtSale", () =>
      prisma.debtSale.upsert({
        where:  { id: (d as any).id },
        create: { ...d, tenantId } as any,
        update: d as any,
      })
    )
  }

  // Debt payments
  for (const d of data.debtPayments ?? []) {
    await run("debtPayment", () =>
      prisma.debtPayment.upsert({
        where:  { id: (d as any).id },
        create: { ...d, tenantId } as any,
        update: d as any,
      })
    )
  }

  // Expenses
  for (const e of data.expenses ?? []) {
    await run("expense", () =>
      prisma.expense.upsert({
        where:  { id: (e as any).id },
        create: { ...e, tenantId } as any,
        update: e as any,
      })
    )
  }

  // Purchase orders
  for (const po of data.purchaseOrders ?? []) {
    await run("purchaseOrder", () =>
      prisma.purchaseOrder.upsert({
        where:  { id: (po as any).id },
        create: { ...po, tenantId } as any,
        update: po as any,
      })
    )
  }

  // Supplier payments
  for (const sp of data.supplierPayments ?? []) {
    await run("supplierPayment", () =>
      prisma.supplierPayment.upsert({
        where:  { id: (sp as any).id },
        create: { ...sp, tenantId } as any,
        update: sp as any,
      })
    )
  }

  // Shifts
  for (const s of data.shifts ?? []) {
    await run("shift", () =>
      prisma.shift.upsert({
        where:  { id: (s as any).id },
        create: { ...s, tenantId } as any,
        update: s as any,
      })
    )
  }

  // Inventory batches — hub-authoritative. A new batch (not present locally) is
  // created from cloud; an EXISTING batch is NOT updated from cloud on a normal
  // pull, because its only mutable fields (quantityRemaining, status) are
  // hub-owned and a stale cloud copy would resurrect consumed stock. Only an
  // explicit restore (applyInventoryToExisting) may overwrite.
  for (const b of data.batches ?? []) {
    await run("inventoryBatch", async () => {
      const id = (b as any).id
      const existing = await prisma.inventoryBatch.findUnique({ where: { id }, select: { id: true } })
      if (existing) {
        if (!applyInventoryToExisting) { skippedBatchCount++; return }
        await prisma.inventoryBatch.update({ where: { id }, data: b as any })
        return
      }
      // Not present locally — create it (bootstrap / genuinely new item). Guard
      // the check-then-create against a concurrent insert of the same id (the
      // old code used an atomic upsert): if the row raced in, fall back to the
      // existing-row policy instead of failing the whole pull. Re-throw any
      // other error (e.g. a real FK violation) so it still surfaces.
      try {
        await prisma.inventoryBatch.create({ data: { ...b, tenantId } as any })
      } catch (err) {
        if ((err as { code?: string })?.code !== "P2002") throw err
        if (applyInventoryToExisting) await prisma.inventoryBatch.update({ where: { id }, data: b as any })
        else skippedBatchCount++
      }
    })
  }

  // Stock adjustments
  for (const a of data.adjustments ?? []) {
    await run("stockAdjustment", () =>
      prisma.stockAdjustment.upsert({
        where:  { id: (a as any).id },
        create: { ...a, tenantId } as any,
        update: a as any,
      })
    )
  }

  // Stock count sessions — upsert session, recreate lines
  for (const sc of data.stockCounts ?? []) {
    const { lines, ...sessionData } = sc as any
    await run("stockCountSession", async () => {
      await prisma.stockCountSession.upsert({
        where:  { id: sessionData.id },
        create: { ...sessionData, tenantId } as any,
        update: { ...sessionData }           as any,
      })
      if (Array.isArray(lines) && lines.length > 0) {
        await prisma.stockCountLine.deleteMany({ where: { sessionId: sessionData.id } })
        await prisma.stockCountLine.createMany({
          data: lines.map((l: any) => ({ ...l, sessionId: sessionData.id })),
        })
      }
    })
  }

  // Daily closes
  for (const dc of data.dailyCloses ?? []) {
    await run("dailyClose", () =>
      prisma.dailyClose.upsert({
        where:  { id: (dc as any).id },
        create: { ...dc, tenantId } as any,
        update: dc as any,
      })
    )
  }

  // Delivery orders — upsert header, recreate items
  for (const order of data.deliveryOrders ?? []) {
    const { items, ...orderData } = order as any
    await run("deliveryOrder", async () => {
      // customerId is nullable — customerName/customerPhone/address are the
      // denormalized fallback for display. If the referenced customer isn't
      // present locally (deleted upstream, or simply hasn't synced down in
      // this batch), drop the FK rather than fail the whole upsert — the
      // order itself is still valid and displayable without the link.
      if (orderData.customerId) {
        const customerExists = await prisma.customer.findUnique({
          where: { id: orderData.customerId },
          select: { id: true },
        })
        if (!customerExists) orderData.customerId = null
      }
      await prisma.deliveryOrder.upsert({
        where:  { id: orderData.id },
        create: { ...orderData, tenantId } as any,
        update: { ...orderData }           as any,
      })
      if (Array.isArray(items) && items.length > 0) {
        await prisma.deliveryOrderItem.deleteMany({ where: { deliveryOrderId: orderData.id } })
        await prisma.deliveryOrderItem.createMany({
          data: items.map((it: any) => ({ ...it, deliveryOrderId: orderData.id })),
        })
      }
    })
  }

  // auditEvents — intentionally skipped: generated server-side, read-only

  if (skippedProductStockCount > 0 || skippedBatchCount > 0) {
    console.log(`[cloud-sync] Hub-authoritative inventory: ignored cloud stock on ${skippedProductStockCount} existing product(s) and skipped ${skippedBatchCount} existing batch update(s) (POS-SYNC-AUTHORITY-1).`)
  }

  return failed
}

// ─── HTTP helper ─────────────────────────────────────────────────────────────

function fetchCloud(urlPath: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${CLOUD_API_URL}${urlPath}`, {
    ...init,
    headers: {
      "Content-Type":  "application/json",
      "x-cloud-key":   CLOUD_API_KEY!,
      "x-tenant-id":   CLOUD_TENANT!,
      ...(init.headers as Record<string, string> | undefined),
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
}

// ─── Types ───────────────────────────────────────────────────────────────────

type AnyRecord = Record<string, unknown>

interface PullResponse {
  products?:         AnyRecord[]
  sales?:            AnyRecord[]
  refunds?:          AnyRecord[]
  customers?:        AnyRecord[]
  debtSales?:        AnyRecord[]
  debtPayments?:     AnyRecord[]
  suppliers?:        AnyRecord[]
  purchaseOrders?:   AnyRecord[]
  supplierPayments?: AnyRecord[]
  users?:            AnyRecord[]
  shifts?:           AnyRecord[]
  auditEvents?:      AnyRecord[]
  settings?:         AnyRecord[]
  expenses?:         AnyRecord[]
  batches?:          AnyRecord[]
  adjustments?:      AnyRecord[]
  stockCounts?:      AnyRecord[]
  dailyCloses?:      AnyRecord[]
  deliveryOrders?:   AnyRecord[]
  deletions?:        Array<{ entity?: string; id?: string | number; saleNumber?: string }>
}
