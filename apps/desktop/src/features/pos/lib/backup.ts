// POS-SETTINGS-DATA-SAFETY-1: data-backup payload builders + secret redaction.
// A "safe" backup is the default — business data with credentials stripped and
// live-session/identity stores omitted. A "raw" backup keeps everything and is
// gated behind admin-only + typed confirmation in the UI.

/** localStorage stores included in a data backup. */
export const BACKUP_KEYS = [
  "lebanonpos.products.v1",
  "lebanonpos.inventory-batches.v1",
  "lebanonpos.inventory-adjustments.v1",
  "lebanonpos.stock-counts.v1",
  "lebanonpos.customers.v1",
  "lebanonpos.debt-sales.v1",
  "lebanonpos.debt-payments.v1",
  "lebanonpos.sales.v1",
  "lebanonpos.refunds.v1",
  "lebanonpos.held-sales.v1",
  "lebanonpos.expenses.v1",
  "lebanonpos.daily-closes.v1",
  "lebanonpos.suppliers.v1",
  "lebanonpos.purchase-orders.v1",
  "lebanonpos.supplier-payments.v1",
  "lebanonpos.settings.v1",
  "lebanonpos.users.v1",
  "lebanonpos.current-user.v1",
  "lebanonpos.session.v1",
  "lebanonpos.shifts.v1",
  "lebanonpos.audit.v1",
  "lebanonpos.sync-queue.v1",
  "lebanonpos.sync-last.v1",
] as const

/** Stores dropped entirely from the SAFE export — live session token + current
 *  login: no business-backup value and inherently sensitive. */
export const OMIT_FROM_SAFE: ReadonlySet<string> = new Set([
  "lebanonpos.session.v1",
  "lebanonpos.current-user.v1",
])

export const REDACTED = "***REDACTED***"

/** A field name that carries a credential/secret and must never leave the
 *  device in a safe backup. Deliberately narrow (exact names + a few safe
 *  substrings) so ordinary business fields are never falsely redacted. */
export function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase()
  return (
    k === "pin" ||
    k === "pinhash" ||
    k === "apikey" ||
    k === "cloudkey" ||
    k === "tenantkey" ||
    k === "licensekey" ||
    k === "superadmincode" ||
    k === "deviceid" ||
    k.includes("password") ||
    k.includes("token") ||
    k.includes("secret")
  )
}

/** Recursively replace any sensitive field's value with REDACTED. */
export function redactDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactDeep)
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveKey(k) ? REDACTED : redactDeep(v)
    }
    return out
  }
  return value
}

type Getter = (key: string) => string | null

/** Safe backup: business data, secrets redacted, session/identity omitted.
 *  Values are parsed JSON with redaction applied; non-JSON kept verbatim. */
export function buildSafeBackup(getItem: Getter): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  for (const key of BACKUP_KEYS) {
    if (OMIT_FROM_SAFE.has(key)) continue
    const raw = getItem(key)
    if (raw == null) {
      payload[key] = null
      continue
    }
    try {
      payload[key] = redactDeep(JSON.parse(raw))
    } catch {
      payload[key] = raw
    }
  }
  return payload
}

/** Raw backup: every store, verbatim (INCLUDES secrets). Admin + typed-confirm
 *  gated in the UI. */
export function buildRawBackup(getItem: Getter): Record<string, string | null> {
  const payload: Record<string, string | null> = {}
  for (const key of BACKUP_KEYS) payload[key] = getItem(key)
  return payload
}

/** Defensive shape check for an uploaded/parsed backup before any restore:
 *  must be a plain object containing at least one known backup store. */
export function isValidBackup(obj: unknown): boolean {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false
  const known = BACKUP_KEYS as readonly string[]
  return Object.keys(obj as Record<string, unknown>).some((k) => known.includes(k))
}
