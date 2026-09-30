import * as React from "react"

const PREFIX = "mongoui-recent:"

function read(key: string): string[] {
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []
  } catch {
    return []
  }
}

/**
 * Recent queries for a context (e.g. one collection or one database), persisted
 * in localStorage. `push` records a query, de-duplicating and capping the list.
 */
export function useRecentQueries(context: string, limit = 10) {
  const storageKey = PREFIX + context
  const [items, setItems] = React.useState<string[]>([])

  React.useEffect(() => {
    setItems(read(storageKey))
  }, [storageKey])

  const push = React.useCallback(
    (value: string) => {
      const trimmed = value.trim()
      if (!trimmed) return
      setItems((prev) => {
        const next = [trimmed, ...prev.filter((x) => x !== trimmed)].slice(0, limit)
        try {
          localStorage.setItem(storageKey, JSON.stringify(next))
        } catch {
          /* storage may be unavailable */
        }
        return next
      })
    },
    [storageKey, limit],
  )

  const clear = React.useCallback(() => {
    setItems([])
    try {
      localStorage.removeItem(storageKey)
    } catch {
      /* storage may be unavailable */
    }
  }, [storageKey])

  return { items, push, clear }
}
