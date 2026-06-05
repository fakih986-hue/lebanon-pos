import { useState, useRef, useEffect, type ChangeEvent, type RefObject } from "react"
import { useI18n } from "@lebanonpos/shared"
import {
  Eraser,
  Keyboard,
  MoreVertical,
  ScanBarcode,
  ShoppingCart,
  Zap,
} from "lucide-react"
import { formatNumber } from "../lib/currency"

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
  itemCount,
  onStartCamera,
  onCleanSale,
  onCartOpen,
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
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [menuOpen])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-stretch gap-1.5">
        <label className="relative min-w-0 flex-1">
          <ScanBarcode
            size={18}
            className="pointer-events-none absolute"
            style={{ color: "var(--text-3)", [dir === "rtl" ? "right" : "left"]: "14px", top: "50%", transform: "translateY(-50%)" }}
          />
          <input
            ref={scanInputRef}
            autoFocus
            value={scanCode}
            onChange={(event) => onScanCodeChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                onQuickAdd(scanCode)
              }
            }}
            placeholder={t("pos.scan_placeholder")}
            className={`input h-[44px] rounded-lg text-[15px] font-bold ${dir === "rtl" ? "pr-12 pl-4" : "pl-[42px] pr-4"}`}
          />
        </label>

        <button
          type="button"
          onClick={() => onQuickAdd(scanCode)}
          className="pos-command-button pos-command-primary"
          style={{ height: 44, minWidth: 64, fontSize: 13 }}
        >
          <ScanBarcode size={16} />
          Add
        </button>
        <button
          type="button"
          onClick={onStartCamera}
          className="pos-command-button"
          style={{ height: 44, minWidth: 56, fontSize: 13 }}
        >
          <ScanBarcode size={16} />
          {cameraActive ? t("pos.stop") : t("pos.scan")}
        </button>
        <button
          type="button"
          onClick={onCartOpen}
          className="pos-command-button lg:hidden"
          style={{ height: 44, minWidth: 56, fontSize: 13 }}
        >
          <ShoppingCart size={16} />
          {formatNumber(itemCount)}
        </button>
        <button
          type="button"
          onClick={onCleanSale}
          className="pos-command-button"
          style={{ height: 44, minWidth: 56, fontSize: 13 }}
        >
          <Eraser size={16} />
        </button>

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="pos-command-button"
            style={{ height: 44, minWidth: 40, padding: "0 10px" }}
          >
            <MoreVertical size={16} />
          </button>

          {menuOpen && (
            <div
              className="absolute right-0 top-full z-40 mt-1 w-52 rounded-xl border py-1 shadow-lg"
              style={{ background: "var(--surface)", borderColor: "var(--border)" }}
            >
              <button
                type="button"
                onClick={() => { onToggleQuickMode(); setMenuOpen(false) }}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[13px] font-semibold transition hover:opacity-80"
                style={{ color: "var(--text)" }}
              >
                <Zap size={16} style={{ color: "var(--brand)" }} />
                Full Screen POS
              </button>
              {onShowShortcuts && (
                <button
                  type="button"
                  onClick={() => { onShowShortcuts(); setMenuOpen(false) }}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[13px] font-semibold transition hover:opacity-80"
                  style={{ color: "var(--text)" }}
                >
                  <Keyboard size={16} style={{ color: "var(--text-3)" }} />
                  Keyboard Shortcuts
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex h-[26px] items-center gap-2 px-1 text-[11px] font-semibold"
        style={{ color: "var(--text-3)" }}
      >
        <span className="h-[5px] w-[5px] shrink-0 rounded-full" style={{ background: "var(--brand)" }} />
        <span className="truncate">{scannerStatus}</span>
        <span className="ml-auto shrink-0 tabular-nums" style={{ color: "var(--text-3)" }}>
          {formatNumber(filteredProductsCount)} items
        </span>
      </div>

      <video
        ref={videoRef}
        muted
        playsInline
        className={`aspect-video w-full rounded-lg border border-zinc-200 bg-zinc-950 object-cover ${
          cameraActive && cameraEngine === "native" ? "block" : "hidden"
        }`}
      />
      <div
        id="lebanonpos-pos-camera-reader"
        className={`overflow-hidden rounded-lg border border-zinc-200 bg-zinc-950 ${
          cameraActive && cameraEngine === "html5" ? "block" : "hidden"
        }`}
      />
      <input
        ref={scanCaptureInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onScanCapture}
        className="hidden"
      />
    </div>
  )
}
