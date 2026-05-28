import { useEffect, useState } from "react"
import { LockKeyhole, Moon, Sun, UserRound } from "lucide-react"
import { useLocation } from "react-router"
import { useI18n, useTheme } from "@lebanonpos/shared"

import {
  getActiveShift,
  getCurrentUser,
  lockSession,
  subscribeSecurity,
} from "../../features/pos/services/security.service"
import NotificationCenter from "./NotificationCenter"
import SyncStatus from "./SyncStatus"

const pageCopy: Record<string, { titleKey: string; subtitleKey: string }> = {
  "/": { titleKey: "desktop.page.pos.title", subtitleKey: "desktop.page.pos.subtitle" },
  "/dashboard": { titleKey: "desktop.page.dashboard.title", subtitleKey: "desktop.page.dashboard.subtitle" },
  "/products": { titleKey: "desktop.page.products.title", subtitleKey: "desktop.page.products.subtitle" },
  "/sales": { titleKey: "desktop.page.sales.title", subtitleKey: "desktop.page.sales.subtitle" },
  "/products/new": { titleKey: "desktop.page.receive.title", subtitleKey: "desktop.page.receive.subtitle" },
  "/customers": { titleKey: "desktop.page.customers.title", subtitleKey: "desktop.page.customers.subtitle" },
  "/accounting": { titleKey: "desktop.page.accounting.title", subtitleKey: "desktop.page.accounting.subtitle" },
  "/suppliers": { titleKey: "desktop.page.suppliers.title", subtitleKey: "desktop.page.suppliers.subtitle" },
  "/staff": { titleKey: "desktop.page.staff.title", subtitleKey: "desktop.page.staff.subtitle" },
  "/settings": { titleKey: "desktop.page.settings.title", subtitleKey: "desktop.page.settings.subtitle" },
}

export default function Topbar() {
  const location = useLocation()
  const { t, locale, setLocale } = useI18n()
  const { theme, toggleTheme } = useTheme()
  const [, setSecurityVersion] = useState(0)
  const page = pageCopy[location.pathname] ?? pageCopy["/"]!
  const currentUser = getCurrentUser()
  const activeShift = getActiveShift()
  const today = new Intl.DateTimeFormat(locale === "ar" ? "ar-LB" : "en-LB", {
    weekday: "short", month: "short", day: "numeric",
  }).format(new Date())

  useEffect(() => subscribeSecurity(() => setSecurityVersion((v) => v + 1)), [])

  return (
    <header
      className="flex min-h-[60px] shrink-0 items-center justify-between gap-3 border-b px-4 sm:px-6"
      style={{ background: "var(--surface)", borderColor: "var(--border)" }}
    >
      {/* Page title */}
      <div className="min-w-0 flex items-center gap-3">
        <div className="min-w-0">
          <h2
            className="truncate text-lg font-bold leading-tight tracking-tight sm:text-xl"
            style={{ color: "var(--text)" }}
          >
            {t(page.titleKey)}
          </h2>
          <p className="hidden text-[12px] sm:block" style={{ color: "var(--text-3)" }}>
            {today}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 sm:gap-2">
        {/* Shift chip */}
        <div
          className={`hidden h-8 items-center gap-1.5 rounded-lg border px-3 text-[12px] font-semibold md:flex`}
          style={activeShift
            ? { background: "var(--brand-soft)", borderColor: "var(--brand-border)", color: "var(--brand-text)" }
            : { background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text-3)" }
          }
        >
          <span className={`h-1.5 w-1.5 rounded-full ${activeShift ? "bg-emerald-500" : "bg-zinc-400"}`} />
          {activeShift?.shiftNumber ?? t("desktop.no_shift")}
        </div>

        <SyncStatus />
        <NotificationCenter />

        {/* User chip */}
        <div
          className="hidden h-8 items-center gap-2 rounded-lg border px-3 text-[12px] font-semibold sm:flex"
          style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text-2)" }}
        >
          <UserRound size={14} style={{ color: "var(--text-3)" }} />
          <span className="hidden sm:inline max-w-[100px] truncate">{currentUser?.name ?? "—"}</span>
        </div>

        {/* Locale toggle */}
        <button
          type="button"
          onClick={() => setLocale(locale === "en" ? "ar" : "en")}
          className="btn btn-ghost btn-icon h-8 w-8 text-[12px] font-bold rounded-lg"
          style={{ border: "1px solid var(--border)", color: "var(--text-2)" }}
          title={locale === "en" ? "العربية" : "English"}
        >
          {locale === "en" ? "ع" : "EN"}
        </button>

        {/* Theme toggle */}
        <button
          type="button"
          onClick={toggleTheme}
          className="flex h-8 w-8 items-center justify-center rounded-lg border transition hover:opacity-80"
          style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text-2)" }}
          title={theme === "dark" ? t("theme.light") : t("theme.dark")}
        >
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </button>

        {/* Lock */}
        <button
          type="button"
          onClick={lockSession}
          className="flex h-8 w-8 items-center justify-center rounded-lg border transition hover:opacity-80"
          style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text-2)" }}
          aria-label={t("desktop.lock_register")}
          title={t("desktop.lock_register")}
        >
          <LockKeyhole size={15} />
        </button>
      </div>
    </header>
  )
}
