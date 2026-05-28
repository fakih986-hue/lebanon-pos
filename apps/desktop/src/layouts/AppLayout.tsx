import type { ReactNode } from "react"

type Props = {
  children: ReactNode
}

export default function AppLayout({ children }: Props) {
  return (
    <div className="h-dvh overflow-hidden" style={{ background: "var(--pos-bg)", color: "var(--pos-text)" }}>
      <div className="flex h-full min-h-0">{children}</div>
    </div>
  )
}
