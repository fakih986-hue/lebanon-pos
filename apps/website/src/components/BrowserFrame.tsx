import type { ReactNode } from "react"

/**
 * Premium presentation chrome for product screenshots — a minimal dark browser
 * frame (traffic dots + address pill) so raw captures read as a shipped product,
 * not a pasted image.
 */
export function BrowserFrame({ url = "titan-suite.net", children, className = "" }: { url?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl overflow-hidden border border-white/[0.09] bg-[#0b0906] shadow-[0_30px_90px_-24px_rgba(0,0,0,0.8)] ${className}`}>
      <div className="flex items-center gap-3 px-4 h-9 bg-white/[0.03] border-b border-white/[0.06]">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-white/[0.12]" />
          <span className="w-2.5 h-2.5 rounded-full bg-white/[0.12]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#d4af37]/40" />
        </div>
        <div className="flex-1 flex justify-center">
          <span className="text-[10px] text-slate-500 bg-white/[0.04] border border-white/[0.05] rounded-md px-3 py-0.5 font-medium tracking-wide max-w-[240px] truncate">
            {url}
          </span>
        </div>
        <div className="w-[52px]" />
      </div>
      {children}
    </div>
  )
}
