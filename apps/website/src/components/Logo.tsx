/**
 * TITAN brand lockup — the gold shield mark plus the wordmark.
 * Mark lives at /brand/titan-mark.webp (true alpha transparency, re-encoded from
 * the 1024px master to a small WebP — displayed at ≤160px everywhere it's used).
 * Full lockup asset (social/JSON-LD only): /brand/titan-logo-full.png.
 */
export function Logo({ size = 34, wordmark = true }: { size?: number; wordmark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5 select-none">
      <img
        src="/brand/titan-mark.webp"
        alt="Titan"
        width={size}
        height={size}
        style={{ width: size, height: size }}
        decoding="async"
        draggable={false}
      />
      {wordmark && (
        <span
          className="font-display font-bold tracking-[0.22em] leading-none text-[#e9c766]"
          style={{ fontSize: size * 0.5 }}
        >
          TITAN
        </span>
      )}
    </span>
  )
}
