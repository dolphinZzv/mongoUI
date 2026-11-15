import * as React from "react"

const RECENT_PREFIX = "mongoui-recent:"
const META_PREFIX = "mongoui-recent-meta:"
const FAVORITE_PREFIX = "mongoui-favorites:"

export interface RecentQueryMeta {
  rows?: number
  total?: number
  durationMs?: number
  at?: number
}

function read(key: string): string[] {
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []
  } catch {
    return []
  }
}

function readMeta(key: string): Record<string, RecentQueryMeta> {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    return parsed as Record<string, RecentQueryMeta>
  } catch {
    return {}
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage may be unavailable */
  }
}

/**
 * Recent and favourite queries for a context (e.g. one collection or one
 * database), persisted in localStorage. `push` records a query, de-duplicating
 * and capping the list. Optional execution metadata (row count, timing) is
 * associated with the query so history is useful, not just a list of strings.
 */
export function useRecentQueries(context: string, limit = 10) {
  const storageKey = RECENT_PREFIX + context
  const metaKey = META_PREFIX + context
  const favoritesKey = FAVORITE_PREFIX + context
  const [items, setItems] = React.useState<string[]>([])
  const [meta, setMeta] = React.useState<Record<string, RecentQueryMeta>>({})
  const [favorites, setFavorites] = React.useState<string[]>([])

  React.useEffect(() => {
    setItems(read(storageKey))
    setMeta(readMeta(metaKey))
    setFavorites(read(favoritesKey))
  }, [storageKey, metaKey, favoritesKey])

  const push = React.useCallback(
    (value: string, details?: RecentQueryMeta) => {
      const trimmed = value.trim()
      if (!trimmed) return
      const next = [trimmed, ...items.filter((x) => x !== trimmed)].slice(0, limit)
      setItems(next)
      write(storageKey, next)
      setMeta((previousMeta) => {
        const nextMeta = details ? { ...previousMeta, [trimmed]: details } : previousMeta
        const pruned = Object.fromEntries(
          Object.entries(nextMeta).filter(([query]) => next.includes(query)),
        )
        write(metaKey, pruned)
        return pruned
      })
    },
    [items, storageKey, metaKey, limit],
  )

  const clear = React.useCallback(() => {
    setItems([])
    setMeta({})
    try {
      localStorage.removeItem(storageKey)
      localStorage.removeItem(metaKey)
    } catch {
      /* storage may be unavailable */
    }
  }, [storageKey, metaKey])

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
  const metaFor = React.useCallback(
    (value: string) => meta[value.trim()] ?? undefined,
    [meta],
  )

  return {
    items,
    push,
    clear,
    favorites,
    toggleFavorite,
    removeFavorite,
    isFavorite,
    metaFor,
  }
}
