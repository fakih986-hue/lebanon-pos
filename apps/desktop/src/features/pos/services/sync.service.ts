import { putMany } from "./db"
import { writeLocalWithIndexedDB } from "./storage.service"
import { canUseStorage, createId } from "../lib/storage"
import type { ConnectionMode } from "./settings.service"

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
const CONNECTION_MODE_KEY = "lebanonpos.connection-mode.v1"
const CONNECTION_MODE_EVENT = "lebanonpos-connection-mode-changed"

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

// REFUND-INTEGRITY-1: this client understands sale line ids, sale lot
// allocations and refund rates; servers omit them for older clients.
const SYNC_SCHEMA_HEADERS = { "x-titan-sync-schema": "2" }

/**
 * A rejected refund (or void) is a money conflict: the customer may already
 * have been paid. Its queue entry is the durable record of the conflict and
 * must survive "clear stuck"/"remove" until a manager settles it
 * (refundConflict.service), so it is never silently discarded.
 */
export function isMoneyConflictOperation(op: Pick<SyncOperation, "entity" | "action" | "status" | "payload">) {
  if (op.status !== "Rejected") return false
  if ((op.entity === "refund" && op.action === "create") || (op.entity === "sale" && op.action === "void")) return true
  // A rejected settlement entry (the expense / cash movement / credit that
  // settles a conflict) is just as important: the conflict is not settled on
  // the server until it is accepted.
  return isSettlementEntryOperation(op)
}

/** Operations created by refundConflict.service when settling a conflict. */
export function isSettlementEntryOperation(op: Pick<SyncOperation, "payload">) {
  const id = (op.payload as { id?: unknown } | undefined)?.id
  return typeof id === "string" && id.startsWith("settle-")
}

// ── Money conflicts across store switches ─────────────────────────────────
// Switching stores wipes the previous store's local data. Open money
// conflicts (and settlement entries not yet accepted, settlement records and
// local-only refund credits) are stashed per store first and restored when
// this device connects to that store again, so they are never lost.
const MONEY_CONFLICT_STASH_KEY = "lebanonpos.money-conflict-stash.v1"
const MONEY_CONFLICT_SETTLEMENTS_KEY = "lebanonpos.money-conflict-settlements.v1"
const REFUND_JOURNAL_KEY = "lebanonpos.refund-journal.v1"

// Stash entries are keyed by the immutable tenant id. A store subdomain alone
// never restores anything: two tenants can share a subdomain on different
// servers, and a subdomain can be reassigned. If the tenant is unknown (no
// token was ever decoded on this device) the entry is kept under an "unbound"
// key that is never restored automatically: kept, not guessed.
function currentStoreStashKey(): string {
  const tenantId = getCurrentTenantId()
  if (tenantId) return `tenant:${tenantId}`
  let subdomain = ""
  try {
    const raw = localStorage.getItem("lebanonpos.settings.v1")
    const settings = raw ? JSON.parse(raw) : null
    subdomain = String((Array.isArray(settings) ? settings[0]?.subdomain : settings?.subdomain) ?? "")
  } catch { /* none */ }
  return `unbound:${(getApiUrl() ?? "none").toLowerCase()}|${subdomain.toLowerCase()}|${Date.now()}`
}

type MoneyConflictStash = {
  tenantId: string | null
  ops: SyncOperation[]
  refunds: any[]
  debtCredits: any[]
  settlements: any[]
  refundJournal: any[]
  stashedAt: string
}

/** Stashed money conflicts held on this device, per tenant (or unbound). */
export function getStashedMoneyConflictSummary(): Array<{ key: string; tenantId: string | null; conflicts: number; stashedAt: string }> {
  return Object.entries(readStash()).map(([key, entry]) => ({
    key, tenantId: entry.tenantId ?? null, conflicts: (entry.ops ?? []).filter(isMoneyConflictOperation).length, stashedAt: entry.stashedAt,
  }))
}

function readJsonArray(key: string): any[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "[]")
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

function readStash(): Record<string, MoneyConflictStash> {
  try { return JSON.parse(localStorage.getItem(MONEY_CONFLICT_STASH_KEY) ?? "{}") ?? {} } catch { return {} }
}

/** Called by clearStoreData before it wipes the store's local data. */
export function stashMoneyConflictsForStore(): number {
  // Every operation the server has not accepted yet travels with its tenant:
  // open money conflicts, unsent settlement entries, and any other pending or
  // failed work (a store switch while offline used to discard it). Restored
  // only to the same tenant, where it is pushed again.
  const ops = readQueue().filter((op) => isMoneyConflictOperation(op) || op.status !== "Synced")
  const refundIds = new Set(ops.filter((op) => op.entity === "refund").map((op) => (op.payload as { id?: string })?.id))
  const refunds = readJsonArray("lebanonpos.refunds.v1").filter((r) => refundIds.has(r?.id) || r?.conflict)
  const debtCredits = readJsonArray("lebanonpos.debt-payments.v1").filter((p) => p?.localOnly)
  const settlements = readJsonArray(MONEY_CONFLICT_SETTLEMENTS_KEY)
  // Interrupted refunds are recovered in their own store before a switch (see
  // clearStoreData); anything still journaled travels with its tenant and is
  // never replayed against another tenant's stock.
  const refundJournal = readJsonArray(REFUND_JOURNAL_KEY)
  localStorage.removeItem(REFUND_JOURNAL_KEY)
  if (ops.length + refunds.length + debtCredits.length + settlements.length + refundJournal.length === 0) return 0
  const stash = readStash()
  const key = currentStoreStashKey()
  const prior = stash[key]
  const byId = (a: any[], b: any[]) => [...b, ...a.filter((x) => !b.some((y) => y?.id === x?.id || (y?.opId && y.opId === x?.opId)))]
  stash[key] = {
    tenantId: getCurrentTenantId(),
    refundJournal: [...(prior?.refundJournal ?? []).filter((e: any) => !refundJournal.some((n: any) => n?.refundId === e?.refundId)), ...refundJournal],
    ops: byId(prior?.ops ?? [], ops),
    refunds: byId(prior?.refunds ?? [], refunds),
    debtCredits: byId(prior?.debtCredits ?? [], debtCredits),
    settlements: byId(prior?.settlements ?? [], settlements),
    stashedAt: new Date().toISOString(),
  }
  localStorage.setItem(MONEY_CONFLICT_STASH_KEY, JSON.stringify(stash))
  localStorage.removeItem(MONEY_CONFLICT_SETTLEMENTS_KEY)
  return ops.length
}

