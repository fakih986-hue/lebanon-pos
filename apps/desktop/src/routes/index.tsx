import { useEffect, useState, type ReactNode } from "react"
import { createBrowserRouter, RouterProvider, useLocation, Navigate } from "react-router"
import { AnimatePresence, motion } from "framer-motion"

import { runMigration } from "../features/pos/services/migration.service"
import AppLayout from "../layouts/AppLayout"
import Sidebar, { BottomNav } from "../components/layout/Sidebar"
import Topbar from "../components/layout/Topbar"
import AccessDenied from "../components/security/AccessDenied"
import ErrorBoundary from "../components/ErrorBoundary"
import ToastContainer from "../components/ui/Toast"

import POSPage from "../features/pos/pages/POSPage"
import { useToastStore } from "../features/pos/services/toast.service"
import {
  isSessionUnlocked,
  lockSession,
  subscribeSecurity,
  userCan,
  type Permission,
} from "../features/pos/services/security.service"
import { setupBackgroundSync, stopBackgroundSync, isSuspended, subscribeSuspended } from "../features/pos/services/sync.service"
import LoginScreen from "../pages/auth/LoginScreen"
import AccountingPage from "../pages/accounting/AccountingPage"
import CustomersPage from "../pages/customers/CustomersPage"
import DashboardPage from "../pages/dashboard/DashboardPage"
import ProductsPage from "../pages/products/ProductsPage"
import ProductReceivePage from "../pages/products/ProductReceivePage"
import SalesPage from "../pages/sales/SalesPage"
import StaffPage from "../pages/staff/StaffPage"
import SettingsPage from "../pages/settings/SettingsPage"
import SuppliersPage from "../pages/suppliers/SuppliersPage"
import DeliveryPage from "../pages/delivery/DeliveryPage"
import DriversPage from "../pages/drivers/DriversPage"

const AUTO_LOCK_MS = 10 * 60 * 1000
const MotionDiv = motion.div as any

function Shell({ children }: { children: ReactNode }) {
  const location = useLocation()
  const [, setSecurityVersion] = useState(0)
  const toasts = useToastStore((state) => state.toasts)
  const dismiss = useToastStore((state) => state.dismiss)

  useEffect(() => { runMigration() }, [])

  useEffect(() => { setupBackgroundSync(); return stopBackgroundSync }, [])

  useEffect(
    () => subscribeSecurity(() => setSecurityVersion((version) => version + 1)),
    []
  )

  const [suspended, setSuspended] = useState(isSuspended())
  useEffect(() => {
    const unsub = subscribeSuspended(setSuspended)
    const onStorage = (e: StorageEvent) => { if (e.key === "lebanonpos.suspended.v1") setSuspended(e.newValue === "true") }
    window.addEventListener("storage", onStorage)
    return () => { unsub(); window.removeEventListener("storage", onStorage) }
  }, [])

  useEffect(() => {
    if (!isSessionUnlocked()) return

    let timer: ReturnType<typeof setTimeout>

    function resetTimer() {
      clearTimeout(timer)
      timer = setTimeout(() => {
        lockSession()
        setSecurityVersion((version) => version + 1)
      }, AUTO_LOCK_MS)
    }

    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "wheel"]
    events.forEach((event) => window.addEventListener(event, resetTimer))
    resetTimer()

    return () => {
      clearTimeout(timer)
      events.forEach((event) => window.removeEventListener(event, resetTimer))
    }
  }, [])

  if (!isSessionUnlocked()) {
    return <LoginScreen />
  }

  const isPosRoute = location.pathname === "/"

  return (
    <AppLayout>
      <Sidebar />

      <div className={`flex min-w-0 flex-1 flex-col ${isPosRoute ? "pb-20 md:pb-0" : "pb-20 md:pb-0"}`}>
        <Topbar />
          {suspended && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0 }}>
              <div className="bg-slate-900 border border-rose-800/50 rounded-2xl p-8 max-w-md mx-4 text-center shadow-2xl">
                <div className="w-16 h-16 rounded-2xl bg-rose-500/10 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
                </div>
                <h2 className="text-xl font-bold text-white mb-2">Store Suspended</h2>
                <p className="text-sm text-slate-400">This store has been suspended by the platform owner. Please contact support for more information.</p>
              </div>
            </div>
          )}
          <ErrorBoundary>
            <AnimatePresence mode="wait">
              <MotionDiv
                key={location.pathname}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                className="flex min-h-0 flex-1 flex-col"
              >
                {children}
              </MotionDiv>
            </AnimatePresence>
          </ErrorBoundary>
      </div>

      <BottomNav />
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </AppLayout>
  )
}

function RequirePermission({
  permission,
  children,
}: {
  permission: Permission
  children: ReactNode
}) {
  if (!userCan(permission)) {
    return <AccessDenied />
  }

  return <>{children}</>
}

const router = createBrowserRouter([
  {
    path: "/",
    element: (
      <Shell>
        <RequirePermission permission="sales.checkout">
          <POSPage />
        </RequirePermission>
      </Shell>
    ),
  },

  {
    path: "/dashboard",
    element: (
      <Shell>
        <RequirePermission permission="reports.view">
          <DashboardPage />
        </RequirePermission>
      </Shell>
    ),
  },

  {
    path: "/products",
    element: (
      <Shell>
        <RequirePermission permission="inventory.manage">
          <ProductsPage />
        </RequirePermission>
      </Shell>
    ),
  },

  {
    path: "/sales",
    element: (
      <Shell>
        <RequirePermission permission="reports.view">
          <SalesPage />
        </RequirePermission>
      </Shell>
    ),
  },

  {
    path: "/customers",
    element: (
      <Shell>
        <RequirePermission permission="customers.manage">
          <CustomersPage />
        </RequirePermission>
      </Shell>
    ),
  },

  {
    path: "/accounting",
    element: (
      <Shell>
        <RequirePermission permission="accounting.manage">
          <AccountingPage />
        </RequirePermission>
      </Shell>
    ),
  },

  {
    path: "/suppliers",
    element: (
      <Shell>
        <RequirePermission permission="accounting.manage">
          <SuppliersPage />
        </RequirePermission>
      </Shell>
    ),
  },

  {
    path: "/staff",
    element: (
      <Shell>
        <RequirePermission permission="staff.manage">
          <StaffPage />
        </RequirePermission>
      </Shell>
    ),
  },

  {
    path: "/settings",
    element: (
      <Shell>
        <RequirePermission permission="settings.manage">
          <SettingsPage />
        </RequirePermission>
      </Shell>
    ),
  },

  {
    path: "/delivery",
    element: (
      <Shell>
        <RequirePermission permission="delivery.manage">
          <DeliveryPage />
        </RequirePermission>
      </Shell>
    ),
  },

  {
    path: "/delivery/drivers",
    element: (
      <Shell>
        <RequirePermission permission="delivery.manage">
          <DriversPage />
        </RequirePermission>
      </Shell>
    ),
  },

  {
    path: "/products/new",
    element: (
      <Shell>
        <RequirePermission permission="inventory.manage">
          <ProductReceivePage />
        </RequirePermission>
      </Shell>
    ),
  },

  {
    path: "*",
    element: <Navigate to="/" replace />,
  },
])

export default function AppRouter() {
  return <RouterProvider router={router} />
}
