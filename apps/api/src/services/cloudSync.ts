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
import { fileURLToPath } from "node:url"
import prisma from "../lib/prisma.js"

// ─── Config ──────────────────────────────────────────────────────────────────

// Railway URL is always from env (pre-baked into the build / Railway dashboard)
const CLOUD_API_URL = process.env.CLOUD_API_URL?.replace(/\/+$/, "")

const PUSH_INTERVAL_MS  =  5_000   // 5s
const PULL_INTERVAL_MS  = 30_000   // 30s
const BATCH_SIZE        = 100
const MAX_ATTEMPTS      = 5
const FETCH_TIMEOUT_MS  = 20_000

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

/** Current cloud connection status for the Settings UI. */
export function getCloudStatus(): { configured: boolean; running: boolean; tenantId?: string; lastPullAt?: string } {
  return {
    configured: !!(CLOUD_API_URL && CLOUD_TENANT && CLOUD_API_KEY),
    running,
    tenantId:   CLOUD_TENANT,
    lastPullAt: readState().lastPullAt,
  }
}

/** Reload config from disk and restart the loops. */
export function restartCloudSyncBridge(): void {
  stopCloudSyncBridge()
  loadCloudConfig()
  startCloudSyncBridge()
}

// ─── State ───────────────────────────────────────────────────────────────────

interface SyncState { lastPullAt?: string }

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
let pushTimer: ReturnType<typeof setTimeout> | null = null
let pullTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Trigger an immediate full pull from Railway.
 * Used by /api/setup/pull-from-cloud so the connect flow doesn't wait 30s.
 */
export async function triggerFullPull(): Promise<void> {
  if (!CLOUD_API_URL || !CLOUD_API_KEY || !CLOUD_TENANT) {
    throw new Error("Cloud sync not configured (missing env vars)")
  }
  const state = readState()
  delete state.lastPullAt
  writeState(state)
  await pullFromCloud()
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
  pushToCloud().catch(() => {})
  pullFromCloud().catch(() => {})

  schedulePush()
  schedulePull()
}

export function stopCloudSyncBridge(): void {
  running = false
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null }
  if (pullTimer) { clearTimeout(pullTimer); pullTimer = null }
  console.log("[cloud-sync] Bridge stopped.")
}

// ─── Push scheduler ──────────────────────────────────────────────────────────

function schedulePush(): void {
  pushTimer = setTimeout(async () => {
    if (!running) return
    try {
      await pushToCloud()
    } catch (err) {
      console.error("[cloud-sync] Push error:", (err as Error).message)
    }
    schedulePush() // schedule next AFTER completion (never overlapping)
  }, PUSH_INTERVAL_MS)
  pushTimer.unref()
}

// ─── Pull scheduler ──────────────────────────────────────────────────────────

function schedulePull(): void {
  pullTimer = setTimeout(async () => {
    if (!running) return
    try {
      await pullFromCloud()
    } catch (err) {
      console.error("[cloud-sync] Pull error:", (err as Error).message)
    }
    schedulePull()
  }, PULL_INTERVAL_MS)
  pullTimer.unref()
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
    throw new Error(`HTTP ${res.status}: ${text}`)
  }

  const { results } = (await res.json()) as {
    results: Array<{ id: string; status: "ok" | "error"; error?: string }>
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
      } else {
        errCount++
        // Prisma doesn't allow `{ increment: 1 }` in updateMany — use raw increment workaround
        const current = await prisma.syncOperation.findFirst({
          where:  { id: r.id, tenantId },
          select: { attempts: true },
        })
        const newAttempts = (current?.attempts ?? 0) + 1
        await prisma.syncOperation.updateMany({
          where: { id: r.id, tenantId },
          data:  {
            status:        newAttempts >= MAX_ATTEMPTS ? "Failed" : "Pending",
            attempts:      newAttempts,
            lastAttemptAt: new Date(),
            error:         r.error ?? "Unknown error from Railway",
          },
        })
      }
    })
  )

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
    let mantissa = ""
    for (let i = 0; i < arr.length; i++) {
      let s = arr[i].toString()
      if (i < arr.length - 1) s = s.padStart(4, "0")
      mantissa = s + mantissa
    }
    return Number((obj.s < 0 ? "-" : "") + mantissa + "e" + obj.e)
  }
  for (const k of Object.keys(obj)) obj[k] = fixDecimalObjects(obj[k])
  return obj
}

// ─── Pull: Railway changes → local PostgreSQL ────────────────────────────────

async function pullFromCloud(): Promise<void> {
  const tenantId = CLOUD_TENANT!
  const state    = readState()
  const since    = state.lastPullAt

  const query = since ? `?since=${encodeURIComponent(since)}` : ""
  const res   = await fetchCloud(`/api/sync/pull${query}`)

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`HTTP ${res.status}: ${text}`)
  }

  const data = (await res.json()) as PullResponse
  fixDecimalObjects(data)

  await upsertPulledData(tenantId, data)

  writeState({ lastPullAt: new Date().toISOString() })
  console.log(`[cloud-sync] Pull done${since ? ` (since ${since})` : " (full)"}`)
}

// ─── Upsert all pulled entities into local PostgreSQL ────────────────────────

async function upsertPulledData(tenantId: string, data: PullResponse): Promise<void> {
  // Helper: run one upsert, log errors without stopping other entities
  const run = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn()
    } catch (err) {
      console.error(`[cloud-sync] upsert ${label}:`, (err as Error).message)
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
    await run("product", () =>
      prisma.product.upsert({
        where:  { tenantId_barcode: { tenantId, barcode: (p as any).barcode } },
        create: { ...p, tenantId } as any,
        update: p as any,
      })
    )
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

  // Inventory batches
  for (const b of data.batches ?? []) {
    await run("inventoryBatch", () =>
      prisma.inventoryBatch.upsert({
        where:  { id: (b as any).id },
        create: { ...b, tenantId } as any,
        update: b as any,
      })
    )
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
}
