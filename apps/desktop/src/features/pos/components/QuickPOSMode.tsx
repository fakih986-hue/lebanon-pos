import { useEffect, useRef, useState, type ChangeEvent, type RefObject } from "react"
import { AnimatePresence, motion } from "framer-motion"
const MotionDiv = motion.div as any
const MotionSpan = motion.span as any
const MotionButton = motion.button as any
import {
  ArrowLeft,
  BadgePercent,
  Camera,
  ChevronDown,
  Eraser,
  MessageSquare,
  Minus,
  Plus,
  Scan,
  ShoppingCart,
  Trash2,
  Zap,
} from "lucide-react"
import LastSaleBanner from "./LastSaleBanner"
import TenderPanel from "../components/TenderPanel"
import MoneyDue from "./MoneyDue"
import PaymentReviewDialog from "./PaymentReviewDialog"
import { useI18n } from "@lebanonpos/shared"
import { formatCurrency, formatNumber } from "../lib/currency"
import type { Product } from "../types/product"

type CartItem = Product & { quantity: number }
type PaymentMethod = "Cash" | "Card" | "Wallet" | "Debt"
type CustomerLedger = { id: string; name: string; mobile: string; balance: number }

type DiscountMode = "USD" | "Percent"

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
  onCleanSale: () => void
  onExit: () => void
  itemCount: number
  total: number
  totalLbp: number
  payableLbp?: number
  payableUsd?: number
  /** sales.price_override — gates sell-at-cost (it was shown to everyone). */
  canOverridePrice?: boolean
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
  selectedCustomer?: CustomerLedger
  creditLimitExceeded?: boolean
  paidTotalUsd: number
  paidTotalLbp: number
  cashChangeUsd: number
  cashChangeLbp: number
  cashStillDueUsd: number
  cashTenderValid: boolean
  checkoutBlocked: boolean
  onCompleteSale: () => void
  recentSales: { number: string; total: number; totalLbp: number; items: any[] }[]
  onPrintReceipt: (sale: any) => void
  onWhatsAppReceipt: (sale: any) => void
  sellAtCost: boolean
  onToggleSellAtCost: () => void
  saleNote: string
  onSaleNoteChange: (value: string) => void
  discountMode: DiscountMode
  discountValue: string
  onDiscountModeChange: (mode: DiscountMode) => void
  onDiscountValueChange: (value: string) => void
  hasDiscount: boolean
  canApplyDiscount: boolean
  discountTotal: number
  grossSubtotal: number
}

