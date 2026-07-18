import { useEffect, useState } from "react"
import { Plus, Pencil, Truck } from "lucide-react"
import { useI18n } from "@lebanonpos/shared"
import { getApiUrl, getAuthToken } from "../../features/pos/services/sync.service"
import { showToast } from "../../features/pos/services/toast.service"
import ConfirmDialog from "../../components/ConfirmDialog"

type Driver = { id: string; name: string; mobile: string; code: string; active: boolean; createdAt: string }

export default function DriversPage() {
  const { t } = useI18n()
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [mobile, setMobile] = useState("")
  const [code, setCode] = useState("")
  const [pin, setPin] = useState("")
  // POS-UX-IA-1A: confirm before DEACTIVATING a driver (enabling stays instant)
  const [deactivateTarget, setDeactivateTarget] = useState<Driver | null>(null)

  useEffect(() => { load() }, [])

  function headers() {
    const token = getAuthToken()
    return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  }

  function apiUrl() { return getApiUrl() }
  function url(path: string) { const base = apiUrl(); return base ? `${base.replace(/\/+$/, "")}${path}` : path }

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(url("/api/delivery/drivers"), { headers: headers() })
      if (res.ok) setDrivers(await res.json())
      else { const err = await res.json().catch(() => ({ error: res.statusText })); showToast(err.error || "Failed to load", "error") }
    } catch (e) { showToast(`Network error: ${e instanceof Error ? e.message : e}`, "error") }
    setLoading(false)
  }

  function resetForm() { setName(""); setMobile(""); setCode(""); setPin(""); setEditingId(null); setShowForm(false) }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !code.trim()) { showToast(t("drivers.name_code_required"), "error"); return }
    if (!apiUrl()) { showToast(t("drivers.config_required"), "error"); return }
    try {
      const body = JSON.stringify({ name: name.trim(), mobile: mobile.trim(), code: code.trim(), ...(pin ? { pin } : {}) })
      const isEdit = !!editingId
      const res = await fetch(url(isEdit ? `/api/delivery/drivers/${editingId}` : "/api/delivery/drivers"), {
        method: isEdit ? "PATCH" : "POST", headers: headers(), body,
      })
      if (!res.ok) {
        let msg = "Request failed"
        try { const err = await res.json(); msg = err.error || msg } catch { msg = `HTTP ${res.status}: ${res.statusText}` }
        showToast(msg, "error"); return
      }
      resetForm(); load(); showToast(isEdit ? t("drivers.driver_updated") : t("drivers.driver_created"), "success")
    } catch (e) { showToast(`Failed to save driver: ${e instanceof Error ? e.message : e}`, "error") }
  }

  async function toggleActive(driver: Driver) {
    try {
      const res = await fetch(url(`/api/delivery/drivers/${driver.id}`), {
        method: "PATCH", headers: headers(),
        body: JSON.stringify({ active: !driver.active }),
      })
      if (res.ok) load()
      else { const err = await res.json().catch(() => ({ error: res.statusText })); showToast(err.error || "Failed to toggle", "error") }
    } catch (e) { showToast(`Network error: ${e instanceof Error ? e.message : e}`, "error") }
  }

  function startEdit(d: Driver) {
    setEditingId(d.id); setName(d.name); setMobile(d.mobile); setCode(d.code); setPin(""); setShowForm(true)
  }

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold flex items-center gap-2"><Truck className="w-5 h-5" /> {t("drivers.title")}</h1>
        <button onClick={() => { resetForm(); setShowForm(!showForm) }}
          aria-expanded={showForm}
          className="btn-primary btn-sm gap-1.5">
          <Plus className="w-4 h-4" /> {showForm ? t("drivers.cancel") : t("drivers.add")}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="card p-4 mb-4 space-y-3">
          <h2 className="font-semibold text-sm" id="driver-form-title">{editingId ? t("drivers.edit") : t("drivers.new")}</h2>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium text-zinc-700">
              {t("drivers.name")}
              <input value={name} onChange={e => setName(e.target.value)} placeholder={t("drivers.name_placeholder")} required
                className="input mt-1 h-10 w-full px-3 text-sm" />
            </label>
            <label className="block text-sm font-medium text-zinc-700">
              {t("drivers.code_label")}
              <input value={code} onChange={e => setCode(e.target.value)} placeholder={t("drivers.code_placeholder")} inputMode="numeric" required
                className="input mt-1 h-10 w-full px-3 text-sm" />
            </label>
            <label className="block text-sm font-medium text-zinc-700">
              {t("drivers.phone")}
              <input value={mobile} onChange={e => setMobile(e.target.value)} placeholder={t("drivers.phone_placeholder")}
                className="input mt-1 h-10 w-full px-3 text-sm" />
            </label>
            <label className="block text-sm font-medium text-zinc-700">
              {t("drivers.pin")} {editingId ? t("drivers.pin_label_edit") : "*"}
              <input type="password" value={pin} onChange={e => setPin(e.target.value)} placeholder={t("drivers.pin_placeholder")} required={!editingId}
                className="input mt-1 h-10 w-full px-3 text-sm" />
            </label>
          </div>
          <div className="flex gap-2 pt-1">
            <button type="submit" className="btn-primary btn-md">
              {editingId ? t("drivers.update") : t("drivers.create")}
            </button>
            <button type="button" onClick={resetForm} className="btn-default btn-md">{t("drivers.cancel")}</button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="skeleton h-14 rounded-lg" />)}</div>
      ) : drivers.length === 0 ? (
        <div className="text-center py-16 text-zinc-400">
          <Truck className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p className="font-semibold">{t("drivers.no_drivers")}</p>
          <p className="text-sm mt-1">{t("drivers.no_drivers_sub")}</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-zinc-50">
                <th className="text-start px-4 py-3 text-xs font-semibold text-zinc-500 uppercase">{t("drivers.table_name")}</th>
                <th className="text-start px-4 py-3 text-xs font-semibold text-zinc-500 uppercase">{t("drivers.table_code")}</th>
                <th className="text-start px-4 py-3 text-xs font-semibold text-zinc-500 uppercase">{t("drivers.table_phone")}</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-zinc-500 uppercase">{t("drivers.status")}</th>
                <th className="text-end px-4 py-3 text-xs font-semibold text-zinc-500 uppercase">{t("drivers.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {drivers.map(d => (
                <tr key={d.id} className="border-b last:border-0 hover:bg-zinc-50">
                  <td className="px-4 py-3 font-medium">{d.name}</td>
                  <td className="px-4 py-3 text-zinc-500 font-mono">{d.code}</td>
                  <td className="px-4 py-3 text-zinc-500">{d.mobile || "—"}</td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => { if (d.active) setDeactivateTarget(d); else toggleActive(d) }}
                      aria-pressed={d.active}
                      aria-label={`${d.name}: ${d.active ? t("drivers.active") : t("drivers.inactive")}`}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${d.active ? "chip-success" : "chip-neutral"}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${d.active ? "bg-[var(--success)]" : "bg-[var(--text-3)]"}`} />
                      {d.active ? t("drivers.active") : t("drivers.inactive")}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-end">
                    <button onClick={() => startEdit(d)}
                      aria-label={`Edit ${d.name}`}
                      className="btn btn-default btn-sm gap-1">
                      <Pencil className="w-3.5 h-3.5" /> {t("drivers.edit_btn")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={!!deactivateTarget}
        title={t("drivers.inactive")}
        confirmDestructive
        onCancel={() => setDeactivateTarget(null)}
        onConfirm={() => { if (deactivateTarget) toggleActive(deactivateTarget); setDeactivateTarget(null) }}
      >
        {deactivateTarget ? `Deactivate driver "${deactivateTarget.name}"? They will no longer be able to log in or receive deliveries until re-enabled.` : ""}
      </ConfirmDialog>
    </div>
  )
}
