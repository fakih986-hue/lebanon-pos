import { putMany } from "./db"
import { writeLocalWithIndexedDB } from "./storage.service"
import { canUseStorage, createId } from "../lib/storage"

const SYNC_QUEUE_KEY = "lebanonpos.sync-queue.v1"
const LAST_SYNC_KEY  = "lebanonpos.sync-last.v1"
const SYNC_EVENT     = "lebanonpos-sync-changed"
const API_URL_KEY    = "lebanonpos.api-url"
const AUTH_TOKEN_KEY = "lebanonpos.auth-token"

/** Operations that exceed this many attempts are considered permanently dead
 *  and stop counting as "pending" in the badge. */
const MAX_ATTEMPTS = 5

const PULL_TARGETS: Record<string, { key: string; event: string }> = {
  products:         { key: "lebanonpos.products.v1",              event: "lebanonpos-products-changed" },
  sales:            { key: "lebanonpos.sales.v1",                 event: "lebanonpos-sales-changed" },
  refunds:          { key: "lebanonpos.refunds.v1",               event: "lebanonpos-refunds-changed" },
  customers:        { key: "lebanonpos.customers.v1",             event: "lebanonpos-ledger-changed" },
  debtSales:        { key: "lebanonpos.debt-sales.v1",            event: "lebanonpos-ledger-changed" },
  debtPayments:     { key: "lebanonpos.debt-payments.v1",         event: "lebanonpos-ledger-changed" },
  suppliers:        { key: "lebanonpos.suppliers.v1",             event: "lebanonpos-suppliers-changed" },
  purchaseOrders:   { key: "lebanonpos.purchase-orders.v1",       event: "lebanonpos-suppliers-changed" },
  supplierPayments: { key: "lebanonpos.supplier-payments.v1",     event: "lebanonpos-suppliers-changed" },
  users:            { key: "lebanonpos.users.v1",                 event: "lebanonpos-security-changed" },
  shifts:           { key: "lebanonpos.shifts.v1",                event: "lebanonpos-security-changed" },
  auditEvents:      { key: "lebanonpos.audit.v1",                 event: "lebanonpos-security-changed" },
  settings:         { key: "lebanonpos.settings.v1",              event: "lebanonpos-settings-changed" },
  expenses:         { key: "lebanonpos.expenses.v1",              event: "lebanonpos-expenses-changed" },
  batches:          { key: "lebanonpos.inventory-batches.v1",     event: "lebanonpos-inventory-batches-changed" },
  adjustments:      { key: "lebanonpos.inventory-adjustments.v1", event: "lebanonpos-inventory-adjustments-changed" },
  stockCounts:      { key: "lebanonpos.stock-counts.v1",          event: "lebanonpos-stock-counts-changed" },
  dailyCloses:      { key: "lebanonpos.daily-closes.v1",          event: "lebanonpos-daily-closes-changed" },
  deliveryOrders:   { key: "lebanonpos.delivery-orders.v1",       event: "lebanonpos-delivery-changed" },
}

export function getApiUrl(): string | null {
  const raw = localStorage.getItem(API_URL_KEY)
  // Strip trailing slashes so `${apiUrl}/api/...` never produces a double slash
  return raw ? raw.replace(/\/+$/, "") : raw
}
export function getAuthToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY)
}
export function setApiUrl(url: string) {
  localStorage.setItem(API_URL_KEY, url.trim().replace(/\/+$/, ""))
}
export function setAuthToken(token: string) {
  localStorage.setItem(AUTH_TOKEN_KEY, token)
}
export function clearAuthToken() {
  localStorage.removeItem(AUTH_TOKEN_KEY)
}

// ── Multi-store support ──────────────────────────────────────────────
const KNOWN_STORES_KEY = "lebanonpos.known-stores.v1"

export type KnownStore = {
  name: string
  apiUrl: string
  subdomain: string
}

export function getKnownStores(): KnownStore[] {
  try {
    const raw = localStorage.getItem(KNOWN_STORES_KEY)
    return raw ? (JSON.parse(raw) as KnownStore[]) : []
  } catch {
    return []
  }
}

