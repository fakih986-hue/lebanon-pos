import { useEffect, useRef, useState } from "react"
import { useI18n } from "@lebanonpos/shared"
import { RatePanel } from "../../features/pos/components/RateManager"
import {
  BadgeDollarSign,
  Cloud,
  CloudOff,
  Copy,
  Download,
  Key,
  Lock,
  RotateCw,
  Save,
  Settings,
  Store,
  Truck,
  Upload,
} from "lucide-react"

import Spinner from "../../components/ui/Spinner"
import ConfirmDialog from "../../components/ConfirmDialog"
import {
  getSettings,
  saveSettings,
  subscribeSettings,
  type AppSettings,
} from "../../features/pos/services/settings.service"
import { recordAuditEvent } from "../../features/pos/services/security.service"
import {
  clearAuthToken,
  clearStoreData,
  flushSyncQueue,
  getApiUrl,
  getAuthToken,
  getConnectionMode,
  getKnownStores,
  getLocalApiUrl,
  getSyncQueue,
  getSyncStatus,
  isLanUrl,
  isLicenseBlocked,
  getLicenseStatus,
  copySyncDiagnosticsSummary,
  downloadSyncDiagnostics,
  pullFromServer,
  retryFailedSync,
  retrySingleSyncOperation,
  setApiUrl,
  setAuthToken,
  setConnectionMode,
  subscribeConnectionMode,
  subscribeSync,
  validateUrlForMode,
  type SyncOperation,
  type SyncStatus,
} from "../../features/pos/services/sync.service"
import type { ConnectionMode } from "../../features/pos/services/settings.service"
import { restoreIndexedDBToLocal } from "../../features/pos/services/storage.service"
import { showToast } from "../../features/pos/services/toast.service"
import WorkspaceTabs from "../../components/ui/WorkspaceTabs"

import { checkForUpdates, fetchReleaseManifest, clearUpdateCache } from "../../features/pos/services/update.service"
import {
  generatePairingCode,
  getDeviceList,
  renameDevice,
  revokeDevice,
  type PairedDevice,
} from "../../features/pos/services/deviceRegistry.service"
import { compareVersions, formatVersion, type UpdateStatus, type ReleaseManifest } from "../../features/pos/lib/version"

type SettingsWorkspace = "Business" | "Cloud sync" | "Security" | "Backup" | "Delivery" | "About"

// Pre-baked Railway URL (shown read-only in Cloud sync). Overridable for dev.
const CLOUD_URL_DISPLAY =
  (typeof window !== "undefined" && (window as { __LBPOS_CLOUD_URL__?: string }).__LBPOS_CLOUD_URL__) ||
  "https://pos.titan-suite.net"

function normalizeNumber(value: string) {
  const parsedValue = Number(value)

  return Number.isFinite(parsedValue) ? parsedValue : 0
}

