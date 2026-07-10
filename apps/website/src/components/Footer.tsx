import { Link } from "react-router"
import { Logo } from "./Logo"

export function Footer() {
  return (
    <footer className="relative border-t border-white/[0.06] mt-32 overflow-hidden">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 py-14 grid grid-cols-1 sm:grid-cols-3 gap-10 relative z-10">
        <div>
          <div className="mb-4">
            <Logo size={36} />
          </div>
          <p className="text-sm text-slate-400 max-w-xs leading-relaxed">
            Commercial-grade software for real businesses — point of sale, HR, and payroll, built to actually run day-to-day operations.
          </p>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 mb-4">Products</p>
          <div className="flex flex-col gap-2.5 text-sm text-slate-400">
            <Link to="/pos" className="hover:text-[#e9c766] transition-colors w-fit">Titan POS</Link>
            <Link to="/payroll" className="hover:text-[#e9c766] transition-colors w-fit">Titan HR & Payroll</Link>
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 mb-4">Company</p>
          <div className="flex flex-col gap-2.5 text-sm text-slate-400">
            <Link to="/company" className="hover:text-[#e9c766] transition-colors w-fit">About Titan</Link>
            <Link to="/about" className="hover:text-[#e9c766] transition-colors w-fit">Founder</Link>
            <Link to="/contact" className="hover:text-[#e9c766] transition-colors w-fit">Contact</Link>
          </div>
        </div>
      </div>

      {/* Giant outlined wordmark */}
      <div className="relative select-none pointer-events-none" aria-hidden="true">
        <p className="font-display font-bold text-outline text-center leading-none text-[22vw] tracking-tight -mb-[7vw]">
          TITAN
        </p>
      </div>

      <div className="relative z-10 max-w-6xl mx-auto px-5 sm:px-8 py-6 border-t border-white/[0.06] text-xs text-slate-500 flex items-center justify-between">
        <span>© {new Date().getFullYear()} Titan. All rights reserved.</span>
        <span className="text-slate-600">Built in Lebanon 🇱🇧</span>
      </div>
    </footer>
  )
}
