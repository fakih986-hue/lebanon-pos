import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter, Routes, Route, Navigate } from "react-router"
import { I18nProvider, ThemeProvider, ErrorBoundary } from "@lebanonpos/shared"
import { FindStorePage } from "./pages/FindStorePage"
import { MenuPage } from "./pages/MenuPage"
import { TrackingPage } from "./pages/TrackingPage"
import { LoginPage } from "./pages/LoginPage"
import { OrdersPage } from "./pages/OrdersPage"
import "./index.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <I18nProvider>
        <ThemeProvider>
          <ErrorBoundary>
            <Routes>
              <Route path="/order" element={<FindStorePage />} />
              <Route path="/order/:tenantSubdomain" element={<MenuPage />} />
              <Route path="/order/:tenantSubdomain/track/:orderNumber" element={<TrackingPage />} />
              <Route path="/order/:tenantSubdomain/login" element={<LoginPage />} />
              <Route path="/order/:tenantSubdomain/orders" element={<OrdersPage />} />
              <Route path="*" element={<Navigate to="/order" replace />} />
            </Routes>
          </ErrorBoundary>
        </ThemeProvider>
      </I18nProvider>
    </BrowserRouter>
  </StrictMode>
)
