const SYNC_QUEUE_KEY = "lebanonpos.sync-queue.v1"
const LAST_SYNC_KEY = "lebanonpos.sync-last.v1"
const SYNC_EVENT = "lebanonpos-sync-changed"

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
    flushSyncQueue()
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

export function flushSyncQueue() {
  const queue = getSyncQueue()

  if (!isBrowserOnline()) {
    dispatchSyncChanged()
    return {
      synced: 0,
      skipped: queue.filter((operation) => operation.status !== "Synced").length,
    }
  }

  const now = new Date().toISOString()
  let synced = 0
  const nextQueue = queue.map((operation) => {
    if (operation.status === "Synced") {
      return operation
    }

    synced += 1

    return {
      ...operation,
      status: "Synced" as const,
      attempts: operation.attempts + 1,
      lastAttemptAt: now,
      syncedAt: now,
      error: undefined,
    }
  })

  if (synced > 0) {
    writeLastSyncedAt(now)
  }

  writeQueue(nextQueue)

  return { synced, skipped: 0 }
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
  window.addEventListener("online", scheduleAutoFlush)

  return () => {
    window.removeEventListener(SYNC_EVENT, handleSyncChanged)
    window.removeEventListener("storage", handleSyncChanged)
    window.removeEventListener("online", handleSyncChanged)
    window.removeEventListener("offline", handleSyncChanged)
    window.removeEventListener("online", scheduleAutoFlush)
  }
}
