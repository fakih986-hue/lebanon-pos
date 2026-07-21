import { Routes, Route, useLocation } from "react-router"
import { useEffect, useState, lazy, Suspense } from "react"
import { IntroLoader } from "./components/IntroLoader"
import { Spotlight } from "./components/Spotlight"
import { Navbar } from "./components/Navbar"
import { Footer } from "./components/Footer"
import HomePage from "./pages/HomePage"
import AboutPage from "./pages/AboutPage"
import CompanyPage from "./pages/CompanyPage"
import POSPage from "./pages/POSPage"
import PayrollPage from "./pages/PayrollPage"
import ContactPage from "./pages/ContactPage"

// The WebGL scene (three.js, ~500KB) is the single largest chunk. It's purely
// decorative — the CSS gradient background stands on its own — so we split it
// out and mount it only once the browser is idle, keeping it off the critical
// path for first paint / interactivity.
const ThreeBackground = lazy(() =>
  import("./components/ThreeBackground").then((m) => ({ default: m.ThreeBackground }))
)

/** Returns true once the browser is idle (or after a short fallback delay). */
function useIdleReady(): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const w = window as typeof window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
      cancelIdleCallback?: (id: number) => void
    }
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => setReady(true), { timeout: 2000 })
      return () => w.cancelIdleCallback?.(id)
    }
    const t = setTimeout(() => setReady(true), 900)
    return () => clearTimeout(t)
  }, [])
  return ready
}

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])
  return null
}

export default function App() {
  const location = useLocation()
  const threeReady = useIdleReady()

  return (
    <div className="min-h-dvh flex flex-col noise">
      {threeReady && (
        <Suspense fallback={null}>
          <ThreeBackground />
        </Suspense>
      )}
      <IntroLoader />
      <Spotlight />
      <ScrollToTop />
      <Navbar />
      <main className="flex-1 relative z-10">
        {/* Keyed wrapper re-runs the enter animation on every route change */}
        <div key={location.pathname} className="page-enter">
          <Routes location={location}>
            <Route path="/" element={<HomePage />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/company" element={<CompanyPage />} />
            <Route path="/pos" element={<POSPage />} />
            <Route path="/payroll" element={<PayrollPage />} />
            <Route path="/contact" element={<ContactPage />} />
          </Routes>
        </div>
      </main>
      <Footer />
    </div>
  )
}
