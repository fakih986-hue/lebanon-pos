import { useState, useEffect } from "react"
import { CloudDownload, KeyRound, ShieldCheck, Store, X, Save } from "lucide-react"
import { useI18n } from "@lebanonpos/shared"
import TitanLogo, { TitanMark } from "../../components/TitanLogo"

import {
  getUsers,
  hashPin,
  isSessionUnlocked,
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
import { updateUser } from "../../features/pos/services/security.service"
import { showToast } from "../../features/pos/services/toast.service"

function roleBadge(role: StaffUser["role"]) {
  if (role === "Admin")   return "bg-[var(--accent-soft)] text-[var(--accent-text)]"
  if (role === "Manager") return "bg-[var(--brand-soft)] text-[var(--brand-text)]"
  return "bg-[var(--surface-2)] text-[var(--text-3)]"
}

export default function LoginScreen() {
  const { t } = useI18n()
  const [userTick, setUserTick] = useState(0)
  const users = getUsers().filter((u) => u.active)
  const [pin, setPin] = useState("")
  const [status, setStatus] = useState(t("desktop.lock_hint"))

  // Re-render the user list when synced data lands (e.g. hub auto-sync below)
  useEffect(() => {
    const refresh = () => setUserTick((n) => n + 1)
    window.addEventListener("lebanonpos-security-changed", refresh)
    return () => window.removeEventListener("lebanonpos-security-changed", refresh)
  }, [])
  void userTick  // dependency for the recompute above

  // Dev mode — skip login when ?dev is in the URL (design testing without API)
  useEffect(() => {
    if (!window.location.search.includes("dev")) return
    if (isSessionUnlocked()) return
    const existing = getUsers()
    if (existing.length > 0) {
      unlockWithPin("").then((u) => { if (u) window.dispatchEvent(new Event("lebanonpos-security-changed")) })
      return
    }
    hashPin("").then((emptyHash) => {
      window.localStorage.setItem("lebanonpos.users.v1", JSON.stringify([{
        id: "dev-user", name: "Dev Admin", mobile: "", pin: emptyHash, pinChanged: true,
        role: "Admin", code: "DEV", active: true, createdAt: new Date().toISOString(),
      }]))
      window.localStorage.setItem("lebanonpos.current-user.v1", "dev-user")
      window.localStorage.setItem("lebanonpos.session.v1", JSON.stringify({ userId: "dev-user", unlockedAt: new Date().toISOString() }))
      window.dispatchEvent(new Event("lebanonpos-security-changed"))
    })
  }, [])

  // ── Connect-to-store (disaster recovery on a new/empty device) ──
  const [connectOpen, setConnectOpen] = useState(false)
  const [cApiUrl, setCApiUrl] = useState(getApiUrl() ?? "https://lebanon-pos-production.up.railway.app")
  const [cSubdomain, setCSubdomain] = useState("")
  const [cPin, setCPin] = useState("")
  const [cLoading, setCLoading] = useState(false)
  const [cError, setCError] = useState("")
  const knownStores = getKnownStores()

  const [changePinUser, setChangePinUser] = useState<StaffUser | null>(null)

  // Hub auto-sync: on the local hub only, fetch a fresh token from the local API
  // and pull cloud data into IndexedDB. Runs once per app session (no reload loop),
  // on activation AND every launch, so staff/products are always present at login.
  // Retries every 10s (up to 3 min) if no users yet, giving the bridge time to
  // pull data from Railway into local PG.
  useEffect(() => {
    const isHub = typeof window !== "undefined" &&
      !!(window as { __LBPOS_API_URL__?: string }).__LBPOS_API_URL__
    if (!isHub) return
    if (sessionStorage.getItem("lebanonpos.hub-synced") === "1") return

    const apiUrl = (getApiUrl() ?? "http://localhost:3001").replace(/\/+$/, "")
    let attempts = 0
    const maxAttempts = 18  // 18 × 10s = 3 min
    let mounted = true
    let retryTimer: ReturnType<typeof setTimeout> | undefined

    async function trySync() {
      attempts++
      try {
        const cfg = await fetch(`${apiUrl}/api/setup/cloud-config`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
        if (!cfg?.configured) return

        const auto = await fetch(`${apiUrl}/api/setup/auto-login`, { method: "POST" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
        if (!auto?.token) return

        setApiUrl(apiUrl)
        setAuthToken(auto.token)
        setStatus("Syncing your store data…")
        await pullFromServer(true)

        if (!mounted) return
        const users = getUsers().filter((u) => u.active)
        if (users.length > 0) {
          sessionStorage.setItem("lebanonpos.hub-synced", "1")
          window.dispatchEvent(new Event("lebanonpos-security-changed"))
          setStatus(t("desktop.lock_hint"))
        } else if (attempts < maxAttempts) {
          setStatus(`Waiting for cloud sync (${attempts}/${maxAttempts})…`)
          retryTimer = setTimeout(trySync, 10_000)
        } else {
          setStatus(t("desktop.lock_hint"))
        }
      } catch (err) {
        console.error("[hub auto-sync] failed:", err)
        if (!mounted) return
        if (attempts < maxAttempts) {
          retryTimer = setTimeout(trySync, 10_000)
        }
      }
    }
    trySync()
    return () => { mounted = false; clearTimeout(retryTimer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleUnlock() {
    try {
      console.log("[LoginScreen] handleUnlock called, pin length:", pin.length)
      const user = await unlockWithPin(pin)
      console.log("[LoginScreen] unlockWithPin result:", user?.name ?? "null")
      if (!user) {
        setPin("")
        showToast(t("desktop.lock_pin_not_recognized"), "error")
        return
      }
      setStatus(`${user.name} unlocked.`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error"
      console.error("[LoginScreen] handleUnlock error:", err)
      setStatus(`Error: ${msg}`)
    }
  }

  async function handleChangePin(newPin: string) {
    if (!changePinUser) return
    try {
      await updateUser(changePinUser.id, { pin: newPin })
      setChangePinUser(null)
      showToast("PIN changed successfully", "success")
      setPin("")
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to change PIN", "error")
    }
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

      // If switching from another store, push any pending work
      try { await flushSyncQueue() } catch { /* offline — proceed */ }

      // Backup existing data before clearing (for rollback on pull failure)
      const PULL_TARGETS_BACKUP = [
        "lebanonpos.products.v1", "lebanonpos.sales.v1", "lebanonpos.refunds.v1",
        "lebanonpos.customers.v1", "lebanonpos.debt-sales.v1", "lebanonpos.debt-payments.v1",
        "lebanonpos.suppliers.v1", "lebanonpos.purchase-orders.v1", "lebanonpos.supplier-payments.v1",
        "lebanonpos.users.v1", "lebanonpos.shifts.v1", "lebanonpos.audit.v1",
        "lebanonpos.settings.v1", "lebanonpos.expenses.v1", "lebanonpos.inventory-batches.v1",
        "lebanonpos.inventory-adjustments.v1", "lebanonpos.stock-counts.v1",
        "lebanonpos.daily-closes.v1", "lebanonpos.delivery-orders.v1",
      ]
      const backupSnapshot: Record<string, string | null> = {}
      for (const key of PULL_TARGETS_BACKUP) {
        backupSnapshot[key] = localStorage.getItem(key)
      }

      await clearStoreData()
      setApiUrl(url)
      setAuthToken(data.token)
      rememberStore({
        name: data.user?.tenantName ?? cSubdomain.trim() ?? "Store",
        apiUrl: url,
        subdomain: cSubdomain.trim(),
      })

      // Trigger immediate cloud sync so PostgreSQL is populated before we pull
      try {
        await fetch(`${url}/api/setup/pull-from-cloud`, {
          method: "POST",
          headers: { Authorization: `Bearer ${data.token}` },
        })
      } catch {
        // Non-critical — sync will catch up on the next bridge cycle (≤30s)
      }

      try {
        await pullFromServer(true)  // full pull → all data + users land locally

        // Client knows the plaintext PIN — replace the user's bcrypt PIN with SHA-256 for local unlock
        if (data.user?.id) {
          try {
            const raw = localStorage.getItem("lebanonpos.users.v1")
            if (raw) {
              const users = JSON.parse(raw)
              const pinHash = await hashPin(cPin.trim())
              for (const u of users) {
                if (u.id === data.user.id) {
                  u.pin = pinHash
                  u.pinChanged = true
                  break
                }
              }
              localStorage.setItem("lebanonpos.users.v1", JSON.stringify(users))
            }
          } catch { /* non-critical */ }
        }
      } catch (pullErr) {
        // Restore backup on pull failure so existing data isn't lost
        for (const [key, val] of Object.entries(backupSnapshot)) {
          if (val !== null) localStorage.setItem(key, val)
        }
        throw pullErr
      }

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
      className="relative flex min-h-screen items-center justify-center overflow-hidden p-4"
      style={{ background: "var(--bg)" }}
    >
      {/* Background watermark — very subtle */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <TitanMark size={680} opacity={0.04} />
      </div>

      <section className="relative z-10 grid w-full max-w-5xl gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">

        {/* Left panel: branding + user cards */}
        <div
          className="rounded-2xl border p-6 sm:p-8"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        >
          <TitanLogo size={120} />

          <p className="mt-6 text-[11px] font-bold uppercase tracking-[0.25em]" style={{ color: "var(--brand)" }}>
            Powerful Systems
          </p>
          <h1 className="mt-1.5 text-[36px] font-bold tracking-tight leading-none" style={{ color: "var(--text)" }}>
            {t("desktop.lock_title")}
          </h1>
          <p className="mt-3 max-w-xl text-[14px] font-medium" style={{ color: "var(--text-3)" }}>
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
            <KeyRound size={17} className="inline me-2" />
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
                      className="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-start transition hover:opacity-80"
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

      {/* PIN change modal */}
      {changePinUser && (
        <ChangePinModal
          user={changePinUser}
          onConfirm={handleChangePin}
          onCancel={() => { setChangePinUser(null); setPin("") }}
        />
      )}
    </main>
  )
}

function ChangePinModal({ user, onConfirm, onCancel }: { user: StaffUser; onConfirm: (newPin: string) => Promise<void>; onCancel: () => void }) {
  const [newPin, setNewPin] = useState("")
  const [confirmPin, setConfirmPin] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function handleSubmit() {
    setError("")
    if (newPin.length < 4) { setError("PIN must be at least 4 digits"); return }
    if (newPin !== confirmPin) { setError("PINs do not match"); return }
    setLoading(true)
    try {
      await onConfirm(newPin)
    } catch {
      setError("Failed to change PIN")
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}>
      <div className="w-full max-w-md rounded-2xl border p-6 animate-scale-in" style={{ background: "var(--surface)", borderColor: "var(--border)", boxShadow: "var(--shadow-xl)" }}>
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <KeyRound size={20} style={{ color: "var(--accent)" }} />
            <h2 className="text-[17px] font-bold" style={{ color: "var(--text)" }}>Change your PIN</h2>
          </div>
          <button onClick={onCancel} style={{ color: "var(--text-3)" }}><X size={18} /></button>
        </div>
        <p className="text-[12px] mb-4" style={{ color: "var(--text-3)" }}>
          {user.name}, you must change the default PIN before using the system.
        </p>

        <label className="block mb-3">
          <span className="block text-[12px] font-bold mb-1.5" style={{ color: "var(--text-2)" }}>New PIN</span>
          <input type="password" inputMode="numeric" value={newPin} onChange={(e) => setNewPin(e.target.value)}
            className="input w-full text-center text-xl font-bold tracking-widest" style={{ height: 50 }} autoFocus />
        </label>
        <label className="block mb-3">
          <span className="block text-[12px] font-bold mb-1.5" style={{ color: "var(--text-2)" }}>Confirm PIN</span>
          <input type="password" inputMode="numeric" value={confirmPin} onChange={(e) => setConfirmPin(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSubmit() }}
            className="input w-full text-center text-xl font-bold tracking-widest" style={{ height: 50 }} />
        </label>

        {error && (
          <p className="rounded-lg px-3 py-2 text-[13px] font-semibold mb-3" style={{ background: "var(--rose-soft)", color: "var(--rose-text)" }}>{error}</p>
        )}

        <button type="button" onClick={handleSubmit} disabled={loading || !newPin || !confirmPin}
          className="btn-checkout w-full h-12 text-[15px] font-bold">
          <Save size={17} className="inline me-2" />
          {loading ? "Saving…" : "Save New PIN"}
        </button>
      </div>
    </div>
  )
}
