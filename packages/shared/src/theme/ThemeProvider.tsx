import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react"

export type Theme = "dark" | "light"

const STORAGE_KEY = "lebanonpos.theme"

type ThemeContextType = {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextType | null>(null)

function getSystemTheme(): Theme {
  if (typeof window === "undefined") return "dark"
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === "light" || saved === "dark") return saved
    return getSystemTheme()
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, theme)
    document.documentElement.setAttribute("data-theme", theme)
  }, [theme])

  // Listen for system theme changes when no explicit preference is saved
  useEffect(() => {
    const hasSaved = localStorage.getItem(STORAGE_KEY)
    if (hasSaved) return

    const mq = window.matchMedia("(prefers-color-scheme: light)")
    const handler = (e: MediaQueryListEvent) => {
      setThemeState(e.matches ? "light" : "dark")
    }
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme)
  }, [])

  const toggleTheme = useCallback(() => {
    setThemeState((prev: Theme) => prev === "dark" ? "light" : "dark")
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider")
  return ctx
}
