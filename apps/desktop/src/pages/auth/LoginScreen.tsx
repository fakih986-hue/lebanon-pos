import { useState } from "react"
import { CloudDownload, KeyRound, LockKeyhole, ShieldCheck, Store, X } from "lucide-react"
import { useI18n } from "@lebanonpos/shared"

import {
  getUsers,
  unlockWithPin,
  type StaffUser,
} from "../../features/pos/services/security.service"
import {
  clearStoreData,
  flushSyncQueue,
  getApiUrl,
  getKnownStores,
  pullFromServer,
  rememberStore,
  setApiUrl,
  setAuthToken,
  type KnownStore,
} from "../../features/pos/services/sync.service"
import { showToast } from "../../features/pos/services/toast.service"

function roleBadge(role: StaffUser["role"]) {
  if (role === "Admin")   return "bg-[var(--accent-soft)] text-[var(--accent-text)]"
  if (role === "Manager") return "bg-[var(--brand-soft)] text-[var(--brand-text)]"
  return "bg-[var(--surface-2)] text-[var(--text-3)]"
}

export default function LoginScreen() {
  const { t } = useI18n()
  const users = getUsers().filter((u) => u.active)
  const [pin, setPin] = useState("")
  const [status, setStatus] = useState(t("desktop.lock_hint"))

  // ── Connect-to-store (disaster recovery on a new/empty device) ──
  const [connectOpen, setConnectOpen] = useState(false)
  const [cApiUrl, setCApiUrl] = useState(getApiUrl() ?? "https://lebanon-pos-production.up.railway.app")
  const [cSubdomain, setCSubdomain] = useState("")
  const [cPin, setCPin] = useState("")
  const [cLoading, setCLoading] = useState(false)
  const [cError, setCError] = useState("")
  const knownStores = getKnownStores()

  async function handleUnlock() {
    const user = await unlockWithPin(pin)
    if (!user) {
      setPin("")
      showToast(t("desktop.lock_pin_not_recognized"), "error")
      return
    }
    setStatus(`${user.name} unlocked.`)
  }

  async function handleConnect() {
    const url = cApiUrl.trim().replace(/\/+$/, "")
    if (!url) { setCError("Enter the server URL"); return }
    if (!cPin.trim()) { setCError("Enter your PIN"); return }
    setCLoading(true)
    setCError("")
    try {
      let res: Response
      try {
        res = await fetch(`${url}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin: cPin.trim(), tenantSubdomain: cSubdomain.trim() || undefined }),
        })
      } catch {
        throw new Error(`Can't reach ${url}. Check the URL and your internet.`)
      }
      const raw = await res.text()
      let data: any = null
      try { data = raw ? JSON.parse(raw) : null } catch {
        throw new Error(`Server returned an unexpected response (HTTP ${res.status}).`)
      }
      if (!res.ok) throw new Error(data?.error ?? `Login failed (HTTP ${res.status})`)
      if (!data?.token) throw new Error("No token returned.")

      // If switching from another store, push any pending work then wipe local data
      try { await flushSyncQueue() } catch { /* offline — proceed */ }
      clearStoreData()

      setApiUrl(url)
      setAuthToken(data.token)
      rememberStore({
        name: data.user?.tenantName ?? cSubdomain.trim() ?? "Store",
        apiUrl: url,
        subdomain: cSubdomain.trim(),
      })
      await pullFromServer(true)  // full pull → all data + users land locally

      showToast(`Connected to ${data.user?.tenantName ?? "store"}. Loading…`)
      setTimeout(() => window.location.reload(), 700)
    } catch (err) {
      setCError(err instanceof Error ? err.message : "Connection failed")
      setCLoading(false)
    }
  }

  function openStore(store: KnownStore) {
    setCApiUrl(store.apiUrl)
    setCSubdomain(store.subdomain)
    setCPin("")
    setCError("")
    setConnectOpen(true)
  }

  return (
    <main
      className="flex min-h-screen items-center justify-center p-4"
      style={{ background: "var(--bg)" }}
    >
      <section className="grid w-full max-w-5xl gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">

        {/* Left panel: branding + user cards */}
        <div
          className="rounded-2xl border p-6 sm:p-8"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        >
          <div
            className="flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ background: "var(--sidebar-bg)" }}
          >
            <LockKeyhole size={26} className="text-white" />
          </div>

          <p className="mt-6 text-xs font-bold uppercase tracking-[0.18em]" style={{ color: "var(--brand)" }}>
            Lebanon POS
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl" style={{ color: "var(--text)" }}>
            {t("desktop.lock_title")}
          </h1>
          <p className="mt-3 max-w-xl text-base font-medium" style={{ color: "var(--text-3)" }}>
            {t("desktop.lock_description")}
          </p>

          {users.length > 0 && (
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {users.map((user) => (
                <div
                  key={user.id}
                  className="rounded-xl border p-3"
                  style={{ background: "var(--surface-2)", borderColor: "var(--border)" }}
                >
                  <p className="font-bold" style={{ color: "var(--text)" }}>{user.name}</p>
                  <span className={`mt-2 inline-flex rounded-lg px-2 py-1 text-xs font-bold ${roleBadge(user.role)}`}>
                    {user.role}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right panel: PIN unlock */}
        <div
          className="rounded-2xl border p-5"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        >
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
              style={{ background: "var(--brand-soft)" }}
            >
              <ShieldCheck size={18} style={{ color: "var(--brand)" }} />
            </div>
            <div>
              <p className="text-[15px] font-bold" style={{ color: "var(--text)" }}>{t("desktop.lock_unlock")}</p>
              <p className="text-[12px]" style={{ color: "var(--text-3)" }}>{status}</p>
            </div>
          </div>

          <label className="block mt-5">
            <span className="block text-[12px] font-bold mb-1.5" style={{ color: "var(--text-2)" }}>
              {t("login.pin")}
            </span>
            <input
              type="password"
              inputMode="numeric"
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleUnlock() } }}
              className="input w-full text-center font-bold tracking-[0.35em]"
              style={{ height: 56, fontSize: 24 }}
            />
          </label>

          <button
            type="button"
            onClick={handleUnlock}
            disabled={!pin.trim()}
            className="btn-checkout w-full h-12 text-[15px] font-bold mt-4"
          >
            <KeyRound size={17} className="inline mr-2" />
            {t("desktop.lock_unlock_register")}
          </button>

          {/* Quick-switch between known stores */}
          {knownStores.length > 0 && (
            <div className="mt-4 pt-4 border-t" style={{ borderColor: "var(--border)" }}>
              <p className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: "var(--text-3)" }}>
                Switch store
              </p>
              <div className="space-y-1.5">
                {knownStores.map((store) => {
                  const isCurrent = getApiUrl() === store.apiUrl
                  return (
                    <button
                      key={`${store.apiUrl}|${store.subdomain}`}
                      type="button"
                      onClick={() => openStore(store)}
                      className="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition hover:opacity-80"
                      style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <Store size={14} style={{ color: "var(--accent)" }} />
                        <span className="text-[13px] font-semibold truncate" style={{ color: "var(--text)" }}>{store.name}</span>
                        <span className="text-[11px]" style={{ color: "var(--text-3)" }}>/{store.subdomain}</span>
                      </span>
                      {isCurrent && (
                        <span className="text-[10px] font-bold rounded-full px-2 py-0.5" style={{ background: "var(--brand-soft)", color: "var(--brand-text)" }}>
                          current
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Disaster recovery: connect a new/empty device to the store */}
          <button
            type="button"
            onClick={() => { setCSubdomain(""); setCPin(""); setConnectOpen(true); setCError("") }}
            className="mt-3 flex w-full items-center justify-center gap-2 text-[12px] font-semibold transition hover:opacity-80"
            style={{ color: "var(--text-3)" }}
          >
            <CloudDownload size={14} />
            New device / add another store
          </button>
        </div>
      </section>

      {/* Connect modal */}
      {connectOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}>
          <div
            className="w-full max-w-md rounded-2xl border p-6 animate-scale-in"
            style={{ background: "var(--surface)", borderColor: "var(--border)", boxShadow: "var(--shadow-xl)" }}
          >
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <CloudDownload size={20} style={{ color: "var(--accent)" }} />
                <h2 className="text-[17px] font-bold" style={{ color: "var(--text)" }}>Connect to your store</h2>
              </div>
              <button onClick={() => setConnectOpen(false)} style={{ color: "var(--text-3)" }}><X size={18} /></button>
            </div>
            <p className="text-[12px] mb-4" style={{ color: "var(--text-3)" }}>
              Use this on a new or replacement device. Enter your store details from your Recovery Card, plus your PIN. All your data will download.
            </p>

            <label className="block mb-3">
              <span className="block text-[12px] font-bold mb-1.5" style={{ color: "var(--text-2)" }}>Server URL</span>
              <input value={cApiUrl} onChange={(e) => setCApiUrl(e.target.value)} placeholder="https://your-app.railway.app" className="input w-full" autoFocus />
            </label>
            <label className="block mb-3">
              <span className="block text-[12px] font-bold mb-1.5" style={{ color: "var(--text-2)" }}>Store subdomain <span style={{ color: "var(--text-3)" }}>(optional if single store)</span></span>
              <input value={cSubdomain} onChange={(e) => setCSubdomain(e.target.value)} placeholder="default" className="input w-full" />
            </label>
            <label className="block mb-3">
              <span className="block text-[12px] font-bold mb-1.5" style={{ color: "var(--text-2)" }}>Your PIN</span>
              <input type="password" inputMode="numeric" value={cPin} onChange={(e) => setCPin(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleConnect() }}
                placeholder="••••" className="input w-full text-center text-xl font-bold tracking-widest" style={{ height: 50 }} />
            </label>

            {cError && (
              <p className="rounded-lg px-3 py-2 text-[13px] font-semibold mb-3" style={{ background: "var(--rose-soft)", color: "var(--rose-text)" }}>{cError}</p>
            )}

            <button type="button" onClick={handleConnect} disabled={cLoading || !cApiUrl.trim() || !cPin.trim()}
              className="btn-checkout w-full h-12 text-[15px] font-bold">
              {cLoading ? "Connecting & downloading…" : "Connect & Download My Data"}
            </button>
          </div>
        </div>
      )}
    </main>
  )
}
