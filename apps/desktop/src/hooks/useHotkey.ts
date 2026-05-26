import { useEffect } from "react"

type Modifier = "ctrl" | "alt" | "shift" | "meta"

interface HotkeyDef {
  key: string
  modifiers?: Modifier[]
  handler: (e: KeyboardEvent) => void
  enabled?: boolean
}

function matchModifier(e: KeyboardEvent, modifier: Modifier): boolean {
  switch (modifier) {
    case "ctrl": return e.ctrlKey || e.metaKey
    case "alt": return e.altKey
    case "shift": return e.shiftKey
    case "meta": return e.metaKey
  }
}

export function useHotkeys(hotkeys: HotkeyDef[]) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
        const tag = (e.target as HTMLElement).tagName
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
          if (e.key === "Escape") {
            (e.target as HTMLElement).blur()
          }
          return
        }
      }

      for (const hk of hotkeys) {
        if (hk.enabled === false) continue

        const keyMatch = e.key.toLowerCase() === hk.key.toLowerCase()
        if (!keyMatch) continue

        const mods = hk.modifiers ?? []
        const modsMatch = mods.every((m) => matchModifier(e, m))
        if (!modsMatch) continue

        e.preventDefault()
        e.stopPropagation()
        hk.handler(e)
        return
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [hotkeys])
}
