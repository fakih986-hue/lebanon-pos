import React, { useState } from "react"
import { useNavigate } from "react-router"
import { useI18n, useTheme } from "@lebanonpos/shared"
import { api } from "../app/api"
import { setToken } from "../main"

export function LoginPage() {
  const navigate = useNavigate()
  const { t, locale, setLocale } = useI18n()
  const { theme, toggleTheme } = useTheme()
  const [tenantSubdomain, setTenantSubdomain] = useState("")
  const [pin, setPin] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const res = await api<{ token: string; user: { name: string; tenantId: string; tenantName: string } }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ pin, tenantSubdomain: tenantSubdomain.trim() || undefined }),
      })
      setToken(res.token)
      localStorage.setItem("lebanonpos.admin.tenant", res.user.tenantName)
      navigate("/admin/dashboard")
    } catch (err) {
      setError((err as Error).message)
    }
    setLoading(false)
  }

  return (
    <div className="min-h-dvh flex items-center justify-center relative overflow-hidden bg-slate-950">
      <div className="absolute inset-0" style={{
        background: `
          radial-gradient(ellipse at 20% 50%, rgba(99,102,241,0.15) 0%, transparent 50%),
          radial-gradient(ellipse at 80% 20%, rgba(139,92,246,0.1) 0%, transparent 50%),
          radial-gradient(ellipse at 50% 80%, rgba(79,70,229,0.08) 0%, transparent 50%)
        `
      }} />
      <div className="absolute inset-0" style={{
        backgroundImage: `radial-gradient(rgba(255,255,255,0.03) 1px, transparent 1px)`,
        backgroundSize: '24px 24px'
      }} />

      <div className="relative z-10 w-full max-w-md mx-4 animate-fade-in">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-400 to-violet-600 text-white text-2xl font-bold shadow-xl shadow-indigo-600/20 mb-5">
            L
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">{t("login.title")}</h1>
          <p className="text-sm text-indigo-300/70 mt-1">{t("login.subtitle_admin")}</p>
        </div>

        <form onSubmit={handleSubmit} className="backdrop-blur-xl bg-white/[0.04] border border-white/[0.06] rounded-2xl p-8 shadow-2xl">
          {error && (
            <div className="mb-5 p-3.5 bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm rounded-xl flex items-center gap-2 animate-slide-up">
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              {error}
            </div>
          )}

          <div className="space-y-5">
            <div>
              <label className="text-xs font-semibold text-indigo-200/80 uppercase tracking-wider">{t("login.subdomain")}</label>
              <div className="relative mt-1.5">
                <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-indigo-400/50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
                <input value={tenantSubdomain} onChange={e => setTenantSubdomain(e.target.value)} placeholder={t("login.subdomain_placeholder")}
                  className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-indigo-300/30 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/40 transition-all duration-200" />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-indigo-200/80 uppercase tracking-wider">{t("login.pin")}</label>
              <div className="relative mt-1.5">
                <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-indigo-400/50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                <input type="password" value={pin} onChange={e => setPin(e.target.value)} required
                  className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-indigo-300/30 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/40 transition-all duration-200" />
              </div>
            </div>
            <button type="submit" disabled={loading}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold text-sm hover:from-indigo-500 hover:to-violet-500 active:from-indigo-700 active:to-violet-700 transition-all duration-200 shadow-lg shadow-indigo-600/20 disabled:opacity-50 disabled:cursor-not-allowed">
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  {t("login.signing_in")}
                </span>
              ) : t("login.signin")}
            </button>
          </div>
        </form>

        <div className="flex items-center justify-center gap-4 mt-6">
          <button onClick={() => setLocale(locale === "en" ? "ar" : "en")}
            className="text-[10px] text-indigo-400/50 hover:text-indigo-300/70 transition-colors px-3 py-1.5 rounded-lg hover:bg-white/[0.03]">
            {locale === "en" ? t("lang.ar") : t("lang.en")}
          </button>
          <span className="text-indigo-400/20">|</span>
          <button onClick={toggleTheme}
            className="text-[10px] text-indigo-400/50 hover:text-indigo-300/70 transition-colors px-3 py-1.5 rounded-lg hover:bg-white/[0.03]">
            {theme === "dark" ? t("theme.light") : t("theme.dark")}
          </button>
        </div>

        <p className="text-center text-[10px] text-indigo-400/30 mt-4">{t("login.secure_footer")}</p>
      </div>
    </div>
  )
}
