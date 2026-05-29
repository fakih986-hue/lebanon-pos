import { useEffect, useState } from "react"
import { useI18n } from "@lebanonpos/shared"
import {
  BadgeDollarSign,
  Cloud,
  CloudOff,
  Download,
  RotateCw,
  Save,
  Settings,
  Store,
  Truck,
  Upload,
} from "lucide-react"

import Spinner from "../../components/ui/Spinner"
import {
  getSettings,
  saveSettings,
  subscribeSettings,
  type AppSettings,
} from "../../features/pos/services/settings.service"
import { recordAuditEvent } from "../../features/pos/services/security.service"
import {
  flushSyncQueue,
  getSyncQueue,
  getSyncStatus,
  getApiUrl,
  getAuthToken,
  pullFromServer,
  setApiUrl,
  setAuthToken,
  clearAuthToken,
  retryFailedSync,
  subscribeSync,
  type SyncOperation,
  type SyncStatus,
} from "../../features/pos/services/sync.service"
import { restoreIndexedDBToLocal } from "../../features/pos/services/storage.service"
import { showToast } from "../../features/pos/services/toast.service"
import WorkspaceTabs from "../../components/ui/WorkspaceTabs"

type SettingsWorkspace = "Business" | "Cloud sync" | "Security" | "Backup" | "Delivery"

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
  const [connectSubdomain, setConnectSubdomain] = useState("")
  const [connectPin, setConnectPin] = useState("")
  const [connecting, setConnecting] = useState(false)
  const [activeWorkspace, setActiveWorkspace] =
    useState<SettingsWorkspace>("Business")
  const [drivers, setDrivers] = useState<Array<{ id: string; name: string }>>([])

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
        await pullFromServer()
        setSyncStatus(getSyncStatus())
        setSyncQueue(getSyncQueue())
        showToast(
          result.synced > 0
            ? `${result.synced} item${result.synced === 1 ? "" : "s"} synced.`
            : "No pending sync work."
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

  function handleSaveServer() {
    setApiUrl(apiUrl)
    if (authToken) {
      setAuthToken(authToken)
    } else {
      clearAuthToken()
    }
    showToast("Server connection saved.")
  }

  async function handleConnectAndPull() {
    const url = apiUrl.trim().replace(/\/$/, "")
    if (!url) { showToast("Enter the API URL first.", "error"); return }
    if (!connectPin.trim()) { showToast("Enter your admin PIN.", "error"); return }

    setConnecting(true)
    try {
      let res: Response
      try {
        res = await fetch(`${url}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pin: connectPin.trim(),
            tenantSubdomain: connectSubdomain.trim() || undefined,
          }),
        })
      } catch {
        throw new Error(`Could not reach ${url}. Check the API URL and that the server is running.`)
      }

      // Read body as text first so a non-JSON response (404 HTML, empty body) gives a clear message
      const raw = await res.text()
      let data: any = null
      try {
        data = raw ? JSON.parse(raw) : null
      } catch {
        throw new Error(`Server returned a non-JSON response (HTTP ${res.status}). Check the API URL — it should point to your API server, not a web page.`)
      }

      if (!res.ok) {
        throw new Error(data?.error ?? `Login failed (HTTP ${res.status})`)
      }
      if (!data?.token) {
        throw new Error("Login succeeded but no token was returned.")
      }

      setApiUrl(url)
      setApiUrlState(url)
      setAuthToken(data.token)
      setAuthTokenState(data.token)

      await pullFromServer()
      setConnectPin("")
      showToast(`Connected as ${data.user?.name ?? "admin"}. Pulling your data…`)
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Connection failed", "error")
    } finally {
      setConnecting(false)
    }
  }

  async function handleRestoreFromIndexedDB() {
    const count = await restoreIndexedDBToLocal()
    showToast(count > 0 ? `Restored ${count} stores from IndexedDB.` : "No stores needed restoring.")
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
                  Business profile
                </h2>
                <p className="text-sm text-zinc-500">
                  Receipt, VAT, exchange rate, and operating defaults.
                </p>
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
                className={`mt-2 h-11 w-full rounded-lg border px-3 font-medium outline-none focus:ring-4 ${
                  settingsErrors.storeName
                    ? "border-rose-300 bg-rose-50 focus:border-rose-400 focus:ring-rose-100"
                    : "border-zinc-200 bg-zinc-50 focus:border-emerald-400 focus:bg-white focus:ring-emerald-100"
                }`}
              />
              {settingsErrors.storeName ? (
                <p className="mt-1 text-xs font-medium text-rose-600">{settingsErrors.storeName}</p>
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

            <label className="block text-sm font-bold text-zinc-700">
              USD to LBP rate
              <input
                type="number"
                min="1"
                step="500"
                value={settings.usdToLbpRate}
                onChange={(event) => {
                  updateSettings({
                    usdToLbpRate: Math.max(
                      1,
                      normalizeNumber(event.target.value)
                    ),
                  })
                  setSettingsErrors((prev) => ({ ...prev, usdToLbpRate: undefined }))
                }}
                className={`mt-2 h-11 w-full rounded-lg border px-3 font-medium outline-none focus:ring-4 ${
                  settingsErrors.usdToLbpRate
                    ? "border-rose-300 bg-rose-50 focus:border-rose-400 focus:ring-rose-100"
                    : "border-zinc-200 bg-zinc-50 focus:border-emerald-400 focus:bg-white focus:ring-emerald-100"
                }`}
              />
              {settingsErrors.usdToLbpRate ? (
                <p className="mt-1 text-xs font-medium text-rose-600">{settingsErrors.usdToLbpRate}</p>
              ) : null}
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

        <aside className="space-y-5">
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
                <p className="text-2xl font-black text-zinc-950">
                  {syncStatus.pending}
                </p>
              </div>
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <p className="text-xs font-bold uppercase text-zinc-500">
                  Synced
                </p>
                <p className="text-2xl font-black text-zinc-950">
                  {syncStatus.synced}
                </p>
              </div>
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <p className="text-xs font-bold uppercase text-zinc-500">
                  Failed
                </p>
                <p className="text-2xl font-black text-zinc-950">
                  {syncStatus.failed}
                </p>
              </div>
            </div>

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
                disabled={syncStatus.failed === 0}
                className="flex h-11 items-center justify-center gap-2 rounded-lg border border-zinc-200 px-3 text-sm font-bold text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Retry Failed
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {syncQueue.slice(0, 5).map((operation) => (
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
                </div>
              ))}

              {syncQueue.length === 0 ? (
                <div className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm font-medium text-zinc-500">
                  Queue is empty.
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
                <h2 className="text-lg font-bold text-zinc-950">Server connection</h2>
                <p className="text-sm text-zinc-500">API endpoint and authentication for cloud sync.</p>
              </div>
            </div>

            <label className="mt-4 block text-sm font-bold text-zinc-700">
              API URL
              <input
                value={apiUrl}
                onChange={(e) => setApiUrlState(e.target.value)}
                placeholder="https://your-app.railway.app"
                className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 font-medium outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </label>

            {/* ── Quick connect: log in to fetch token + pull data ── */}
            <div className="mt-4 rounded-lg border-2 p-4" style={{ borderColor: "var(--brand-border)", background: "var(--brand-soft)" }}>
              <p className="text-[13px] font-bold mb-1" style={{ color: "var(--brand-text)" }}>
                Connect &amp; pull my data
              </p>
              <p className="text-[12px] mb-3" style={{ color: "var(--text-2)" }}>
                Enter your store subdomain + admin PIN. We'll fetch a fresh token and download your data automatically.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  value={connectSubdomain}
                  onChange={(e) => setConnectSubdomain(e.target.value)}
                  placeholder="Store subdomain (optional)"
                  className="h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                />
                <input
                  type="password"
                  inputMode="numeric"
                  value={connectPin}
                  onChange={(e) => setConnectPin(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleConnectAndPull() }}
                  placeholder="Admin PIN"
                  className="h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-center text-lg font-bold tracking-widest outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                />
              </div>
              <button
                type="button"
                onClick={handleConnectAndPull}
                disabled={connecting || !apiUrl.trim() || !connectPin.trim()}
                className="btn-checkout mt-3 w-full h-11 text-[14px] font-bold"
              >
                {connecting ? "Connecting…" : "Connect & Pull Data"}
              </button>
            </div>

            <details className="mt-3">
              <summary className="cursor-pointer text-[12px] font-semibold" style={{ color: "var(--text-3)" }}>
                Advanced: paste token manually
              </summary>
              <label className="mt-2 block text-sm font-bold text-zinc-700">
                Auth token
                <input
                  type="password"
                  value={authToken}
                  onChange={(e) => setAuthTokenState(e.target.value)}
                  placeholder="Paste your JWT token here"
                  className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 font-mono text-xs outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                />
              </label>
              <button
                type="button"
                onClick={handleSaveServer}
                className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-3 text-sm font-bold text-white transition hover:bg-sky-500"
              >
                <Save size={16} />
                Save Connection
              </button>
            </details>

            <div className="mt-3 rounded-lg border border-sky-100 bg-sky-50 p-3 text-sm font-medium text-sky-900">
              Cloud is the shared company record. This register stays fast
              offline, queues work locally, then syncs when the token and API are valid.
            </div>
          </section>
          ) : null}

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

            <button
              type="button"
              onClick={exportData}
              className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-zinc-200 px-3 text-sm font-bold text-zinc-700 transition hover:bg-zinc-50"
            >
              <Download size={17} />
              Export Backup
            </button>

            <button
              type="button"
                onClick={() => void handleRestoreFromIndexedDB()}
              className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-zinc-200 px-3 text-sm font-bold text-zinc-700 transition hover:bg-zinc-50"
            >
              <Upload size={16} />
              Restore from IndexedDB
            </button>

            <div className="mt-3 rounded-lg border border-dashed border-zinc-300 p-4 text-sm font-medium text-zinc-500">
              <div className="mb-2 flex items-center gap-2 font-bold text-zinc-700">
                <Upload size={16} />
                Restore-ready architecture
              </div>
              Database import belongs in the production backend. This preview
              can already export clean JSON data for migration.
            </div>
          </section>
          ) : null}
        </aside>
      </div>
      </>
      )}
    </main>
  )
}
