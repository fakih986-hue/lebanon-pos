import type { ChangeEvent, RefObject } from "react"
import { useI18n } from "@lebanonpos/shared"
import {
  Eraser,
  ScanBarcode,
  Search,
  ShoppingCart,
  Zap,
} from "lucide-react"
import { formatLbpCurrency, formatNumber } from "../lib/currency"

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
  exchangeRate,
  onStartCamera,
  onCleanSale,
  onCartOpen,
  videoRef,
  scanCaptureInputRef,
  onScanCapture,
  quickMode,
  onToggleQuickMode,
}: Props) {
  const { t, dir } = useI18n()

  return (
    <div className="pos-command-panel p-3 sm:p-4">
      {/* Compact header with inline chips */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[18px] font-black leading-none tracking-tight" style={{ color: "var(--text)" }}>
          Scan, tap, sell
        </h2>
        <div className="flex flex-wrap gap-1.5">
          <span className="pos-command-chip">Active shift</span>
          <span className="pos-command-chip">{formatNumber(itemCount)} items</span>
          <span className="pos-command-chip" style={{ background: "var(--brand-soft)", borderColor: "var(--brand-border)", color: "var(--brand-text)" }}>
            1 USD = {formatLbpCurrency(exchangeRate)}
          </span>
        </div>
      </div>

      {/* Search + buttons row */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
        <label className="relative min-w-0 flex-1">
          <Search
            size={20}
            className="pointer-events-none absolute"
            style={{ color: "#059669", [dir === "rtl" ? "right" : "left"]: "16px", top: "50%", transform: "translateY(-50%)" }}
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
            className={`input h-[54px] rounded-lg text-[17px] font-black ${dir === "rtl" ? "pr-14 pl-4" : "pl-[48px] pr-4"}`}
          />
        </label>

        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => onQuickAdd(scanCode)}
            className="pos-command-button pos-command-primary"
            style={{ height: 54, minWidth: 80 }}
          >
            <ScanBarcode size={18} />
            Add
          </button>
          <button
            type="button"
            onClick={onToggleQuickMode}
            className="pos-command-button pos-command-dark"
            style={{ height: 54, minWidth: 100 }}
          >
            <Zap size={18} />
            Full Screen POS
          </button>
          <button
            type="button"
            onClick={onStartCamera}
            className="pos-command-button"
            style={{ height: 54, minWidth: 72 }}
          >
            <ScanBarcode size={18} />
            {cameraActive ? t("pos.stop") : t("pos.scan")}
          </button>
          <button
            type="button"
            onClick={onCartOpen}
            className="pos-command-button"
            style={{ height: 54, minWidth: 72 }}
          >
            <ShoppingCart size={18} />
            {t("pos.cart")}
          </button>
          <button
            type="button"
            onClick={onCleanSale}
            className="pos-command-button"
            style={{ height: 54, minWidth: 72 }}
          >
            <Eraser size={18} />
            {t("pos.clean")}
          </button>
        </div>
      </div>

      {/* Unified status bar */}
      <div className="mt-3 flex h-[34px] items-center gap-2 rounded-lg border px-3 text-[12px] font-semibold"
        style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text-2)" }}
      >
        <span className="h-[6px] w-[6px] shrink-0 rounded-full" style={{ background: "var(--brand)" }} />
        <span className="truncate">{scannerStatus}</span>
        <span className="ml-auto shrink-0 rounded-md px-2 py-0.5 text-[11px] font-black"
          style={{ background: "var(--brand-soft)", borderColor: "var(--brand-border)", color: "var(--brand-text)" }}
        >
          {t("pos.items_shown", { n: formatNumber(filteredProductsCount) })}
        </span>
      </div>

      <video
        ref={videoRef}
        muted
        playsInline
        className={`mt-3 aspect-video w-full rounded-lg border border-zinc-200 bg-zinc-950 object-cover ${
          cameraActive && cameraEngine === "native" ? "block" : "hidden"
        }`}
      />
      <div
        id="lebanonpos-pos-camera-reader"
        className={`mt-3 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-950 ${
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
