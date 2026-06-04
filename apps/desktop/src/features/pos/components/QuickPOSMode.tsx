import type { ChangeEvent, RefObject } from "react"
import {
  ArrowLeft,
  Camera,
  Eraser,
  ScanBarcode,
  ShoppingCart,
  Zap,
} from "lucide-react"

import { useI18n } from "@lebanonpos/shared"
import CartItemCard from "./CartItemCard"
import {
  formatCurrency,
  formatLbpCurrency,
  formatNumber,
} from "../lib/currency"
import type { Product } from "../types/product"

type CartItem = Product & { quantity: number }

type Props = {
  scanInputRef: RefObject<HTMLInputElement | null>
  scanCode: string
  onScanCodeChange: (value: string) => void
  onQuickAdd: (value: string) => void
  scannerStatus: string
  cameraActive: boolean
  cameraEngine: "native" | "html5" | null
  onStartCamera: () => void
  videoRef: RefObject<HTMLVideoElement | null>
  scanCaptureInputRef: RefObject<HTMLInputElement | null>
  onScanCapture: (event: ChangeEvent<HTMLInputElement>) => void
  items: CartItem[]
  onIncreaseQty: (id: number) => void
  onDecreaseQty: (id: number) => void
  onRemoveItem: (id: number) => void
  onSetQuantity: (id: number, qty: number) => void
  onSetPrice: (id: number, price: number) => void
  onCleanSale: () => void
  onCartOpen: () => void
  onExit: () => void
  itemCount: number
  total: number
  totalLbp: number
  exchangeRate: number
}

