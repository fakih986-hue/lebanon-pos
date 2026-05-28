import { useState, useEffect } from "react"
import { useNavigate, useSearchParams } from "react-router"
import { useI18n, useTheme } from "@lebanonpos/shared"

export function FindStorePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { t, locale, setLocale } = useI18n()
  const { theme, toggleTheme } = useTheme()
  const [subdomain, setSubdomain] = useState("")

  useEffect(() => {
    const tenant = searchParams.get("tenant")
    if (tenant) navigate(`/order/${tenant}`, { replace: true })
  }, [searchParams, navigate])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (subdomain.trim()) navigate(`/order/${subdomain.trim()}`)
  }

  return (
    <div className="min-h-dvh relative overflow-hidden bg-gradient-page flex items-center justify-center p-6">
      <div className="absolute inset-0" style={{ backgroundImage: `radial-gradient(var(--dot-pattern) 1px, transparent 1px)`, backgroundSize: '24px 24px' }} />
      <div className="absolute inset-0" style={{ background: "var(--glow-bg)" }} />
      <div className="relative z-10 w-full max-w-sm animate-fade-in">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-4xl shadow-xl shadow-emerald-600/20 mb-5">
            🛵
          </div>
          <h1 className="text-3xl font-bold text-primary tracking-tight">{t("ordering.title")}</h1>
          <p className="text-sm text-secondary mt-2">{t("ordering.subtitle")}</p>
        </div>
        <form onSubmit={handleSubmit} className="bg-glass border border-glass rounded-2xl p-6 shadow-2xl space-y-4">
          <div className="relative">
            <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input value={subdomain} onChange={e => setSubdomain(e.target.value)} placeholder={t("ordering.store_placeholder")} autoFocus
              className="w-full pl-12 pr-4 py-4 rounded-xl bg-white/5 border border-glass text-primary placeholder:text-muted text-lg text-center focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/40 transition-all duration-200" />
          </div>
          <button type="submit"
            className="w-full py-4 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 text-white text-lg font-semibold shadow-lg shadow-emerald-600/20 transition-all duration-200 hover:from-emerald-500 hover:to-emerald-400 active:from-emerald-700 active:to-emerald-600">
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
        <p className="text-center text-[10px] text-muted mt-6">{t("ordering.footer")}</p>
      </div>
    </div>
  )
}
