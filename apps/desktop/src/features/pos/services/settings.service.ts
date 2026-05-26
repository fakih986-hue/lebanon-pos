const SETTINGS_KEY = "lebanonpos.settings.v1"
const SETTINGS_EVENT = "lebanonpos-settings-changed"

import { put } from "./db"
import { enqueueSyncOperation } from "./sync.service"

export type AppSettings = {
  storeName: string
  branchName: string
  phone: string
  address: string
  vatRate: number
  usdToLbpRate: number
  receiptFooter: string
  lowStockThreshold: number
}

export const defaultSettings: AppSettings = {
  storeName: "Lebanon POS",
  branchName: "Main Branch",
  phone: "+961 70 000 000",
  address: "Beirut, Lebanon",
  vatRate: 0.11,
  usdToLbpRate: 89500,
  receiptFooter: "Thank you for shopping with us.",
  lowStockThreshold: 10,
}

function canUseStorage() {
  return typeof window !== "undefined" && Boolean(window.localStorage)
}

export function getSettings() {
  if (!canUseStorage()) {
    return defaultSettings
  }

  const storedSettings = window.localStorage.getItem(SETTINGS_KEY)

  if (!storedSettings) {
    return defaultSettings
  }

  try {
    return {
      ...defaultSettings,
      ...(JSON.parse(storedSettings) as Partial<AppSettings>),
    }
  } catch {
    console.warn(`[settings.service] Failed to parse storage key`)
    return defaultSettings
  }
}

export function saveSettings(settings: AppSettings) {
  if (!canUseStorage()) {
    return
  }

  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  put("settings", { id: "app", ...settings }).catch(() => {})
  window.dispatchEvent(new Event(SETTINGS_EVENT))
  enqueueSyncOperation({
    entity: "settings",
    action: "update",
    summary: "Business settings queued for sync.",
    payload: settings,
  })
}

export function subscribeSettings(callback: (settings: AppSettings) => void) {
  if (!canUseStorage()) {
    return () => undefined
  }

  function handleSettingsChanged() {
    callback(getSettings())
  }

  window.addEventListener(SETTINGS_EVENT, handleSettingsChanged)
  window.addEventListener("storage", handleSettingsChanged)

  return () => {
    window.removeEventListener(SETTINGS_EVENT, handleSettingsChanged)
    window.removeEventListener("storage", handleSettingsChanged)
  }
}
