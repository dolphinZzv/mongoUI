/**
 * Sidebar persistence and ordering helpers. Kept separate from the component
 * so the tree UI does not also own localStorage concerns.
 */

export const dbKey = (connectionId: string, database: string) =>
  `${connectionId}::${database}`

// --- expansion state ---------------------------------------------------------

const EXPANDED_KEY = "mongoui-sidebar-expanded"

export interface ExpandedState {
  conns: Record<string, boolean>
  dbs: Record<string, boolean>
}

export function readExpanded(): ExpandedState {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY)
    if (!raw) return { conns: {}, dbs: {} }
    const parsed = JSON.parse(raw) as Partial<ExpandedState>
    return { conns: parsed.conns ?? {}, dbs: parsed.dbs ?? {} }
  } catch {
    return { conns: {}, dbs: {} }
  }
}

export function writeExpanded(state: ExpandedState): void {
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify(state))
  } catch {
    /* storage may be unavailable */
  }
}

// --- pinned connections / databases / collections ---------------------------

const PINNED_KEY = "mongoui-sidebar-pinned"

export const connPin = (id: string) => `c:${id}`
export const dbPin = (connectionId: string, database: string) =>
  `d:${connectionId}::${database}`
export const colPin = (connectionId: string, database: string, collection: string) =>
  `x:${connectionId}::${database}::${collection}`

export function readPinned(): Set<string> {
  try {
    const raw = localStorage.getItem(PINNED_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    return new Set(Array.isArray(parsed) ? (parsed as string[]) : [])
  } catch {
    return new Set()
  }
}

export function writePinned(pinned: Set<string>): void {
  try {
    localStorage.setItem(PINNED_KEY, JSON.stringify([...pinned]))
  } catch {
    /* storage may be unavailable */
  }
}

/** Stable sort that floats pinned keys to the top. */
export function pinnedFirst<T>(items: T[], pinned: Set<string>, key: (item: T) => string): T[] {
  return [...items].sort((a, b) => {
    const pa = pinned.has(key(a)) ? 0 : 1
    const pb = pinned.has(key(b)) ? 0 : 1
    return pa - pb
  })
}
