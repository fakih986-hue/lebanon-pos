import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter, Routes, Route, Navigate } from "react-router"
import { I18nProvider, ThemeProvider, ErrorBoundary } from "@lebanonpos/shared"
import { LoginPage } from "./pages/LoginPage"
import { DashboardPage } from "./pages/DashboardPage"
import { DeliveryPage } from "./pages/DeliveryPage"
import { CustomersPage } from "./pages/CustomersPage"
import { ProductsPage } from "./pages/ProductsPage"
import { DriversPage } from "./pages/DriversPage"
import { StaffPage } from "./pages/StaffPage"
import { SalesPage } from "./pages/SalesPage"
import { Layout } from "./app/Layout"
import "./index.css"

const TOKEN_KEY = "lebanonpos.admin.token"

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem(TOKEN_KEY)
  if (!token) return <Navigate to="/admin/login" replace />
  return <>{children}</>
}

export function getToken() { return localStorage.getItem(TOKEN_KEY) }
export function setToken(token: string) { localStorage.setItem(TOKEN_KEY, token) }
export function clearToken() { localStorage.removeItem(TOKEN_KEY) }

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <I18nProvider>
        <ThemeProvider>
          <ErrorBoundary>
            <Routes>
              <Route path="/admin/login" element={<LoginPage />} />
              <Route path="/admin" element={<RequireAuth><Layout /></RequireAuth>}>
                <Route index element={<Navigate to="/admin/dashboard" replace />} />
                <Route path="dashboard" element={<DashboardPage />} />
                <Route path="delivery" element={<DeliveryPage />} />
                <Route path="customers" element={<CustomersPage />} />
                <Route path="products" element={<ProductsPage />} />
                <Route path="drivers" element={<DriversPage />} />
                <Route path="staff" element={<StaffPage />} />
                <Route path="sales" element={<SalesPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/admin" replace />} />
            </Routes>
          </ErrorBoundary>
        </ThemeProvider>
      </I18nProvider>
    </BrowserRouter>
  </StrictMode>
)
