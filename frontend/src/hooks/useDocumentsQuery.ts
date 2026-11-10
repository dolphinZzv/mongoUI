import * as React from "react"
import { toast } from "sonner"

import { api, isAbortError } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { DOCS_QUERY_DEFAULTS, type ChartShareState, type DocsQueryState } from "@/lib/router"
import type { FindResult } from "@/lib/types"

/** Signature of the parts that only change when the user runs a query. */
function appliedQueryKey(filter: string, sort: string, projection: string): string {
  return [filter, sort, projection].map((part) => part.trim()).join("\u0000")
}

/** First JSON parse error, or null when the text is valid (or empty). */
function jsonError(value: string): string | null {
  const text = value.trim()
  if (!text) return null
  try {
    JSON.parse(text)
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

/** Canonical JSON for comparing a sort/projection against the defaults. */
function normalizedJSON(value: string): string {
  const text = value.trim()
  if (!text) return ""
  try {
    return JSON.stringify(JSON.parse(text))
  } catch {
    return text
  }
}

/** Compact signature used to tell our own URL writes apart from back/forward. */
function docsQuerySignature(docs?: DocsQueryState): string {
  const value = docs ?? DOCS_QUERY_DEFAULTS
  const pinned = value.pinned === undefined ? "local" : value.pinned.join("\u0001")
  const chart = value.chart ? JSON.stringify(value.chart) : ""
  return `${value.filter}\u0000${value.sort}\u0000${value.projection}\u0000${value.limit}\u0000${value.skip}\u0000${pinned}\u0000${chart}`
}

export interface DocumentsQueryOptions {
  connectionId: string
  database: string
  collection: string
  /** Query/pagination restored from the URL, if present. */
  initialDocs?: DocsQueryState
  /** Persist the current query/pagination so a refresh restores it. */
  onDocsChange?: (docs: DocsQueryState) => void
  /** Open chart state mirrored into the URL. */
  chart?: ChartShareState
  /** Apply a chart state coming from the URL (back/forward or a shared link). */
  onChartFromURL?: (chart: ChartShareState | undefined) => void
  /** Pinned columns mirrored into the URL. */
  pinned: string[]
  /** Pinned columns to apply when the URL carries its own list. */
  readPinned: () => string[]
  onPinnedFromURL: (pinned: string[]) => void
  pushRecent: (filter: string) => void
  /** Called before a query starts, e.g. to close an inline cell editor. */
  onBeforeLoad?: () => void
  /** Called after a successful query, e.g. to clear the row selection. */
  onLoaded?: () => void
}

export interface DocumentsQuery {
  filter: string
  setFilter: React.Dispatch<React.SetStateAction<string>>
  sort: string
  setSort: React.Dispatch<React.SetStateAction<string>>
  projection: string
  setProjection: React.Dispatch<React.SetStateAction<string>>
  limit: number
  setLimit: React.Dispatch<React.SetStateAction<number>>
  skip: number
  result: FindResult | null
  setResult: React.Dispatch<React.SetStateAction<FindResult | null>>
  documents: FindResult["documents"]
  total: number
  loading: boolean
  error: string | null
  page: number
  pages: number
  filterActive: boolean
  sortActive: boolean
  projectionActive: boolean
  queryError: string | null
  queryDirty: boolean
  load: (opts?: {
    skip?: number
    limit?: number
    filter?: string
    sort?: string
    projection?: string
  }) => Promise<void>
  cancelLoad: () => void
  clearFilter: () => void
  clearSort: () => void
  clearProjection: () => void
  formatQuery: () => void
}

/**
 * Owns the documents query: filter/sort/projection/pagination state, request
 * cancellation, URL mirroring and the derived validation/active flags.
 */
export function useDocumentsQuery({
  connectionId,
  database,
  collection,
  initialDocs,
  onDocsChange,
  chart,
  onChartFromURL,
  pinned,
  readPinned,
  onPinnedFromURL,
  pushRecent,
  onBeforeLoad,
  onLoaded,
}: DocumentsQueryOptions): DocumentsQuery {
  const { t } = useI18n()
  const [filter, setFilter] = React.useState(initialDocs?.filter ?? DOCS_QUERY_DEFAULTS.filter)
  const [sort, setSort] = React.useState(initialDocs?.sort ?? DOCS_QUERY_DEFAULTS.sort)
  const [projection, setProjection] = React.useState(
    initialDocs?.projection ?? DOCS_QUERY_DEFAULTS.projection,
  )
  const [limit, setLimit] = React.useState(initialDocs?.limit ?? DOCS_QUERY_DEFAULTS.limit)
  const [skip, setSkip] = React.useState(initialDocs?.skip ?? DOCS_QUERY_DEFAULTS.skip)
  const [appliedQuery, setAppliedQuery] = React.useState(() =>
    appliedQueryKey(filter, sort, projection),
  )
  const [result, setResult] = React.useState<FindResult | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const abortRef = React.useRef<AbortController | null>(null)
  const requestSeqRef = React.useRef(0)

  const load = React.useCallback(
    async (opts?: {
      skip?: number
      limit?: number
      filter?: string
      sort?: string
      projection?: string
    }) => {
      const filterText = opts?.filter ?? filter
      const sortText = opts?.sort ?? sort
      const projectionText = opts?.projection ?? projection
      const nextSkip = opts?.skip ?? skip
      const nextLimit = opts?.limit ?? limit

      let filterObj: unknown
      let sortObj: unknown
      let projectionObj: unknown
      try {
        filterObj = JSON.parse(filterText.trim() || "{}")
        sortObj = sortText.trim() ? JSON.parse(sortText) : undefined
        projectionObj = projectionText.trim() ? JSON.parse(projectionText) : undefined
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("docs.invalidJson"))
        return
      }

      setLoading(true)
      setError(null)
      onBeforeLoad?.()
      // Cancel any request still in flight so a slow earlier query cannot
      // overwrite the results of a newer one.
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      const seq = ++requestSeqRef.current
      try {
        const res = await api.find(
          connectionId,
          database,
          collection,
          {
            filter: filterObj,
            sort: sortObj,
            projection: projectionObj,
            skip: nextSkip,
            limit: nextLimit,
          },
          controller.signal,
        )
        if (seq !== requestSeqRef.current) return
        setResult(res)
        setAppliedQuery(appliedQueryKey(filterText, sortText, projectionText))
        setSkip(res.skip)
        onLoaded?.()
        if (nextSkip === 0 && filterText.trim() && filterText.trim() !== "{}") {
          pushRecent(filterText.trim())
        }
      } catch (err) {
        if (isAbortError(err) || seq !== requestSeqRef.current) return
        setError(err instanceof Error ? err.message : t("docs.queryFailed"))
      } finally {
        if (seq === requestSeqRef.current) setLoading(false)
      }
    },
    [
      connectionId,
      database,
      collection,
      filter,
      sort,
      projection,
      skip,
      limit,
      onBeforeLoad,
      onLoaded,
      pushRecent,
      t,
    ],
  )

  // The view is remounted per collection (see the `key` in CollectionView), so
  // a plain load on mount is enough; the query comes from the URL.
  React.useEffect(() => {
    void load({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, database, collection])

  // Abort any in-flight request when the tab unmounts.
  React.useEffect(() => () => abortRef.current?.abort(), [])

  const cancelLoad = React.useCallback(() => {
    abortRef.current?.abort()
    requestSeqRef.current += 1
    setLoading(false)
    toast.info(t("docs.cancelled"))
  }, [t])

  const filterActive = Boolean(filter.trim() && filter.trim() !== "{}")
  const sortActive =
    Boolean(sort.trim()) && normalizedJSON(sort) !== normalizedJSON(DOCS_QUERY_DEFAULTS.sort)
  const projectionActive = Boolean(projection.trim()) && normalizedJSON(projection) !== "{}"
  const filterError = React.useMemo(() => jsonError(filter), [filter])
  const sortError = React.useMemo(() => jsonError(sort), [sort])
  const projectionError = React.useMemo(() => jsonError(projection), [projection])
  const queryError = filterError ?? sortError ?? projectionError
  const queryDirty = appliedQueryKey(filter, sort, projection) !== appliedQuery

  const clearFilter = React.useCallback(() => {
    setFilter(DOCS_QUERY_DEFAULTS.filter)
    void load({ skip: 0, filter: DOCS_QUERY_DEFAULTS.filter })
  }, [load])

  const clearSort = React.useCallback(() => {
    setSort(DOCS_QUERY_DEFAULTS.sort)
    void load({ skip: 0, sort: DOCS_QUERY_DEFAULTS.sort })
  }, [load])

  const clearProjection = React.useCallback(() => {
    setProjection(DOCS_QUERY_DEFAULTS.projection)
    void load({ skip: 0, projection: DOCS_QUERY_DEFAULTS.projection })
  }, [load])

  const formatQuery = React.useCallback(() => {
    const pretty = (value: string) => {
      const text = value.trim()
      if (!text) return value
      try {
        return JSON.stringify(JSON.parse(text), null, 2)
      } catch {
        return value
      }
    }
    setFilter(pretty)
    setSort(pretty)
    setProjection(pretty)
  }, [])

  // Last signature we rendered; used to tell our own URL writes apart from
  // external ones (browser back/forward).
  const appliedDocsRef = React.useRef(docsQuerySignature(initialDocs))

  // Mirror local query/pagination edits into the URL, debounced so typing does
  // not re-render the app on every keystroke.
  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      const next: DocsQueryState = { filter, sort, projection, limit, skip, pinned, chart }
      appliedDocsRef.current = docsQuerySignature(next)
      onDocsChange?.(next)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [filter, sort, projection, limit, skip, pinned, chart, onDocsChange])

  // Adopt query changes coming from the URL (back/forward) without clobbering
  // the user's in-flight edits.
  React.useEffect(() => {
    const incoming = docsQuerySignature(initialDocs)
    if (incoming === appliedDocsRef.current) return
    appliedDocsRef.current = incoming
    setFilter(initialDocs?.filter ?? DOCS_QUERY_DEFAULTS.filter)
    setSort(initialDocs?.sort ?? DOCS_QUERY_DEFAULTS.sort)
    setProjection(initialDocs?.projection ?? DOCS_QUERY_DEFAULTS.projection)
    setLimit(initialDocs?.limit ?? DOCS_QUERY_DEFAULTS.limit)
    setSkip(initialDocs?.skip ?? DOCS_QUERY_DEFAULTS.skip)
    onPinnedFromURL(initialDocs?.pinned ?? readPinned())
    onChartFromURL?.(initialDocs?.chart)
  }, [initialDocs, onPinnedFromURL, readPinned, onChartFromURL])

  const documents = result?.documents ?? []
  const total = result?.total ?? 0
  const page = Math.floor(skip / limit) + 1
  const pages = Math.max(1, Math.ceil(total / limit))

  return {
    filter,
    setFilter,
    sort,
    setSort,
    projection,
    setProjection,
    limit,
    setLimit,
    skip,
    result,
    setResult,
    documents,
    total,
    loading,
    error,
    page,
    pages,
    filterActive,
    sortActive,
    projectionActive,
    queryError,
    queryDirty,
    load,
    cancelLoad,
    clearFilter,
    clearSort,
    clearProjection,
    formatQuery,
  }
}
