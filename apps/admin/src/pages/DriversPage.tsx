import { useEffect, useState } from "react"
import { api } from "../app/api"
import { useI18n } from "@lebanonpos/shared"

type Driver = { id: string; name: string; mobile: string; active: boolean; createdAt: string }

export function DriversPage() {
  const { t } = useI18n()
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [onlineDrivers, setOnlineDrivers] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [mobile, setMobile] = useState("")
  const [code, setCode] = useState("")
  const [pin, setPin] = useState("")

  useEffect(() => { load(); fetchOnline() }, [])
  useEffect(() => {
    const interval = setInterval(fetchOnline, 10000)
    return () => clearInterval(interval)
  }, [])

  async function fetchOnline() {
    try { setOnlineDrivers(await api<string[]>("/api/delivery/drivers/online")) } catch { }
  }

  async function load() {
    setLoading(true)
    try { setDrivers(await api<Driver[]>("/api/delivery/drivers")) } catch { }
    setLoading(false)
  }

  function resetForm() { setName(""); setMobile(""); setCode(""); setPin(""); setEditingId(null); setShowForm(false) }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !code.trim()) return
    try {
      if (editingId) {
        const body: Record<string, unknown> = { name: name.trim(), mobile: mobile.trim(), code: code.trim() }
        if (pin) body.pin = pin
        await api(`/api/delivery/drivers/${editingId}`, { method: "PATCH", body: JSON.stringify(body) })
      } else {
        await api("/api/delivery/drivers", { method: "POST", body: JSON.stringify({ name: name.trim(), mobile: mobile.trim(), code: code.trim(), pin }) })
      }
      resetForm(); load()
    } catch { }
  }

  async function toggleActive(driver: Driver) {
    try {
      await api(`/api/delivery/drivers/${driver.id}`, { method: "PATCH", body: JSON.stringify({ active: !driver.active }) })
      load()
    } catch { }
  }

  function startEdit(d: Driver) {
    setEditingId(d.id); setName(d.name); setMobile(d.mobile); setPin(""); setShowForm(true)
  }

  return (
    <div className="space-y-6 pb-12">
      <div className="flex items-center justify-between flex-wrap gap-4 animate-fade-in">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>{t("drivers.title")}</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>{t("drivers.subtitle")}</p>
        </div>
        <button onClick={() => { resetForm(); setShowForm(!showForm) }} className="btn-primary text-xs">
          {showForm ? (
            <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg> {t("drivers.cancel")}</>
          ) : (
            <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg> {t("drivers.add")}</>
          )}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="data-card animate-slide-up">
          <h2 className="font-semibold mb-4" style={{ color: "var(--text-primary)" }}>{editingId ? t("drivers.edit") : t("drivers.new")}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: "var(--text-secondary)" }}>{t("drivers.name")} *</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder={t("drivers.name_placeholder")} required className="input-field text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: "var(--text-secondary)" }}>{t("drivers.code_label")} *</label>
              <input value={code} onChange={e => setCode(e.target.value)} placeholder={t("drivers.code_placeholder")} required inputMode="numeric" className="input-field text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: "var(--text-secondary)" }}>{t("drivers.phone")}</label>
              <input value={mobile} onChange={e => setMobile(e.target.value)} placeholder={t("drivers.phone_placeholder")} className="input-field text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: "var(--text-secondary)" }}>{editingId ? t("drivers.pin_label_edit") : t("drivers.pin") + " *"}</label>
              <input value={pin} onChange={e => setPin(e.target.value)} placeholder={t("drivers.pin_placeholder")} required={!editingId} type="password" className="input-field text-sm" />
            </div>
          </div>
          <div className="flex gap-2 mt-5">
            <button type="submit" className="btn-primary text-sm">
              {editingId ? t("drivers.update") : t("drivers.create")}
            </button>
            <button type="button" onClick={resetForm} className="btn-secondary text-sm">{t("drivers.cancel")}</button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="loading-skeleton h-16 rounded-2xl" />)}</div>
      ) : drivers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20" style={{ color: "var(--text-muted)" }}>
          <div className="w-20 h-20 rounded-3xl bg-slate-100 dark:bg-white/[0.04] flex items-center justify-center mb-5">
            <svg className="w-10 h-10" style={{ color: "var(--text-muted)" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          </div>
          <p className="text-lg font-semibold" style={{ color: "var(--text-secondary)" }}>{t("drivers.no_drivers")}</p>
          <p className="text-sm mt-1">{t("drivers.no_drivers_sub")}</p>
        </div>
      ) : (
        <div className="data-card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: "var(--border-card)" }}>
                  <th className="text-start px-5 py-4 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{t("drivers.name")}</th>
                  <th className="text-start px-5 py-4 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{t("drivers.phone")}</th>
                  <th className="text-center px-5 py-4 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{t("drivers.status")}</th>
                  <th className="text-center px-5 py-4 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Online</th>
                  <th className="text-end px-5 py-4 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{t("drivers.created")}</th>
                  <th className="text-end px-5 py-4 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{t("drivers.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {drivers.map((d, i) => {
                  const initials = d.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
                  const isOnline = onlineDrivers.includes(d.id)
                  return (
                    <tr key={d.id} className="table-row" style={{ animationDelay: `${i * 0.03}s` }}>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-100 to-violet-100 dark:from-indigo-500/20 dark:to-violet-500/20 text-indigo-700 dark:text-indigo-300 flex items-center justify-center text-xs font-bold shrink-0">{initials}</span>
                          <span className="font-medium" style={{ color: "var(--text-primary)" }}>{d.name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4" style={{ color: "var(--text-secondary)" }}>{d.mobile || <span style={{ color: "var(--text-muted)" }}>—</span>}</td>
                      <td className="px-5 py-4 text-center">
                        <button onClick={() => toggleActive(d)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all duration-200 ${d.active ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-500/20' : 'bg-slate-100 dark:bg-white/[0.06] text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-white/[0.1]'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${d.active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                          {d.active ? t("drivers.active") : t("drivers.inactive")}
                        </button>
                      </td>
                      <td className="px-5 py-4 text-center">
                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${isOnline ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-slate-100 dark:bg-white/[0.06] text-slate-500 dark:text-slate-400'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                          {isOnline ? "Online" : "Offline"}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-end text-xs" style={{ color: "var(--text-muted)" }}>{new Date(d.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                      <td className="px-5 py-4 text-end">
                        <button onClick={() => startEdit(d)} className="btn-ghost text-xs py-1.5">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                          {t("drivers.edit_btn")}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
