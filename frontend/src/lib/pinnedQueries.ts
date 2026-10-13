import * as React from "react"

/**
 * Queries pinned to the left sidebar.
 *
 * A pinned query is a filter bound to a collection. The list is kept in
 * localStorage and exposed through a tiny external store so the documents tab
 * (which pins the current filter) and the sidebar (which lists them) stay in
 * sync without a shared React context.
 */
export interface PinnedQuery {
  connectionId: string
  database: string
  collection: string
  filter: string
  /** Optional short label shown in the sidebar instead of the full path. */
  name?: string
}

const STORAGE_KEY = "mongoui-pinned-queries"

function isPinnedQuery(value: unknown): value is PinnedQuery {
  if (typeof value !== "object" || value === null) return false
  const query = value as Record<string, unknown>
  return (
    typeof query.connectionId === "string" &&
    typeof query.database === "string" &&
    typeof query.collection === "string" &&
    typeof query.filter === "string"
  )
}

function sameQuery(a: PinnedQuery, b: PinnedQuery): boolean {
  return (
    a.connectionId === b.connectionId &&
    a.database === b.database &&
    a.collection === b.collection &&
    a.filter === b.filter
  )
}

function read(): PinnedQuery[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isPinnedQuery) : []
  } catch {
    return []
  }
}

let cache: PinnedQuery[] = read()
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

function update(next: PinnedQuery[]) {
  cache = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* storage may be unavailable */
  }
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): PinnedQuery[] {
  return cache
}

export function togglePinnedQuery(query: PinnedQuery) {
  update(cache.some((item) => sameQuery(item, query))
    ? cache.filter((item) => !sameQuery(item, query))
    : [query, ...cache])
}

export function removePinnedQuery(query: PinnedQuery) {
  update(cache.filter((item) => !sameQuery(item, query)))
}

/** Renames a pinned query; an empty name falls back to the default label. */
export function renamePinnedQuery(query: PinnedQuery, name: string) {
  const trimmed = name.trim()
  update(
    cache.map((item) =>
      sameQuery(item, query) ? { ...item, name: trimmed || undefined } : item,
    ),
  )
}

/** Reactive list of pinned queries. */
export function usePinnedQueries(): PinnedQuery[] {
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
