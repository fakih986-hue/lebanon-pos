import { useEffect, useState } from "react"
import { CalendarClock, LockKeyhole, ShieldCheck, UserRound } from "lucide-react"
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
  "/": {
    titleKey: "desktop.page.pos.title",
    subtitleKey: "desktop.page.pos.subtitle",
  },
  "/dashboard": {
    titleKey: "desktop.page.dashboard.title",
    subtitleKey: "desktop.page.dashboard.subtitle",
  },
  "/products": {
    titleKey: "desktop.page.products.title",
    subtitleKey: "desktop.page.products.subtitle",
  },
  "/sales": {
    titleKey: "desktop.page.sales.title",
    subtitleKey: "desktop.page.sales.subtitle",
  },
  "/products/new": {
    titleKey: "desktop.page.receive.title",
    subtitleKey: "desktop.page.receive.subtitle",
  },
  "/customers": {
    titleKey: "desktop.page.customers.title",
    subtitleKey: "desktop.page.customers.subtitle",
  },
  "/accounting": {
    titleKey: "desktop.page.accounting.title",
    subtitleKey: "desktop.page.accounting.subtitle",
  },
  "/suppliers": {
    titleKey: "desktop.page.suppliers.title",
    subtitleKey: "desktop.page.suppliers.subtitle",
  },
  "/staff": {
    titleKey: "desktop.page.staff.title",
    subtitleKey: "desktop.page.staff.subtitle",
  },
  "/settings": {
    titleKey: "desktop.page.settings.title",
    subtitleKey: "desktop.page.settings.subtitle",
  },
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
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date())

  useEffect(
    () => subscribeSecurity(() => setSecurityVersion((version) => version + 1)),
    []
  )

  return (
    <header
      className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-3 border-b px-3 py-3 sm:px-5 xl:px-6"
      style={{ background: "var(--pos-surface)", borderColor: "var(--pos-border)" }}
    >
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-[0.18em]" style={{ color: "var(--pos-accent)" }}>
          Lebanon POS
        </p>
        <h2 className="truncate text-xl font-bold leading-tight sm:text-2xl" style={{ color: "var(--pos-text)" }}>
          {t(page.titleKey)}
        </h2>
        <p className="hidden text-sm sm:block" style={{ color: "var(--pos-text-muted)" }}>
          {t(page.subtitleKey)}
        </p>
      </div>

      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={() => setLocale(locale === "en" ? "ar" : "en")}
          className="flex h-10 items-center rounded-lg border px-3 text-xs font-bold transition sm:h-11"
          style={{ background: "var(--pos-surface-muted)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }}
          title={locale === "en" ? "العربية" : "English"}
        >
          {locale === "en" ? "ع" : "EN"}
        </button>

        <button
          type="button"
          onClick={toggleTheme}
          className="flex h-10 items-center rounded-lg border px-3 text-xs font-bold transition sm:h-11"
          style={{ background: "var(--pos-surface-muted)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }}
          title={theme === "dark" ? t("theme.light") : t("theme.dark")}
        >
          {theme === "dark" ? "☀" : "☾"}
        </button>

        <div className="hidden h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium md:flex" style={{ background: "var(--pos-surface-muted)", borderColor: "var(--pos-border)", color: "var(--pos-text-muted)" }}>
          <CalendarClock size={17} />
          {today}
        </div>

        <div className="hidden h-11 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-sm font-semibold text-emerald-800 md:flex">
          <ShieldCheck size={17} />
          {activeShift?.shiftNumber ?? t("desktop.no_shift")}
        </div>

        <SyncStatus />

        <NotificationCenter />

        <div className="flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-semibold sm:h-11" style={{ background: "var(--pos-surface)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }}>
          <UserRound size={17} />
          <span className="hidden sm:inline">{currentUser?.name ?? "-"}</span>
        </div>

        <button
          type="button"
          onClick={lockSession}
          className="flex h-10 w-10 items-center justify-center rounded-lg border transition sm:h-11 sm:w-11"
          style={{ background: "var(--pos-surface)", borderColor: "var(--pos-border)", color: "var(--pos-text-muted)" }}
          aria-label={t("desktop.lock_register")}
          title={t("desktop.lock_register")}
        >
          <LockKeyhole size={17} />
        </button>
      </div>
    </header>
  )
}
