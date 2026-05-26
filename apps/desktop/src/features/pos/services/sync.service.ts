const SYNC_QUEUE_KEY = "lebanonpos.sync-queue.v1"
const LAST_SYNC_KEY = "lebanonpos.sync-last.v1"
const SYNC_EVENT = "lebanonpos-sync-changed"
const API_URL_KEY = "lebanonpos.api-url"
const AUTH_TOKEN_KEY = "lebanonpos.auth-token"

function getApiUrl(): string | null {
  return localStorage.getItem(API_URL_KEY)
}

function getAuthToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY)
}

export function setApiUrl(url: string) {
  localStorage.setItem(API_URL_KEY, url)
}

export function setAuthToken(token: string) {
  localStorage.setItem(AUTH_TOKEN_KEY, token)
}

export function clearAuthToken() {
  localStorage.removeItem(AUTH_TOKEN_KEY)
}

export type SyncEntity =
  | "sale"
  | "refund"
  | "product"
  | "customer"
  | "debt"
  | "expense"
  | "daily-close"
  | "supplier"
  | "purchase-order"
  | "supplier-payment"
  | "staff"
  | "shift"
  | "inventory"
  | "settings"

export type SyncAction =
  | "create"
  | "update"
  | "delete"
  | "receive"
  | "payment"
  | "close"
  | "open"
  | "adjust"
  | "count"

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
  pending: number
  failed: number
  synced: number
  total: number
  lastSyncedAt?: string
}

type EnqueueSyncInput = Pick<
  SyncOperation,
  "entity" | "action" | "summary" | "payload"
>

let autoFlushTimer: number | undefined

function canUseStorage() {
  return typeof window !== "undefined" && Boolean(window.localStorage)
}

function canUseCrypto() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
}

function createId() {
  if (canUseCrypto()) {
    return crypto.randomUUID()
  }

  return `sync-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function dispatchSyncChanged() {
  if (typeof window === "undefined") {
    return
  }

  window.dispatchEvent(new Event(SYNC_EVENT))
}

function isBrowserOnline() {
  if (typeof navigator === "undefined") {
    return true
  }

  return navigator.onLine
}

function readQueue() {
  if (!canUseStorage()) {
    return []
  }

  const storedValue = window.localStorage.getItem(SYNC_QUEUE_KEY)

  if (!storedValue) {
    return []
  }

  try {
    const parsedValue = JSON.parse(storedValue)

    return Array.isArray(parsedValue) ? (parsedValue as SyncOperation[]) : []
  } catch {
    console.warn(`[sync.service] Failed to parse storage key`)
    return []
  }
}

function writeQueue(queue: SyncOperation[]) {
  if (!canUseStorage()) {
    return
  }

  window.localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue.slice(0, 300)))
  dispatchSyncChanged()
}

function readLastSyncedAt() {
  if (!canUseStorage()) {
    return undefined
  }

  return window.localStorage.getItem(LAST_SYNC_KEY) ?? undefined
}

function writeLastSyncedAt(value: string) {
  if (!canUseStorage()) {
    return
  }

  window.localStorage.setItem(LAST_SYNC_KEY, value)
}

function scheduleAutoFlush() {
  if (typeof window === "undefined" || !isBrowserOnline()) {
    return
  }

  window.clearTimeout(autoFlushTimer)
  autoFlushTimer = window.setTimeout(() => {
    flushSyncQueue().catch(() => {})
  }, 900)
}

export function getSyncQueue() {
  return readQueue()
}

export function getSyncStatus(): SyncStatus {
  const queue = getSyncQueue()

  return {
    online: isBrowserOnline(),
    pending: queue.filter((operation) => operation.status === "Pending").length,
    failed: queue.filter((operation) => operation.status === "Failed").length,
    synced: queue.filter((operation) => operation.status === "Synced").length,
    total: queue.length,
    lastSyncedAt: readLastSyncedAt(),
  }
}

export function enqueueSyncOperation(input: EnqueueSyncInput) {
  if (!canUseStorage()) {
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
  scheduleAutoFlush()

  return operation
}

export async function flushSyncQueue() {
  const queue = getSyncQueue()
  const apiUrl = getApiUrl()
  const token = getAuthToken()

  if (!isBrowserOnline() || !apiUrl || !token) {
    dispatchSyncChanged()
    return {
      synced: 0,
      skipped: queue.filter((operation) => operation.status !== "Synced").length,
    }
  }

  const pending = queue.filter((op) => op.status === "Pending")
  if (pending.length === 0) {
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
      throw new Error(`Sync push failed: ${response.status}`)
    }

    const result = await response.json()
    const now = new Date().toISOString()
    let synced = 0

    const nextQueue = queue.map((op) => {
      if (op.status !== "Pending") return op

      const syncResult = result.results?.find((r: { id: string }) => r.id === op.id)
      if (syncResult?.status === "ok") {
        synced += 1
        return {
          ...op,
          status: "Synced" as const,
          attempts: op.attempts + 1,
          lastAttemptAt: now,
          syncedAt: now,
          error: undefined,
        }
      }

      return {
        ...op,
        status: "Failed" as const,
        attempts: op.attempts + 1,
        lastAttemptAt: now,
        error: syncResult?.error ?? "Unknown error",
      }
    })

    if (synced > 0) writeLastSyncedAt(now)
    writeQueue(nextQueue)

    return { synced, skipped: pending.length - synced }
  } catch (err) {
    console.warn("[sync] Push failed:", err)
    dispatchSyncChanged()
    return { synced: 0, skipped: pending.length }
  }
}

export async function pullFromServer() {
  const apiUrl = getApiUrl()
  const token = getAuthToken()
  if (!apiUrl || !token) return

  try {
    const lastSync = readLastSyncedAt()
    const url = lastSync
      ? `${apiUrl}/api/sync/pull?since=${encodeURIComponent(lastSync)}`
      : `${apiUrl}/api/sync/pull`

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!response.ok) throw new Error(`Sync pull failed: ${response.status}`)

    const data = await response.json()
    const now = new Date().toISOString()

    // Write pulled data to localStorage for each entity
    for (const [key, items] of Object.entries(data)) {
      if (Array.isArray(items) && items.length > 0) {
        const storageKey = `lebanonpos-pulled-${key}`
        localStorage.setItem(storageKey, JSON.stringify(items))
      }
    }

    writeLastSyncedAt(now)
  } catch (err) {
    console.warn("[sync] Pull failed:", err)
  }
}

export function retryFailedSync() {
  const queue = getSyncQueue().map((operation) =>
    operation.status === "Failed"
      ? { ...operation, status: "Pending" as const, error: undefined }
      : operation
  )

  writeQueue(queue)
  scheduleAutoFlush()
}

export function subscribeSync(callback: () => void) {
  if (typeof window === "undefined") {
    return () => undefined
  }

  function handleSyncChanged() {
    callback()
  }

  window.addEventListener(SYNC_EVENT, handleSyncChanged)
  window.addEventListener("storage", handleSyncChanged)
  window.addEventListener("online", handleSyncChanged)
  window.addEventListener("offline", handleSyncChanged)
  window.addEventListener("online", () => { scheduleAutoFlush(); pullFromServer() })

  return () => {
    window.removeEventListener(SYNC_EVENT, handleSyncChanged)
    window.removeEventListener("storage", handleSyncChanged)
    window.removeEventListener("online", handleSyncChanged)
    window.removeEventListener("offline", handleSyncChanged)
    window.removeEventListener("online", scheduleAutoFlush)
    window.removeEventListener("online", () => { scheduleAutoFlush(); pullFromServer() })
  }
}
