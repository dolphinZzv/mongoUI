import * as React from "react"
import {
  AreaChart as AreaIcon,
  BarChart3,
  Bookmark,
  Copy,
  Download,
  Loader2,
  LineChart,
  PieChart,
  Plus,
  RefreshCw,
  RotateCcw,
  Share2,
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
import { api, isAbortError } from "@/lib/api"
import { copyToClipboard } from "@/lib/clipboard"
import { useI18n } from "@/lib/i18n"
import {
  buildChartData,
  buildChartPipeline,
  buildScatterData,
  chartDataFromRows,
  CHART_COLORS,
  formatNumber,
  normalizeChartConfig,
  isTemporalColumn,
  niceScale,
  suggestChartConfig,
  toNumeric,
  type ChartAggregate,
  type ChartConfig,
  type ChartSort,
  type ChartTimeBucket,
  type ChartType,
  type ScatterPoint,
} from "@/lib/chart"
import { cn } from "@/lib/utils"
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

interface SavedChartView {
  id: string
  name: string
  config: ChartConfig
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
  storageKey,
  height = 380,
  className,
  onDrilldown,
  onApplyFilter,
}: ChartViewProps) {
  const { t } = useI18n()
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
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const viewsKey = storageKey ? `mongoui-chart-views:${storageKey}` : ""
  const [views, setViews] = React.useState<SavedChartView[]>(() => readSavedViews(viewsKey))
  const [viewsOpen, setViewsOpen] = React.useState(false)
  const [viewName, setViewName] = React.useState("")
  const columnsKey = columns.join("|")
  const serverMode = Boolean(connectionId && database && collection)

  // Re-detect when the result shape changes and the current config no longer fits.
  React.useEffect(() => {
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
    () => isTemporalColumn(documents, config.x) || /date/i.test(fieldTypes?.[config.x] ?? ""),
    [documents, fieldTypes, config.x],
  )

  const effectiveConfig = React.useMemo<ChartConfig>(
    () => ({
      ...config,
      timeBucket:
        temporalX && config.type !== "scatter" && config.aggregate !== "none"
          ? config.timeBucket
          : "none",
    }),
    [config, temporalX],
  )

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

  const data = React.useMemo(() => {
    if (config.type === "scatter") return { categories: [], series: [], rawCategories: [] }
    if (serverMode && config.aggregate !== "none") {
      return chartDataFromRows(rows ?? [], effectiveConfig, t("chart.others"))
    }
    return buildChartData(source, effectiveConfig, t("chart.others"))
  }, [serverMode, rows, source, effectiveConfig, config.type, config.aggregate, t])

  const scatter = React.useMemo(
    () => (config.type === "scatter" ? buildScatterData(source, effectiveConfig) : null),
    [config.type, source, effectiveConfig],
  )

  const numericColumns = React.useMemo(
    () => columns.filter((column) => documents.some((doc) => toNumeric(doc[column]) !== null)),
    [columns, documents],
  )

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
  const plotHeight = Math.max(60, height - margin.top - margin.bottom)

  const stacked =
    config.type === "bar" &&
    config.stacked &&
    series.length > 1 &&
    series.every((item) => item.values.every((value) => value >= 0))

  const scaleValues = horizontal
    ? series.flatMap((item) => item.values)
    : stacked
      ? data.categories.map((_, index) =>
          series.reduce((sum, item) => sum + (item.values[index] ?? 0), 0),
        )
      : series.flatMap((item) => item.values)
  const scale = niceScale(
    Math.min(0, ...(scaleValues.length ? scaleValues : [0])),
    Math.max(0, ...(scaleValues.length ? scaleValues : [1])),
    5,
  )

  const yFor = (value: number) =>
    margin.top + plotHeight - ((value - scale.min) / (scale.max - scale.min || 1)) * plotHeight
  const xForValue = (value: number) =>
    margin.left + ((value - scale.min) / (scale.max - scale.min || 1)) * plotWidth

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

  const saveView = () => {
    const name = viewName.trim()
    if (!name) return
    setViews((prev) => [
      ...prev,
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name, config },
    ])
    setViewName("")
    setViewsOpen(false)
    toast.success(t("chart.viewSaved"))
  }

  const applyView = (view: SavedChartView) => {
    setConfig({ ...view.config })
    setHidden(new Set())
    setViewsOpen(false)
  }

  const deleteView = (id: string) => {
    setViews((prev) => prev.filter((view) => view.id !== id))
  }

  const toggleSeries = (name: string) => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const showTooltip = (
    event: React.MouseEvent,
    title: string,
    rows: { name: string; value: number; display?: string; color?: string }[],
  ) => {
    const container = ref.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    setTooltip({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      title,
      rows: rows.map((row, index) => ({
        name: row.name,
        value: row.display ?? formatNumber(row.value),
        color: row.color ?? CHART_COLORS[index % CHART_COLORS.length],
      })),
    })
  }

  const hideTooltip = () => setTooltip(null)

  const drill = (index: number) => {
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
    if (!onDrilldown || !field) return
    onDrilldown({ [field]: value })
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
              {formatNumber(tick)}
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
            let offset = 0
            return series.map((item, si) => {
              const value = Math.max(0, item.values[ci] ?? 0)
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
                  onClick={() => drill(ci)}
                />
                {config.showValues && barWidth > 22 && h > 12 ? (
                  <text
                    x={x + Math.max(1, barWidth) / 2}
                    y={Math.min(y, baseline) - 4}
                    textAnchor="middle"
                    className="fill-muted-foreground text-[9px]"
                  >
                    {formatNumber(value)}
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
                  onClick={() => drill(ci)}
                />
                {config.showValues && w > 30 ? (
                  <text
                    x={Math.min(x, baseline) + w + 4}
                    y={y + barHeight / 2 + 3}
                    className="fill-muted-foreground text-[9px]"
                  >
                    {formatNumber(value)}
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
              onClick={() => drill(index)}
            />
          )),
        )}
      </g>
    )
  }

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
                      display: `${formatNumber(totals[index])} (${percent}%)`,
                      color: CHART_COLORS[index % CHART_COLORS.length],
                    },
                  ])
                }}
                onMouseLeave={hideTooltip}
                onClick={() => drill(index)}
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
            {formatNumber(tick)}
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
            {formatNumber(tick)}
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
                    display: formatNumber(point.x),
                    color: CHART_COLORS[groupIndex % CHART_COLORS.length],
                  },
                  {
                    name: scatter.yField,
                    value: point.y,
                    display: formatNumber(point.y),
                    color: CHART_COLORS[groupIndex % CHART_COLORS.length],
                  },
                ])
              }
              onMouseLeave={hideTooltip}
              onClick={() => drillValue(scatter.xField, point.x)}
            />
          )
        })}
      </g>
    )
  }

  const csv = () => {
    const header = ["category", ...series.map((item) => item.name)]
    const lines = [header.map(escapeCSV).join(",")]
    data.categories.forEach((category, index) => {
      lines.push(
        [category, ...series.map((item) => String(item.values[index] ?? 0))]
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
    const payload = { categories: data.categories, series: series.map(({ name, values }) => ({ name, values })) }
    const ok = await copyToClipboard(JSON.stringify(payload, null, 2))
    ok ? toast.success(t("common.copied")) : toast.error(t("common.copyFailed"))
  }

  const exportSVG = () => {
    const svg = svgRef.current
    if (!svg) return
    const clone = inlineSVG(svg, chartWidth, height)
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
    const clone = inlineSVG(svg, chartWidth, height)
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
      canvas.height = height * ratio
      const context = canvas.getContext("2d")
      if (!context) return
      context.scale(ratio, ratio)
      const background = window
        .getComputedStyle(document.documentElement)
        .getPropertyValue("--background")
        .trim()
      context.fillStyle = background || "#ffffff"
      context.fillRect(0, 0, chartWidth, height)
      context.drawImage(image, 0, 0, chartWidth, height)
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

  const summary = scatter
    ? `${t(`chart.type.scatter`)}: ${scatter.xField} / ${scatter.yField}, ${scatter.points.length}`
    : t("chart.summary", {
        type: t(`chart.type.${config.type}`),
        categories: data.categories.length,
        series: series.length,
      })

  const xOptions = config.type === "scatter" ? numericColumns : columns

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="flex shrink-0 flex-wrap items-end gap-3 border-b p-3">
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
              {xOptions.map((column) => (
                <SelectItem key={column} value={column || " "}>
                  {column}
                </SelectItem>
              ))}
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
              {columns
                .filter((column) => column !== config.x)
                .map((column) => (
                  <SelectItem key={column} value={column}>
                    {column}
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
              <SelectTrigger size="sm" className="w-28">
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
          <Label className="text-xs">{t("chart.yAxis")}</Label>
          {numericColumns.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {numericColumns.map((column) => {
                const active = config.y.includes(column)
                return (
                  <button
                    key={column}
                    type="button"
                    aria-pressed={active}
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
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
          <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5">
            {serverMode ? t("chart.serverData") : t("chart.pageData")}
          </span>
          {loading ? (
            <span className="text-muted-foreground flex items-center gap-1">
              <Loader2 className="size-3 animate-spin" /> {t("common.loading")}
            </span>
          ) : null}
          {error ? (
            <span className="text-destructive flex items-center gap-2">
              <span className="max-w-[32rem] truncate" title={error}>
                {error}
              </span>
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

        {!hasData ? (
          <div className="text-muted-foreground flex h-40 items-center justify-center text-sm">
            {t("chart.empty")}
          </div>
        ) : (
          <>
            <svg
              ref={svgRef}
              width={chartWidth}
              height={height}
              className="block"
              role="img"
              aria-label={summary}
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
                            {formatNumber(tick)}
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
                      {config.type === "line" ? renderLines(false) : null}
                      {config.type === "area" ? renderLines(true) : null}
                      {config.type === "pie" ? renderPie() : null}
                      {config.type !== "pie" ? (
                        <>
                          <text
                            x={margin.left + plotWidth}
                            y={height - 10}
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
                            {config.y.join(", ") || t("chart.agg.count")}
                          </text>
                        </>
                      ) : null}
                    </>
                  )}
                </>
              )}
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
                            {formatNumber(item.values[index] ?? 0)}
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
              {views.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t("chart.noViews")}</p>
              ) : (
                views.map((view) => (
                  <div
                    key={view.id}
                    className="hover:bg-accent/50 flex items-center gap-2 rounded-md border px-2 py-1.5"
                  >
                    <button
                      type="button"
                      onClick={() => applyView(view)}
                      className="min-w-0 flex-1 truncate text-left text-sm"
                      title={view.name}
                    >
                      {view.name}
                    </button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("chart.deleteView")}
                      onClick={() => deleteView(view.id)}
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
                <Button onClick={saveView} disabled={!viewName.trim()}>
                  <Plus /> {t("common.save")}
                </Button>
              </div>
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