/** Call after connecting to a store (settings pulled). Returns open conflicts restored. */
export function restoreStashedMoneyConflicts(): number {
  const tenantId = getCurrentTenantId()
  if (!tenantId) return 0
  const stash = readStash()
  const key = `tenant:${tenantId}`
  const entry = stash[key]
  if (!entry || (entry.tenantId && entry.tenantId !== tenantId)) return 0
  const queue = readQueue()
  // The stash is the only copy of these operations: keep it unless they are really back in the queue.
  if (!writeQueue([...queue, ...entry.ops.filter((op) => !queue.some((q) => q.id === op.id))])) return 0
  const merge = (storageKey: string, rows: any[]) => {
    if (rows.length === 0) return
    const current = readJsonArray(storageKey)
    localStorage.setItem(storageKey, JSON.stringify([...rows.filter((r) => !current.some((c) => c?.id === r?.id)), ...current]))
  }
  merge("lebanonpos.refunds.v1", entry.refunds)
  merge("lebanonpos.debt-payments.v1", entry.debtCredits)
  const settlements = readJsonArray(MONEY_CONFLICT_SETTLEMENTS_KEY)
  localStorage.setItem(MONEY_CONFLICT_SETTLEMENTS_KEY, JSON.stringify([...entry.settlements.filter((s) => !settlements.some((c) => c?.opId === s?.opId)), ...settlements]))
  if (entry.refundJournal?.length) {
    const journal = readJsonArray(REFUND_JOURNAL_KEY)
    localStorage.setItem(REFUND_JOURNAL_KEY, JSON.stringify([...journal, ...entry.refundJournal.filter((e: any) => !journal.some((j: any) => j?.refundId === e?.refundId))]))
  }
  delete stash[key]
  localStorage.setItem(MONEY_CONFLICT_STASH_KEY, JSON.stringify(stash))
  dispatchSyncChanged()
  window.dispatchEvent(new Event("lebanonpos-refunds-changed"))
  return entry.ops.filter(isMoneyConflictOperation).length
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
  cashMovements:    { key: "lebanonpos.cash-movements.v1",        event: "lebanonpos-cash-movements-changed" },
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
  "cash-movement":  [PULL_TARGETS.cashMovements],
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
  const tenantId = tenantIdFromToken(token)
  if (tenantId) localStorage.setItem(TENANT_ID_KEY, tenantId)
  setupBackgroundSync()
}

// The immutable identity of the tenant whose data is on this device. A store
// subdomain or URL can be renamed, reused or point at a different server (hub
// vs cloud); the tenant id inside the server-issued token cannot. Persisted
// separately so it survives a logout that clears the token.
const TENANT_ID_KEY = "lebanonpos.tenant-id.v1"
function tenantIdFromToken(token: string | null): string | null {
  if (!token) return null
  try {
    const part = token.split(".")[1]
    if (!part) return null
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=")))
    return typeof json?.tenantId === "string" && json.tenantId ? json.tenantId : null
  } catch { return null }
}
export function getCurrentTenantId(): string | null {
  return tenantIdFromToken(getAuthToken()) ?? localStorage.getItem(TENANT_ID_KEY)
}
export function clearAuthToken() {
  localStorage.removeItem(AUTH_TOKEN_KEY)
  stopBackgroundSync()
}

// ── Connection mode ──────────────────────────────────────────────────

const CONNECTION_MODES: ConnectionMode[] = ["STORE_HUB", "CONNECT_TO_HUB", "DIRECT_RAILWAY"]

export function getConnectionMode(): ConnectionMode {
  const saved = localStorage.getItem(CONNECTION_MODE_KEY) as ConnectionMode | null
  if (saved && CONNECTION_MODES.includes(saved)) return saved

  const apiUrl = getApiUrl()
  if (!apiUrl) return "DIRECT_RAILWAY"

  if (apiUrl.includes("localhost") || apiUrl.includes("127.0.0.1") || apiUrl.includes("::1")) {
    return "STORE_HUB"
  }
  if (/^https?:\/\/(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(apiUrl)) {
    return "CONNECT_TO_HUB"
  }
  return "DIRECT_RAILWAY"
}

export function setConnectionMode(mode: ConnectionMode): void {
  localStorage.setItem(CONNECTION_MODE_KEY, mode)
  window.dispatchEvent(new Event(CONNECTION_MODE_EVENT))
}

export function subscribeConnectionMode(callback: (mode: ConnectionMode) => void) {
  if (typeof window === "undefined") return () => undefined
  const handler = () => callback(getConnectionMode())
  window.addEventListener(CONNECTION_MODE_EVENT, handler)
  window.addEventListener("storage", handler)
  return () => {
    window.removeEventListener(CONNECTION_MODE_EVENT, handler)
    window.removeEventListener("storage", handler)
  }
}

export function isLanUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(hostname)
    )
  } catch {
    return false
  }
}

export function isRailwayUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname
    return hostname.endsWith("railway.app") || hostname.endsWith("up.railway.app")
  } catch {
    return false
  }
}

export function validateUrlForMode(url: string, mode: ConnectionMode): string | null {
  if (!url.trim()) return "Server URL is required."
  try {
    new URL(url)
  } catch {
    return "Invalid URL format."
  }
  if (mode === "CONNECT_TO_HUB" && !isLanUrl(url)) {
    return "In Hub client mode, the URL must be a LAN address (e.g., http://192.168.1.100:3015)."
  }
  if (mode === "STORE_HUB" && !isLanUrl(url)) {
    return "In Hub mode, the URL should be localhost (http://localhost:3015)."
  }
  return null
}

export function getLocalApiUrl(): string {
  return "http://localhost:3015"
}

// ── Device identity ──────────────────────────────────────────────────

const DEVICE_ID_KEY = "lebanonpos.device-id.v1"

