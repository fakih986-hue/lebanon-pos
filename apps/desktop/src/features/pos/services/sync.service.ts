import { putMany } from "./db"
import { writeLocalWithIndexedDB } from "./storage.service"
import { canUseStorage, createId } from "../lib/storage"

const SYNC_QUEUE_KEY = "lebanonpos.sync-queue.v1"
const LAST_SYNC_KEY  = "lebanonpos.sync-last.v1"
const SYNC_EVENT     = "lebanonpos-sync-changed"
const API_URL_KEY    = "lebanonpos.api-url"
const AUTH_TOKEN_KEY = "lebanonpos.auth-token"
const SUSPENDED_KEY  = "lebanonpos.suspended.v1"
const SUSPENDED_AT_KEY = "lebanonpos.suspended-at.v1"
const SUSPEND_EVENT  = "lebanonpos-suspended-changed"
const LICENSE_KEY    = "lebanonpos.license.v1"
const LICENSE_EVENT  = "lebanonpos-license-changed"

/** Operations that exceed this many attempts are considered permanently dead
 *  and stop counting as "pending" in the badge. */
const MAX_ATTEMPTS = 5

/** Mutex flags — prevent concurrent flush/pull from racing on the same localStorage keys */
let _flushing = false
let _pulling  = false

/**
 * Exponential backoff delay for a sync operation.
 * attempt=1 → 2s, attempt=2 → 4s, attempt=3 → 8s … capped at 5 minutes.
 */
function backoffMs(attempts: number): number {
  return Math.min(Math.pow(2, attempts) * 1000, 5 * 60 * 1000)
}

let _reachCached: boolean | undefined
let _reachCachedAt = 0
let _reachInflight: Promise<boolean> | null = null
const REACH_CACHE_TTL_MS = 30_000

/**
 * Invalidate the health-check cache so the next call re-pings the server.
 * Call this when a WebSocket message is received or the browser goes online.
 */
export function invalidateHealthCache(): void {
  _reachCachedAt = 0
}

/**
 * Real connectivity check — navigator.onLine returns true even when the server
 * is unreachable. This probes the actual API health endpoint instead.
 * Cached for REACH_CACHE_TTL_MS to avoid hammering /api/health on every cycle.
 */
async function isServerReachable(): Promise<boolean> {
  const now = Date.now()
  if (_reachCached !== undefined && now - _reachCachedAt < REACH_CACHE_TTL_MS) {
    return _reachCached
  }
  if (_reachInflight) return _reachInflight
  const apiUrl = getApiUrl()
  if (!apiUrl) return false
  _reachInflight = (async () => {
    try {
      const res = await fetch(`${apiUrl}/api/health`, { method: "HEAD", cache: "no-store" })
      _reachCached = res.ok
    } catch {
      _reachCached = false
    }
    _reachCachedAt = Date.now()
    _reachInflight = null
    return _reachCached
  })()
  return _reachInflight
}

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

const DELETE_TARGETS: Record<string, Array<{ key: string; event: string }>> = {
  product:          [PULL_TARGETS.products],
  sale:             [PULL_TARGETS.sales],
  refund:           [PULL_TARGETS.refunds],
  customer:         [PULL_TARGETS.customers],
  debt:             [PULL_TARGETS.debtSales, PULL_TARGETS.debtPayments],
  expense:          [PULL_TARGETS.expenses],
  "daily-close":    [PULL_TARGETS.dailyCloses],
  supplier:         [PULL_TARGETS.suppliers],
  "purchase-order": [PULL_TARGETS.purchaseOrders],
  "supplier-payment": [PULL_TARGETS.supplierPayments],
  staff:            [PULL_TARGETS.users],
  shift:            [PULL_TARGETS.shifts],
  inventory:        [PULL_TARGETS.batches, PULL_TARGETS.adjustments, PULL_TARGETS.stockCounts],
  "delivery-order": [PULL_TARGETS.deliveryOrders],
}

type PulledDeletion = {
  entity?: string
  id?: string | number
  saleNumber?: string
}

