import ShiftSheet from "../../features/pos/components/ShiftSheet"
import { openShiftSheet } from "../../features/pos/components/shiftSheetEvents"
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
  "/products/count": { titleKey: "desktop.page.products.title", subtitleKey: "desktop.page.products.subtitle" },
  "/stock": { titleKey: "desktop.page.stock.title", subtitleKey: "desktop.page.stock.subtitle" },
  "/sales": { titleKey: "desktop.page.sales.title", subtitleKey: "desktop.page.sales.subtitle" },
  "/products/new": { titleKey: "desktop.page.receive.title", subtitleKey: "desktop.page.receive.subtitle" },
  "/customers": { titleKey: "desktop.page.customers.title", subtitleKey: "desktop.page.customers.subtitle" },
  "/accounting": { titleKey: "desktop.page.accounting.title", subtitleKey: "desktop.page.accounting.subtitle" },
  "/suppliers": { titleKey: "desktop.page.suppliers.title", subtitleKey: "desktop.page.suppliers.subtitle" },
  "/staff": { titleKey: "desktop.page.staff.title", subtitleKey: "desktop.page.staff.subtitle" },
  "/delivery": { titleKey: "nav.delivery", subtitleKey: "desktop.nav.orders" },
  "/delivery/drivers": { titleKey: "nav.drivers", subtitleKey: "drivers.subtitle" },
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
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date())

  useEffect(() => subscribeSecurity(() => setSecurityVersion((version) => version + 1)), [])

  const isPosRoute = location.pathname === "/"

  return (
    <header className={`topbar-shell flex shrink-0 items-center justify-between gap-2 border-b px-3 sm:gap-3 sm:px-6 ${isPosRoute ? "min-h-[56px]" : "min-h-[64px]"}`}>
      {!isPosRoute && (
        <div className="min-w-0">
          <h2 className="truncate text-lg font-bold leading-tight tracking-tight sm:text-xl" style={{ color: "var(--text)" }}>
            {t(page.titleKey)}
          </h2>
          <p className="hidden text-[12px] font-semibold sm:block" style={{ color: "var(--text-3)" }}>
            {today}
          </p>
        </div>
      )}

      {isPosRoute && (
        // min-w-0: the shift chip shrinks (and truncates) before the controls on the right are pushed out.
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" onClick={openShiftSheet}
            aria-label={activeShift ? t("pos.v2.manage_shift", { shift: activeShift.shiftNumber }) : t("pos.v2.open_shift")}
            className="inline-flex min-w-0 items-center gap-2 whitespace-nowrap rounded-full px-2.5 text-[13px] font-semibold sm:px-3"
            style={{ minHeight: 44, background: activeShift ? "var(--surface-3)" : "var(--v2-warn-soft)", color: activeShift ? "var(--text-2)" : "var(--v2-warn)", border: "1px solid var(--border)" }}>
            <span className="hidden h-2 w-2 shrink-0 rounded-full sm:block" style={{ background: activeShift ? "var(--v2-ok)" : "var(--v2-warn)" }} />
            <span className="truncate">{activeShift?.shiftNumber ?? t("desktop.no_shift")}</span>
          </button>
          <ShiftSheet />
          <span className="hidden whitespace-nowrap text-[13px] font-medium xl:inline" style={{ color: "var(--text-2)" }}>{today}</span>
        </div>
      )}

      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        {!isPosRoute && (
          <div
            className="hidden h-8 items-center gap-1.5 rounded-lg border px-3 text-[12px] font-bold md:flex"
            style={
              activeShift
                ? { background: "var(--brand-soft)", borderColor: "var(--brand-border)", color: "var(--brand-text)" }
                : { background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text-3)" }
            }
          >
            <span className={`h-1.5 w-1.5 rounded-full ${activeShift ? "" : "bg-zinc-400"}`} style={activeShift ? { background: "var(--success)" } : undefined} />
            {activeShift?.shiftNumber ?? t("desktop.no_shift")}
          </div>
        )}

        <SyncStatus />
        <NotificationCenter />

        <div
          className="hidden h-8 items-center gap-2 rounded-lg border px-3 text-[12px] font-bold sm:flex"
          style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text-2)" }}
        >
          <UserRound size={14} style={{ color: "var(--text-3)" }} />
          <span className="hidden max-w-[110px] truncate sm:inline">
            {currentUser?.name ?? "-"}
          </span>
          {currentUser?.role && (
            <span
              className="hidden rounded-full px-2 py-0.5 text-[10px] font-bold xl:inline"
              style={{ background: "var(--brand-soft)", color: "var(--brand-text)" }}
            >
              {currentUser.role}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => setLocale(locale === "en" ? "ar" : "en")}
          className={`btn btn-ghost btn-icon rounded-lg text-[13px] font-semibold ${isPosRoute ? "h-11 w-11" : "h-8 w-8"}`}
          title={locale === "en" ? "Arabic" : "English"}
          aria-label={locale === "en" ? "العربية" : "English"}
        >
          {locale === "en" ? "AR" : "EN"}
        </button>

        <button
          type="button"
          onClick={toggleTheme}
          className={`btn btn-ghost btn-icon rounded-lg ${isPosRoute ? "h-11 w-11" : "h-8 w-8"}`}
          title={theme === "dark" ? t("theme.light") : t("theme.dark")}
          aria-label={theme === "dark" ? t("theme.light") : t("theme.dark")}
        >
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </button>

        <button
          type="button"
          onClick={lockSession}
          className={`btn btn-ghost btn-icon rounded-lg ${isPosRoute ? "h-11 w-11" : "h-8 w-8"}`}
          aria-label={t("desktop.lock_register")}
          title={t("desktop.lock_register")}
        >
          <LockKeyhole size={15} />
        </button>
      </div>
    </header>
  )
}
