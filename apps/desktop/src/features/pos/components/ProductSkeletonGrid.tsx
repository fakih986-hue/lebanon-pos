import { memo } from "react"

const SkeletonCard = memo(function SkeletonCard() {
  return (
    <div
      className="pos-product-tile animate-pulse p-3"
      style={{ borderTop: "3px solid var(--border)", minHeight: 150 }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="h-12 w-12 rounded-lg" style={{ background: "var(--surface-3)" }} />
        <div className="h-5 w-16 rounded-lg" style={{ background: "var(--surface-3)" }} />
      </div>
      <div className="mt-3 space-y-2">
        <div className="h-4 w-3/4 rounded" style={{ background: "var(--surface-3)" }} />
        <div className="h-3 w-1/2 rounded" style={{ background: "var(--surface-3)" }} />
      </div>
      <div className="mt-auto pt-4 flex items-end justify-between">
        <div className="space-y-1.5">
          <div className="h-5 w-16 rounded" style={{ background: "var(--surface-3)" }} />
          <div className="h-3 w-20 rounded" style={{ background: "var(--surface-3)" }} />
        </div>
        <div className="h-9 w-9 rounded-lg" style={{ background: "var(--surface-3)" }} />
      </div>
    </div>
  )
})

type Props = { count?: number }

export default function ProductSkeletonGrid({ count = 12 }: Props) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 pb-4 sm:grid-cols-[repeat(auto-fill,minmax(168px,1fr))] xl:grid-cols-[repeat(auto-fill,minmax(178px,1fr))]">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  )
}
