import { useState } from "react"
import { useNavigate, useParams } from "react-router"
import { useI18n, useTheme } from "@lebanonpos/shared"
import { setToken } from "../main"
import { api } from "../app/api"

export function LoginPage() {
  const navigate = useNavigate()
  const { store } = useParams<{ store: string }>()
  const { t, locale, setLocale } = useI18n()
  const { theme, toggleTheme } = useTheme()
  const [code, setCode] = useState("")
  const [pin, setPin] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    if (!code.trim() || !pin.trim()) { setError(t("login.error_required")); return }
    if (!store) { setError("Store not specified"); return }
    setLoading(true)
    try {
      const res = await api<{ token: string }>("/api/auth/login", {
        method: "POST", body: JSON.stringify({ code: code.trim(), pin: pin.trim(), role: "Driver", tenantSubdomain: store }),
      })
      setToken(res.token)
      navigate(`/${store}/orders`)
    } catch (err) {
      setError(err instanceof Error ? err.message : t("login.error_failed"))
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-gradient-page p-4 relative overflow-hidden">
      <div className="absolute inset-0" style={{ backgroundImage: `radial-gradient(var(--dot-pattern) 1px, transparent 1px)`, backgroundSize: '24px 24px' }} />
      <div className="absolute inset-0" style={{ background: "var(--glow-bg)" }} />
      <div className="relative z-10 w-full max-w-sm animate-fade-in">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-400 to-violet-600 text-white text-3xl shadow-xl shadow-indigo-600/20 mb-4">
            🚚
          </div>
          <h1 className="text-2xl font-bold text-primary tracking-tight">{t("login.driver_title")}</h1>
          <p className="text-sm mt-1 text-secondary">{t("login.subtitle_driver")}</p>
        </div>
        <form onSubmit={handleSubmit} className="bg-glass border border-glass rounded-2xl p-6 shadow-2xl space-y-4">
          <div>
            <label className="text-xs font-semibold text-secondary uppercase tracking-wider">Driver Code</label>
            <input value={code} onChange={e => setCode(e.target.value)} placeholder="e.g. 1122" inputMode="numeric" autoFocus
              className="mt-1.5 w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-primary placeholder:text-muted text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/40 transition-all duration-200" />
          </div>
          <div>
            <label className="text-xs font-semibold text-secondary uppercase tracking-wider">{t("login.pin")}</label>
            <input type="password" value={pin} onChange={e => setPin(e.target.value)} placeholder={t("login.pin_placeholder")} inputMode="numeric"
              className="mt-1.5 w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-primary placeholder:text-muted text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/40 transition-all duration-200" />
          </div>
          {error && (
            <div className="p-3.5 bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm rounded-xl flex items-center gap-2">
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              {error}
            </div>
          )}
          <button type="submit" disabled={loading}
            className="flex h-14 w-full items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-lg font-semibold shadow-lg shadow-indigo-600/20 transition-all duration-200 hover:from-indigo-500 hover:to-violet-500 active:from-indigo-700 active:to-violet-700 disabled:opacity-50">
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                {t("login.signing_in")}
              </span>
            ) : t("login.signin")}
          </button>
        </form>
        <div className="flex items-center justify-center gap-4 mt-6">
          <button onClick={() => setLocale(locale === "en" ? "ar" : "en")}
            className="text-[10px] text-secondary hover:text-primary transition-colors px-3 py-1.5 rounded-lg hover:bg-glass">
            {locale === "en" ? t("lang.ar") : t("lang.en")}
          </button>
          <span className="text-muted">|</span>
          <button onClick={toggleTheme}
            className="text-[10px] text-secondary hover:text-primary transition-colors px-3 py-1.5 rounded-lg hover:bg-glass">
            {theme === "dark" ? t("theme.light") : t("theme.dark")}
          </button>
        </div>
      </div>
    </div>
  )
}