export function rememberStore(store: KnownStore) {
  const stores = getKnownStores()
  const key = `${store.apiUrl}|${store.subdomain}`.toLowerCase()
  const next = stores.filter((s) => `${s.apiUrl}|${s.subdomain}`.toLowerCase() !== key)
  next.unshift(store)
  localStorage.setItem(KNOWN_STORES_KEY, JSON.stringify(next.slice(0, 10)))
}

/**
 * Wipe all store DATA from this device (keeps the known-stores list).
 * Used when switching stores so store B's data never mixes with store A's.
 */
export function clearStoreData() {
  for (const { key } of Object.values(PULL_TARGETS)) {
    localStorage.removeItem(key)
  }
  localStorage.removeItem(SYNC_QUEUE_KEY)
  localStorage.removeItem(LAST_SYNC_KEY)
  localStorage.removeItem("lebanonpos.session.v1")
  localStorage.removeItem("lebanonpos.current-user.v1")
  localStorage.removeItem("lebanonpos.held-sales.v1")
}

export type SyncEntity =
  | "sale" | "refund" | "product" | "customer" | "debt"
  | "expense" | "daily-close" | "supplier" | "purchase-order"
  | "supplier-payment" | "staff" | "shift" | "inventory" | "settings"

export type SyncAction =
  | "create" | "update" | "delete" | "receive"
  | "payment" | "close" | "open" | "adjust" | "count"

export type SyncOperationStatus = "Pending" | "Synced" | "Failed"

export type SyncOperation = {
  id: string
  entity: SyncEntity
  action: SyncAction
  summary: string
  payload?: unknown
  status: SyncOperationStatus
  attempts: number
  createdAt: string
  lastAttemptAt?: string
  syncedAt?: string
  error?: string
}

export type SyncStatus = {
  online: boolean
  pending: number   // actionable: Pending and attempts < MAX_ATTEMPTS
  failed: number    // Failed and attempts < MAX_ATTEMPTS
  dead: number      // exhausted MAX_ATTEMPTS, needs manual clear
  synced: number
  total: number
  lastSyncedAt?: string
  recentErrors: string[]
}

type EnqueueSyncInput = Pick<SyncOperation, "entity" | "action" | "summary" | "payload">

let autoFlushTimer: number | undefined

function dispatchSyncChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SYNC_EVENT))
}

function isBrowserOnline() {
  return typeof navigator === "undefined" ? true : navigator.onLine
}

function readQueue(): SyncOperation[] {
  if (!canUseStorage()) return []
  const raw = window.localStorage.getItem(SYNC_QUEUE_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as SyncOperation[]) : []
  } catch {
    return []
  }
}

function writeQueue(queue: SyncOperation[]) {
  if (!canUseStorage()) return
  // Keep newest 300, purge synced entries older than 7 days to prevent bloat
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
  const trimmed = queue
    .filter((op) => !(op.status === "Synced" && new Date(op.createdAt).getTime() < cutoff))
    .slice(0, 300)
  window.localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(trimmed))
  putMany("sync-queue", trimmed).catch(() => {})
  dispatchSyncChanged()
}

function readLastSyncedAt() {
  if (!canUseStorage()) return undefined
  return window.localStorage.getItem(LAST_SYNC_KEY) ?? undefined
}

function writeLastSyncedAt(value: string) {
  if (canUseStorage()) window.localStorage.setItem(LAST_SYNC_KEY, value)
}

function scheduleAutoFlush() {
  if (typeof window === "undefined" || !isBrowserOnline()) return
  window.clearTimeout(autoFlushTimer)
  autoFlushTimer = window.setTimeout(() => { flushSyncQueue().catch(() => {}) }, 900)
}

export function getSyncQueue() { return readQueue() }

