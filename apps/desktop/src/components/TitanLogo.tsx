/**
 * Titan POS — official logomark.
 *
 * Uses the brand image (gold circuit-helmet) served from /titan-logo.png.
 * The art is gold-on-black, so it's always shown on a rounded black plate
 * to stay crisp and consistent across light + dark themes.
 *
 * Drop the image file at:  apps/desktop/public/titan-logo.png
 */

const LOGO_SRC = "/titan-logo.png"

type Props = {
  size?: number
  className?: string
  /** "icon" = helmet only (text cropped) for small uses · "full" = whole logo incl. TITAN wordmark */
  crop?: "icon" | "full"
  /** show the rounded black plate behind the art (default true) */
  plate?: boolean
}

export default function TitanLogo({ size = 40, className, crop = "icon", plate = true }: Props) {
  const radius = Math.round(size * 0.22)

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: plate ? "#000" : "transparent",
        border: plate ? "1px solid rgba(212,175,55,0.22)" : "none",
        boxShadow: plate ? "0 4px 14px rgba(0,0,0,0.4)" : "none",
        flexShrink: 0,
      }}
      aria-label="TITAN"
    >
      {crop === "icon" ? (
        // Helmet only — scale up & shift to crop the TITAN text band at the bottom
        <img
          src={LOGO_SRC}
          alt="TITAN"
          draggable={false}
          style={{ height: "128%", width: "auto", marginTop: "-1%", objectFit: "contain", userSelect: "none" }}
        />
      ) : (
        // Whole logo including the wordmark
        <img
          src={LOGO_SRC}
          alt="TITAN"
          draggable={false}
          style={{ width: "100%", height: "100%", objectFit: "contain", userSelect: "none" }}
        />
      )}
    </div>
  )
}

/** Full wordmark lockup — helmet icon + "TITAN / Powerful Systems" text */
export function TitanWordmark({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className ?? ""}`}>
      <TitanLogo size={size} crop="icon" />
      <div style={{ lineHeight: 1 }}>
        <span
          className="block font-bold tracking-[0.18em]"
          style={{ fontSize: size * 0.42, color: "var(--text)" }}
        >
          TITAN
        </span>
        <span
          className="block font-semibold uppercase"
          style={{ fontSize: size * 0.2, color: "var(--text-3)", letterSpacing: "0.24em" }}
        >
          Powerful Systems
        </span>
      </div>
    </div>
  )
}

/** Faint watermark — for empty states & login backgrounds (no plate) */
export function TitanMark({ size = 200, opacity = 0.05, className }: { size?: number; opacity?: number; className?: string }) {
  return (
    <div className={`pointer-events-none select-none ${className ?? ""}`} style={{ opacity }} aria-hidden>
      <TitanLogo size={size} crop="icon" plate={false} />
    </div>
  )
}
