import * as React from "react"
import {
  AreaChart as AreaIcon,
  AlertTriangle,
  BarChart3,
  Bookmark,
  Copy,
  Crop,
  Download,
  Loader2,
  LineChart,
  Maximize2,
  Minimize2,
  PieChart,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Share2,
  Sparkles,
  SlidersHorizontal,
  Table2,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ApiError, api, isAbortError } from "@/lib/api"
import { copyToClipboard } from "@/lib/clipboard"
import { useI18n } from "@/lib/i18n"
import {
  buildChartData,
  buildChartPipeline,
  buildScatterData,
  chartDataFromRows,
  CHART_COLORS,
  formatAxisValue,
  formatChartValue,
  applyXAxisFormat,
  downsampleChartData,
  normalizeChartConfig,
  resolveTimeBucket,
  isTemporalColumn,
  toDate,
  niceScale,
  suggestChartConfig,
  toNumeric,
  type ChartAggregate,
  type ChartAxisScale,
  type ChartConfig,
  type ChartData,
  type ChartSort,
  type ChartTimeBucket,
  type ChartTimeZone,
  type ChartType,
  type SavedChartView,
  type ScatterPoint,
} from "@/lib/chart"
import { cn } from "@/lib/utils"
import { valueType } from "@/lib/mongo"
import type { MongoDocument } from "@/lib/types"

interface ChartViewProps {
  documents: MongoDocument[]
  columns: string[]
  /** BSON types from the current page, used to detect temporal fields. */
  fieldTypes?: Record<string, string>
  connectionId?: string
  database?: string
  collection?: string
  /** Parsed filter; when connection details are present the chart queries the server. */
  filter?: unknown
  /** False while the dialog's filter text is invalid; data is left untouched. */
  filterValid?: boolean
  /** Configuration restored from the URL. */
  initialConfig?: ChartConfig
  /** Report configuration changes so they can be mirrored into the URL. */
  onConfigChange?: (config: ChartConfig) => void
  /** Copy a URL that restores this chart. */
  onShare?: (config: ChartConfig) => void
  /** Render only the plot (used by dashboard cards). */
  compact?: boolean
  /** Server scope (connection::database::collection) for shared chart views. */
  scope?: string
  /** Current filter text, saved with a view and restored when it is applied. */
  currentFilter?: string
  /** Replace the dialog's filter, e.g. when applying a saved view. */
  onApplyFilterText?: (filter: string) => void
  /** Remember the chosen configuration under this key. */
  storageKey?: string
  height?: number
  className?: string
  /** Add a click-to-filter condition and refresh the chart in place. */
  onDrilldown?: (filter: Record<string, unknown>) => void
  /** Push the chart's current filter back to the documents tab. */
  onApplyFilter?: () => void
}

interface TooltipState {
  x: number
  y: number
  title: string
  rows: { name: string; value: string; color: string }[]
}

function useElementWidth<T extends HTMLElement>() {
  const ref = React.useRef<T>(null)
  const [width, setWidth] = React.useState(0)

  React.useEffect(() => {
    const element = ref.current
    if (!element) return
    const update = () => setWidth(element.clientWidth)
    update()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return { ref, width }
}

function configStorageKey(storageKey?: string) {
  return storageKey ? `mongoui-chart:${storageKey}` : ""
}

function loadConfig(storageKey?: string): ChartConfig | null {
  const key = configStorageKey(storageKey)
  if (!key) return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return normalizeChartConfig(JSON.parse(raw))
  } catch {
    return null
  }
}

function readSavedViews(key: string): SavedChartView[] {
  if (!key) return []
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "[]") as SavedChartView[]
    return Array.isArray(parsed) ? parsed.filter((view) => view && typeof view.name === "string") : []
  } catch {
    return []
  }
}

const CHART_TYPES: { value: ChartType; labelKey: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: "bar", labelKey: "chart.type.bar", icon: BarChart3 },
  { value: "hbar", labelKey: "chart.type.hbar", icon: BarChart3 },
  { value: "line", labelKey: "chart.type.line", icon: LineChart },
  { value: "area", labelKey: "chart.type.area", icon: AreaIcon },
  { value: "pie", labelKey: "chart.type.pie", icon: PieChart },
  { value: "scatter", labelKey: "chart.type.scatter", icon: BarChart3 },
  { value: "combo", labelKey: "chart.type.combo", icon: LineChart },
]

const TIME_BUCKETS: { value: ChartTimeBucket; labelKey: string }[] = [
  { value: "none", labelKey: "chart.bucket.none" },
  { value: "day", labelKey: "chart.bucket.day" },
  { value: "week", labelKey: "chart.bucket.week" },
  { value: "month", labelKey: "chart.bucket.month" },
  { value: "quarter", labelKey: "chart.bucket.quarter" },
  { value: "year", labelKey: "chart.bucket.year" },
]

