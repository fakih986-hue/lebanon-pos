import { canUseStorage } from "../lib/storage"

const SETTINGS_KEY = "lebanonpos.settings.v1"
const SETTINGS_EVENT = "lebanonpos-settings-changed"

import { put } from "./db"
import { enqueueSyncOperation } from "./sync.service"

export type ConnectionMode = "STORE_HUB" | "CONNECT_TO_HUB" | "DIRECT_RAILWAY"

export type AppSettings = {
  storeName: string
  branchName: string
  phone: string
  address: string
  vatRate: number
  usdToLbpRate: number
  receiptFooter: string
  lowStockThreshold: number
  profitPercent1: number
  profitPercent2: number
  deliveryFee: number
  whatsAppAdmin: string
  whatsAppDriverEnabled: boolean
  assignMode: "manual" | "broadcast"
  assignTimeout: number
  defaultDriverId: string
  registerId?: string
  registerName?: string
}

export const defaultSettings: AppSettings = {
  storeName: "Titan POS",
  branchName: "Main Branch",
  phone: "+961 70 000 000",
  address: "Beirut, Lebanon",
  vatRate: 0.11,
  usdToLbpRate: 89500,
  receiptFooter: "Thank you for shopping with us.",
  lowStockThreshold: 10,
  profitPercent1: 25,
  profitPercent2: 35,
  deliveryFee: 2.0,
  whatsAppAdmin: "",
  whatsAppDriverEnabled: false,
  assignMode: "manual",
  assignTimeout: 5,
  defaultDriverId: "",
  registerName: "Main Register",
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
    const parsed = JSON.parse(storedSettings)
    const raw = Array.isArray(parsed) ? parsed[0] ?? {} : parsed
    return {
      ...defaultSettings,
      ...(raw as Partial<AppSettings>),
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
  put("settings", { id: "app", ...settings }).catch((e) => console.error("[settings] IndexedDB write failed:", e))
  window.dispatchEvent(new Event(SETTINGS_EVENT))
  enqueueSyncOperation({
    entity: "settings",
    action: "update",
    summary: "Business settings queued for sync.",
    payload: settings,
  })
}

export function getRegisterId(): string {
  return getSettings().registerId ?? "REG-001"
}

export function getRegisterName(): string {
  return getSettings().registerName ?? "Main Register"
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
