import * as React from "react"
import {
  AlertCircle,
  BarChart3,
  Braces,
  Ban,
  ChevronDown,
  Columns3,
  LineChart,
  ListFilter,
  Maximize2,
  Pin,
  PinOff,
  Play,
  Plus,
  RefreshCw,
  Rows3,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { MongoFilterEditor } from "@/components/mongo-filter-editor"
import { RecentQueries } from "@/components/recent-queries"
import { AsyncProgress } from "@/components/async-progress"
import { ColumnsPicker } from "@/components/documents/columns-picker"
import { DocumentsPagination } from "@/components/documents/documents-pagination"
import { CellContextMenu } from "@/components/documents/cell"
import { DocumentsDialogs, type DeleteConfirm, type EditingState } from "@/components/documents/documents-dialogs"
import { DocumentsResults } from "@/components/documents/documents-results"
import { DocumentsMoreMenu } from "@/components/documents/documents-more-menu"
import { ViewsMenu } from "@/components/documents/views-menu"
import { Label } from "@/components/ui/label"
import { JsonEditor } from "@/components/json-editor"
import { api } from "@/lib/api"
import { useRecentQueries } from "@/hooks/useRecentQueries"
import { useDocumentsQuery } from "@/hooks/useDocumentsQuery"
import { useFrozenColumns } from "@/hooks/useFrozenColumns"
import { togglePinnedQuery, usePinnedQueries } from "@/lib/pinnedQueries"
import {
  COLUMN_MAX_WIDTH,
  COLUMN_MIN_WIDTH,
  DEFAULT_PINNED_COLUMNS,
  columnPrefsKey,
  readColumnPrefs,
  writeColumnPrefs,
  type ColumnPrefs,
  type ColumnRender,
} from "@/lib/columnPrefs"
import { newViewId, readViews, viewsKey, writeViews, type SavedView } from "@/lib/savedViews"
import { toFindJS, toSQL } from "@/lib/queryText"
import { useI18n } from "@/lib/i18n"
import { copyToClipboard } from "@/lib/clipboard"
import { collectColumns, documentId, formatValue, prettyJSON, valueType } from "@/lib/mongo"
import type { ChartShareState, DocsQueryState } from "@/lib/router"
import {
  isTemporalColumn,
  suggestChartConfig,
  toNumeric,
  type ChartConfig,
} from "@/lib/chart"
import { cn } from "@/lib/utils"
import type { ExplainRequest, MongoDocument } from "@/lib/types"

/** Fallback width of the leading row-select column (Tailwind `w-10`). */
const CHECKBOX_COLUMN_WIDTH = 40

const ChartView = React.lazy(() =>
  import("@/components/chart-view").then((module) => ({ default: module.ChartView })),
)

interface DocumentsTabProps {
  connectionId: string
  database: string
  collection: string
  readOnly: boolean
  /** Query/pagination restored from the URL, if present. */
  initialDocs?: DocsQueryState
  /** Persist the current query/pagination so a refresh restores it. */
  onDocsChange?: (docs: DocsQueryState) => void
}



/** A compact, dismissible summary of one active query part. */
function QueryChip({
  label,
  value,
  clearLabel,
  onClear,
}: {
  label: string
  value: string
  clearLabel: string
  onClear: () => void
}) {
  return (
    <span className="bg-muted/60 inline-flex max-w-[26rem] items-center gap-1 rounded-full border py-0.5 pr-0.5 pl-2 text-[11px]">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="truncate font-mono" title={value}>
        {value}
      </span>
      <button
        type="button"
        onClick={onClear}
        aria-label={clearLabel}
        title={clearLabel}
        className="hover:bg-background focus-visible:ring-ring rounded-full p-1 focus-visible:ring-1"
      >
        <X className="size-3" />
      </button>
    </span>
  )
}

export function DocumentsTab({
  connectionId,
  database,
  collection,
  readOnly,
  initialDocs,
  onDocsChange,
}: DocumentsTabProps) {
  const { t } = useI18n()
  const [showOptions, setShowOptions] = React.useState(false)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [editing, setEditing] = React.useState<EditingState | null>(null)
  const [confirm, setConfirm] = React.useState<DeleteConfirm | null>(null)
  const [transfer, setTransfer] = React.useState<"import" | "export" | null>(null)
  const [copyOpen, setCopyOpen] = React.useState(false)
  const [explainOpen, setExplainOpen] = React.useState(false)
  const [dictionaryColumn, setDictionaryColumn] = React.useState<string | null>(null)
  const [liveOpen, setLiveOpen] = React.useState(false)
  const [advisorOpen, setAdvisorOpen] = React.useState(false)
  const [qualityOpen, setQualityOpen] = React.useState(false)
  const [chartOpen, setChartOpen] = React.useState(Boolean(initialDocs?.chart))
  const [chartConfig, setChartConfig] = React.useState<ChartConfig | undefined>(
    initialDocs?.chart?.config,
  )
  const [chartFilter, setChartFilter] = React.useState(
    initialDocs?.chart?.filter ?? initialDocs?.filter ?? "{}",
  )
  const [visualizeOpen, setVisualizeOpen] = React.useState(false)
  const [visualizeConfig, setVisualizeConfig] = React.useState<ChartConfig | undefined>()
  const [selectedColumns, setSelectedColumns] = React.useState<Set<string>>(new Set())
  const [chartPaneWidth, setChartPaneWidth] = React.useState(460)
  const splitRef = React.useRef<HTMLDivElement>(null)
  const [builderOpen, setBuilderOpen] = React.useState(false)
  const [cellMenu, setCellMenu] = React.useState<{
    x: number
    y: number
    row: number
    column: string
  } | null>(null)
  const [valuePreview, setValuePreview] = React.useState<{
    column: string
    value: unknown
  } | null>(null)
  const [activeRow, setActiveRow] = React.useState<number | null>(null)
  const [activeCell, setActiveCell] = React.useState<{ row: number; column: string } | null>(null)
  const [inlineEdit, setInlineEdit] = React.useState<{ row: number; column: string } | null>(null)
  const [inlineBusy, setInlineBusy] = React.useState(false)
  const [allMatching, setAllMatching] = React.useState(false)
  const [updateOpen, setUpdateOpen] = React.useState(false)
  const [updateValue, setUpdateValue] = React.useState('{\n  "$set": {\n    \n  }\n}')
  const prefsKey = columnPrefsKey(connectionId, database, collection)
  const [prefs, setPrefs] = React.useState<ColumnPrefs>(() => {
    const stored = readColumnPrefs(prefsKey)
    return initialDocs?.pinned !== undefined
      ? { ...stored, pinned: initialDocs.pinned }
      : stored
  })
  const viewsStoreKey = viewsKey(connectionId, database, collection)
  const [views, setViews] = React.useState<SavedView[]>(() => readViews(viewsStoreKey))
  const [viewDialogOpen, setViewDialogOpen] = React.useState(false)
  const [viewName, setViewName] = React.useState("")

  const {
    items: recentFilters,
    favorites: favoriteFilters,
    push: pushRecent,
    clear: clearRecent,
    toggleFavorite: toggleFavoriteFilter,
    removeFavorite: removeFavoriteFilter,
  } = useRecentQueries(`docs:${connectionId}:${database}:${collection}`)

  const pinnedQueries = usePinnedQueries()

  const readPinned = React.useCallback(() => readColumnPrefs(prefsKey).pinned, [prefsKey])
  const handlePinnedFromURL = React.useCallback((nextPinned: string[]) => {
    setPrefs((prev) => {
      const same =
        prev.pinned.length === nextPinned.length &&
        prev.pinned.every((column, index) => column === nextPinned[index])
      return same ? prev : { ...prev, pinned: nextPinned }
    })
  }, [])
  const handleBeforeLoad = React.useCallback(() => setInlineEdit(null), [])
  const handleChartFromURL = React.useCallback((next?: ChartShareState) => {
    if (!next) {
      setChartOpen(false)
      setChartConfig(undefined)
      return
    }
    setChartConfig(next.config)
    setChartFilter(next.filter)
    setChartOpen(true)
  }, [])
  const chartShare = React.useMemo<ChartShareState | undefined>(
    () => (chartOpen && chartConfig ? { config: chartConfig, filter: chartFilter } : undefined),
    [chartOpen, chartConfig, chartFilter],
  )
  const handleLoaded = React.useCallback(() => {
    setSelected(new Set())
    setAllMatching(false)
  }, [])

  const {
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
  } = useDocumentsQuery({
    connectionId,
    database,
    collection,
    initialDocs,
    onDocsChange,
    chart: chartShare,
    onChartFromURL: handleChartFromURL,
    pinned: prefs.pinned,
    readPinned,
    onPinnedFromURL: handlePinnedFromURL,
    pushRecent,
    onBeforeLoad: handleBeforeLoad,
    onLoaded: handleLoaded,
  })

  const openChart = React.useCallback(() => {
    setChartFilter(filter)
    setChartConfig(undefined)
    setChartOpen(true)
  }, [filter])

  const pinnedFilter = filter.trim() || "{}"
  const isFilterPinned = React.useMemo(
    () =>
      pinnedQueries.some(
        (query) =>
          query.connectionId === connectionId &&
          query.database === database &&
          query.collection === collection &&
          query.filter === pinnedFilter,
      ),
    [pinnedQueries, connectionId, database, collection, pinnedFilter],
  )

  // Cmd/Ctrl+S saves the current filter/sort/projection as a named view.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return
      if (document.querySelector('[role="dialog"][data-state="open"]')) return
      event.preventDefault()
      setViewName("")
      setViewDialogOpen(true)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  const allColumns = React.useMemo(() => collectColumns(documents), [documents])
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

  // Infer a BSON type per field from the current page so the query builder can
  // offer typed value inputs (ObjectId, date, bool, number).
  const fieldTypes = React.useMemo(() => {
    const types: Record<string, string> = {}
    for (const column of allColumns) {
      for (const doc of documents) {
        const value = doc[column]
        if (value !== null && value !== undefined) {
          types[column] = valueType(value)
          break
        }
      }
    }
    return types
  }, [allColumns, documents])

  const buildVisualizeConfig = React.useCallback(
    (selected: string[]): ChartConfig => {
      const base = suggestChartConfig(documents, allColumns)
      const fields = selected.filter((column) => allColumns.includes(column))
      const temporal = fields.find(
        (column) => isTemporalColumn(documents, column) || fieldTypes[column] === "date",
      )
      const numeric = fields.filter((column) =>
        documents.some((doc) => toNumeric(doc[column]) !== null),
      )
      if (temporal) {
        return {
          ...base,
          type: "line",
          x: temporal,
          y: numeric,
          aggregate: numeric.length > 0 ? "sum" : "count",
          timeBucket: base.timeBucket === "none" ? "auto" : base.timeBucket,
          sort: "asc",
          title: fields.join(", "),
        }
      }
      const categorical = fields.filter(
        (column) => column !== temporal && !numeric.includes(column),
      )
      const x =
        categorical[0] ??
        (base.x && !fields.includes(base.x)
          ? base.x
          : allColumns.find((column) => !fields.includes(column) && column !== "_id") ?? "_id")
      return {
        ...base,
        type: "line",
        x,
        y: numeric,
        aggregate: numeric.length > 0 ? "sum" : "count",
        timeBucket: "none",
        title: fields.join(", "),
      }
    },
    [documents, allColumns, fieldTypes],
  )

  const showVisualization = React.useCallback(
    (columnsToPlot: string[]) => {
      setSelectedColumns(new Set(columnsToPlot))
      setVisualizeConfig(buildVisualizeConfig(columnsToPlot))
      setVisualizeOpen(true)
    },
    [buildVisualizeConfig],
  )

  const handleSelectColumn = React.useCallback(
    (column: string, additive: boolean) => {
      const next = new Set(additive ? selectedColumns : [])
      if (additive && next.has(column)) {
        next.delete(column)
      } else {
        next.add(column)
      }
      setSelectedColumns(next)
      if (next.size > 0) {
        setVisualizeConfig(buildVisualizeConfig([...next]))
        setVisualizeOpen(true)
      }
    },
    [selectedColumns, buildVisualizeConfig],
  )

  const handleVisualizeColumn = React.useCallback(
    (column: string) => showVisualization([column]),
    [showVisualization],
  )

  const openVisualize = React.useCallback(() => {
    if (visualizeOpen) {
      setVisualizeOpen(false)
      return
    }
    if (selectedColumns.size > 0) {
      setVisualizeConfig(buildVisualizeConfig([...selectedColumns]))
    } else if (activeCell?.column) {
      showVisualization([activeCell.column])
      return
    } else {
      setVisualizeConfig({ ...suggestChartConfig(documents, allColumns), type: "line" })
    }
    setVisualizeOpen(true)
  }, [activeCell, allColumns, buildVisualizeConfig, documents, selectedColumns, showVisualization, visualizeOpen])

  const openChartWithCurrent = React.useCallback(() => {
    setChartFilter(filter)
    setChartConfig(visualizeConfig)
    setChartOpen(true)
  }, [filter, visualizeConfig])

  const startChartResize = React.useCallback((event: React.PointerEvent) => {
    event.preventDefault()
    const container = splitRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const move = (next: PointerEvent) => {
      const width = Math.min(rect.width - 280, Math.max(320, rect.right - next.clientX))
      setChartPaneWidth(width)
    }
    const stop = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", stop)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", stop)
  }, [])

  React.useEffect(() => {
    setSelectedColumns((previous) => {
      if (previous.size === 0) return previous
      const next = new Set([...previous].filter((column) => allColumns.includes(column)))
      return next.size === previous.size ? previous : next
    })
  }, [allColumns])

  // Persist column preferences (debounced: widths change on every mousemove).
  React.useEffect(() => {
    const timer = window.setTimeout(() => writeColumnPrefs(prefsKey, prefs), 300)
    return () => window.clearTimeout(timer)
  }, [prefsKey, prefs])

  React.useEffect(() => {
    writeViews(viewsStoreKey, views)
  }, [viewsStoreKey, views])

  // Frozen columns: the hook measures the pinned header widths and hands back
  // the `left` offset for each one. The checkbox gutter is measured too, with
  // this value as the fallback while the table is hidden.
  const frozen = useFrozenColumns(pinnedColumns, CHECKBOX_COLUMN_WIDTH)

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
    }))
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
    const onUp = () => {
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
      document.body.style.userSelect = ""
    }
    document.body.style.userSelect = "none"
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }, [])

  // Close the cell context menu on outside click / Escape.
  React.useEffect(() => {
    if (!cellMenu) return
    const onDown = (event: MouseEvent) => {
      if ((event.target as HTMLElement).closest("[data-cell-menu]")) return
      setCellMenu(null)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCellMenu(null)
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [cellMenu])

  const copyCellMenu = React.useCallback(
    (text: string) => {
      setCellMenu(null)
      void copyToClipboard(text).then((ok) =>
        ok ? toast.success(t("common.copied")) : toast.error(t("common.copyFailed")),
      )
    },
    [t],
  )

  const copyText = React.useCallback(
    (text: string) => {
      void copyToClipboard(text).then((ok) =>
        ok ? toast.success(t("common.copied")) : toast.error(t("common.copyFailed")),
      )
    },
    [t],
  )

  const applyView = React.useCallback(
    (view: SavedView) => {
      setFilter(view.filter)
      setSort(view.sort)
      setProjection(view.projection)
      setLimit(view.limit)
      void load({
        skip: 0,
        filter: view.filter,
        sort: view.sort,
        projection: view.projection,
        limit: view.limit,
      })
    },
    [load],
  )

  const saveView = () => {
    const name = viewName.trim()
    if (!name) return
    setViews((prev) => [
      ...prev,
      {
        id: newViewId(),
        name,
        filter: filter.trim() || "{}",
        sort,
        projection,
        limit,
      },
    ])
    setViewName("")
    setViewDialogOpen(false)
    toast.success(t("views.saved", { name }))
  }

  const deleteView = (id: string) => {
    setViews((prev) => prev.filter((view) => view.id !== id))
  }

  const pinView = (view: SavedView) => {
    togglePinnedQuery({
      connectionId,
      database,
      collection,
      filter: view.filter.trim() || "{}",
    })
  }

  const runBulkUpdate = async () => {
    let updateObj: unknown
    try {
      updateObj = JSON.parse(updateValue.trim() || "{}")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("docs.invalidJson"))
      return
    }
    const ids = Array.from(selected).map((raw) => JSON.parse(raw))
    const filterObj = allMatching
      ? JSON.parse(filter.trim() || "{}")
      : { _id: { $in: ids } }
    // Keep the current page's originals so the update can be undone.
    const originals = allMatching
      ? []
      : documents.filter((doc) => {
          const id = documentId(doc)
          return id !== null && selected.has(id)
        })
    setUpdateOpen(false)
    try {
      const res = await api.update(connectionId, database, collection, {
        filter: filterObj,
        update: updateObj,
        many: true,
      })
      if (originals.length > 0) {
        toast.success(t("docs.updatedMany", { count: res.modifiedCount }), {
          action: { label: t("common.undo"), onClick: () => void restoreUpdates(originals) },
        })
      } else {
        toast.success(t("docs.updatedMany", { count: res.modifiedCount }))
      }
      setSelected(new Set())
      setAllMatching(false)
      await load({ skip: 0 })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("docs.updateFailed"))
    }
  }

  const restoreUpdates = React.useCallback(
    async (docs: MongoDocument[]) => {
      if (docs.length === 0) return
      try {
        for (const doc of docs) {
          await api.update(connectionId, database, collection, {
            filter: { _id: doc._id },
            update: doc,
          })
        }
        toast.success(t("docs.restored", { count: docs.length }))
        await load({})
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("docs.restoreFailed"))
      }
    },
    [connectionId, database, collection, load, t],
  )

  // Reflect the sort JSON in the table headers so columns can be toggled by
  // clicking. Only a single-key sort is represented in the header UI.
  const sortSpec = React.useMemo(() => {
    try {
      const parsed = sort.trim() ? JSON.parse(sort) : null
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const keys = Object.keys(parsed)
        if (keys.length === 1 && (parsed[keys[0]] === 1 || parsed[keys[0]] === -1)) {
          return { column: keys[0], direction: parsed[keys[0]] as 1 | -1 }
        }
      }
    } catch {
      /* ignore invalid JSON while the user is typing */
    }
    return null
  }, [sort])

  const toggleSort = (column: string) => {
    const direction: 1 | -1 =
      sortSpec?.column === column && sortSpec.direction === 1 ? -1 : 1
    const nextSort = JSON.stringify({ [column]: direction })
    setSort(nextSort)
    void load({ skip: 0, sort: nextSort })
  }

  const toggleAll = (checked: boolean) => {
    setAllMatching(false)
    if (!checked) {
      setSelected(new Set())
      return
    }
    const next = new Set<string>()
    for (const doc of documents) {
      const id = documentId(doc)
      if (id) next.add(id)
    }
    setSelected(next)
  }

  const toggleOne = (id: string, checked: boolean) => {
    setAllMatching(false)
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  // The keyboard cursor is a cell, not just a row: j/k move rows, h/l move
  // columns, and Enter edits the focused cell. Kept in sync with activeRow for
  // row highlighting and range selection.
  const focusRow = React.useCallback(
    (index: number | null) => {
      if (index === null || documents.length === 0) {
        setActiveRow(null)
        setActiveCell(null)
        return
      }
      const clamped = Math.max(0, Math.min(index, documents.length - 1))
      setActiveRow(clamped)
      setActiveCell((prev) => {
        const column =
          prev?.column && displayColumns.includes(prev.column)
            ? prev.column
            : displayColumns[0]
        return column ? { row: clamped, column } : null
      })
    },
    [documents.length, displayColumns],
  )

  const moveActiveCell = React.useCallback(
    (rowDelta: number, columnDelta: number) => {
      if (documents.length === 0 || displayColumns.length === 0) return
      setActiveCell((prev) => {
        const baseRow = prev?.row ?? activeRow ?? 0
        const columnIndex = prev ? Math.max(0, displayColumns.indexOf(prev.column)) : 0
        const row = Math.max(0, Math.min(baseRow + rowDelta, documents.length - 1))
        const column = Math.max(
          0,
          Math.min(columnIndex + columnDelta, displayColumns.length - 1),
        )
        return { row, column: displayColumns[column] }
      })
    },
    [activeRow, displayColumns, documents.length],
  )

  React.useEffect(() => {
    if (activeCell) setActiveRow(activeCell.row)
  }, [activeCell])

  // Keep the focused cell visible without moving the whole page.
  React.useEffect(() => {
    if (!activeCell) return
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(
          `[data-row-index="${activeCell.row}"] [data-column="${CSS.escape(activeCell.column)}"]`,
        )
        ?.scrollIntoView({ block: "nearest", inline: "nearest" })
    })
  }, [activeCell])

  // Keyboard shortcuts: j/k move the row cursor, Space selects, e edits,
  // Delete removes the selection and "/" focuses the filter.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey && event.shiftKey && event.code === "KeyF") {
        event.preventDefault()
        formatQuery()
        return
      }
      if (event.altKey && event.shiftKey && event.code === "KeyG") {
        event.preventDefault()
        openChart()
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement
      if (
        target.isContentEditable ||
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        document.querySelector(
          '[role="dialog"][data-state="open"], [role="menu"][data-state="open"], [data-cell-menu]',
        )
      ) {
        return
      }
      switch (event.key) {
        case "/":
          event.preventDefault()
          document
            .querySelector<HTMLTextAreaElement>('[data-testid="mongo-filter-editor"]')
            ?.focus()
          break
        case "j":
          event.preventDefault()
          focusRow(activeRow === null ? 0 : activeRow + 1)
          break
        case "k":
          event.preventDefault()
          focusRow(activeRow === null ? 0 : activeRow - 1)
          break
        case "h":
        case "ArrowLeft":
          if (!activeCell) return
          event.preventDefault()
          moveActiveCell(0, -1)
          break
        case "l":
        case "ArrowRight":
          if (!activeCell) return
          event.preventDefault()
          moveActiveCell(0, 1)
          break
        case "ArrowDown":
          if (!activeCell) return
          event.preventDefault()
          moveActiveCell(1, 0)
          break
        case "ArrowUp":
          if (!activeCell) return
          event.preventDefault()
          moveActiveCell(-1, 0)
          break
        case "Enter": {
          if (!activeCell) return
          const doc = documents[activeCell.row]
          if (!doc) return
          event.preventDefault()
          if (readOnly) {
            setValuePreview({ column: activeCell.column, value: doc[activeCell.column] })
          } else if (activeCell.column !== "_id" && "_id" in doc) {
            setInlineEdit({ row: activeCell.row, column: activeCell.column })
          }
          break
        }
        case "y": {
          if (!activeCell) return
          const doc = documents[activeCell.row]
          if (!doc) return
          event.preventDefault()
          copyText(formatValue(doc[activeCell.column]))
          break
        }
        case "f":
          if (!activeCell) return
          event.preventDefault()
          copyText(activeCell.column)
          break
        case "i": {
          if (!activeCell) return
          const doc = documents[activeCell.row]
          if (!doc || !("_id" in doc)) return
          event.preventDefault()
          copyText(prettyJSON(doc._id))
          break
        }
        case "c": {
          if (!activeCell) return
          const doc = documents[activeCell.row]
          if (!doc) return
          event.preventDefault()
          copyText(prettyJSON({ $set: { [activeCell.column]: doc[activeCell.column] } }))
          break
        }
        case "o": {
          if (!activeCell) return
          const doc = documents[activeCell.row]
          if (!doc) return
          event.preventDefault()
          setValuePreview({ column: activeCell.column, value: doc[activeCell.column] })
          break
        }
        case " ": {
          if (activeRow === null) return
          const doc = documents[activeRow]
          const id = doc ? documentId(doc) : null
          if (!id) return
          event.preventDefault()
          toggleOne(id, !selected.has(id))
          break
        }
        case "e": {
          if (activeRow === null || readOnly) return
          const doc = documents[activeRow]
          if (!doc) return
          event.preventDefault()
          setEditing({ mode: "edit", document: doc })
          break
        }
        case "Delete":
        case "Backspace":
          if (selected.size === 0 || readOnly) return
          event.preventDefault()
          setConfirm({ type: "bulk" })
          break
        case "Escape":
          setActiveRow(null)
          setActiveCell(null)
          break
        default:
          break
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [
    activeCell,
    activeRow,
    copyText,
    documents,
    focusRow,
    formatQuery,
    openChart,
    moveActiveCell,
    readOnly,
    selected,
    toggleOne,
  ])

  // --- drag / box selection ---------------------------------------------------
  // Dragging across rows selects the range between the anchor row and the row
  // under the cursor; Shift extends from the anchor and Cmd/Ctrl adds to the
  // current selection.
  const [dragging, setDragging] = React.useState(false)
  const draggingRef = React.useRef(false)
  const dragAnchorRef = React.useRef<number | null>(null)
  const dragBaseRef = React.useRef<Set<string>>(new Set())
  const dragMovedRef = React.useRef(false)
  const dragHoverRef = React.useRef<number | null>(null)

  const idsInRange = React.useCallback(
    (a: number, b: number) => {
      const lo = Math.min(a, b)
      const hi = Math.max(a, b)
      const ids: string[] = []
      for (let i = lo; i <= hi; i++) {
        const doc = documents[i]
        const id = doc ? documentId(doc) : null
        if (id) ids.push(id)
      }
      return ids
    },
    [documents],
  )

  React.useEffect(() => {
    const onUp = () => {
      if (!draggingRef.current) return
      draggingRef.current = false
      setDragging(false)
    }
    document.addEventListener("mouseup", onUp)
    return () => document.removeEventListener("mouseup", onUp)
  }, [])

  const onRowMouseDown = (index: number, event: React.MouseEvent) => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement
    if (
      target.closest(
        'button, a, input, [role="checkbox"], [data-slot="checkbox"], [role="switch"], [data-slot="switch"], [role="menuitem"]',
      )
    ) {
      return
    }
    const additive = event.metaKey || event.ctrlKey
    const range = event.shiftKey

    // A plain drag keeps the browser's native text selection so text can be
    // selected and copied. Hold Ctrl/Cmd (or Shift) to drag-select rows.
    if (!additive && !range) {
      dragAnchorRef.current = index
      dragBaseRef.current = new Set(selected)
      dragMovedRef.current = false
      return
    }

    event.preventDefault()
    dragMovedRef.current = false
    dragHoverRef.current = index

    if (range && dragAnchorRef.current !== null) {
      setSelected(new Set([...dragBaseRef.current, ...idsInRange(dragAnchorRef.current, index)]))
    } else {
      const base = additive ? new Set(selected) : new Set<string>()
      const id = documents[index] ? documentId(documents[index]) : null
      if (id) base.add(id)
      dragBaseRef.current = base
      dragAnchorRef.current = index
      setSelected(base)
    }
    draggingRef.current = true
    setDragging(true)
  }

  const onRowMouseEnter = (index: number) => {
    if (!draggingRef.current || dragAnchorRef.current === null) return
    if (dragHoverRef.current === index) return
    dragHoverRef.current = index
    dragMovedRef.current = true
    setSelected(new Set([...dragBaseRef.current, ...idsInRange(dragAnchorRef.current, index)]))
  }

  const handleInsert = async (value: unknown) => {
    const docs = Array.isArray(value) ? value : [value]
    const res = await api.insert(connectionId, database, collection, docs as MongoDocument[])
    toast.success(
      t(res.insertedCount === 1 ? "docs.insertedOne" : "docs.insertedMany", {
        count: res.insertedCount,
      }),
    )
    await load({ skip: 0 })
  }

  const handleUpdate = async (value: unknown) => {
    const doc = value as MongoDocument
    if (!editing?.document || !("_id" in editing.document)) {
      throw new Error(t("docs.noId"))
    }
    await api.update(connectionId, database, collection, {
      filter: { _id: editing.document._id },
      update: doc,
    })
    toast.success(t("docs.updated"))
    await load({})
  }

  const canEditCell = (row: number, column: string) => {
    if (readOnly || column === "_id") return false
    const doc = documents[row]
    return Boolean(doc && "_id" in doc)
  }

  const beginInlineEdit = (row: number, column: string) => {
    if (!canEditCell(row, column)) return
    setCellMenu(null)
    setActiveRow(row)
    setActiveCell({ row, column })
    setInlineEdit({ row, column })
  }

  // Only close the editor if the user is still on the cell that was saved;
  // clicking another cell while a save is in flight must not close the new one.
  const closeInlineEdit = (row: number, column: string) => {
    setInlineEdit((current) =>
      current && current.row === row && current.column === column ? null : current,
    )
  }

  const saveInlineEdit = async (
    row: number,
    column: string,
    value: unknown,
  ): Promise<boolean> => {
    const doc = documents[row]
    if (!doc || !("_id" in doc)) {
      toast.error(t("docs.noId"))
      return false
    }
    // No-op edits should just close the editor.
    if (JSON.stringify(doc[column]) === JSON.stringify(value)) {
      closeInlineEdit(row, column)
      return true
    }

    const targetId = documentId(doc)
    setInlineBusy(true)
    try {
      await api.update(connectionId, database, collection, {
        filter: { _id: doc._id },
        update:
          value === undefined
            ? { $unset: { [column]: "" } }
            : { $set: { [column]: value } },
      })
      setResult((prev) => {
        if (!prev) return prev
        const nextDocuments = prev.documents.map((entry, index) => {
          const matches = targetId !== null ? documentId(entry) === targetId : index === row
          if (!matches) return entry
          const next = { ...entry }
          if (value === undefined) delete next[column]
          else next[column] = value
          return next
        })
        return { ...prev, documents: nextDocuments }
      })
      toast.success(t("docs.updated"))
      closeInlineEdit(row, column)
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("docs.updateFailed"))
      return false
    } finally {
      setInlineBusy(false)
    }
  }

  const restoreDocuments = React.useCallback(
    async (docs: MongoDocument[]) => {
      if (docs.length === 0) return
      try {
        await api.insert(connectionId, database, collection, docs)
        toast.success(t("docs.restored", { count: docs.length }))
        await load({})
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("docs.restoreFailed"))
      }
    },
    [connectionId, database, collection, load, t],
  )

  const runConfirm = async () => {
    if (!confirm) return
    try {
      if (confirm.type === "one") {
        const doc = confirm.document
        await api.remove(connectionId, database, collection, {
          filter: { _id: doc._id },
        })
        toast.success(t("docs.deleted"), {
          action: { label: t("common.undo"), onClick: () => void restoreDocuments([doc]) },
        })
      } else if (confirm.type === "bulk") {
        if (allMatching) {
          const parsed = JSON.parse(filter.trim() || "{}")
          const res = await api.remove(connectionId, database, collection, {
            filter: parsed,
            many: true,
          })
          toast.success(t("docs.deletedMany", { count: res.deletedCount }))
        } else {
          const docs = documents.filter((doc) => {
            const id = documentId(doc)
            return id !== null && selected.has(id)
          })
          const ids = Array.from(selected).map((raw) => JSON.parse(raw))
          await api.remove(connectionId, database, collection, {
            filter: { _id: { $in: ids } },
            many: true,
          })
          toast.success(t("docs.deletedMany", { count: ids.length }), {
            action: { label: t("common.undo"), onClick: () => void restoreDocuments(docs) },
          })
        }
      } else {
        const parsed = JSON.parse(filter.trim() || "{}")
        const res = await api.remove(connectionId, database, collection, {
          filter: parsed,
          many: true,
        })
        toast.success(t("docs.deletedMany", { count: res.deletedCount }))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("docs.deleteFailed"))
    } finally {
      await load({ skip: 0 })
    }
  }

  const chartFilterValue = React.useMemo<unknown>(() => {
    try {
      return JSON.parse(filter.trim() || "{}")
    } catch {
      return null
    }
  }, [filter])

  const explainRequest = React.useMemo<Omit<ExplainRequest, "verbosity"> | null>(() => {
    try {
      return {
        type: "find",
        filter: filter.trim() ? JSON.parse(filter) : {},
        sort: sort.trim() ? JSON.parse(sort) : undefined,
        projection: projection.trim() ? JSON.parse(projection) : undefined,
        limit,
      }
    } catch {
      return null
    }
  }, [filter, sort, projection, limit])

  const allSelected = documents.length > 0 && documents.every((doc) => {
    const id = documentId(doc)
    return id !== null && selected.has(id)
  })

  // Seed the bulk-update editor from the focused cell (or the single selected
  // row) so common edits do not start from an empty $set document.
  const openUpdateDialog = () => {
    const selectedDoc =
      selected.size === 1
        ? documents.find((doc) => documentId(doc) === Array.from(selected)[0])
        : undefined
    const seedDoc = activeCell ? documents[activeCell.row] : selectedDoc
    const seedColumn =
      activeCell?.column ??
      (seedDoc ? displayColumns.find((column) => column !== "_id") : undefined)
    setUpdateValue(
      prettyJSON({
        $set: seedDoc && seedColumn ? { [seedColumn]: seedDoc[seedColumn] } : {},
      }),
    )
    setUpdateOpen(true)
  }

  const cellDoc = cellMenu ? documents[cellMenu.row] : undefined
  const cellValue = cellDoc && cellMenu ? cellDoc[cellMenu.column] : undefined

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <div className="shrink-0 space-y-2 border-b p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[12rem] flex-1 basis-full sm:basis-auto">
            <MongoFilterEditor
              value={filter}
              onChange={setFilter}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
                  e.preventDefault()
                  void load({ skip: 0 })
                }
              }}
              placeholder={t("docs.filterPlaceholder")}
              suggestions={allColumns}
            />
          </div>
          {loading ? (
            <Button variant="outline" onClick={cancelLoad} title={t("docs.cancelQuery")}>
              <Ban /> {t("docs.cancelQuery")}
            </Button>
          ) : (
            <Button
              onClick={() => void load({ skip: 0 })}
              disabled={Boolean(queryError)}
              title={queryError ? `${t("docs.invalidJson")}: ${queryError}` : t("docs.runShortcut")}
            >
              <Play /> {t("common.run")}
            </Button>
          )}
          <Button variant="outline" size="icon" onClick={() => void load({})} title={t("common.refresh")} aria-label={t("common.refresh")}>
            <RefreshCw className={cn(loading && "animate-spin")} />
          </Button>
          <Button
            className="ml-auto sm:ml-0"
            onClick={() => setEditing({ mode: "insert" })}
            disabled={readOnly}
            title={readOnly ? t("docs.readonlyTip") : t("docs.insertTitle")}
          >
            <Plus /> {t("docs.insert")}
          </Button>
        </div>

        {queryError ? (
          <p className="text-destructive flex items-start gap-1.5 text-xs" role="alert">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0 break-words">
              {t("docs.invalidJson")}: {queryError}
            </span>
          </p>
        ) : null}

        {/* Secondary query tools, grouped and scrollable on narrow screens. */}
        <div className="scrollbar-thin flex items-center gap-1.5 overflow-x-auto pb-0.5">
          <RecentQueries
            items={recentFilters}
            favorites={favoriteFilters}
            onPick={(query) => {
              setFilter(query)
              void load({ skip: 0, filter: query })
            }}
            onClear={clearRecent}
            onToggleFavorite={toggleFavoriteFilter}
            onRemoveFavorite={removeFavoriteFilter}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-9"
            onClick={() => setBuilderOpen(true)}
            title={t("filter.builder")}
            aria-label={t("filter.builder")}
          >
            <ListFilter />
            <span className="hidden sm:inline">{t("filter.builder")}</span>
          </Button>
          <Button
            variant={isFilterPinned ? "secondary" : "outline"}
            size="sm"
            className="h-9"
            onClick={() =>
              togglePinnedQuery({ connectionId, database, collection, filter: pinnedFilter })
            }
            title={isFilterPinned ? t("filter.unpin") : t("filter.pin")}
            aria-label={isFilterPinned ? t("filter.unpin") : t("filter.pin")}
          >
            {isFilterPinned ? <PinOff /> : <Pin />}
            <span className="hidden sm:inline">
              {isFilterPinned ? t("filter.unpin") : t("filter.pin")}
            </span>
          </Button>
          <ColumnsPicker
            columns={allColumns}
            hidden={prefs.hidden}
            onHiddenChange={(hidden) => setPrefs((prev) => ({ ...prev, hidden }))}
            pinned={prefs.pinned}
            onTogglePinned={toggleColumnPinned}
            onReset={resetColumns}
          />
          <ViewsMenu
            views={views}
            onSaveCurrent={() => {
              setViewName("")
              setViewDialogOpen(true)
            }}
            onApply={applyView}
            onPin={pinView}
            onDelete={deleteView}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-9"
            onClick={formatQuery}
            title={t("docs.formatQuery")}
            aria-label={t("docs.formatQuery")}
          >
            <Braces />
            <span className="hidden lg:inline">{t("docs.format")}</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-9"
            onClick={openVisualize}
            title={visualizeOpen ? t("docs.closeVisualization") : t("chart.open")}
            aria-label={visualizeOpen ? t("docs.closeVisualization") : t("chart.open")}
          >
            <BarChart3 />
            <span className="hidden lg:inline">
              {visualizeOpen ? t("docs.closeVisualization") : t("chart.openShort")}
            </span>
          </Button>
          <div className="bg-border mx-1 h-5 w-px shrink-0" />
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1"
            onClick={() => setShowOptions((prev) => !prev)}
            title={t("docs.sortProjection")}
            aria-label={t("docs.sortProjection")}
          >
            <Rows3 />
            <span className="hidden lg:inline">{t("docs.sortProjection")}</span>
            <ChevronDown className={cn("transition-transform", showOptions && "rotate-180")} />
          </Button>
          <DocumentsMoreMenu
            readOnly={readOnly}
            hasDocuments={documents.length > 0}
            onImport={() => setTransfer("import")}
            onExport={() => setTransfer("export")}
            onExplain={() => {
              if (!explainRequest) {
                toast.error(t("docs.invalidJson"))
                return
              }
              setExplainOpen(true)
            }}
            onCopyCollection={() => setCopyOpen(true)}
            onChart={openChart}
            onCopyMongo={() =>
              copyText(toFindJS(collection, { filter, sort, projection, skip, limit }))
            }
            onCopySql={() =>
              copyText(toSQL(collection, { filter, sort, projection, skip, limit }))
            }
            onLiveTail={() => setLiveOpen(true)}
            onIndexAdvisor={() => setAdvisorOpen(true)}
            onDataQuality={() => setQualityOpen(true)}
          />
        </div>

        {filterActive || sortActive || projectionActive || queryDirty ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {filterActive ? (
              <QueryChip
                label={t("docs.filterChip")}
                value={filter}
                clearLabel={t("docs.clearChip", { name: t("docs.filterChip") })}
                onClear={clearFilter}
              />
            ) : null}
            {sortActive ? (
              <QueryChip
                label={t("docs.sortChip")}
                value={sort}
                clearLabel={t("docs.clearChip", { name: t("docs.sortChip") })}
                onClear={clearSort}
              />
            ) : null}
            {projectionActive ? (
              <QueryChip
                label={t("docs.projectionChip")}
                value={projection}
                clearLabel={t("docs.clearChip", { name: t("docs.projectionChip") })}
                onClear={clearProjection}
              />
            ) : null}
            {queryDirty ? (
              <span
                className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-300"
                title={t("docs.unappliedHint")}
              >
                {t("docs.unapplied")}
              </span>
            ) : null}
          </div>
        ) : null}

        {showOptions ? (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">{t("docs.sort")}</Label>
              <JsonEditor
                value={sort}
                onChange={setSort}
                placeholder='{ "createdAt": -1 }'
                className="min-h-[4rem]"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("docs.projection")}</Label>
              <JsonEditor
                value={projection}
                onChange={setProjection}
                placeholder='{ "name": 1, "email": 1 }'
                className="min-h-[4rem]"
              />
            </div>
          </div>
        ) : null}
        {loading ? <AsyncProgress active label={t("docs.loading")} /> : null}
      </div>

      <div ref={splitRef} className="relative flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {selectedColumns.size > 0 ? (
            <div className="bg-primary/5 flex flex-wrap items-center gap-2 border-b px-3 py-1.5 text-xs">
              <Columns3 className="text-primary size-3.5 shrink-0" />
              <span className="min-w-0 truncate">
                {t("docs.selectedColumns", { count: selectedColumns.size })}
                <span className="text-muted-foreground ml-1 font-mono">
                  {[...selectedColumns].join(", ")}
                </span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-6"
                onClick={() => showVisualization([...selectedColumns])}
              >
                <LineChart /> {t("docs.visualize")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6"
                onClick={() => setSelectedColumns(new Set())}
              >
                {t("docs.clearColumnSelection")}
              </Button>
            </div>
          ) : null}
          <DocumentsResults
            loading={loading}
        error={error}
        total={total}
        documents={documents}
        columns={columns}
        displayColumns={displayColumns}
        prefs={prefs}
        sortSpec={sortSpec}
        pinnedSet={pinnedSet}
        pinnedColumns={pinnedColumns}
        frozen={frozen}
        dragging={dragging}
        selected={selected}
        selectedColumns={selectedColumns}
        allMatching={allMatching}
        allSelected={allSelected}
        filterActive={filterActive}
        readOnly={readOnly}
        activeRow={activeRow}
        activeCell={activeCell}
        inlineEdit={inlineEdit}
        inlineBusy={inlineBusy}
        copyText={copyText}
        load={load}
        clearFilter={clearFilter}
        setEditing={setEditing}
        setTransfer={setTransfer}
        setInlineEdit={setInlineEdit}
        setValuePreview={setValuePreview}
        setSelected={setSelected}
        setAllMatching={setAllMatching}
        setCellMenu={setCellMenu}
        setConfirm={setConfirm}
        setSort={setSort}
        setDictionaryColumn={setDictionaryColumn}
        setColumnRenderer={setColumnRenderer}
        setActiveCell={setActiveCell}
        toggleOne={toggleOne}
        toggleAll={toggleAll}
        toggleSort={toggleSort}
        startResize={startResize}
        moveColumn={moveColumn}
        toggleColumnPinned={toggleColumnPinned}
        setColumnHidden={setColumnHidden}
        onSelectColumn={handleSelectColumn}
        onVisualizeColumn={handleVisualizeColumn}
        showOnlyColumn={showOnlyColumn}
        resetColumns={resetColumns}
        copyToClipboard={copyToClipboard}
        beginInlineEdit={beginInlineEdit}
        saveInlineEdit={saveInlineEdit}
        canEditCell={canEditCell}
        onRowMouseDown={onRowMouseDown}
        onRowMouseEnter={onRowMouseEnter}
        idsInRange={idsInRange}
        dragMovedRef={dragMovedRef}
        dragAnchorRef={dragAnchorRef}
        dragHoverRef={dragHoverRef}
        draggingRef={draggingRef}
        dragBaseRef={dragBaseRef}
        openUpdateDialog={openUpdateDialog}
      />

      {/* Pagination */}
      <DocumentsPagination
        total={total}
        skip={skip}
        limit={limit}
        durationMs={result?.durationMs}
        page={page}
        pages={pages}
        loading={loading}
        readOnly={readOnly}
        onLimitChange={(nextLimit) => {
          setLimit(nextLimit)
          void load({ skip: 0, limit: nextLimit })
        }}
        onPrev={() => void load({ skip: Math.max(0, skip - limit) })}
        onNext={() => void load({ skip: skip + limit })}
        onGoToPage={(next) => void load({ skip: Math.max(0, (next - 1) * limit) })}
        onDeleteMatching={() => setConfirm({ type: "filter" })}
      />
        </div>

        {visualizeOpen ? (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              title={t("docs.dragToResize")}
              onPointerDown={startChartResize}
              className="bg-border hover:bg-primary/40 hidden w-1 shrink-0 cursor-col-resize lg:block"
            />
            <aside
              className="bg-background absolute inset-0 z-30 flex w-full flex-col border-l lg:static lg:z-auto lg:w-[var(--chart-pane-width)] lg:min-w-[320px] lg:max-w-[70%]"
              style={{ "--chart-pane-width": `${chartPaneWidth}px` } as React.CSSProperties}
            >
              <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
                <BarChart3 className="text-primary size-4 shrink-0" />
                <span className="text-sm font-medium">{t("docs.visualization")}</span>
                <span className="text-muted-foreground min-w-0 truncate text-[11px]">
                  {[...selectedColumns].join(", ")}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="ml-auto"
                  onClick={openChartWithCurrent}
                  title={t("docs.openChartDialog")}
                  aria-label={t("docs.openChartDialog")}
                >
                  <Maximize2 />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setVisualizeOpen(false)}
                  title={t("docs.closeVisualization")}
                  aria-label={t("docs.closeVisualization")}
                >
                  <X />
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-2">
                <React.Suspense
                  fallback={
                    <p className="text-muted-foreground p-4 text-xs">{t("common.loading")}</p>
                  }
                >
                  <ChartView
                    documents={documents}
                    columns={allColumns}
                    fieldTypes={fieldTypes}
                    connectionId={connectionId}
                    database={database}
                    collection={collection}
                    filter={chartFilterValue ?? {}}
                    filterValid={chartFilterValue !== null}
                    initialConfig={visualizeConfig}
                    onConfigChange={setVisualizeConfig}
                    scope={`${connectionId}::${database}::${collection}`}
                    storageKey={`docs:${connectionId}:${database}:${collection}`}
                    currentFilter={filter}
                    height={520}
                  />
                </React.Suspense>
              </div>
            </aside>
          </>
        ) : null}
      </div>

      {cellMenu && cellDoc ? (
        <CellContextMenu
          x={cellMenu.x}
          y={cellMenu.y}
          column={cellMenu.column}
          value={cellValue}
          document={cellDoc}
          onCopy={copyCellMenu}
          onEdit={
            canEditCell(cellMenu.row, cellMenu.column)
              ? () => beginInlineEdit(cellMenu.row, cellMenu.column)
              : undefined
          }
        />
      ) : null}

      <DocumentsDialogs
        connectionId={connectionId}
        database={database}
        collection={collection}
        filter={filter}
        sort={sort}
        projection={projection}
        onReload={() => void load({ skip: 0 })}
        valuePreview={valuePreview}
        onValuePreviewChange={setValuePreview}
        dictionaryColumn={dictionaryColumn}
        dictionaryEntries={dictionaryColumn ? prefs.dictionaries[dictionaryColumn] ?? [] : []}
        onDictionaryOpenChange={(open) => !open && setDictionaryColumn(null)}
        onDictionarySave={(entries) => {
          if (!dictionaryColumn) return
          setPrefs((prev) => {
            const dictionaries = { ...prev.dictionaries }
            const renderers = { ...prev.renderers }
            if (entries.length > 0) {
              dictionaries[dictionaryColumn] = entries
              renderers[dictionaryColumn] = "dictionary"
            } else {
              delete dictionaries[dictionaryColumn]
              if (renderers[dictionaryColumn] === "dictionary") {
                delete renderers[dictionaryColumn]
              }
            }
            return { ...prev, dictionaries, renderers }
          })
        }}
        viewOpen={viewDialogOpen}
        onViewOpenChange={setViewDialogOpen}
        viewName={viewName}
        onViewNameChange={setViewName}
        onSaveView={saveView}
        updateOpen={updateOpen}
        onUpdateOpenChange={setUpdateOpen}
        updateValue={updateValue}
        onUpdateValueChange={setUpdateValue}
        onRunBulkUpdate={() => void runBulkUpdate()}
        allMatching={allMatching}
        total={total}
        selectedCount={selected.size}
        editing={editing}
        onEditingChange={setEditing}
        onInsert={handleInsert}
        onUpdate={handleUpdate}
        confirm={confirm}
        onConfirmOpenChange={(open) => !open && setConfirm(null)}
        onConfirm={() => void runConfirm()}
        transfer={transfer}
        onTransferChange={setTransfer}
        explainOpen={explainOpen}
        onExplainOpenChange={setExplainOpen}
        explainRequest={explainRequest}
        copyOpen={copyOpen}
        onCopyOpenChange={setCopyOpen}
        liveOpen={liveOpen}
        onLiveOpenChange={setLiveOpen}
        advisorOpen={advisorOpen}
        onAdvisorOpenChange={setAdvisorOpen}
        qualityOpen={qualityOpen}
        onQualityOpenChange={setQualityOpen}
        chartOpen={chartOpen}
        onChartOpenChange={(open) => {
          setChartOpen(open)
          if (!open) setChartConfig(undefined)
        }}
        chartConfig={chartConfig}
        chartFilter={chartFilter}
        onChartConfigChange={setChartConfig}
        onChartFilterChange={setChartFilter}
        documents={documents}
        columns={allColumns}
        builderOpen={builderOpen}
        onBuilderOpenChange={setBuilderOpen}
        fieldTypes={fieldTypes}
        onApplyBuilder={(nextFilter, nextProjection) => {
          setFilter(nextFilter)
          setProjection(nextProjection)
          void load({ skip: 0, filter: nextFilter, projection: nextProjection })
        }}
        onApplyChartFilter={(nextFilter) => {
          setFilter(nextFilter)
          setChartOpen(false)
          setChartConfig(undefined)
          void load({ skip: 0, filter: nextFilter })
        }}
      />
    </div>
  )
}
