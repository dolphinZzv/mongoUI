/**
 * Named views: a saved filter + sort + projection + limit for one collection,
 * persisted in localStorage. Applying a view restores the whole query state.
 */
export interface SavedView {
  id: string
  name: string
  filter: string
  sort: string
  projection: string
  limit: number
}

const PREFIX = "mongoui-views:"

export function viewsKey(connectionId: string, database: string, collection: string): string {
  return `${PREFIX}${connectionId}:${database}:${collection}`
}

function isSavedView(value: unknown): value is SavedView {
  if (typeof value !== "object" || value === null) return false
  const view = value as Record<string, unknown>
  return (
    typeof view.id === "string" &&
    typeof view.name === "string" &&
    typeof view.filter === "string" &&
    typeof view.sort === "string" &&
    typeof view.projection === "string" &&
    typeof view.limit === "number"
  )
}

export function readViews(key: string): SavedView[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isSavedView) : []
  } catch {
    return []
  }
}

export function writeViews(key: string, views: SavedView[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(views))
  } catch {
    /* storage may be unavailable */
  }
}

export function newViewId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  return `view-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
