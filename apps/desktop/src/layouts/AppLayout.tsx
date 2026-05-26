import type { ReactNode } from "react"

type Props = {
  children: ReactNode
}

export default function AppLayout({ children }: Props) {
  return (
    <div className="h-dvh overflow-hidden bg-[#eef3f2] text-zinc-950">
      <div className="flex h-full min-h-0">{children}</div>
    </div>
  )
}