function escapeCSV(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

/** Resolve CSS classes/variables so the SVG still looks right outside the app. */
function inlineSVG(source: SVGSVGElement, width: number, height: number): SVGSVGElement {
  const clone = source.cloneNode(true) as SVGSVGElement
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg")
  clone.setAttribute("width", String(width))
  clone.setAttribute("height", String(height))
  const sourceNodes = [source, ...Array.from(source.querySelectorAll("*"))]
  const cloneNodes = [clone, ...Array.from(clone.querySelectorAll("*"))]
  sourceNodes.forEach((node, index) => {
    const target = cloneNodes[index] as SVGElement | undefined
    if (!target) return
    const style = window.getComputedStyle(node)
    if (style.fill && style.fill !== "none") target.setAttribute("fill", style.fill)
    if (style.stroke && style.stroke !== "none") target.setAttribute("stroke", style.stroke)
    if (node instanceof SVGTextElement) {
      target.setAttribute("font-family", style.fontFamily)
      target.setAttribute("font-size", style.fontSize)
    }
    target.removeAttribute("class")
  })
  return clone
}

export function ChartView({
  documents,
  columns,
  fieldTypes,
  connectionId,
  database,
  collection,
  filter,
  filterValid = true,
  initialConfig,
  onConfigChange,
  onShare,
  compact = false,
  scope,
  currentFilter,
  onApplyFilterText,
  storageKey,
  height = 380,
  className,
  onDrilldown,
  onApplyFilter,
}: ChartViewProps) {
  const { t, locale } = useI18n()
  const { ref, width } = useElementWidth<HTMLDivElement>()
  const svgRef = React.useRef<SVGSVGElement>(null)
  const [config, setConfig] = React.useState<ChartConfig>(() => {
    const restored = initialConfig ? normalizeChartConfig(initialConfig) : loadConfig(storageKey)
    return restored ?? suggestChartConfig(documents, columns)
  })
  const lastEmitted = React.useRef(JSON.stringify(config))
  const [tooltip, setTooltip] = React.useState<TooltipState | null>(null)
  const [hidden, setHidden] = React.useState<Set<string>>(new Set())
  const [showTable, setShowTable] = React.useState(false)
  const [refreshToken, setRefreshToken] = React.useState(0)
  const [rows, setRows] = React.useState<MongoDocument[] | null>(null)
  const [rawDocs, setRawDocs] = React.useState<MongoDocument[] | null>(null)
  const [rawTotal, setRawTotal] = React.useState<number | null>(null)
  const [probeDocs, setProbeDocs] = React.useState<MongoDocument[]>([])
  const [fieldQuery, setFieldQuery] = React.useState("")
  const [configOpen, setConfigOpen] = React.useState(
    () => typeof window === "undefined" || window.innerWidth >= 1024,
  )
  const [zoom, setZoom] = React.useState<{ start: number; end: number } | null>(null)
  const [brushMode, setBrushMode] = React.useState(false)
  const [brush, setBrush] = React.useState<{ start: number; end: number } | null>(null)
  const [focusIndex, setFocusIndex] = React.useState<number | null>(null)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const [isFullscreen, setIsFullscreen] = React.useState(false)
  const [viewportHeight, setViewportHeight] = React.useState(
    () => (typeof window === "undefined" ? 800 : window.innerHeight),
  )
  const pointersRef = React.useRef(new Map<number, { x: number; y: number }>())
  const pinchRef = React.useRef<{
    distance: number
    span: number
    start: number
    center: number
  } | null>(null)
  const suppressClickRef = React.useRef(false)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const viewsKey = storageKey ? `mongoui-chart-views:${storageKey}` : ""
  const [views, setViews] = React.useState<SavedChartView[]>(() => readSavedViews(viewsKey))
  const [teamViews, setTeamViews] = React.useState<SavedChartView[]>([])
  const [teamVersion, setTeamVersion] = React.useState(0)
  const [viewsOpen, setViewsOpen] = React.useState(false)
  const [viewName, setViewName] = React.useState("")
  const [shareView, setShareView] = React.useState(false)
  const [pinView, setPinView] = React.useState(false)
  const columnsKey = columns.join("|")
  const serverMode = Boolean(connectionId && database && collection)

  React.useEffect(() => {
    const onChange = () => {
      setIsFullscreen(document.fullscreenElement === rootRef.current)
      setViewportHeight(window.innerHeight)
    }
    document.addEventListener("fullscreenchange", onChange)
    window.addEventListener("resize", onChange)
    return () => {
      document.removeEventListener("fullscreenchange", onChange)
      window.removeEventListener("resize", onChange)
    }
  }, [])

  const chartHeight = isFullscreen ? Math.max(320, viewportHeight - 110) : height

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      void rootRef.current?.requestFullscreen?.()
    }
  }

  // Re-detect when the result shape changes and the current config no longer fits.
  React.useEffect(() => {
    if (initialConfig) return
    setConfig((previous) => {
      const validX = !previous.x || columns.includes(previous.x)
      const validY = previous.y.every((field) => columns.includes(field))
      if (validX && validY) return previous
      return suggestChartConfig(documents, columns, previous)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnsKey])

  React.useEffect(() => {
    if (!viewsKey) return
    try {
      localStorage.setItem(viewsKey, JSON.stringify(views))
    } catch {
      /* storage may be unavailable */
    }
  }, [views, viewsKey])

  React.useEffect(() => {
    if (!scope) {
      setTeamViews([])
      return
    }
    let cancelled = false
    void api
      .getChartViews(scope)
      .then((result) => {
        if (cancelled) return
        setTeamViews(Array.isArray(result.views) ? result.views : [])
        setTeamVersion(result.version ?? 0)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [scope])

  // Report changes upward (URL mirroring) without making the view controlled.
  const notifyRef = React.useRef(onConfigChange)
  notifyRef.current = onConfigChange
  React.useEffect(() => {
    lastEmitted.current = JSON.stringify(config)
    notifyRef.current?.(config)
  }, [config])

  // Adopt a configuration coming from the URL (shared link or back/forward).
  React.useEffect(() => {
    if (!initialConfig) return
    const key = JSON.stringify(initialConfig)
    if (key === JSON.stringify(config) || key === lastEmitted.current) return
    setConfig(normalizeChartConfig(initialConfig))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialConfig])

  React.useEffect(() => {
    if (storageKey && config.x) {
      try {
        localStorage.setItem(configStorageKey(storageKey), JSON.stringify(config))
      } catch {
        /* storage may be unavailable */
      }
    }
  }, [config, storageKey])

  const temporalX = React.useMemo(
    () =>
      isTemporalColumn([...documents, ...probeDocs], config.x) ||
      /date/i.test(fieldTypes?.[config.x] ?? ""),
    [documents, probeDocs, fieldTypes, config.x],
  )

  const effectiveConfig = React.useMemo<ChartConfig>(
    () => ({
      ...config,
      timeBucket:
        temporalX && config.type !== "scatter" && config.aggregate !== "none"
          ? resolveTimeBucket([...documents, ...probeDocs], config.x, config.timeBucket)
          : "none",
    }),
    [config, temporalX, documents, probeDocs],
  )

  // A lightweight sample of the filtered result keeps the field pickers useful
  // even when the current page does not contain a field.
  React.useEffect(() => {
    if (!serverMode) return
    const controller = new AbortController()
    void api
      .find(
        connectionId!,
        database!,
        collection!,
        { filter: filter ?? {}, limit: 50 },
        controller.signal,
      )
      .then((res) => {
        if (!controller.signal.aborted) setProbeDocs(res.documents)
      })
      .catch(() => undefined)
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverMode, connectionId, database, collection, JSON.stringify(filter)])

  // Only the fields that change the server response belong in the fetch key;
  // sorting/limit/others are applied client-side without another round trip.
  const fetchKey = JSON.stringify({
    connectionId,
    database,
    collection,
    filter,
    type: config.type,
    x: config.x,
    y: config.y,
    aggregate: config.aggregate,
    group: config.group,
    bucket: effectiveConfig.timeBucket,
    refreshToken,
  })

  React.useEffect(() => {
    if (!serverMode || !config.x || !filterValid) return
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        if (config.type === "scatter" || config.aggregate === "none") {
          const res = await api.find(
            connectionId!,
            database!,
            collection!,
            { filter: filter ?? {}, limit: 1000 },
            controller.signal,
          )
          if (controller.signal.aborted) return
          setRawDocs(res.documents)
          setRawTotal(res.total)
          setRows(null)
        } else {
          const pipeline = buildChartPipeline(effectiveConfig, filter ?? {}, temporalX)
          const res = await api.aggregate(
            connectionId!,
            database!,
            collection!,
            pipeline,
            1000,
            controller.signal,
          )
          if (controller.signal.aborted) return
          setRows(res.documents)
          setRawDocs(null)
        }
      } catch (err) {
        if (isAbortError(err) || controller.signal.aborted) return
        setError(err instanceof Error ? err.message : t("chart.loadFailed"))
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey, serverMode])

  const source = serverMode
    ? config.type === "scatter" || config.aggregate === "none"
      ? rawDocs ?? []
      : rows ?? []
    : documents

  const baseData = React.useMemo<ChartData>(() => {
    if (config.type === "scatter") return { categories: [], series: [], rawCategories: [] }
    if (serverMode && config.aggregate !== "none") {
      return chartDataFromRows(rows ?? [], effectiveConfig, t("chart.others"))
    }
    return buildChartData(source, effectiveConfig, t("chart.others"))
  }, [serverMode, rows, source, effectiveConfig, config.type, config.aggregate, t])

  const windowedData = React.useMemo<ChartData>(() => {
    if (!zoom) return baseData
    const n = baseData.categories.length
    const start = Math.max(0, Math.floor(zoom.start))
    const end = Math.min(n, Math.ceil(zoom.end))
    if (end - start < 2) return baseData
    return {
      categories: baseData.categories.slice(start, end),
      series: baseData.series.map((item) => ({
        name: item.name,
        values: item.values.slice(start, end),
      })),
      rawCategories: baseData.rawCategories.slice(start, end),
      ranges: baseData.ranges?.slice(start, end),
    }
  }, [baseData, zoom])

  const data = React.useMemo<ChartData>(() => {
    const sampled =
      config.type === "line" || config.type === "area"
        ? downsampleChartData(windowedData, 600)
        : windowedData
    return applyXAxisFormat(sampled, config, locale)
  }, [windowedData, config, locale])

  const downsampled = data.categories.length < windowedData.categories.length

  // Reset zoom when the query changes and keep an existing window in bounds.
  React.useEffect(() => {
    setZoom(null)
  }, [fetchKey])

  React.useEffect(() => {
    const n = baseData.categories.length
    setZoom((previous) => {
      if (!previous) return previous
      if (n < 2) return null
      const span = Math.min(previous.end - previous.start, n)
      const start = Math.max(0, Math.min(previous.start, n - span))
      const next = { start, end: start + span }
      return next.start === previous.start && next.end === previous.end ? previous : next
    })
  }, [baseData])

  const scatter = React.useMemo(
    () => (config.type === "scatter" ? buildScatterData(source, effectiveConfig) : null),
    [config.type, source, effectiveConfig],
  )

  const fieldCatalog = React.useMemo(() => {
    const types = new Map<string, string>()
    const add = (doc: MongoDocument) => {
      for (const [key, value] of Object.entries(doc)) {
        if (!types.has(key)) types.set(key, valueType(value))
      }
    }
    documents.forEach(add)
    probeDocs.forEach(add)
    rawDocs?.forEach(add)
    for (const [key, value] of Object.entries(fieldTypes ?? {})) types.set(key, value)
    if (config.x) types.set(config.x, types.get(config.x) ?? "")
    if (config.group) types.set(config.group, types.get(config.group) ?? "")
    return [...types.entries()].map(([name, type]) => ({ name, type }))
  }, [documents, probeDocs, rawDocs, fieldTypes, config.x, config.group])

  const fieldNames = React.useMemo(
    () => (fieldCatalog.length > 0 ? fieldCatalog.map((field) => field.name) : columns),
    [fieldCatalog, columns],
  )

  const typeOf = React.useCallback(
    (name: string) => fieldCatalog.find((field) => field.name === name)?.type ?? "",
    [fieldCatalog],
  )

  const isNumericField = React.useCallback(
    (name: string) =>
      /int|long|double|decimal|number/i.test(typeOf(name)) ||
      documents.some((doc) => toNumeric(doc[name]) !== null) ||
      probeDocs.some((doc) => toNumeric(doc[name]) !== null),
    [typeOf, documents, probeDocs],
  )

  const numericColumns = React.useMemo(
    () => fieldNames.filter((column) => isNumericField(column)),
    [fieldNames, isNumericField],
  )

  const fieldMatches = React.useCallback(
    (name: string) => !fieldQuery.trim() || name.toLowerCase().includes(fieldQuery.trim().toLowerCase()),
    [fieldQuery],
  )

  // In the chart tab the field list only arrives with the probe request; adopt
  // a sensible configuration as soon as columns are known.
  React.useEffect(() => {
    if (config.x || fieldNames.length === 0) return
    setConfig((previous) =>
      suggestChartConfig([...documents, ...probeDocs], fieldNames, previous),
    )
  }, [config.x, fieldNames, documents, probeDocs])

  const series = React.useMemo(
    () => data.series.filter((item) => !hidden.has(item.name)),
    [data.series, hidden],
  )

  const chartWidth = Math.max(width - 24, 320)
  const horizontal = config.type === "hbar"
  const scatterMode = config.type === "scatter"
  const margin = horizontal
    ? { top: 16, right: 24, bottom: 44, left: 118 }
    : scatterMode
      ? { top: 20, right: 24, bottom: 52, left: 64 }
      : { top: 24, right: 20, bottom: 80, left: 64 }
  const plotWidth = Math.max(40, chartWidth - margin.left - margin.right)
  const plotHeight = Math.max(60, chartHeight - margin.top - margin.bottom)

  const stacked =
    config.type === "bar" &&
    config.stacked &&
    series.length > 1 &&
    series.every((item) => item.values.every((value) => value >= 0))
  const percentStacked = stacked && config.percentStacked
  const comboMode = config.type === "combo"
  const comboBar = comboMode ? series.slice(0, 1) : []
  const comboLines = comboMode ? series.slice(1) : []

  const scaleValues = horizontal
    ? series.flatMap((item) => item.values)
    : comboMode
      ? comboBar.flatMap((item) => item.values)
    : stacked
      ? data.categories.map((_, index) =>
          series.reduce((sum, item) => sum + (item.values[index] ?? 0), 0),
        )
      : series.flatMap((item) => item.values)
  const scale = percentStacked
    ? { min: 0, max: 1, ticks: [0, 0.25, 0.5, 0.75, 1] }
    : niceScale(
        Math.min(0, ...(scaleValues.length ? scaleValues : [0])),
        Math.max(0, ...(scaleValues.length ? scaleValues : [1])),
        5,
      )

  const formatTick = (tick: number) =>
    percentStacked ? `${Math.round(tick * 100)}%` : formatAxisValue(tick, config)

  const yFor = (value: number) =>
    margin.top + plotHeight - ((value - scale.min) / (scale.max - scale.min || 1)) * plotHeight
  const xForValue = (value: number) =>
    margin.left + ((value - scale.min) / (scale.max - scale.min || 1)) * plotWidth

  const rightValues = comboLines.flatMap((item) => item.values)
  const rightScale = niceScale(
    Math.min(0, ...(rightValues.length ? rightValues : [0])),
    Math.max(0, ...(rightValues.length ? rightValues : [1])),
    5,
  )
  const yForRight = (value: number) =>
    margin.top +
    plotHeight -
    ((value - rightScale.min) / (rightScale.max - rightScale.min || 1)) * plotHeight

  const scatterBounds = React.useMemo(() => {
    if (!scatter || scatter.points.length === 0) {
      return { x: niceScale(0, 1, 5), y: niceScale(0, 1, 5) }
    }
    const xs = scatter.points.map((point) => point.x)
    const ys = scatter.points.map((point) => point.y)
    return {
      x: niceScale(Math.min(...xs), Math.max(...xs), 5),
      y: niceScale(Math.min(...ys), Math.max(...ys), 5),
    }
  }, [scatter])

  const scatterX = (value: number) =>
    margin.left +
    ((value - scatterBounds.x.min) /
      (scatterBounds.x.max - scatterBounds.x.min || 1)) *
      plotWidth
  const scatterY = (value: number) =>
    margin.top +
    plotHeight -
    ((value - scatterBounds.y.min) /
      (scatterBounds.y.max - scatterBounds.y.min || 1)) *
      plotHeight

  const hasData =
    scatterMode ? Boolean(scatter && scatter.points.length > 0) : data.categories.length > 0 && series.length > 0

  const crowded =
    data.categories.length > (config.type === "pie" ? 12 : 40) ||
    (!config.others && data.categories.length >= config.limit)

  const update = (patch: Partial<ChartConfig>) => setConfig((prev) => ({ ...prev, ...patch }))

  const toggleY = (field: string) => {
    setConfig((prev) => {
      if (prev.y.includes(field)) return { ...prev, y: prev.y.filter((item) => item !== field) }
      if (prev.group || prev.type === "scatter") return { ...prev, y: [field] }
      return { ...prev, y: [...prev.y, field] }
    })
  }

  const reset = () => {
    const suggested = suggestChartConfig(documents, columns)
    setConfig({ ...suggested, type: config.type })
    setHidden(new Set())
  }

  const saveView = async () => {
    const name = viewName.trim()
    if (!name) return
    const view: SavedChartView = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      config,
      filter: currentFilter,
      pinned: shareView && pinView,
      shared: shareView,
    }
    if (shareView && scope) {
      const next = [...teamViews, view]
      try {
        const saved = await api.saveChartViews(scope, next, teamVersion)
        setTeamViews(saved.views)
        setTeamVersion(saved.version)
        toast.success(t("chart.viewSaved"))
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          toast.error(t("chart.viewConflict"))
          const latest = await api.getChartViews(scope).catch(() => null)
          if (latest) {
            setTeamViews(latest.views ?? [])
            setTeamVersion(latest.version ?? 0)
          }
        } else {
          toast.error(err instanceof Error ? err.message : t("chart.viewSaveFailed"))
        }
        return
      }
    } else {
      setViews((prev) => [...prev, view])
      toast.success(t("chart.viewSaved"))
    }
    setViewName("")
    setPinView(false)
    setViewsOpen(false)
  }

  const applyView = (view: SavedChartView) => {
    setConfig(normalizeChartConfig(view.config))
    setHidden(new Set())
    if (view.filter && onApplyFilterText) onApplyFilterText(view.filter)
    setViewsOpen(false)
  }

  const deleteView = async (view: SavedChartView) => {
    if (view.shared && scope) {
      try {
        const saved = await api.saveChartViews(
          scope,
          teamViews.filter((item) => item.id !== view.id),
          teamVersion,
        )
        setTeamViews(saved.views)
        setTeamVersion(saved.version)
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          toast.error(t("chart.viewConflict"))
          const latest = await api.getChartViews(scope).catch(() => null)
          if (latest) {
            setTeamViews(latest.views ?? [])
            setTeamVersion(latest.version ?? 0)
          }
        } else {
          toast.error(err instanceof Error ? err.message : t("chart.viewSaveFailed"))
        }
      }
      return
    }
    setViews((prev) => prev.filter((item) => item.id !== view.id))
  }

  const toggleSeries = (name: string) => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const setTooltipAt = (
    x: number,
    y: number,
    title: string,
    rows: { name: string; value: number; display?: string; color?: string }[],
  ) => {
    setTooltip({
      x,
      y,
      title,
      rows: rows.map((row, index) => ({
        name: row.name,
        value: row.display ?? formatChartValue(row.value, config),
        color: row.color ?? CHART_COLORS[index % CHART_COLORS.length],
      })),
    })
  }

  const showTooltip = (
    event: React.MouseEvent | React.PointerEvent,
    title: string,
    rows: { name: string; value: number; display?: string; color?: string }[],
  ) => {
    const container = ref.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    setTooltipAt(event.clientX - rect.left, event.clientY - rect.top, title, rows)
  }

  const hideTooltip = () => setTooltip(null)

  const focusCategory = (index: number) => {
    const n = data.categories.length
    if (n === 0) return
    const next = Math.max(0, Math.min(n - 1, index))
    setFocusIndex(next)
    const band = plotWidth / Math.max(1, n)
    setTooltipAt(
      margin.left + (next + 0.5) * band,
      margin.top + 16,
      data.categories[next],
      series.map((item) => ({ name: item.name, value: item.values[next] ?? 0 })),
    )
  }

  const categoryTooltip = (
    event: React.MouseEvent | React.PointerEvent,
    category: string,
    index: number,
  ) => {
    showTooltip(
      event,
      category,
      series.map((item) => ({ name: item.name, value: item.values[index] ?? 0 })),
    )
  }

  const drill = (index: number) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    if (!onDrilldown || !config.x) return
    const range = data.ranges?.[index]
    if (range) {
      onDrilldown({
        [config.x]: {
          $gte: { $date: range.start },
          $lt: { $date: range.end },
        },
      })
      return
    }
    const raw = data.rawCategories[index]
    if (raw === undefined || raw === null) return
    onDrilldown({ [config.x]: raw })
  }

  const drillValue = (field: string, value: number) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    if (!onDrilldown || !field) return
    onDrilldown({ [field]: value })
  }

  const indexAtClientX = (clientX: number): number => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return 0
    const n = baseData.categories.length
    const fraction = (clientX - rect.left - margin.left) / Math.max(1, plotWidth)
    return Math.max(0, Math.min(n, fraction * n))
  }

  const currentZoom = () => zoom ?? { start: 0, end: baseData.categories.length }

  const applyZoomAround = (center: number, nextSpan: number) => {
    const n = baseData.categories.length
    if (n < 2) return
    const span = Math.max(2, Math.min(n, nextSpan))
    const current = currentZoom()
    const ratio = span / Math.max(0.001, current.end - current.start)
    let start = center - (center - current.start) * ratio
    start = Math.max(0, Math.min(start, n - span))
    setZoom(span >= n ? null : { start, end: start + span })
  }

  React.useEffect(() => {
    const element = svgRef.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey) || scatterMode) return
      if (baseData.categories.length < 3) return
      event.preventDefault()
      const center = indexAtClientX(event.clientX)
      const current = currentZoom()
      const factor = event.deltaY > 0 ? 1.25 : 0.8
      applyZoomAround(center, (current.end - current.start) * factor)
    }
    element.addEventListener("wheel", onWheel, { passive: false })
    return () => element.removeEventListener("wheel", onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseData, zoom, scatterMode, plotWidth, margin.left])

  const startPinch = () => {
    const points = [...pointersRef.current.values()]
    if (points.length !== 2) return
    const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
    const center = indexAtClientX((points[0].x + points[1].x) / 2)
    const current = currentZoom()
    pinchRef.current = {
      distance: Math.max(1, distance),
      span: current.end - current.start,
      start: current.start,
      center,
    }
  }

  const movePinch = () => {
    const pinch = pinchRef.current
    const points = [...pointersRef.current.values()]
    if (!pinch || points.length !== 2) return
    const distance = Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y))
    const n = baseData.categories.length
    const span = Math.max(2, Math.min(n, pinch.span * (pinch.distance / distance)))
    const ratio = span / Math.max(0.001, pinch.span)
    const start = Math.max(0, Math.min(n - span, pinch.center - (pinch.center - pinch.start) * ratio))
    setZoom(span >= n ? null : { start, end: start + span })
    suppressClickRef.current = true
    window.setTimeout(() => {
      suppressClickRef.current = false
    }, 400)
  }

  const endPinch = (pointerId: number) => {
    pointersRef.current.delete(pointerId)
    if (pointersRef.current.size < 2) pinchRef.current = null
  }

  const startBrush = (event: React.PointerEvent<SVGRectElement>) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const x = Math.max(0, Math.min(plotWidth, event.clientX - rect.left - margin.left))
    setBrush({ start: x, end: x })
  }

  const moveBrush = (event: React.PointerEvent<SVGRectElement>) => {
    if (!brush) return
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = Math.max(0, Math.min(plotWidth, event.clientX - rect.left - margin.left))
    setBrush({ start: brush.start, end: x })
  }

  const finishBrush = () => {
    if (!brush) return
    const lo = Math.min(brush.start, brush.end)
    const hi = Math.max(brush.start, brush.end)
    setBrush(null)
    setBrushMode(false)
    if (hi - lo < 4) return
    const n = data.categories.length
    const first = Math.max(0, Math.min(n - 1, Math.floor((lo / plotWidth) * n)))
    const last = Math.max(first, Math.min(n - 1, Math.floor((hi / plotWidth) * n)))
    const rangeStart = data.ranges?.[first]
    const rangeEnd = data.ranges?.[last]
    let filter: Record<string, unknown> | null = null
    if (rangeStart && rangeEnd) {
      filter = {
        [config.x]: {
          $gte: { $date: rangeStart.start },
          $lt: { $date: rangeEnd.end },
        },
      }
    } else {
      const startDate = toDate(data.rawCategories[first])
      const endDate = toDate(data.rawCategories[last])
      if (startDate && endDate) {
        filter = {
          [config.x]: {
            $gte: { $date: startDate.toISOString() },
            $lte: { $date: endDate.toISOString() },
          },
        }
      }
    }
    if (filter && onDrilldown) {
      onDrilldown(filter)
    } else {
      const base = zoom ? zoom.start : 0
      setZoom({ start: base + first, end: base + last + 1 })
    }
  }

  const renderAxes = () => (
    <g>
      {scale.ticks.map((tick) => {
        const y = yFor(tick)
        return (
          <g key={tick}>
            <line
              x1={margin.left}
              x2={margin.left + plotWidth}
              y1={y}
              y2={y}
              className="stroke-border"
              strokeDasharray="3 3"
            />
            <text
              x={margin.left - 8}
              y={y + 3}
              textAnchor="end"
              className="fill-muted-foreground text-[10px]"
            >
              {formatTick(tick)}
            </text>
          </g>
        )
      })}
      <line
        x1={margin.left}
        x2={margin.left + plotWidth}
        y1={yFor(0)}
        y2={yFor(0)}
        className="stroke-border"
      />
    </g>
  )

  const renderXLabels = () => {
    const band = plotWidth / Math.max(1, data.categories.length)
    const step = Math.max(1, Math.ceil((data.categories.length * 60) / plotWidth))
    const maxChars = Math.max(6, Math.floor(band / 6))
    return (
      <g>
        {data.categories.map((category, index) => {
          if (index % step !== 0) return null
          const x = margin.left + (index + 0.5) * band
          return (
            <text
              key={index}
              x={x}
              y={margin.top + plotHeight + 14}
              textAnchor="end"
              transform={`rotate(-35, ${x}, ${margin.top + plotHeight + 14})`}
              className="fill-muted-foreground text-[10px]"
            >
              {category.length > maxChars ? `${category.slice(0, maxChars - 1)}…` : category}
            </text>
          )
        })}
      </g>
    )
  }

  const renderBars = () => {
    const band = plotWidth / Math.max(1, data.categories.length)
    const count = series.length
    const groupPad = band * 0.18
    const groupWidth = Math.max(1, band - groupPad * 2)
    const barWidth = groupWidth / Math.max(1, count)
    const baseline = yFor(0)

    if (stacked) {
      return (
        <g>
          {data.categories.map((category, ci) => {
            const total = series.reduce(
              (sum, item) => sum + Math.max(0, item.values[ci] ?? 0),
              0,
            )
            let offset = 0
            return series.map((item, si) => {
              const raw = Math.max(0, item.values[ci] ?? 0)
              const value = percentStacked ? (total > 0 ? raw / total : 0) : raw
              const top = yFor(offset + value)
              const bottom = yFor(offset)
              offset += value
              return (
                <rect
                  key={`${ci}-${si}`}
                  x={margin.left + ci * band + groupPad}
                  y={top}
                  width={Math.max(1, groupWidth)}
                  height={Math.max(0, bottom - top)}
                  fill={CHART_COLORS[data.series.indexOf(item) % CHART_COLORS.length]}
                  className="cursor-pointer transition-opacity hover:opacity-80"
                  onMouseMove={(event) =>
                    showTooltip(
                      event,
                      category,
                      series.map((entry) => ({
                        name: entry.name,
                        value: entry.values[ci] ?? 0,
                      })),
                    )
                  }
                  onMouseLeave={hideTooltip}
                  onPointerDown={(event) => categoryTooltip(event, category, ci)}
                  onClick={() => drill(ci)}
                />
              )
            })
          })}
        </g>
      )
    }

    return (
      <g>
        {data.categories.map((category, ci) =>
          series.map((item, si) => {
            const value = item.values[ci] ?? 0
            const x = margin.left + ci * band + groupPad + si * barWidth
            const y = value >= 0 ? yFor(value) : baseline
            const h = Math.max(0, Math.abs(yFor(value) - baseline))
            const color = CHART_COLORS[data.series.indexOf(item) % CHART_COLORS.length]
            return (
              <g key={`${ci}-${si}`}>
                <rect
                  x={x}
                  y={y}
                  width={Math.max(1, barWidth - (count > 1 ? 1.5 : 2))}
                  height={h}
                  fill={color}
                  rx={2}
                  className="cursor-pointer transition-opacity hover:opacity-80"
                  onMouseMove={(event) =>
                    showTooltip(
                      event,
                      category,
                      series.map((entry) => ({
                        name: entry.name,
                        value: entry.values[ci] ?? 0,
                      })),
                    )
                  }
                  onMouseLeave={hideTooltip}
                  onPointerDown={(event) => categoryTooltip(event, category, ci)}
                  onClick={() => drill(ci)}
                />
                {config.showValues && barWidth > 22 && h > 12 ? (
                  <text
                    x={x + Math.max(1, barWidth) / 2}
                    y={Math.min(y, baseline) - 4}
                    textAnchor="middle"
                    className="fill-muted-foreground text-[9px]"
                  >
                    {formatChartValue(value, config)}
                  </text>
                ) : null}
              </g>
            )
          }),
        )}
      </g>
    )
  }

  const renderHBars = () => {
    const band = plotHeight / Math.max(1, data.categories.length)
    const count = series.length
    const groupPad = band * 0.18
    const groupHeight = Math.max(1, band - groupPad * 2)
    const barHeight = groupHeight / Math.max(1, count)
    const baseline = xForValue(0)

    return (
      <g>
        {data.categories.map((category, ci) =>
          series.map((item, si) => {
            const value = item.values[ci] ?? 0
            const y = margin.top + ci * band + groupPad + si * barHeight
            const x = value >= 0 ? xForValue(value) : baseline
            const w = Math.max(0, Math.abs(xForValue(value) - baseline))
            const color = CHART_COLORS[data.series.indexOf(item) % CHART_COLORS.length]
            return (
              <g key={`${ci}-${si}`}>
                <rect
                  x={Math.min(x, baseline)}
                  y={y}
                  width={w}
                  height={Math.max(1, barHeight - (count > 1 ? 1.5 : 2))}
                  fill={color}
                  rx={2}
                  className="cursor-pointer transition-opacity hover:opacity-80"
                  onMouseMove={(event) =>
                    showTooltip(
                      event,
                      category,
                      series.map((entry) => ({
                        name: entry.name,
                        value: entry.values[ci] ?? 0,
                      })),
                    )
                  }
                  onMouseLeave={hideTooltip}
                  onPointerDown={(event) => categoryTooltip(event, category, ci)}
                  onClick={() => drill(ci)}
                />
                {config.showValues && w > 30 ? (
                  <text
                    x={Math.min(x, baseline) + w + 4}
                    y={y + barHeight / 2 + 3}
                    className="fill-muted-foreground text-[9px]"
                  >
                    {formatChartValue(value, config)}
                  </text>
                ) : null}
              </g>
            )
          }),
        )}
      </g>
    )
  }

  const linePath = (values: number[]) => {
    const band = plotWidth / Math.max(1, data.categories.length)
    return values
      .map((value, index) => {
        const x = margin.left + (index + 0.5) * band
        return `${index === 0 ? "M" : "L"}${x},${yFor(value)}`
      })
      .join(" ")
  }

  const renderLines = (area: boolean) => {
    const band = plotWidth / Math.max(1, data.categories.length)
    const baseline = yFor(0)
    return (
      <g>
        {area
          ? series.map((item, si) => (
              <path
                key={`area-${si}`}
                d={`${linePath(item.values)} L${margin.left + data.categories.length * band},${baseline} L${margin.left},${baseline} Z`}
                fill={CHART_COLORS[data.series.indexOf(item) % CHART_COLORS.length]}
                opacity={0.18}
              />
            ))
          : null}
        {series.map((item, si) => (
          <path
            key={`line-${si}`}
            d={linePath(item.values)}
            fill="none"
            stroke={CHART_COLORS[data.series.indexOf(item) % CHART_COLORS.length]}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {series.map((item, si) =>
          item.values.map((value, index) => (
            <circle
              key={`dot-${si}-${index}`}
              cx={margin.left + (index + 0.5) * band}
              cy={yFor(value)}
              r={3}
              fill={CHART_COLORS[data.series.indexOf(item) % CHART_COLORS.length]}
              className="cursor-pointer hover:opacity-80"
              onMouseMove={(event) =>
                showTooltip(
                  event,
                  data.categories[index],
                  series.map((entry) => ({
                    name: entry.name,
                    value: entry.values[index] ?? 0,
                  })),
                )
              }
              onMouseLeave={hideTooltip}
              onPointerDown={(event) => categoryTooltip(event, data.categories[index], index)}
              onClick={() => drill(index)}
            />
          )),
        )}
      </g>
    )
  }

  const renderCombo = () => {
    const band = plotWidth / Math.max(1, data.categories.length)
    const barWidth = Math.max(1, band * 0.46)
    const baseline = yFor(0)
    const bar = comboBar[0]
    return (
      <g>
        {bar
          ? data.categories.map((category, index) => {
              const value = bar.values[index] ?? 0
              const y = value >= 0 ? yFor(value) : baseline
              const h = Math.abs(yFor(value) - baseline)
              const color = CHART_COLORS[data.series.indexOf(bar) % CHART_COLORS.length]
              return (
                <g key={`combo-bar-${index}`}>
                  <rect
                    x={margin.left + index * band + (band - barWidth) / 2}
                    y={y}
                    width={barWidth}
                    height={h}
                    fill={color}
                    rx={2}
                    className="cursor-pointer hover:opacity-80"
                    onMouseMove={(event) => categoryTooltip(event, category, index)}
                    onMouseLeave={hideTooltip}
                    onPointerDown={(event) => categoryTooltip(event, category, index)}
                    onClick={() => drill(index)}
                  />
                  {config.showValues && barWidth > 22 && h > 12 ? (
                    <text
                      x={margin.left + index * band + band / 2}
                      y={Math.min(y, baseline) - 4}
                      textAnchor="middle"
                      className="fill-muted-foreground text-[9px]"
                    >
                      {formatChartValue(value, config)}
                    </text>
                  ) : null}
                </g>
              )
            })
          : null}
        {comboLines.map((item) => {
          const color = CHART_COLORS[data.series.indexOf(item) % CHART_COLORS.length]
          return (
            <g key={`combo-line-${item.name}`}>
              <path
                d={item.values
                  .map(
                    (value, index) =>
                      `${index === 0 ? "M" : "L"}${margin.left + (index + 0.5) * band},${yForRight(value)}`,
                  )
                  .join(" ")}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {item.values.map((value, index) => (
                <circle
                  key={`combo-dot-${index}`}
                  cx={margin.left + (index + 0.5) * band}
                  cy={yForRight(value)}
                  r={3}
                  fill={color}
                  className="cursor-pointer hover:opacity-80"
                  onMouseMove={(event) =>
                    categoryTooltip(event, data.categories[index], index)
                  }
                  onMouseLeave={hideTooltip}
                  onPointerDown={(event) =>
                    categoryTooltip(event, data.categories[index], index)
                  }
                  onClick={() => drill(index)}
                />
              ))}
            </g>
          )
        })}
      </g>
    )
  }

  const renderRightAxis = () => (
    <g>
      {rightScale.ticks.map((tick) => (
        <text
          key={`right-${tick}`}
          x={margin.left + plotWidth + 8}
          y={yForRight(tick) + 3}
          textAnchor="start"
          className="fill-muted-foreground text-[10px]"
        >
          {formatTick(tick)}
        </text>
      ))}
    </g>
  )

  const renderPie = () => {
    // A pie needs one measure; multiple value fields would be summed, which is
    // easy to misread, so only the first visible series is used.
    const measure = series[0]
    if (!measure) return null
    const totals = data.categories.map((_, index) => Math.max(0, measure.values[index] ?? 0))
    const total = totals.reduce((a, b) => a + b, 0)
    if (total <= 0) return null
    const cx = margin.left + plotWidth / 2
    const cy = margin.top + plotHeight / 2
    const radius = Math.max(20, Math.min(plotWidth, plotHeight) / 2 - 8)
    let angle = -Math.PI / 2

    return (
      <g>
        {data.categories.map((category, index) => {
          const fraction = totals[index] / total
          const start = angle
          const end = angle + fraction * Math.PI * 2
          angle = end
          const large = end - start > Math.PI ? 1 : 0
          const x1 = cx + radius * Math.cos(start)
          const y1 = cy + radius * Math.sin(start)
          const x2 = cx + radius * Math.cos(end)
          const y2 = cy + radius * Math.sin(end)
          const d = `M${cx},${cy} L${x1},${y1} A${radius},${radius} 0 ${large} 1 ${x2},${y2} Z`
          const mid = (start + end) / 2
          const labelX = cx + radius * 0.68 * Math.cos(mid)
          const labelY = cy + radius * 0.68 * Math.sin(mid)
          return (
            <g key={index}>
              <path
                d={d}
                fill={CHART_COLORS[index % CHART_COLORS.length]}
                stroke="var(--background)"
                strokeWidth={1}
                className="cursor-pointer transition-opacity hover:opacity-80"
                onMouseMove={(event) => {
                  const percent = total > 0 ? ((totals[index] / total) * 100).toFixed(1) : "0.0"
                  showTooltip(event, category, [
                    {
                      name: measure.name,
                      value: totals[index],
                      display: `${formatChartValue(totals[index], config)} (${percent}%)`,
                      color: CHART_COLORS[index % CHART_COLORS.length],
                    },
                  ])
                }}
                onMouseLeave={hideTooltip}
                onClick={() => drill(index)}
                onPointerDown={(event) => {
                  const percent = total > 0 ? ((totals[index] / total) * 100).toFixed(1) : "0.0"
                  showTooltip(event, category, [
                    {
                      name: measure.name,
                      value: totals[index],
                      display: `${formatChartValue(totals[index], config)} (${percent}%)`,
                      color: CHART_COLORS[index % CHART_COLORS.length],
                    },
                  ])
                }}
              />
              {config.showValues && fraction >= 0.05 ? (
                <text
                  x={labelX}
                  y={labelY}
                  textAnchor="middle"
                  className="fill-background text-[10px] font-medium"
                >
                  {(fraction * 100).toFixed(0)}%
                </text>
              ) : null}
            </g>
          )
        })}
      </g>
    )
  }

  const renderScatterAxes = () => (
    <g>
      {scatterBounds.y.ticks.map((tick) => (
        <g key={`y-${tick}`}>
          <line
            x1={margin.left}
            x2={margin.left + plotWidth}
            y1={scatterY(tick)}
            y2={scatterY(tick)}
            className="stroke-border"
            strokeDasharray="3 3"
          />
          <text
            x={margin.left - 8}
            y={scatterY(tick) + 3}
            textAnchor="end"
            className="fill-muted-foreground text-[10px]"
          >
            {formatTick(tick)}
          </text>
        </g>
      ))}
      {scatterBounds.x.ticks.map((tick) => (
        <g key={`x-${tick}`}>
          <line
            x1={scatterX(tick)}
            x2={scatterX(tick)}
            y1={margin.top}
            y2={margin.top + plotHeight}
            className="stroke-border"
            strokeDasharray="3 3"
          />
          <text
            x={scatterX(tick)}
            y={margin.top + plotHeight + 14}
            textAnchor="middle"
            className="fill-muted-foreground text-[10px]"
          >
            {formatTick(tick)}
          </text>
        </g>
      ))}
    </g>
  )

  const scatterGroups = React.useMemo(() => {
    if (!scatter) return []
    return [...new Set(scatter.points.map((point) => point.group).filter(Boolean))]
  }, [scatter])

  const renderScatter = () => {
    if (!scatter) return null
    return (
      <g>
        {scatter.points.map((point: ScatterPoint, index) => {
          const groupIndex = point.group ? scatterGroups.indexOf(point.group) : 0
          return (
            <circle
              key={index}
              cx={scatterX(point.x)}
              cy={scatterY(point.y)}
              r={4}
              fill={CHART_COLORS[groupIndex % CHART_COLORS.length]}
              opacity={0.7}
              className="cursor-pointer hover:opacity-100"
              onMouseMove={(event) =>
                showTooltip(event, point.label, [
                  {
                    name: scatter.xField,
                    value: point.x,
                    display: formatChartValue(point.x, config),
                    color: CHART_COLORS[groupIndex % CHART_COLORS.length],
                  },
                  {
                    name: scatter.yField,
                    value: point.y,
                    display: formatChartValue(point.y, config),
                    color: CHART_COLORS[groupIndex % CHART_COLORS.length],
                  },
                ])
              }
              onMouseLeave={hideTooltip}
              onClick={() => drillValue(scatter.xField, point.x)}
              onPointerDown={(event) =>
                showTooltip(event, point.label, [
                  {
                    name: scatter.xField,
                    value: point.x,
                    display: formatChartValue(point.x, config),
                    color: CHART_COLORS[groupIndex % CHART_COLORS.length],
                  },
                  {
                    name: scatter.yField,
                    value: point.y,
                    display: formatChartValue(point.y, config),
                    color: CHART_COLORS[groupIndex % CHART_COLORS.length],
                  },
                ])
              }
            />
          )
        })}
      </g>
    )
  }

  const csv = () => {
    const exportSeries = baseData.series.filter((item) => !hidden.has(item.name))
    const header = ["category", ...exportSeries.map((item) => item.name)]
    const lines = [header.map(escapeCSV).join(",")]
    baseData.categories.forEach((category, index) => {
      lines.push(
        [category, ...exportSeries.map((item) => String(item.values[index] ?? 0))]
          .map(escapeCSV)
          .join(","),
      )
    })
    return lines.join("\n")
  }

  const copyCSV = async () => {
    const ok = await copyToClipboard(csv())
    ok ? toast.success(t("common.copied")) : toast.error(t("common.copyFailed"))
  }

  const downloadCSV = () => {
    saveBlob(new Blob([csv()], { type: "text/csv;charset=utf-8" }), "chart.csv")
  }

  const copyJSON = async () => {
    const exportSeries = baseData.series.filter((item) => !hidden.has(item.name))
    const payload = {
      categories: baseData.categories,
      series: exportSeries.map(({ name, values }) => ({ name, values })),
    }
    const ok = await copyToClipboard(JSON.stringify(payload, null, 2))
    ok ? toast.success(t("common.copied")) : toast.error(t("common.copyFailed"))
  }

  const exportSVG = () => {
    const svg = svgRef.current
    if (!svg) return
    const clone = inlineSVG(svg, chartWidth, chartHeight)
    saveBlob(
      new Blob([new XMLSerializer().serializeToString(clone)], {
        type: "image/svg+xml;charset=utf-8",
      }),
      "chart.svg",
    )
  }

  const exportPNG = async () => {
    const svg = svgRef.current
    if (!svg) return
    const clone = inlineSVG(svg, chartWidth, chartHeight)
    const markup = new XMLSerializer().serializeToString(clone)
    const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }))
    try {
      const image = new Image()
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error("image"))
        image.src = url
      })
      const ratio = window.devicePixelRatio || 1
      const canvas = document.createElement("canvas")
      canvas.width = chartWidth * ratio
      canvas.height = chartHeight * ratio
      const context = canvas.getContext("2d")
      if (!context) return
      context.scale(ratio, ratio)
      const background = window
        .getComputedStyle(document.documentElement)
        .getPropertyValue("--background")
        .trim()
      context.fillStyle = background || "#ffffff"
      context.fillRect(0, 0, chartWidth, chartHeight)
      context.drawImage(image, 0, 0, chartWidth, chartHeight)
      canvas.toBlob((blob) => {
        if (blob) saveBlob(blob, "chart.png")
      })
    } catch {
      toast.error(t("chart.exportFailed"))
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  const legendItems = () => {
    if (config.type === "pie" || config.type === "scatter") {
      return (config.type === "pie" ? data.categories : scatterGroups).map((name, index) => (
        <span
          key={name}
          className="text-muted-foreground flex items-center gap-1.5 text-xs"
        >
          <span
            className="inline-block size-2.5 rounded-sm"
            style={{ background: CHART_COLORS[index % CHART_COLORS.length] }}
          />
          <span className="text-foreground max-w-[12rem] truncate" title={name}>
            {name}
          </span>
        </span>
      ))
    }
    return data.series.map((item, index) => (
      <button
        key={item.name}
        type="button"
        onClick={() => toggleSeries(item.name)}
        aria-pressed={!hidden.has(item.name)}
        title={t("chart.toggleSeries")}
        className={cn(
          "text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-xs",
          hidden.has(item.name) && "opacity-40 line-through",
        )}
      >
        <span
          className="inline-block size-2.5 rounded-sm"
          style={{ background: CHART_COLORS[index % CHART_COLORS.length] }}
        />
        <span className="text-foreground max-w-[12rem] truncate">{item.name}</span>
      </button>
    ))
  }

  const errorHint = (() => {
    if (!error) return null
    if (/dateTrunc|dateFromString|\$convert|Unrecognized expression|invalid.*date/i.test(error)) {
      return t("chart.error.date")
    }
    if (/not authorized|unauthorized|requires authentication/i.test(error)) {
      return t("chart.error.auth")
    }
    if (/exceeded time limit|operation exceeded|maxTimeMS/i.test(error)) {
      return t("chart.error.timeout")
    }
    if (/BSONObj|too large|document too large/i.test(error)) {
      return t("chart.error.large")
    }
    return null
  })()

  const summary = scatter
    ? `${t(`chart.type.scatter`)}: ${scatter.xField} / ${scatter.yField}, ${scatter.points.length}`
    : t("chart.summary", {
        type: t(`chart.type.${config.type}`),
        categories: data.categories.length,
        series: series.length,
      })

  const xOptions = config.type === "scatter" ? numericColumns : fieldNames
  const allViews = React.useMemo(
    () => [
      ...teamViews.map((view) => ({ ...view, shared: true })),
      ...views.map((view) => ({ ...view, shared: false })),
    ],
    [teamViews, views],
  )

  return (
    <div
      ref={rootRef}
      className={cn(
        "relative flex h-full min-h-0 flex-col",
        isFullscreen && "bg-background",
        className,
      )}
    >
      {isFullscreen ? (
        <Button
          variant="outline"
          size="sm"
          className="absolute top-2 right-2 z-30"
          onClick={toggleFullscreen}
          title={t("chart.exitFullscreen")}
        >
          <Minimize2 /> {t("chart.exitFullscreen")}
        </Button>
      ) : null}
      <div
        className={cn(
          "flex shrink-0 flex-wrap items-end gap-3 border-b p-3",
          (!configOpen || compact || isFullscreen) && "hidden",
        )}
      >
        <div className="grid gap-1.5">
          <Label className="text-xs">{t("chart.type")}</Label>
          <Select
            value={config.type}
            onValueChange={(value) => {
              const type = value as ChartType
              const leavingScatter = config.type === "scatter" && type !== "scatter"
              update({
                type,
                group: type === "pie" ? "" : config.group,
                y: type === "pie" || type === "scatter" ? config.y.slice(0, 1) : config.y,
                aggregate:
                  type === "scatter"
                    ? "none"
                    : leavingScatter && config.aggregate === "none"
                      ? config.y.length > 0
                        ? "none"
                        : "count"
                      : config.aggregate,
              })
            }}
          >
            <SelectTrigger size="sm" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHART_TYPES.map(({ value, labelKey, icon: Icon }) => (
                <SelectItem key={value} value={value}>
                  <span className="flex items-center gap-2">
                    <Icon className="size-3.5" /> {t(labelKey)}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label className="text-xs">{t("chart.xAxis")}</Label>
          <Select
            value={config.x || " "}
            onValueChange={(value) => {
              const x = value.trim()
              update({ x, group: config.group === x ? "" : config.group })
            }}
          >
            <SelectTrigger size="sm" className="w-44">
              <SelectValue placeholder={t("chart.pickField")} />
            </SelectTrigger>
            <SelectContent>
              {xOptions.filter(fieldMatches).map((column) => (
                <SelectItem key={column} value={column || " "}>
                  {column}
                  {typeOf(column) ? ` · ${typeOf(column)}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label className="text-xs">{t("chart.xAxisFormat")}</Label>
          <Select
            value={config.xAxisFormat}
            onValueChange={(value) => update({ xAxisFormat: value as ChartConfig["xAxisFormat"] })}
          >
            <SelectTrigger size="sm" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">{t("chart.xformat.auto")}</SelectItem>
              <SelectItem value="number">{t("chart.xformat.number")}</SelectItem>
              <SelectItem value="compact">{t("chart.xformat.compact")}</SelectItem>
              <SelectItem value="percent">{t("chart.xformat.percent")}</SelectItem>
              <SelectItem value="date">{t("chart.xformat.date")}</SelectItem>
              <SelectItem value="datetime">{t("chart.xformat.datetime")}</SelectItem>
              <SelectItem value="year">{t("chart.xformat.year")}</SelectItem>
              <SelectItem value="month">{t("chart.xformat.month")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label className="text-xs">{t("chart.aggregation")}</Label>
          <Select
            value={config.aggregate}
            onValueChange={(value) => update({ aggregate: value as ChartAggregate })}
            disabled={config.type === "scatter"}
          >
            <SelectTrigger size="sm" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="count">{t("chart.agg.count")}</SelectItem>
              <SelectItem value="sum">{t("chart.agg.sum")}</SelectItem>
              <SelectItem value="avg">{t("chart.agg.avg")}</SelectItem>
              <SelectItem value="min">{t("chart.agg.min")}</SelectItem>
              <SelectItem value="max">{t("chart.agg.max")}</SelectItem>
              <SelectItem value="none">{t("chart.agg.none")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label className="text-xs">{t("chart.group")}</Label>
          <Select
            value={config.group || "__none__"}
            onValueChange={(value) => {
              const group = value === "__none__" ? "" : value
              update({
                group,
                y: group ? config.y.slice(0, 1) : config.y,
                // Grouping needs an aggregation; leave Raw mode automatically.
                aggregate:
                  group && config.aggregate === "none"
                    ? config.y.length > 0
                      ? "sum"
                      : "count"
                    : config.aggregate,
              })
            }}
            disabled={config.type === "pie"}
          >
            <SelectTrigger size="sm" className="w-44" title={t("chart.groupHint")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">{t("chart.groupNone")}</SelectItem>
              {fieldNames
                .filter((column) => column !== config.x && fieldMatches(column))
                .map((column) => (
                  <SelectItem key={column} value={column}>
                    {column}
                    {typeOf(column) ? ` · ${typeOf(column)}` : ""}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>

        {temporalX && config.type !== "scatter" && config.aggregate !== "none" ? (
          <div className="grid gap-1.5">
            <Label className="text-xs">{t("chart.bucket")}</Label>
            <Select
              value={config.timeBucket}
              onValueChange={(value) => update({ timeBucket: value as ChartTimeBucket })}
            >
              <SelectTrigger size="sm" className="w-28" title={t("chart.bucketHint")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIME_BUCKETS.map(({ value, labelKey }) => (
                  <SelectItem key={value} value={value}>
                    {t(labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {temporalX && config.type !== "scatter" && config.aggregate !== "none" ? (
          <div className="grid gap-1.5">
            <Label className="text-xs">{t("chart.timezone")}</Label>
            <Select
              value={config.timeZone}
              onValueChange={(value) => update({ timeZone: value as ChartTimeZone })}
            >
              <SelectTrigger size="sm" className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="utc">{t("chart.timezone.utc")}</SelectItem>
                <SelectItem value="local">{t("chart.timezone.local")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}

        <div className="grid gap-1.5">
          <Label className="text-xs">{t("chart.sort")}</Label>
          <Select value={config.sort} onValueChange={(value) => update({ sort: value as ChartSort })}>
            <SelectTrigger size="sm" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("chart.sort.none")}</SelectItem>
              <SelectItem value="desc">{t("chart.sort.desc")}</SelectItem>
              <SelectItem value="asc">{t("chart.sort.asc")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label className="text-xs">{t("chart.limit")}</Label>
          <Input
            value={String(config.limit)}
            onChange={(event) => {
              const next = Number(event.target.value)
              update({ limit: Number.isFinite(next) && next > 0 ? Math.min(next, 500) : 20 })
            }}
            className="h-8 w-20 font-mono text-xs"
            inputMode="numeric"
          />
        </div>

        <div className="grid gap-1.5">
          <Label className="text-xs">{t("chart.titleLabel")}</Label>
          <Input
            value={config.title}
            onChange={(event) => update({ title: event.target.value })}
            placeholder={t("chart.titlePlaceholder")}
            className="h-8 w-44 text-xs"
          />
        </div>

        <div className="grid gap-1.5">
          <Label className="text-xs">{t("chart.numberFormat")}</Label>
          <Select
            value={config.numberFormat}
            onValueChange={(value) => update({ numberFormat: value as ChartConfig["numberFormat"] })}
          >
            <SelectTrigger size="sm" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">{t("chart.format.auto")}</SelectItem>
              <SelectItem value="plain">{t("chart.format.plain")}</SelectItem>
              <SelectItem value="percent">{t("chart.format.percent")}</SelectItem>
              <SelectItem value="currency">{t("chart.format.currency")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label className="text-xs">{t("chart.yAxisScale")}</Label>
          <Select
            value={config.yAxisScale}
            onValueChange={(value) => update({ yAxisScale: value as ChartAxisScale })}
          >
            <SelectTrigger size="sm" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("chart.scale.none")}</SelectItem>
              <SelectItem value="k">{t("chart.scale.k")}</SelectItem>
              <SelectItem value="m">{t("chart.scale.m")}</SelectItem>
              <SelectItem value="b">{t("chart.scale.b")}</SelectItem>
              <SelectItem value="bytes">{t("chart.scale.bytes")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label className="text-xs">{t("chart.unit")}</Label>
          <Input
            value={config.unit}
            onChange={(event) => update({ unit: event.target.value })}
            placeholder="%, $, kg"
            className="h-8 w-20 text-xs"
          />
        </div>

        <div className="grid gap-1.5">
          <Label className="text-xs">{t("chart.decimals")}</Label>
          <Input
            value={config.decimals === null ? "" : String(config.decimals)}
            onChange={(event) => {
              const raw = event.target.value.trim()
              const next = Number(raw)
              update({
                decimals:
                  raw === "" || !Number.isFinite(next)
                    ? null
                    : Math.max(0, Math.min(6, Math.floor(next))),
              })
            }}
            placeholder="auto"
            inputMode="numeric"
            className="h-8 w-16 text-xs"
          />
        </div>

        <div className="grid gap-1.5">
          <Label className="text-xs">{t("chart.referenceLine")}</Label>
          <Input
            value={config.referenceLine === null ? "" : String(config.referenceLine)}
            onChange={(event) => {
              const raw = event.target.value.trim()
              const next = Number(raw)
              update({ referenceLine: raw === "" || !Number.isFinite(next) ? null : next })
            }}
            placeholder="—"
            inputMode="decimal"
            className="h-8 w-20 text-xs"
          />
        </div>

        <label className="flex items-center gap-2 pb-2 text-xs">
          <Switch
            checked={config.others}
            onCheckedChange={(checked) => update({ others: checked })}
          />
          {t("chart.mergeOthers")}
        </label>

        {config.type === "bar" ? (
          <label className="flex items-center gap-2 pb-2 text-xs">
            <Switch
              checked={config.stacked}
              onCheckedChange={(checked) => update({ stacked: checked })}
            />
            {t("chart.stacked")}
          </label>
        ) : null}
        {config.type === "bar" && config.stacked ? (
          <label className="flex items-center gap-2 pb-2 text-xs">
            <Switch
              checked={config.percentStacked}
              onCheckedChange={(checked) => update({ percentStacked: checked })}
            />
            {t("chart.percentStacked")}
          </label>
        ) : null}

        <label className="flex items-center gap-2 pb-2 text-xs">
          <Switch
            checked={config.showValues}
            onCheckedChange={(checked) => update({ showValues: checked })}
          />
          {t("chart.showValues")}
        </label>

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRefreshToken((value) => value + 1)}
            disabled={loading || !serverMode}
            title={t("common.refresh")}
          >
            <RefreshCw className={cn(loading && "animate-spin")} />
            <span className="hidden sm:inline">{t("common.refresh")}</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setConfig(suggestChartConfig([...documents, ...probeDocs], fieldNames))
              setHidden(new Set())
            }}
            title={t("chart.recommend")}
          >
            <Sparkles />
            <span className="hidden lg:inline">{t("chart.recommend")}</span>
          </Button>
          <Button variant="outline" size="sm" onClick={reset} title={t("chart.reset")}>
            <RotateCcw />
            <span className="hidden sm:inline">{t("chart.reset")}</span>
          </Button>
          {onShare ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onShare(config)}
              title={t("chart.copyLink")}
            >
              <Share2 />
              <span className="hidden lg:inline">{t("chart.copyLink")}</span>
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setViewsOpen(true)}
            title={t("chart.views")}
            disabled={!viewsKey}
          >
            <Bookmark />
            <span className="hidden lg:inline">{t("chart.views")}</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" title={t("chart.export")}>
                <Download />
                <span className="hidden sm:inline">{t("chart.export")}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onSelect={() => void copyCSV()}>
                <Copy /> {t("chart.copyCSV")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={downloadCSV}>
                <Download /> {t("chart.downloadCSV")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void copyJSON()}>
                <Copy /> {t("chart.copyJSON")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={exportSVG}>
                <Download /> {t("chart.downloadSVG")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void exportPNG()}>
                <Download /> {t("chart.downloadPNG")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant={showTable ? "secondary" : "outline"}
            size="sm"
            onClick={() => setShowTable((value) => !value)}
            title={t("chart.dataTable")}
          >
            <Table2 />
          </Button>
          {onApplyFilter ? (
            <Button variant="outline" size="sm" onClick={() => onApplyFilter()}>
              {t("chart.applyToDocuments")}
            </Button>
          ) : null}
        </div>

        <div className="grid w-full gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Label className="text-xs">{t("chart.yAxis")}</Label>
            <div className="relative">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2" />
              <Input
                value={fieldQuery}
                onChange={(event) => setFieldQuery(event.target.value)}
                placeholder={t("chart.searchFields")}
                className="h-7 w-44 pl-7 text-xs"
              />
            </div>
          </div>
          {numericColumns.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {numericColumns.filter(fieldMatches).map((column) => {
                const active = config.y.includes(column)
                return (
                  <button
                    key={column}
                    type="button"
                    aria-pressed={active}
                    title={`${column}${typeOf(column) ? ` · ${typeOf(column)}` : ""}`}
                    onClick={() => {
                      toggleY(column)
                      if (!active && config.aggregate === "count" && config.type !== "scatter") {
                        update({ aggregate: "sum" })
                      }
                    }}
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 font-mono text-xs transition-colors",
                      active
                        ? "border-primary bg-primary/10 text-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent",
                    )}
                  >
                    {column}
                  </button>
                )
              })}
              {config.aggregate === "count" && config.type !== "scatter" ? (
                <span className="text-muted-foreground text-[11px]">{t("chart.countHint")}</span>
              ) : null}
            </div>
          ) : (
            <p className="text-muted-foreground text-xs">{t("chart.noNumeric")}</p>
          )}
        </div>
      </div>

      <div ref={ref} className="scrollbar-thin relative min-h-0 flex-1 overflow-auto p-3">
        <div
          className={cn(
            "mb-2 flex flex-wrap items-center gap-2 text-[11px]",
            (compact || isFullscreen) && "hidden",
          )}
        >
          <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5">
            {serverMode ? t("chart.serverData") : t("chart.pageData")}
          </span>
          <Button
            variant={configOpen ? "secondary" : "outline"}
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={() => setConfigOpen((value) => !value)}
          >
            <SlidersHorizontal className="size-3" /> {t("chart.configure")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={toggleFullscreen}
            title={t("chart.fullscreen")}
          >
            <Maximize2 className="size-3" />
          </Button>
          {temporalX && !scatterMode ? (
            <Button
              variant={brushMode ? "secondary" : "outline"}
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() => {
                setBrushMode((value) => !value)
                setBrush(null)
              }}
              title={t("chart.brush")}
            >
              <Crop className="size-3" /> {t("chart.brush")}
            </Button>
          ) : null}
          {zoom ? (
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() => setZoom(null)}
            >
              {t("chart.resetZoom")}
            </Button>
          ) : null}
          {brushMode ? (
            <span className="text-muted-foreground">{t("chart.brushHint")}</span>
          ) : null}
          {config.aggregate === "none" && serverMode ? (
            <span className="text-muted-foreground">
              {t("chart.rawHint", {
                shown: data.categories.length,
                total: rawTotal ?? data.categories.length,
              })}
            </span>
          ) : null}
          {config.aggregate === "none" && serverMode ? (
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() => update({ limit: Math.min(Math.max(config.limit * 2, 40), 500) })}
            >
              {t("chart.showMore")}
            </Button>
          ) : null}
          {config.aggregate === "none" && serverMode ? (
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() => update({ aggregate: config.y.length > 0 ? "sum" : "count" })}
            >
              {t("chart.useAggregate")}
            </Button>
          ) : null}
          {crowded ? (
            <span className="text-muted-foreground flex flex-wrap items-center gap-1">
              <AlertTriangle className="size-3 text-amber-500" />
              {t("chart.crowded")}
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-2 text-[11px]"
                onClick={() => update({ others: true })}
              >
                {t("chart.mergeOthers")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-2 text-[11px]"
                onClick={() => update({ type: "hbar" })}
              >
                {t("chart.type.hbar")}
              </Button>
            </span>
          ) : null}
          {downsampled ? (
            <span className="text-muted-foreground">
              {t("chart.downsampled", { shown: data.categories.length })}
            </span>
          ) : null}
          {loading ? (
            <span className="text-muted-foreground flex items-center gap-1">
              <Loader2 className="size-3 animate-spin" /> {t("common.loading")}
            </span>
          ) : null}
          {error ? (
            <span className="text-destructive flex flex-wrap items-center gap-2">
              <span className="max-w-[32rem] truncate" title={error}>
                {error}
              </span>
              {errorHint ? (
                <span className="text-muted-foreground">· {errorHint}</span>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-2 text-[11px]"
                onClick={() => setRefreshToken((value) => value + 1)}
              >
                {t("common.retry")}
              </Button>
            </span>
          ) : null}
        </div>

        {compact && error ? (
          <p className="text-destructive mb-2 text-xs">{error}</p>
        ) : null}
        {!hasData ? (
          <div className="text-muted-foreground flex h-40 items-center justify-center text-sm">
            {t("chart.empty")}
          </div>
        ) : (
          <>
            {config.title && !compact ? (
              <h3 className="mb-2 text-sm font-medium">{config.title}</h3>
            ) : null}
            <svg
              ref={svgRef}
              width={chartWidth}
              height={chartHeight}
              className="block"
              role="img"
              aria-label={`${summary}. ${t("chart.keyboardHint")}`}
              style={{ touchAction: "pan-y" }}
              tabIndex={0}
              onBlur={() => {
                setFocusIndex(null)
                hideTooltip()
              }}
              onKeyDown={(event) => {
                if (data.categories.length === 0) return
                if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                  event.preventDefault()
                  focusCategory(
                    (focusIndex ?? 0) + (event.key === "ArrowRight" ? 1 : -1),
                  )
                } else if (event.key === "Enter" && focusIndex !== null) {
                  event.preventDefault()
                  drill(focusIndex)
                } else if (event.key === "Escape") {
                  setFocusIndex(null)
                  hideTooltip()
                }
              }}
              onDoubleClick={() => setZoom(null)}
              onPointerDown={(event) => {
                if (event.pointerType !== "touch" || brushMode) return
                pointersRef.current.set(event.pointerId, {
                  x: event.clientX,
                  y: event.clientY,
                })
                if (pointersRef.current.size === 2) startPinch()
              }}
              onPointerMove={(event) => {
                if (
                  event.pointerType !== "touch" ||
                  brushMode ||
                  !pointersRef.current.has(event.pointerId)
                ) {
                  return
                }
                pointersRef.current.set(event.pointerId, {
                  x: event.clientX,
                  y: event.clientY,
                })
                if (pointersRef.current.size === 2) movePinch()
              }}
              onPointerUp={(event) => endPinch(event.pointerId)}
              onPointerCancel={(event) => endPinch(event.pointerId)}
            >
              <title>{summary}</title>
              {scatterMode ? (
                <>
                  {renderScatterAxes()}
                  {renderScatter()}
                </>
              ) : (
                <>
                  {horizontal ? (
                    <>
                      {scale.ticks.map((tick) => (
                        <g key={`hx-${tick}`}>
                          <line
                            x1={xForValue(tick)}
                            x2={xForValue(tick)}
                            y1={margin.top}
                            y2={margin.top + plotHeight}
                            className="stroke-border"
                            strokeDasharray="3 3"
                          />
                          <text
                            x={xForValue(tick)}
                            y={margin.top + plotHeight + 14}
                            textAnchor="middle"
                            className="fill-muted-foreground text-[10px]"
                          >
                            {formatTick(tick)}
                          </text>
                        </g>
                      ))}
                      {data.categories.map((category, index) => {
                        const band = plotHeight / Math.max(1, data.categories.length)
                        return (
                          <text
                            key={index}
                            x={margin.left - 8}
                            y={margin.top + (index + 0.5) * band + 3}
                            textAnchor="end"
                            className="fill-muted-foreground text-[10px]"
                          >
                            {category.length > 16 ? `${category.slice(0, 15)}…` : category}
                          </text>
                        )
                      })}
                      {renderHBars()}
                      {config.referenceLine !== null &&
                      config.referenceLine >= scale.min &&
                      config.referenceLine <= scale.max ? (
                        <g>
                          <line
                            x1={xForValue(config.referenceLine)}
                            x2={xForValue(config.referenceLine)}
                            y1={margin.top}
                            y2={margin.top + plotHeight}
                            stroke="var(--chart-1)"
                            strokeDasharray="4 4"
                          />
                          <text
                            x={xForValue(config.referenceLine)}
                            y={margin.top - 4}
                            textAnchor="middle"
                            className="fill-muted-foreground text-[9px]"
                          >
                            {formatChartValue(config.referenceLine, config)}
                          </text>
                        </g>
                      ) : null}
                    </>
                  ) : (
                    <>
                      {config.type !== "pie" ? (
                        <>
                          {renderAxes()}
                          {renderXLabels()}
                        </>
                      ) : null}
                      {config.type === "bar" ? renderBars() : null}
                      {config.type === "combo" ? renderCombo() : null}
                      {config.type === "combo" && comboLines.length > 0
                        ? renderRightAxis()
                        : null}
                      {config.type === "line" ? renderLines(false) : null}
                      {config.type === "area" ? renderLines(true) : null}
                      {config.type === "pie" ? renderPie() : null}
                      {!scatterMode &&
                      config.type !== "pie" &&
                      config.referenceLine !== null &&
                      config.referenceLine >= scale.min &&
                      config.referenceLine <= scale.max ? (
                        <g>
                          <line
                            x1={margin.left}
                            x2={margin.left + plotWidth}
                            y1={yFor(config.referenceLine)}
                            y2={yFor(config.referenceLine)}
                            stroke="var(--chart-1)"
                            strokeDasharray="4 4"
                          />
                          <text
                            x={margin.left + plotWidth}
                            y={yFor(config.referenceLine) - 4}
                            textAnchor="end"
                            className="fill-muted-foreground text-[9px]"
                          >
                            {formatChartValue(config.referenceLine, config)}
                          </text>
                        </g>
                      ) : null}
                      {config.type !== "pie" ? (
                        <>
                          <text
                            x={margin.left + plotWidth}
                            y={chartHeight - 10}
                            textAnchor="end"
                            className="fill-muted-foreground text-[9px]"
                          >
                            {config.x}
                          </text>
                          <text
                            x={12}
                            y={margin.top}
                            transform={`rotate(-90, 12, ${margin.top})`}
                            textAnchor="end"
                            className="fill-muted-foreground text-[9px]"
                          >
                            {comboMode
                              ? comboBar[0]?.name ?? ""
                              : config.y.join(", ") || t("chart.agg.count")}
                          </text>
                          {comboMode && comboLines[0] ? (
                            <text
                              x={margin.left + plotWidth}
                              y={margin.top - 8}
                              textAnchor="end"
                              className="fill-muted-foreground text-[9px]"
                            >
                              {comboLines[0].name}
                            </text>
                          ) : null}
                        </>
                      ) : null}
                    </>
                  )}
                </>
              )}
              {focusIndex !== null && !scatterMode ? (
                <line
                  x1={margin.left + (focusIndex + 0.5) * (plotWidth / Math.max(1, data.categories.length))}
                  x2={margin.left + (focusIndex + 0.5) * (plotWidth / Math.max(1, data.categories.length))}
                  y1={margin.top}
                  y2={margin.top + plotHeight}
                  stroke="var(--ring)"
                  strokeDasharray="3 3"
                  pointerEvents="none"
                />
              ) : null}
              {brushMode ? (
                <g>
                  <rect
                    x={margin.left}
                    y={margin.top}
                    width={plotWidth}
                    height={plotHeight}
                    fill="transparent"
                    className="cursor-crosshair"
                    onPointerDown={startBrush}
                    onPointerMove={moveBrush}
                    onPointerUp={finishBrush}
                    onPointerCancel={() => {
                      setBrush(null)
                      setBrushMode(false)
                    }}
                  />
                  {brush ? (
                    <rect
                      x={margin.left + Math.min(brush.start, brush.end)}
                      y={margin.top}
                      width={Math.abs(brush.end - brush.start)}
                      height={plotHeight}
                      fill="var(--primary)"
                      opacity={0.15}
                      pointerEvents="none"
                    />
                  ) : null}
                </g>
              ) : null}
            </svg>

            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">{legendItems()}</div>

            {showTable ? (
              <div className="scrollbar-thin mt-3 max-h-64 overflow-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="px-2 py-1 text-left font-medium">{config.x || "—"}</th>
                      {series.map((item) => (
                        <th key={item.name} className="px-2 py-1 text-right font-medium">
                          {item.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.categories.map((category, index) => (
                      <tr key={`${category}-${index}`} className="border-t">
                        <td className="max-w-[18rem] truncate px-2 py-1" title={category}>
                          {category}
                        </td>
                        {series.map((item) => (
                          <td key={item.name} className="px-2 py-1 text-right font-mono">
                            {formatChartValue(item.values[index] ?? 0, config)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        )}

        <Dialog open={viewsOpen} onOpenChange={setViewsOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t("chart.views")}</DialogTitle>
              <DialogDescription>{t("chart.viewsDesc")}</DialogDescription>
            </DialogHeader>
            <div className="max-h-56 space-y-1 overflow-auto">
              {allViews.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t("chart.noViews")}</p>
              ) : (
                allViews.map((view) => (
                  <div
                    key={`${view.shared ? "team" : "local"}-${view.id}`}
                    className="hover:bg-accent/50 flex items-center gap-2 rounded-md border px-2 py-1.5"
                  >
                    <button
                      type="button"
                      onClick={() => applyView(view)}
                      className="min-w-0 flex-1 text-left text-sm"
                      title={view.name}
                    >
                      <span className="block truncate">{view.name}</span>
                      <span className="text-muted-foreground text-[10px]">
                        {view.shared ? t("chart.teamView") : t("chart.localView")}
                        {view.pinned ? ` · ${t("chart.pinnedView")}` : ""}
                        {view.updatedBy ? ` · ${view.updatedBy}` : ""}
                      </span>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("chart.deleteView")}
                      onClick={() => void deleteView(view)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("chart.viewName")}</Label>
              <div className="flex items-center gap-2">
                <Input
                  value={viewName}
                  onChange={(event) => setViewName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault()
                      saveView()
                    }
                  }}
                  placeholder={t("chart.viewNamePlaceholder")}
                />
                <Button onClick={() => void saveView()} disabled={!viewName.trim()}>
                  <Plus /> {t("common.save")}
                </Button>
              </div>
              {scope ? (
                <label className="flex items-center gap-2 text-xs">
                  <Switch checked={shareView} onCheckedChange={setShareView} />
                  {t("chart.shareTeam")}
                </label>
              ) : null}
              {scope && shareView ? (
                <label className="flex items-center gap-2 text-xs">
                  <Switch checked={pinView} onCheckedChange={setPinView} />
                  {t("chart.pinOverview")}
                </label>
              ) : null}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setViewsOpen(false)}>
                {t("common.close")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {tooltip ? (
          <div
            className="bg-popover text-popover-foreground pointer-events-none absolute z-20 min-w-[8rem] rounded-md border p-2 text-xs shadow-md"
            style={{
              left: Math.min(tooltip.x + 12, Math.max(0, chartWidth - 180)),
              top: Math.max(0, tooltip.y - 8),
            }}
          >
            <div className="mb-1 max-w-[16rem] truncate font-medium" title={tooltip.title}>
              {tooltip.title}
            </div>
            {tooltip.rows.map((row) => (
              <div key={row.name} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block size-2 rounded-full"
                    style={{ background: row.color }}
                  />
                  <span className="text-muted-foreground max-w-[9rem] truncate">{row.name}</span>
                </span>
                <span className="font-mono">{row.value}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
