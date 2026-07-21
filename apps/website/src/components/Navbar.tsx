import { useEffect, useState } from "react"
import { Link, NavLink } from "react-router"
import { Logo } from "./Logo"

const LINKS = [
  { to: "/pos", label: "POS" },
  { to: "/payroll", label: "HR & Payroll" },
  { to: "/company", label: "Company" },
  { to: "/about", label: "About" },
]

export function Navbar() {
  const [progress, setProgress] = useState(0)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight
      setProgress(max > 0 ? window.scrollY / max : 0)
    }
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  // Escape closes the mobile menu
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  return (
    <>
      {/* Scroll progress */}
      <div className="fixed top-0 inset-x-0 z-[60] h-[2px] bg-transparent">
        <div
          className="h-full bg-gradient-to-r from-[#f2dd9b] via-[#d4af37] to-[#8f6a14]"
          style={{ width: `${progress * 100}%`, transition: "width 0.1s linear" }}
        />
      </div>

      {/* Floating pill nav */}
      <header className="fixed top-3 sm:top-4 inset-x-0 z-[70] px-3 sm:px-4">
        <nav className="max-w-3xl mx-auto glass rounded-2xl h-14 pl-4 pr-2 flex items-center justify-between shadow-[0_8px_40px_-12px_rgba(0,0,0,0.6)] max-md:bg-[#080705]/90 max-md:border-[#d4af37]/20 max-md:shadow-[0_18px_60px_-18px_rgba(0,0,0,0.95)]">
          <Link to="/" onClick={() => setOpen(false)}>
            <Logo size={32} />
          </Link>

          <div className="hidden md:flex items-center gap-0.5">
            {LINKS.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) =>
                  `px-3.5 py-2 rounded-xl text-[13px] font-medium transition-all duration-200 ${
                    isActive ? "text-white bg-white/[0.08]" : "text-slate-400 hover:text-white hover:bg-white/[0.04]"
                  }`
                }
              >
                {l.label}
              </NavLink>
            ))}
            <NavLink
              to="/contact"
              className="ml-2 px-4 py-2 shine rounded-xl text-[13px] font-semibold bg-gradient-to-r from-[#e9c766] to-[#a4841f] text-[#0b0803] hover:opacity-90 transition-opacity"
            >
              Contact
            </NavLink>
          </div>

          <button
            className="md:hidden w-10 h-10 flex items-center justify-center rounded-xl hover:bg-white/[0.05] transition-colors"
            onClick={() => setOpen((v) => !v)}
            aria-label="Toggle menu"
            aria-expanded={open}
          >
            <div className="w-4 flex flex-col gap-[4px]">
              <span className={`h-[2px] bg-white rounded transition-transform duration-300 ${open ? "rotate-45 translate-y-[6px]" : ""}`} />
              <span className={`h-[2px] bg-white rounded transition-opacity duration-300 ${open ? "opacity-0" : ""}`} />
              <span className={`h-[2px] bg-white rounded transition-transform duration-300 ${open ? "-rotate-45 -translate-y-[6px]" : ""}`} />
            </div>
          </button>
        </nav>

        {open && (
          <div className="mobile-menu-panel md:hidden max-w-3xl mx-auto mt-2 rounded-2xl px-3 py-3 flex flex-col gap-1">
            {LINKS.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `px-4 py-3 rounded-xl text-sm font-semibold transition-colors ${isActive ? "text-white bg-[#d4af37]/15 border border-[#d4af37]/20" : "text-slate-200 hover:text-white hover:bg-white/[0.06]"}`
                }
              >
                {l.label}
              </NavLink>
            ))}
            {/* Contact carries the same primary emphasis as the desktop nav CTA */}
            <NavLink
              to="/contact"
              onClick={() => setOpen(false)}
              className="mt-1 px-4 py-3 rounded-xl text-sm font-semibold text-center bg-gradient-to-r from-[#e9c766] to-[#a4841f] text-[#0b0803]"
            >
              Contact
            </NavLink>
          </div>
        )}
      </header>
    </>
  )
}
