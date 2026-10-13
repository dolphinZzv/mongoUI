import type { DocsQueryState } from "@/lib/router"

/**
 * Collection tabs: the collections opened in the main area, with the tab and
 * documents query each one was last showing. Persisted in localStorage so the
 * set of open tabs survives a refresh; the URL decides which one is active.
 */
export interface CollectionTab {
  key: string
  connectionId: string
  database: string
  collection: string
  tab?: string
  docs?: DocsQueryState
}

const STORAGE_KEY = "mongoui-collection-tabs"

export function tabKey(selection: {
  connectionId: string
  database: string
  collection: string
}): string {
  return `${selection.connectionId}::${selection.database}::${selection.collection}`
}

function isTab(value: unknown): value is CollectionTab {
  if (typeof value !== "object" || value === null) return false
  const tab = value as Record<string, unknown>
  return (
    typeof tab.key === "string" &&
    typeof tab.connectionId === "string" &&
    typeof tab.database === "string" &&
    typeof tab.collection === "string"
  )
}

export function readTabs(): CollectionTab[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isTab) : []
  } catch {
    return []
  }
}

export function writeTabs(tabs: CollectionTab[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs))
  } catch {
    /* storage may be unavailable */
  }
}