export function getApiUrl(): string | null {
  const raw = localStorage.getItem(API_URL_KEY)
  if (raw) return raw.replace(/\/+$/, "")
  // In Electron (the hub), default to the local API on this machine's own origin
  // so SPA → local Postgres → cloud bridge is the single data path with no setup.
  const electronUrl =
    typeof window !== "undefined"
      ? (window as { __LBPOS_API_URL__?: string }).__LBPOS_API_URL__
      : undefined
  if (electronUrl) return electronUrl.replace(/\/+$/, "")
  return raw
}
export function getAuthToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY)
}
export function setApiUrl(url: string) {
  localStorage.setItem(API_URL_KEY, url.trim().replace(/\/+$/, ""))
}
export function setAuthToken(token: string) {
  localStorage.setItem(AUTH_TOKEN_KEY, token)
  setupBackgroundSync()
}
export function clearAuthToken() {
  localStorage.removeItem(AUTH_TOKEN_KEY)
  stopBackgroundSync()
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
export async function clearStoreData() {
  for (const { key } of Object.values(PULL_TARGETS)) {
    localStorage.removeItem(key)
  }
  localStorage.removeItem(SYNC_QUEUE_KEY)
  localStorage.removeItem(LAST_SYNC_KEY)
  localStorage.removeItem(SUSPENDED_KEY)
  localStorage.removeItem(SUSPENDED_AT_KEY)
  localStorage.removeItem("lebanonpos.session.v1")
  localStorage.removeItem("lebanonpos.current-user.v1")
  localStorage.removeItem("lebanonpos.held-sales.v1")
  localStorage.removeItem("lebanonpos.license.v1")
  localStorage.removeItem("lebanonpos.simple-mode.v1")
  localStorage.removeItem("lebanonpos.pin-attempts.v1")
  // Also clear IndexedDB to prevent stale data accumulation across stores
  try { await clearIndexedDB() } catch (e) { console.error("[sync] clearIndexedDB failed:", e) }
}

/** Count pending sync operations that will be lost on store switch */
export function getUnsyncedCount(): number {
  try {
    const raw = localStorage.getItem(SYNC_QUEUE_KEY)
    if (!raw) return 0
    const queue = JSON.parse(raw)
    if (!Array.isArray(queue)) return 0
    return queue.filter((o: any) => o.status === "Pending" || o.status === "Failed").length
  } catch { return 0 }
}

// ── Suspension enforcement ──────────────────────────────────────────
export function isSuspended(): boolean {
  return localStorage.getItem(SUSPENDED_KEY) === "true"
}

export function getSuspendedAt(): string | null {
  return localStorage.getItem(SUSPENDED_AT_KEY)
}

const SUSPENSION_GRACE_DAYS = 15

export function isSuspensionGracePeriodExpired(): boolean {
  const suspendedAt = getSuspendedAt()
  if (!suspendedAt) return false
  const elapsed = Date.now() - new Date(suspendedAt).getTime()
  return elapsed > SUSPENSION_GRACE_DAYS * 24 * 60 * 60 * 1000
}

export function getSuspensionRemainingDays(): number {
  const suspendedAt = getSuspendedAt()
  if (!suspendedAt) return SUSPENSION_GRACE_DAYS
  const elapsed = Date.now() - new Date(suspendedAt).getTime()
  const remaining = SUSPENSION_GRACE_DAYS - Math.floor(elapsed / (24 * 60 * 60 * 1000))
  return Math.max(0, remaining)
}

function setSuspended(value: boolean) {
  const prev = localStorage.getItem(SUSPENDED_KEY)
  const next = value ? "true" : "false"
  if (prev !== next) {
    localStorage.setItem(SUSPENDED_KEY, next)
    // Track when suspension started for the grace period countdown
    if (value && !localStorage.getItem(SUSPENDED_AT_KEY)) {
      localStorage.setItem(SUSPENDED_AT_KEY, new Date().toISOString())
    } else if (!value) {
      localStorage.removeItem(SUSPENDED_AT_KEY)
    }
    if (typeof window !== "undefined") window.dispatchEvent(new Event(SUSPEND_EVENT))
  }
}

export async function checkTenantStatus(): Promise<boolean> {
  const apiUrl = getApiUrl()
  const token = getAuthToken()
  if (!apiUrl || !token) return isSuspended()
  try {
    const res = await fetch(`${apiUrl}/api/sync/status`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      if (res.status === 401) return isSuspended()
      throw new Error(`Status check failed: ${res.status}`)
    }
    const data = await res.json()
    // v2: store full license lease alongside legacy suspended flag
    storeLicenseLease(data)
    setSuspended(data.suspended === true)
    return data.suspended === true
  } catch {
    return isSuspended()
  }
}

export function subscribeSuspended(callback: (suspended: boolean) => void) {
  if (typeof window === "undefined") return () => undefined
  const onChange = () => callback(isSuspended())
  window.addEventListener(SUSPEND_EVENT, onChange)
  return () => window.removeEventListener(SUSPEND_EVENT, onChange)
}

// ── License / Remote-stop system (v2) ────────────────────────────────

export type LicenseStatus = "active" | "grace" | "suspended" | "read_only" | "recovery"

export interface LicenseLease {
  status: LicenseStatus
  reason: string
  message: string
  suspendedAt: string | null
  offlineGraceDays: number
  leaseExpiresAt: string | null
  policyVersion: number
  checkedAt: string
}

/** Store the license lease from the server status response */
function storeLicenseLease(data: {
  suspended: boolean
  licenseStatus?: string
  licenseReason?: string
  licenseMessage?: string
  suspendedAt?: string | null
  offlineGraceDays?: number
  leaseExpiresAt?: string | null
  policyVersion?: number
}) {
  // Backward compat: derive license status from legacy suspended flag
  const status: LicenseStatus = data.licenseStatus as LicenseStatus
    || (data.suspended ? "suspended" : "active")

  const lease: LicenseLease = {
    status,
    reason: data.licenseReason ?? "",
    message: data.licenseMessage ?? "",
    suspendedAt: data.suspendedAt ?? null,
    offlineGraceDays: data.offlineGraceDays ?? 7,
    leaseExpiresAt: data.leaseExpiresAt ?? null,
    policyVersion: data.policyVersion ?? 1,
    checkedAt: new Date().toISOString(),
  }

  localStorage.setItem(LICENSE_KEY, JSON.stringify(lease))
  // Keep legacy suspended key in sync for backward compat
  setSuspended(data.suspended === true)
  window.dispatchEvent(new Event(LICENSE_EVENT))
}

/** Get the last known license lease from local storage */
function getLicenseLease(): LicenseLease | null {
  try {
    const raw = localStorage.getItem(LICENSE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

/** Check if business writes should be blocked based on local license.
 *  ── Behavior matrix ──
 *  active + lease valid        → NOT blocked (full access)
 *  active + lease expired      → NOT blocked (recheck warning, still allows writes)
 *  suspended + within grace    → NOT blocked (writes allowed with warning)
 *  suspended + grace expired   → BLOCKED
 *  read_only                   → BLOCKED immediately
 *  recovery                    → BLOCKED for business writes
 */
export function isLicenseBlocked(): boolean {
  const lease = getLicenseLease()
  if (!lease) return false

  // read_only and recovery ALWAYS block — no grace period
  if (lease.status === "read_only" || lease.status === "recovery") return true

  // suspended with grace period: block only after grace expires
  if (lease.status === "suspended") {
    if (!lease.suspendedAt) return false // no timestamp → can't calculate grace → allow
    const elapsed = Date.now() - new Date(lease.suspendedAt).getTime()
    const graceMs = lease.offlineGraceDays * 24 * 60 * 60 * 1000
    return elapsed > graceMs
  }

  // active with expired lease → NOT blocked (recheck warning only)
  // lease expiry is advisory, not a hard lock — only suspension/read_only blocks writes

  return false
}

/** True if the tenant is in a grace period (shows warning but still allows writes) */
export function isLicenseGrace(): boolean {
  const lease = getLicenseLease()
  if (!lease) return false

  // suspended but within grace → show warning
  if (lease.status === "suspended" && lease.suspendedAt) {
    const elapsed = Date.now() - new Date(lease.suspendedAt).getTime()
    const graceMs = lease.offlineGraceDays * 24 * 60 * 60 * 1000
    return elapsed <= graceMs
  }

  // active but lease expired → show recheck warning
  if (lease.status === "active" && lease.leaseExpiresAt) {
    return Date.now() > new Date(lease.leaseExpiresAt).getTime()
  }

  return false
}

/** Days remaining in grace period (0 if expired or not in grace) */
export function getLicenseRemainingDays(): number {
  const lease = getLicenseLease()
  if (!lease || !lease.suspendedAt) return 0
  const elapsed = Date.now() - new Date(lease.suspendedAt).getTime()
  const remaining = lease.offlineGraceDays - Math.floor(elapsed / (24 * 60 * 60 * 1000))
  return Math.max(0, remaining)
}

/** Get the current license status (for UI display) */
export function getLicenseStatus(): LicenseLease | null {
  return getLicenseLease()
}

/**
 * Assert that business writes are allowed.
 * Call at the start of every business mutation.
 * Throws if blocked; logs warning if in grace.
 */
export function assertCanWrite(action: string): void {
  if (isLicenseBlocked()) {
    const lease = getLicenseLease()
    const msg = lease?.message || "This store is currently suspended. Please contact support."
    throw new Error(msg)
  }
  if (isLicenseGrace()) {
    console.warn(`[license] Grace period active — ${action} allowed with warning. Days remaining:`, getLicenseRemainingDays())
  }
}

async function clearIndexedDB() {
  try {
    const { openDB } = await import("idb")
    const db = await openDB("lebanonpos", undefined, {})
    const stores = Array.from(db.objectStoreNames)
    const tx = db.transaction(stores, "readwrite")
    await Promise.all(stores.map((name) => tx.objectStore(name).clear()))
    await tx.done
    db.close()
  } catch {
    // IndexedDB may not be available; ignore
  }
}

export type SyncEntity =
  | "sale" | "refund" | "product" | "customer" | "debt"
  | "expense" | "daily-close" | "supplier" | "purchase-order"
  | "supplier-payment" | "staff" | "shift" | "inventory" | "settings"
  | "delivery-order" | "held-sale"

export type SyncAction =
  | "create" | "update" | "delete" | "receive"
  | "payment" | "close" | "open" | "adjust" | "count" | "void"

export type SyncOperationStatus = "Pending" | "Synced" | "Failed" | "Rejected"

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

function dispatchOperationRejected(op: SyncOperation) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("sync:operation-rejected", { detail: op }))
  }
}

function isBrowserOnline() {
  return typeof navigator === "undefined" ? true : navigator.onLine
}

/**
 * Try to refresh the JWT token via the hub's auto-login endpoint.
 * Only works on the hub machine (localhost). Returns true on success.
 */
async function tryRefreshHubToken(): Promise<boolean> {
  const apiUrl = getApiUrl()
  if (!apiUrl) return false
  try {
    const hostname = new URL(apiUrl).hostname
    if (hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "::1") {
      return false // LAN clients can't auto-login
    }
    const res = await fetch(`${apiUrl}/api/setup/auto-login`, { method: "POST" })
    if (!res.ok) return false
    const { token } = await res.json()
    if (!token) return false
    setAuthToken(token)
    return true
  } catch {
    return false
  }
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
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000

  // Separate pending/failed (must keep) from synced (purgeable)
  const retryable = queue.filter((op) => op.status !== "Synced" && op.attempts < MAX_ATTEMPTS)
  const dead = queue
    .filter((op) => op.status !== "Synced" && op.attempts >= MAX_ATTEMPTS)
    .slice(0, 100)
  const active  = [...retryable, ...dead]
  const synced  = queue
    .filter((op) => op.status === "Synced" && new Date(op.createdAt).getTime() >= cutoff)
    .slice(0, Math.max(0, 300 - active.length))   // fill remaining budget with recent synced

  // Active ops always survive; synced ops fill the rest — new ops are NEVER silently dropped
  const trimmed = [...active, ...synced]

  try {
    window.localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(trimmed))
  } catch (e) {
    console.error("[sync] failed to persist sync queue:", e)
  }
  putMany("sync-queue", trimmed).catch((e) => console.error("[sync] sync-queue write failed:", e))
  dispatchSyncChanged()
}

