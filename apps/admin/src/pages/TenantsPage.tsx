import { useEffect, useState } from "react"
import { adminApi } from "../app/api"

type Tenant = {
  id: string
  name: string
  subdomain: string
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
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<NewTenant>({ storeName: "", subdomain: "", adminName: "Admin", adminMobile: "", adminPin: "0000" })
  const [creating, setCreating] = useState(false)
  const [createdResult, setCreatedResult] = useState<{ subdomain: string; pin: string } | null>(null)
  const [formError, setFormError] = useState("")

  useEffect(() => { loadTenants() }, [])

  async function loadTenants() {
    setLoading(true)
    try {
      const data = await adminApi<Tenant[]>("/api/admin/tenants")
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
      const res = await adminApi<{ tenant: { id: string; name: string; subdomain: string }; credentials: { subdomain: string; pin: string } }>("/api/admin/tenants", {
        method: "POST",
        body: JSON.stringify(form),
      })
      setCreatedResult(res.credentials)
      setForm({ storeName: "", subdomain: "", adminName: "Admin", adminMobile: "", adminPin: "0000" })
      loadTenants()
    } catch (err) {
      setFormError((err as Error).message)
    }
    setCreating(false)
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
          <h2 className="text-xl font-bold mb-2" style={{ color: "var(--text-primary)" }}>Store Created!</h2>
          <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>Give these credentials to the customer:</p>

          <div className="max-w-xs mx-auto space-y-3 mb-6">
            <div className="bg-slate-50 dark:bg-white/[0.04] rounded-xl p-4 border border-slate-200 dark:border-white/[0.06]">
              <p className="text-[10px] uppercase tracking-wider font-semibold mb-1" style={{ color: "var(--text-muted)" }}>Server URL</p>
              <p className="text-sm font-bold font-mono" style={{ color: "var(--text-primary)" }}>https://lebanon-pos-production.up.railway.app</p>
            </div>
            <div className="bg-slate-50 dark:bg-white/[0.04] rounded-xl p-4 border border-slate-200 dark:border-white/[0.06]">
              <p className="text-[10px] uppercase tracking-wider font-semibold mb-1" style={{ color: "var(--text-muted)" }}>Subdomain</p>
              <p className="text-lg font-bold font-mono tracking-wider" style={{ color: "var(--text-primary)" }}>{createdResult.subdomain}</p>
            </div>
            <div className="bg-slate-50 dark:bg-white/[0.04] rounded-xl p-4 border border-slate-200 dark:border-white/[0.06]">
              <p className="text-[10px] uppercase tracking-wider font-semibold mb-1" style={{ color: "var(--text-muted)" }}>Admin PIN</p>
              <p className="text-lg font-bold font-mono tracking-widest" style={{ color: "var(--text-primary)" }}>{createdResult.pin}</p>
            </div>
          </div>

          <button onClick={() => setCreatedResult(null)} className="btn-primary">
            Create Another Store
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>Stores</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>Manage all tenant stores</p>
        </div>
        <button onClick={() => setShowCreate(!showCreate)} className="btn-primary">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          {showCreate ? "Cancel" : "New Store"}
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="data-card mb-8 animate-slide-up">
          <h2 className="font-semibold mb-4" style={{ color: "var(--text-primary)" }}>Create New Store</h2>
          {formError && (
            <div className="mb-4 p-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-300 text-sm rounded-xl">{formError}</div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold mb-1.5 block" style={{ color: "var(--text-secondary)" }}>Store Name</label>
              <input value={form.storeName} onChange={e => setForm({ ...form, storeName: e.target.value })} required placeholder="e.g. Mini Market Fakih" className="input-field" />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1.5 block" style={{ color: "var(--text-secondary)" }}>Subdomain</label>
              <input value={form.subdomain} onChange={e => setForm({ ...form, subdomain: e.target.value.replace(/[^a-z0-9-]/g, "") })} required placeholder="e.g. fakih" className="input-field" pattern="[a-z0-9-]{3,}" />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1.5 block" style={{ color: "var(--text-secondary)" }}>Admin Name</label>
              <input value={form.adminName} onChange={e => setForm({ ...form, adminName: e.target.value })} required className="input-field" />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1.5 block" style={{ color: "var(--text-secondary)" }}>Admin Mobile</label>
              <input value={form.adminMobile} onChange={e => setForm({ ...form, adminMobile: e.target.value })} required placeholder="e.g. 03xxxxxx" className="input-field" />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1.5 block" style={{ color: "var(--text-secondary)" }}>Admin PIN</label>
              <input value={form.adminPin} onChange={e => setForm({ ...form, adminPin: e.target.value })} required className="input-field" pattern="[0-9]{4,}" />
            </div>
          </div>
          <div className="flex justify-end mt-6">
            <button type="submit" disabled={creating} className="btn-primary">
              {creating ? "Creating…" : "Create Store"}
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
          <button onClick={loadTenants} className="btn-ghost mt-4">Retry</button>
        </div>
      ) : tenants.length === 0 ? (
        <div className="data-card text-center py-16">
          <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-white/[0.04] flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <p className="font-semibold" style={{ color: "var(--text-secondary)" }}>No stores yet</p>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>Create your first store to get started</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tenants.map(tenant => (
            <div key={tenant.id} className="data-card flex items-center justify-between hover:shadow-md transition-shadow">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-400 to-violet-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                    {tenant.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>{tenant.name}</p>
                    <p className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>/{tenant.subdomain}</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-6">
                <div className="flex gap-4 text-xs" style={{ color: "var(--text-muted)" }}>
                  <span>{tenant._count.users} staff</span>
                  <span>{tenant._count.products} products</span>
                  <span>{tenant._count.sales} sales</span>
                </div>
                <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                  {new Date(tenant.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
