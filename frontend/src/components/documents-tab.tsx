import * as React from "react"
import {
  Activity,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  BarChart3,
  Bookmark,
  BookmarkPlus,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Copy,
  Download,
  Ellipsis,
  Loader2,
  ListFilter,
  Pencil,
  Pin,
  PinOff,
  Play,
  Plus,
  RefreshCw,
  Rows3,
  Trash2,
  Upload,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ChartDialog } from "@/components/chart-dialog"
import { ConfirmDialog } from "@/components/confirm-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { CopyCollectionDialog } from "@/components/copy-collection-dialog"
import { DocumentDialog } from "@/components/document-dialog"
import { ExportDialog, ImportDialog } from "@/components/data-transfer-dialog"
import { ExplainDialog } from "@/components/explain-dialog"
import { MongoFilterEditor } from "@/components/mongo-filter-editor"
import { MongoQueryBuilder } from "@/components/mongo-query-builder"
import { RecentQueries } from "@/components/recent-queries"
import { Label } from "@/components/ui/label"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { JsonEditor } from "@/components/json-editor"
import { api } from "@/lib/api"
import { useRecentQueries } from "@/hooks/useRecentQueries"
import { togglePinnedQuery, usePinnedQueries } from "@/lib/pinnedQueries"
import {
  COLUMN_MAX_WIDTH,
  COLUMN_MIN_WIDTH,
  columnPrefsKey,
  readColumnPrefs,
  writeColumnPrefs,
  type ColumnPrefs,
} from "@/lib/columnPrefs"
import { newViewId, readViews, viewsKey, writeViews, type SavedView } from "@/lib/savedViews"
import { useI18n } from "@/lib/i18n"
import { copyToClipboard } from "@/lib/clipboard"
import { classForType, collectColumns, documentId, formatValue, prettyJSON, valueType } from "@/lib/mongo"
import { DOCS_QUERY_DEFAULTS, type DocsQueryState } from "@/lib/router"
import { cn } from "@/lib/utils"
import type { ExplainRequest, FindResult, MongoDocument } from "@/lib/types"

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

interface EditingState {
  mode: "insert" | "edit"
  document?: MongoDocument
}

function CellValue({ value }: { value: unknown }) {
  const type = valueType(value)
  const text = formatValue(value)
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground font-mono text-xs italic">null</span>
  }
  const display = text.length > 90 ? `${text.slice(0, 90)}…` : text
  return (
    <span className={cn("font-mono text-xs", classForType(type))} title={text}>
      {display}
    </span>
  )
}

