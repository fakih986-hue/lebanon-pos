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
  ReceiptText,
  Settings,
  ShieldCheck,
  Store,
  Truck,
  UsersRound,
  Wifi,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { useEffect, useState } from "react"

import { formatCurrency } from "../../features/pos/lib/currency"
import {
  getActiveShift,
  userCan,
  subscribeSecurity,
  type Permission,
} from "../../features/pos/services/security.service"

const SIDEBAR_EXPANDED_KEY = "lebanonpos.sidebar-expanded.v1"

type MenuItem = {
  label: string
  detail: string
  path: string
  icon: LucideIcon
  permission: Permission
  group: "Command" | "Retail" | "Operations" | "Admin"
}

export const menuItems: MenuItem[] = [
  {
    label: "Dashboard",
    detail: "Command",
    path: "/dashboard",
    icon: Gauge,
    permission: "reports.view",
    group: "Command",
  },
  {
    label: "POS",
    detail: "Checkout",
    path: "/",
    icon: LayoutDashboard,
    permission: "sales.checkout",
    group: "Retail",
  },
  {
    label: "Products",
    detail: "Inventory",
    path: "/products",
    icon: PackageSearch,
    permission: "inventory.manage",
    group: "Retail",
  },
  {
    label: "Sales",
    detail: "History",
    path: "/sales",
    icon: ReceiptText,
    permission: "reports.view",
    group: "Retail",
  },
  {
    label: "Receiving",
    detail: "Batches",
    path: "/products/new",
    icon: ClipboardPlus,
    permission: "inventory.manage",
    group: "Retail",
  },
  {
    label: "Customers",
    detail: "Debts",
    path: "/customers",
    icon: UsersRound,
    permission: "customers.manage",
    group: "Retail",
  },
  {
    label: "Delivery",
    detail: "Orders",
    path: "/delivery",
    icon: Truck,
    permission: "delivery.manage",
    group: "Retail",
  },
  {
    label: "Suppliers",
    detail: "Payables",
    path: "/suppliers",
    icon: ClipboardList,
    permission: "accounting.manage",
    group: "Operations",
  },
  {
    label: "Accounting",
    detail: "Profit",
    path: "/accounting",
    icon: Calculator,
    permission: "accounting.manage",
    group: "Operations",
  },
  {
    label: "Staff",
    detail: "Shifts",
    path: "/staff",
    icon: ShieldCheck,
    permission: "staff.manage",
    group: "Admin",
  },
  {
    label: "Settings",
    detail: "System",
    path: "/settings",
    icon: Settings,
    permission: "settings.manage",
    group: "Admin",
  },
]

const menuGroups: MenuItem["group"][] = [
  "Command",
  "Retail",
  "Operations",
  "Admin",
]

function isActivePath(pathname: string, path: string) {
  if (path === "/") {
    return pathname === "/"
  }

  if (path === "/products" || path === "/products/new") {
    return pathname === path
  }

  return pathname === path || pathname.startsWith(`${path}/`)
}

