/**
 * Persisted "pinned columns" for read-only result tables (SQL / aggregation /
 * mongosh), which have no full column-preference model. Kept separate from
 * `columnPrefs` so a result table does not inherit per-collection widths.
 */
const PREFIX = "mongoui-result-pinned:"

/** Result tables freeze `_id` by default, matching the documents browser. */
export const DEFAULT_RESULT_PINNED = ["_id"]

export function resultPinnedKey(storageKey: string): string {
  return `${PREFIX}${storageKey}`
}

export function readResultPinned(key: string): string[] {
  try {
    const raw = localStorage.getItem(key)
    // No stored value means "never configured" -> default; a stored `[]` is an
    // explicit "unpin everything" and must be preserved.
    if (raw === null) return [...DEFAULT_RESULT_PINNED]
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [...DEFAULT_RESULT_PINNED]
  } catch {
    return [...DEFAULT_RESULT_PINNED]
  }
}

export function writeResultPinned(key: string, pinned: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(pinned))
  } catch {
    /* storage may be unavailable */
  }
}
