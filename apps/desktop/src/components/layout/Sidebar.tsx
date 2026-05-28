import { Link, useLocation } from "react-router"
import {
  Calculator,
  CircleDollarSign,
  ClipboardList,
  ClipboardPlus,
  Gauge,
  LayoutDashboard,
  PackageSearch,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  ReceiptText,
  Settings,
  ShieldCheck,
  Truck,
  UsersRound,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { useI18n } from "@lebanonpos/shared"

import { formatCurrency } from "../../features/pos/lib/currency"
import {
  getActiveShift,
  userCan,
  subscribeSecurity,
  type Permission,
} from "../../features/pos/services/security.service"
import { getSyncStatus, subscribeSync } from "../../features/pos/services/sync.service"

const SIDEBAR_EXPANDED_KEY = "lebanonpos.sidebar-expanded.v1"

type MenuItem = {
  label: string
  detail: string
  labelKey: string
  detailKey: string
  path: string
  icon: LucideIcon
  permission: Permission
  group: "Command" | "Retail" | "Operations" | "Admin"
}

export const menuItems: MenuItem[] = [
  { label: "Dashboard", detail: "Overview", labelKey: "nav.dashboard", detailKey: "desktop.nav.command", path: "/dashboard", icon: Gauge, permission: "reports.view", group: "Command" },
  { label: "POS", detail: "Checkout", labelKey: "desktop.nav.pos", detailKey: "desktop.nav.checkout", path: "/", icon: LayoutDashboard, permission: "sales.checkout", group: "Retail" },
  { label: "Products", detail: "Inventory", labelKey: "nav.products", detailKey: "desktop.nav.inventory", path: "/products", icon: PackageSearch, permission: "inventory.manage", group: "Retail" },
  { label: "Sales", detail: "History", labelKey: "desktop.nav.sales", detailKey: "desktop.nav.history", path: "/sales", icon: ReceiptText, permission: "reports.view", group: "Retail" },
  { label: "Receiving", detail: "Batches", labelKey: "desktop.nav.receiving", detailKey: "desktop.nav.batches", path: "/products/new", icon: ClipboardPlus, permission: "inventory.manage", group: "Retail" },
  { label: "Customers", detail: "Debts", labelKey: "nav.customers", detailKey: "desktop.nav.debts", path: "/customers", icon: UsersRound, permission: "customers.manage", group: "Retail" },
  { label: "Delivery", detail: "Orders", labelKey: "nav.delivery", detailKey: "desktop.nav.orders", path: "/delivery", icon: Truck, permission: "delivery.manage", group: "Retail" },
  { label: "Drivers", detail: "Manage", labelKey: "nav.drivers", detailKey: "drivers.subtitle", path: "/delivery/drivers", icon: UsersRound, permission: "delivery.manage", group: "Retail" },
  { label: "Suppliers", detail: "Payables", labelKey: "desktop.nav.suppliers", detailKey: "desktop.nav.payables", path: "/suppliers", icon: ClipboardList, permission: "accounting.manage", group: "Operations" },
  { label: "Accounting", detail: "Profit", labelKey: "desktop.nav.accounting", detailKey: "desktop.nav.profit", path: "/accounting", icon: Calculator, permission: "accounting.manage", group: "Operations" },
  { label: "Staff", detail: "Shifts", labelKey: "desktop.nav.staff", detailKey: "desktop.nav.shifts", path: "/staff", icon: ShieldCheck, permission: "staff.manage", group: "Admin" },
  { label: "Settings", detail: "System", labelKey: "nav.settings", detailKey: "desktop.nav.system", path: "/settings", icon: Settings, permission: "settings.manage", group: "Admin" },
]

const menuGroups: MenuItem["group"][] = ["Command", "Retail", "Operations", "Admin"]

function isActivePath(pathname: string, path: string) {
  if (path === "/") return pathname === "/"
  if (path === "/products" || path === "/products/new") return pathname === path
  return pathname === path || pathname.startsWith(`${path}/`)
}

export default function Sidebar() {
  const location = useLocation()
  const { t, dir } = useI18n()
  const [, setSecurityVersion] = useState(0)
  const [syncPending, setSyncPending] = useState(0)
  const [expanded, setExpanded] = useState(() =>
    typeof window !== "undefined" && window.localStorage.getItem(SIDEBAR_EXPANDED_KEY) === "true"
  )
  const activeShift = getActiveShift()
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

  return (
    <aside
      style={{ background: "var(--sidebar-bg)", borderColor: "var(--sidebar-border)" }}
      className={`hidden h-full shrink-0 flex-col text-white transition-[width] duration-200 md:flex ${expanded ? "w-64" : "w-[72px]"} ${dir === "rtl" ? "border-l" : "border-r"}`}
    >
      {/* Logo + Toggle */}
      <div
        className={`flex shrink-0 items-center gap-3 border-b px-3 py-3 ${expanded ? "justify-between" : "flex-col justify-center"}`}
        style={{ borderColor: "var(--sidebar-border)", minHeight: 64 }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-lg shadow-emerald-900/30">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/>
            </svg>
          </div>
          {expanded && (
            <div className="min-w-0 animate-fade-in">
              <p className="truncate text-[13px] font-bold leading-tight" style={{ color: "var(--sidebar-text)" }}>Lebanon POS</p>
              <p className="truncate text-[11px]" style={{ color: "var(--sidebar-text-2)" }}>Retail Suite</p>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={toggleExpanded}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition"
          style={{ color: "var(--sidebar-text-2)" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--sidebar-text)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--sidebar-text-2)")}
          aria-label={expanded ? t("desktop.collapse_menu") : t("desktop.expand_menu")}
        >
          {expanded
            ? (dir === "rtl" ? <PanelRightClose size={16} /> : <PanelLeftClose size={16} />)
            : (dir === "rtl" ? <PanelRightOpen size={16}  /> : <PanelLeftOpen size={16}  />)
          }
        </button>
      </div>

      {/* Nav */}
      <nav className={`min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] ${expanded ? "px-2 py-3" : "px-2 py-3"}`}>
        {menuGroups.map((group) => {
          const items = visibleMenuItems.filter((item) => item.group === group)
          if (items.length === 0) return null

          return (
            <div key={group} className={expanded ? "mb-5" : "mb-4"}>
              {expanded && (
                <p
                  className="mb-1.5 px-2 text-[10px] font-bold uppercase tracking-[0.16em]"
                  style={{ color: "var(--sidebar-text-2)" }}
                >
                  {t(`desktop.group.${group}`)}
                </p>
              )}
              <div className="space-y-0.5">
                {items.map((item) => {
                  const active = isActivePath(location.pathname, item.path)
                  const Icon = item.icon

                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      title={expanded ? undefined : t(item.labelKey)}
                      className={`sidebar-link ${active ? "active" : ""} ${expanded ? "" : "justify-center"}`}
                    >
                      <span className="sidebar-icon">
                        <Icon size={17} />
                      </span>

                      {expanded && (
                        <span className="min-w-0 flex-1 animate-fade-in">
                          <span
                            className="block text-[13px] font-semibold leading-tight"
                            style={{ color: active ? "var(--sidebar-active-text)" : "var(--sidebar-text)" }}
                          >
                            {t(item.labelKey)}
                          </span>
                        </span>
                      )}
                    </Link>
                  )
                })}
              </div>
            </div>
          )
        })}
      </nav>

      {/* Bottom: shift + sync status */}
      {expanded && (
        <div className="shrink-0 border-t p-3 space-y-2" style={{ borderColor: "var(--sidebar-border)" }}>
          <div
            className="rounded-lg px-3 py-2.5 flex items-center justify-between gap-2"
            style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.15)" }}
          >
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${activeShift ? "bg-emerald-400" : "bg-zinc-500"}`} />
              <span className="text-[12px] font-semibold" style={{ color: activeShift ? "#6EE7B7" : "var(--sidebar-text-2)" }}>
                {activeShift ? activeShift.shiftNumber : t("desktop.closed")}
              </span>
            </div>
            {activeShift && (
              <span className="text-[11px] font-semibold" style={{ color: "#6EE7B7" }}>
                <CircleDollarSign size={13} className="inline mr-0.5" />
                {formatCurrency(activeShift.openingFloatUsd)}
              </span>
            )}
          </div>

          {syncPending > 0 && (
            <div
              className="rounded-lg px-3 py-2 flex items-center gap-2"
              style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.15)" }}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-[11px] font-semibold text-amber-400">{syncPending} pending sync</span>
            </div>
          )}
        </div>
      )}
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
      className="fixed inset-x-0 bottom-0 z-40 border-t px-2 pb-[calc(env(safe-area-inset-bottom)+4px)] pt-1.5 backdrop-blur-xl"
      style={{ background: "rgba(var(--bg),0.92)", borderColor: "var(--border)" }}
    >
      <div className="mx-auto flex max-w-6xl gap-0.5 overflow-x-auto [scrollbar-width:none]">
        {visibleMenuItems.map((item) => {
          const active = isActivePath(location.pathname, item.path)
          const Icon = item.icon
          return (
            <Link
              key={item.path}
              to={item.path}
              aria-label={t(item.labelKey)}
              className={`flex min-w-[72px] flex-none flex-col items-center gap-1 rounded-lg px-2 py-2 text-[10px] font-bold transition ${
                active
                  ? "text-white"
                  : "text-[var(--text-3)] hover:text-[var(--text)]"
              }`}
              style={active ? { background: "var(--brand)" } : undefined}
            >
              <Icon size={18} />
              <span className="leading-none">{t(item.labelKey)}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