export function getDeviceId(): string {
  let deviceId = localStorage.getItem(DEVICE_ID_KEY)
  if (!deviceId) {
    deviceId = `DEV-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
    localStorage.setItem(DEVICE_ID_KEY, deviceId)
  }
  return deviceId
}

/** Short device tag for human-readable reference numbers (R-…, ADJ-…).
 * Numbers are references, not identities: the record id is the identity, so
 * two devices may never be forced to agree on a counter while offline. */
export function getDeviceTag(): string {
  const tail = getDeviceId().replace(/[^A-Za-z0-9]/g, "").slice(-4).toUpperCase()
  return tail || "LOCAL"
}

// Per-device counters for document references. Never cleared by a store
// switch: a device must not reissue its own numbers.
const REFERENCE_SEQ_KEY = "lebanonpos.reference-seq.v1"

/**
 * Next human-readable document reference issued by THIS device:
 * `PREFIX-TAG-000123` (e.g. `S-7Q2K-000123`, `SHIFT-7Q2K-042`).
 * - Sequential per device, so this device never repeats one.
 * - Carries the device tag, so staff can tell registers apart and two devices
 *   do not produce the same reference.
 * It is still only a display reference: the record id is the identity, and the
 * server accepts duplicates (older clients' references can collide).
 * `existing` seeds the counter if its storage was lost (highest issued number
 * for this tag among local records).
 */
export function nextDocumentReference(prefix: string, digits: number, existing: () => Array<string | undefined> = () => []): string {
  const key = `${prefix}-${getDeviceTag()}`
  let seqs: Record<string, number> = {}
  try { seqs = JSON.parse(localStorage.getItem(REFERENCE_SEQ_KEY) ?? "{}") ?? {} } catch { seqs = {} }
  let last = Number(seqs[key] ?? 0)
  if (!last) {
    const pattern = new RegExp(`^${key}-(\\d+)$`)
    for (const ref of existing()) {
      const match = ref ? pattern.exec(ref) : null
      if (match) last = Math.max(last, Number(match[1]))
    }
  }
  const next = last + 1
  seqs[key] = next
  try { localStorage.setItem(REFERENCE_SEQ_KEY, JSON.stringify(seqs)) } catch { /* reference still unique this session */ }
  return `${key}-${String(next).padStart(digits, "0")}`
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
  // Finish or roll back interrupted refunds while their own store's data is
  // still here, never against the next store's stock.
  try {
    const { recoverRefundJournal } = await import("./sales.service")
    recoverRefundJournal()
  } catch (e) { console.error("[sync] refund journal recovery before store switch failed:", e) }
  // Settle staged operations while this store's records are still here (present -> released and
  // stashed with the tenant; missing -> never happened).
  try { recoverStagedSyncOperations() } catch (e) { console.error("[sync] staged recovery before store switch failed:", e) }
  // Never lose an open money conflict to a store switch.
  stashMoneyConflictsForStore()
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

/** Count pending sync operations a store switch sets aside (kept per tenant and re-sent on return) */
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
  | "delivery-order" | "held-sale" | "cash-movement"

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
  /** Written ahead of its business data (stageSyncOperation): never pushed until committed. */
  staged?: boolean
}

/**
 * Where an operation stands, from this device's point of view:
 *  staged       - saved ahead of its business data; not sent (commit pending or failed: see recovery)
 *  pending      - in the queue, not yet acknowledged
 *  failed       - in the queue, last attempt failed (retried)
 *  rejected     - the server refused it (settled by a person)
 *  acknowledged - the server accepted it (the queue entry may since have been pruned)
 *  unknown      - not on this device: never queued, or a storage failure lost it
 */
export type SyncOperationState = "staged" | "pending" | "failed" | "rejected" | "acknowledged" | "unknown"

/** The queue could not be written: nothing was queued and nothing was sent. */
export class SyncStorageError extends Error {
  operationId: string
  constructor(operationId: string, cause?: unknown) {
    super(`Could not save this change for sync (device storage is full or unavailable). Nothing was sent. [${operationId}]`)
    this.name = "SyncStorageError"
    this.operationId = operationId
    this.cause = cause
  }
}

export type SyncStatus = {
  online: boolean
  /** Saved ahead of their business data and not yet committed (recovered on restart). */
  staged: number
  /** Changes this session that could not be saved for sync at all (storage full/unavailable). */
  storageFailures: number
  lastStorageError?: string
  pending: number   // actionable: Pending and attempts < MAX_ATTEMPTS
  failed: number    // Failed and attempts < MAX_ATTEMPTS
  rejected: number  // Rejected (exhausted, cannot auto-retry)
  dead: number      // exhausted MAX_ATTEMPTS, not Rejected
  synced: number
  total: number
  lastSyncedAt?: string
  lastError?: string
  recentErrors: string[]
}

type EnqueueSyncInput = Pick<SyncOperation, "entity" | "action" | "summary" | "payload"> & {
  /** A caller-chosen id makes the enqueue idempotent: an operation with this id is never queued twice. */
  id?: string
}

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

// ── Durability ───────────────────────────────────────────────────────────────
// A queue write can fail (QuotaExceededError). It used to be logged and ignored, and the operation
// was still pushed and reported as queued. Now: persistQueue() says whether it was saved; if not,
// acknowledged entries are compacted out (their ids live on in the acknowledgement ledger) and the
// write is retried once. Callers that write money or stock stage their operation BEFORE their
// business data (stageSyncOperation / commitStagedSyncOperation / discardStagedSyncOperation), so a
// storage failure either stops them before anything is written or leaves a durable staged entry
// that recovery promotes exactly once.

const ACK_KEY = "lebanonpos.sync-acked.v1"
const ACK_KEEP = 3000
let sessionStorageFailures = 0
let lastStorageError: string | undefined

/** The immutable tenant of this device's data ("unbound" when none is known yet). */
function syncTenantKey() {
  const tenantId = getCurrentTenantId()
  return tenantId ? `tenant:${tenantId}` : "unbound"
}

type AckEntry = [id: string, entity: string, action: string, recordId: string | null, at: string]
function readAcks(): Record<string, AckEntry[]> {
  try {
    const v = JSON.parse(window.localStorage.getItem(ACK_KEY) ?? "{}")
    return v && typeof v === "object" && !Array.isArray(v) ? v : {}
  } catch { return {} }
}
const recordIdOf = (payload: unknown): string | null => {
  const id = (payload as { id?: unknown } | undefined)?.id
  return typeof id === "string" || typeof id === "number" ? String(id) : null
}
/** Remember acknowledged operations, per tenant, independently of the queue (which prunes them). */
function recordAcknowledged(ops: SyncOperation[]): boolean {
  if (!canUseStorage() || ops.length === 0) return true
  try {
    const all = readAcks()
    const key = syncTenantKey()
    const mine = all[key] ?? []
    const known = new Set(mine.map((e) => e[0]))
    const now = new Date().toISOString()
    const added = ops.filter((op) => !known.has(op.id)).map<AckEntry>((op) => [op.id, op.entity, op.action, recordIdOf(op.payload), now])
    all[key] = [...added, ...mine].slice(0, ACK_KEEP)
    window.localStorage.setItem(ACK_KEY, JSON.stringify(all))
    return true
  } catch (e) {
    console.error("[sync] could not record acknowledged operations:", e)
    return false
  }
}
function acknowledgedIds(): Set<string> {
  return new Set((readAcks()[syncTenantKey()] ?? []).map((e) => e[0]))
}
/** True when the server acknowledged an operation for this record (by entity, action and record id). */
export function isRecordAcknowledged(entity: SyncEntity, action: SyncAction, recordId: string) {
  return (readAcks()[syncTenantKey()] ?? []).some((e) => e[1] === entity && e[2] === action && e[3] === recordId)
}

/** Where an operation stands (see SyncOperationState). */
export function getSyncOperationState(id: string): SyncOperationState {
  const op = readQueue().find((o) => o.id === id)
  if (op) {
    if (op.staged) return "staged"
    if (op.status === "Synced") return "acknowledged"
    if (op.status === "Rejected") return "rejected"
    return op.status === "Failed" ? "failed" : "pending"
  }
  return acknowledgedIds().has(id) ? "acknowledged" : "unknown"
}
/** Recorded durably on this device or by the server: it will reach the server (or already has). */
export function isSyncOperationRecorded(id: string) {
  return getSyncOperationState(id) !== "unknown"
}

function noteStorageFailure(e: unknown) {
  sessionStorageFailures++
  lastStorageError = String((e as Error)?.message ?? e)
  dispatchSyncChanged()
}

function trimQueue(queue: SyncOperation[]) {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
  const retryable = queue.filter((op) => op.status !== "Synced" && op.attempts < MAX_ATTEMPTS)
  const dead = queue
    .filter((op) => op.status !== "Synced" && op.attempts >= MAX_ATTEMPTS)
    .slice(0, 100)
  const active = [...retryable, ...dead]
  const synced = queue
    .filter((op) => op.status === "Synced" && new Date(op.createdAt).getTime() >= cutoff)
    .slice(0, Math.max(0, 300 - active.length))
  return { active, synced }
}

/** Write the queue; true only when it is on disk. On failure, drops acknowledged entries and retries once. */
function persistQueue(queue: SyncOperation[]): boolean {
  if (!canUseStorage()) return false
  const trimmed = trimQueue(queue)
  const active = trimmed.active
  let synced = trimmed.synced
  // Synced entries are pruned only once the acknowledgement ledger remembers them.
  const prunedSynced = queue.filter((op) => op.status === "Synced" && !synced.includes(op))
  if (prunedSynced.length && !recordAcknowledged(prunedSynced)) synced = queue.filter((op) => op.status === "Synced")
  const attempt = (list: SyncOperation[]) => {
    window.localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(list))
    putMany("sync-queue", list).catch((e) => console.error("[sync] sync-queue write failed:", e))
  }
  let ok = false
  try {
    attempt([...active, ...synced])
    ok = true
  } catch (first) {
    console.error("[sync] failed to persist sync queue:", first)
    // Make room: acknowledged entries are only history once they are in the ledger.
    if (synced.length > 0 && recordAcknowledged(synced)) {
      try { attempt(active); ok = true } catch (second) { noteStorageFailure(second) }
    } else {
      noteStorageFailure(first)
    }
  }
  dispatchSyncChanged()
  return ok
}

function writeQueue(queue: SyncOperation[]): boolean {
  return persistQueue(queue)
}

/** Apply per-operation changes onto the CURRENT queue (never a stale snapshot taken before an await). */
function updateQueueOps(update: (op: SyncOperation) => SyncOperation | null): boolean {
  const next: SyncOperation[] = []
  for (const op of readQueue()) {
    const u = update(op)
    if (u) next.push(u)
  }
  return persistQueue(next)
}

/** Oldest staged operation still waiting: nothing created after it is pushed (dependency order). */
function oldestStagedAt(queue = readQueue()): string | null {
  const staged = queue.filter((op) => op.staged).map((op) => op.createdAt).sort()
  return staged[0] ?? null
}

/**
 * Save an operation BEFORE the business data it describes. Throws SyncStorageError when it cannot be
 * saved (the caller has written nothing yet, so nothing is lost). Idempotent by id.
 */
export function stageSyncOperation(input: EnqueueSyncInput): SyncOperation {
  if (!canUseStorage()) throw new SyncStorageError(input.id ?? "?")
  const queue = readQueue()
  if (input.id) {
    const existing = queue.find((op) => op.id === input.id)
    if (existing) return existing
    // Already acknowledged (queue entry pruned): nothing to stage, never sent again.
    if (acknowledgedIds().has(input.id)) {
      return { id: input.id, entity: input.entity, action: input.action, summary: input.summary, payload: input.payload, status: "Synced", attempts: 0, createdAt: new Date().toISOString() }
    }
  }
  const operation: SyncOperation = {
    id: input.id ?? createId(), entity: input.entity, action: input.action, summary: input.summary,
    payload: input.payload, status: "Pending", attempts: 0, createdAt: new Date().toISOString(), staged: true,
  }
  if (!persistQueue([operation, ...queue])) throw new SyncStorageError(operation.id)
  return operation
}

/**
 * The business data is written: release the staged operation for sync (optionally with its final
 * payload). Never throws. If it cannot be saved the operation stays staged on disk and recovery
 * promotes it (exactly once) on the next flush or restart.
 */
export function commitStagedSyncOperation(id: string, payload?: unknown): SyncOperationState {
  let found = false
  const ok = updateQueueOps((op) => {
    if (op.id !== id) return op
    found = true
    return { ...op, staged: undefined, ...(payload !== undefined ? { payload } : {}) }
  })
  if (!found) return getSyncOperationState(id)
  if (!ok) { pendingCommits.set(id, payload); return "staged" }
  pendingCommits.delete(id)
  scheduleAutoFlush()
  return "pending"
}
const pendingCommits = new Map<string, unknown>()

/**
 * After a business write threw part-way: release the staged operation if its record shows the
 * change (it is real on this device), otherwise remove it (never sent). Same rule as recovery.
 */
export function settleStagedSyncOperation(id: string): SyncOperationState {
  const op = readQueue().find((o) => o.id === id)
  if (!op?.staged) return getSyncOperationState(id)
  const found = stagedRecordState(op)
  if (found.state === "present") return commitStagedSyncOperation(id)
  if (found.state === "missing") { discardStagedSyncOperation(id); return "unknown" }
  return "staged"
}

/** The business write failed: remove its staged operation (it was never sent). */
export function discardStagedSyncOperation(id: string) {
  updateQueueOps((op) => (op.id === id && op.staged ? null : op))
}

// Does the business record a staged operation describes exist on this device? Read straight from
// storage (no service imports). "missing": the write never happened. "unknown": no rule; held.
const RECORD_KEYS: Partial<Record<string, string>> = {
  "sale/create": "lebanonpos.sales.v1",
  "refund/create": "lebanonpos.refunds.v1",
  "expense/create": "lebanonpos.expenses.v1",
  "cash-movement/create": "lebanonpos.cash-movements.v1",
  "inventory/adjust": "lebanonpos.inventory-adjustments.v1",
  "supplier-payment/payment": "lebanonpos.supplier-payments.v1",
  "purchase-order/create": "lebanonpos.purchase-orders.v1",
}
function readArray(key: string): Array<Record<string, unknown>> {
  try { const v = JSON.parse(window.localStorage.getItem(key) ?? "[]"); return Array.isArray(v) ? v : [] } catch { return [] }
}
function stagedRecordState(op: SyncOperation): { state: "present" | "missing" | "unknown"; record?: unknown } {
  const k = `${op.entity}/${op.action}`
  if (k === "sale/void") {
    const sale = readArray("lebanonpos.sales.v1").find((s) => String(s.id) === recordIdOf(op.payload))
    return { state: sale?.status === "Voided" ? "present" : "missing" }
  }
  if (k === "purchase-order/update") {
    // An update is "present" only when the stored order says what the update says (a failed
    // payment must not release a "paid" update).
    const want = op.payload as { status?: unknown; paidTotal?: unknown; paymentStatus?: unknown } | undefined
    const po = readArray("lebanonpos.purchase-orders.v1").find((r) => String(r.id) === recordIdOf(op.payload))
    const same = !!po && po.status === want?.status && Number(po.paidTotal ?? 0) === Number(want?.paidTotal ?? 0) && po.paymentStatus === want?.paymentStatus
    return { state: same ? "present" : "missing" }
  }
  if (k === "inventory/receive") {
    const ids = (Array.isArray(op.payload) ? op.payload : []).map((b) => String((b as { id?: unknown }).id))
    const lots = new Set(readArray("lebanonpos.inventory-batches.v1").map((b) => String(b.id)))
    return { state: ids.length > 0 && ids.every((id) => lots.has(id)) ? "present" : "missing" }
  }
  const key = RECORD_KEYS[k]
  if (!key) return { state: "unknown" }
  const record = readArray(key).find((r) => String(r.id) === recordIdOf(op.payload))
  return record ? { state: "present", record } : { state: "missing" }
}

/**
 * Settle staged operations left by a failed commit or an interrupted write: present business
 * record -> released for sync (once; adjustments take the stored record as payload); missing ->
 * removed (the write never happened, nothing was sent); no rule -> kept staged and reported.
 */
export function recoverStagedSyncOperations(): { promoted: number; dropped: number; held: number } {
  if (!canUseStorage()) return { promoted: 0, dropped: 0, held: 0 }
  let promoted = 0, dropped = 0, held = 0
  const queue = readQueue()
  if (!queue.some((op) => op.staged)) return { promoted, dropped, held }
  const next: SyncOperation[] = []
  for (const op of queue) {
    if (!op.staged) { next.push(op); continue }
    const found = stagedRecordState(op)
    if (found.state === "present") {
      const payload = pendingCommits.has(op.id) && pendingCommits.get(op.id) !== undefined ? pendingCommits.get(op.id)
        : op.entity === "inventory" && op.action === "adjust" && found.record ? found.record : op.payload
      next.push({ ...op, staged: undefined, payload })
      promoted++
    } else if (found.state === "missing") {
      dropped++
    } else {
      next.push(op)
      held++
    }
  }
  if (persistQueue(next)) for (const op of queue) pendingCommits.delete(op.id)
  return { promoted, dropped, held }
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
  // The id identifies the record. A display number is used only when the
  // deletion carries no id (numbers are not unique: matching on them would
  // delete every record that happens to share one).
  if (id !== undefined) return String(record.id) === String(id)
  return saleNumber !== undefined && String(record.saleNumber) === String(saleNumber)
}

/** Exposed for tests only. */
export const applyPulledDeletionsForTest = (deletions: PulledDeletion[]) => applyPulledDeletions(deletions)

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

  let pending = 0, failed = 0, rejected = 0, dead = 0, synced = 0
  let lastError: string | undefined

  for (const op of queue) {
    if (op.status === "Synced") {
      synced++
    } else if (op.status === "Rejected") {
      rejected++
      if (op.error && recentErrors.length < 3) recentErrors.push(`${op.entity}: ${op.error}`)
      if (op.error) lastError = op.error
    } else if (op.attempts >= MAX_ATTEMPTS) {
      dead++
      if (op.error && recentErrors.length < 3) recentErrors.push(`${op.entity}: ${op.error}`)
      if (op.error) lastError = op.error
    } else if (op.staged) {
      // counted as staged above, not as pending
    } else if (op.status === "Pending") {
      pending++
    } else if (op.status === "Failed") {
      failed++
      if (op.error && recentErrors.length < 3) recentErrors.push(`${op.entity}: ${op.error}`)
      if (op.error) lastError = op.error
    }
  }

  return {
    online: isBrowserOnline(),
    staged: queue.filter((op) => op.staged).length,
    storageFailures: sessionStorageFailures,
    lastStorageError,
    pending,
    failed,
    rejected,
    dead,
    synced,
    total: queue.length,
    lastSyncedAt: readLastSyncedAt(),
    lastError,
    recentErrors,
  }
}

export function retryRejectedSync() {
  const queue = readQueue().map((op) =>
    op.status === "Rejected"
      ? { ...op, status: "Pending" as const, attempts: 0, error: undefined }
      : op
  )
  writeQueue(queue)
  scheduleAutoFlush()
}

export function retrySingleSyncOperation(id: string) {
  const queue = readQueue().map((op) =>
    op.id === id && (op.status === "Failed" || op.status === "Rejected")
      ? { ...op, status: "Pending" as const, attempts: 0, error: undefined }
      : op
  )
  writeQueue(queue)
  scheduleAutoFlush()
}

export function removeRejectedOperation(id: string) {
  const queue = readQueue().filter((op) => op.id !== id || op.status !== "Rejected" || isMoneyConflictOperation(op))
  writeQueue(queue)
}

/** Only for refundConflict.service, after a manager has recorded how the conflict was settled. */
export function removeSettledConflictOperation(id: string) {
  writeQueue(readQueue().filter((op) => op.id !== id))
}

export function exportSyncDiagnostics() {
  const queue = readQueue()
  const status = getSyncStatus()
  const apiUrl = getApiUrl()
  const mode = getConnectionMode()
  const lastSync = readLastSyncedAt()
  const deviceId = getDeviceId()

  const failedRejected = queue
    .filter((op) => op.status === "Failed" || op.status === "Rejected")
    .slice(0, 50)
    .map((op) => ({
      id: op.id,
      entity: op.entity,
      action: op.action,
      summary: op.summary,
      status: op.status,
      attempts: op.attempts,
      error: op.error,
      createdAt: op.createdAt,
      lastAttemptAt: op.lastAttemptAt,
    }))

  return {
    exportedAt: new Date().toISOString(),
    appVersion: "4.0.0",
    connectionMode: mode,
    apiUrl,
    deviceId,
    sync: {
      pending: status.pending,
      failed: status.failed,
      rejected: status.rejected,
      dead: status.dead,
      synced: status.synced,
      total: status.total,
      lastSyncedAt: lastSync,
      lastError: status.lastError,
      online: status.online,
    },
    failedRejected,
  }
}

export function downloadSyncDiagnostics() {
  const diag = exportSyncDiagnostics()
  const json = JSON.stringify(diag, null, 2)
  const blob = new Blob([json], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `lebanonpos-sync-diag-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export function copySyncDiagnosticsSummary() {
  const diag = exportSyncDiagnostics()
  const summary = [
    `Sync Diagnostics - ${diag.exportedAt}`,
    `Mode: ${diag.connectionMode}`,
    `API: ${diag.apiUrl}`,
    `Device: ${diag.deviceId}`,
    `Online: ${diag.sync.online}`,
    `Pending: ${diag.sync.pending}`,
    `Failed: ${diag.sync.failed}`,
    `Rejected: ${diag.sync.rejected}`,
    `Last Sync: ${diag.sync.lastSyncedAt ?? "never"}`,
    diag.sync.lastError ? `Last Error: ${diag.sync.lastError}` : null,
    `Failed/Rejected ops: ${diag.failedRejected.length}`,
  ].filter(Boolean).join("\n")
  if (typeof navigator !== "undefined") {
    navigator.clipboard.writeText(summary).catch(() => {})
  }
}

export async function enqueueSyncOperation(input: EnqueueSyncInput) {
  if (!canUseStorage()) return undefined

  // License check — block business writes when license is suspended/expired
  if (isLicenseBlocked()) {
    console.warn("[sync] License blocked — skipping enqueue:", input.entity, input.action)
    return undefined
  }

  if (input.id) {
    const existing = getSyncQueue().find((op) => op.id === input.id)
    if (existing) return existing
    // Acknowledged earlier (its queue entry may have been pruned): never queue or send it again.
    if (acknowledgedIds().has(input.id)) return undefined
  }
  const operation: SyncOperation = {
    id: input.id ?? createId(),
    entity: input.entity,
    action: input.action,
    summary: input.summary,
    payload: input.payload,
    status: "Pending",
    attempts: 0,
    createdAt: new Date().toISOString(),
  }
  // Never report "queued", and never send, unless it is on disk.
  if (!persistQueue([operation, ...getSyncQueue()])) return undefined
  // Nothing overtakes an older staged operation (dependency order); it goes out with the flush.
  if (oldestStagedAt()) { scheduleAutoFlush(); return operation }
  
  // Write-through: try to push to hub API immediately
  // This makes the hub the single authority — no local-first conflicts
  const apiUrl = getApiUrl()
  const token = getAuthToken()
  if (apiUrl && token && !isSuspended()) {
    try {
      const response = await fetch(`${apiUrl}/api/sync/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ deviceId: getDeviceId(), operations: [{ id: operation.id, entity: operation.entity, action: operation.action, payload: operation.payload }] }),
        signal: AbortSignal.timeout(5_000),
      })
      if (response.ok || response.status === 403) {
        const body = await response.json().catch(() => ({ results: [] as any[] }))
        if (body.code === "DEVICE_NOT_APPROVED") {
          const rejected = { ...operation, status: "Rejected" as const, attempts: 5, lastAttemptAt: new Date().toISOString(), error: body.error ?? "Device not approved" }
          updateQueueOps((op) => op.id === operation.id ? rejected : op)
          dispatchOperationRejected(rejected)
          dispatchSyncChanged()
          return operation
        }
        if (!response.ok) return operation
        const result = body.results?.find((r: { id: string }) => r.id === operation.id)
        if (result?.status === "rejected") {
          const rejected = { ...operation, status: "Rejected" as const, attempts: 5, lastAttemptAt: new Date().toISOString(), error: result.error ?? "Rejected by server" }
          updateQueueOps((op) => op.id === operation.id ? rejected : op)
          dispatchOperationRejected(rejected)
          dispatchSyncChanged()
          return operation
        }
        if (!result || result.status === "ok") {
          recordAcknowledged([operation])
          updateQueueOps((op) => op.id === operation.id ? { ...op, status: "Synced" as const, syncedAt: new Date().toISOString() } : op)
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
  try { recoverStagedSyncOperations() } catch (e) { console.error("[sync] staged recovery failed:", e) }
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
  // A staged operation (business write not confirmed) holds back everything created after it.
  const holdFrom = oldestStagedAt(queue)
  const pending = queue.filter((op) => {
    if (op.staged) return false
    if (holdFrom && op.createdAt >= holdFrom) return false
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
        deviceId: getDeviceId(),
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
        const sent = new Set(pending.map((op) => op.id))
        updateQueueOps((op) =>
          sent.has(op.id) && op.status === "Pending"
            ? { ...op, status: "Failed" as const, attempts: op.attempts + 1, error: "Token expired — re-enter in Settings" }
            : op
        )
        return { synced: 0, skipped: pending.length }
      }
      if (response.status === 403) {
        const body = await response.json().catch(() => ({ error: "Device not approved" }))
        if (body.code === "DEVICE_NOT_APPROVED") {
          const now = new Date().toISOString()
          const sent = new Set(pending.map((op) => op.id))
          updateQueueOps((op) => {
            if (!sent.has(op.id) || (op.status !== "Pending" && op.status !== "Failed")) return op
            dispatchOperationRejected({ ...op, status: "Rejected", attempts: 5, lastAttemptAt: now, error: body.error ?? "Device not approved" })
            return { ...op, status: "Rejected" as const, attempts: 5, lastAttemptAt: now, error: body.error ?? "Device not approved" }
          })
          return { synced: 0, skipped: pending.length }
        }
      }
      throw new Error(`Sync push failed: ${response.status}`)
    }

    const result = await response.json()
    const now = new Date().toISOString()
    let synced = 0
    const sent = new Set(pending.map((op) => op.id))
    // Acknowledgements are remembered before the queue is rewritten (it may prune them).
    recordAcknowledged(pending.filter((op) => result.results?.find((r: { id: string; status: string }) => r.id === op.id)?.status === "ok"))

    // Re-read: operations queued while this request was in flight must survive (they used to be
    // overwritten by the snapshot taken before the await).
    updateQueueOps((op) => {
      if (!sent.has(op.id)) return op
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
    return { synced, skipped: pending.length - synced }
  } catch (err) {
    // The outcome is uncertain (the server may have applied some): they stay queued and are resent;
    // every server handler is idempotent by operation and record id.
    const now = new Date().toISOString()
    const sent = new Set(pending.map((op) => op.id))
    updateQueueOps((op) =>
      sent.has(op.id) && (op.status === "Pending" || op.status === "Failed") && op.attempts < MAX_ATTEMPTS
        ? { ...op, status: "Failed" as const, attempts: op.attempts + 1, lastAttemptAt: now, error: String(err) }
        : op
    )
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
  // A pull replaces local collections. While a staged operation is unresolved its business record
  // may exist only on this device: settle it first, and never overwrite local data until it is.
  try { recoverStagedSyncOperations() } catch (e) { console.error("[sync] staged recovery before pull failed:", e) }
  if (oldestStagedAt()) {
    console.warn("[sync] pull skipped: a change is saved locally but not yet released for sync")
    dispatchSyncChanged()
    return
  }
  _pulling = true
  try {
    await _pullFromServer(full)
  } finally {
    _pulling = false
  }
}

export type StockValidationResult =
  | { ok: true }
  | { ok: false; reason: "unreachable" | "insufficient"; insufficientItems?: Array<{ productId: number; name: string; available: number; requested: number }> }

/**
 * Preflight stock check against the server's LIVE data, immediately before
 * completing a stock-changing sale. Exists to close the race where a
 * connected device's local product/batch cache is stale (another register
 * already sold the item), which previously let checkout complete locally
 * and only fail much later at sync time with an unrecoverable "insufficient
 * stock in batch" rejection. Read-only — does not reserve stock, so the
 * final server-side decrement on push remains the authoritative backstop.
 */
export async function validateStockWithHub(
  items: Array<{ productId: number; quantity: number }>
): Promise<StockValidationResult> {
  const apiUrl = getApiUrl()
  const token = getAuthToken()
  if (!apiUrl || !token) return { ok: false, reason: "unreachable" }

  try {
    const res = await fetch(`${apiUrl}/api/sync/validate-stock`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ items }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return { ok: false, reason: "unreachable" }
    const data = await res.json()
    if (data.ok) return { ok: true }
    return { ok: false, reason: "insufficient", insufficientItems: data.insufficientItems }
  } catch {
    return { ok: false, reason: "unreachable" }
  }
}

// ── Server-authoritative (write-through) stock checkout ──────────────────────
// For CONNECT_TO_HUB satellite tills, a stock-decrementing sale must be
// committed by the hub (single authority, atomic decrement) BEFORE it is
// finalized locally — so a sale can never complete against stale local stock.

export type SaleCommitResult =
  | { status: "committed" }
  | { status: "rejected"; error: string }
  | { status: "unreachable" }

// Transient-retry window: a brief network blip should not stop a sale. Short
// timeout + one retry keeps a healthy-LAN commit imperceptible while a genuine
// blip usually recovers within the window. Total worst case before the
// confirm-before-give-up check ≈ 2 × COMMIT_TIMEOUT_MS.
const COMMIT_TIMEOUT_MS = 1200
const COMMIT_MAX_ATTEMPTS = 2

/** Asks the hub whether a sale id has already committed (idempotency check). */
async function saleCommittedOnHub(saleId: string): Promise<boolean | null> {
  const apiUrl = getApiUrl(); const token = getAuthToken()
  if (!apiUrl || !token) return null
  try {
    const res = await fetch(`${apiUrl}/api/sync/sale-committed/${encodeURIComponent(saleId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(COMMIT_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data?.committed === true
  } catch { return null }
}

/**
 * Write-through commit of a stock-decrementing sale to the hub. The sale MUST
 * carry a client-generated UUID (`sale.id`) so the hub's commit is idempotent:
 * a retry of the same id never double-decrements. On a lost response after the
 * retry window, we CONFIRM whether the sale actually committed before conceding
 * — so a committed-but-unacked sale is reported as committed (finalize it),
 * never duplicated.
 */
export async function commitSaleToHub(sale: { id: string } & Record<string, unknown>): Promise<SaleCommitResult> {
  const apiUrl = getApiUrl()
  const token = getAuthToken()
  if (!apiUrl || !token) return { status: "unreachable" }

  const op = { id: `wt-${sale.id}`, entity: "sale", action: "create", payload: sale }
  const body = JSON.stringify({ deviceId: getDeviceId(), operations: [op] })
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` }

  for (let attempt = 1; attempt <= COMMIT_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${apiUrl}/api/sync/push`, {
        method: "POST", headers, body, signal: AbortSignal.timeout(COMMIT_TIMEOUT_MS),
      })
      if (res.ok) {
        const data = await res.json()
        const r = data?.results?.[0]
        if (r?.status === "ok") { invalidateHealthCache(); return { status: "committed" } }
        // "rejected" is a definitive business decision (insufficient stock) —
        // do not retry it.
        if (r?.status === "rejected") return { status: "rejected", error: r.error ?? "Rejected by hub" }
        // "error" (transient server error) or non-OK HTTP → fall through, retry
      }
    } catch { /* timeout / network drop → retry */ }
  }

  // Retries exhausted. The hub may have committed but the ACK was lost — confirm
  // before giving up, so the cashier never re-rings a sale that already went in.
  const committed = await saleCommittedOnHub(sale.id)
  if (committed === true) { invalidateHealthCache(); return { status: "committed" } }
  return { status: "unreachable" }
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
  cashMovements: "cash-movements",
}

/**
 * REFUND-INTEGRITY-1: a full pull replaces a collection with the server's
 * copy. Sales and refunds that exist only on this device — still waiting to
 * sync, rejected by the server (a money conflict), or settled after a
 * rejection — must survive it, or an issued refund would silently vanish.
 */
const LOCAL_ONLY_PRESERVED: Record<string, string> = {
  "lebanonpos.sales.v1": "sale",
  "lebanonpos.refunds.v1": "refund",
  "lebanonpos.debt-payments.v1": "debt",
}
export function preserveLocalOnlyRecords(key: string, serverRows: any[]): any[] {
  const entity = LOCAL_ONLY_PRESERVED[key]
  if (!entity || typeof window === "undefined") return serverRows
  const unsynced = new Set(
    readQueue()
      .filter((op) => op.entity === entity && op.action === "create" && op.status !== "Synced")
      .map((op) => (op.payload as { id?: string } | undefined)?.id)
      .filter(Boolean) as string[]
  )
  let local: any[] = []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "[]")
    local = Array.isArray(parsed) ? parsed : []
  } catch { /* corrupt local copy — nothing to preserve */ }
  const onServer = new Set(serverRows.map((row) => row?.id))
  const keep = local.filter((row) => row?.id && !onServer.has(row.id) && (unsynced.has(row.id) || row.conflict || row.localOnly))
  return keep.length > 0 ? [...keep, ...serverRows] : serverRows
}

async function pullFullEntity(apiUrl: string, token: string, entityPath: string, target: { key: string; event: string }): Promise<void> {
  let cursor: string | undefined
  const all: any[] = []
  while (true) {
    const params = new URLSearchParams({ limit: "5000" })
    if (cursor) params.set("cursor", cursor)
    const res = await fetch(`${apiUrl}/api/sync/pull/full/${entityPath}?${params}`, {
      headers: { Authorization: `Bearer ${token}`, ...SYNC_SCHEMA_HEADERS },
    })
    if (!res.ok) throw new Error(`Pull ${entityPath} failed: ${res.status}`)
    const raw = await res.text()
    let page: any
    try { page = raw ? JSON.parse(raw) : {} } catch {
      throw new Error(`Pull ${entityPath} failed: server at ${apiUrl} returned a non-JSON response (check the URL points at the API port, not a different server)`)
    }
    const arr = Array.isArray(page.items) ? page.items : []
    all.push(...arr)
    if (!page.hasMore) break
    cursor = page.nextCursor ? String(page.nextCursor) : undefined
    if (!cursor) break
  }
  writeLocalWithIndexedDB(target.key, preserveLocalOnlyRecords(target.key, all))
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

// Re-fetch a safety margin of history on every incremental pull. Without this,
// a change whose server updatedAt lands just before the stored cursor (clock
// skew between hub and this device, or a cursor set from a different clock)
// is never re-requested — it gets permanently stranded, so the local UI shows
// stale stock/archived state forever. Re-pulling the last few minutes is cheap
// (the by-id merge is idempotent) and self-heals recent stranded changes.
const PULL_OVERLAP_MS = 3 * 60 * 1000

async function _incrementalPull(apiUrl: string, token: string): Promise<void> {
  const lastSync = readLastSyncedAt()
  const sinceParam = lastSync
    ? new Date(Math.max(0, Date.parse(lastSync) - PULL_OVERLAP_MS)).toISOString()
    : undefined
  const url = sinceParam
    ? `${apiUrl}/api/sync/pull?since=${encodeURIComponent(sinceParam)}`
    : `${apiUrl}/api/sync/pull`

  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, ...SYNC_SCHEMA_HEADERS } })
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
    (op) => (op.status !== "Synced" && op.attempts < MAX_ATTEMPTS) || isMoneyConflictOperation(op)
  )
  writeQueue(queue)
}

