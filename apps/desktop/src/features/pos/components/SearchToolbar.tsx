import { useState, useRef, useEffect, type ChangeEvent, type RefObject } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { useI18n } from "@lebanonpos/shared"
import { Camera, Eraser, Keyboard, MoreVertical, Scan, Zap } from "lucide-react"
import { formatNumber } from "../lib/currency"
const MotionDiv = motion.div as any
const MotionSpan = motion.span as any
const MotionButton = motion.button as any

type Props = {
  scanInputRef: RefObject<HTMLInputElement | null>
  scanCode: string
  onScanCodeChange: (value: string) => void
  onQuickAdd: (value: string) => void
  scannerStatus: string
  cameraActive: boolean
  cameraEngine: "native" | "html5" | null
  filteredProductsCount: number
  itemCount: number
  exchangeRate: number
  onStartCamera: () => void
  onCleanSale: () => void
  onCartOpen: () => void
  videoRef: RefObject<HTMLVideoElement | null>
  scanCaptureInputRef: RefObject<HTMLInputElement | null>
  onScanCapture: (event: ChangeEvent<HTMLInputElement>) => void
  quickMode: boolean
  onToggleQuickMode: () => void
  onShowShortcuts?: () => void
}

export default function SearchToolbar({
  scanInputRef,
  scanCode,
  onScanCodeChange,
  onQuickAdd,
  scannerStatus,
  cameraActive,
  cameraEngine,
  filteredProductsCount,
  onStartCamera,
  onCleanSale,
  videoRef,
  scanCaptureInputRef,
  onScanCapture,
  onToggleQuickMode,
  onShowShortcuts,
}: Props) {
  const { t, dir } = useI18n()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener("mousedown", onClickOutside)
    return () => document.removeEventListener("mousedown", onClickOutside)
  }, [menuOpen])

  const hasInput = scanCode.trim().length > 0

  return (
    <div className="flex flex-col gap-2">

      {/* ── Main search bar ───────────────────────────────── */}
      <div
        className="flex items-center gap-0 overflow-hidden rounded-2xl transition-all duration-200"
        style={{
          background: "var(--surface)",
          border: "1.5px solid",
          borderColor: hasInput ? "var(--brand)" : "var(--border)",
          boxShadow: hasInput ? "0 0 0 3px var(--brand-soft)" : "var(--shadow-xs)",
        }}
      >
        {/* Colored scan icon — left side */}
        <div
          className="flex shrink-0 items-center justify-center"
          style={{
            width: 52,
            color: hasInput ? "var(--brand)" : "var(--text-3)",
            transition: "color 0.2s",
          }}
        >
          <Scan size={20} strokeWidth={2} />
        </div>

        {/* Input */}
        <input
          ref={scanInputRef}
          autoFocus
          value={scanCode}
          onChange={(e) => onScanCodeChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); onQuickAdd(scanCode) }
          }}
          placeholder={t("pos.scan_placeholder")}
          className="min-w-0 flex-1 bg-transparent py-3 text-[15px] font-bold outline-none placeholder:font-medium"
          style={{
            color: "var(--text)",
            caretColor: "var(--brand)",
          }}
          dir={dir}
        />

        {/* Right side: clear (when text) or subtle count */}
        <div className="flex shrink-0 items-center gap-1 pr-2">
          <AnimatePresence>
            {hasInput && (
              <MotionButton
                type="button"
                onClick={() => onScanCodeChange("")}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-xs font-black transition hover:opacity-80"
                style={{ background: "var(--surface-2)", color: "var(--text-3)" }}
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.7 }}
                transition={{ duration: 0.15 }}
                whileTap={{ scale: 0.85 }}
              >
                ✕
              </MotionButton>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Status + small utilities ──────────────────────── */}
      <div className="flex items-center gap-2 px-1">

        {/* Status indicator */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <MotionSpan
            className="h-[6px] w-[6px] shrink-0 rounded-full"
            style={{ background: cameraActive ? "#ef4444" : "var(--brand)" }}
            animate={cameraActive ? { scale: [1, 1.6, 1], opacity: [1, 0.3, 1] } : {}}
            transition={cameraActive ? { duration: 1, repeat: Infinity } : {}}
          />
          <AnimatePresence mode="wait">
            <MotionSpan
              key={scannerStatus}
              className="truncate text-[11px] font-semibold"
              style={{ color: "var(--text-3)" }}
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -3 }}
              transition={{ duration: 0.15 }}
            >
              {scannerStatus}
            </MotionSpan>
          </AnimatePresence>
        </div>

        <span className="shrink-0 text-[11px] font-bold tabular-nums" style={{ color: "var(--text-3)" }}>
          {formatNumber(filteredProductsCount)} items
        </span>

        {/* Divider */}
        <span className="h-4 w-px shrink-0" style={{ background: "var(--border)" }} />

        {/* Camera — small icon-only */}
        <MotionButton
          type="button"
          onClick={onStartCamera}
          className="flex h-7 w-7 items-center justify-center rounded-lg border transition"
          style={cameraActive
            ? { background: "rgba(239,68,68,0.10)", borderColor: "rgba(239,68,68,0.30)", color: "#ef4444" }
            : { background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text-3)" }
          }
          whileTap={{ scale: 0.88 }}
          title={cameraActive ? t("pos.stop") : t("pos.scan")}
        >
          <Camera size={13} />
        </MotionButton>

        {/* Clear */}
        <MotionButton
          type="button"
          onClick={onCleanSale}
          className="flex h-7 w-7 items-center justify-center rounded-lg border transition"
          style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text-3)" }}
          whileTap={{ scale: 0.88 }}
          title="Clear sale"
        >
          <Eraser size={13} />
        </MotionButton>

        {/* Quick POS — always visible */}
        <MotionButton
          type="button"
          onClick={() => onToggleQuickMode()}
          className="flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-bold transition"
          style={{ background: "rgba(214,166,58,0.10)", borderColor: "rgba(214,166,58,0.25)", color: "#D6A63A" }}
          whileTap={{ scale: 0.92 }}
          title="Quick POS — full screen"
        >
          <Zap size={12} /> Quick POS
        </MotionButton>

        {/* More */}
        <div className="relative" ref={menuRef}>
          <MotionButton
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-7 w-7 items-center justify-center rounded-lg border transition"
            style={{ background: menuOpen ? "var(--surface-3)" : "var(--surface-2)", borderColor: "var(--border)", color: "var(--text-3)" }}
            whileTap={{ scale: 0.88 }}
          >
            <MoreVertical size={13} />
          </MotionButton>

          <AnimatePresence>
            {menuOpen && (
              <MotionDiv
                className="absolute right-0 top-full z-40 mt-1.5 w-52 overflow-hidden rounded-2xl border shadow-xl"
                style={{ background: "var(--surface)", borderColor: "var(--border)" }}
                initial={{ opacity: 0, scale: 0.92, y: -6 }}
                animate={{ opacity: 1, scale: 1,    y: 0  }}
                exit={{    opacity: 0, scale: 0.92, y: -6 }}
                transition={{ duration: 0.15 }}
              >
                <div className="p-1">
                  {onShowShortcuts && (
                    <button
                      type="button"
                      onClick={() => { onShowShortcuts(); setMenuOpen(false) }}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-semibold transition hover:opacity-80"
                      style={{ color: "var(--text)" }}
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: "var(--surface-2)" }}>
                        <Keyboard size={14} style={{ color: "var(--text-3)" }} />
                      </span>
                      Keyboard Shortcuts
                    </button>
                  )}
                </div>
              </MotionDiv>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Camera preview (small, when active) ─────────── */}
      <AnimatePresence>
        {cameraActive && (
          <MotionDiv
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div
              className="relative overflow-hidden rounded-xl"
              style={{ border: "1.5px solid var(--brand)", boxShadow: "0 0 0 3px var(--brand-soft)" }}
            >
              <MotionDiv
                className="pointer-events-none absolute inset-x-6 h-[2px] rounded-full"
                style={{ background: "linear-gradient(90deg,transparent,var(--brand),transparent)", zIndex: 10 }}
                animate={{ top: ["15%", "85%", "15%"] }}
                transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
              />
              <video
                ref={videoRef}
                muted
                playsInline
                className={`aspect-video w-full bg-zinc-950 object-cover ${cameraEngine === "native" ? "block" : "hidden"}`}
              />
              <div
                id="lebanonpos-pos-camera-reader"
                className={`overflow-hidden bg-zinc-950 ${cameraEngine === "html5" ? "block" : "hidden"}`}
              />
            </div>
          </MotionDiv>
        )}
      </AnimatePresence>

      <input ref={scanCaptureInputRef} type="file" accept="image/*" capture="environment" onChange={onScanCapture} className="hidden" />
    </div>
  )
}
