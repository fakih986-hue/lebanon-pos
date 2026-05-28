import { useState } from "react"
import { KeyRound, Link2, LockKeyhole, ShieldCheck, Wifi } from "lucide-react"
import { useI18n } from "@lebanonpos/shared"

import {
  getUsers,
  unlockWithPin,
  type StaffUser,
} from "../../features/pos/services/security.service"
import {
  getApiUrl,
  pullFromServer,
  setApiUrl,
  setAuthToken,
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

  // Setup mode: shown when no local users exist yet
  const [setupMode, setSetupMode] = useState(users.length === 0)
  const [apiUrl, setApiUrlState] = useState(getApiUrl() ?? "")
  const [subdomain, setSubdomain] = useState("")
  const [setupPin, setSetupPin] = useState("")
  const [setupLoading, setSetupLoading] = useState(false)
  const [setupError, setSetupError] = useState("")

  // Normal unlock
  const [pin, setPin] = useState("")
  const [status, setStatus] = useState(t("desktop.lock_hint"))

  async function handleConnect() {
    const url = apiUrl.trim().replace(/\/$/, "")
    if (!url) { setSetupError("Enter the server URL first"); return }
    if (!setupPin) { setSetupError("Enter your admin PIN"); return }

    setSetupLoading(true)
    setSetupError("")
    try {
      const res = await fetch(`${url}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pin: setupPin,
          tenantSubdomain: subdomain.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Login failed")

      setApiUrl(url)
      setAuthToken(data.token)

      // Pull all data including users into local storage
      await pullFromServer()

      showToast(`Connected as ${data.user.name}. Loading your store…`)
      // Brief delay so pullFromServer can write to storage, then reload
      setTimeout(() => window.location.reload(), 800)
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : "Connection failed")
      setSetupLoading(false)
    }
  }

  async function handleUnlock() {
    // Emergency test bypass: "0000" on an empty device bootstraps a local admin session
    if (pin === "0000" && users.length === 0) {
      const emergencyAdmin = {
        id: "emergency-admin",
        name: "Admin",
        mobile: "",
        pin: "0000",
        role: "Admin" as const,
        active: true,
        createdAt: new Date().toISOString(),
      }
      localStorage.setItem("lebanonpos.users.v1", JSON.stringify([emergencyAdmin]))
      localStorage.setItem("lebanonpos.session.v1", JSON.stringify({ userId: "emergency-admin", unlockedAt: new Date().toISOString() }))
      window.location.reload()
      return
    }

    const user = await unlockWithPin(pin)
    if (!user) {
      setPin("")
      showToast(t("desktop.lock_pin_not_recognized"), "error")
      return
    }
    setStatus(`${user.name} unlocked.`)
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
            {users.length > 0 ? t("desktop.lock_description") : "No local data found. Connect to your server to get started."}
          </p>

          {users.length > 0 ? (
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
          ) : (
            <div
              className="mt-6 rounded-xl border-2 border-dashed p-6 text-center"
              style={{ borderColor: "var(--border)" }}
            >
              <Wifi size={32} className="mx-auto mb-3" style={{ color: "var(--text-3)" }} />
              <p className="text-sm font-semibold" style={{ color: "var(--text-2)" }}>
                Connect to your server on the right to load your store data.
              </p>
              <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>
                This only needs to be done once on each new device.
              </p>
            </div>
          )}
        </div>

        {/* Right panel */}
        <div
          className="rounded-2xl border p-5"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        >
          {/* Tab toggle */}
          {users.length > 0 && (
            <div
              className="flex gap-1 rounded-xl p-1 mb-5"
              style={{ background: "var(--surface-2)" }}
            >
              <button
                type="button"
                onClick={() => setSetupMode(false)}
                className="flex-1 rounded-lg py-2 text-[13px] font-semibold transition"
                style={!setupMode
                  ? { background: "var(--text)", color: "var(--surface)" }
                  : { color: "var(--text-3)" }
                }
              >
                <ShieldCheck size={14} className="inline mr-1.5" />
                Unlock
              </button>
              <button
                type="button"
                onClick={() => setSetupMode(true)}
                className="flex-1 rounded-lg py-2 text-[13px] font-semibold transition"
                style={setupMode
                  ? { background: "var(--text)", color: "var(--surface)" }
                  : { color: "var(--text-3)" }
                }
              >
                <Link2 size={14} className="inline mr-1.5" />
                Connect
              </button>
            </div>
          )}

          {/* ── Setup / Connect panel ── */}
          {setupMode ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                  style={{ background: "var(--accent-soft)" }}
                >
                  <Wifi size={18} style={{ color: "var(--accent)" }} />
                </div>
                <div>
                  <p className="text-[15px] font-bold" style={{ color: "var(--text)" }}>Connect to Server</p>
                  <p className="text-[12px]" style={{ color: "var(--text-3)" }}>One-time setup on this device</p>
                </div>
              </div>

              <label className="block">
                <span className="block text-[12px] font-bold mb-1.5" style={{ color: "var(--text-2)" }}>
                  Server URL
                </span>
                <input
                  type="url"
                  value={apiUrl}
                  onChange={(e) => setApiUrlState(e.target.value)}
                  placeholder="https://your-app.railway.app"
                  className="input w-full"
                  autoFocus={setupMode}
                />
                <p className="mt-1 text-[11px]" style={{ color: "var(--text-3)" }}>
                  Your Railway deployment URL, or your local IP: http://192.168.x.x:3001
                </p>
              </label>

              <label className="block">
                <span className="block text-[12px] font-bold mb-1.5" style={{ color: "var(--text-2)" }}>
                  Store subdomain <span style={{ color: "var(--text-3)" }}>(leave empty if single store)</span>
                </span>
                <input
                  type="text"
                  value={subdomain}
                  onChange={(e) => setSubdomain(e.target.value)}
                  placeholder="mystore"
                  className="input w-full"
                />
              </label>

              <label className="block">
                <span className="block text-[12px] font-bold mb-1.5" style={{ color: "var(--text-2)" }}>
                  Admin PIN
                </span>
                <input
                  type="password"
                  inputMode="numeric"
                  value={setupPin}
                  onChange={(e) => setSetupPin(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleConnect() }}
                  placeholder="••••"
                  className="input w-full text-center text-xl font-bold tracking-widest"
                  style={{ height: 52 }}
                />
              </label>

              {setupError && (
                <p
                  className="rounded-xl px-3 py-2 text-[13px] font-semibold"
                  style={{ background: "var(--rose-soft)", color: "var(--rose-text)" }}
                >
                  {setupError}
                </p>
              )}

              <button
                type="button"
                onClick={handleConnect}
                disabled={setupLoading || !apiUrl.trim() || !setupPin.trim()}
                className="btn-checkout w-full h-12 text-[15px] font-bold"
              >
                {setupLoading ? "Connecting…" : "Connect & Load Store Data"}
              </button>
            </div>

          ) : (
            /* ── Normal PIN unlock ── */
            <div className="space-y-4">
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

              <label className="block">
                <span className="block text-[12px] font-bold mb-1.5" style={{ color: "var(--text-2)" }}>
                  {t("login.pin")}
                </span>
                <input
                  type="password"
                  inputMode="numeric"
                  autoFocus={!setupMode}
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
                className="btn-checkout w-full h-12 text-[15px] font-bold"
              >
                <KeyRound size={17} className="inline mr-2" />
                {t("desktop.lock_unlock_register")}
              </button>

              <button
                type="button"
                onClick={() => setSetupMode(true)}
                className="w-full text-center text-[12px] font-semibold transition hover:opacity-80"
                style={{ color: "var(--text-3)" }}
              >
                Using a new device? Connect to server →
              </button>
            </div>
          )}
        </div>
      </section>
    </main>
  )
}
