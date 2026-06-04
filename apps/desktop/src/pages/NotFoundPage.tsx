import { FileQuestion } from "lucide-react"

export default function NotFoundPage() {
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-3">
      <FileQuestion size={48} className="text-zinc-300" />
      <h2 className="text-xl font-bold text-zinc-600">Page not found</h2>
      <p className="text-sm text-zinc-500">The page you're looking for doesn't exist.</p>
    </div>
  )
}
