import { StrictMode, useState, useEffect, Component, type ReactNode, type ErrorInfo } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[OwnerApp] Uncaught error:", error, info)
  }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-dvh flex items-center justify-center bg-slate-950 p-8">
          <div className="max-w-md w-full text-center">
            <div className="w-14 h-14 rounded-2xl bg-rose-500/10 flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-white mb-2">Something went wrong</h2>
            <p className="text-sm text-slate-400 mb-6 font-mono">{this.state.error.message}</p>
            <button
              onClick={() => { this.setState({ error: null }); window.location.reload() }}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold text-sm"
            >
              Reload
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

const BASE = ""
const TOKEN_KEY = "lebanonpos.owner.token"

function getToken() { return localStorage.getItem(TOKEN_KEY) }
function setToken(t: string) { localStorage.setItem(TOKEN_KEY, t) }
function clearToken() { localStorage.removeItem(TOKEN_KEY) }

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken()
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options?.headers },
  })
  if (res.status === 401) {
    clearToken()
    window.location.reload()
    throw new Error("Session expired — please sign in again")
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(body.error || `Request failed: ${res.status}`)
  }
  return res.json()
}

function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const res = await api<{ token: string }>("/api/admin/login", { method: "POST", body: JSON.stringify({ password }) })
      setToken(res.token)
      onLogin()
    } catch (err) {
      setError((err as Error).message)
    }
    setLoading(false)
  }

  return (
    <div className="min-h-dvh flex items-center justify-center relative overflow-hidden bg-slate-950">
      <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 20% 50%, rgba(99,102,241,0.15) 0%, transparent 50%), radial-gradient(ellipse at 80% 20%, rgba(139,92,246,0.1) 0%, transparent 50%)" }} />
      <div className="relative z-10 w-full max-w-md mx-4">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-400 to-violet-600 text-white text-2xl font-bold shadow-xl shadow-indigo-600/20 mb-5">L</div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Owner Portal</h1>
          <p className="text-sm text-indigo-300/70 mt-1">Lebanon POS — manage all stores</p>
        </div>
        <form onSubmit={handleSubmit} className="backdrop-blur-xl bg-white/[0.04] border border-white/[0.06] rounded-2xl p-8 shadow-2xl">
          {error && (
            <div className="mb-5 p-3.5 bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm rounded-xl flex items-center gap-2">{error}</div>
          )}
          <div className="space-y-5">
            <div>
              <label className="text-xs font-semibold text-indigo-200/80 uppercase tracking-wider">Master Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoFocus
                className="w-full mt-1.5 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-indigo-300/30 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/40 transition-all duration-200" />
            </div>
            <button type="submit" disabled={loading}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold text-sm hover:from-indigo-500 hover:to-violet-500 transition-all duration-200 shadow-lg shadow-indigo-600/20 disabled:opacity-50 disabled:cursor-not-allowed">
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

type Tenant = { id: string; name: string; subdomain: string; suspended: boolean; createdAt: string; _count: { users: number; products: number; sales: number } }

