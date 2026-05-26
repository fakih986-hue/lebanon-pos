import { useEffect, useState, type ReactNode } from "react"
import { createBrowserRouter, RouterProvider, useLocation } from "react-router"
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
import { setupBackgroundSync, stopBackgroundSync } from "../features/pos/services/sync.service"
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

const AUTO_LOCK_MS = 10 * 60 * 1000

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

  return (
    <AppLayout>
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col pb-20">
        <Topbar />
          <ErrorBoundary>
            <AnimatePresence mode="wait">
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                className="flex min-h-0 flex-1 flex-col"
              >
                {children}
              </motion.div>
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
    path: "/products/new",
    element: (
      <Shell>
        <RequirePermission permission="inventory.manage">
          <ProductReceivePage />
        </RequirePermission>
      </Shell>
    ),
  },
])

export default function AppRouter() {
  return <RouterProvider router={router} />
}