function readLastSyncedAt() {
  if (!canUseStorage()) return undefined
  return window.localStorage.getItem(LAST_SYNC_KEY) ?? undefined
}

function writeLastSyncedAt(value: string) {
  if (canUseStorage()) window.localStorage.setItem(LAST_SYNC_KEY, value)
}

function matchesDeletion(item: unknown, deletion: PulledDeletion): boolean {
  if (!item || typeof item !== "object") return false
  const record = item as Record<string, unknown>
  const id = deletion.id
  const saleNumber = deletion.saleNumber
  return (
    (id !== undefined && String(record.id) === String(id)) ||
    (saleNumber !== undefined && String(record.saleNumber) === String(saleNumber))
  )
}

function applyPulledDeletions(deletions: PulledDeletion[]) {
  if (!canUseStorage() || deletions.length === 0) return

  const changedEvents = new Set<string>()

  for (const deletion of deletions) {
    if (!deletion.entity || (deletion.id === undefined && deletion.saleNumber === undefined)) continue

    for (const target of DELETE_TARGETS[deletion.entity] ?? []) {
      const raw = window.localStorage.getItem(target.key)
      if (!raw) continue

      try {
        const local = JSON.parse(raw)
        if (!Array.isArray(local)) continue
        const next = local.filter((item) => !matchesDeletion(item, deletion))
        if (next.length === local.length) continue

        writeLocalWithIndexedDB(target.key, next)
        changedEvents.add(target.event)
      } catch {
        // Ignore malformed local storage; the next full pull can repair it.
      }
    }
  }

  for (const event of changedEvents) {
    window.dispatchEvent(new Event(event))
  }
}