export function getSyncStatus(): SyncStatus {
  const queue = readQueue()
  const recentErrors: string[] = []

  let pending = 0, failed = 0, dead = 0, synced = 0

  for (const op of queue) {
    if (op.status === "Synced") {
      synced++
    } else if (op.attempts >= MAX_ATTEMPTS) {
      dead++
      if (op.error && recentErrors.length < 3) recentErrors.push(`${op.entity}: ${op.error}`)
    } else if (op.status === "Pending") {
      pending++
    } else if (op.status === "Failed") {
      failed++
      if (op.error && recentErrors.length < 3) recentErrors.push(`${op.entity}: ${op.error}`)
    }
  }

  return {
    online: isBrowserOnline(),
    pending,
    failed,
    dead,
    synced,
    total: queue.length,
    lastSyncedAt: readLastSyncedAt(),
    recentErrors,
  }
}

export function enqueueSyncOperation(input: EnqueueSyncInput) {
  if (!canUseStorage()) return undefined
  const operation: SyncOperation = {
    id: createId(),
    entity: input.entity,
    action: input.action,
    summary: input.summary,
    payload: input.payload,
    status: "Pending",
    attempts: 0,
    createdAt: new Date().toISOString(),
  }
  writeQueue([operation, ...getSyncQueue()])
  scheduleAutoFlush()
  return operation
}

