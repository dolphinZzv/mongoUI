import * as React from "react"

/**
 * Shared filter state for chart surfaces: keep typing responsive, only parse
 * and query once the user pauses.
 */
export function useChartFilter(initial: string, delayMs = 500) {
  const [filterText, setFilterText] = React.useState(initial)
  const [debounced, setDebounced] = React.useState(initial)

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(filterText), delayMs)
    return () => window.clearTimeout(timer)
  }, [filterText, delayMs])

  const parsed = React.useMemo<unknown | null>(() => {
    try {
      const value = JSON.parse(debounced.trim() || "{}") as unknown
      return value && typeof value === "object" && !Array.isArray(value) ? value : null
    } catch {
      return null
    }
  }, [debounced])

  return { filterText, setFilterText, debounced, setDebounced, parsed }
}
