import { useEffect, useState } from "react"
import { Plus, Pencil, Truck } from "lucide-react"
import { useI18n } from "@lebanonpos/shared"
import { getApiUrl, getAuthToken } from "../../features/pos/services/sync.service"
import { showToast } from "../../features/pos/services/toast.service"

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
          className="flex items-center gap-1.5 text-sm px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          <Plus className="w-4 h-4" /> {showForm ? t("drivers.cancel") : t("drivers.add")}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-lg border border-zinc-200 p-4 mb-4 space-y-3">
          <h2 className="font-semibold text-sm">{editingId ? t("drivers.edit") : t("drivers.new")}</h2>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium text-zinc-700">
              {t("drivers.name")}
              <input value={name} onChange={e => setName(e.target.value)} placeholder={t("drivers.name_placeholder")} required
                className="mt-1 h-10 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
            </label>
            <label className="block text-sm font-medium text-zinc-700">
              {t("drivers.code_label")}
              <input value={code} onChange={e => setCode(e.target.value)} placeholder={t("drivers.code_placeholder")} inputMode="numeric" required
                className="mt-1 h-10 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
            </label>
            <label className="block text-sm font-medium text-zinc-700">
              {t("drivers.phone")}
              <input value={mobile} onChange={e => setMobile(e.target.value)} placeholder={t("drivers.phone_placeholder")}
                className="mt-1 h-10 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
            </label>
            <label className="block text-sm font-medium text-zinc-700">
              {t("drivers.pin")} {editingId ? t("drivers.pin_label_edit") : "*"}
              <input type="password" value={pin} onChange={e => setPin(e.target.value)} placeholder={t("drivers.pin_placeholder")} required={!editingId}
                className="mt-1 h-10 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
            </label>
          </div>
          <div className="flex gap-2 pt-1">
            <button type="submit" className="text-sm px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              {editingId ? t("drivers.update") : t("drivers.create")}
            </button>
            <button type="button" onClick={resetForm} className="text-sm px-4 py-2 bg-zinc-100 rounded-lg hover:bg-zinc-200">{t("drivers.cancel")}</button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-14 bg-zinc-100 rounded-lg animate-pulse" />)}</div>
      ) : drivers.length === 0 ? (
        <div className="text-center py-16 text-zinc-400">
          <Truck className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p className="font-semibold">{t("drivers.no_drivers")}</p>
          <p className="text-sm mt-1">{t("drivers.no_drivers_sub")}</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-zinc-200 overflow-hidden">
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
                    <button onClick={() => toggleActive(d)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${d.active ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200"}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${d.active ? "bg-emerald-500" : "bg-zinc-400"}`} />
                      {d.active ? t("drivers.active") : t("drivers.inactive")}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-end">
                    <button onClick={() => startEdit(d)} className="text-xs px-2.5 py-1.5 bg-zinc-100 rounded-lg hover:bg-zinc-200">
                      <Pencil className="w-3.5 h-3.5 inline mr-1" /> {t("drivers.edit_btn")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
