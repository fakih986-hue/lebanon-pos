import { useState } from "react"
import { KeyRound, LockKeyhole, ShieldCheck } from "lucide-react"
import { useI18n } from "@lebanonpos/shared"

import {
  getUsers,
  unlockWithPin,
  type StaffUser,
} from "../../features/pos/services/security.service"
import { showToast } from "../../features/pos/services/toast.service"

function roleBadgeColor(role: StaffUser["role"]) {
  if (role === "Admin") {
    return "bg-emerald-100 text-emerald-800"
  }

  if (role === "Manager") {
    return "bg-indigo-100 text-indigo-800"
  }

  return "bg-zinc-100 text-zinc-700"
}

export default function LoginScreen() {
  const users = getUsers().filter((user) => user.active)
  const { t } = useI18n()
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
    <main className="flex min-h-screen items-center justify-center bg-page p-4">
      <section className="grid w-full max-w-5xl gap-4 lg:grid-cols-[minmax(0,1fr)_390px]">
        <div className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-zinc-950 text-white">
            <LockKeyhole size={26} />
          </div>
          <p className="mt-6 text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">
            {t("login.title")}
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-950 sm:text-4xl">
            {t("desktop.lock_title")}
          </h1>
          <p className="mt-3 max-w-xl text-base font-medium text-zinc-500">
            {t("desktop.lock_description")}
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {users.map((user) => (
              <div
                key={user.id}
                className="rounded-lg border border-zinc-200 bg-zinc-50 p-3"
              >
                <p className="font-bold text-zinc-950">{user.name}</p>
                <span
                  className={`mt-2 inline-flex rounded-lg px-2 py-1 text-xs font-bold ${roleBadgeColor(
                    user.role
                  )}`}
                >
                  {user.role}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
              <ShieldCheck size={21} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-zinc-950">{t("desktop.lock_unlock")}</h2>
              <p className="text-sm text-zinc-500">{status}</p>
            </div>
          </div>

          <label className="mt-5 block text-sm font-bold text-zinc-700">
            {t("login.pin")}
            <input
              type="password"
              inputMode="numeric"
              autoFocus
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  handleUnlock()
                }
              }}
              className="mt-2 h-14 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-4 text-center text-2xl font-bold tracking-[0.35em] text-zinc-950 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
            />
          </label>

          <button
            type="button"
            onClick={handleUnlock}
            disabled={!pin.trim()}
            className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-base font-bold text-white transition hover:bg-emerald-500 disabled:bg-zinc-200 disabled:text-zinc-400"
          >
            <KeyRound size={18} />
            {t("desktop.lock_unlock_register")}
          </button>
        </div>
      </section>
    </main>
  )
}