export default function Sidebar() {
  const location = useLocation()
  const [, setSecurityVersion] = useState(0)
  const [expanded, setExpanded] = useState(() => {
    if (typeof window === "undefined") {
      return false
    }

    return window.localStorage.getItem(SIDEBAR_EXPANDED_KEY) === "true"
  })
  const activeShift = getActiveShift()
  const visibleMenuItems = menuItems.filter((item) => userCan(item.permission))

  useEffect(
    () => subscribeSecurity(() => setSecurityVersion((version) => version + 1)),
    []
  )

  function toggleExpanded() {
    setExpanded((currentValue) => {
      const nextValue = !currentValue

      window.localStorage.setItem(SIDEBAR_EXPANDED_KEY, String(nextValue))

      return nextValue
    })
  }

  return (
    <aside
      className={`hidden h-full shrink-0 flex-col border-r border-zinc-200 bg-zinc-950 text-white transition-[width] duration-200 md:flex ${
        expanded ? "w-72" : "w-20"
      }`}
    >
      <div className="shrink-0 border-b border-white/10 p-3">
        <div
          className={`flex gap-3 ${
            expanded
              ? "items-center justify-between"
              : "flex-col items-center justify-center"
          }`}
        >
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-400 text-zinc-950">
            <Store size={22} strokeWidth={2.5} />
          </div>

          {expanded ? (
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-xl font-bold leading-tight">
                Lebanon POS
              </h1>
              <p className="truncate text-sm text-zinc-400">
                Retail checkout suite
              </p>
            </div>
          ) : null}

          <button
            type="button"
            onClick={toggleExpanded}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-300 transition hover:bg-white/10 hover:text-white"
            aria-label={expanded ? "Collapse menu" : "Expand menu"}
            title={expanded ? "Collapse menu" : "Expand menu"}
          >
            {expanded ? (
              <PanelLeftClose size={18} />
            ) : (
              <PanelLeftOpen size={18} />
            )}
          </button>
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto p-2 [scrollbar-width:thin]">
        {menuGroups.map((group) => {
          const groupItems = visibleMenuItems.filter((item) => item.group === group)

          if (groupItems.length === 0) {
            return null
          }

          return (
            <div key={group} className={expanded ? "mb-4" : "mb-2"}>
              {expanded ? (
                <p className="mb-2 px-3 text-[0.68rem] font-black uppercase tracking-[0.18em] text-zinc-500">
                  {group}
                </p>
              ) : null}

              <div className="space-y-2">
                {groupItems.map((item) => {
                  const active = isActivePath(location.pathname, item.path)
                  const Icon = item.icon

                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      aria-label={item.label}
                      title={expanded ? undefined : item.label}
                      className={`
                        flex items-center gap-3 rounded-lg border p-3 transition ${
                          expanded ? "justify-start" : "justify-center"
                        }
                        ${
                          active
                            ? "border-emerald-300 bg-white text-zinc-950 shadow-sm"
                            : "border-white/10 bg-white/5 text-zinc-300 hover:border-white/20 hover:bg-white/10 hover:text-white"
                        }
                      `}
                    >
                      <span
                        className={`
                          flex h-10 w-10 shrink-0 items-center justify-center rounded-lg
                          ${
                            active
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-white/10"
                          }
                        `}
                      >
                        <Icon size={20} />
                      </span>

                      {expanded ? (
                        <span className="min-w-0">
                          <span className="block font-semibold leading-tight">
                            {item.label}
                          </span>
                          <span className="block text-sm text-zinc-500">
                            {item.detail}
                          </span>
                        </span>
                      ) : null}
                    </Link>
                  )
                })}
              </div>
            </div>
          )
        })}
      </nav>

      {expanded ? (
        <div className="shrink-0 border-t border-white/10 p-4 max-[900px]:hidden">
          <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-200">
              <Wifi size={16} />
              System online
            </div>

            <div className="mt-3 flex items-center justify-between text-sm text-zinc-400">
              <span>Shift float</span>
              <span className="inline-flex items-center gap-1 font-semibold text-white">
                <CircleDollarSign size={15} />
                {activeShift
                  ? formatCurrency(activeShift.openingFloatUsd)
                  : "Closed"}
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  )
}

export function BottomNav() {
  const location = useLocation()
  const [, setSecurityVersion] = useState(0)
  const visibleMenuItems = menuItems.filter((item) => userCan(item.permission))

  useEffect(
    () => subscribeSecurity(() => setSecurityVersion((version) => version + 1)),
    []
  )

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white/95 px-2 pb-[calc(env(safe-area-inset-bottom)+0.35rem)] pt-2 shadow-2xl backdrop-blur">
      <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto [scrollbar-width:thin]">
        {visibleMenuItems.map((item) => {
          const active = isActivePath(location.pathname, item.path)
          const Icon = item.icon

          return (
            <Link
              key={item.path}
              to={item.path}
              aria-label={item.label}
              className={`flex min-w-20 flex-none flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-[0.7rem] font-bold transition sm:min-w-24 md:text-xs ${
                active
                  ? "bg-zinc-950 text-white"
                  : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950"
              }`}
            >
              <Icon size={19} />
              <span className="leading-none">{item.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
