import * as React from "react"

import {
  COLUMN_MAX_WIDTH,
  COLUMN_MIN_WIDTH,
  DEFAULT_PINNED_COLUMNS,
  reorderVisibleColumns,
  type ColumnColorRule,
  type ColumnDropPosition,
  type ColumnPrefs,
  type ColumnRender,
} from "@/lib/columnPrefs"

interface UseColumnLayoutOptions {
  prefs: ColumnPrefs
  setPrefs: React.Dispatch<React.SetStateAction<ColumnPrefs>>
  /** All column names present on the current page, in first-seen order. */
  allColumns: string[]
}

/**
 * Derives the visible/pinned column layout and owns column mutations (hide,
 * reorder, resize, pin, renderer, colors). The persisted preference state itself
 * stays with the caller so it can also be passed to the documents query hook.
 */
export function useColumnLayout({ prefs, setPrefs, allColumns }: UseColumnLayoutOptions) {
  const resizeCleanupRef = React.useRef<(() => void) | null>(null)

  React.useEffect(() => () => resizeCleanupRef.current?.(), [])

  const hiddenSet = React.useMemo(() => new Set(prefs.hidden), [prefs.hidden])
  const pinnedSet = React.useMemo(() => new Set(prefs.pinned), [prefs.pinned])
  // Visible columns, ordered by the saved preference (new columns appended).
  const columns = React.useMemo(() => {
    const present = allColumns.filter((column) => !hiddenSet.has(column))
    const presentSet = new Set(present)
    const ordered: string[] = []
    const seen = new Set<string>()
    for (const column of prefs.order) {
      if (presentSet.has(column) && !seen.has(column)) {
        ordered.push(column)
        seen.add(column)
      }
    }
    for (const column of present) {
      if (!seen.has(column)) {
        ordered.push(column)
        seen.add(column)
      }
    }
    return ordered
  }, [allColumns, hiddenSet, prefs.order])
  // Pinned columns always render first so they occupy the frozen left region.
  const pinnedColumns = React.useMemo(
    () => columns.filter((column) => pinnedSet.has(column)),
    [columns, pinnedSet],
  )
  const displayColumns = React.useMemo(
    () => [...pinnedColumns, ...columns.filter((column) => !pinnedSet.has(column))],
    [columns, pinnedColumns, pinnedSet],
  )

  const setColumnHidden = React.useCallback((column: string, hidden: boolean) => {
    setPrefs((prev) => ({
      ...prev,
      hidden: hidden
        ? Array.from(new Set([...prev.hidden, column]))
        : prev.hidden.filter((candidate) => candidate !== column),
    }))
  }, [])

  const showOnlyColumn = React.useCallback(
    (column: string) => {
      setPrefs((prev) => ({
        ...prev,
        hidden: allColumns.filter((candidate) => candidate !== column),
      }))
    },
    [allColumns],
  )

  const resetColumns = React.useCallback(() => {
    setPrefs((prev) => ({
      order: [],
      hidden: [],
      widths: {},
      pinned: [...DEFAULT_PINNED_COLUMNS],
      dictionaries: prev.dictionaries,
      renderers: prev.renderers,
      colors: prev.colors,
    }))
  }, [])

  const setColumnColors = React.useCallback((column: string, rules: ColumnColorRule[]) => {
    setPrefs((prev) => {
      const colors = { ...prev.colors }
      if (rules.length > 0) colors[column] = rules
      else delete colors[column]
      return { ...prev, colors }
    })
  }, [])

  const setColumnRenderer = React.useCallback((column: string, renderer: ColumnRender) => {
    setPrefs((prev) => {
      const renderers = { ...prev.renderers }
      if (renderer === "default") delete renderers[column]
      else renderers[column] = renderer
      return { ...prev, renderers }
    })
  }, [])

  const toggleColumnPinned = React.useCallback((column: string) => {
    setPrefs((prev) => ({
      ...prev,
      pinned: prev.pinned.includes(column)
        ? prev.pinned.filter((candidate) => candidate !== column)
        : [...prev.pinned, column],
    }))
  }, [])

  const moveColumn = React.useCallback(
    (column: string, direction: -1 | 1) => {
      setPrefs((prev) => {
        // Reorder only within the pinned or unpinned group, otherwise the swap
        // is invisible (pinned columns always render first).
        const isPinned = prev.pinned.includes(column)
        const group = columns.filter((candidate) => pinnedSet.has(candidate) === isPinned)
        const index = group.indexOf(column)
        const target = index + direction
        if (index < 0 || target < 0 || target >= group.length) return prev
        const next = group.slice()
        ;[next[index], next[target]] = [next[target], next[index]]
        const pinnedOrder = isPinned ? next : columns.filter((c) => pinnedSet.has(c))
        const restOrder = isPinned ? columns.filter((c) => !pinnedSet.has(c)) : next
        const ordered = [...pinnedOrder, ...restOrder]
        const rest = allColumns.filter((candidate) => !ordered.includes(candidate))
        return { ...prev, order: [...ordered, ...rest] }
      })
    },
    [columns, pinnedSet, allColumns],
  )

  const reorderColumn = React.useCallback(
    (source: string, target: string, position: ColumnDropPosition) => {
      setPrefs((prev) => {
        const order = reorderVisibleColumns(
          prev.order,
          displayColumns,
          allColumns,
          prev.pinned,
          source,
          target,
          position,
        )
        return order === prev.order ? prev : { ...prev, order }
      })
    },
    [allColumns, displayColumns],
  )

  const startResize = React.useCallback((column: string, event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const header = (event.currentTarget as HTMLElement).closest("th")
    const startWidth = header?.getBoundingClientRect().width ?? 160
    const startX = event.clientX
    const onMove = (moveEvent: MouseEvent) => {
      const width = Math.min(
        COLUMN_MAX_WIDTH,
        Math.max(COLUMN_MIN_WIDTH, startWidth + (moveEvent.clientX - startX)),
      )
      setPrefs((prev) => ({ ...prev, widths: { ...prev.widths, [column]: Math.round(width) } }))
    }
    const cleanup = () => {
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
      document.body.style.userSelect = ""
      if (resizeCleanupRef.current === cleanup) resizeCleanupRef.current = null
    }
    const onUp = () => cleanup()
    // A second drag, or an unmount while the pointer is down, must not leave
    // global listeners behind or keep the page unselectable.
    resizeCleanupRef.current?.()
    resizeCleanupRef.current = cleanup
    document.body.style.userSelect = "none"
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }, [])

  return {
    prefs,
    setPrefs,
    hiddenSet,
    pinnedSet,
    columns,
    pinnedColumns,
    displayColumns,
    setColumnHidden,
    showOnlyColumn,
    resetColumns,
    setColumnColors,
    setColumnRenderer,
    toggleColumnPinned,
    moveColumn,
    reorderColumn,
    startResize,
  }
}
