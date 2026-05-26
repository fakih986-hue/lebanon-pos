import { useEffect, useState } from "react"
import { CalendarClock, LockKeyhole, ShieldCheck, UserRound } from "lucide-react"
import { useLocation } from "react-router"

import {
  getActiveShift,
  getCurrentUser,
  lockSession,
  subscribeSecurity,
} from "../../features/pos/services/security.service"
import NotificationCenter from "./NotificationCenter"
import SyncStatus from "./SyncStatus"

const pageCopy: Record<string, { title: string; subtitle: string }> = {
  "/": {
    title: "Point of Sale",
    subtitle: "Fast checkout for counter sales",
  },
  "/dashboard": {
    title: "Dashboard",
    subtitle: "Live sales, stock, debts, and operations",
  },
  "/products": {
    title: "Products",
    subtitle: "Catalog, stock, and pricing",
  },
  "/sales": {
    title: "Sales",
    subtitle: "Receipts, payment mix, and performance",
  },
  "/products/new": {
    title: "Receive Products",
    subtitle: "Batch entry, scanning, and barcode labels",
  },
  "/customers": {
    title: "Customers",
    subtitle: "Debt accounts, payments, and balances",
  },
  "/accounting": {
    title: "Accounting",
    subtitle: "Expenses, suppliers, and daily profit closing",
  },
  "/suppliers": {
    title: "Suppliers",
    subtitle: "Purchase orders, payables, and supplier payments",
  },
  "/staff": {
    title: "Staff & Shifts",
    subtitle: "Users, roles, register shifts, and audit trail",
  },
  "/settings": {
    title: "Settings",
    subtitle: "Business profile, VAT, currency, receipts, and backup",
  },
}

export default function Topbar() {
  const location = useLocation()
  const [, setSecurityVersion] = useState(0)
  const page = pageCopy[location.pathname] ?? pageCopy["/"]
  const currentUser = getCurrentUser()
  const activeShift = getActiveShift()
  const today = new Intl.DateTimeFormat("en-LB", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date())

  useEffect(
    () => subscribeSecurity(() => setSecurityVersion((version) => version + 1)),
    []
  )

  return (
    <header className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-zinc-200 bg-white px-3 py-3 sm:px-5 xl:px-6">
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">
          Lebanon POS
        </p>
        <h2 className="truncate text-xl font-bold leading-tight text-zinc-950 sm:text-2xl">
          {page.title}
        </h2>
        <p className="hidden text-sm text-zinc-500 sm:block">
          {page.subtitle}
        </p>
      </div>

      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <div className="hidden h-11 items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-sm font-medium text-zinc-600 md:flex">
          <CalendarClock size={17} />
          {today}
        </div>

        <div className="hidden h-11 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-sm font-semibold text-emerald-800 md:flex">
          <ShieldCheck size={17} />
          {activeShift?.shiftNumber ?? "No shift"}
        </div>

        <SyncStatus />

        <NotificationCenter />

        <div className="flex h-10 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-800 sm:h-11">
          <UserRound size={17} />
          <span className="hidden sm:inline">{currentUser.name}</span>
        </div>

        <button
          type="button"
          onClick={lockSession}
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-500 transition hover:bg-zinc-50 hover:text-zinc-950 sm:h-11 sm:w-11"
          aria-label="Lock register"
          title="Lock register"
        >
          <LockKeyhole size={17} />
        </button>
      </div>
    </header>
  )
}
