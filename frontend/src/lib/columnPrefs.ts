/**
 * Per-collection table column preferences (order, visibility, widths),
 * persisted in localStorage so a collection looks the same on the next visit.
 */
export interface ColumnPrefs {
  /** Explicit column order; unknown/new columns are appended after it. */
  order: string[]
  hidden: string[]
  widths: Record<string, number>
}

export const COLUMN_MIN_WIDTH = 80
export const COLUMN_MAX_WIDTH = 800

const PREFIX = "mongoui-columns:"

export function columnPrefsKey(connectionId: string, database: string, collection: string): string {
  return `${PREFIX}${connectionId}:${database}:${collection}`
}

function emptyPrefs(): ColumnPrefs {
  return { order: [], hidden: [], widths: {} }
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
