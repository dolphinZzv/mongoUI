import * as React from "react"

const RECENT_PREFIX = "mongoui-recent:"
const FAVORITE_PREFIX = "mongoui-favorites:"

function read(key: string): string[] {
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []
  } catch {
    return []
  }
}

function write(key: string, value: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage may be unavailable */
  }
}

/**
 * Recent and favourite queries for a context (e.g. one collection or one
 * database), persisted in localStorage. `push` records a query, de-duplicating
 * and capping the list. Queries can be starred as favourites and survive the
 * recent-list eviction.
 */
export function useRecentQueries(context: string, limit = 10) {
  const storageKey = RECENT_PREFIX + context
  const favoritesKey = FAVORITE_PREFIX + context
  const [items, setItems] = React.useState<string[]>([])
  const [favorites, setFavorites] = React.useState<string[]>([])

  React.useEffect(() => {
    setItems(read(storageKey))
    setFavorites(read(favoritesKey))
  }, [storageKey, favoritesKey])

  const push = React.useCallback(
    (value: string) => {
      const trimmed = value.trim()
      if (!trimmed) return
      setItems((prev) => {
        const next = [trimmed, ...prev.filter((x) => x !== trimmed)].slice(0, limit)
        write(storageKey, next)
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

  const toggleFavorite = React.useCallback(
    (value: string) => {
      const trimmed = value.trim()
      if (!trimmed) return
      setFavorites((prev) => {
        const next = prev.includes(trimmed)
          ? prev.filter((x) => x !== trimmed)
          : [trimmed, ...prev]
        write(favoritesKey, next)
        return next
      })
    },
    [favoritesKey],
  )

  const removeFavorite = React.useCallback(
    (value: string) => {
      setFavorites((prev) => {
        const next = prev.filter((x) => x !== value)
        write(favoritesKey, next)
        return next
      })
    },
    [favoritesKey],
  )

  const isFavorite = React.useCallback((value: string) => favorites.includes(value), [favorites])

  return { items, push, clear, favorites, toggleFavorite, removeFavorite, isFavorite }
}
