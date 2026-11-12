/**
 * Per-collection table column preferences (order, visibility, widths, pinned),
 * persisted in localStorage so a collection looks the same on the next visit.
 */
export interface ColumnDictionaryEntry {
  value: string
  label: string
}

export type ColumnDictionaries = Record<string, ColumnDictionaryEntry[]>

export type ColumnRender = "default" | "dictionary" | "checkbox" | "switch" | "date" | "duration"

export type ColumnRenderers = Record<string, ColumnRender>

export interface ColumnPrefs {
  /** Explicit column order; unknown/new columns are appended after it. */
  order: string[]
  hidden: string[]
  widths: Record<string, number>
  /** Fields frozen to the left edge so they stay visible while scrolling. */
  pinned: string[]
  /** Optional raw-value → display-label mappings per column. */
  dictionaries: ColumnDictionaries
  /** Optional renderer choice per column. */
  renderers: ColumnRenderers
}

export const COLUMN_MIN_WIDTH = 80
export const COLUMN_MAX_WIDTH = 800

export type ColumnDropPosition = "before" | "after"

/**
 * Reorder `source` next to `target` and return the new explicit column order.
 * Pinned and unpinned columns form independent groups (pinned columns always
 * render first), so a drop across the boundary is ignored. Hidden or unknown
 * columns keep their previous tail position.
 */
export function reorderVisibleColumns(
  order: string[],
  visible: string[],
  all: string[],
  pinned: readonly string[],
  source: string,
  target: string,
  position: ColumnDropPosition,
): string[] {
  if (source === target) return order
  const pinnedSet = new Set(pinned)
  if (pinnedSet.has(source) !== pinnedSet.has(target)) return order

  const isPinned = pinnedSet.has(source)
  const group = visible.filter((column) => pinnedSet.has(column) === isPinned)
  const from = group.indexOf(source)
  if (from < 0 || group.indexOf(target) < 0) return order

  const next = group.slice()
  next.splice(from, 1)
  const targetIndex = next.indexOf(target)
  next.splice(targetIndex + (position === "after" ? 1 : 0), 0, source)

  const pinnedOrder = isPinned ? next : visible.filter((column) => pinnedSet.has(column))
  const restOrder = isPinned ? visible.filter((column) => !pinnedSet.has(column)) : next
  const ordered = [...pinnedOrder, ...restOrder]
  const seen = new Set(ordered)
  const rest: string[] = []
  for (const column of [...order, ...all]) {
    if (seen.has(column)) continue
    seen.add(column)
    rest.push(column)
  }
  return [...ordered, ...rest]
}

/** `_id` is frozen to the left by default. */
export const DEFAULT_PINNED_COLUMNS = ["_id"]

const PREFIX = "mongoui-columns:"

export function columnPrefsKey(connectionId: string, database: string, collection: string): string {
  return `${PREFIX}${connectionId}:${database}:${collection}`
}

function emptyPrefs(): ColumnPrefs {
  return {
    order: [],
    hidden: [],
    widths: {},
    pinned: [...DEFAULT_PINNED_COLUMNS],
    dictionaries: {},
    renderers: {},
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function dictionaryMap(value: unknown): ColumnDictionaries {
  if (typeof value !== "object" || value === null) return {}
  const result: ColumnDictionaries = {}
  for (const [column, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(raw)) continue
    const entries: ColumnDictionaryEntry[] = []
    for (const item of raw) {
      if (!item || typeof item !== "object") continue
      const entry = item as Partial<ColumnDictionaryEntry>
      if (typeof entry.value !== "string" || typeof entry.label !== "string") continue
      const value = entry.value.trim()
      const label = entry.label.trim()
      if (value && label) entries.push({ value, label })
    }
    if (entries.length > 0) result[column] = entries
  }
  return result
}

function rendererMap(value: unknown): ColumnRenderers {
  if (typeof value !== "object" || value === null) return {}
  const result: ColumnRenderers = {}
  const allowed = new Set<ColumnRender>([
    "default",
    "dictionary",
    "checkbox",
    "switch",
    "date",
    "duration",
  ])
  for (const [column, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string" && allowed.has(raw as ColumnRender)) {
      result[column] = raw as ColumnRender
    }
  }
  return result
}

/** Effective renderer, falling back to dictionary when mappings exist. */
export function columnRenderMode(
  renderers: ColumnRenderers | undefined,
  dictionaries: ColumnDictionaries | undefined,
  column: string,
): ColumnRender {
  return (
    renderers?.[column] ??
    ((dictionaries?.[column]?.length ?? 0) > 0 ? "dictionary" : "default")
  )
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
      dictionaries: dictionaryMap(parsed.dictionaries),
      renderers: rendererMap(parsed.renderers),
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
