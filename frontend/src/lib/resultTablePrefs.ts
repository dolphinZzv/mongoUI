/**
 * Persisted column order and pinned columns for read-only result tables
 * (SQL / aggregation / mongosh), which have no full column-preference model.
 * Kept separate from `columnPrefs` so a result table does not inherit
 * per-collection widths.
 */
const PREFIX = "mongoui-result-pinned:"

/** Result tables freeze `_id` by default, matching the documents browser. */
export const DEFAULT_RESULT_PINNED = ["_id"]

export interface ResultTablePrefs {
  /** Explicit column order; new columns are appended after it. */
  order: string[]
  pinned: string[]
}

export function resultTablePrefsKey(storageKey: string): string {
  return `${PREFIX}${storageKey}`
}

function defaultPrefs(): ResultTablePrefs {
  return { order: [], pinned: [...DEFAULT_RESULT_PINNED] }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}

export function readResultTablePrefs(key: string): ResultTablePrefs {
  try {
    const raw = localStorage.getItem(key)
    // No stored value means "never configured" -> default; a stored `[]` is an
    // explicit "unpin everything" and must be preserved.
    if (raw === null) return defaultPrefs()
    const parsed = JSON.parse(raw) as unknown
    // Legacy format: a bare array stored only the pinned columns.
    if (Array.isArray(parsed)) return { order: [], pinned: stringList(parsed) }
    if (!parsed || typeof parsed !== "object") return defaultPrefs()
    const prefs = parsed as Partial<ResultTablePrefs>
    return {
      order: stringList(prefs.order),
      pinned: Array.isArray(prefs.pinned)
        ? stringList(prefs.pinned)
        : [...DEFAULT_RESULT_PINNED],
    }
  } catch {
    return defaultPrefs()
  }
}

export function writeResultTablePrefs(key: string, prefs: ResultTablePrefs): void {
  try {
    localStorage.setItem(key, JSON.stringify(prefs))
  } catch {
    /* storage may be unavailable */
  }
}
