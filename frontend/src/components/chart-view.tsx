import * as React from "react"
import { Minimize2 } from "lucide-react"
import { toast } from "sonner"

import { ChartConfigPanel } from "@/components/chart-config-panel"
import { ChartDataTable } from "@/components/chart-data-table"
import { ChartLegend } from "@/components/chart-legend"
import { createChartRenderers } from "@/components/chart-renderers"
import { ChartToolbar } from "@/components/chart-toolbar"
import { ChartTooltip, type ChartTooltipState } from "@/components/chart-tooltip"
import { ChartViewsDialog } from "@/components/chart-views-dialog"
import { Button } from "@/components/ui/button"
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
  withLiveWindow,
  normalizeChartConfig,
  resolveTimeBucket,
  isTemporalColumn,
  toDate,
  niceScale,
  suggestChartConfig,
  toNumeric,
  type ChartConfig,
  type ChartData,
  type SavedChartView,
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
  const [tooltip, setTooltip] = React.useState<ChartTooltipState | null>(null)
  const [hidden, setHidden] = React.useState<Set<string>>(new Set())
  const [showTable, setShowTable] = React.useState(false)
  const [refreshToken, setRefreshToken] = React.useState(0)
  const [rows, setRows] = React.useState<MongoDocument[] | null>(null)
  const [rawDocs, setRawDocs] = React.useState<MongoDocument[] | null>(null)
  const [rawTotal, setRawTotal] = React.useState<number | null>(null)
  const [probeDocs, setProbeDocs] = React.useState<MongoDocument[]>([])
  const [fieldQuery, setFieldQuery] = React.useState("")
  const [configOpen, setConfigOpen] = React.useState(false)
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
  const [lastUpdated, setLastUpdated] = React.useState<number | null>(null)
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

  const liveFilter = React.useMemo(
    () =>
      temporalX && config.x
        ? withLiveWindow(filter, config.x, config.liveWindowMinutes)
        : filter ?? {},
    [filter, config.liveWindowMinutes, config.x, temporalX, refreshToken],
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
    filter: liveFilter,
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
            { filter: liveFilter, limit: 1000 },
            controller.signal,
          )
          if (controller.signal.aborted) return
          setRawDocs(res.documents)
          setRawTotal(res.total)
          setRows(null)
          setLastUpdated(Date.now())
        } else {
          const pipeline = buildChartPipeline(effectiveConfig, liveFilter, temporalX)
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
          setLastUpdated(Date.now())
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

  React.useEffect(() => {
    if (!serverMode || config.refreshInterval <= 0) return
    const tick = () => {
      if (document.visibilityState === "visible") {
        setRefreshToken((value) => value + 1)
      }
    }
    const timer = window.setInterval(tick, config.refreshInterval * 1000)
    const onVisibility = () => {
      if (document.visibilityState === "visible") tick()
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [serverMode, config.refreshInterval])

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

  const alertMax = React.useMemo(
    () =>
      series.length === 0
        ? null
        : Math.max(...series.flatMap((item) => item.values.map((value) => Math.abs(value)))),
    [series],
  )
  const alertTriggered = React.useMemo(() => {
    if (
      config.alertOperator === "off" ||
      config.alertThreshold === null ||
      alertMax === null
    ) {
      return false
    }
    return config.alertOperator === "above"
      ? alertMax > config.alertThreshold
      : alertMax < config.alertThreshold
  }, [alertMax, config.alertOperator, config.alertThreshold])

  const alertRef = React.useRef(false)
  React.useEffect(() => {
    if (alertTriggered && !alertRef.current) {
      toast.warning(t("chart.alertTriggered", { value: formatChartValue(alertMax ?? 0, config) }))
    }
    alertRef.current = alertTriggered
  }, [alertTriggered, alertMax, config, t])

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
      if (prev.y.includes(field)) {
        return { ...prev, y: prev.y.filter((item) => item !== field) }
      }
      const y = prev.group || prev.type === "scatter" ? [field] : [...prev.y, field]
      // Picking a value field makes Count meaningless; switch to Sum in place.
      const aggregate =
        prev.aggregate === "count" && prev.type !== "scatter" ? "sum" : prev.aggregate
      return { ...prev, y, aggregate }
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

  const scatterGroups = React.useMemo(() => {
    if (!scatter) return []
    return [...new Set(scatter.points.map((point) => point.group).filter(Boolean))]
  }, [scatter])

  const {
    axes: renderAxes,
    xLabels: renderXLabels,
    bars: renderBars,
    hBars: renderHBars,
    lines: renderLines,
    combo: renderCombo,
    rightAxis: renderRightAxis,
    pie: renderPie,
    scatterAxes: renderScatterAxes,
    scatterPoints: renderScatter,
  } = createChartRenderers({
    config,
    data,
    series,
    margin,
    plotWidth,
    plotHeight,
    scale,
    yFor,
    xForValue,
    rightScale,
    yForRight,
    formatTick,
    stacked,
    percentStacked,
    comboBar,
    comboLines,
    scatter,
    scatterGroups,
    scatterBounds,
    scatterX,
    scatterY,
    showTooltip,
    hideTooltip,
    categoryTooltip,
    drill,
    drillValue,
  })

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
      <div ref={ref} className="scrollbar-thin relative min-h-0 flex-1 overflow-auto p-3">
        <ChartToolbar
          compact={compact}
          isFullscreen={isFullscreen}
          loading={loading}
          serverMode={serverMode}
          config={config}
          update={update}
          showTable={showTable}
          configOpen={configOpen}
          alertTriggered={alertTriggered}
          lastUpdated={lastUpdated}
          temporalX={temporalX}
          scatterMode={scatterMode}
          brushMode={brushMode}
          zoomed={zoom !== null}
          categoryCount={data.categories.length}
          rawTotal={rawTotal}
          crowded={crowded}
          downsampled={downsampled}
          error={error}
          errorHint={errorHint}
          viewsEnabled={Boolean(viewsKey)}
          onRefresh={() => setRefreshToken((value) => value + 1)}
          onRecommend={() => {
            setConfig(suggestChartConfig([...documents, ...probeDocs], fieldNames))
            setHidden(new Set())
          }}
          onReset={reset}
          onShare={onShare ?? undefined}
          onOpenViews={() => setViewsOpen(true)}
          onCopyCSV={() => void copyCSV()}
          onDownloadCSV={downloadCSV}
          onCopyJSON={() => void copyJSON()}
          onExportSVG={exportSVG}
          onExportPNG={() => void exportPNG()}
          onToggleTable={() => setShowTable((value) => !value)}
          onApplyFilter={onApplyFilter ? () => onApplyFilter() : undefined}
          onToggleConfig={() => setConfigOpen((value) => !value)}
          onToggleFullscreen={toggleFullscreen}
          onToggleBrush={() => {
            setBrushMode((value) => !value)
            setBrush(null)
          }}
          onResetZoom={() => setZoom(null)}
        />

        {compact && alertTriggered ? (
          <span className="bg-destructive/10 text-destructive absolute top-2 right-2 z-10 rounded-full border border-destructive/40 px-2 py-0.5 text-[10px] font-medium">
            {t("chart.alert")}
          </span>
        ) : null}
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

            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              <ChartLegend
                type={config.type}
                categories={data.categories}
                scatterGroups={scatterGroups}
                series={data.series}
                hidden={hidden}
                onToggleSeries={toggleSeries}
              />
            </div>

            {showTable ? (
              <ChartDataTable
                config={config}
                categories={data.categories}
                series={data.series}
              />
            ) : null}

          </>
        )}

        <ChartViewsDialog
          open={viewsOpen}
          onOpenChange={setViewsOpen}
          views={allViews}
          scope={scope}
          viewName={viewName}
          onViewNameChange={setViewName}
          shareView={shareView}
          onShareViewChange={setShareView}
          pinView={pinView}
          onPinViewChange={setPinView}
          onSave={() => void saveView()}
          onApply={applyView}
          onDelete={(view) => void deleteView(view)}
        />

        {tooltip ? <ChartTooltip tooltip={tooltip} chartWidth={chartWidth} /> : null}

      </div>
      {configOpen && !compact && !isFullscreen ? (
        <ChartConfigPanel
          config={config}
          update={update}
          temporalX={temporalX}
          xOptions={xOptions}
          fieldNames={fieldNames}
          numericColumns={numericColumns}
          typeOf={typeOf}
          toggleY={toggleY}
          fieldQuery={fieldQuery}
          onFieldQueryChange={setFieldQuery}
          fieldMatches={fieldMatches}
        />
      ) : null}
    </div>
  )
}
