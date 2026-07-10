/**
 * TITAN brand lockup — the gold shield mark plus the wordmark.
 * Mark lives at /brand/titan-mark.png (true alpha transparency — chroma-keyed
 * from the AI-generated source, which had a flat dark background baked in).
 * Full lockup asset: /brand/titan-logo-full.png.
 */
export function Logo({ size = 34, wordmark = true }: { size?: number; wordmark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5 select-none">
      <img
        src="/brand/titan-mark.png"
        alt="Titan"
        style={{ width: size, height: size }}
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
