import { useEffect, useRef, useState, type ChangeEvent, type RefObject } from "react"
import { AnimatePresence, motion } from "framer-motion"
const MotionDiv = motion.div as any
const MotionSpan = motion.span as any
const MotionButton = motion.button as any
const MotionP = motion.p as any
import {
  ArrowLeft,
  Camera,
  Eraser,
  HandCoins,
  Landmark,
  Minus,
  Plus,
  Scan,
  ShoppingCart,
  Trash2,
  WalletCards,
  Zap,
} from "lucide-react"
import LastSaleBanner from "./LastSaleBanner"
import { useI18n } from "@lebanonpos/shared"
import { formatCurrency, formatLbpCurrency, formatNumber, usdToLbp } from "../lib/currency"
import type { Product } from "../types/product"

type CartItem = Product & { quantity: number }
type PaymentMethod = "Cash" | "Card" | "Wallet" | "Debt"
type TenderMode    = "USD" | "LBP" | "Mixed"

type CustomerLedger = { id: string; name: string; mobile: string; balance: number }

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
  onExit: () => void
  itemCount: number
  total: number
  totalLbp: number
  exchangeRate: number
  paymentMethod: PaymentMethod
  onSelectPayment: (method: PaymentMethod) => void
  paidUsd: string
  paidLbp: string
  onPaidUsdChange: (v: string) => void
  onPaidLbpChange: (v: string) => void
  onFillExactTender: (currency: "USD" | "LBP") => void
  customers: CustomerLedger[]
  selectedCustomerId: string
  onSelectCustomer: (id: string) => void
  paidTotalUsd: number
  paidTotalLbp: number
  cashChangeUsd: number
  cashChangeLbp: number
  cashStillDueUsd: number
  cashTenderValid: boolean
  checkoutBlocked: boolean
  onCompleteSale: () => void
  recentSales: { number: string; total: number; totalLbp: number; items: CartItem[] }[]
  onPrintReceipt: (sale: any) => void
  onWhatsAppReceipt: (sale: any) => void
}

const PAY_OPTIONS: { label: PaymentMethod; icon: typeof Landmark; color: string; activeClass: string }[] = [
  { label: "Cash",   icon: Landmark,    color: "emerald", activeClass: "bg-emerald-600 border-emerald-600 text-white" },
  { label: "Wallet", icon: WalletCards, color: "violet",  activeClass: "bg-violet-600  border-violet-600  text-white" },
  { label: "Debt",   icon: HandCoins,   color: "amber",   activeClass: "bg-amber-500   border-amber-500   text-white" },
]

