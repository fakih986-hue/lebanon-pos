import { useI18n } from "@lebanonpos/shared"
import { LockKeyhole } from "lucide-react"

export default function AccessDenied() {
  const { t } = useI18n()
  return (
    <main className="flex min-h-0 flex-1 items-center justify-center bg-page p-6">
      <section className="max-w-md rounded-lg border border-zinc-200 bg-white p-6 text-center shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-lg bg-rose-100 text-rose-700">
          <LockKeyhole size={26} />
        </div>
        <h2 className="mt-4 text-2xl font-bold text-zinc-950">
          {t("access_denied.title")}
        </h2>
        <p className="mt-2 text-sm font-medium text-zinc-500">
          {t("access_denied.desc")}
        </p>
      </section>
    </main>
  )
}