export default function QuickPOSMode({
  scanInputRef, scanCode, onScanCodeChange, onQuickAdd,
  scannerStatus, cameraActive, cameraEngine, onStartCamera,
  videoRef, scanCaptureInputRef, onScanCapture,
  items, onIncreaseQty, onDecreaseQty, onRemoveItem,
  onCleanSale, onExit,
  itemCount, total, totalLbp, exchangeRate,
  paymentMethod, onSelectPayment,
  paidUsd, paidLbp, onPaidUsdChange, onPaidLbpChange, onFillExactTender,
  customers, selectedCustomerId, onSelectCustomer, selectedCustomer, creditLimitExceeded,
  paidTotalUsd, paidTotalLbp, cashChangeUsd, cashChangeLbp, cashStillDueUsd,
  cashTenderValid, checkoutBlocked, onCompleteSale,
  recentSales, onPrintReceipt, onWhatsAppReceipt,
  sellAtCost, onToggleSellAtCost,
  saleNote, onSaleNoteChange,
  discountMode, discountValue, onDiscountModeChange, onDiscountValueChange,
  hasDiscount, canApplyDiscount, discountTotal, grossSubtotal,
  payableLbp = totalLbp, payableUsd = total, canOverridePrice = false,
}: Props) {
  const { t, dir } = useI18n()
  const usdRef = useRef<HTMLInputElement>(null)
  const lbpRef = useRef<HTMLInputElement>(null)
  const reviewRef = useRef<HTMLElement>(null)
  const [showReview, setShowReview] = useState(false)
  const [discountOpen, setDiscountOpen] = useState(false)
  const [saleNoteOpen, setSaleNoteOpen] = useState(false)
  const hasInput = scanCode.trim().length > 0

  function handleBarcodeKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape" && scanCode) { e.preventDefault(); onScanCodeChange(""); return }
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
    return (
      <PaymentReviewDialog
        lines={items.length}
        units={itemCount}
        total={total}
        totalLbp={totalLbp}
        payableLbp={payableLbp}
        payableUsd={payableUsd}
        paymentMethod={paymentMethod}
        paidUsd={parseFloat(paidUsd) || 0}
        paidLbp={parseFloat(paidLbp) || 0}
        changeUsd={cashChangeUsd}
        changeLbp={cashChangeLbp}
        stillDueUsd={paymentMethod === "Cash" ? cashStillDueUsd : 0}
        blockedReason={!checkoutBlocked ? null
          : items.length === 0 ? t("pos.v2.blocked_empty")
          : paymentMethod === "Cash" && !cashTenderValid ? t("pos.v2.blocked_cash", { amount: formatCurrency(cashStillDueUsd) })
          : paymentMethod === "Debt" && !selectedCustomer ? t("pos.select_customer_hint")
          : creditLimitExceeded ? t("pos.credit_exceeded") : t("pos.v2.blocked_other")}
        customerName={selectedCustomer?.name}
        onBack={() => setShowReview(false)}
        onConfirm={handleCompleteSale}
      />
    )
  }

  // NOTE: never add .pos-quick-shell to this root — its position:relative
  // overrides Tailwind's `fixed` (index.css loads after utilities) and breaks
  // the fullscreen worker mode.
  return (
    <section className="mg2 bg-page fixed inset-0 z-[200] flex flex-col overflow-y-auto lg:overflow-hidden"
      onKeyDown={(e) => { if (e.key === "Escape" && showReview) setShowReview(false) }}>
      {/* ── Header ─────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2.5 sm:gap-3 sm:px-4"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <button type="button" onClick={onExit} className="mg2-btn mg2-btn-ghost" aria-label={t("pos.v2.exit_simple")}>
          <ArrowLeft size={18} className="mg2-dir" /><span className="hidden sm:inline">{t("pos.v2.full_register")}</span>
        </button>
        <span className="inline-flex min-w-0 items-center gap-2 whitespace-nowrap rounded-full px-3 text-[14px] font-semibold" style={{ minHeight: 32, background: "var(--surface-3)", color: "var(--text-2)" }}>
          <Zap size={14} className="shrink-0" /><span className="truncate">{t("pos.v2.simple_mode")}</span>
        </span>
        <div className="ms-auto flex shrink-0 items-center gap-2">
          <button type="button" onClick={onStartCamera} className="mg2-btn" style={{ width: 48, padding: 0, ...(cameraActive ? { background: "var(--v2-err-soft)", color: "var(--v2-err)" } : {}) }}
            aria-label={cameraActive ? t("pos.stop") : t("pos.scan")} aria-pressed={cameraActive}>
            <Camera size={18} />
          </button>
          <button type="button" onClick={onCleanSale} disabled={items.length === 0} className="mg2-btn mg2-btn-ghost"
            aria-label={t("pos.clean")} title={t("pos.clean")}>
            <Eraser size={16} /><span className="hidden sm:inline">{t("pos.clean")}</span>
          </button>
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
            borderColor: "var(--brand-border)",
            borderRadius: 16,
          }}>
          <div className="flex shrink-0 items-center justify-center" style={{ width: 60, color: "var(--text-2)" }}>
            <Scan size={26} strokeWidth={2} />
          </div>
          <input ref={scanInputRef} autoFocus value={scanCode} data-keep-focus="true"
            onChange={(e) => onScanCodeChange(e.target.value)}
            onKeyDown={handleBarcodeKey}
            placeholder={t("pos.v2.scan_next_item")}
            aria-label={t("pos.v2.scan_next_item")}
            className="min-w-0 flex-1 bg-transparent py-5 text-[20px] font-semibold outline-none placeholder:font-medium"
            style={{ color: "var(--text)", caretColor: "var(--brand)" }} dir={dir} />
          <AnimatePresence>
            {hasInput && (
              <MotionButton type="button" onClick={() => onScanCodeChange("")}
                className="mr-3 flex h-7 w-7 items-center justify-center rounded-lg text-xs font-black"
                style={{ background: "var(--surface-2)", color: "var(--text-3)" }}
                initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.6 }} transition={{ duration: 0.12 }}
                whileTap={{ scale: 0.82 }}>✕</MotionButton>
            )}
          </AnimatePresence>
        </div>

        <div className="mt-2 flex items-center gap-2 px-1">
          <MotionSpan className="h-[6px] w-[6px] shrink-0 rounded-full"
            style={{ background: cameraActive ? "#ef4444" : "var(--brand)" }}
            animate={cameraActive ? { scale: [1, 1.6, 1], opacity: [1, 0.3, 1] } : {}}
            transition={cameraActive ? { duration: 1, repeat: Infinity } : {}} />
          <span className="mg2-cap min-w-0 flex-1 truncate" role="status">{scannerStatus}</span>
          <span className="mg2-cap shrink-0 num">{t("pos.v2.lines_units", { lines: formatNumber(items.length), units: formatNumber(itemCount) })}</span>
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
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row lg:overflow-hidden">

        {/* Items list */}
        <div className="flex min-w-0 flex-1 flex-col lg:overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <AnimatePresence initial={false}>
              {items.length === 0 ? (
                <MotionDiv key="empty" className="flex h-full min-h-[160px] flex-col items-center justify-center gap-3"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-dashed" style={{ borderColor: "var(--border)" }}>
                    <ShoppingCart size={28} style={{ color: "var(--text-3)" }} />
                  </div>
                  <div className="text-center">
                    <p className="mg2-sub" style={{ margin: 0, color: "var(--text)" }}>{t("pos.cart_empty")}</p>
                    <p className="mg2-cap" style={{ margin: 0 }}>{t("pos.v2.scan_to_start")}</p>
                  </div>
                </MotionDiv>
              ) : (
                <div className="space-y-1.5">
                  {items.map((item, i) => (
                    <MotionDiv key={item.id} layout
                      initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 16, height: 0, marginBottom: 0 }}
                      transition={{ duration: 0.18, delay: i * 0.02 }}
                      className="flex flex-wrap items-center gap-3 rounded-xl px-4 py-3 sm:flex-nowrap"
                      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                      <div className="min-w-0 flex-1 basis-full sm:basis-auto"><p className="break-words text-[16px] font-semibold leading-snug" style={{ margin: 0, color: "var(--text)" }}>{item.name}</p><p className="num" style={{ margin: 0, color: "var(--text-2)" }}>{item.quantity} × {formatCurrency(item.price)}</p></div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button type="button" onClick={() => onDecreaseQty(item.id)}
                          aria-label={`Decrease ${item.name}`}
                          className="flex h-12 w-12 items-center justify-center rounded-lg transition active:scale-90"
                          style={{ background: "var(--surface-2)", color: "var(--text-2)" }}>
                          <Minus size={14} />
                        </button>
                        <span className="w-8 text-center text-[16px] font-semibold tabular-nums" style={{ color: "var(--text)" }}>{item.quantity}</span>
                        <button type="button" onClick={() => onIncreaseQty(item.id)}
                          aria-label={`Increase ${item.name}`}
                          className="flex h-12 w-12 items-center justify-center rounded-lg transition active:scale-90"
                          style={{ background: "var(--surface-2)", color: "var(--text-2)" }}>
                          <Plus size={14} />
                        </button>
                      </div>
                      <span className="w-20 shrink-0 text-end text-[16px] font-semibold tabular-nums ms-auto sm:ms-0" style={{ color: "var(--text)" }}>
                        {formatCurrency(item.price * item.quantity)}
                      </span>
                      <button type="button" onClick={() => onRemoveItem(item.id)}
                        aria-label={t("pos.v2.remove_item", { name: item.name })}
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition hover:opacity-70"
                        style={{ color: "var(--text-2)" }}>
                        <Trash2 size={16} />
                      </button>
                    </MotionDiv>
                  ))}
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* ── Payment rail ────────────────────────────── */}
        <div className="flex w-full shrink-0 flex-col gap-4 p-5 lg:w-[480px] lg:overflow-y-auto"
          style={{ borderInlineStart: "1px solid var(--border)", background: "var(--surface)" }}>

          {/* Total */}
          <div>
            <p className="mg2-sub" style={{ margin: 0, color: "var(--text-2)" }}>{t("pos.v2.total_due")} · {t("pos.v2.lines_units", { lines: formatNumber(items.length), units: formatNumber(itemCount) })}</p>
            <MoneyDue total={total} totalLbp={totalLbp} payableLbp={payableLbp} payableUsd={payableUsd} isCash={paymentMethod === "Cash"} size="hero" />
          </div>

          {/* Sell at Cost toggle */}
          {items.length > 0 && canOverridePrice && (
            <button
              type="button"
              onClick={onToggleSellAtCost}
              className="flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-[12px] font-bold transition"
              aria-pressed={sellAtCost}
              style={sellAtCost
                ? { background: "var(--warning-soft)", borderColor: "var(--warning)", color: "var(--warning-text)" }
                : { borderColor: "var(--border)", color: "var(--text-3)" }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: sellAtCost ? "var(--warning)" : "var(--text-3)" }} />
              {sellAtCost ? t("pos.sell_at_cost") + " — ON" : t("pos.sell_at_cost")}
            </button>
          )}

          {/* Sale note + Discount — side by side */}
          {items.length > 0 && (
            <div className="flex gap-2">
              {/* Sale note */}
              <div className="flex-1 rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
                <button
                  type="button"
                  onClick={() => setSaleNoteOpen(!saleNoteOpen)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2.5"
                  style={{ background: "var(--surface-2)" }}
                >
                  <span className="flex items-center gap-2 text-[12px] font-semibold" style={{ color: "var(--text-2)" }}>
                    <MessageSquare size={14} />
                    {t("pos.sale_note")}
                  </span>
                  {saleNote && (
                    <span className="truncate text-[10px] max-w-[60px]" style={{ color: "var(--text-3)" }}>{saleNote}</span>
                  )}
                  <ChevronDown size={14} className={`shrink-0 transition ${saleNoteOpen ? "rotate-180" : ""}`} style={{ color: "var(--text-3)" }} />
                </button>
                {saleNoteOpen && (
                  <div className="px-3 pb-3 pt-2" style={{ background: "var(--surface)" }}>
                    <input
                      type="text"
                      value={saleNote}
                      onChange={(e) => onSaleNoteChange(e.target.value)}
                      placeholder={t("pos.sale_note_placeholder")}
                      maxLength={120}
                      className="input w-full"
                      style={{ height: 36, fontSize: 13 }}
                    />
                  </div>
                )}
              </div>

              {/* Discount */}
              <div className="flex-1 rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
                <button
                  type="button"
                  onClick={() => setDiscountOpen(!discountOpen)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2.5"
                  style={{ background: "var(--surface-2)" }}
                >
                  <span className="flex items-center gap-2 text-[12px] font-semibold" style={{ color: "var(--text-2)" }}>
                    <BadgePercent size={14} />
                    {t("pos.discount")}
                  </span>
                  <div className="flex items-center gap-2">
                    {hasDiscount && (
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                        style={{ background: "var(--brand-soft)", color: "var(--brand-text)" }}
                      >
                        -{formatCurrency(discountTotal)}
                      </span>
                    )}
                    <ChevronDown size={14} className={`transition ${discountOpen ? "rotate-180" : ""}`} style={{ color: "var(--text-3)" }} />
                  </div>
                </button>
                {discountOpen && (
                  <div className="px-3 pb-3 pt-2" style={{ background: "var(--surface)" }}>
                    {canApplyDiscount ? (
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          {(["USD", "Percent"] as DiscountMode[]).map((mode) => (
                            <button
                              key={mode}
                              type="button"
                              onClick={() => onDiscountModeChange(mode)}
                              className={`h-8 rounded-lg border text-[12px] font-bold transition ${
                                discountMode === mode
                                  ? "border-[var(--text)] bg-[var(--text)] text-[var(--surface)]"
                                  : "border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-2)]"
                              }`}
                            >
                              {mode === "USD" ? t("pos.dollar_off") : t("pos.percent_off")}
                            </button>
                          ))}
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="number" min="0"
                            max={discountMode === "Percent" ? 100 : undefined}
                            step={discountMode === "Percent" ? 1 : 0.01}
                            value={discountValue}
                            onChange={(e) => onDiscountValueChange(e.target.value)}
                            placeholder={discountMode === "Percent" ? "10" : "1.00"}
                            className="input flex-1"
                            style={{ height: 36, fontSize: 13 }}
                          />
                          {(discountMode === "Percent" ? [5, 10, 15] : [1, 5, 10]).map((v) => (
                            <button
                              key={v}
                              type="button"
                              onClick={() => onDiscountValueChange(String(v))}
                              className="h-9 rounded-lg border px-2.5 text-[11px] font-bold transition hover:opacity-80"
                              style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--text-2)" }}
                            >
                              {discountMode === "Percent" ? `${v}%` : `$${v}`}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="text-[12px]" style={{ color: "var(--text-3)" }}>{t("pos.permission_required")}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          <TenderPanel
            density="quick"
            paymentMethod={paymentMethod}
            onSelectPayment={onSelectPayment}
            itemsCount={itemCount}
            paidUsd={paidUsd}
            paidLbp={paidLbp}
            onPaidUsdChange={onPaidUsdChange}
            onPaidLbpChange={onPaidLbpChange}
            onFillExactTender={onFillExactTender}
            cashTenderValid={cashTenderValid}
            paidTotalUsd={paidTotalUsd}
            paidTotalLbp={paidTotalLbp}
            cashChangeUsd={cashChangeUsd}
            cashChangeLbp={cashChangeLbp}
            cashStillDueUsd={cashStillDueUsd}
            exchangeRate={exchangeRate}
            total={total}
            customers={customers}
            selectedCustomerId={selectedCustomerId}
            onSelectCustomer={onSelectCustomer}
            selectedCustomer={selectedCustomer}
            creditLimitExceeded={creditLimitExceeded}
            usdInputRef={usdRef}
            lbpInputRef={lbpRef}
            onUsdEnter={() => lbpRef.current?.focus()}
            onLbpEnter={() => setShowReview(true)}
          />

          {/* Complete sale */}
          <div className="mt-auto">
            <button type="button" onClick={() => setShowReview(true)}
              disabled={items.length === 0 || checkoutBlocked}
              className="mg2-pay">
              <span>{t("pos.pay")}</span>
              <span className="num">{paymentMethod === "Cash" && payableLbp !== totalLbp
                ? `${formatCurrency(payableUsd)} · ${formatNumber(Math.round(payableLbp))} ${t("pos.v2.lbp")}`
                : `${formatCurrency(total)} · ${formatNumber(Math.round(totalLbp))} ${t("pos.v2.lbp")}`}</span>
              <span className="mg2-kbd">Enter</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