function TenantsPage({ onLogout }: { onLogout: () => void }) {
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ storeName: "", subdomain: "", adminName: "Admin", adminMobile: "", adminPin: "" })
  const [creating, setCreating] = useState(false)
  const [createdResult, setCreatedResult] = useState<{ tenantId: string; subdomain: string; pin: string; cloudApiKey: string } | null>(null)
  const [formError, setFormError] = useState("")
  const [revealedApiKey, setRevealedApiKey] = useState<string | null>(null)
  const [revealLoading, setRevealLoading] = useState(false)
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null)
  const [editForm, setEditForm] = useState({ name: "", subdomain: "", suspended: false })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState("")

  useEffect(() => { loadTenants() }, [])

  async function loadTenants() {
    setLoading(true)
    try { setTenants(await api<Tenant[]>("/api/admin/tenants")) } catch (err) { setError((err as Error).message) }
    setLoading(false)
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setFormError("")
    setCreating(true)
    try {
      const res = await api<{ credentials: { tenantId: string; subdomain: string; pin: string; cloudApiKey: string } }>("/api/admin/tenants", { method: "POST", body: JSON.stringify(form) })
      setCreatedResult(res.credentials)
      setForm({ storeName: "", subdomain: "", adminName: "Admin", adminMobile: "", adminPin: "" })
      loadTenants()
    } catch (err) { setFormError((err as Error).message) }
    setCreating(false)
  }

  function handleLogout() { clearToken(); onLogout() }

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
      const updated = await api<Tenant>(`/api/admin/tenants/${editingTenant.id}`, {
        method: "PUT",
        body: JSON.stringify(editForm),
      })
      setTenants(prev => prev.map(t => t.id === updated.id ? { ...t, ...updated } : t))
      setEditingTenant(null)
    } catch (err) { setSaveError((err as Error).message) }
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
      setTenants(prev => prev.filter(t => t.id !== editingTenant.id))
      setEditingTenant(null)
    } catch (err) { setSaveError((err as Error).message) }
    setSaving(false)
  }

  async function handleRevealApiKey(tenantId: string) {
    setRevealLoading(true)
    try {
      const tenant = await api<{ id: string; cloudApiKey: string }>(`/api/admin/tenants/${tenantId}`)
      setRevealedApiKey(tenant.cloudApiKey || "(none)")
    } catch { setRevealedApiKey("(failed to load)") }
    setRevealLoading(false)
  }

  if (createdResult) {
    return (
      <div className="max-w-2xl mx-auto py-12 px-4">
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <h2 className="text-xl font-bold mb-2 text-white">Store Created!</h2>
          <p className="text-sm text-slate-400 mb-2">Give these to the store owner. <span className="text-amber-400 font-semibold">Shown once — copy them now.</span></p>
          <p className="text-xs text-slate-500 mb-6">PIN = login on the device. Tenant ID + Cloud Key = enter in Settings → Cloud to sync.</p>
          <div className="max-w-md mx-auto space-y-3 mb-6 text-left">
            <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
              <p className="text-[10px] uppercase tracking-wider font-semibold mb-1 text-slate-500">Server URL (pre-set in app)</p>
              <p className="text-sm font-bold font-mono text-white break-all">https://lebanon-pos-production.up.railway.app</p>
            </div>
            <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
              <p className="text-[10px] uppercase tracking-wider font-semibold mb-1 text-slate-500">Subdomain</p>
              <p className="text-lg font-bold font-mono tracking-wider text-white break-all select-all">{createdResult.subdomain}</p>
            </div>
            <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
              <p className="text-[10px] uppercase tracking-wider font-semibold mb-1 text-slate-500">Admin PIN</p>
              <p className="text-lg font-bold font-mono tracking-widest text-white select-all">{createdResult.pin}</p>
            </div>
            <div className="bg-slate-800 rounded-xl p-4 border border-indigo-700/50">
              <p className="text-[10px] uppercase tracking-wider font-semibold mb-1 text-indigo-400">Tenant ID (Settings → Cloud)</p>
              <p className="text-xs font-bold font-mono text-white break-all select-all">{createdResult.tenantId}</p>
            </div>
            <div className="bg-slate-800 rounded-xl p-4 border border-indigo-700/50">
              <p className="text-[10px] uppercase tracking-wider font-semibold mb-1 text-indigo-400">Cloud API Key (Settings → Cloud)</p>
              <p className="text-xs font-bold font-mono text-white break-all select-all">{createdResult.cloudApiKey}</p>
            </div>
          </div>
          <button onClick={() => setCreatedResult(null)} className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold text-sm">Create Another Store</button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Stores</h1>
          <p className="text-sm text-slate-400 mt-1">Manage all tenant stores</p>
        </div>
        <button onClick={() => setShowCreate(!showCreate)} className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold text-sm">
          {showCreate ? "Cancel" : "+ New Store"}
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="bg-slate-900 border border-slate-700 rounded-2xl p-6 mb-8">
          <h2 className="font-semibold text-white mb-4">Create New Store</h2>
          {formError && <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm rounded-xl">{formError}</div>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold mb-1.5 block text-slate-400">Store Name</label>
              <input value={form.storeName} onChange={e => setForm({ ...form, storeName: e.target.value })} required placeholder="e.g. Mini Market" className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40" />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1.5 block text-slate-400">Subdomain</label>
              <input value={form.subdomain} onChange={e => setForm({ ...form, subdomain: e.target.value.replace(/[^a-z0-9-]/g, "") })} required placeholder="e.g. fakih" className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40" pattern="[a-z0-9-]{3,}" />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1.5 block text-slate-400">Admin Name</label>
              <input value={form.adminName} onChange={e => setForm({ ...form, adminName: e.target.value })} required className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40" />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1.5 block text-slate-400">Admin Mobile</label>
              <input value={form.adminMobile} onChange={e => setForm({ ...form, adminMobile: e.target.value })} required placeholder="e.g. 03xxxxxx" className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40" />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1.5 block text-slate-400">Admin PIN</label>
              <input value={form.adminPin} onChange={e => setForm({ ...form, adminPin: e.target.value })} required className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40" />
            </div>
          </div>
          <div className="flex justify-end mt-6">
            <button type="submit" disabled={creating} className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold text-sm disabled:opacity-50">{creating ? "Creating…" : "Create Store"}</button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-20 rounded-xl bg-slate-800 animate-pulse" />)}</div>
      ) : error ? (
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-8 text-center">
          <p className="text-rose-400 font-medium">{error}</p>
        </div>
      ) : tenants.length === 0 ? (
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-8 text-center">
          <p className="text-slate-400 font-semibold">No stores yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tenants.map(t => (
            <div key={t.id} className={"rounded-2xl p-5 flex items-center justify-between border " + (t.suspended ? "bg-rose-950/30 border-rose-800/30" : "bg-slate-900 border-slate-700")}>
              <div className="flex items-center gap-3">
                <div className={"w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold " + (t.suspended ? "bg-rose-600" : "bg-gradient-to-br from-indigo-400 to-violet-600")}>{t.name.charAt(0).toUpperCase()}</div>
                <div>
                  <p className="font-semibold text-sm text-white">{t.name}</p>
                  <p className="text-xs font-mono text-slate-500">/{t.subdomain}</p>
                  <p className="text-[10px] font-mono text-slate-600 cursor-default select-all" title="Triple-click to copy Tenant ID">{t.id}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <span>{t._count.users} staff</span>
                  <span>{t._count.products} products</span>
                  <span>{t._count.sales} sales</span>
                </div>
                {t.suspended && <span className="text-[10px] uppercase tracking-wider font-bold text-rose-400 bg-rose-500/10 px-2 py-1 rounded-lg">Suspended</span>}
                <button onClick={() => handleRevealApiKey(t.id)} disabled={revealLoading} className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors border border-slate-700" title="Show Cloud API Key">🔑</button>
                <button onClick={() => openEdit(t)} className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors border border-slate-700">Edit</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-center mt-8">
        <button onClick={handleLogout} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">Sign out</button>
      </div>

      {editingTenant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setEditingTenant(null)}>
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h2 className="font-semibold text-white mb-4">Edit Store</h2>
            {saveError && <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm rounded-xl">{saveError}</div>}
            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div>
                <label className="text-xs font-semibold mb-1.5 block text-slate-400">Store Name</label>
                <input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} required className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40" />
              </div>
              <div>
                <label className="text-xs font-semibold mb-1.5 block text-slate-400">Subdomain</label>
                <input value={editForm.subdomain} onChange={e => setEditForm({ ...editForm, subdomain: e.target.value.replace(/[^a-z0-9-]/g, "") })} required pattern="[a-z0-9-]{3,}" className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40" />
              </div>
              <div className="flex items-center gap-3 pt-2">
                <div className="relative inline-flex items-center cursor-pointer" onClick={() => setEditForm({ ...editForm, suspended: !editForm.suspended })}>
                  <div className={"w-11 h-6 rounded-full transition-colors duration-200 " + (editForm.suspended ? "bg-rose-600" : "bg-slate-700")}>
                    <div className={"w-4 h-4 rounded-full bg-white transition-transform duration-200 mt-1 " + (editForm.suspended ? "translate-x-6" : "translate-x-1")} />
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-white">Suspended</p>
                  <p className="text-xs text-slate-500">Block this store from syncing to the platform</p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 pt-2">
                <button type="button" onClick={handleDelete} disabled={saving} className="px-4 py-2 rounded-xl bg-rose-600/10 text-rose-400 text-sm border border-rose-600/30 hover:bg-rose-600/20 transition-colors disabled:opacity-50">Delete Store</button>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setEditingTenant(null)} className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-sm border border-slate-700 hover:bg-slate-700 transition-colors">Cancel</button>
                  <button type="submit" disabled={saving} className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold text-sm disabled:opacity-50">{saving ? "Saving…" : "Save Changes"}</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {revealedApiKey !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setRevealedApiKey(null)}>
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl text-center" onClick={e => e.stopPropagation()}>
            <h2 className="font-semibold text-white mb-2">Cloud API Key</h2>
            <p className="text-xs text-slate-400 mb-4">Used in Settings → Cloud on the hub device.</p>
            <div className="bg-slate-800 rounded-xl p-4 border border-indigo-700/50 mb-4">
              <p className="text-xs font-bold font-mono text-white break-all select-all">{revealedApiKey}</p>
            </div>
            <button onClick={() => setRevealedApiKey(null)} className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold text-sm">Got it</button>
          </div>
        </div>
      )}
    </div>
  )
}

function App() {
  const [authed, setAuthed] = useState(!!getToken())
  if (!authed) return <LoginPage onLogin={() => setAuthed(true)} />
  return <TenantsPage onLogout={() => setAuthed(false)} />
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
