import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react"
import { en } from "./en"
import { ar } from "./ar"

export type Locale = "en" | "ar"
export type TranslationDict = typeof en

const STORAGE_KEY = "lebanonpos.locale"
const dicts: Record<Locale, TranslationDict> = { en, ar: ar as unknown as TranslationDict }

type I18nContextType = {
  locale: Locale
  dir: "ltr" | "rtl"
  t: (key: string, fallback?: string) => string
  setLocale: (locale: Locale) => void
}

const I18nContext = createContext<I18nContextType | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    return (localStorage.getItem(STORAGE_KEY) as Locale) || "en"
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, locale)
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr"
    document.documentElement.lang = locale
  }, [locale])

  const t = useCallback((key: string, fallback?: string) => {
    return (dicts[locale] as Record<string, string>)?.[key] ?? fallback ?? key
  }, [locale])

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale)
  }, [])

  return (
    <I18nContext.Provider value={{ locale, dir: locale === "ar" ? "rtl" : "ltr", t, setLocale }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error("useI18n must be used within I18nProvider")
  return ctx
}
