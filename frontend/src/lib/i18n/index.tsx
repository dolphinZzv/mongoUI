import * as React from "react"

import en from "./en"
import zh from "./zh"

export type Locale = "en" | "zh"

const STORAGE_KEY = "mongoui-lang"

export const LOCALES: { value: Locale; label: string }[] = [
  { value: "en", label: "English" },
  { value: "zh", label: "中文" },
]

const dictionaries: Record<Locale, Record<string, string>> = { en, zh }

function detect(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === "en" || stored === "zh") return stored
  } catch {
    /* storage may be unavailable */
  }
  if (typeof navigator !== "undefined" && /^zh/i.test(navigator.language)) return "zh"
  return "en"
}

interface I18nValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: string, vars?: Record<string, string | number>) => string
}

const I18nContext = React.createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = React.useState<Locale>(detect)

  const setLocale = React.useCallback((next: Locale) => {
    setLocaleState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* storage may be unavailable */
    }
  }, [])

  React.useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en"
  }, [locale])

  const t = React.useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const dict = dictionaries[locale] ?? en
      let text = dict[key] ?? en[key] ?? key
      if (vars) {
        for (const [name, value] of Object.entries(vars)) {
          text = text.replace(new RegExp(`\\{\\{${name}\\}\\}`, "g"), String(value))
        }
      }
      return text
    },
    [locale],
  )

  const value = React.useMemo<I18nValue>(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const ctx = React.useContext(I18nContext)
  if (!ctx) throw new Error("useI18n must be used within I18nProvider")
  return ctx
}
