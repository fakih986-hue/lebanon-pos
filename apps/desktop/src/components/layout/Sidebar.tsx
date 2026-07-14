import { Link, useLocation } from "react-router"
import {
  BarChart3, Banknote, Boxes, Building2,
  CircleDollarSign, Layers, PackagePlus, PanelLeftClose, PanelLeftOpen,
  PanelRightClose, PanelRightOpen, ReceiptText, ScanLine,
  SlidersHorizontal, Truck, UserCog, Users,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { useI18n } from "@lebanonpos/shared"

import TitanLogo from "../TitanLogo"
import { formatCurrency } from "../../features/pos/lib/currency"
import {
  getActiveShift, getCurrentUser, userCan, subscribeSecurity, type Permission,
} from "../../features/pos/services/security.service"
import { getSyncStatus, subscribeSync, getApiUrl, getKnownStores, isLicenseGrace, getLicenseRemainingDays } from "../../features/pos/services/sync.service"
import { getSettings } from "../../features/pos/services/settings.service"

const SIDEBAR_EXPANDED_KEY = "lebanonpos.sidebar-expanded.v1"

type MenuItem = {
  label: string
  labelKey: string
  path: string
  icon: LucideIcon
  permission: Permission
  group: "Register" | "Inventory" | "Finance" | "Operations" | "System"
}

export const menuItems: MenuItem[] = [
  { label: "POS",        labelKey: "desktop.nav.pos",         path: "/",                 icon: ScanLine,          permission: "sales.checkout",   group: "Register"  },
  { label: "Sales",      labelKey: "desktop.nav.sales",       path: "/sales",            icon: ReceiptText,       permission: "reports.view",     group: "Register"  },
  { label: "Customers",  labelKey: "nav.customers",           path: "/customers",        icon: Users,             permission: "customers.manage", group: "Register"  },
  { label: "Products",   labelKey: "nav.products",            path: "/products",         icon: Boxes,             permission: "inventory.manage", group: "Inventory" },
  { label: "Receiving",  labelKey: "desktop.nav.receiving",   path: "/products/new",     icon: PackagePlus,       permission: "inventory.manage", group: "Inventory" },
  { label: "Stock & Batches", labelKey: "desktop.nav.stock",  path: "/stock",            icon: Layers,            permission: "inventory.manage", group: "Inventory" },
  { label: "Suppliers",  labelKey: "desktop.nav.suppliers",   path: "/suppliers",        icon: Building2,         permission: "accounting.manage",group: "Inventory" },
  { label: "Dashboard",  labelKey: "nav.dashboard",           path: "/dashboard",        icon: BarChart3,         permission: "reports.view",     group: "Finance"   },
  { label: "Accounting", labelKey: "desktop.nav.accounting",  path: "/accounting",       icon: Banknote,          permission: "accounting.manage",group: "Finance"   },
  { label: "Delivery",   labelKey: "nav.delivery",            path: "/delivery",         icon: Truck,             permission: "delivery.manage",  group: "Operations" },
  { label: "Staff",      labelKey: "desktop.nav.staff",       path: "/staff",            icon: UserCog,           permission: "staff.manage",     group: "Operations" },
  { label: "Settings",   labelKey: "nav.settings",            path: "/settings",         icon: SlidersHorizontal, permission: "settings.manage",  group: "System"    },
]

const menuGroups: MenuItem["group"][] = ["Register", "Inventory", "Finance", "Operations", "System"]

function isActivePath(pathname: string, path: string) {
  if (path === "/") return pathname === "/"
  if (path === "/products" || path === "/products/new" || path === "/delivery/drivers") return pathname === path
  return pathname === path || pathname.startsWith(`${path}/`)
}

const EXPANDED_W = 200
const COLLAPSED_W = 56

export default function Sidebar() {
  const location = useLocation()
  const { t, dir } = useI18n()
  const [, setSecurityVersion] = useState(0)
  const [syncPending, setSyncPending] = useState(0)
  const [expanded, setExpanded] = useState(() =>
    typeof window !== "undefined" && window.localStorage.getItem(SIDEBAR_EXPANDED_KEY) === "true"
  )
  const activeShift = getActiveShift()
  const currentUser = getCurrentUser()
  const storeName = getSettings().storeName
  const currentStore = getKnownStores().find((s) => s.apiUrl === getApiUrl())
  const visibleMenuItems = menuItems.filter((item) => userCan(item.permission))

  useEffect(() => subscribeSecurity(() => setSecurityVersion((v) => v + 1)), [])
  useEffect(() => subscribeSync(() => setSyncPending(getSyncStatus().pending)), [])

  function toggleExpanded() {
    setExpanded((v) => {
      const next = !v
      window.localStorage.setItem(SIDEBAR_EXPANDED_KEY, String(next))
      return next
    })
  }

  const NavLink = ({ item }: { item: MenuItem }) => {
    const active = isActivePath(location.pathname, item.path)
    const Icon = item.icon

    return (
      <Link
        to={item.path}
        title={expanded ? undefined : t(item.labelKey)}
        className={`relative flex items-center rounded-[10px] transition-all ${expanded ? "mx-1.5 gap-2.5 px-3 py-2" : "mx-1.5 justify-center py-2"}`}
        style={{
          background: active ? "var(--sidebar-active-bg)" : "var(--sidebar-item)",
          borderInlineStart: active && expanded ? "3px solid var(--sidebar-active-border)" : "3px solid transparent",
          boxShadow: active ? "var(--sidebar-active-glow)" : "none",
          color: active ? "var(--sidebar-active-text)" : "var(--sidebar-icon-color)",
          transition: "background var(--dur-btn) ease, color var(--dur-btn) ease, box-shadow var(--dur-btn) ease",
        }}
        onMouseEnter={(e) => {
          if (!active) {
            e.currentTarget.style.background = "var(--sidebar-item-hover)"
            e.currentTarget.style.color = "var(--sidebar-text)"
          }
        }}
        onMouseLeave={(e) => {
          if (!active) {
            e.currentTarget.style.background = "var(--sidebar-item)"
            e.currentTarget.style.color = "var(--sidebar-icon-color)"
          }
        }}
      >
        {/* Icon */}
        <span
          className="flex shrink-0 items-center justify-center rounded-md transition-colors duration-150"
          style={{
            width: 28,
            height: 28,
            background: active ? "rgba(214,166,58,0.12)" : "transparent",
            color: active ? "var(--sidebar-icon-active-color)" : "var(--sidebar-icon-color)",
          }}
        >
          <Icon size={16} strokeWidth={1.75} />
        </span>

        {/* Label — only when expanded */}
        {expanded && (
          <span
            className="truncate text-[12.5px] font-medium"
            style={{ color: active ? "var(--sidebar-active-text)" : "var(--sidebar-icon-color)" }}
          >
            {t(item.labelKey)}
          </span>
        )}
      </Link>
    )
  }

  return (
    <aside
      className={`hidden h-full shrink-0 flex-col overflow-hidden md:flex ${dir === "rtl" ? "border-l" : "border-r"}`}
      style={{
        width: expanded ? EXPANDED_W : COLLAPSED_W,
        background: "var(--sidebar-bg)",
        borderColor: "var(--sidebar-border)",
        transition: "width 220ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      {/* ──────────────── Logo ──────────────── */}
      <div className="flex shrink-0 items-center" style={{ height: expanded ? 76 : 72 }}>
        <Link to="/" className={`flex min-w-0 items-center gap-2.5 ${expanded ? "px-3" : "mx-auto"}`}>
          <TitanLogo size={expanded ? 44 : 46} />
          {expanded && (
            <div className="min-w-0">
              <p className="truncate text-[16px] font-black tracking-[0.06em]" style={{ color: "var(--sidebar-text)" }}>
                TITAN
              </p>
              <p className="truncate text-[8.5px] font-semibold tracking-[0.22em] uppercase" style={{ color: "var(--sidebar-text-2)", opacity: 0.5 }}>
                Powerful Systems
              </p>
            </div>
          )}
        </Link>
      </div>

      {/* ──────────────── Store identity ──────────────── */}
      {expanded && (
        <div
          className="mx-2 mb-2 flex items-center gap-2 rounded-[10px] border px-2.5 py-2"
          style={{ borderColor: "var(--sidebar-border)", background: "rgba(255,255,255,0.02)" }}
        >
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[12px] font-black"
            style={{ background: "var(--sidebar-active-bg)", color: "var(--sidebar-icon-active-color)" }}
          >
            {storeName.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[12px] font-bold" style={{ color: "var(--sidebar-text)" }}>{storeName}</p>
            {currentStore?.subdomain && (
              <p className="truncate text-[10px]" style={{ color: "var(--sidebar-section-text)" }}>/{currentStore.subdomain}</p>
            )}
          </div>
        </div>
      )}

      {/* ──────────────── Nav ──────────────── */}
      <nav className="min-h-0 flex-1 overflow-y-auto py-2 [scrollbar-width:none]">
        {menuGroups.map((group, gi) => {
          const items = visibleMenuItems.filter((item) => item.group === group)
          if (items.length === 0) return null

          return (
            <div key={group} className={gi > 0 ? "mt-4" : ""}>
              {/* Group label */}
              {expanded && (
                <p
                  className="mx-3.5 mb-1 text-[11px] font-bold uppercase tracking-[0.12em]"
                  style={{ color: "var(--sidebar-section-text)" }}
                >
                  {t(`desktop.group.${group}`)}
                </p>
              )}

              {/* Divider between groups when collapsed */}
              {!expanded && gi > 0 && (
                <div
                  className="mx-3.5 my-1.5 h-px"
                  style={{ background: "var(--sidebar-border)" }}
                />
              )}

              <div className="space-y-0.5">
                {items.map((item) => (
                  <NavLink key={item.path} item={item} />
                ))}
              </div>
            </div>
          )
        })}
      </nav>

      {/* ──────────────── Footer ──────────────── */}
      <div
        className="shrink-0 space-y-1.5 border-t p-2"
        style={{ borderColor: "var(--sidebar-border)" }}
      >
        {/* Shift status */}
        <div
          className={`flex items-center gap-2 rounded-[8px] px-2 py-1.5 ${!expanded ? "justify-center" : ""}`}
          style={{
            background: activeShift ? "rgba(34,197,94,0.06)" : "transparent",
            border: activeShift ? "1px solid rgba(34,197,94,0.15)" : "1px solid transparent",
          }}
        >
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{
              background: activeShift ? "var(--brand)" : "var(--surface-3)",
              boxShadow: activeShift ? "0 0 6px rgba(34,197,94,0.5)" : "none",
            }}
          />
          {expanded && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-[10px] font-semibold" style={{ color: activeShift ? "var(--brand-text)" : "var(--sidebar-text-2)" }}>
                {activeShift ? activeShift.shiftNumber : t("desktop.closed")}
              </p>
              {activeShift && (
                <p className="text-[9px] font-medium" style={{ color: "rgba(34,197,94,0.55)" }}>
                  <CircleDollarSign size={7} className="inline me-0.5" />
                  {formatCurrency(activeShift.openingFloatUsd)}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Pending sync */}
        {syncPending > 0 && (
          <div
            className={`flex items-center gap-1.5 rounded-[8px] px-2 py-1.5 ${!expanded ? "justify-center" : ""}`}
            style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)" }}
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
            {expanded && (
              <span className="text-[10px] font-semibold text-red-400">
                {syncPending} pending
              </span>
            )}
          </div>
        )}

        {/* License grace warning */}
        {isLicenseGrace() && (
          <div
            className={`flex items-center gap-1.5 rounded-[8px] px-2 py-1.5 ${!expanded ? "justify-center" : ""}`}
            style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)" }}
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--amber)" }} />
            {expanded && (
              <span className="text-[10px] font-semibold" style={{ color: "var(--amber-text)" }}>
                {getLicenseRemainingDays()}d grace
              </span>
            )}
          </div>
        )}

        {/* Current user + role */}
        {currentUser && (
          <div
            className={`flex items-center gap-2 rounded-[8px] px-2 py-1.5 ${!expanded ? "justify-center" : ""}`}
            title={`${currentUser.name} · ${currentUser.role}`}
          >
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-black"
              style={{ background: "rgba(255,255,255,0.06)", color: "var(--sidebar-text-2)" }}
            >
              {currentUser.name.charAt(0).toUpperCase()}
            </span>
            {expanded && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-semibold" style={{ color: "var(--sidebar-text)" }}>{currentUser.name}</p>
                <p className="truncate text-[9px] font-medium" style={{ color: "var(--sidebar-section-text)" }}>{currentUser.role}</p>
              </div>
            )}
          </div>
        )}

        {/* Collapse toggle */}
        <button
          type="button"
          onClick={toggleExpanded}
          className="flex h-7 w-full items-center justify-center rounded-[8px] transition-colors hover:bg-white/5"
          style={{ color: "var(--sidebar-text-2)" }}
          aria-label={expanded ? t("desktop.collapse_menu") : t("desktop.expand_menu")}
        >
          {expanded
            ? (dir === "rtl" ? <PanelRightClose size={14} /> : <PanelLeftClose size={14} />)
            : (dir === "rtl" ? <PanelRightOpen  size={14} /> : <PanelLeftOpen  size={14} />)
          }
        </button>
      </div>
    </aside>
  )
}

export function BottomNav() {
  const location = useLocation()
  const { t } = useI18n()
  const [, setSecurityVersion] = useState(0)
  const visibleMenuItems = menuItems.filter((item) => userCan(item.permission))
  useEffect(() => subscribeSecurity(() => setSecurityVersion((v) => v + 1)), [])

  return (
    <nav
      className="mobile-bottom-nav fixed inset-x-0 bottom-0 z-40 md:hidden"
      style={{
        background: "var(--sidebar-bg)",
        borderTop: "1px solid var(--sidebar-border)",
        paddingBottom: "calc(env(safe-area-inset-bottom) + 4px)",
      }}
    >
      <div className="flex gap-0 overflow-x-auto px-1 [scrollbar-width:none] [-webkit-overflow-scrolling:touch]">
        {visibleMenuItems.map((item) => {
          const active = isActivePath(location.pathname, item.path)
          return (
            <Link
              key={item.path}
              to={item.path}
              aria-label={t(item.labelKey)}
              className="relative flex min-w-[56px] flex-1 flex-col items-center justify-center gap-0.5 py-2 select-none touch-manipulation active:opacity-70 transition-opacity"
            >
              {/* Active indicator dot */}
              {active && (
                <span
                  className="absolute top-0 left-1/2 -translate-x-1/2 h-[3px] w-5 rounded-b-full"
                  style={{ background: "var(--sidebar-active-border)" }}
                />
              )}

              <span
                className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors duration-150"
                style={{
                  background: active ? "var(--sidebar-icon-active)" : "transparent",
                  color: active ? "var(--sidebar-icon-active-color)" : "var(--sidebar-icon-color)",
                }}
              >
                <item.icon size={17} strokeWidth={1.75} />
              </span>

              <span
                className="text-[10px] font-semibold leading-none mt-0.5"
                style={{ color: active ? "var(--sidebar-active-text)" : "var(--sidebar-text-2)" }}
              >
                {t(item.labelKey)}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
