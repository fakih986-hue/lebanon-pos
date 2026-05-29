import type { ChangeEvent, RefObject } from "react"
import { useI18n } from "@lebanonpos/shared"
import {
  Eraser,
  ScanBarcode,
  Search,
  ShoppingCart,
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
}: Props) {
  const { t, dir } = useI18n()

  return (
    <div className="rounded-xl border p-3" style={{ background: "var(--surface)", borderColor: "var(--border)", boxShadow: "var(--shadow-sm)" }}>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
        <label className="relative min-w-0">
          <span className="mb-2 block text-[13px] font-bold" style={{ color: "var(--text-2)" }}>
            {t("pos.quick_add")}
          </span>
          <Search
            size={20}
            className={`pointer-events-none absolute bottom-4`}
            style={{ color: "var(--text-3)", [dir === "rtl" ? "right" : "left"]: "14px" }}
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
            className={`input h-14 text-[17px] font-semibold ${dir === "rtl" ? "pr-12 pl-4" : "pl-12 pr-4"}`}
          />
        </label>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:flex">
          <button
            type="button"
            onClick={() => onQuickAdd(scanCode)}
            className="flex h-12 touch-manipulation items-center justify-center gap-2 rounded-xl px-4 text-[15px] font-bold text-white transition sm:h-14 sm:px-5"
            style={{ background: "var(--text)" }}
          >
            <ScanBarcode size={19} />
            {t("pos.add")}
          </button>
          <button
            type="button"
            onClick={onCartOpen}
            className="relative flex h-12 touch-manipulation items-center justify-center gap-2 rounded-xl px-4 text-[15px] font-bold text-white transition sm:h-14 sm:px-5"
            style={{ background: "var(--brand)" }}
          >
            <ShoppingCart size={19} />
            {t("pos.cart")}
            {itemCount > 0 && (
              <span className="ml-1 rounded-full px-1.5 py-0.5 text-[11px] font-black" style={{ background: "rgba(255,255,255,0.25)" }}>
                {itemCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={onStartCamera}
            className="flex h-12 touch-manipulation items-center justify-center gap-2 rounded-xl border px-4 text-[15px] font-bold transition sm:h-14"
            style={cameraActive
              ? { borderColor: "var(--rose)", background: "var(--rose-soft)", color: "var(--rose)" }
              : { borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--text-2)" }
            }
          >
            <ScanBarcode size={19} />
            {cameraActive ? t("pos.stop") : t("pos.scan")}
          </button>
          <button
            type="button"
            onClick={onCleanSale}
            className="flex h-12 touch-manipulation items-center justify-center gap-2 rounded-xl border px-4 text-[15px] font-bold transition sm:h-14"
            style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--text-2)" }}
          >
            <Eraser size={19} />
            {t("pos.clean")}
          </button>
        </div>
      </div>

      <div className="mt-3 grid gap-2 text-sm font-bold md:grid-cols-[minmax(0,1fr)_repeat(3,auto)]">
        <p className="rounded-lg px-3 py-2 text-[13px] font-medium truncate" style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
          {scannerStatus}
        </p>
        <span className="rounded-lg px-3 py-2 text-[13px] font-semibold" style={{ background: "var(--surface-2)", color: "var(--text-2)" }}>
          {t("pos.items_shown", { n: formatNumber(filteredProductsCount) })}
        </span>
        <span className="rounded-lg px-3 py-2 text-[13px] font-semibold" style={{ background: "var(--surface-2)", color: "var(--text-2)" }}>
          {t("pos.cart_count", { n: formatNumber(itemCount) })}
        </span>
        <span className="rounded-lg px-3 py-2 text-[13px] font-semibold" style={{ background: "var(--brand-soft)", color: "var(--brand-text)" }}>
          {t("pos.exchange_rate", { rate: formatLbpCurrency(exchangeRate) })}
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
