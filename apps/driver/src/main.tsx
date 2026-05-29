import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter, Routes, Route, Navigate } from "react-router"
import { I18nProvider, ThemeProvider, ErrorBoundary } from "@lebanonpos/shared"
import { LoginPage } from "./pages/LoginPage"
import { OrdersPage } from "./pages/OrdersPage"
import { OrderDetailPage } from "./pages/OrderDetailPage"
import "./index.css"

const TOKEN_KEY = "lebanonpos.driver.token"

export function getToken() { return localStorage.getItem(TOKEN_KEY) }
export function setToken(t: string) { localStorage.setItem(TOKEN_KEY, t) }
export function clearToken() { localStorage.removeItem(TOKEN_KEY) }

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = getToken()
  if (!token) return <Navigate to="/login" replace />
  return <>{children}</>
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
      <BrowserRouter basename={import.meta.env.PROD ? "/driver" : undefined}>
      <I18nProvider>
        <ThemeProvider>
          <ErrorBoundary>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/orders" element={<RequireAuth><OrdersPage /></RequireAuth>} />
              <Route path="/orders/:id" element={<RequireAuth><OrderDetailPage /></RequireAuth>} />
              <Route path="*" element={<Navigate to="/orders" replace />} />
            </Routes>
          </ErrorBoundary>
        </ThemeProvider>
      </I18nProvider>
    </BrowserRouter>
  </StrictMode>
)
