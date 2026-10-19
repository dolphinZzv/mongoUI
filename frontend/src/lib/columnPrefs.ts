/**
 * Per-collection table column preferences (order, visibility, widths, pinned),
 * persisted in localStorage so a collection looks the same on the next visit.
 */
export interface ColumnPrefs {
  /** Explicit column order; unknown/new columns are appended after it. */
  order: string[]
  hidden: string[]
  widths: Record<string, number>
  /** Fields frozen to the left edge so they stay visible while scrolling. */
  pinned: string[]
}

export const COLUMN_MIN_WIDTH = 80
export const COLUMN_MAX_WIDTH = 800

/** `_id` is frozen to the left by default. */
export const DEFAULT_PINNED_COLUMNS = ["_id"]

const PREFIX = "mongoui-columns:"

export function columnPrefsKey(connectionId: string, database: string, collection: string): string {
  return `${PREFIX}${connectionId}:${database}:${collection}`
}

function emptyPrefs(): ColumnPrefs {
  return { order: [], hidden: [], widths: {}, pinned: [...DEFAULT_PINNED_COLUMNS] }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function widthMap(value: unknown): Record<string, number> {
  if (typeof value !== "object" || value === null) return {}
  const result: Record<string, number> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue
    result[key] = Math.min(COLUMN_MAX_WIDTH, Math.max(COLUMN_MIN_WIDTH, Math.round(raw)))
  }
  return result
}

export function readColumnPrefs(key: string): ColumnPrefs {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return emptyPrefs()
    const parsed = JSON.parse(raw) as Partial<ColumnPrefs>
    return {
      order: stringList(parsed.order),
      hidden: stringList(parsed.hidden),
      widths: widthMap(parsed.widths),
      // Older stored prefs have no `pinned` key; fall back to the default.
      // An explicit empty array means the user un-pinned everything.
      pinned: Array.isArray(parsed.pinned) ? stringList(parsed.pinned) : [...DEFAULT_PINNED_COLUMNS],
    }
  } catch {
    return emptyPrefs()
  }
}

export function writeColumnPrefs(key: string, prefs: ColumnPrefs): void {
  try {
    localStorage.setItem(key, JSON.stringify(prefs))
  } catch {
    /* storage may be unavailable */
  }
}
