import { useEffect, useState } from "react"
import { api } from "../app/api"
import { useI18n } from "@lebanonpos/shared"

type Tenant = {
  id: string
  name: string
  subdomain: string
  suspended: boolean
  createdAt: string
  _count: { users: number; products: number; sales: number }
}

type NewTenant = {
  storeName: string
  subdomain: string
  adminName: string
  adminMobile: string
  adminPin: string
}

export function TenantsPage() {
  const { t } = useI18n()
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<NewTenant>({ storeName: "", subdomain: "", adminName: "Admin", adminMobile: "", adminPin: "" })
  const [creating, setCreating] = useState(false)
  const [createdResult, setCreatedResult] = useState<{ subdomain: string; pin: string } | null>(null)
  const [formError, setFormError] = useState("")
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null)
  const [editForm, setEditForm] = useState({ name: "", subdomain: "", suspended: false })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState("")
  const [toggling, setToggling] = useState<string | null>(null)

  function copyToClipboard(text: string, field: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(field)
      setTimeout(() => setCopiedField(null), 2000)
    }).catch(() => { /* clipboard not available */ })
  }

  useEffect(() => { loadTenants() }, [])

  async function loadTenants() {
    setLoading(true)
    try {
      const data = await api<Tenant[]>("/api/admin/tenants")
      setTenants(data)
    } catch (err) {
      setError((err as Error).message)
    }
    setLoading(false)
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setFormError("")
    setCreating(true)
    try {
      const res = await api<{ tenant: { id: string; name: string; subdomain: string }; credentials: { subdomain: string; pin: string } }>("/api/admin/tenants", {
        method: "POST",
        body: JSON.stringify(form),
      })
      setCreatedResult(res.credentials)
      setForm({ storeName: "", subdomain: "", adminName: "Admin", adminMobile: "", adminPin: "" })
      loadTenants()
    } catch (err) {
      setFormError((err as Error).message)
    }
    setCreating(false)
  }

  async function toggleSuspended(tenant: Tenant) {
    setToggling(tenant.id)
    try {
      await api(`/api/admin/tenants/${tenant.id}`, {
        method: "PUT",
        body: JSON.stringify({ suspended: !tenant.suspended }),
      })
      loadTenants()
    } catch (err) {
      setError((err as Error).message)
    }
    setToggling(null)
  }

  function openEdit(tenant: Tenant) {
    setEditingTenant(tenant)
    setEditForm({ name: tenant.name, subdomain: tenant.subdomain, suspended: tenant.suspended })
    setSaveError("")
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editingTenant) return
    setSaveError("")
    setSaving(true)
    try {
      await api(`/api/admin/tenants/${editingTenant.id}`, {
        method: "PUT",
        body: JSON.stringify(editForm),
      })
      loadTenants()
      setEditingTenant(null)
    } catch (err) {
      setSaveError((err as Error).message)
    }
    setSaving(false)
  }

  async function handleDelete() {
    if (!editingTenant) return
    const typed = window.prompt(
      `This permanently deletes "${editingTenant.name}" and ALL its data (sales, products, staff, customers). This cannot be undone.\n\nType the subdomain "${editingTenant.subdomain}" to confirm:`
    )
    if (typed !== editingTenant.subdomain) {
      if (typed !== null) setSaveError("Confirmation text did not match — not deleted.")
      return
    }
    setSaveError("")
    setSaving(true)
    try {
      await api(`/api/admin/tenants/${editingTenant.id}`, { method: "DELETE" })
      loadTenants()
      setEditingTenant(null)
    } catch (err) {
      setSaveError((err as Error).message)
    }
    setSaving(false)
  }

  if (createdResult) {
    return (
      <div className="max-w-2xl mx-auto py-12">
        <div className="data-card text-center">
          <div className="w-16 h-16 rounded-2xl bg-emerald-100 dark:bg-emerald-500/10 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold mb-2" style={{ color: "var(--text-primary)" }}>{t("admin.store_created")}</h2>
          <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>{t("admin.credentials_hint")}</p>

          <div className="max-w-xs mx-auto space-y-3 mb-6">
            <div className="bg-slate-50 dark:bg-white/[0.04] rounded-xl p-4 border border-slate-200 dark:border-white/[0.06]">
              <p className="text-[10px] uppercase tracking-wider font-semibold mb-1" style={{ color: "var(--text-muted)" }}>{t("admin.server_url")}</p>
              <p className="text-sm font-bold font-mono" style={{ color: "var(--text-primary)" }}>https://pos.titan-suite.net</p>
            </div>
            <div className="bg-slate-50 dark:bg-white/[0.04] rounded-xl p-4 border border-slate-200 dark:border-white/[0.06] flex items-center justify-between gap-2">
              <div className="text-start">
                <p className="text-[10px] uppercase tracking-wider font-semibold mb-1" style={{ color: "var(--text-muted)" }}>{t("admin.subdomain")}</p>
                <p className="text-lg font-bold font-mono tracking-wider" style={{ color: "var(--text-primary)" }}>{createdResult.subdomain}</p>
              </div>
              <button onClick={() => copyToClipboard(createdResult.subdomain, "subdomain")} className="px-3 py-1.5 rounded-lg bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 text-xs font-medium hover:bg-indigo-200 dark:hover:bg-indigo-500/30 transition-colors shrink-0">
                {copiedField === "subdomain" ? "✓ Copied" : "Copy"}
              </button>
            </div>
            <div className="bg-slate-50 dark:bg-white/[0.04] rounded-xl p-4 border border-emerald-200 dark:border-emerald-500/20 flex items-center justify-between gap-2">
              <div className="text-start">
                <p className="text-[10px] uppercase tracking-wider font-semibold mb-1 text-emerald-600 dark:text-emerald-400">{t("admin.admin_pin")}</p>
                <p className="text-2xl font-bold font-mono tracking-widest" style={{ color: "var(--text-primary)" }}>{createdResult.pin}</p>
              </div>
              <button onClick={() => copyToClipboard(createdResult.pin, "pin")} className="px-3 py-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 text-xs font-medium hover:bg-emerald-200 dark:hover:bg-emerald-500/30 transition-colors shrink-0">
                {copiedField === "pin" ? "✓ Copied" : "Copy"}
              </button>
            </div>
          </div>

          <button onClick={() => setCreatedResult(null)} className="btn-primary">
            {t("admin.create_another")}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>{t("admin.stores")}</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>{t("admin.manage_stores")}</p>
        </div>
        <button onClick={() => setShowCreate(!showCreate)} className="btn-primary">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          {showCreate ? t("admin.cancel") : t("admin.new_store")}
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="data-card mb-8 animate-slide-up">
          <h2 className="font-semibold mb-4" style={{ color: "var(--text-primary)" }}>{t("admin.create_store")}</h2>
          {formError && (
            <div className="mb-4 p-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-300 text-sm rounded-xl">{formError}</div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold mb-1.5 block" style={{ color: "var(--text-secondary)" }}>{t("admin.store_name")}</label>
              <input value={form.storeName} onChange={e => setForm({ ...form, storeName: e.target.value })} required placeholder={t("admin.store_name_placeholder")} className="input-field" />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1.5 block" style={{ color: "var(--text-secondary)" }}>{t("admin.subdomain")}</label>
              <input value={form.subdomain} onChange={e => setForm({ ...form, subdomain: e.target.value.replace(/[^a-z0-9-]/g, "") })} required placeholder={t("admin.subdomain_placeholder")} className="input-field" pattern="[a-z0-9-]{3,}" />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1.5 block" style={{ color: "var(--text-secondary)" }}>{t("admin.admin_name")}</label>
              <input value={form.adminName} onChange={e => setForm({ ...form, adminName: e.target.value })} required className="input-field" />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1.5 block" style={{ color: "var(--text-secondary)" }}>{t("admin.admin_mobile")}</label>
              <input value={form.adminMobile} onChange={e => setForm({ ...form, adminMobile: e.target.value })} required placeholder={t("admin.mobile_placeholder")} className="input-field" />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1.5 block" style={{ color: "var(--text-secondary)" }}>{t("admin.admin_pin")}</label>
              <input value={form.adminPin} onChange={e => setForm({ ...form, adminPin: e.target.value })} required className="input-field" pattern="[0-9]{4,}" />
            </div>
          </div>
          <div className="flex justify-end mt-6">
            <button type="submit" disabled={creating} className="btn-primary">
              {creating ? t("admin.creating") : t("admin.create_store_btn")}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="loading-skeleton h-20 rounded-xl" />)}
        </div>
      ) : error ? (
        <div className="data-card text-center py-12">
          <p className="text-rose-600 dark:text-rose-400 font-medium">{error}</p>
          <button onClick={loadTenants} className="btn-ghost mt-4">{t("admin.retry")}</button>
        </div>
      ) : tenants.length === 0 ? (
        <div className="data-card text-center py-16">
          <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-white/[0.04] flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <p className="font-semibold" style={{ color: "var(--text-secondary)" }}>{t("admin.no_stores")}</p>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>{t("admin.no_stores_sub")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tenants.map(tenant => (
            <div key={tenant.id} className={`data-card flex items-center justify-between hover:shadow-md transition-shadow ${tenant.suspended ? "border border-rose-500/30 bg-rose-500/5" : ""}`}>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0 ${tenant.suspended ? "bg-rose-600" : "bg-gradient-to-br from-indigo-400 to-violet-600"}`}>
                    {tenant.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>{tenant.name} {tenant.suspended && <span className="text-[10px] text-rose-400 font-bold ms-1">SUSPENDED</span>}</p>
                    <p className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>/{tenant.subdomain}</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex gap-4 text-xs" style={{ color: "var(--text-muted)" }}>
                  <span>{tenant._count.users} {t("admin.staff_count")}</span>
                  <span>{tenant._count.products} {t("admin.products_count")}</span>
                  <span>{tenant._count.sales} {t("admin.sales_count")}</span>
                </div>
                <button onClick={() => toggleSuspended(tenant)} disabled={toggling === tenant.id} className="text-xs px-2 py-1 rounded-lg border border-slate-300 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors disabled:opacity-50">
                  {tenant.suspended ? "Unsuspend" : "Suspend"}
                </button>
                <button onClick={() => openEdit(tenant)} className="text-xs px-2 py-1 rounded-lg border border-slate-300 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors">
                  {t("admin.edit")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit Modal */}
      {editingTenant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setEditingTenant(null)}>
          <div className="data-card w-full max-w-md mx-4 p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4" style={{ color: "var(--text-primary)" }}>{t("admin.edit_store")}</h2>
            {saveError && <div className="mb-4 p-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-300 text-sm rounded-xl">{saveError}</div>}
            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div>
                <label className="text-xs font-semibold mb-1.5 block" style={{ color: "var(--text-secondary)" }}>{t("admin.store_name")}</label>
                <input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} required className="input-field" />
              </div>
              <div>
                <label className="text-xs font-semibold mb-1.5 block" style={{ color: "var(--text-secondary)" }}>{t("admin.subdomain")}</label>
                <input value={editForm.subdomain} onChange={e => setEditForm({ ...editForm, subdomain: e.target.value.replace(/[^a-z0-9-]/g, "") })} required pattern="[a-z0-9-]{3,}" className="input-field" />
              </div>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setEditForm({ ...editForm, suspended: !editForm.suspended })} className={`w-11 h-6 rounded-full transition-colors ${editForm.suspended ? "bg-rose-600" : "bg-slate-300 dark:bg-slate-600"} relative`}>
                  <div className={`w-4 h-4 rounded-full bg-white transition-transform mt-1 ${editForm.suspended ? "translate-x-6" : "translate-x-1"}`} />
                </button>
                <div>
                  <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{t("admin.suspended")}</p>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>{t("admin.suspended_desc")}</p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 pt-2">
                <button type="button" onClick={handleDelete} disabled={saving} className="px-4 py-2 rounded-xl bg-rose-600/10 text-rose-600 dark:text-rose-400 text-sm border border-rose-600/30 hover:bg-rose-600/20 transition-colors disabled:opacity-50">{t("admin.delete_store")}</button>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setEditingTenant(null)} className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-white/5 text-sm border border-slate-300 dark:border-white/10 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors">{t("admin.cancel")}</button>
                  <button type="submit" disabled={saving} className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-colors disabled:opacity-50">{saving ? t("admin.saving") : t("admin.save_changes")}</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
