import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Check, ShoppingCart } from "lucide-react"
import { formatCurrency, formatLbpCurrency } from "../lib/currency"
const MotionDiv = motion.div as any
const MotionP = motion.p as any

type Props = {
  sale: { number: string; total: number; totalLbp: number } | null
}

export default function SaleCompleteOverlay({ sale }: Props) {
  const [visible,   setVisible]   = useState(false)
  const [showCheck, setShowCheck] = useState(false)
  const [snapshot,  setSnapshot]  = useState<Props["sale"]>(null)

  useEffect(() => {
    if (!sale) return
    setSnapshot(sale)
    setVisible(true)
    setShowCheck(false)

    // cart → check swap
    const t1 = setTimeout(() => setShowCheck(true), 420)
    // auto-dismiss
    const t2 = setTimeout(() => setVisible(false), 2200)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [sale])

  return (
    <AnimatePresence>
      {visible && snapshot && (
        <MotionDiv
          className="fixed inset-0 z-[300] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={() => setVisible(false)}
        >
          <MotionDiv
            className="flex flex-col items-center gap-5 px-8 text-center"
            initial={{ scale: 0.75, y: 24, opacity: 0 }}
            animate={{ scale: 1,    y: 0,  opacity: 1 }}
            exit={{    scale: 0.85, y: -12, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 26 }}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            {/* Icon circle */}
            <div className="relative flex h-32 w-32 items-center justify-center">

              {/* Pulse rings */}
              {[0, 0.22, 0.44].map((delay) => (
                <MotionDiv
                  key={delay}
                  className="absolute inset-0 rounded-full"
                  style={{ border: "2px solid rgba(16,185,129,0.55)" }}
                  initial={{ scale: 0.6, opacity: 0.9 }}
                  animate={{ scale: 1.9, opacity: 0 }}
                  transition={{ duration: 1.1, delay, repeat: Infinity, ease: "easeOut" }}
                />
              ))}

              {/* Circle bg */}
              <div
                className="absolute inset-0 rounded-full"
                style={{ background: "rgba(16,185,129,0.14)" }}
              />

              {/* Cart → Check swap */}
              <AnimatePresence mode="wait">
                {!showCheck ? (
                  <MotionDiv
                    key="cart"
                    initial={{ scale: 0, rotate: -12 }}
                    animate={{ scale: 1, rotate: 0 }}
                    exit={{ scale: 0, rotate: 12, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 420, damping: 22 }}
                  >
                    <ShoppingCart size={52} style={{ color: "#10b981" }} strokeWidth={1.8} />
                  </MotionDiv>
                ) : (
                  <MotionDiv
                    key="check"
                    initial={{ scale: 0, rotate: -20 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: "spring", stiffness: 500, damping: 22 }}
                  >
                    <Check size={56} strokeWidth={3} style={{ color: "#10b981" }} />
                  </MotionDiv>
                )}
              </AnimatePresence>
            </div>

            {/* Sale info */}
            <MotionDiv
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.25 }}
            >
              <p className="mb-1 text-[13px] font-semibold" style={{ color: "rgba(255,255,255,0.5)" }}>
                Sale #{snapshot.number} complete
              </p>
              <p className="text-[42px] font-black tabular-nums leading-none text-white">
                {formatCurrency(snapshot.total)}
              </p>
              <p className="mt-1 text-[13px] font-semibold tabular-nums" style={{ color: "rgba(255,255,255,0.45)" }}>
                {formatLbpCurrency(snapshot.totalLbp)}
              </p>
            </MotionDiv>

            <MotionP
              className="text-[11px] font-semibold"
              style={{ color: "rgba(255,255,255,0.3)" }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.7 }}
            >
              Tap anywhere to dismiss
            </MotionP>
          </MotionDiv>
        </MotionDiv>
      )}
    </AnimatePresence>
  )
}