export default function QuickPOSMode({
  scanInputRef,
  scanCode,
  onScanCodeChange,
  onQuickAdd,
  scannerStatus,
  cameraActive,
  cameraEngine,
  onStartCamera,
  videoRef,
  scanCaptureInputRef,
  onScanCapture,
  items,
  onIncreaseQty,
  onDecreaseQty,
  onRemoveItem,
  onSetQuantity,
  onSetPrice,
  onCleanSale,
  onCartOpen,
  onExit,
  itemCount,
  total,
  totalLbp,
  exchangeRate,
}: Props) {
  const { t, dir } = useI18n()

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="pos-quick-shell p-4 sm:p-5">
        <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-3">
            <div
              className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-600 text-white"
            >
              <Zap size={21} />
            </div>
            <div>
              <h2 className="text-[24px] font-black tracking-tight" style={{ color: "var(--text)" }}>
                Full Screen POS
              </h2>
              <p className="text-[13px] font-semibold" style={{ color: "var(--text-3)" }}>
                Register lane
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span
              className="rounded-lg px-3 py-2 text-[12px] font-black"
              style={{ background: "var(--brand-soft)", color: "var(--brand-text)", border: "1px solid var(--brand-border)" }}
            >
              1 USD = {formatLbpCurrency(exchangeRate)}
            </span>
            <button
              type="button"
              onClick={onExit}
              className="flex h-10 items-center justify-center gap-2 rounded-lg border px-4 text-[13px] font-black transition"
              style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--text-2)" }}
            >
              <ArrowLeft size={16} />
              Full POS
            </button>
          </div>
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
          <label className="relative min-w-0">
            <span className="mb-2 block text-[12px] font-black uppercase tracking-[0.12em]" style={{ color: "var(--text-2)" }}>
              Scan barcode
            </span>
            <ScanBarcode
              size={24}
              className="pointer-events-none absolute bottom-4"
              style={{ color: "#059669", [dir === "rtl" ? "right" : "left"]: "16px" }}
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
              placeholder="Scan barcode and press Enter"
              className={`input h-16 rounded-lg text-[21px] font-black ${dir === "rtl" ? "pr-14 pl-4" : "pl-14 pr-4"}`}
            />
          </label>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:flex">
            <button
              type="button"
              onClick={() => onQuickAdd(scanCode)}
              className="pos-command-button pos-command-primary h-14"
            >
              <ScanBarcode size={19} />
              Add
            </button>
            <button
              type="button"
              onClick={onStartCamera}
              className="pos-command-button h-14"
            >
              <Camera size={19} />
              {cameraActive ? "Stop" : "Scan"}
            </button>
            <button
              type="button"
              onClick={onCleanSale}
              className="pos-command-button h-14"
            >
              <Eraser size={19} />
              Clear
            </button>
            <button
              type="button"
              onClick={onCartOpen}
              className="pos-command-button pos-command-primary h-14"
            >
              <ShoppingCart size={19} />
              Pay
            </button>
          </div>
        </div>

        <div className="mt-3 grid gap-2 text-[13px] font-bold md:grid-cols-[minmax(0,1fr)_repeat(3,auto)]">
          <p className="truncate rounded-lg border px-3 py-2" style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text-2)" }}>
            {scannerStatus}
          </p>
          <span className="rounded-lg border px-3 py-2" style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text-2)" }}>
            {formatNumber(itemCount)} items
          </span>
          <span className="rounded-lg border px-3 py-2" style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}>
            {formatCurrency(total)}
          </span>
          <span className="rounded-lg border px-3 py-2" style={{ background: "var(--brand-soft)", borderColor: "var(--brand-border)", color: "var(--brand-text)" }}>
            {formatLbpCurrency(totalLbp)}
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

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div
          className="min-h-0 overflow-hidden rounded-xl border"
          style={{ background: "var(--surface)", borderColor: "var(--border)", boxShadow: "var(--shadow-sm)" }}
        >
          <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
            <div>
              <p className="text-[15px] font-black" style={{ color: "var(--text)" }}>
                Cart Items
              </p>
              <p className="text-[12px]" style={{ color: "var(--text-3)" }}>
                Current barcode sale
              </p>
            </div>
            <span className="rounded-full px-3 py-1 text-[12px] font-black" style={{ background: "var(--brand-soft)", color: "var(--brand-text)" }}>
              {formatNumber(itemCount)}
            </span>
          </div>

          <div className="max-h-[calc(100vh-360px)] min-h-72 overflow-y-auto p-3">
            {items.length > 0 ? (
              <div className="space-y-2">
                {items.map((item) => (
                  <CartItemCard
                    key={item.id}
                    name={item.name}
                    quantity={item.quantity}
                    unitPrice={item.price}
                    totalPrice={item.price * item.quantity}
                    onIncrease={() => onIncreaseQty(item.id)}
                    onDecrease={() => onDecreaseQty(item.id)}
                    onRemove={() => onRemoveItem(item.id)}
                    onSetQuantity={(qty) => onSetQuantity(item.id, qty)}
                    onSetPrice={(price) => onSetPrice(item.id, price)}
                  />
                ))}
              </div>
            ) : (
              <div className="flex h-72 flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
                <ShoppingCart size={42} style={{ color: "var(--text-3)" }} />
                <div className="text-center">
                  <p className="text-[15px] font-black" style={{ color: "var(--text-2)" }}>
                    Cart is ready
                  </p>
                  <p className="text-[13px]" style={{ color: "var(--text-3)" }}>
                    Waiting for items
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border p-4" style={{ background: "var(--surface)", borderColor: "var(--border)", boxShadow: "var(--shadow-sm)" }}>
          <p className="text-[12px] font-black uppercase tracking-[0.12em]" style={{ color: "var(--text-3)" }}>
            Sale Summary
          </p>
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-bold" style={{ color: "var(--text-3)" }}>Items</span>
              <span className="text-[16px] font-black" style={{ color: "var(--text)" }}>{formatNumber(itemCount)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-bold" style={{ color: "var(--text-3)" }}>Total USD</span>
              <span className="text-[24px] font-black tabular-nums" style={{ color: "var(--text)" }}>{formatCurrency(total)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-bold" style={{ color: "var(--text-3)" }}>Total LBP</span>
              <span className="text-[14px] font-black tabular-nums" style={{ color: "var(--brand-text)" }}>{formatLbpCurrency(totalLbp)}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onCartOpen}
            disabled={items.length === 0}
            className="mt-5 h-14 w-full rounded-xl text-[16px] font-black text-white transition disabled:opacity-40"
            style={{ background: "var(--brand)" }}
          >
            Pay / Complete Sale
          </button>
          <button
            type="button"
            onClick={onCleanSale}
            disabled={items.length === 0}
            className="mt-2 h-10 w-full rounded-lg border text-[13px] font-black transition disabled:opacity-40"
            style={{ borderColor: "var(--border)", color: "var(--text-2)", background: "var(--surface-2)" }}
          >
            Clear Sale
          </button>
        </div>
      </div>
    </section>
  )
}
