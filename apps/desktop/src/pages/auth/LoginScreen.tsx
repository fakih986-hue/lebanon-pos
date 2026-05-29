import { useState } from "react"
import { KeyRound, LockKeyhole, ShieldCheck } from "lucide-react"
import { useI18n } from "@lebanonpos/shared"

import {
  getUsers,
  unlockWithPin,
  type StaffUser,
} from "../../features/pos/services/security.service"
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

  async function handleUnlock() {
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
        </div>
      </section>
    </main>
  )
}