function scheduleAutoFlush() {
  if (typeof window === "undefined") return
  window.clearTimeout(autoFlushTimer)
  // Short debounce — actual reachability check happens inside _flushSyncQueue
  autoFlushTimer = window.setTimeout(() => { flushSyncQueue().catch((e) => console.error("[sync] auto-flush failed:", e)) }, 900)
}

export function getSyncQueue() { return readQueue() }

export function getSyncStatus(): SyncStatus {
  const queue = readQueue()
  const recentErrors: string[] = []

  let pending = 0, failed = 0, dead = 0, synced = 0

  for (const op of queue) {
    if (op.status === "Synced") {
      synced++
    } else if (op.status === "Rejected" || op.attempts >= MAX_ATTEMPTS) {
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

export async function enqueueSyncOperation(input: EnqueueSyncInput) {
  if (!canUseStorage()) return undefined

  // License check — block business writes when license is suspended/expired
  if (isLicenseBlocked()) {
    console.warn("[sync] License blocked — skipping enqueue:", input.entity, input.action)
    return undefined
  }

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
  
  // Write-through: try to push to hub API immediately
  // This makes the hub the single authority — no local-first conflicts
  const apiUrl = getApiUrl()
  const token = getAuthToken()
  if (apiUrl && token && !isSuspended()) {
    try {
      const response = await fetch(`${apiUrl}/api/sync/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ operations: [{ id: operation.id, entity: operation.entity, action: operation.action, payload: operation.payload }] }),
        signal: AbortSignal.timeout(5_000),
      })
      if (response.ok) {
        const body = await response.json().catch(() => ({ results: [] as any[] }))
        const result = body.results?.find((r: { id: string }) => r.id === operation.id)
        if (result?.status === "rejected") {
          const rejected = { ...operation, status: "Rejected" as const, attempts: 5, lastAttemptAt: new Date().toISOString(), error: result.error ?? "Rejected by server" }
          writeQueue(getSyncQueue().map((op) => op.id === operation.id ? rejected : op))
          dispatchOperationRejected(rejected)
          dispatchSyncChanged()
          return operation
        }
        if (!result || result.status === "ok") {
          writeQueue(getSyncQueue().map((op) => op.id === operation.id ? { ...op, status: "Synced" as const } : op))
          dispatchSyncChanged()
          return operation
        }
      }
    } catch {
      // Hub unreachable — stays in local queue for background retry
    }
  }
  
  scheduleAutoFlush()
  return operation
}

export async function flushSyncQueue() {
  if (_flushing) return { synced: 0, skipped: 0 }
  _flushing = true
  try {
    return await _flushSyncQueue()
  } finally {
    _flushing = false
  }
}

async function _flushSyncQueue() {
  if (isSuspended()) return { synced: 0, skipped: 0 }

  const queue = readQueue()
  const apiUrl = getApiUrl()
  const token = getAuthToken()

  if (!apiUrl || !token) {
    dispatchSyncChanged()
    return { synced: 0, skipped: queue.filter((op) => op.status === "Pending").length }
  }

  if (!(await isServerReachable())) {
    dispatchSyncChanged()
    return { synced: 0, skipped: queue.filter((op) => op.status !== "Synced" && op.attempts < MAX_ATTEMPTS).length }
  }

  // Only try operations that are Pending/Failed, haven't exceeded max attempts,
  // AND whose backoff window has elapsed. Rejected ops are never retried.
  const now = Date.now()
  const pending = queue.filter((op) => {
    if (op.status === "Synced" || op.status === "Rejected") return false
    if (op.attempts >= MAX_ATTEMPTS) return false
    if (op.status === "Failed" && op.lastAttemptAt) {
      const elapsed = now - new Date(op.lastAttemptAt).getTime()
      if (elapsed < backoffMs(op.attempts)) return false
    }
    return true
  })

  if (pending.length === 0) {
    dispatchSyncChanged()
    return { synced: 0, skipped: 0 }
  }

  // Send oldest-first so dependent operations (e.g., product created before
  // a sale referencing it) are processed in the correct order by the API.
  pending.reverse()

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
      // If 401 — token expired
      if (response.status === 401) {
        // On the hub (localhost), try to refresh the token via auto-login
        if (await tryRefreshHubToken()) {
          // Retry flush with fresh token
          return await _flushSyncQueue()
        }
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
      if (syncResult?.status === "rejected") {
        dispatchOperationRejected({ ...op, status: "Rejected", attempts: 5, lastAttemptAt: now, error: syncResult.error ?? "Rejected by server" })
        return { ...op, status: "Rejected" as const, attempts: 5, lastAttemptAt: now, error: syncResult.error ?? "Rejected by server" }
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
  if (_pulling) return
  _pulling = true
  try {
    await _pullFromServer(full)
  } finally {
    _pulling = false
  }
}

// Map PULL_TARGETS keys to API entity paths for per-entity full pull
const FULL_PULL_ENTITY_MAP: Record<string, string> = {
  products: "products",
  sales: "sales",
  refunds: "refunds",
  customers: "customers",
  debtSales: "debt-sales",
  debtPayments: "debt-payments",
  suppliers: "suppliers",
  purchaseOrders: "purchase-orders",
  supplierPayments: "supplier-payments",
  batches: "batches",
  adjustments: "adjustments",
  stockCounts: "stock-counts",
  dailyCloses: "daily-closes",
  deliveryOrders: "delivery-orders",
  expenses: "expenses",
  users: "users",
  shifts: "shifts",
  auditEvents: "audit-events",
}

async function pullFullEntity(apiUrl: string, token: string, entityPath: string, target: { key: string; event: string }): Promise<void> {
  let cursor: string | undefined
  const all: any[] = []
  while (true) {
    const params = new URLSearchParams({ limit: "5000" })
    if (cursor) params.set("cursor", cursor)
    const res = await fetch(`${apiUrl}/api/sync/pull/full/${entityPath}?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`Pull ${entityPath} failed: ${res.status}`)
    const page = await res.json()
    const arr = Array.isArray(page.items) ? page.items : []
    all.push(...arr)
    if (!page.hasMore) break
    cursor = page.nextCursor ? String(page.nextCursor) : undefined
    if (!cursor) break
  }
  writeLocalWithIndexedDB(target.key, all)
  window.dispatchEvent(new Event(target.event))
}

async function _pullFromServer(full = false) {
  if (isSuspended()) return

  const apiUrl = getApiUrl()
  const token = getAuthToken()
  if (!apiUrl || !token) return

  try {
    const now = new Date().toISOString()

    if (full) {
      // Snapshot local user pins before full pull — the server stores
      // bcrypt hashes which are useless for offline SHA-256 matching
      const usersTarget = PULL_TARGETS.users
      const priorPins: Record<string, string> = {}
      const priorVerifiedVersions: Record<string, number> = {}
      if (usersTarget) {
        const raw = localStorage.getItem(usersTarget.key)
        if (raw) {
          try {
            const local = JSON.parse(raw)
            if (Array.isArray(local)) {
              for (const u of local) {
                if (u?.id && u?.pin && !String(u.pin).startsWith("$2")) {
                  priorPins[u.id] = u.pin
                }
                if (u?.id && u?.lastVerifiedPinVersion) {
                  priorVerifiedVersions[u.id] = u.lastVerifiedPinVersion
                }
              }
            }
          } catch { /* ignore corrupt data */ }
        }
      }

      for (const [key, target] of Object.entries(PULL_TARGETS)) {
        const entityPath = FULL_PULL_ENTITY_MAP[key]
        if (entityPath) {
          await pullFullEntity(apiUrl, token, entityPath, target)
        }
      }

      // Restore local SHA-256 pins + update pinVersion from server
      if (usersTarget) {
        const raw = localStorage.getItem(usersTarget.key)
        if (raw) {
          try {
            const users = JSON.parse(raw)
            if (Array.isArray(users)) {
              let changed = false
              for (const u of users) {
                // Restore SHA-256 pin if server returned bcrypt
                if (u?.id && priorPins[u.id] && String(u.pin ?? "").startsWith("$2")) {
                  u.pin = priorPins[u.id]
                  changed = true
                }
                // Update pinVersion from server (authoritative source)
                if (u?.id && typeof u.pinVersion === "number") {
                  // pinVersion is already set from server pull
                }
                // Restore lastVerifiedPinVersion from before pull
                if (u?.id && priorVerifiedVersions[u.id]) {
                  u.lastVerifiedPinVersion = priorVerifiedVersions[u.id]
                  changed = true
                }
              }
              if (changed) {
                localStorage.setItem(usersTarget.key, JSON.stringify(users))
                window.dispatchEvent(new Event(usersTarget.event))
              }
            }
          } catch { /* ignore */ }
        }
      }
      // Fetch settings as a single-page entity
      {
        const res = await fetch(`${apiUrl}/api/sync/pull/full/settings?limit=1`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (res.ok) {
          const page = await res.json()
          const arr = Array.isArray(page.items) ? page.items : []
          const target = PULL_TARGETS["settings"]
          if (target && arr.length > 0) {
            writeLocalWithIndexedDB(target.key, arr)
            window.dispatchEvent(new Event(target.event))
          }
        }
      }
      // Fetch deletions with pagination (can be many tombstones)
      {
        let delCursor: string | undefined
        const allDeletions: any[] = []
        while (true) {
          const params = new URLSearchParams({ limit: "5000" })
          if (delCursor) params.set("cursor", delCursor)
          const res = await fetch(`${apiUrl}/api/sync/pull/full/deletions?${params}`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (!res.ok) break
          const page = await res.json()
          const arr = Array.isArray(page.items) ? page.items : []
          allDeletions.push(...arr)
          if (!page.hasMore) break
          delCursor = page.nextCursor ? String(page.nextCursor) : undefined
          if (!delCursor) break
        }
        if (allDeletions.length > 0) {
          applyPulledDeletions(allDeletions.map((d: any) => ({
            entity: d.entity,
            id: d.payload?.id,
            saleNumber: d.payload?.saleNumber,
            deletedAt: d.createdAt,
          })))
        }
      }
      writeLastSyncedAt(now)
      dispatchSyncChanged()
    } else {
      await _incrementalPull(apiUrl, token)
    }
  } catch (err) {
    console.warn("[sync] Pull failed:", err)
  }

}

async function _incrementalPull(apiUrl: string, token: string): Promise<void> {
  const lastSync = readLastSyncedAt()
  const url = lastSync
    ? `${apiUrl}/api/sync/pull?since=${encodeURIComponent(lastSync)}`
    : `${apiUrl}/api/sync/pull`

  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) throw new Error(`Sync pull failed: ${response.status}`)

  const data = await response.json()
  applyPulledDeletions(Array.isArray(data.deletions) ? data.deletions : [])

  for (const [key, value] of Object.entries(data)) {
    const target = PULL_TARGETS[key]
    if (!target || value === null || value === undefined) continue
    const arr = Array.isArray(value) ? value : [value]
    if (arr.length === 0) continue
    if ((arr[0] as any)?.id === undefined) {
      writeLocalWithIndexedDB(target.key, arr)
      window.dispatchEvent(new Event(target.event))
      continue
    }
    const raw = window.localStorage.getItem(target.key)
    if (raw) {
      try {
        const local = JSON.parse(raw)
        if (Array.isArray(local) && local.length > 0) {
          const merged = local.slice()
          for (const item of arr) {
            if (item && typeof item.id !== "undefined") {
              const idx = merged.findIndex((e) => e.id === item.id)
              if (idx >= 0) {
                // ── Preserve local SHA-256 pins during merge ─────────
                // The server stores bcrypt hashes which are useless for
                // offline SHA-256 matching. If the local user has a
                // SHA-256 pin (doesn't start with "$2"), keep it.
                const localPin =
                  key === "users" && !String(merged[idx].pin ?? "").startsWith("$2")
                    ? merged[idx].pin
                    : undefined
                const localVerifiedVersion =
                  key === "users" ? merged[idx].lastVerifiedPinVersion : undefined
                merged[idx] = item
                if (localPin !== undefined) merged[idx].pin = localPin
                if (localVerifiedVersion !== undefined) merged[idx].lastVerifiedPinVersion = localVerifiedVersion
              } else merged.push(item)
            }
          }
          if (key === "products" && arr.length > 0) {
            const serverBarcodes = new Map<string, Set<number>>()
            for (const item of arr) {
              if (item?.barcode && typeof item.id !== "undefined") {
                const bc = String(item.barcode)
                if (!serverBarcodes.has(bc)) serverBarcodes.set(bc, new Set())
                serverBarcodes.get(bc)!.add(item.id)
              }
            }
            if (serverBarcodes.size > 0) {
              const deduped: typeof merged = []
              for (const item of merged) {
                if (item?.barcode && serverBarcodes.has(String(item.barcode))) {
                  const validIds = serverBarcodes.get(String(item.barcode))!
                  if (validIds.has(item.id)) deduped.push(item)
                } else {
                  deduped.push(item)
                }
              }
              merged.splice(0, merged.length, ...deduped)
            }
          }
          writeLocalWithIndexedDB(target.key, merged)
          window.dispatchEvent(new Event(target.event))
          continue
        }
      } catch { /* fall through to write directly */ }
    }
    writeLocalWithIndexedDB(target.key, arr)
    window.dispatchEvent(new Event(target.event))
  }

  const cursorTime = data.serverTime ?? data.lastSyncAt ?? new Date().toISOString()
  writeLastSyncedAt(cursorTime)
  dispatchSyncChanged()
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
  const onOnline  = () => { invalidateHealthCache(); scheduleAutoFlush(); flushSyncQueue().then(() => pullFromServer()).catch((e) => console.error("[sync] online flush failed:", e)) }
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

const BACKGROUND_SYNC_MS = 5_000
const BACKGROUND_PULL_MS = 10_000
const BACKGROUND_STATUS_MS = 300_000
let bgSyncInterval: ReturnType<typeof setInterval> | undefined
let bgPullInterval: ReturnType<typeof setInterval> | undefined
let bgStatusInterval: ReturnType<typeof setInterval> | undefined
let wsClient: WebSocket | null = null
let wsReconnectTimer: ReturnType<typeof setTimeout> | undefined
let wsReconnectAttempts = 0
const WS_MAX_RETRIES = 30
const WS_RETRY_BASE_MS = 5000

export function setupBackgroundSync() {
  if (typeof window === "undefined") return
  stopBackgroundSync()
  // Connect WebSocket for instant push notifications
  connectSyncWebSocket()
  // Immediately check tenant status on startup
  checkTenantStatus().catch((e) => console.error("[sync] tenant status check failed:", e))
  bgStatusInterval = window.setInterval(() => {
    if (isBrowserOnline() && getApiUrl() && getAuthToken()) {
      checkTenantStatus().catch((e) => console.error("[sync] tenant status check failed:", e))
    }
  }, BACKGROUND_STATUS_MS)
  bgSyncInterval = window.setInterval(() => {
    if (isBrowserOnline() && getApiUrl() && getAuthToken()) {
      if (!isSuspended()) flushSyncQueue().catch((e) => console.error("[sync] flush failed:", e))
    }
  }, BACKGROUND_SYNC_MS)
  bgPullInterval = window.setInterval(() => {
    if (isBrowserOnline() && getApiUrl() && getAuthToken()) {
      if (!isSuspended()) flushSyncQueue().then(() => pullFromServer()).catch((e) => console.error("[sync] pull failed:", e))
    }
  }, BACKGROUND_PULL_MS)
}

export function stopBackgroundSync() {
  disconnectSyncWebSocket()
  if (bgSyncInterval) { clearInterval(bgSyncInterval); bgSyncInterval = undefined }
  if (bgPullInterval) { clearInterval(bgPullInterval); bgPullInterval = undefined }
  if (bgStatusInterval) { clearInterval(bgStatusInterval); bgStatusInterval = undefined }
  clearTimeout(autoFlushTimer)
}

// ── WebSocket for instant cross-device sync ──────────────────────────

function connectSyncWebSocket() {
  disconnectSyncWebSocket()
  const apiUrl = getApiUrl()
  const token = getAuthToken()
  if (!apiUrl || !token) return

  try {
    const wsUrl = apiUrl.replace(/^http/, "ws") + "/ws"
    wsClient = new WebSocket(wsUrl)

    wsClient.onopen = () => {
      // Authenticate with JWT
      wsReconnectAttempts = 0
      wsClient?.send(JSON.stringify({ type: "auth", token }))
    }

    wsClient.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === "auth:ok") {
          invalidateHealthCache()
          flushSyncQueue().then(() => pullFromServer()).catch((e) => console.error("[ws-sync] reconnect pull failed:", e))
        }
        if (msg.type === "sync:data-changed") {
          invalidateHealthCache()
          // Data changed on another device — pull immediately
          if (getApiUrl() && getAuthToken()) {
            pullFromServer().catch((e) => console.error("[ws-sync] pull failed:", e))
          }
        }
      } catch { /* ignore parse errors */ }
    }

    wsClient.onclose = () => {
      wsClient = null
      if (getAuthToken() && wsReconnectAttempts < WS_MAX_RETRIES) {
        wsReconnectAttempts++
        clearTimeout(wsReconnectTimer)
        // Try to refresh token on hub before reconnecting
        tryRefreshHubToken().catch(() => {})
        wsReconnectTimer = setTimeout(connectSyncWebSocket, WS_RETRY_BASE_MS * Math.min(wsReconnectAttempts, 6))
      }
    }

    wsClient.onerror = () => {
      // onclose will fire and handle reconnection
    }
  } catch (e) {
    console.error("[ws] connection failed:", e)
  }
}

function disconnectSyncWebSocket() {
  clearTimeout(wsReconnectTimer)
  wsReconnectAttempts = 0
  if (wsClient) {
    wsClient.onclose = null // prevent reconnect
    wsClient.close()
    wsClient = null
  }
}

// ── Emergency Recovery Export ──────────────────────────────────────
// Available in ALL license states (active, grace, suspended, read_only).
// Exports all local data without mutation. PINs are masked.
// Downloadable as a JSON file for offline backup/recovery.

export interface RecoveryPack {
  exportedAt: string
  store: {
    apiUrl: string | null
    cloudUrl?: string
    tenantName?: string
    subdomain?: string
    hasAuthToken: boolean
    hasCloudKey: boolean
  }
  license: LicenseLease | null
  sync: {
    queuePending: number
    queueFailed: number
    lastSyncAt: string | null
    isSuspended: boolean
  }
  data: Record<string, unknown>
  users: Array<{ id: string; name: string; role: string; active: boolean; pinMasked: string }>
}

export function createRecoveryPack(): RecoveryPack {
  const apiUrl = getApiUrl()
  const token = getAuthToken()
  const license = getLicenseLease()
  const queue = getSyncQueue()
  const lastSyncAt = typeof localStorage !== "undefined" ? localStorage.getItem(LAST_SYNC_KEY) : null

  // Collect all local data (skip raw sync operations, tokens, keys)
  const dataKeys = [
    "lebanonpos.products.v1", "lebanonpos.sales.v1",
    "lebanonpos.customers.v1", "lebanonpos.suppliers.v1",
    "lebanonpos.debt-sales.v1", "lebanonpos.debt-payments.v1",
    "lebanonpos.expenses.v1", "lebanonpos.daily-closes.v1",
    "lebanonpos.shifts.v1", "lebanonpos.settings.v1",
    "lebanonpos.inventory-batches.v1", "lebanonpos.inventory-adjustments.v1",
    "lebanonpos.held-sales.v1", "lebanonpos.delivery-orders.v1",
  ]

  const data: Record<string, unknown> = {}
  if (typeof localStorage !== "undefined") {
    for (const key of dataKeys) {
      try {
        const raw = localStorage.getItem(key)
        if (raw) data[key] = JSON.parse(raw)
      } catch { /* skip corrupt keys */ }
    }
  }

  // Redact user PINs
  const usersRaw = typeof localStorage !== "undefined"
    ? localStorage.getItem("lebanonpos.users.v1") : null
  const users = usersRaw ? (() => {
    try {
      const arr = JSON.parse(usersRaw)
      if (!Array.isArray(arr)) return []
      return arr.map((u: any) => ({
        id: u.id ?? "",
        name: u.name ?? "Unknown",
        role: u.role ?? "Cashier",
        active: u.active !== false,
        pinMasked: u.pin ? `SHA256:${String(u.pin).substring(0, 10)}...` : "none",
      }))
    } catch { return [] }
  })() : []

  return {
    exportedAt: new Date().toISOString(),
    store: {
      apiUrl,
      tenantName: undefined,
      subdomain: undefined,
      hasAuthToken: !!token,
      hasCloudKey: !!localStorage.getItem("lebanonpos.cloud-key"),
    },
    license,
    sync: {
      queuePending: queue.filter((o: any) => o.status === "Pending").length,
      queueFailed: queue.filter((o: any) => o.status === "Failed").length,
      lastSyncAt,
      isSuspended: isSuspended(),
    },
    data,
    users,
  }
}

/** Trigger download of the recovery pack as a JSON file */
export function downloadRecoveryPack(): void {
  const pack = createRecoveryPack()
  const json = JSON.stringify(pack, null, 2)
  const blob = new Blob([json], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `lebanonpos-recovery-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}
