import { useEffect } from "react"
import { motion } from "framer-motion"
import TitanLogo from "./TitanLogo"

const MotionDiv = motion.div as any
const MotionSpan = motion.span as any
const MotionP = motion.p as any

/**
 * Premium login reveal — plays once right after a successful unlock.
 * Gold helmet rises out of darkness with a shimmer sweep, the wordmark
 * resolves, a gold underline draws, then the whole thing lifts away to
 * reveal the app.
 */
export default function TitanIntro({ onDone }: { onDone: () => void }) {
  // Total runtime ~2.8s, then hand off to the app
  useEffect(() => {
    const t = setTimeout(onDone, 2800)
    return () => clearTimeout(t)
  }, [onDone])

  const titanLetters = "TITAN".split("")

  return (
    <MotionDiv
      className="fixed inset-0 z-[400] flex flex-col items-center justify-center overflow-hidden"
      style={{ background: "#000" }}
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      // Whole scene lifts + fades out at the end
      {...{}}
    >
      {/* Animate the scene out near the end */}
      <MotionDiv
        className="absolute inset-0"
        style={{ background: "#000" }}
        initial={{ opacity: 1 }}
        animate={{ opacity: [1, 1, 0] }}
        transition={{ duration: 2.8, times: [0, 0.85, 1] }}
      />

      {/* ── Ambient rotating gold rays ── */}
      <MotionDiv
        className="pointer-events-none absolute"
        style={{
          width: 700, height: 700, borderRadius: "50%",
          background: "conic-gradient(from 0deg, rgba(212,175,55,0.10), transparent 22%, rgba(212,175,55,0.08) 50%, transparent 72%, rgba(212,175,55,0.10))",
          filter: "blur(8px)",
        }}
        initial={{ rotate: 0, opacity: 0, scale: 0.6 }}
        animate={{ rotate: 90, opacity: [0, 0.9, 0.9, 0], scale: 1 }}
        transition={{ duration: 2.8, ease: "easeInOut", times: [0, 0.25, 0.8, 1] }}
      />

      {/* ── Radial glow pulse behind logo ── */}
      <MotionDiv
        className="pointer-events-none absolute"
        style={{
          width: 360, height: 360, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(226,196,90,0.35), rgba(212,175,55,0.10) 45%, transparent 70%)",
        }}
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{ scale: [0.4, 1.15, 1], opacity: [0, 0.9, 0.55] }}
        transition={{ duration: 1.4, ease: "easeOut" }}
      />

      {/* ── Logo with shimmer sweep ── */}
      <MotionDiv
        className="relative z-10"
        initial={{ scale: 0.55, opacity: 0, filter: "blur(14px)" }}
        animate={{ scale: 1, opacity: 1, filter: "blur(0px)" }}
        transition={{ type: "spring", stiffness: 140, damping: 16, delay: 0.15 }}
      >
        <MotionDiv
          className="relative overflow-hidden"
          style={{ borderRadius: 36 }}
          // gentle breathing glow
          animate={{ filter: ["drop-shadow(0 0 14px rgba(212,175,55,0.35))", "drop-shadow(0 0 34px rgba(212,175,55,0.65))", "drop-shadow(0 0 18px rgba(212,175,55,0.4))"] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        >
          <TitanLogo size={170} crop="icon" plate={false} />

          {/* Shimmer light sweep across the helmet */}
          <MotionDiv
            className="pointer-events-none absolute inset-0"
            style={{
              background: "linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.55) 48%, rgba(255,255,255,0.0) 62%)",
            }}
            initial={{ x: "-120%" }}
            animate={{ x: ["-120%", "120%"] }}
            transition={{ duration: 1.1, delay: 0.7, ease: "easeInOut" }}
          />
        </MotionDiv>
      </MotionDiv>

      {/* ── Wordmark ── */}
      <div className="relative z-10 mt-7 flex flex-col items-center">
        {/* TITAN — letters rise with stagger */}
        <div className="flex">
          {titanLetters.map((ch, i) => (
            <MotionSpan
              key={i}
              style={{
                color: "#f3e2a0",
                fontSize: 38,
                fontWeight: 900,
                letterSpacing: "0.18em",
                textShadow: "0 2px 18px rgba(212,175,55,0.45)",
              }}
              initial={{ y: 26, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.9 + i * 0.08, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            >
              {ch}
            </MotionSpan>
          ))}
        </div>

        {/* Underline draws out */}
        <MotionDiv
          style={{ height: 2, marginTop: 10, background: "linear-gradient(90deg, transparent, #d4af37, transparent)" }}
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 200, opacity: 1 }}
          transition={{ delay: 1.5, duration: 0.6, ease: "easeOut" }}
        />

        {/* POWERFUL SYSTEMS — tracking expands in */}
        <MotionP
          style={{ color: "#9a7b2e", fontSize: 11, fontWeight: 600, textTransform: "uppercase", marginTop: 10 }}
          initial={{ opacity: 0, letterSpacing: "0.05em" }}
          animate={{ opacity: 1, letterSpacing: "0.5em" }}
          transition={{ delay: 1.6, duration: 0.7, ease: "easeOut" }}
        >
          Powerful&nbsp;Systems
        </MotionP>
      </div>
    </MotionDiv>
  )
}