/** Compact, allocation-light signature used to detect external URL changes. */
function docsQuerySignature(docs?: DocsQueryState): string {
  const value = docs ?? DOCS_QUERY_DEFAULTS
  return `${value.filter}\u0000${value.sort}\u0000${value.projection}\u0000${value.limit}\u0000${value.skip}`
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
  const [filter, setFilter] = React.useState(initialDocs?.filter ?? DOCS_QUERY_DEFAULTS.filter)
  const [sort, setSort] = React.useState(initialDocs?.sort ?? DOCS_QUERY_DEFAULTS.sort)
  const [projection, setProjection] = React.useState(
    initialDocs?.projection ?? DOCS_QUERY_DEFAULTS.projection,
  )
  const [limit, setLimit] = React.useState(initialDocs?.limit ?? DOCS_QUERY_DEFAULTS.limit)
  const [skip, setSkip] = React.useState(initialDocs?.skip ?? DOCS_QUERY_DEFAULTS.skip)
  const [showOptions, setShowOptions] = React.useState(false)
  const [result, setResult] = React.useState<FindResult | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [editing, setEditing] = React.useState<EditingState | null>(null)
  const [confirm, setConfirm] = React.useState<
    | { type: "one"; document: MongoDocument }
    | { type: "bulk" }
    | { type: "filter" }
    | null
  >(null)
  const [transfer, setTransfer] = React.useState<"import" | "export" | null>(null)
  const [copyOpen, setCopyOpen] = React.useState(false)
  const [explainOpen, setExplainOpen] = React.useState(false)
  const [chartOpen, setChartOpen] = React.useState(false)
  const [builderOpen, setBuilderOpen] = React.useState(false)
  const [cellMenu, setCellMenu] = React.useState<{
    x: number
    y: number
    row: number
    column: string
  } | null>(null)
  const [activeRow, setActiveRow] = React.useState<number | null>(null)
  const prefsKey = columnPrefsKey(connectionId, database, collection)
  const [prefs, setPrefs] = React.useState<ColumnPrefs>(() => readColumnPrefs(prefsKey))
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
      try {
        const res = await api.find(connectionId, database, collection, {
          filter: filterObj,
          sort: sortObj,
          projection: projectionObj,
          skip: nextSkip,
          limit: nextLimit,
        })
        setResult(res)
        setSkip(res.skip)
        setSelected(new Set())
        if (nextSkip === 0 && filterText.trim() && filterText.trim() !== "{}") {
          pushRecent(filterText.trim())
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("docs.queryFailed"))
      } finally {
        setLoading(false)
      }
    },
    [connectionId, database, collection, filter, sort, projection, skip, limit, pushRecent],
  )

  // The component is remounted per collection (see the `key` in CollectionView),
  // so a plain load on mount is enough; the query comes from the URL.
  React.useEffect(() => {
    void load({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, database, collection])

  // Last query signature we rendered; used to tell our own URL writes apart
  // from external ones (browser back/forward).
  const appliedDocsRef = React.useRef(docsQuerySignature(initialDocs))

  // Mirror local query/pagination edits into the URL, debounced so typing does
  // not re-render the app on every keystroke. The timeout is always cleared on
  // cleanup to avoid leaks.
  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      const next: DocsQueryState = { filter, sort, projection, limit, skip }
      appliedDocsRef.current = docsQuerySignature(next)
      onDocsChange?.(next)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [filter, sort, projection, limit, skip, onDocsChange])

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
  }, [initialDocs])

  const documents = result?.documents ?? []
  const allColumns = React.useMemo(() => collectColumns(documents), [documents])
  const hiddenSet = React.useMemo(() => new Set(prefs.hidden), [prefs.hidden])
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

  // Persist column preferences (debounced: widths change on every mousemove).
  React.useEffect(() => {
    const timer = window.setTimeout(() => writeColumnPrefs(prefsKey, prefs), 300)
    return () => window.clearTimeout(timer)
  }, [prefsKey, prefs])

  React.useEffect(() => {
    writeViews(viewsStoreKey, views)
  }, [viewsStoreKey, views])

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
    setPrefs({ order: [], hidden: [], widths: {} })
  }, [])

  const moveColumn = React.useCallback(
    (column: string, direction: -1 | 1) => {
      setPrefs((prev) => {
        const current = columns.slice()
        const index = current.indexOf(column)
        const target = index + direction
        if (index < 0 || target < 0 || target >= current.length) return prev
        ;[current[index], current[target]] = [current[target], current[index]]
        const rest = allColumns.filter((candidate) => !current.includes(candidate))
        return { ...prev, order: [...current, ...rest] }
      })
    },
    [columns, allColumns],
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
    let direction: 1 | -1 | null = 1
    if (sortSpec?.column === column) {
      direction = sortSpec.direction === 1 ? -1 : null
    }
    const nextSort = direction ? JSON.stringify({ [column]: direction }) : ""
    setSort(nextSort)
    void load({ skip: 0, sort: nextSort })
  }
  const total = result?.total ?? 0
  const page = Math.floor(skip / limit) + 1
  const pages = Math.max(1, Math.ceil(total / limit))

  const toggleAll = (checked: boolean) => {
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
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const focusRow = React.useCallback(
    (index: number | null) => {
      if (index === null || documents.length === 0) {
        setActiveRow(null)
        return
      }
      const clamped = Math.max(0, Math.min(index, documents.length - 1))
      setActiveRow(clamped)
      requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>(`[data-row-index="${clamped}"]`)
          ?.scrollIntoView({ block: "nearest" })
      })
    },
    [documents.length],
  )

  // Keyboard shortcuts: j/k move the row cursor, Space selects, e edits,
  // Delete removes the selection and "/" focuses the filter.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
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
          break
        default:
          break
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [activeRow, documents, selected, readOnly, focusRow, toggleOne])

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
        'button, a, input, [role="checkbox"], [data-slot="checkbox"], [role="menuitem"]',
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
    if (confirm.type === "one") {
      const doc = confirm.document
      await api.remove(connectionId, database, collection, {
        filter: { _id: doc._id },
      })
      toast.success(t("docs.deleted"), {
        action: { label: t("common.undo"), onClick: () => void restoreDocuments([doc]) },
      })
    } else if (confirm.type === "bulk") {
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
    } else {
      const parsed = JSON.parse(filter.trim() || "{}")
      const res = await api.remove(connectionId, database, collection, {
        filter: parsed,
        many: true,
      })
      toast.success(t("docs.deletedMany", { count: res.deletedCount }))
    }
    await load({ skip: 0 })
  }

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

  const cellDoc = cellMenu ? documents[cellMenu.row] : undefined
  const cellValue = cellDoc && cellMenu ? cellDoc[cellMenu.column] : undefined

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <div className="shrink-0 space-y-2 border-b p-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <MongoFilterEditor
              value={filter}
              onChange={setFilter}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  void load({ skip: 0 })
                }
              }}
              placeholder={t("docs.filterPlaceholder")}
              suggestions={allColumns}
            />
          </div>
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
            size="icon"
            onClick={() => setBuilderOpen(true)}
            title={t("filter.builder")}
            aria-label={t("filter.builder")}
          >
            <ListFilter />
          </Button>
          <Button
            variant={isFilterPinned ? "secondary" : "outline"}
            size="icon"
            onClick={() =>
              togglePinnedQuery({ connectionId, database, collection, filter: pinnedFilter })
            }
            title={isFilterPinned ? t("filter.unpin") : t("filter.pin")}
            aria-label={isFilterPinned ? t("filter.unpin") : t("filter.pin")}
          >
            {isFilterPinned ? <PinOff /> : <Pin />}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                title={t("docs.columns")}
                aria-label={t("docs.columns")}
              >
                <Columns3 />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-72 w-56 overflow-auto">
              <div className="flex items-center justify-between px-2 py-1">
                <span className="text-xs font-medium">{t("docs.columns")}</span>
                <button
                  type="button"
                  onClick={resetColumns}
                  className="text-muted-foreground hover:text-foreground text-[11px]"
                >
                  {t("docs.resetColumns")}
                </button>
              </div>
              <DropdownMenuSeparator />
              {allColumns.map((column) => (
                <DropdownMenuCheckboxItem
                  key={column}
                  checked={!hiddenSet.has(column)}
                  onCheckedChange={(checked) => setColumnHidden(column, checked !== true)}
                  onSelect={(event) => event.preventDefault()}
                  className="font-mono text-xs"
                >
                  <span className="truncate">{column}</span>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                title={t("views.title")}
                aria-label={t("views.title")}
              >
                <Bookmark />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuItem
                onSelect={() => {
                  setViewName("")
                  setViewDialogOpen(true)
                }}
              >
                <BookmarkPlus /> {t("views.saveCurrent")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {views.length === 0 ? (
                <DropdownMenuItem disabled>{t("views.empty")}</DropdownMenuItem>
              ) : null}
              {views.map((view) => (
                <DropdownMenuItem
                  key={view.id}
                  onSelect={() => applyView(view)}
                  className="font-mono text-xs"
                >
                  <Bookmark className="size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate" title={`${view.name}\n${view.filter}`}>
                    {view.name}
                  </span>
                  <button
                    type="button"
                    aria-label={t("views.pin")}
                    title={t("views.pin")}
                    className="text-muted-foreground hover:text-foreground shrink-0 rounded p-0.5"
                    onPointerDown={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation()
                      event.preventDefault()
                      pinView(view)
                    }}
                  >
                    <Pin className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={t("common.delete")}
                    title={t("common.delete")}
                    className="text-muted-foreground hover:text-foreground shrink-0 rounded p-0.5"
                    onPointerDown={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation()
                      event.preventDefault()
                      deleteView(view.id)
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={() => void load({ skip: 0 })} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <Play />}
            {t("common.run")}
          </Button>
          <Button variant="outline" size="icon" onClick={() => void load({})} title={t("common.refresh")}>
            <RefreshCw className={cn(loading && "animate-spin")} />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setShowOptions((prev) => !prev)}
            title={t("docs.sortProjection")}
          >
            <Rows3 />
            <ChevronDown className={cn("transition-transform", showOptions && "rotate-180")} />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" title={t("docs.more")}>
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem disabled={readOnly} onSelect={() => setTransfer("import")}>
                <Upload /> {t("transfer.importAction")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setTransfer("export")}>
                <Download /> {t("transfer.exportAction")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  if (!explainRequest) {
                    toast.error(t("docs.invalidJson"))
                    return
                  }
                  setExplainOpen(true)
                }}
              >
                <Activity /> {t("explain.title")}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={readOnly} onSelect={() => setCopyOpen(true)}>
                <Copy /> {t("copy.action")}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={documents.length === 0}
                onSelect={() => setChartOpen(true)}
              >
                <BarChart3 /> {t("chart.open")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            onClick={() => setEditing({ mode: "insert" })}
            disabled={readOnly}
            title={readOnly ? t("docs.readonlyTip") : t("docs.insertTitle")}
          >
            <Plus /> {t("docs.insert")}
          </Button>
        </div>

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
      </div>

      {/* Table */}
      <div className="relative min-h-0 flex-1">
        <div className={cn("scrollbar-thin h-full overflow-auto", dragging && "select-none")}>
        <Table>
          <TableHeader className="bg-background sticky top-0 z-10">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={(checked) => toggleAll(checked === true)}
                  aria-label="Select all"
                />
              </TableHead>
              {columns.map((column) => {
                const direction = sortSpec?.column === column ? sortSpec.direction : undefined
                const width = prefs.widths[column]
                return (
                  <TableHead
                    key={column}
                    className="group relative font-mono text-xs"
                    style={width ? { width, minWidth: width, maxWidth: width } : undefined}
                  >
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => toggleSort(column)}
                        title={
                          direction
                            ? direction === 1
                              ? t("docs.sortedAsc")
                              : t("docs.sortedDesc")
                            : t("docs.sortBy", { column })
                        }
                        className="hover:text-foreground flex min-w-0 flex-1 items-center gap-1 rounded"
                      >
                        <span className="truncate">{column}</span>
                        {direction === 1 ? (
                          <ArrowUp className="size-3 shrink-0" />
                        ) : direction === -1 ? (
                          <ArrowDown className="size-3 shrink-0" />
                        ) : (
                          <ArrowUpDown className="size-3 shrink-0 opacity-0 group-hover:opacity-60" />
                        )}
                      </button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            title={t("docs.columnActions")}
                            aria-label={t("docs.columnActions")}
                            className="text-muted-foreground hover:text-foreground shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
                          >
                            <ChevronDown className="size-3" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-52">
                          <DropdownMenuItem onSelect={() => toggleSort(column)}>
                            {direction ? t("docs.clearSort") : t("docs.sortAsc")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() =>
                              void copyToClipboard(column).then((ok) =>
                                ok
                                  ? toast.success(t("common.copied"))
                                  : toast.error(t("common.copyFailed")),
                              )
                            }
                          >
                            <Copy /> {t("docs.copyField")}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onSelect={() => moveColumn(column, -1)}>
                            <ArrowLeft /> {t("docs.moveLeft")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => moveColumn(column, 1)}>
                            <ArrowRight /> {t("docs.moveRight")}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onSelect={() => setColumnHidden(column, true)}>
                            {t("docs.hideColumn")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => showOnlyColumn(column)}>
                            {t("docs.showOnly")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={resetColumns}>
                            {t("docs.resetColumns")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div
                      role="separator"
                      aria-orientation="vertical"
                      onMouseDown={(event) => startResize(column, event)}
                      className="hover:bg-primary/40 absolute inset-y-0 right-0 w-1 cursor-col-resize"
                    />
                  </TableHead>
                )
              })}
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody
            onContextMenu={(event) => {
              const td = (event.target as HTMLElement).closest("td[data-column]")
              const tr = (event.target as HTMLElement).closest("tr[data-row-index]")
              const column = td?.getAttribute("data-column")
              const raw = tr?.getAttribute("data-row-index")
              if (!column || raw === null || raw === undefined) return
              event.preventDefault()
              setCellMenu({ x: event.clientX, y: event.clientY, row: Number(raw), column })
            }}
            onMouseMove={(event) => {
              const tr = (event.target as HTMLElement).closest("tr")
              const raw = tr?.getAttribute("data-row-index")
              if (raw !== null && raw !== undefined) onRowMouseEnter(Number(raw))
            }}
            onMouseUp={(event) => {
              // Finalize on the row under the pointer: the last mousemove before
              // mouseup can be coalesced, which would drop the end row.
              if (!draggingRef.current || dragAnchorRef.current === null) return
              const tr = (event.target as HTMLElement).closest("tr")
              const raw = tr?.getAttribute("data-row-index")
              if (raw === null || raw === undefined) return
              const idx = Number(raw)
              dragHoverRef.current = idx
              setSelected(
                new Set([...dragBaseRef.current, ...idsInRange(dragAnchorRef.current, idx)]),
              )
            }}
          >
            {loading && documents.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length + 2} className="h-32 text-center">
                  <Loader2 className="text-muted-foreground mx-auto size-5 animate-spin" />
                </TableCell>
              </TableRow>
            ) : null}
            {!loading && documents.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length + 2}
                  className="text-muted-foreground h-32 text-center text-sm"
                >
                  No documents match this query.
                </TableCell>
              </TableRow>
            ) : null}
            {documents.map((doc, index) => {
              const id = documentId(doc)
              const isSelected = id !== null && selected.has(id)
              return (
                <TableRow
                  key={id ?? index}
                  data-row-index={index}
                  data-state={isSelected ? "selected" : undefined}
                  className={cn(activeRow === index && "bg-accent/40 hover:bg-accent/40")}
                  onMouseDown={(event) => onRowMouseDown(index, event)}
                  onDoubleClick={() => {
                    if (dragMovedRef.current) {
                      dragMovedRef.current = false
                      return
                    }
                    if (!readOnly) setEditing({ mode: "edit", document: doc })
                  }}
                >
                  <TableCell>
                    <Checkbox
                      checked={isSelected}
                      disabled={id === null}
                      onCheckedChange={(checked) => id && toggleOne(id, checked === true)}
                      aria-label="Select row"
                    />
                  </TableCell>
                  {columns.map((column) => (
                    <TableCell
                      key={column}
                      data-column={column}
                      className="max-w-[320px] truncate"
                      style={
                        prefs.widths[column]
                          ? {
                              width: prefs.widths[column],
                              minWidth: prefs.widths[column],
                              maxWidth: prefs.widths[column],
                            }
                          : undefined
                      }
                    >
                      <CellValue value={doc[column]} />
                    </TableCell>
                  ))}
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm">
                          <Rows3 />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem
                          disabled={readOnly}
                          onSelect={() => setEditing({ mode: "edit", document: doc })}
                        >
                          <Pencil /> Edit document
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => {
                            void copyToClipboard(prettyJSON(doc)).then((ok) =>
                              ok
                                ? toast.success(t("docs.copyOk"))
                                : toast.error(t("common.copyFailed")),
                            )
                          }}
                        >
                          <Copy /> Copy JSON
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={readOnly || !id}
                          onSelect={() => setConfirm({ type: "one", document: doc })}
                        >
                          <Trash2 /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        </div>

        {selected.size > 0 ? (
          <div className="bg-background/95 absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border px-3 py-1.5 text-sm whitespace-nowrap shadow-lg backdrop-blur">
            <span className="text-muted-foreground">{t("docs.selected", { count: selected.size })}</span>
            <Button
              variant="destructive"
              size="sm"
              disabled={readOnly}
              onClick={() => setConfirm({ type: "bulk" })}
            >
              <Trash2 /> {t("docs.deleteSelected")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              {t("docs.clear")}
            </Button>
          </div>
        ) : null}
      </div>

      {/* Pagination */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-t px-3 py-2 text-sm">
        <span className="text-muted-foreground">
          {total === 0 ? "0" : `${skip + 1}–${Math.min(skip + limit, total)}`} of {total}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">Rows</span>
          <Select
            value={String(limit)}
            onValueChange={(value) => {
              const nextLimit = Number(value)
              setLimit(nextLimit)
              void load({ skip: 0, limit: nextLimit })
            }}
          >
            <SelectTrigger size="sm" className="w-[72px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[25, 50, 100, 250].map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            disabled={skip <= 0 || loading}
            onClick={() => void load({ skip: Math.max(0, skip - limit) })}
          >
            <ChevronLeft />
          </Button>
          <span className="text-muted-foreground px-2 text-xs">
            {t("docs.page", { page, pages })}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            disabled={skip + limit >= total || loading}
            onClick={() => void load({ skip: skip + limit })}
          >
            <ChevronRight />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" disabled={readOnly}>
                <Trash2 />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setConfirm({ type: "filter" })}
              >
                <Trash2 /> {t("docs.deleteMatching")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {cellMenu && cellDoc ? (
        <div
          data-cell-menu
          style={{ top: cellMenu.y, left: cellMenu.x }}
          className="bg-popover text-popover-foreground fixed z-50 min-w-44 rounded-md border p-1 shadow-md"
        >
          <button
            type="button"
            onClick={() => copyCellMenu(formatValue(cellValue))}
            className="hover:bg-accent/50 flex w-full items-center rounded px-2 py-1.5 text-left text-sm"
          >
            {t("docs.copyValue")}
          </button>
          <button
            type="button"
            onClick={() => copyCellMenu(JSON.stringify(cellValue, null, 2))}
            className="hover:bg-accent/50 flex w-full items-center rounded px-2 py-1.5 text-left text-sm"
          >
            {t("docs.copyValueJson")}
          </button>
          <button
            type="button"
            onClick={() => copyCellMenu(cellMenu.column)}
            className="hover:bg-accent/50 flex w-full items-center rounded px-2 py-1.5 text-left text-sm"
          >
            {t("docs.copyField")}
          </button>
          <div className="bg-border -mx-1 my-1 h-px" />
          {"_id" in cellDoc ? (
            <button
              type="button"
              onClick={() => copyCellMenu(prettyJSON(cellDoc._id))}
              className="hover:bg-accent/50 flex w-full items-center rounded px-2 py-1.5 text-left text-sm"
            >
              {t("docs.copyId")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => copyCellMenu(prettyJSON(cellDoc))}
            className="hover:bg-accent/50 flex w-full items-center rounded px-2 py-1.5 text-left text-sm"
          >
            {t("docs.copyDocument")}
          </button>
          <div className="bg-border -mx-1 my-1 h-px" />
          <button
            type="button"
            onClick={() => copyCellMenu(prettyJSON({ $set: { [cellMenu.column]: cellValue } }))}
            className="hover:bg-accent/50 flex w-full items-center rounded px-2 py-1.5 text-left text-sm"
          >
            {t("docs.copyAsSet")}
          </button>
        </div>
      ) : null}

      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("views.saveCurrent")}</DialogTitle>
            <DialogDescription>{t("views.saveDesc")}</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={viewName}
            onChange={(event) => setViewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                saveView()
              }
            }}
            placeholder={t("views.namePlaceholder")}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={saveView} disabled={!viewName.trim()}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DocumentDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing?.mode === "edit" ? t("docs.editTitle") : t("docs.insertTitle")}
        description={editing?.mode === "edit" ? t("docs.editDesc") : t("docs.insertDesc")}
        initialValue={
          editing?.mode === "edit" && editing.document ? prettyJSON(editing.document) : "{\n  \n}"
        }
        submitLabel={editing?.mode === "edit" ? t("docs.saveChanges") : t("docs.insertAction")}
        onSubmit={editing?.mode === "edit" ? handleUpdate : handleInsert}
      />

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={
          confirm?.type === "filter"
            ? t("docs.deleteFilter")
            : confirm?.type === "bulk"
              ? t("docs.deleteSelectedMany", { count: selected.size })
              : t("docs.deleteOne")
        }
        description={t("docs.deleteDesc")}
        confirmLabel={t("common.delete")}
        onConfirm={runConfirm}
      />

      <ExportDialog
        open={transfer === "export"}
        onOpenChange={(open) => !open && setTransfer(null)}
        connectionId={connectionId}
        database={database}
        collection={collection}
        filter={filter}
        sort={sort}
        projection={projection}
      />
      <ImportDialog
        open={transfer === "import"}
        onOpenChange={(open) => !open && setTransfer(null)}
        connectionId={connectionId}
        database={database}
        collection={collection}
        onImported={() => void load({ skip: 0 })}
      />
      <ExplainDialog
        open={explainOpen}
        onOpenChange={setExplainOpen}
        connectionId={connectionId}
        database={database}
        collection={collection}
        request={explainRequest}
      />
      <CopyCollectionDialog
        open={copyOpen}
        onOpenChange={setCopyOpen}
        connectionId={connectionId}
        database={database}
        collection={collection}
        filter={filter}
        onCopied={() => undefined}
      />
      <ChartDialog
        open={chartOpen}
        onOpenChange={setChartOpen}
        documents={documents}
        columns={allColumns}
        storageKey={`docs:${connectionId}:${database}:${collection}`}
      />
      <MongoQueryBuilder
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        fields={allColumns}
        value={filter}
        projection={projection}
        onApply={(nextFilter, nextProjection) => {
          setFilter(nextFilter)
          setProjection(nextProjection)
          void load({ skip: 0, filter: nextFilter, projection: nextProjection })
        }}
      />
    </div>
  )
}
