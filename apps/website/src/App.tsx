import { Routes, Route, useLocation } from "react-router"
import { useEffect } from "react"
import { ThreeBackground } from "./components/ThreeBackground"
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

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])
  return null
}

export default function App() {
  const location = useLocation()

  return (
    <div className="min-h-dvh flex flex-col noise">
      <ThreeBackground />
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