function formatDateTime(value?: string) {
  if (!value) {
    return "Not yet"
  }

  return new Intl.DateTimeFormat("en-LB", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}

function getStatusClass(status: SyncOperation["status"]) {
  if (status === "Synced") {
    return "bg-sky-50 text-sky-800 ring-sky-200"
  }

  if (status === "Failed") {
    return "bg-rose-50 text-rose-800 ring-rose-200"
  }

  return "bg-amber-50 text-amber-800 ring-amber-200"
}

export default function SettingsPage() {
  const { t } = useI18n()
  const [isLoading, setIsLoading] = useState(true)
  const [settings, setSettings] = useState<AppSettings>(getSettings())
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(getSyncStatus())
  const [syncQueue, setSyncQueue] = useState<SyncOperation[]>(getSyncQueue())
  const [apiUrl, setApiUrlState] = useState(getApiUrl() ?? "")
  const [authToken, setAuthTokenState] = useState(getAuthToken() ?? "")
  const [connectionMode, setConnectionModeState] = useState<ConnectionMode>(getConnectionMode())
  const [serverUrl, setServerUrl] = useState(getApiUrl() ?? getLocalApiUrl())
  const [serverUrlError, setServerUrlError] = useState<string | null>(null)
  const [serverSaving, setServerSaving] = useState(false)

  // ── Hub LAN mode ──
  const [bindHost, setBindHost] = useState("127.0.0.1")
  const [showLanConfirm, setShowLanConfirm] = useState(false)
  // POS-UX-IA-1A: confirm the two data-danger actions (backup export exposes
  // secrets; restore overwrites local data). Grouped into a Danger zone below.
  const [showExportConfirm, setShowExportConfirm] = useState(false)
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false)
  const [lanIp, setLanIp] = useState("")
  const [copySuccess, setCopySuccess] = useState(false)
  const [pairedDevices, setPairedDevices] = useState<PairedDevice[]>([])
  const [pairingCode, setPairingCode] = useState<{ code: string; expiresAt: string } | null>(null)
  const [pairingCodeLoading, setPairingCodeLoading] = useState(false)
  const [pairingCodeCopied, setPairingCodeCopied] = useState(false)
  const [pairingCodeExpired, setPairingCodeExpired] = useState(false)
  const [renamingDevice, setRenamingDevice] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [revokingDevice, setRevokingDevice] = useState<string | null>(null)

  // ── Cloud bridge config (hub only) ──
  const [cloudTenantId, setCloudTenantId] = useState("")
  const [cloudApiKey, setCloudApiKey] = useState("")
  const [cloudAdminPw, setCloudAdminPw] = useState("")
  const [cloudSaving, setCloudSaving] = useState(false)
  const [cloudStatus, setCloudStatus] = useState<{ configured: boolean; running: boolean; tenantId?: string; lastPullAt?: string; hubOnly?: boolean } | null>(null)

  // ── Super admin lock ──
  const [superAdminUnlocked, setSuperAdminUnlocked] = useState(false)
  const [superAdminModalOpen, setSuperAdminModalOpen] = useState(false)
  const [superAdminCode, setSuperAdminCode] = useState("")
  const [superAdminVerifying, setSuperAdminVerifying] = useState(false)
  const superAdminTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [activeWorkspace, setActiveWorkspace] =
    useState<SettingsWorkspace>("Business")
  const [drivers, setDrivers] = useState<Array<{ id: string; name: string }>>([])

  // ── Update awareness ──
  const [installedVersion, setInstalledVersion] = useState<string | null>(null)
  const [updateStatus, setUpdateStatus] = useState<{ status: UpdateStatus; manifest: ReleaseManifest | null }>({ status: "unable-to-check", manifest: null })
  const [updateChecking, setUpdateChecking] = useState(false)

  useEffect(() => {
    const api = (window as { electronAPI?: { getAppVersion?: () => Promise<string> } }).electronAPI
    if (api?.getAppVersion) {
      api.getAppVersion().then(setInstalledVersion).catch(() => setInstalledVersion(null))
    }
  }, [])

  useEffect(() => {
    const api = (window as { electronAPI?: { getBindHost?: () => Promise<string>; getLocalIP?: () => Promise<string> } }).electronAPI
    if (api?.getBindHost) {
      api.getBindHost().then(setBindHost).catch(() => setBindHost("127.0.0.1"))
    }
    if (api?.getLocalIP) {
      api.getLocalIP().then(setLanIp).catch(() => setLanIp(""))
    }
    if (connectionMode === "STORE_HUB") {
      getDeviceList().then(setPairedDevices).catch(() => {})
    }
  }, [connectionMode])

  useEffect(() => {
    if (!installedVersion) return
    setUpdateChecking(true)
    checkForUpdates(installedVersion).then((result) => {
      setUpdateStatus(result)
      setUpdateChecking(false)
    }).catch(() => {
      setUpdateStatus({ status: "unable-to-check", manifest: null })
      setUpdateChecking(false)
    })
  }, [installedVersion])

  useEffect(() => {
    setIsLoading(false)
    return subscribeSettings(setSettings)
  }, [])

  useEffect(() => {
    if (activeWorkspace === "Delivery" && getApiUrl() && getAuthToken()) {
      fetch(`${getApiUrl()}/api/delivery/drivers`, {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      })
        .then(r => r.ok ? r.json() : [])
        .then(setDrivers)
        .catch(() => setDrivers([]))
    }
  }, [activeWorkspace])
  useEffect(
    () =>
      subscribeSync(() => {
        setSyncStatus(getSyncStatus())
        setSyncQueue(getSyncQueue())
      }),
    []
  )

  useEffect(
    () =>
      subscribeConnectionMode((mode) => {
        setConnectionModeState(mode)
        if (mode === "STORE_HUB") {
          setServerUrl(getLocalApiUrl())
        }
      }),
    []
  )

  // Load cloud bridge status when the Cloud sync tab opens (hub-only endpoint)
  useEffect(() => {
    if (activeWorkspace !== "Cloud sync") return
    fetch("/api/setup/cloud-config")
      .then(r => r.status === 403 ? { hubOnly: true } : r.json())
      .then(setCloudStatus)
      .catch(() => setCloudStatus(null))
  }, [activeWorkspace])

  async function handleSaveCloudConfig() {
    if (!cloudTenantId.trim() || !cloudApiKey.trim() || !cloudAdminPw.trim()) {
      showToast("Enter Tenant ID, Cloud API Key, and Admin Password.", "error")
      return
    }
    setCloudSaving(true)
    try {
      const res = await fetch("/api/setup/cloud-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: cloudTenantId.trim(),
          apiKey: cloudApiKey.trim(),
          adminPassword: cloudAdminPw.trim(),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? `Failed (HTTP ${res.status})`)
      setCloudStatus(data)
      setCloudApiKey("")
      setCloudAdminPw("")
      showToast("Cloud connected. Pulling store data…", "success")
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to connect cloud", "error")
    }
    setCloudSaving(false)
  }

  function startSuperAdminSession() {
    setSuperAdminUnlocked(true)
    setSuperAdminModalOpen(false)
    setSuperAdminCode("")
    if (superAdminTimerRef.current) clearTimeout(superAdminTimerRef.current)
    superAdminTimerRef.current = setTimeout(() => {
      setSuperAdminUnlocked(false)
      setSuperAdminCode("")
    }, 5 * 60 * 1000)
  }

  async function handleVerifySuperAdminCode() {
    if (!superAdminCode.trim()) {
      showToast("Enter the super admin code.", "error")
      return
    }
    const apiUrl = getApiUrl()
    if (!apiUrl) {
      showToast("Server URL is not configured.", "error")
      return
    }
    setSuperAdminVerifying(true)
    try {
      const res = await fetch(`${apiUrl}/api/auth/verify-super-admin-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: superAdminCode.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? `Failed (HTTP ${res.status})`)
      startSuperAdminSession()
      showToast("Cloud settings unlocked for 5 minutes.", "success")
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Verification failed", "error")
    }
    setSuperAdminVerifying(false)
  }

  useEffect(() => {
    return () => {
      if (superAdminTimerRef.current) clearTimeout(superAdminTimerRef.current)
    }
  }, [])

  function updateSettings(patch: Partial<AppSettings>) {
    setSettings((currentSettings) => ({
      ...currentSettings,
      ...patch,
    }))
  }

  const [settingsErrors, setSettingsErrors] = useState<Partial<Record<string, string>>>({})

  function handleSave() {
    const errors: Record<string, string> = {}
    if (!settings.storeName.trim()) errors.storeName = "Store name is required"
    if (!settings.branchName.trim()) errors.branchName = "Branch name is required"
    if (!settings.phone.trim()) errors.phone = "Phone is required"
    if (settings.vatRate < 0 || settings.vatRate > 1) errors.vatRate = "VAT rate must be between 0% and 100%"
    if (settings.usdToLbpRate < 1) errors.usdToLbpRate = "Exchange rate must be at least 1"

    setSettingsErrors(errors)
    if (Object.keys(errors).length > 0) {
      showToast("Please fix the highlighted fields.", "error")
      return
    }

    saveSettings(settings)
    recordAuditEvent({
      action: "settings.save",
      entity: "settings",
      summary: "Business settings were saved.",
      metadata: {
        vatRate: settings.vatRate,
        usdToLbpRate: settings.usdToLbpRate,
      },
    })
    if (getApiUrl() && getAuthToken()) {
      fetch(`${getApiUrl()}/api/delivery/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAuthToken()}` },
        body: JSON.stringify({
          deliveryFee: settings.deliveryFee,
          whatsAppAdmin: settings.whatsAppAdmin,
          whatsAppDriverEnabled: settings.whatsAppDriverEnabled,
          assignMode: settings.assignMode,
          assignTimeout: settings.assignTimeout,
          defaultDriverId: settings.defaultDriverId,
        }),
      }).catch(() => {})
    }
    showToast("Settings saved.")
  }

  function handleSyncNow() {
    void flushSyncQueue()
      .then(async (result) => {
        await pullFromServer(true)  // full pull to guarantee data loads
        setSyncStatus(getSyncStatus())
        setSyncQueue(getSyncQueue())
        showToast(
          result.synced > 0
            ? `${result.synced} item${result.synced === 1 ? "" : "s"} synced. Data refreshed.`
            : "Data refreshed from server."
        )
      })
      .catch((error) => {
        showToast(`Sync failed: ${error instanceof Error ? error.message : "Unknown error"}`, "error")
      })
  }

  function handleRetryFailed() {
    retryFailedSync()
    setSyncStatus(getSyncStatus())
    setSyncQueue(getSyncQueue())
    showToast("Failed sync items moved back to pending.")
  }

  function handleRetrySyncOperation(id: string) {
    retrySingleSyncOperation(id)
    setSyncStatus(getSyncStatus())
    setSyncQueue(getSyncQueue())
    showToast("Sync item moved back to pending.")
  }

  function handleDownloadSyncDiagnostics() {
    downloadSyncDiagnostics()
    showToast("Sync diagnostics exported.")
  }

  function handleCopySyncDiagnostics() {
    copySyncDiagnosticsSummary()
    showToast("Sync diagnostics copied.")
  }

  function handleSaveServer() {
    setApiUrl(apiUrl)
    if (authToken) {
      setAuthToken(authToken)
    } else {
      clearAuthToken()
    }
    showToast("Server connection saved. Loading your data…")
    void pullFromServer(true).then(() => {
      setSyncStatus(getSyncStatus())
      setSyncQueue(getSyncQueue())
      showToast("Data loaded from server.")
    }).catch(() => {
      showToast("Connection saved, but data pull failed. Tap Sync now.", "error")
    })
  }

  function handleSaveServerConnection() {
    setServerUrlError(null)
    const error = validateUrlForMode(serverUrl, connectionMode)
    if (error) {
      setServerUrlError(error)
      return
    }
    setServerSaving(true)
    setApiUrl(serverUrl)
    setConnectionMode(connectionMode)
    showToast("Connection saved. Loading your data…")
    void pullFromServer(true).then(() => {
      setSyncStatus(getSyncStatus())
      setSyncQueue(getSyncQueue())
      showToast("Data loaded from server.")
      setServerSaving(false)
    }).catch(() => {
      showToast("Connection saved, but data pull failed. Tap Sync now.", "error")
      setServerSaving(false)
    })
  }

  function handleModeChange(mode: ConnectionMode) {
    setConnectionModeState(mode)
    setConnectionMode(mode)
    setServerUrlError(null)
    if (mode === "STORE_HUB") {
      setServerUrl(getLocalApiUrl())
    }
  }

  async function handleToggleLan() {
    setShowLanConfirm(false)
    const api = (window as { electronAPI?: { setBindHost?: (v: "0.0.0.0" | "127.0.0.1") => Promise<{ ok: boolean; error?: string }> } }).electronAPI
    if (!api?.setBindHost) return
    const newValue = bindHost === "0.0.0.0" ? "127.0.0.1" : "0.0.0.0"
    const result = await api.setBindHost(newValue)
    if (result.ok) {
      setBindHost(newValue)
      showToast(newValue === "0.0.0.0" ? "LAN access enabled. API restarted." : "LAN access disabled. API restarted.")
    } else {
      showToast(result.error ?? "Failed to toggle LAN access", "error")
    }
  }

  async function handleGeneratePairingCode() {
    setPairingCodeLoading(true)
    setPairingCode(null)
    setPairingCodeExpired(false)
    try {
      const result = await generatePairingCode()
      setPairingCode({ code: result.code, expiresAt: result.expiresAt })
      const expiresMs = new Date(result.expiresAt).getTime() - Date.now()
      setTimeout(() => setPairingCodeExpired(true), Math.max(0, expiresMs))
      showToast("Pairing code generated. Share it with the device you want to pair.")
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to generate code", "error")
    } finally {
      setPairingCodeLoading(false)
    }
  }

  async function handleRenameDevice(deviceId: string) {
    try {
      await renameDevice(deviceId, renameValue)
      setPairedDevices((prev) => prev.map((d) => d.deviceId === deviceId ? { ...d, deviceName: renameValue } : d))
      setRenamingDevice(null)
      setRenameValue("")
      showToast("Device renamed.")
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to rename", "error")
    }
  }

  async function handleRevokeDevice(deviceId: string) {
    try {
      await revokeDevice(deviceId)
      setPairedDevices((prev) => prev.map((d) => d.deviceId === deviceId ? { ...d, status: "REVOKED" } : d))
      setRevokingDevice(null)
      showToast("Device revoked. It can no longer sync with this hub.")
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to revoke", "error")
    }
  }

  async function handleRestoreFromIndexedDB() {
    const count = await restoreIndexedDBToLocal()
    showToast(count > 0 ? `Restored ${count} stores from IndexedDB.` : "No stores needed restoring.")
  }

  function downloadRecoveryCard() {
    const users = JSON.parse(localStorage.getItem("lebanonpos.users.v1") ?? "[]") as Array<{ name: string; role: string }>
    const staffLines = users.map((u) => `  - ${u.name} (${u.role})`).join("\n")
    const card = [
      "================================",
      "  LEBANON POS — RECOVERY CARD",
      "================================",
      "",
      `Store:       ${settings.storeName || "—"}`,
      `Branch:      ${settings.branchName || "—"}`,
      `Server URL:  ${getApiUrl() || "(not set)"}`,
      `Subdomain:   ${(() => { try { const stores = getKnownStores(); const m = stores.find(s => s.apiUrl === getApiUrl()); return m?.subdomain || "default" } catch { return "default" } })()}`,
      "",
      "Staff (log in with each person's PIN — PINs are NOT stored here for security):",
      staffLines || "  (none)",
      "",
      "--------------------------------",
      "TO RECOVER ON A NEW DEVICE:",
      "  1. Install / open Lebanon POS",
      "  2. On the login screen tap 'New device? Connect to your store'",
      "  3. Enter the Server URL + Subdomain above",
      "  4. Enter your PIN  →  all your data downloads",
      "--------------------------------",
      "",
      `Generated: ${new Date().toLocaleString()}`,
      "Keep this card safe (email it to yourself or save to your phone/Drive).",
    ].join("\n")

    const blob = new Blob([card], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `lebanonpos-recovery-card-${new Date().toISOString().slice(0, 10)}.txt`
    link.click()
    URL.revokeObjectURL(url)
    showToast("Recovery card downloaded. Save it somewhere safe off this device.")
  }

  function exportData() {
    const keys = [
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
    ]
    const payload = keys.reduce<Record<string, string | null>>((data, key) => {
      data[key] = window.localStorage.getItem(key)
      return data
    }, {})
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")

    link.href = url
    link.download = `lebanonpos-backup-${new Date()
      .toISOString()
      .slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
    showToast("Backup exported.")
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-page p-3 sm:p-5 xl:p-6">
      {isLoading ? (
        <div className="flex min-h-[400px] items-center justify-center p-6">
          <Spinner label={t("pos.settings.loading")} />
        </div>
      ) : (
      <>
      <WorkspaceTabs<SettingsWorkspace>
        className="mb-5"
        active={activeWorkspace}
        onChange={setActiveWorkspace}
        tabs={[
          { label: "Business" },
          { label: "Delivery" },
          { label: "Cloud sync", count: syncStatus.pending + syncStatus.failed },
          { label: "Security" },
          { label: "Backup" },
          { label: "About" },
        ]}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        {activeWorkspace === "Business" ? (
        <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
          <div className="border-b border-zinc-200 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                <Store size={22} />
              </div>
              <div>
              <h2 className="text-xl font-bold text-zinc-950">
                Offline sync
              </h2>
              <p className="text-sm text-zinc-500">
                Last sync: {formatDateTime(syncStatus.lastSyncedAt)}
              </p>
              {syncStatus.failed > 0 && (
                <span className="rounded-full px-2 py-0.5 text-[10px] font-bold bg-rose-100 text-rose-700 ml-2">{syncStatus.failed} failed</span>
              )}
              {syncStatus.pending > 10 && (
                <span className="rounded-full px-2 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-700 ml-1">{syncStatus.pending} pending</span>
              )}
              </div>
            </div>
          </div>

          <div className="grid gap-4 p-4 md:grid-cols-2">
            <label className="block text-sm font-bold text-zinc-700">
              Store name
              <input
              value={settings.storeName}
              onChange={(event) => {
                updateSettings({ storeName: event.target.value })
                setSettingsErrors((prev) => ({ ...prev, storeName: undefined }))
              }}
              aria-label="Store name"
              aria-describedby={settingsErrors.storeName ? "storeName-error" : undefined}
                className={`mt-2 h-11 w-full rounded-lg border px-3 font-medium outline-none focus:ring-4 ${
                  settingsErrors.storeName
                    ? "border-rose-300 bg-rose-50 focus:border-rose-400 focus:ring-rose-100"
                    : "border-zinc-200 bg-zinc-50 focus:border-emerald-400 focus:bg-white focus:ring-emerald-100"
                }`}
              />
              {settingsErrors.storeName ? (
                <p id="storeName-error" className="mt-1 text-xs font-medium text-rose-600">{settingsErrors.storeName}</p>
              ) : null}
            </label>

            <label className="block text-sm font-bold text-zinc-700">
              Branch
              <input
                value={settings.branchName}
                onChange={(event) => {
                  updateSettings({ branchName: event.target.value })
                  setSettingsErrors((prev) => ({ ...prev, branchName: undefined }))
                }}
                className={`mt-2 h-11 w-full rounded-lg border px-3 font-medium outline-none focus:ring-4 ${
                  settingsErrors.branchName
                    ? "border-rose-300 bg-rose-50 focus:border-rose-400 focus:ring-rose-100"
                    : "border-zinc-200 bg-zinc-50 focus:border-emerald-400 focus:bg-white focus:ring-emerald-100"
                }`}
              />
              {settingsErrors.branchName ? (
                <p className="mt-1 text-xs font-medium text-rose-600">{settingsErrors.branchName}</p>
              ) : null}
            </label>

            <label className="block text-sm font-bold text-zinc-700">
              Phone
              <input
                value={settings.phone}
                onChange={(event) => {
                  updateSettings({ phone: event.target.value })
                  setSettingsErrors((prev) => ({ ...prev, phone: undefined }))
                }}
                className={`mt-2 h-11 w-full rounded-lg border px-3 font-medium outline-none focus:ring-4 ${
                  settingsErrors.phone
                    ? "border-rose-300 bg-rose-50 focus:border-rose-400 focus:ring-rose-100"
                    : "border-zinc-200 bg-zinc-50 focus:border-emerald-400 focus:bg-white focus:ring-emerald-100"
                }`}
              />
              {settingsErrors.phone ? (
                <p className="mt-1 text-xs font-medium text-rose-600">{settingsErrors.phone}</p>
              ) : null}
            </label>

            <label className="block text-sm font-bold text-zinc-700">
              VAT rate
              <input
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={settings.vatRate}
                onChange={(event) => {
                  updateSettings({ vatRate: normalizeNumber(event.target.value) })
                  setSettingsErrors((prev) => ({ ...prev, vatRate: undefined }))
                }}
                className={`mt-2 h-11 w-full rounded-lg border px-3 font-medium outline-none focus:ring-4 ${
                  settingsErrors.vatRate
                    ? "border-rose-300 bg-rose-50 focus:border-rose-400 focus:ring-rose-100"
                    : "border-zinc-200 bg-zinc-50 focus:border-emerald-400 focus:bg-white focus:ring-emerald-100"
                }`}
              />
              {settingsErrors.vatRate ? (
                <p className="mt-1 text-xs font-medium text-rose-600">{settingsErrors.vatRate}</p>
              ) : null}
            </label>

            <div className="md:col-span-2">
              <RatePanel />
            </div>
            <label className="block text-sm font-bold text-zinc-700">
              Register name
              <input
                value={settings.registerName ?? ""}
                onChange={(event) => {
                  updateSettings({ registerName: event.target.value })
                  setSettingsErrors((prev) => ({ ...prev, registerName: undefined }))
                }}
                className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 font-medium outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </label>
            <label className="block text-sm font-bold text-zinc-700">
              Register ID
              <input
                value={settings.registerId ?? ""}
                onChange={(event) => {
                  updateSettings({ registerId: event.target.value })
                  setSettingsErrors((prev) => ({ ...prev, registerId: undefined }))
                }}
                placeholder="e.g. REG-001"
                className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 font-mono text-xs outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
              <p className="mt-1 text-xs text-zinc-500">Used to identify this register across devices. Shared when synced.</p>
            </label>

            <label className="block text-sm font-bold text-zinc-700">
              Address
              <input
                value={settings.address}
                onChange={(event) =>
                  updateSettings({ address: event.target.value })
                }
                className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 font-medium outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </label>

            <label className="block text-sm font-bold text-zinc-700">
              Low stock threshold
              <input
                type="number"
                min="0"
                value={settings.lowStockThreshold}
                onChange={(event) =>
                  updateSettings({
                    lowStockThreshold: normalizeNumber(event.target.value),
                  })
                }
                className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 font-medium outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </label>

            <div className="grid grid-cols-2 gap-4">
              <label className="block text-sm font-bold text-zinc-700">
                Profit margin 1 (%)
                <input
                  type="number"
                  min="0"
                  max="999"
                  value={settings.profitPercent1}
                  onChange={(event) =>
                    updateSettings({
                      profitPercent1: normalizeNumber(event.target.value),
                    })
                  }
                  className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 font-medium outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                />
              </label>
              <label className="block text-sm font-bold text-zinc-700">
                Profit margin 2 (%)
                <input
                  type="number"
                  min="0"
                  max="999"
                  value={settings.profitPercent2}
                  onChange={(event) =>
                    updateSettings({
                      profitPercent2: normalizeNumber(event.target.value),
                    })
                  }
                  className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 font-medium outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                />
              </label>
            </div>

            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              <div className="mb-2 flex items-center gap-2 font-bold">
                <BadgeDollarSign size={17} />
                Cash desk currency
              </div>
              POS totals stay in USD while cashiers can collect USD, LBP, or
              mixed cash. Change is calculated from this exchange rate.
            </div>

            <label className="block text-sm font-bold text-zinc-700 md:col-span-2">
              Receipt footer
              <textarea
                value={settings.receiptFooter}
                onChange={(event) =>
                  updateSettings({ receiptFooter: event.target.value })
                }
                rows={3}
                className="mt-2 w-full resize-none rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 font-medium outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </label>
          </div>

          <div className="flex justify-end border-t border-zinc-200 p-4">
            <button
              type="button"
              onClick={handleSave}
              aria-label="Save business settings"
              className="flex h-11 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-bold text-white transition hover:bg-emerald-500"
            >
              <Save size={17} />
              Save Settings
            </button>
          </div>
        </section>
        ) : null}

        {activeWorkspace === "Delivery" ? (
        <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
          <div className="border-b border-zinc-200 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
                <Truck size={22} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-zinc-950">
                  Delivery settings
                </h2>
                <p className="text-sm text-zinc-500">
                  Delivery fee, WhatsApp notifications, and driver assignment.
                </p>
              </div>
            </div>
          </div>
          <div className="grid gap-4 p-4 md:grid-cols-2">
            <label className="block text-sm font-bold text-zinc-700">
              Delivery fee ($)
              <input type="number" min="0" step="0.5"
                value={settings.deliveryFee}
                onChange={(event) => updateSettings({ deliveryFee: normalizeNumber(event.target.value) })}
                className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 font-medium outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100" />
            </label>
            <label className="block text-sm font-bold text-zinc-700">
              WhatsApp admin number
              <input value={settings.whatsAppAdmin}
                onChange={(event) => updateSettings({ whatsAppAdmin: event.target.value })}
                placeholder="+96170123456"
                className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 font-medium outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100" />
            </label>
            <label className="block text-sm font-bold text-zinc-700">
              Driver WhatsApp enabled
              <select value={settings.whatsAppDriverEnabled ? "true" : "false"}
                onChange={(event) => updateSettings({ whatsAppDriverEnabled: event.target.value === "true" })}
                className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 font-medium outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100">
                <option value="false">Disabled</option>
                <option value="true">Enabled</option>
              </select>
            </label>
            <label className="block text-sm font-bold text-zinc-700">
              Assign mode
              <select value={settings.assignMode}
                onChange={(event) => updateSettings({ assignMode: event.target.value as "manual" | "broadcast" })}
                className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 font-medium outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100">
                <option value="manual">Manual (admin assigns)</option>
                <option value="broadcast">Broadcast (first driver accepts)</option>
              </select>
            </label>
            <label className="block text-sm font-bold text-zinc-700">
              Assign timeout (minutes)
              <input type="number" min="1" max="60"
                value={settings.assignTimeout}
                onChange={(event) => updateSettings({ assignTimeout: normalizeNumber(event.target.value) })}
                className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 font-medium outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100" />
            </label>
            <label className="block text-sm font-bold text-zinc-700">
              Default driver (auto-assign)
              <select value={settings.defaultDriverId}
                onChange={(event) => updateSettings({ defaultDriverId: event.target.value })}
                className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 font-medium outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100">
                <option value="">None (manual or broadcast)</option>
                {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
            <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-900 flex items-start gap-2">
              <Truck size={17} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-bold mb-1">Delivery config is local</p>
                Settings are saved on this device. The API delivery settings (fee, WhatsApp, assign mode) are managed per tenant on the server and affect the ordering app, driver app, and admin panel.
              </div>
            </div>
          </div>
          <div className="flex justify-end border-t border-zinc-200 p-4">
            <button type="button" onClick={handleSave}
              aria-label="Save delivery settings"
              className="flex h-11 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-bold text-white transition hover:bg-emerald-500">
              <Save size={17} />
              Save Settings
            </button>
          </div>
        </section>
        ) : null}

        {activeWorkspace === "Security" ? (
        <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
          <div className="border-b border-zinc-200 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-rose-100 text-rose-700">
                <Settings size={22} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-zinc-950">
                  Production security
                </h2>
                <p className="text-sm text-zinc-500">
                  The register is protected locally and ready for stricter cloud controls.
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-3 p-4 md:grid-cols-2">
            {[
              {
                title: "Auto-lock register",
                detail: "The register locks after idle time and requires PIN unlock.",
                status: "Active",
              },
              {
                title: "Role-based permissions",
                detail: "Checkout, refunds, inventory, accounting, staff, and settings are gated by role.",
                status: "Active",
              },
              {
                title: "Cloud token",
                detail: authToken ? "This device has an auth token saved for sync." : "No auth token is saved on this device.",
                status: authToken ? "Connected" : "Action needed",
              },
              {
                title: "PIN hardening",
                detail: "Next production step: hashed PINs and forced PIN change for seeded users.",
                status: "Planned",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="rounded-lg border border-zinc-200 bg-zinc-50 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-zinc-950">{item.title}</p>
                    <p className="mt-1 text-sm font-medium text-zinc-500">
                      {item.detail}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-bold text-zinc-700 ring-1 ring-zinc-200">
                    {item.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
        ) : null}

        {activeWorkspace === "About" ? (
        <section className="rounded-xl border bg-white p-5 shadow-sm" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-3 mb-5">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg" style={{ background: "var(--brand-soft)" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--brand)" }}>
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4" />
                <path d="M12 8h.01" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-bold" style={{ color: "var(--text)" }}>About Titan POS</h2>
              <p className="text-sm" style={{ color: "var(--text-3)" }}>Installed version and update status</p>
            </div>
          </div>

          <div className="space-y-3">
            {/* Installed version */}
            <div className="flex items-center justify-between rounded-lg border p-3.5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
              <span className="text-sm font-medium" style={{ color: "var(--text-2)" }}>Installed version</span>
              <span className="text-sm font-bold font-mono" style={{ color: "var(--text)" }}>
                {installedVersion ? `v${formatVersion(installedVersion)}` : "—"}
              </span>
            </div>

            {/* Latest available */}
            <div className="flex items-center justify-between rounded-lg border p-3.5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
              <span className="text-sm font-medium" style={{ color: "var(--text-2)" }}>Latest available</span>
              <span className="text-sm font-bold font-mono" style={{ color: "var(--text)" }}>
                {updateStatus.manifest ? `v${formatVersion(updateStatus.manifest.version)}` : "—"}
              </span>
            </div>

            {/* Update status */}
            <div className="flex items-center justify-between rounded-lg border p-3.5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
              <span className="text-sm font-medium" style={{ color: "var(--text-2)" }}>Status</span>
              <span className="text-sm font-bold">
                {updateChecking ? (
                  <span style={{ color: "var(--text-3)" }}>Checking...</span>
                ) : updateStatus.status === "up-to-date" ? (
                  <span style={{ color: "var(--success)" }}>Up to date</span>
                ) : updateStatus.status === "update-available" ? (
                  <span style={{ color: "var(--info)" }}>Update available</span>
                ) : updateStatus.status === "update-required" ? (
                  <span style={{ color: "var(--rose)" }}>Update required</span>
                ) : (
                  <span style={{ color: "var(--text-3)" }}>Unable to check</span>
                )}
              </span>
            </div>

            {/* Channel */}
            {updateStatus.manifest && (
              <div className="flex items-center justify-between rounded-lg border p-3.5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
                <span className="text-sm font-medium" style={{ color: "var(--text-2)" }}>Channel</span>
                <span className="text-sm font-bold capitalize" style={{ color: "var(--text)" }}>
                  {updateStatus.manifest.channel}
                </span>
              </div>
            )}

            {/* Release notes */}
            {updateStatus.manifest?.releaseNotes && (
              <details className="rounded-lg border" style={{ borderColor: "var(--border)" }}>
                <summary className="cursor-pointer px-3.5 py-2.5 text-sm font-bold" style={{ color: "var(--text)" }}>
                  Release notes
                </summary>
                <div className="border-t px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text-2)", borderColor: "var(--border)" }}>
                  {updateStatus.manifest.releaseNotes}
                </div>
              </details>
            )}

            {/* Action buttons */}
            <div className="flex gap-2 pt-1">
              {(updateStatus.status === "update-available" || updateStatus.status === "update-required") && updateStatus.manifest?.downloadUrl && (
                <a
                  href={updateStatus.manifest.downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg text-sm font-bold text-white transition hover:opacity-90"
                  style={{ background: "var(--brand)" }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Download update
                </a>
              )}
              <button
                type="button"
                onClick={() => {
                  clearUpdateCache()
                  if (installedVersion) {
                    setUpdateChecking(true)
                    checkForUpdates(installedVersion).then(setUpdateStatus).finally(() => setUpdateChecking(false))
                  }
                }}
                className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border text-sm font-bold transition hover:opacity-80"
                style={{ borderColor: "var(--border)", color: "var(--text-2)" }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                Check again
              </button>
            </div>
          </div>

          <div className="mt-4 rounded-lg border p-3" style={{ borderColor: "var(--border-soft)", background: "var(--surface-3)" }}>
            <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-3)" }}>
              Titan POS v{installedVersion ? formatVersion(installedVersion) : "—"} · {updateStatus.manifest?.channel ?? "—"} channel
            </p>
          </div>
        </section>
        ) : null}

        <aside className="space-y-5">
          {activeWorkspace === "Cloud sync" ? (
          <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                <Cloud size={21} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-zinc-950">Connection</h2>
                <p className="text-sm text-zinc-500">How this device connects</p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {(["STORE_HUB", "CONNECT_TO_HUB", "DIRECT_RAILWAY"] as const).map((mode) => (
                <label key={mode} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
                  connectionMode === mode
                    ? "border-emerald-300 bg-emerald-50"
                    : "border-zinc-200 bg-zinc-50 hover:bg-zinc-100"
                }`}>
                  <input
                    type="radio"
                    name="connectionMode"
                    value={mode}
                    checked={connectionMode === mode}
                    onChange={() => handleModeChange(mode)}
                    className="mt-0.5 h-4 w-4 accent-emerald-600"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-zinc-900">
                      {mode === "STORE_HUB" ? "Store Hub" :
                       mode === "CONNECT_TO_HUB" ? "Connect to Hub" :
                       "Direct to Cloud"}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {mode === "STORE_HUB"
                        ? "This device runs the local API. Others on the LAN can connect to it."
                        : mode === "CONNECT_TO_HUB"
                        ? "Connects to a hub device on your local network."
                        : "Connects directly to the Railway cloud server."}
                    </p>
                  </div>
                </label>
              ))}
            </div>

            <div className="mt-4">
              <label className="block text-sm font-bold text-zinc-700">
                {connectionMode === "STORE_HUB"
                  ? "Local API URL"
                  : connectionMode === "CONNECT_TO_HUB"
                  ? "Hub LAN URL"
                  : "Cloud Server URL"}
                <input
                  value={connectionMode === "STORE_HUB" ? getLocalApiUrl() : serverUrl}
                  onChange={(e) => { setServerUrl(e.target.value); setServerUrlError(null) }}
                  readOnly={connectionMode === "STORE_HUB"}
                  placeholder={
                    connectionMode === "CONNECT_TO_HUB"
                      ? "http://192.168.1.100:3015"
                      : "https://your-app.railway.app"
                  }
                  className={`mt-2 h-11 w-full rounded-lg border px-3 font-mono text-xs outline-none ${
                    connectionMode === "STORE_HUB"
                      ? "border-zinc-200 bg-zinc-100 text-zinc-500 cursor-not-allowed"
                      : serverUrlError
                      ? "border-rose-300 bg-rose-50 focus:border-rose-400 focus:ring-4 focus:ring-rose-100"
                      : "border-zinc-200 bg-zinc-50 focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                  }`}
                />
                {serverUrlError && (
                  <p className="mt-1 text-xs font-medium text-rose-600">{serverUrlError}</p>
                )}
              </label>

              {connectionMode === "CONNECT_TO_HUB" && (
                <p className="mt-2 text-xs text-zinc-500 leading-relaxed">
                  Enter the LAN address of your hub device (e.g., http://192.168.1.100:3015).
                  Find this in the hub's Settings → Connection.
                </p>
              )}
              {connectionMode === "DIRECT_RAILWAY" && (
                <p className="mt-2 text-xs text-zinc-500 leading-relaxed">
                  Enter your Railway app URL (e.g., https://your-app.railway.app).
                  Get this from your Railway dashboard.
                </p>
              )}
              {connectionMode === "STORE_HUB" && (
                <p className="mt-2 text-xs text-zinc-500 leading-relaxed">
                  Your local API runs at {getLocalApiUrl()}. Other devices on your LAN
                  can connect to your hub's LAN IP (e.g., http://192.168.1.50:3015).
                  {!isLanUrl(serverUrl) && (
                    <span className="block mt-1 text-amber-600 font-semibold">
                      Hub mode requires a localhost URL. Switch to Connect to Hub or Direct to Cloud if
                      this is not a hub device.
                    </span>
                  )}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={handleSaveServerConnection}
              disabled={serverSaving || (connectionMode === "STORE_HUB" ? false : !serverUrl.trim())}
              className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 text-sm font-bold text-white transition hover:bg-emerald-500 disabled:opacity-50"
            >
              <Save size={16} />
              {serverSaving ? "Saving…" : "Save Connection"}
            </button>
          </section>
          ) : null}

          {activeWorkspace === "Cloud sync" ? (
          <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${
                connectionMode === "STORE_HUB" ? "bg-emerald-100 text-emerald-700" :
                syncStatus.online ? "bg-sky-100 text-sky-700" : "bg-rose-100 text-rose-700"
              }`}>
                {connectionMode === "STORE_HUB" ? <Store size={21} /> :
                 syncStatus.online ? <Cloud size={21} /> : <CloudOff size={21} />}
              </div>
              <div>
                <h2 className="text-lg font-bold text-zinc-950">Hub status</h2>
                <p className="text-sm text-zinc-500">
                  Mode: {connectionMode === "STORE_HUB" ? "Store Hub" :
                         connectionMode === "CONNECT_TO_HUB" ? "Hub Client" : "Direct to Cloud"}
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <span className="text-sm font-medium text-zinc-700">API reachable</span>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                  syncStatus.online
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-rose-100 text-rose-800"
                }`}>
                  {syncStatus.online ? "Online" : "Offline"}
                </span>
              </div>

              {connectionMode === "STORE_HUB" && (
                <>
                  <div className="flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                    <span className="text-sm font-medium text-zinc-700">BIND_HOST</span>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                      bindHost === "0.0.0.0"
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-amber-100 text-amber-800"
                    }`}>
                      {bindHost}
                    </span>
                  </div>
                  {lanIp && bindHost === "0.0.0.0" && (
                    <div className="flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                      <span className="text-sm font-medium text-zinc-700">LAN IP</span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-zinc-600">{lanIp}:3015</span>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(`http://${lanIp}:3015`)
                            setCopySuccess(true)
                            setTimeout(() => setCopySuccess(false), 2000)
                          }}
                          className="flex h-7 w-7 items-center justify-center rounded-md transition hover:bg-zinc-200"
                          title="Copy LAN URL"
                        >
                          {copySuccess ? (
                            <span className="text-xs font-bold text-emerald-600">✓</span>
                          ) : (
                            <Copy size={14} />
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowLanConfirm(true)}
                    className={`flex h-11 w-full items-center justify-center gap-2 rounded-lg text-sm font-bold transition ${
                      bindHost === "0.0.0.0"
                        ? "border border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100"
                        : "bg-emerald-600 text-white hover:bg-emerald-500"
                    }`}
                  >
                    {bindHost === "0.0.0.0" ? "Disable LAN Access" : "Enable LAN Access"}
                  </button>

                  {bindHost === "0.0.0.0" && (
                    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                      <p className="text-sm font-bold text-zinc-700">Pairing code</p>
                      <p className="mt-1 text-xs text-zinc-500">
                        Generate a code to pair a new device. Enter it on the device's login screen.
                      </p>
                      {pairingCode && !pairingCodeExpired ? (
                        <div className="mt-3 space-y-2">
                          <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                            <span className="font-mono text-lg font-black tracking-widest text-emerald-800">{pairingCode.code}</span>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(pairingCode.code)
                                setPairingCodeCopied(true)
                                setTimeout(() => setPairingCodeCopied(false), 2000)
                              }}
                              className="flex h-8 w-8 items-center justify-center rounded-md transition hover:bg-emerald-200"
                            >
                              {pairingCodeCopied ? <span className="text-xs font-bold text-emerald-700">✓</span> : <Copy size={14} />}
                            </button>
                          </div>
                          <p className="text-xs text-amber-600 font-semibold">Expires in 10 minutes</p>
                        </div>
                      ) : pairingCodeExpired ? (
                        <p className="mt-2 text-xs text-rose-600 font-semibold">Code expired. Generate a new one.</p>
                      ) : null}
                      <button
                        type="button"
                        onClick={handleGeneratePairingCode}
                        disabled={pairingCodeLoading}
                        className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-zinc-800 text-xs font-bold text-white transition hover:bg-zinc-700 disabled:opacity-50"
                      >
                        <Key size={14} />
                        {pairingCodeLoading ? "Generating…" : pairingCode ? "Regenerate Code" : "Generate Pairing Code"}
                      </button>
                    </div>
                  )}
                </>
              )}

              {connectionMode === "CONNECT_TO_HUB" && (
                <p className="text-xs text-zinc-500 leading-relaxed px-1">
                  This device connects to a hub on your LAN. Make sure the hub's
                  LAN access is enabled and you have the correct IP address.
                </p>
              )}

              {connectionMode === "DIRECT_RAILWAY" && (
                <p className="text-xs text-zinc-500 leading-relaxed px-1">
                  This device connects directly to Railway. No local hub needed.
                </p>
              )}
            </div>
          </section>
          ) : null}

          {activeWorkspace === "Cloud sync" && connectionMode === "STORE_HUB" ? (
          <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
                <Settings size={21} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-zinc-950">Device management</h2>
                <p className="text-sm text-zinc-500">Only approved devices can sync to this hub</p>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {pairedDevices.length === 0 ? (
                <p className="text-sm text-zinc-500 py-2">No paired devices yet. Generate a pairing code to add one.</p>
              ) : pairedDevices.map((device) => (
                <div key={device.deviceId} className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-zinc-900 truncate">{device.deviceName || device.deviceId}</p>
                      <p className="mt-0.5 text-[11px] font-mono text-zinc-400 truncate">{device.deviceId}</p>
                      <p className="mt-1 text-[11px] text-zinc-500">
                        {device.registerId && <>Reg: {device.registerId}</>}
                        {device.registerId && device.lastIp && <> · </>}
                        {device.lastIp && <>IP: {device.lastIp}</>}
                      </p>
                      <p className="text-[11px] text-zinc-400">
                        First seen: {new Date(device.firstSeenAt).toLocaleDateString()} · Last: {new Date(device.lastSeenAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        device.status === "APPROVED" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
                      }`}>
                        {device.status === "APPROVED" ? "Active" : "Revoked"}
                      </span>
                    </div>
                  </div>
                  <div className="mt-2 flex gap-2">
                    {renamingDevice === device.deviceId ? (
                      <div className="flex flex-1 gap-1">
                        <input
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleRenameDevice(device.deviceId) }}
                          placeholder="New name"
                          className="h-8 flex-1 rounded-md border border-zinc-200 px-2 text-xs outline-none focus:border-emerald-400"
                          autoFocus
                        />
                        <button onClick={() => handleRenameDevice(device.deviceId)} className="h-8 rounded-md bg-emerald-600 px-2 text-xs font-bold text-white">Save</button>
                        <button onClick={() => { setRenamingDevice(null); setRenameValue("") }} className="h-8 rounded-md border border-zinc-200 px-2 text-xs font-bold text-zinc-600">Cancel</button>
                      </div>
                    ) : (
                      <>
                        <button onClick={() => { setRenamingDevice(device.deviceId); setRenameValue(device.deviceName) }} className="h-8 rounded-md border border-zinc-200 px-2.5 text-xs font-bold text-zinc-600 transition hover:bg-zinc-100">Rename</button>
                        {device.status === "APPROVED" && (
                          <button onClick={() => setRevokingDevice(device.deviceId)} className="h-8 rounded-md border border-rose-200 px-2.5 text-xs font-bold text-rose-600 transition hover:bg-rose-50">Revoke</button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
          ) : null}

          {activeWorkspace === "Cloud sync" ? (
          <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-11 w-11 items-center justify-center rounded-lg ${
                    syncStatus.online
                      ? "bg-sky-100 text-sky-700"
                      : "bg-rose-100 text-rose-700"
                  }`}
                >
                  {syncStatus.online ? <Cloud size={21} /> : <CloudOff size={21} />}
                </div>
                <div>
                  <h2 className="text-lg font-bold text-zinc-950">
                    Offline sync
                  </h2>
                  <p className="text-sm text-zinc-500">
                    Last sync: {formatDateTime(syncStatus.lastSyncedAt)}
                  </p>
                </div>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-bold ${
                  syncStatus.online
                    ? "bg-sky-50 text-sky-800"
                    : "bg-rose-50 text-rose-800"
                }`}
              >
                {syncStatus.online ? "Online" : "Offline"}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <p className="text-xs font-bold uppercase text-zinc-500">
                  Pending
                </p>
                <p className="text-2xl font-bold text-zinc-950">
                  {syncStatus.pending}
                </p>
              </div>
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <p className="text-xs font-bold uppercase text-zinc-500">
                  Synced
                </p>
                <p className="text-2xl font-bold text-zinc-950">
                  {syncStatus.synced}
                </p>
              </div>
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <p className="text-xs font-bold uppercase text-zinc-500">
                  Failed
                </p>
                <p className="text-2xl font-bold text-zinc-950">
                  {syncStatus.failed}
                </p>
              </div>
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <p className="text-xs font-bold uppercase text-zinc-500">
                  Rejected
                </p>
                <p className="text-2xl font-bold text-zinc-950">
                  {syncStatus.rejected}
                </p>
              </div>
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <p className="text-xs font-bold uppercase text-zinc-500">
                  Dead
                </p>
                <p className="text-2xl font-bold text-zinc-950">
                  {syncStatus.dead}
                </p>
              </div>
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <p className="text-xs font-bold uppercase text-zinc-500">
                  Total
                </p>
                <p className="text-2xl font-bold text-zinc-950">
                  {syncStatus.total}
                </p>
              </div>
            </div>

            {syncStatus.lastError ? (
              <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800">
                Last sync error: {syncStatus.lastError}
              </div>
            ) : null}

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleSyncNow}
                className="flex h-11 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-3 text-sm font-bold text-white transition hover:bg-zinc-800"
              >
                <RotateCw size={16} />
                {t("pos.settings.sync_now")}
              </button>
              <button
                type="button"
                onClick={handleRetryFailed}
                disabled={syncStatus.failed === 0 && syncStatus.rejected === 0}
                className="flex h-11 items-center justify-center gap-2 rounded-lg border border-zinc-200 px-3 text-sm font-bold text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Retry Failed
              </button>
              <button
                type="button"
                onClick={handleCopySyncDiagnostics}
                className="flex h-11 items-center justify-center gap-2 rounded-lg border border-zinc-200 px-3 text-sm font-bold text-zinc-700 transition hover:bg-zinc-50"
              >
                Copy Diagnostics
              </button>
              <button
                type="button"
                onClick={handleDownloadSyncDiagnostics}
                className="flex h-11 items-center justify-center gap-2 rounded-lg border border-zinc-200 px-3 text-sm font-bold text-zinc-700 transition hover:bg-zinc-50"
              >
                Export Diagnostics
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {syncQueue
                .filter((operation) => operation.status === "Failed" || operation.status === "Rejected")
                .slice(0, 8)
                .map((operation) => (
                <div
                  key={operation.id}
                  className="rounded-lg border border-zinc-200 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-bold text-zinc-900">
                      {operation.summary}
                    </p>
                    <span
                      className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-bold ring-1 ${getStatusClass(
                        operation.status
                      )}`}
                    >
                      {operation.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs font-medium text-zinc-500">
                    {operation.entity} / {operation.action} /{" "}
                    {formatDateTime(operation.createdAt)}
                  </p>
                  {operation.error ? (
                    <p className="mt-2 rounded-md bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700">
                      {operation.error}
                    </p>
                  ) : null}
                  <div className="mt-2 flex items-center justify-between gap-2 text-xs text-zinc-500">
                    <span>Attempts: {operation.attempts}</span>
                    <button
                      type="button"
                      onClick={() => handleRetrySyncOperation(operation.id)}
                      className="rounded-md border border-zinc-200 px-2.5 py-1 font-bold text-zinc-700 transition hover:bg-zinc-50"
                    >
                      Retry item
                    </button>
                  </div>
                </div>
              ))}

              {syncQueue.filter((operation) => operation.status === "Failed" || operation.status === "Rejected").length === 0 ? (
                <div className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm font-medium text-zinc-500">
                  No failed or rejected sync items.
                </div>
              ) : null}
            </div>
          </section>
          ) : null}

          {activeWorkspace === "Cloud sync" ? (
          <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
                <Cloud size={21} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-zinc-950">Cloud connection</h2>
                <p className="text-sm text-zinc-500">Link this store to the cloud so the owner sees its data.</p>
              </div>
            </div>

            {cloudStatus?.hubOnly ? (
              /* This device is a client pointing at the hub — cloud is managed on the hub */
              <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm font-medium text-zinc-700">
                <div className="flex items-center gap-2">
                  <CloudOff size={18} className="text-zinc-400" />
                  Cloud sync is configured on the <strong>main (hub) device</strong> only.
                </div>
                <p className="mt-2 text-zinc-500">
                  This device syncs to the hub on your local network. No cloud setup needed here.
                </p>
              </div>
            ) : (
              <>
                {/* Status banner */}
                <div className={`mt-4 flex items-center gap-2 rounded-lg border p-3 text-sm font-semibold ${
                  cloudStatus?.running
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-amber-200 bg-amber-50 text-amber-800"
                }`}>
                  {cloudStatus?.running ? <Cloud size={18} /> : <CloudOff size={18} />}
                  {cloudStatus?.running
                    ? `Connected — tenant ${cloudStatus.tenantId?.slice(0, 8)}… · last pull ${formatDateTime(cloudStatus.lastPullAt)}`
                    : "Not connected to cloud yet"}
                </div>

                <label className="mt-4 block text-sm font-bold text-zinc-700">
                  Server URL
                  <input
                    value={CLOUD_URL_DISPLAY}
                    readOnly
                    className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-100 px-3 font-mono text-xs text-zinc-500 outline-none"
                  />
                </label>

                {/* Super admin lock banner */}
                {!superAdminUnlocked ? (
                  <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <p className="text-sm font-bold text-amber-800">Cloud settings are locked</p>
                    <p className="mt-1 text-xs text-amber-700">
                      Enter the super admin code to edit these settings. Changes are only visible to
                      the owner after sync.
                    </p>
                    <button
                      type="button"
                      onClick={() => setSuperAdminModalOpen(true)}
                      className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-amber-600 px-3 text-sm font-bold text-white transition hover:bg-amber-500"
                    >
                      <Lock size={16} />
                      Unlock with super admin code
                    </button>
                  </div>
                ) : (
                  <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
                    Cloud settings are unlocked for 5 minutes.
                  </div>
                )}

                <label className="mt-3 block text-sm font-bold text-zinc-700">
                  Tenant ID
                  <input
                    value={cloudTenantId}
                    onChange={(e) => setCloudTenantId(e.target.value)}
                    placeholder="From the owner portal (Settings → Cloud)"
                    readOnly={!superAdminUnlocked}
                    className={`mt-2 h-11 w-full rounded-lg border px-3 font-mono text-xs outline-none ${
                      superAdminUnlocked
                        ? "border-zinc-200 bg-zinc-50 focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                        : "border-zinc-200 bg-zinc-100 text-zinc-500"
                    }`}
                  />
                </label>

                <label className="mt-3 block text-sm font-bold text-zinc-700">
                  Cloud API Key
                  <input
                    type="password"
                    value={cloudApiKey}
                    onChange={(e) => setCloudApiKey(e.target.value)}
                    placeholder="Per-store key from the owner portal"
                    readOnly={!superAdminUnlocked}
                    className={`mt-2 h-11 w-full rounded-lg border px-3 font-mono text-xs outline-none ${
                      superAdminUnlocked
                        ? "border-zinc-200 bg-zinc-50 focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                        : "border-zinc-200 bg-zinc-100 text-zinc-500"
                    }`}
                  />
                </label>

                <label className="mt-3 block text-sm font-bold text-zinc-700">
                  Admin Password
                  <input
                    type="password"
                    value={cloudAdminPw}
                    onChange={(e) => setCloudAdminPw(e.target.value)}
                    placeholder="This hub's admin password (from the tray menu)"
                    readOnly={!superAdminUnlocked}
                    className={`mt-2 h-11 w-full rounded-lg border px-3 font-medium outline-none ${
                      superAdminUnlocked
                        ? "border-zinc-200 bg-zinc-50 focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                        : "border-zinc-200 bg-zinc-100 text-zinc-500"
                    }`}
                  />
                </label>

                <button
                  type="button"
                  onClick={handleSaveCloudConfig}
                  disabled={cloudSaving || !superAdminUnlocked}
                  className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-3 text-sm font-bold text-white transition hover:bg-sky-500 disabled:opacity-50"
                >
                  <Save size={16} />
                  {cloudSaving ? "Connecting…" : "Connect to Cloud"}
                </button>

                <div className="mt-3 rounded-lg border border-sky-100 bg-sky-50 p-3 text-sm font-medium text-sky-900">
                  This register stays fast offline and queues work locally, then syncs
                  to the cloud whenever the internet is available.
                </div>
              </>
            )}
          </section>
          ) : null}

          {/* License status card — Cloud sync tab only */}
          {activeWorkspace === "Cloud sync" && (() => {
            const license = getLicenseStatus()
            const blocked = isLicenseBlocked()
            return (
              <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${
                    blocked ? "bg-rose-100 text-rose-700" :
                    license?.status === "grace" ? "bg-amber-100 text-amber-700" :
                    "bg-emerald-100 text-emerald-700"}`}>
                    <Settings size={21} />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-zinc-950">License</h2>
                    <span className={`text-sm font-bold ${blocked ? "text-rose-600" : license?.status === "grace" ? "text-amber-600" : "text-emerald-600"}`}>
                      {license?.status ?? "unknown"}
                    </span>
                    {license?.message && <p className="text-xs text-zinc-500 mt-0.5">{license.message}</p>}
                  </div>
                </div>
              </section>
            )
          })()}

          {activeWorkspace === "Backup" || activeWorkspace === "Security" ? (
          <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-zinc-950 text-white">
                <Settings size={21} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-zinc-950">System</h2>
                <p className="text-sm text-zinc-500">Export backup data or manage offline sync.</p>
              </div>
            </div>

            <div className="mt-4 rounded-lg border-2 p-4" style={{ borderColor: "var(--brand-border)", background: "var(--brand-soft)" }}>
              <p className="text-[13px] font-bold mb-1" style={{ color: "var(--brand-text)" }}>🛟 Disaster Recovery Card</p>
              <p className="text-[12px] mb-3" style={{ color: "var(--text-2)" }}>
                Download a small card with your server URL + store info. Save it to email or your phone. If this PC breaks, use it on a new device to reconnect and pull all your data.
              </p>
              <button
                type="button"
                onClick={downloadRecoveryCard}
                className="btn-checkout w-full h-11 text-[14px] font-bold"
              >
                <Download size={16} className="inline me-2" />
                Download Recovery Card
              </button>
            </div>

            {/* POS-UX-IA-1A: Danger zone — grouped + confirmation-gated data actions */}
            <div className="mt-4 rounded-lg border-2 p-4" style={{ borderColor: "var(--danger-border, var(--danger))", background: "var(--danger-soft)" }}>
              <p className="text-[13px] font-bold mb-1" style={{ color: "var(--danger-text)" }}>⚠️ Danger zone</p>
              <p className="text-[12px] mb-3" style={{ color: "var(--text-2)" }}>
                These actions expose or overwrite local data. Use with care.
              </p>
              <button
                type="button"
                onClick={() => setShowExportConfirm(true)}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-bold text-zinc-700 transition hover:bg-zinc-50"
              >
                <Download size={17} />
                Export Full Data Backup (JSON)
              </button>

              <button
                type="button"
                onClick={() => setShowRestoreConfirm(true)}
                className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-bold text-zinc-700 transition hover:bg-zinc-50"
              >
                <Upload size={16} />
                Restore from IndexedDB
              </button>
            </div>

            <div className="mt-3 rounded-lg border border-dashed border-zinc-300 p-4 text-sm font-medium text-zinc-500">
              <div className="mb-2 flex items-center gap-2 font-bold text-zinc-700">
                <Upload size={16} />
                Restore-ready architecture
              </div>
              Database import belongs in the production backend. This preview
              can already export clean JSON data for migration.
            </div>

            <ConfirmDialog
              open={showExportConfirm}
              title="Export full data backup?"
              confirmLabel="Export"
              confirmDestructive
              onConfirm={() => { setShowExportConfirm(false); exportData() }}
              onCancel={() => setShowExportConfirm(false)}
            >
              This downloads a JSON file containing ALL local data — including staff PINs and access tokens. Store it securely and delete it when no longer needed.
            </ConfirmDialog>

            <ConfirmDialog
              open={showRestoreConfirm}
              title="Restore from IndexedDB?"
              confirmLabel="Restore"
              confirmDestructive
              onConfirm={() => { setShowRestoreConfirm(false); void handleRestoreFromIndexedDB() }}
              onCancel={() => setShowRestoreConfirm(false)}
            >
              This overwrites the current local data with the last IndexedDB snapshot. Any unsynced local changes will be lost.
            </ConfirmDialog>
          </section>
          ) : null}

          {/* Super admin code modal */}
          {superAdminModalOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
              <div className="mx-4 w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
                <h3 className="text-lg font-bold text-zinc-950">Super admin code</h3>
                <p className="mt-1 text-sm text-zinc-500">
                  Enter the master super admin code to unlock cloud settings.
                </p>
                <input
                  type="password"
                  value={superAdminCode}
                  onChange={(e) => setSuperAdminCode(e.target.value)}
                  placeholder="Super admin code"
                  autoFocus
                  className="mt-4 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 font-mono text-sm outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                  onKeyDown={(e) => { if (e.key === "Enter") handleVerifySuperAdminCode() }}
                />
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => { setSuperAdminModalOpen(false); setSuperAdminCode("") }}
                    className="flex h-11 flex-1 items-center justify-center rounded-lg border border-zinc-200 px-3 text-sm font-bold text-zinc-700 transition hover:bg-zinc-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleVerifySuperAdminCode}
                    disabled={superAdminVerifying}
                    className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-3 text-sm font-bold text-white transition hover:bg-zinc-800 disabled:opacity-50"
                  >
                    {superAdminVerifying ? "Verifying…" : "Unlock"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

        <ConfirmDialog
          open={showLanConfirm}
          title={bindHost === "0.0.0.0" ? "Disable LAN Access?" : "Enable LAN Access?"}
          confirmLabel={bindHost === "0.0.0.0" ? "Disable" : "Enable"}
          confirmDestructive={bindHost === "0.0.0.0"}
          onConfirm={handleToggleLan}
          onCancel={() => setShowLanConfirm(false)}
        >
          {bindHost === "0.0.0.0"
            ? "Other devices on your LAN will no longer be able to connect to this hub. The API will restart."
            : `This will expose the API to your local network (BIND_HOST=0.0.0.0).
                Only enable this on a trusted network. The API will restart.
                ${lanIp ? `Other devices can connect at http://${lanIp}:3015` : ""}`
          }
        </ConfirmDialog>

        <ConfirmDialog
          open={!!revokingDevice}
          title="Revoke device?"
          confirmLabel="Revoke"
          confirmDestructive
          onConfirm={() => { if (revokingDevice) handleRevokeDevice(revokingDevice) }}
          onCancel={() => setRevokingDevice(null)}
        >
          This device will no longer be able to sync sales, expenses, or any data to this hub.
          The device can still operate offline with its local data.
        </ConfirmDialog>

        </aside>
      </div>
      </>
      )}
    </main>
  )
}
