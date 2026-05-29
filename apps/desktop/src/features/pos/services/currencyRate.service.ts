import { getSettings, saveSettings } from "./settings.service"
import { recordAuditEvent } from "./security.service"

const RATE_META_KEY = "lebanonpos.rate-meta.v1"
const RATE_EVENT = "lebanonpos-rate-changed"

/** Hours after which the rate is considered stale and the cashier is nudged. */
export const RATE_STALE_HOURS = 24

export type RateHistoryEntry = {
  rate: number
  at: string
  source: "manual" | "auto"
}

export type RateMeta = {
  lastUpdatedAt?: string
  history: RateHistoryEntry[]
  /** Optional URL that returns { rate: number } — if set, enables auto-fetch. */
  autoFetchUrl?: string
}

function canUseStorage() {
  return typeof window !== "undefined" && Boolean(window.localStorage)
}

export function getRateMeta(): RateMeta {
  if (!canUseStorage()) return { history: [] }
  try {
    const raw = window.localStorage.getItem(RATE_META_KEY)
    return raw ? (JSON.parse(raw) as RateMeta) : { history: [] }
  } catch {
    return { history: [] }
  }
}

function writeRateMeta(meta: RateMeta) {
  if (!canUseStorage()) return
  window.localStorage.setItem(RATE_META_KEY, JSON.stringify(meta))
  window.dispatchEvent(new Event(RATE_EVENT))
}

export function getCurrentRate(): number {
  return Math.max(1, getSettings().usdToLbpRate)
}

/** Percentage change a new rate represents vs the current one. */
export function rateChangePercent(newRate: number): number {
  const current = getCurrentRate()
  if (current <= 0) return 0
  return ((newRate - current) / current) * 100
}

/**
 * Update the live USD→LBP rate. Records history + timestamp and persists
 * to settings (the single source of truth used across the app).
 */
export function updateRate(newRate: number, source: "manual" | "auto" = "manual") {
  const rate = Math.max(1, Math.round(newRate))
  const previous = getCurrentRate()
  const settings = getSettings()
  saveSettings({ ...settings, usdToLbpRate: rate })

  const meta = getRateMeta()
  const now = new Date().toISOString()
  meta.lastUpdatedAt = now
  meta.history = [{ rate, at: now, source }, ...meta.history].slice(0, 30)
  writeRateMeta(meta)

  if (rate !== previous) {
    recordAuditEvent({
      action: "settings.rate_update",
      entity: "settings",
      summary: `Exchange rate updated ${previous.toLocaleString()} → ${rate.toLocaleString()} LBP/USD (${source}).`,
      metadata: { previous, rate, source },
    })
  }
  return rate
}

export function isRateStale(hours = RATE_STALE_HOURS): boolean {
  const meta = getRateMeta()
  if (!meta.lastUpdatedAt) return true
  const ageMs = Date.now() - new Date(meta.lastUpdatedAt).getTime()
  return ageMs > hours * 60 * 60 * 1000
}

export function rateAgeLabel(): string {
  const meta = getRateMeta()
  if (!meta.lastUpdatedAt) return "never updated"
  const ageMs = Date.now() - new Date(meta.lastUpdatedAt).getTime()
  const hours = Math.floor(ageMs / (60 * 60 * 1000))
  if (hours < 1) return "updated just now"
  if (hours < 24) return `updated ${hours}h ago`
  const days = Math.floor(hours / 24)
  return `updated ${days}d ago`
}

export function setAutoFetchUrl(url: string) {
  const meta = getRateMeta()
  meta.autoFetchUrl = url.trim() || undefined
  writeRateMeta(meta)
}

/**
 * Best-effort auto-fetch from a configured source URL.
 * Expects a JSON response containing a numeric `rate` (or `usdToLbp`) field.
 * Returns the new rate on success, or null if no source / fetch failed.
 */
export async function fetchRateFromSource(): Promise<number | null> {
  const meta = getRateMeta()
  if (!meta.autoFetchUrl) return null
  try {
    const res = await fetch(meta.autoFetchUrl)
    if (!res.ok) return null
    const data = await res.json()
    const rate = Number(data.rate ?? data.usdToLbp ?? data.value)
    if (!Number.isFinite(rate) || rate < 1) return null
    return updateRate(rate, "auto")
  } catch {
    return null
  }
}

export function subscribeRate(callback: () => void) {
  if (!canUseStorage()) return () => undefined
  const handler = () => callback()
  window.addEventListener(RATE_EVENT, handler)
  window.addEventListener("lebanonpos-settings-changed", handler)
  return () => {
    window.removeEventListener(RATE_EVENT, handler)
    window.removeEventListener("lebanonpos-settings-changed", handler)
  }
}
