import type { ReactNode } from "react"

type Props = {
  children: ReactNode
}

export default function AppLayout({ children }: Props) {
  return (
    <div className="h-dvh overflow-hidden bg-page" style={{ color: "var(--text)" }}>
      <div className="flex h-full min-h-0">{children}</div>
    </div>
  )
}