/**
 * Nuke everything in the queue — use when stuck ops need to be force-cleared.
 */
export function clearAllSyncOperations() {
  if (canUseStorage()) {
    // Money conflicts and staged operations (the only evidence that a saved record still needs
    // syncing) are never force-cleared.
    const conflicts = readQueue().filter((op) => isMoneyConflictOperation(op) || op.staged)
    if (conflicts.length > 0) writeQueue(conflicts)
    else window.localStorage.removeItem(SYNC_QUEUE_KEY)
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
  // Authoritative reconcile on startup/login. Incremental pulls can strand a
  // change (archive, stock/batch update) if its server timestamp lands just
  // before the stored cursor — that stale row then never self-corrects on a
  // reload, because reload also resumes from the same cursor with incremental
  // pulls. A one-time full pull on startup replaces the local cache with the
  // server's authoritative set, so relaunching the app always clears stale
  // stock/archived state. Runs after flushing pending local work so nothing
  // unsynced is clobbered.
  if (isBrowserOnline() && getApiUrl() && getAuthToken() && !isSuspended()) {
    flushSyncQueue()
      .then(() => pullFromServer(true))
      .catch((e) => console.error("[sync] startup reconcile failed:", e))
  }
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
        if (msg.type === "sync:activity") {
          // Live cross-device activity feed — skip entries this device
          // itself generated (seeing "you sold X" right after checkout is
          // noise, not signal).
          if (msg.data?.deviceId !== getDeviceId() && Array.isArray(msg.data?.activities)) {
            window.dispatchEvent(new CustomEvent("sync:activity-feed", { detail: msg.data.activities }))
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
  appVersion: string
  dataCounts: Record<string, number>
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
    appVersion: "4.0.0",
    dataCounts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, Array.isArray(v) ? v.length : 1])),
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

/** Validate that a recovery pack has the minimum expected structure */
export function validateRecoveryPack(pack: unknown): pack is RecoveryPack {
  if (!pack || typeof pack !== "object") return false
  const p = pack as Record<string, unknown>
  if (!p.exportedAt || !p.store || !p.sync) return false
  const s = p.store as Record<string, unknown>
  if (typeof s.apiUrl !== "string" || typeof s.hasAuthToken !== "boolean") return false
  return true
}

/** Warn if restoring to a different store */
export function getStoreIdentity(): string {
  const apiUrl = getApiUrl()
  const authToken = getAuthToken()
  let subdomain = ""
  try {
    const raw = localStorage.getItem("lebanonpos.settings.v1")
    if (raw) {
      const settings = JSON.parse(raw)
      subdomain = (Array.isArray(settings) ? settings[0]?.subdomain : settings?.subdomain) ?? ""
    }
  } catch { /* ignore */ }
  return `${apiUrl || "no-url"}|${subdomain || "no-store"}`
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
