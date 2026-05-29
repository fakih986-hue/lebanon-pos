import { useState } from "react"
import { useNavigate } from "react-router"
import { useI18n, useTheme } from "@lebanonpos/shared"

export function FindStorePage() {
  const navigate = useNavigate()
  const { t, locale, setLocale } = useI18n()
  const { theme, toggleTheme } = useTheme()
  const [subdomain, setSubdomain] = useState("")

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (subdomain.trim()) navigate(`/${subdomain.trim()}/login`)
  }

  return (
    <div className="min-h-dvh relative overflow-hidden bg-gradient-page flex items-center justify-center p-6">
      <div className="absolute inset-0" style={{ backgroundImage: `radial-gradient(var(--dot-pattern) 1px, transparent 1px)`, backgroundSize: '24px 24px' }} />
      <div className="absolute inset-0" style={{ background: "var(--glow-bg)" }} />
      <div className="relative z-10 w-full max-w-sm animate-fade-in">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-400 to-violet-600 text-4xl shadow-xl shadow-indigo-600/20 mb-5">
            🚚
          </div>
          <h1 className="text-3xl font-bold text-primary tracking-tight">{t("login.driver_title")}</h1>
          <p className="text-sm text-secondary mt-2">{t("login.subtitle_driver")}</p>
        </div>
        <form onSubmit={handleSubmit} className="bg-glass border border-glass rounded-2xl p-6 shadow-2xl space-y-4">
          <div className="relative">
            <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input value={subdomain} onChange={e => setSubdomain(e.target.value)} placeholder={t("login.subdomain_placeholder")} autoFocus
              className="w-full pl-12 pr-4 py-4 rounded-xl bg-white/5 border border-glass text-primary placeholder:text-muted text-lg text-center focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/40 transition-all duration-200" />
          </div>
          <button type="submit"
            className="w-full py-4 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-lg font-semibold shadow-lg shadow-indigo-600/20 transition-all duration-200 hover:from-indigo-500 hover:to-violet-500 active:from-indigo-700 active:to-violet-700">
            {t("ordering.find_store_btn")}
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
