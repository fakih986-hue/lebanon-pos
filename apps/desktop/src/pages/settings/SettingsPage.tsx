import { useEffect, useState } from "react"
import {
  BadgeDollarSign,
  Cloud,
  CloudOff,
  Download,
  RotateCw,
  Save,
  Settings,
  Store,
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
  retryFailedSync,
  subscribeSync,
  type SyncOperation,
  type SyncStatus,
} from "../../features/pos/services/sync.service"
import { showToast } from "../../features/pos/services/toast.service"

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
  const [isLoading, setIsLoading] = useState(true)
  const [settings, setSettings] = useState<AppSettings>(getSettings())
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(getSyncStatus())
  const [syncQueue, setSyncQueue] = useState<SyncOperation[]>(getSyncQueue())

  useEffect(() => {
    setIsLoading(false)
    return subscribeSettings(setSettings)
  }, [])
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

  function handleSave() {
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
    showToast("Settings saved.")
  }

  function handleSyncNow() {
    const result = flushSyncQueue()

    setSyncStatus(getSyncStatus())
    setSyncQueue(getSyncQueue())
    showToast(
      result.synced > 0
        ? `${result.synced} item${result.synced === 1 ? "" : "s"} synced.`
        : "No pending sync work."
    )
  }

  function handleRetryFailed() {
    retryFailedSync()
    setSyncStatus(getSyncStatus())
    setSyncQueue(getSyncQueue())
    showToast("Failed sync items moved back to pending.")
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
    <main className="min-h-0 flex-1 overflow-y-auto bg-[#eef3f2] p-6">
      {isLoading ? (
        <div className="flex min-h-[400px] items-center justify-center p-6">
          <Spinner label="Loading settings..." />
        </div>
      ) : (
      <>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
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
                onChange={(event) =>
                  updateSettings({ storeName: event.target.value })
                }
                className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 font-medium outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </label>

            <label className="block text-sm font-bold text-zinc-700">
              Branch
              <input
                value={settings.branchName}
                onChange={(event) =>
                  updateSettings({ branchName: event.target.value })
                }
                className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 font-medium outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </label>

            <label className="block text-sm font-bold text-zinc-700">
              Phone
              <input
                value={settings.phone}
                onChange={(event) => updateSettings({ phone: event.target.value })}
                className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 font-medium outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </label>

            <label className="block text-sm font-bold text-zinc-700">
              VAT rate
              <input
                type="number"
                min="0"
                step="0.01"
                value={settings.vatRate}
                onChange={(event) =>
                  updateSettings({ vatRate: normalizeNumber(event.target.value) })
                }
                className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 font-medium outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </label>

            <label className="block text-sm font-bold text-zinc-700">
              USD to LBP rate
              <input
                type="number"
                min="1"
                step="500"
                value={settings.usdToLbpRate}
                onChange={(event) =>
                  updateSettings({
                    usdToLbpRate: Math.max(
                      1,
                      normalizeNumber(event.target.value)
                    ),
                  })
                }
                className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 font-medium outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
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

        <aside className="space-y-5">
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
                Sync Now
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

            <div className="mt-3 rounded-lg border border-dashed border-zinc-300 p-4 text-sm font-medium text-zinc-500">
              <div className="mb-2 flex items-center gap-2 font-bold text-zinc-700">
                <Upload size={16} />
                Restore-ready architecture
              </div>
              Database import belongs in the production backend. This preview
              can already export clean JSON data for migration.
            </div>
          </section>
        </aside>
      </div>
      </>
      )}
    </main>
  )
}