export async function flushSyncQueue() {
  const queue = readQueue()
  const apiUrl = getApiUrl()
  const token = getAuthToken()

  if (!isBrowserOnline() || !apiUrl || !token) {
    dispatchSyncChanged()
    return { synced: 0, skipped: queue.filter((op) => op.status === "Pending").length }
  }

  // Only try operations that are Pending and haven't exceeded max attempts
  const pending = queue.filter(
    (op) => (op.status === "Pending" || op.status === "Failed") && op.attempts < MAX_ATTEMPTS
  )

  if (pending.length === 0) {
    dispatchSyncChanged()
    return { synced: 0, skipped: 0 }
  }

  try {
    const response = await fetch(`${apiUrl}/api/sync/push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        operations: pending.map((op) => ({
          id: op.id,
          entity: op.entity,
          action: op.action,
          payload: op.payload,
        })),
      }),
    })

    if (!response.ok) {
      // If 401 — token expired, mark all pending as failed so we don't retry endlessly
      if (response.status === 401) {
        const nextQueue = queue.map((op) =>
          op.status === "Pending"
            ? { ...op, status: "Failed" as const, attempts: op.attempts + 1, error: "Token expired — re-enter in Settings" }
            : op
        )
        writeQueue(nextQueue)
        return { synced: 0, skipped: pending.length }
      }
      throw new Error(`Sync push failed: ${response.status}`)
    }

    const result = await response.json()
    const now = new Date().toISOString()
    let synced = 0

    const nextQueue = queue.map((op) => {
      if (op.status !== "Pending" && op.status !== "Failed") return op
      if (op.attempts >= MAX_ATTEMPTS) return op  // don't touch dead ops

      const syncResult = result.results?.find((r: { id: string }) => r.id === op.id)
      if (syncResult?.status === "ok") {
        synced++
        return { ...op, status: "Synced" as const, attempts: op.attempts + 1, lastAttemptAt: now, syncedAt: now, error: undefined }
      }
      return { ...op, status: "Failed" as const, attempts: op.attempts + 1, lastAttemptAt: now, error: syncResult?.error ?? "Server error" }
    })

    if (synced > 0) writeLastSyncedAt(now)
    writeQueue(nextQueue)
    return { synced, skipped: pending.length - synced }
  } catch (err) {
    // Mark all as failed with incremented attempts
    const now = new Date().toISOString()
    const nextQueue = queue.map((op) =>
      (op.status === "Pending" || op.status === "Failed") && op.attempts < MAX_ATTEMPTS
        ? { ...op, status: "Failed" as const, attempts: op.attempts + 1, lastAttemptAt: now, error: String(err) }
        : op
    )
    writeQueue(nextQueue)
    return { synced: 0, skipped: pending.length }
  }
}

/**
 * Pull data from the server.
 * @param full  When true, ignore the `since` cursor and pull EVERYTHING
 *              (use for first connect / manual full refresh).
 *
 * Safety: on an incremental pull, an empty array for a collection means
 * "nothing changed" — we must NOT overwrite local data with it. On a full
 * pull, an empty array is authoritative and replaces local.
 */
export async function pullFromServer(full = false) {
  const apiUrl = getApiUrl()
  const token = getAuthToken()
  if (!apiUrl || !token) return

  try {
    const lastSync = full ? undefined : readLastSyncedAt()
    const url = lastSync
      ? `${apiUrl}/api/sync/pull?since=${encodeURIComponent(lastSync)}`
      : `${apiUrl}/api/sync/pull`

    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!response.ok) throw new Error(`Sync pull failed: ${response.status}`)

    const data = await response.json()
    const now = new Date().toISOString()

    for (const [key, value] of Object.entries(data)) {
      const target = PULL_TARGETS[key]
      if (!target || value === null || value === undefined) continue
      const arr = Array.isArray(value) ? value : [value]
      // On incremental pulls, never wipe a local collection with an empty result
      if (!full && arr.length === 0) continue
      writeLocalWithIndexedDB(target.key, arr)
      window.dispatchEvent(new Event(target.event))
    }

    writeLastSyncedAt(now)
    dispatchSyncChanged()
  } catch (err) {
    console.warn("[sync] Pull failed:", err)
  }
}

export function retryFailedSync() {
  const queue = readQueue().map((op) =>
    op.status === "Failed" && op.attempts < MAX_ATTEMPTS
      ? { ...op, status: "Pending" as const, error: undefined }
      : op
  )
  writeQueue(queue)
  scheduleAutoFlush()
}

/**
 * Remove all Synced operations and dead (exhausted) operations from the queue.
 * Keeps only genuinely pending/failed ops that are still retryable.
 */
export function clearSyncQueue() {
  const queue = readQueue().filter(
    (op) => op.status !== "Synced" && op.attempts < MAX_ATTEMPTS
  )
  writeQueue(queue)
}

/**
 * Nuke everything in the queue — use when stuck ops need to be force-cleared.
 */
export function clearAllSyncOperations() {
  if (canUseStorage()) {
    window.localStorage.removeItem(SYNC_QUEUE_KEY)
  }
  dispatchSyncChanged()
}

export function subscribeSync(callback: () => void) {
  if (typeof window === "undefined") return () => undefined
  const onChange = () => callback()
  const onOnline  = () => { scheduleAutoFlush(); flushSyncQueue().then(() => pullFromServer()).catch(() => {}) }
  window.addEventListener(SYNC_EVENT,  onChange)
  window.addEventListener("storage",   onChange)
  window.addEventListener("online",    onChange)
  window.addEventListener("offline",   onChange)
  window.addEventListener("online",    onOnline)
  return () => {
    window.removeEventListener(SYNC_EVENT,  onChange)
    window.removeEventListener("storage",   onChange)
    window.removeEventListener("online",    onChange)
    window.removeEventListener("offline",   onChange)
    window.removeEventListener("online",    onOnline)
  }
}

const BACKGROUND_SYNC_MS = 30_000
const BACKGROUND_PULL_MS = 120_000
let bgSyncInterval: ReturnType<typeof setInterval> | undefined
let bgPullInterval: ReturnType<typeof setInterval> | undefined

export function setupBackgroundSync() {
  if (typeof window === "undefined") return
  stopBackgroundSync()
  bgSyncInterval = window.setInterval(() => {
    if (isBrowserOnline() && getApiUrl() && getAuthToken()) {
      flushSyncQueue().catch(() => {})
    }
  }, BACKGROUND_SYNC_MS)
  bgPullInterval = window.setInterval(() => {
    if (isBrowserOnline() && getApiUrl() && getAuthToken()) {
      // Always flush first, then pull — regardless of pending state
      flushSyncQueue().then(() => pullFromServer()).catch(() => {})
    }
  }, BACKGROUND_PULL_MS)
}

export function stopBackgroundSync() {
  if (bgSyncInterval) { clearInterval(bgSyncInterval); bgSyncInterval = undefined }
  if (bgPullInterval) { clearInterval(bgPullInterval); bgPullInterval = undefined }
  clearTimeout(autoFlushTimer)
}
