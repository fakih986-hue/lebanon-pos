import { NavLink, Outlet, useNavigate } from "react-router"
import { clearToken } from "../main"
import { useEffect, useState } from "react"
import { useI18n, useTheme } from "@lebanonpos/shared"

const navItems = [
  { to: "/admin/dashboard", key: "nav.dashboard", icon: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
  )},
  { to: "/admin/delivery", key: "nav.delivery", icon: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10l2-1m6 0l2 1m-2-1h.01M5 17h.01M17 17h.01M21 12l-3-3m0 0l-3 3m3-3v8" /></svg>
  )},
  { to: "/admin/drivers", key: "nav.drivers", icon: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
  )},
  { to: "/admin/customers", key: "nav.customers", icon: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
  )},
  { to: "/admin/products", key: "nav.products", icon: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
  )},
  { to: "/admin/sales", key: "nav.sales", icon: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
  )},
  { to: "/admin/staff", key: "nav.staff", icon: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
  )},
]

export function Layout() {
  const navigate = useNavigate()
  const { t, locale, setLocale } = useI18n()
  const { theme, toggleTheme } = useTheme()
  const [tenantName, setTenantName] = useState("")
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem("lebanonpos.admin.tenant")
    if (stored) setTenantName(stored)
  }, [])

  function handleLogout() {
    clearToken()
    navigate("/admin/login")
  }

  return (
    <div className="flex h-dvh overflow-hidden" style={{ background: "var(--bg-page)" }}>
      <aside className={`${collapsed ? "w-16" : "w-60"} flex flex-col shrink-0 relative transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]`}>
        <div className="absolute inset-0" style={{ background: "var(--surface-sidebar)" }} />
        <div className="absolute inset-0 opacity-20" style={{
          backgroundImage: `radial-gradient(circle at 20% 50%, rgba(99,102,241,0.3) 0%, transparent 50%), radial-gradient(circle at 80% 0%, rgba(139,92,246,0.2) 0%, transparent 40%)`
        }} />
        <div className="relative z-10 flex flex-col h-full">
          <div className="flex items-center gap-3 px-4 h-16 border-b border-white/5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-400 to-violet-600 flex items-center justify-center text-white font-bold text-sm shadow-lg shadow-indigo-600/20 shrink-0">
              L
            </div>
            {!collapsed && (
              <div className="min-w-0 animate-fade-in">
                <h1 className="font-bold text-sm text-white tracking-tight">Lebanon POS</h1>
                <p className="text-[10px] text-indigo-300/80 truncate">{tenantName || t("nav.admin_panel")}</p>
              </div>
            )}
          </div>

          <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto scrollbar-thin mt-2">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `sidebar-link relative ${isActive ? "active" : ""} ${collapsed ? "justify-center px-2" : ""}`
                }
              >
                {item.icon}
                {!collapsed && <span className="animate-fade-in">{t(item.key)}</span>}
              </NavLink>
            ))}
          </nav>

          <div className="relative z-10 p-3 border-t border-white/5 space-y-2">
            {!collapsed && (
              <div className="flex items-center gap-2 px-1 mb-1">
                <button onClick={() => setLocale(locale === "en" ? "ar" : "en")}
                  className="flex-1 text-center text-[10px] py-1.5 rounded-lg text-indigo-300/60 hover:text-white hover:bg-white/5 transition-all duration-200 font-medium">
                  {locale === "en" ? t("lang.ar") : t("lang.en")}
                </button>
                <button onClick={toggleTheme}
                  className="flex-1 text-center text-[10px] py-1.5 rounded-lg text-indigo-300/60 hover:text-white hover:bg-white/5 transition-all duration-200 font-medium">
                  {theme === "dark" ? t("theme.light") : t("theme.dark")}
                </button>
              </div>
            )}
            <button onClick={() => setCollapsed(!collapsed)}
              className="flex items-center justify-center w-full py-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/5 transition-all duration-200 text-xs gap-2">
              <svg className={`w-4 h-4 transition-transform duration-300 ${collapsed ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              </svg>
              {!collapsed && <span>{t("nav.collapse")}</span>}
            </button>
            <button onClick={handleLogout}
              className="flex items-center justify-center w-full py-2 rounded-xl text-rose-300/70 hover:text-rose-300 hover:bg-white/5 transition-all duration-200 text-xs gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              {!collapsed && <span>{t("nav.logout")}</span>}
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-auto p-6 lg:p-8 scrollbar-thin animate-fade-in">
        <Outlet />
      </main>
    </div>
  )
}