export default function QuickPOSMode({
  scanInputRef, scanCode, onScanCodeChange, onQuickAdd,
  scannerStatus, cameraActive, cameraEngine, onStartCamera,
  videoRef, scanCaptureInputRef, onScanCapture,
  items, onIncreaseQty, onDecreaseQty, onRemoveItem,
  onCleanSale, onExit,
  itemCount, total, totalLbp, exchangeRate,
  paymentMethod, onSelectPayment,
  paidUsd, paidLbp, onPaidUsdChange, onPaidLbpChange, onFillExactTender,
  customers, selectedCustomerId, onSelectCustomer,
  paidTotalUsd, paidTotalLbp, cashChangeUsd, cashChangeLbp, cashStillDueUsd,
  cashTenderValid, checkoutBlocked, onCompleteSale,
  recentSales, onPrintReceipt, onWhatsAppReceipt,
}: Props) {
  const { t, dir } = useI18n()
  const usdRef = useRef<HTMLInputElement>(null)
  const lbpRef = useRef<HTMLInputElement>(null)
  const reviewRef = useRef<HTMLElement>(null)
  const [showReview, setShowReview] = useState(false)
  const hasInput = scanCode.trim().length > 0

  function handleBarcodeKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return
    e.preventDefault()
    if (scanCode.trim()) {
      onQuickAdd(scanCode)
    } else if (items.length > 0) {
      usdRef.current?.focus()
    }
  }

  function handleCompleteSale() {
    setShowReview(false)
    onCompleteSale()
  }

  // Auto-focus review screen so Enter works
  useEffect(() => {
    if (showReview) setTimeout(() => reviewRef.current?.focus(), 50)
  }, [showReview])

  if (showReview) {
    const hasItems = items.length > 0
    return (
      <section ref={reviewRef} className="fixed inset-0 z-[200] flex flex-col items-center justify-center overflow-hidden p-4"
        style={{ background: "rgba(5,7,13,0.92)", backdropFilter: "blur(16px)" }}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.preventDefault(); setShowReview(false) }
          if (e.key === "Enter") { e.preventDefault(); handleCompleteSale() }
        }}
        tabIndex={0}>

        <div className="w-full max-w-md rounded-3xl overflow-hidden"
          style={{ background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>

          {/* Header */}
          <div className="px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold" style={{ color: "var(--text)" }}>Confirm Sale</h2>
              <span className="rounded-full px-2.5 py-1 text-[10px] font-bold" style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                {hasItems ? `${itemCount} item${itemCount > 1 ? "s" : ""}` : "Empty"}
              </span>
            </div>
          </div>

          {/* Items */}
          {hasItems && (
            <div className="max-h-[35vh] overflow-y-auto divide-y" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
              {items.map((item, i) => (
                <div key={item.id} className="flex items-center gap-3 px-5 py-2.5"
                  style={{ background: i % 2 === 0 ? "var(--surface)" : "var(--surface-2)" }}>
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold"
                    style={{ background: "var(--surface-3)", color: "var(--text-3)" }}>
                    {item.quantity}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-bold" style={{ color: "var(--text)" }}>
                    {item.name}
                  </span>
                  <span className="shrink-0 text-[12px] font-semibold tabular-nums" style={{ color: "var(--text-2)" }}>
                    @{formatCurrency(item.price)}
                  </span>
                  <span className="shrink-0 w-16 text-end text-[14px] font-bold tabular-nums" style={{ color: "var(--text)" }}>
                    {formatCurrency(item.price * item.quantity)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Totals */}
          <div className="px-5 py-4 space-y-2 border-t" style={{ borderColor: "var(--border)" }}>
            {/* THE number */}
            <div className="flex items-end justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-3)" }}>Total</span>
              <div className="text-end leading-none">
                <div className="text-[32px] font-bold tabular-nums" style={{ color: "var(--text)" }}>
                  {formatCurrency(total)}
                </div>
                <div className="text-[12px] font-semibold tabular-nums mt-0.5" style={{ color: "var(--text-3)" }}>
                  {formatLbpCurrency(totalLbp)}
                </div>
              </div>
            </div>

            {/* Payment info */}
            <div className="flex items-center justify-between pt-2 border-t" style={{ borderColor: "var(--border)" }}>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-semibold" style={{ color: "var(--text-3)" }}>
                  {t("pos.payment." + paymentMethod.toLowerCase())}
                </span>
              </div>
              {paymentMethod === "Cash" && (
                <span className="text-[11px] font-semibold tabular-nums" style={{ color: "var(--text-2)" }}>
                  USD {paidUsd || "0"} / LBP {paidLbp || "0"}
                </span>
              )}
            </div>

            {/* Change */}
            {cashTenderValid && cashChangeUsd > 0 && (
              <div className="rounded-2xl p-4 mt-2 text-center"
                style={{ background: "rgba(34,197,94,0.10)", border: "1.5px solid rgba(34,197,94,0.25)" }}>
                <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: "var(--success)" }}>{t("pos.change")}</span>
                <div className="text-[36px] font-bold tabular-nums leading-none mt-1" style={{ color: "var(--success)" }}>
                  {formatCurrency(cashChangeUsd)}
                </div>
                <div className="text-[14px] font-bold tabular-nums mt-0.5" style={{ color: "rgba(34,197,94,0.7)" }}>
                  {formatLbpCurrency(cashChangeLbp)}
                </div>
              </div>
            )}

            {/* Still due */}
            {!cashTenderValid && paymentMethod === "Cash" && (paidUsd || paidLbp) && (
              <div className="rounded-2xl p-4 mt-2 text-center"
                style={{ background: "rgba(239,68,68,0.10)", border: "1.5px solid rgba(239,68,68,0.25)" }}>
                <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: "var(--rose)" }}>{t("pos.remaining")}</span>
                <div className="text-[36px] font-bold tabular-nums leading-none mt-1" style={{ color: "var(--rose)" }}>
                  {formatCurrency(cashStillDueUsd)}
                </div>
                <div className="text-[14px] font-bold tabular-nums mt-0.5" style={{ color: "rgba(239,68,68,0.7)" }}>
                  {formatLbpCurrency(usdToLbp(cashStillDueUsd, exchangeRate))}
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="px-5 py-4 flex gap-3 border-t" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
            <button type="button" onClick={() => setShowReview(false)}
              className="flex-1 h-12 rounded-xl text-[13px] font-bold transition active:scale-[0.98]"
              style={{ border: "1px solid var(--border)", color: "var(--text-2)", background: "var(--surface)" }}>
              Esc
            </button>
            <button type="button" onClick={handleCompleteSale}
              className="flex-[2.5] h-12 rounded-xl text-[15px] font-bold text-white transition active:scale-[0.98]"
              style={{ background: "var(--brand)" }}>
              Enter — Pay {formatCurrency(total)}
            </button>
          </div>
        </div>

        <p className="mt-3 text-[10px] font-medium opacity-40" style={{ color: "var(--text-3)" }}>
          Esc to edit · Enter to confirm
        </p>
      </section>
    )
  }

  return (
    <section className="bg-page fixed inset-0 z-[200] flex flex-col overflow-hidden"
      onKeyDown={(e) => { if (e.key === "Escape" && showReview) setShowReview(false) }}>
      {/* ── Header ─────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-3 border-b px-4 py-2.5"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <button type="button" onClick={onExit}
          className="flex h-8 w-8 items-center justify-center rounded-lg border transition hover:opacity-70"
          style={{ borderColor: "var(--border)", color: "var(--text-3)" }}>
          <ArrowLeft size={15} />
        </button>
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: "var(--brand)", color: "#fff" }}>
            <Zap size={14} />
          </span>
          <span className="text-[14px] font-bold" style={{ color: "var(--text)" }}>
            Quick POS
            <span className="ms-2 text-[10px] font-semibold opacity-50" style={{ color: "var(--text-3)" }}>Enter = pay</span>
          </span>
        </div>
        <div className="ms-auto flex items-center gap-2">
          <MotionButton type="button" onClick={onStartCamera}
            className="flex h-8 w-8 items-center justify-center rounded-lg border transition"
            style={cameraActive
              ? { background: "rgba(239,68,68,0.10)", borderColor: "rgba(239,68,68,0.28)", color: "var(--rose)" }
              : { background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text-3)" }}
            whileTap={{ scale: 0.88 }}>
            <Camera size={14} />
          </MotionButton>
          <MotionButton type="button" onClick={onCleanSale} disabled={items.length === 0}
            className="flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-bold transition disabled:opacity-30"
            style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text-3)" }}
            whileTap={{ scale: 0.92 }}>
            <Eraser size={13} /> Clear
          </MotionButton>
        </div>
      </div>

      {/* Last sale banner */}
      <LastSaleBanner
        sales={recentSales}
        onNewSale={onCleanSale}
        onPrintReceipt={onPrintReceipt}
        onWhatsApp={onWhatsAppReceipt}
      />

      {/* ── Scan bar ───────────────────────────────────── */}
      <div className="shrink-0 border-b px-4 py-3" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
        <div className="flex items-center overflow-hidden rounded-2xl transition-all duration-200"
          style={{
            background: "var(--surface)",
            border: "1.5px solid",
            borderColor: hasInput ? "var(--brand)" : "var(--border)",
            boxShadow: hasInput ? "0 0 0 3px var(--brand-soft)" : undefined,
          }}>
          <div className="flex shrink-0 items-center justify-center" style={{ width: 52, color: hasInput ? "var(--brand)" : "var(--text-3)", transition: "color 0.2s" }}>
            <Scan size={19} strokeWidth={2} />
          </div>
          <input ref={scanInputRef} autoFocus value={scanCode}
            onChange={(e) => onScanCodeChange(e.target.value)}
            onKeyDown={handleBarcodeKey}
            placeholder="Scan barcode… Enter to pay"
            className="min-w-0 flex-1 bg-transparent py-3.5 text-[17px] font-bold outline-none placeholder:font-medium placeholder:text-[15px]"
            style={{ color: "var(--text)", caretColor: "var(--brand)" }} dir={dir} />
          <AnimatePresence>
            {hasInput && (
              <MotionButton type="button" onClick={() => onScanCodeChange("")}
                className="me-3 flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold"
                style={{ background: "var(--surface-2)", color: "var(--text-3)" }}
                initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.6 }} transition={{ duration: 0.12 }}
                whileTap={{ scale: 0.82 }}>✕</MotionButton>
            )}
          </AnimatePresence>
        </div>

        <div className="mt-2 flex items-center gap-2 px-1">
          <MotionSpan className="h-[6px] w-[6px] shrink-0 rounded-full"
            style={{ background: cameraActive ? "var(--rose)" : "var(--brand)" }}
            animate={cameraActive ? { scale: [1, 1.6, 1], opacity: [1, 0.3, 1] } : {}}
            transition={cameraActive ? { duration: 1, repeat: Infinity } : {}} />
          <span className="min-w-0 flex-1 truncate text-[11px] font-semibold" style={{ color: "var(--text-3)" }}>{scannerStatus}</span>
          <span className="shrink-0 text-[11px] font-bold tabular-nums" style={{ color: "var(--text-3)" }}>{formatNumber(itemCount)} items</span>
        </div>

        <AnimatePresence>
          {cameraActive && (
            <MotionDiv initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }} className="mt-3 overflow-hidden">
              <div className="relative overflow-hidden rounded-xl" style={{ border: "1.5px solid var(--brand)", boxShadow: "0 0 0 3px var(--brand-soft)" }}>
                <MotionDiv className="pointer-events-none absolute inset-x-6 h-[2px] rounded-full"
                  style={{ background: "linear-gradient(90deg,transparent,var(--brand),transparent)", zIndex: 10 }}
                  animate={{ top: ["15%", "85%", "15%"] }} transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }} />
                <video ref={videoRef} muted playsInline className={`aspect-video w-full bg-zinc-950 object-cover ${cameraEngine === "native" ? "block" : "hidden"}`} />
                <div id="lebanonpos-pos-camera-reader" className={`overflow-hidden bg-zinc-950 ${cameraEngine === "html5" ? "block" : "hidden"}`} />
              </div>
            </MotionDiv>
          )}
        </AnimatePresence>

        <input ref={scanCaptureInputRef} type="file" accept="image/*" capture="environment" onChange={onScanCapture} className="hidden" />
      </div>

      {/* ── Body ───────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* Items list */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <AnimatePresence initial={false}>
              {items.length === 0 ? (
                <MotionDiv key="empty" className="flex h-full min-h-[160px] flex-col items-center justify-center gap-3"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-dashed" style={{ borderColor: "var(--border)" }}>
                    <ShoppingCart size={28} style={{ color: "var(--text-3)" }} />
                  </div>
                  <div className="text-center">
                    <p className="text-[13px] font-bold" style={{ color: "var(--text-2)" }}>Cart is empty</p>
                    <p className="text-[11px]" style={{ color: "var(--text-3)" }}>Scan a barcode to start</p>
                  </div>
                </MotionDiv>
              ) : (
                <div className="space-y-1.5">
                  {items.map((item, i) => (
                    <MotionDiv key={item.id} layout
                      initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 16, height: 0, marginBottom: 0 }}
                      transition={{ duration: 0.18, delay: i * 0.02 }}
                      className="flex items-center gap-2 rounded-xl px-3 py-2.5"
                      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                      <p className="min-w-0 flex-1 truncate text-[13px] font-bold" style={{ color: "var(--text)" }}>{item.name}</p>
                      <div className="flex items-center gap-1 shrink-0">
                        <button type="button" onClick={() => onDecreaseQty(item.id)}
                          className="flex h-6 w-6 items-center justify-center rounded-md"
                          style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                          <Minus size={11} />
                        </button>
                        <span className="w-7 text-center text-[13px] font-bold tabular-nums" style={{ color: "var(--text)" }}>{item.quantity}</span>
                        <button type="button" onClick={() => onIncreaseQty(item.id)}
                          className="flex h-6 w-6 items-center justify-center rounded-md"
                          style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                          <Plus size={11} />
                        </button>
                      </div>
                      <span className="w-16 shrink-0 text-end text-[13px] font-bold tabular-nums" style={{ color: "var(--text)" }}>
                        {formatCurrency(item.price * item.quantity)}
                      </span>
                      <button type="button" onClick={() => onRemoveItem(item.id)}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition hover:opacity-70"
                        style={{ color: "var(--text-3)" }}>
                        <Trash2 size={13} />
                      </button>
                    </MotionDiv>
                  ))}
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* ── Payment rail ────────────────────────────── */}
        <div className="flex w-[300px] shrink-0 flex-col overflow-y-auto border-l"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}>

          {/* Total */}
          <div className="border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
            <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-3)" }}>Total</p>
            <MotionP key={total} className="text-[36px] font-bold tabular-nums leading-none mt-0.5" style={{ color: "var(--text)" }}
              initial={{ scale: 1.06, color: "var(--brand)" }} animate={{ scale: 1, color: "var(--text)" }} transition={{ duration: 0.22 }}>
              {formatCurrency(total)}
            </MotionP>
            <p className="mt-1 text-[12px] font-semibold tabular-nums" style={{ color: "var(--text-3)" }}>{formatLbpCurrency(totalLbp)}</p>
          </div>

          {/* Payment method */}
          <div className="border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
            <div className="grid grid-cols-3 gap-1.5">
              {PAY_OPTIONS.map(({ label, icon: Icon, activeClass }) => (
                <MotionButton key={label} type="button" onClick={() => onSelectPayment(label)}
                  className={`flex items-center justify-center gap-1 rounded-lg border py-2 text-[11px] font-bold transition ${
                    paymentMethod === label ? activeClass : "border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-2)]"
                  }`}
                  whileTap={{ scale: 0.94 }}>
                  <Icon size={14} />
                  {t("pos.payment." + label.toLowerCase())}
                </MotionButton>
              ))}
            </div>
          </div>

          {/* Cash tender */}
          {paymentMethod === "Cash" && (
            <div className="border-b px-4 py-4 space-y-3" style={{ borderColor: "var(--border)" }}>

              {/* USD input */}
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-3)" }}>USD Paid</p>
                <div className="flex gap-2">
                  <input ref={usdRef} type="number" inputMode="decimal" value={paidUsd}
                      onChange={(e) => onPaidUsdChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); lbpRef.current?.focus() }
                      }}
                      placeholder="0.00" min="0" step="0.01"
                      className="input min-w-0 flex-1 text-[22px] font-bold tabular-nums"
                      style={{ height: 56 }} />
                    <MotionButton type="button" onClick={() => onFillExactTender("USD")}
                      className="shrink-0 rounded-xl border px-4 text-[12px] font-bold transition"
                      style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text-2)", height: 56 }}
                      whileTap={{ scale: 0.92 }}>
                      Exact
                    </MotionButton>
                </div>
              </div>

              {/* LBP input */}
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-3)" }}>LBP Paid</p>
                <div className="flex gap-2">
                  <input ref={lbpRef} type="number" inputMode="decimal" value={paidLbp}
                      onChange={(e) => onPaidLbpChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); setShowReview(true) }
                      }}
                      placeholder="0" min="0" step="1000"
                      className="input min-w-0 flex-1 text-[22px] font-bold tabular-nums"
                      style={{ height: 56 }} />
                    <MotionButton type="button" onClick={() => onFillExactTender("LBP")}
                      className="shrink-0 rounded-xl border px-4 text-[12px] font-bold transition"
                      style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text-2)", height: 56 }}
                      whileTap={{ scale: 0.92 }}>
                      Exact
                    </MotionButton>
                </div>
              </div>

              {/* Change / remaining */}
              {cashTenderValid && paidTotalUsd > 0 && (
                <MotionDiv
                  className="rounded-2xl p-4"
                  style={{
                    background: cashChangeUsd > 0 ? "rgba(16,185,129,0.12)" : "rgba(244,63,94,0.10)",
                    border: `1.5px solid ${cashChangeUsd > 0 ? "rgba(16,185,129,0.30)" : "rgba(244,63,94,0.25)"}`,
                  }}
                  initial={{ scale: 0.95, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 400, damping: 22 }}
                >
                  <p className="text-[11px] font-bold uppercase tracking-wide text-white">
                    {cashChangeUsd > 0 ? t("pos.change") : t("pos.remaining")}
                  </p>
                  <MotionP
                    key={cashChangeUsd > 0 ? cashChangeUsd : cashStillDueUsd}
                    className="mt-1 font-bold tabular-nums leading-none"
                    style={{ fontSize: 44, color: "#fff" }}
                    initial={{ scale: 1.1 }} animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 500, damping: 24 }}
                  >
                    {cashChangeUsd > 0 ? formatCurrency(cashChangeUsd) : formatCurrency(cashStillDueUsd)}
                  </MotionP>
                  <p className="mt-1 text-[12px] font-semibold tabular-nums" style={{ color: "var(--text-3)" }}>
                    {cashChangeUsd > 0
                      ? formatLbpCurrency(cashChangeLbp)
                      : formatLbpCurrency(usdToLbp(cashStillDueUsd, exchangeRate))}
                  </p>
                </MotionDiv>
              )}
            </div>
          )}

          {/* Debt customer */}
          {paymentMethod === "Debt" && customers.length > 0 && (
            <div className="border-b px-4 py-4" style={{ borderColor: "var(--border)" }}>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-3)" }}>Customer</p>
              <select value={selectedCustomerId} onChange={(e) => onSelectCustomer(e.target.value)}
                className="input w-full text-[14px] font-bold" style={{ height: 52 }}>
                <option value="">— Select customer —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Complete sale */}
          <div className="mt-auto p-4">
            <MotionButton type="button" onClick={() => setShowReview(true)}
              disabled={items.length === 0 || checkoutBlocked}
              className="h-16 w-full rounded-2xl text-[16px] font-bold text-white transition disabled:opacity-30"
              style={{ background: "var(--brand)", boxShadow: "0 4px 16px var(--brand-soft)" }}
              whileTap={{ scale: 0.96 }}>
              {t("pos.complete_sale")}
              <span className="ms-2 opacity-80 text-[14px]">— {formatCurrency(total)}</span>
            </MotionButton>
          </div>
        </div>
      </div>
    </section>
  )
}
