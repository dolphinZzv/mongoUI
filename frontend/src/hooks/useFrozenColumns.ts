import * as React from "react"

/**
 * Horizontal frozen-column support for a scrollable table.
 *
 * Sticky cells need an explicit `left` offset for every column in the frozen
 * region, and that offset depends on the measured width of everything before
 * it (the optional leading gutter plus each earlier pinned column). Widths can
 * change at any time — column resize, font load, viewport changes — so we
 * measure with a `ResizeObserver` instead of trusting the saved width values.
 *
 * Only the pinned headers are observed: the offset never depends on the rows,
 * which keeps the observer cheap on tables with hundreds of columns.
 */
export interface FrozenColumns {
  /** Attach to the element that owns `overflow: auto`. */
  scrollRef: React.RefObject<HTMLDivElement | null>
  /** Measured `left` offset per pinned column, in px. */
  offsets: Record<string, number>
  /** True once the container has been scrolled horizontally. */
  scrolled: boolean
  /** True while at least one column is pinned. */
  active: boolean
  /** Attach to the scroll container's `onScroll`. */
  onScroll: (event: React.UIEvent<HTMLDivElement>) => void
}

export function useFrozenColumns(
  pinned: string[],
  /** Width of the leading (non-data) cell, e.g. a row-select checkbox. */
  leadingWidth = 0,
): FrozenColumns {
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const [offsets, setOffsets] = React.useState<Record<string, number>>({})
  const [scrolled, setScrolled] = React.useState(false)
  // A ref so the scroll handler can bail out before scheduling a render.
  const scrolledRef = React.useRef(false)

  // `pinned` is rebuilt on every render by callers; key the effect on its
  // contents so the observer is not torn down on unrelated state changes.
  const pinnedKey = pinned.join("\u0000")

  React.useLayoutEffect(() => {
    const root = scrollRef.current
    // Nothing frozen: no offsets to compute and no observer to keep alive.
    if (!root || pinned.length === 0) {
      setOffsets((prev) => (Object.keys(prev).length === 0 ? prev : {}))
      return
    }

    const pinnedSet = new Set(pinned)
    let frame = 0

    const measure = () => {
      frame = 0
      // The leading gutter (row-select checkbox) is laid out by the table, so
      // its real width can differ from the nominal `w-10` (auto table layout
      // distributes extra space). Measure it instead of trusting 40px, or the
      // first pinned header will sit underneath the checkbox column.
      const leadingCell = root.querySelector<HTMLElement>("th[data-sticky-checkbox]")
      const measuredLeading = leadingCell?.getBoundingClientRect().width ?? 0
      const leading = measuredLeading > 0 ? Math.ceil(measuredLeading) : leadingWidth
      const widthByColumn = new Map<string, number>()
      root.querySelectorAll<HTMLElement>("th[data-column]").forEach((th) => {
        const column = th.dataset.column
        if (!column || !pinnedSet.has(column)) return
        const width = Math.round(th.getBoundingClientRect().width)
        // 0 means the table is `display: none` (responsive layout). Keeping the
        // previous offsets is better than collapsing them; a resize re-runs us.
        if (width > 0) widthByColumn.set(column, width)
      })
      if (widthByColumn.size === 0) return

      const next: Record<string, number> = {}
      let left = leading
      for (const column of pinned) {
        const width = widthByColumn.get(column)
        if (width === undefined) continue
        next[column] = left
        left += width
      }
      // Skip the render when nothing actually moved.
      setOffsets((prev) => {
        const keys = Object.keys(next)
        if (keys.length !== Object.keys(prev).length) return next
        return keys.every((key) => prev[key] === next[key]) ? prev : next
      })
    }

    // ResizeObserver can fire in bursts (e.g. while dragging a column edge);
    // coalesce them into a single measurement per frame.
    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(measure)
    }

    measure()
    const observer = new ResizeObserver(schedule)
    observer.observe(root)
    root.querySelectorAll<HTMLElement>("th[data-sticky-checkbox]").forEach((th) => {
      observer.observe(th)
    })
    root.querySelectorAll<HTMLElement>("th[data-column]").forEach((th) => {
      if (th.dataset.column && pinnedSet.has(th.dataset.column)) observer.observe(th)
    })
    // Leaving `display: none` does not resize the container, so also listen for
    // viewport changes (mobile/desktop switch).
    window.addEventListener("resize", schedule)

    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener("resize", schedule)
      observer.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pinnedKey encodes `pinned`
  }, [pinnedKey, leadingWidth])

  const onScroll = React.useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const next = event.currentTarget.scrollLeft > 0
    if (scrolledRef.current === next) return
    scrolledRef.current = next
    setScrolled(next)
  }, [])

  return {
    scrollRef,
    offsets,
    scrolled,
    active: pinned.length > 0,
    onScroll,
  }
}
