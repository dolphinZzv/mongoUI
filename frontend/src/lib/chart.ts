import { formatBytes, isPlainObject } from "@/lib/mongo"
import type { MongoDocument } from "@/lib/types"

export type ChartType = "bar" | "line" | "area" | "pie" | "hbar" | "scatter" | "combo"
export type ChartAggregate = "none" | "count" | "sum" | "avg" | "min" | "max"
export type ChartSort = "none" | "asc" | "desc"
export type ChartTimeBucket = "none" | "auto" | "day" | "week" | "month" | "quarter" | "year"
export type ChartNumberFormat = "auto" | "plain" | "percent" | "currency"
export type ChartTimeZone = "utc" | "local"
export type ChartAxisScale = "none" | "k" | "m" | "b" | "bytes"
export type ChartXAxisFormat =
  | "auto"
  | "number"
  | "compact"
  | "percent"
  | "date"
  | "datetime"
  | "year"
  | "month"

export interface ChartConfig {
  type: ChartType
  x: string
  y: string[]
  aggregate: ChartAggregate
  sort: ChartSort
  limit: number
  /** Optional categorical field that becomes the series (stacked bars / lines). */
  group: string
  /** Draw bar series on top of each other instead of side by side. */
  stacked: boolean
  /** Truncate temporal x values into buckets instead of one point per value. */
  timeBucket: ChartTimeBucket
  /** Merge categories beyond `limit` into a single "Other" category. */
  others: boolean
  /** Print numeric labels on bars/slices. */
  showValues: boolean
  /** How values are rendered on axes, labels, tooltips and the data table. */
  numberFormat: ChartNumberFormat
  /** Optional unit shown next to values; for currency it is used as a prefix. */
  unit: string
  /** Fixed decimal places; null keeps compact automatic formatting. */
  decimals: number | null
  /** Optional chart title shown above the plot. */
  title: string
  /** Normalise stacked bars to 100%. */
  percentStacked: boolean
  /** Optional horizontal reference line, in value units. */
  referenceLine: number | null
  /** Bucket dates in UTC or the viewer's local time zone. */
  timeZone: ChartTimeZone
  /** Display conversion applied to the Y axis, labels and tooltips. */
  yAxisScale: ChartAxisScale
  /** How category labels on the X axis are rendered. */
  xAxisFormat: ChartXAxisFormat
}

export interface ChartSeries {
  name: string
  values: number[]
}

export interface ChartData {
  categories: string[]
  series: ChartSeries[]
  /** Original (unformatted) value per category, used for click-to-filter. */
  rawCategories: unknown[]
  /** Start/end ISO timestamps for bucketed categories, used for drill-down. */
  ranges?: ({ start: string; end: string } | undefined)[]
}

/** One point for a scatter plot; scatter uses a separate numeric x axis. */
/** A named chart configuration stored locally or shared through the server. */
export interface SavedChartView {
  id: string
  name: string
  config: ChartConfig
  filter?: string
  pinned?: boolean
  shared?: boolean
  updatedAt?: string
  updatedBy?: string
}

export interface ScatterPoint {
  x: number
  y: number
  label: string
  group: string
}

const CHART_TYPE_VALUES: ChartType[] = ["bar", "hbar", "line", "area", "pie", "scatter", "combo"]
const AGGREGATE_VALUES: ChartAggregate[] = ["none", "count", "sum", "avg", "min", "max"]
const SORT_VALUES: ChartSort[] = ["none", "asc", "desc"]
const BUCKET_VALUES: ChartTimeBucket[] = ["none", "auto", "day", "week", "month", "quarter", "year"]

/** Validates persisted/shared config so a stale or tampered value cannot break rendering. */
export function normalizeChartConfig(input: unknown): ChartConfig {
  const raw = (input && typeof input === "object" ? input : {}) as Partial<ChartConfig>
  return {
    type: CHART_TYPE_VALUES.includes(raw.type as ChartType) ? (raw.type as ChartType) : "bar",
    x: typeof raw.x === "string" ? raw.x : "",
    y: Array.isArray(raw.y) ? raw.y.filter((field): field is string => typeof field === "string") : [],
    aggregate: AGGREGATE_VALUES.includes(raw.aggregate as ChartAggregate)
      ? (raw.aggregate as ChartAggregate)
      : "count",
    sort: SORT_VALUES.includes(raw.sort as ChartSort) ? (raw.sort as ChartSort) : "none",
    limit:
      typeof raw.limit === "number" && Number.isFinite(raw.limit) && raw.limit > 0
        ? Math.min(Math.floor(raw.limit), 500)
        : 20,
    group: typeof raw.group === "string" ? raw.group : "",
    stacked: Boolean(raw.stacked),
    timeBucket: BUCKET_VALUES.includes(raw.timeBucket as ChartTimeBucket)
      ? (raw.timeBucket as ChartTimeBucket)
      : "none",
    others: raw.others !== false,
    showValues: Boolean(raw.showValues),
    numberFormat: ["auto", "plain", "percent", "currency"].includes(raw.numberFormat as string)
      ? (raw.numberFormat as ChartNumberFormat)
      : "auto",
    unit: typeof raw.unit === "string" ? raw.unit : "",
    decimals:
      typeof raw.decimals === "number" && Number.isFinite(raw.decimals)
        ? Math.max(0, Math.min(6, Math.floor(raw.decimals)))
        : null,
    title: typeof raw.title === "string" ? raw.title : "",
    percentStacked: Boolean(raw.percentStacked),
    referenceLine:
      typeof raw.referenceLine === "number" && Number.isFinite(raw.referenceLine)
        ? raw.referenceLine
        : null,
    timeZone: raw.timeZone === "local" ? "local" : "utc",
    yAxisScale: ["none", "k", "m", "b", "bytes"].includes(raw.yAxisScale as string)
      ? (raw.yAxisScale as ChartAxisScale)
      : "none",
    xAxisFormat: [
      "auto",
      "number",
      "compact",
      "percent",
      "date",
      "datetime",
      "year",
      "month",
    ].includes(raw.xAxisFormat as string)
      ? (raw.xAxisFormat as ChartXAxisFormat)
      : "auto",
  }
}

/** Resolves the "auto" bucket from the time span of the sampled documents. */
export function resolveTimeBucket(
  documents: MongoDocument[],
  column: string,
  bucket: ChartTimeBucket,
): ChartTimeBucket {
  if (bucket !== "auto") return bucket
  const times = documents
    .map((doc) => toDate(doc[column]))
    .filter((date): date is Date => date !== null)
    .map((date) => date.getTime())
    .sort((a, b) => a - b)
  if (times.length < 2) return "day"
  const span = times[times.length - 1] - times[0]
  const day = 86_400_000
  if (span <= 90 * day) return "day"
  if (span <= 730 * day) return "month"
  return "year"
}

function axisConversion(value: number, scale: ChartAxisScale): { value: number; suffix: string } {
  switch (scale) {
    case "k":
      return { value: value / 1_000, suffix: "k" }
    case "m":
      return { value: value / 1_000_000, suffix: "M" }
    case "b":
      return { value: value / 1_000_000_000, suffix: "B" }
    default:
      return { value, suffix: "" }
  }
}

/** Formats a value using the chart's axis conversion, number format and unit. */
export function formatChartValue(value: number, config: ChartConfig): string {
  if (config.yAxisScale === "bytes") return formatBytes(value)
  const converted = axisConversion(value, config.yAxisScale)
  if (config.numberFormat === "percent") {
    return `${(converted.value * 100).toFixed(config.decimals ?? 1)}%`
  }
  const text =
    config.decimals !== null
      ? converted.value.toFixed(config.decimals)
      : formatNumber(converted.value)
  const number = `${text}${converted.suffix}`
  if (!config.unit) return number
  return config.numberFormat === "currency" ? `${config.unit}${number}` : `${number} ${config.unit}`
}

/** Compact value formatter for axis ticks, honouring the same conversion. */
export function formatAxisValue(value: number, config: ChartConfig): string {
  if (config.yAxisScale === "bytes") return formatBytes(value)
  const converted = axisConversion(value, config.yAxisScale)
  if (config.numberFormat === "percent") return `${(converted.value * 100).toFixed(0)}%`
  const text =
    config.decimals !== null
      ? converted.value.toFixed(config.decimals)
      : formatNumber(converted.value)
  const number = `${text}${converted.suffix}`
  if (!config.unit) return number
  return config.numberFormat === "currency" ? `${config.unit}${number}` : `${number} ${config.unit}`
}

/** Palette backed by the theme's chart CSS variables. */
export const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
]

export const DEFAULT_CHART_CONFIG: ChartConfig = {
  type: "bar",
  x: "",
  y: [],
  aggregate: "count",
  sort: "none",
  limit: 20,
  group: "",
  stacked: false,
  timeBucket: "none",
  others: true,
  showValues: false,
  numberFormat: "auto",
  unit: "",
  decimals: null,
  title: "",
  percentStacked: false,
  referenceLine: null,
  timeZone: "utc",
  yAxisScale: "none",
  xAxisFormat: "auto",
}

/** Distinct group values rendered as series; beyond this the largest win. */
export const MAX_GROUP_SERIES = 8

/** Converts a BSON / Extended JSON value to a number when possible. */
export function toNumeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "boolean") return value ? 1 : 0
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (trimmed === "") return null
    const n = Number(trimmed)
    return Number.isFinite(n) ? n : null
  }
  if (isPlainObject(value)) {
    for (const key of ["$numberInt", "$numberLong", "$numberDouble", "$numberDecimal"]) {
      if (key in value) {
        const n = Number(value[key])
        if (Number.isFinite(n)) return n
      }
    }
  }
  return null
}

/** Renders a value as a short, human friendly category label. */
export function formatCategory(value: unknown): string {
  if (value === null || value === undefined) return "null"
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value)
    if (keys.length === 1) {
      const key = keys[0]
      const inner = value[key]
      if (key === "$oid" || key === "$numberInt" || key === "$numberLong") {
        return String(inner)
      }
      if (key === "$numberDouble" || key === "$numberDecimal") return String(inner)
      if (key === "$date") {
        if (typeof inner === "string") return inner
        if (isPlainObject(inner) && "$numberLong" in inner) {
          return new Date(Number(inner.$numberLong)).toISOString()
        }
      }
    }
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

function aggregateValues(values: number[], aggregate: ChartAggregate): number {
  if (values.length === 0) return 0
  switch (aggregate) {
    case "sum":
      return values.reduce((a, b) => a + b, 0)
    case "avg":
      return values.reduce((a, b) => a + b, 0) / values.length
    case "min":
      return Math.min(...values)
    case "max":
      return Math.max(...values)
    default:
      return values[values.length - 1] ?? 0
  }
}

/**
 * Turns a list of documents plus a chart config into plot-ready categories and
 * series. `count` ignores the y fields; every other aggregate groups by x.
 */
/** True for values that represent a point in time (Date, BSON $date or ISO string). */
export function isDateLike(value: unknown): boolean {
  if (value instanceof Date) return !Number.isNaN(value.getTime())
  if (typeof value === "string") return /^\d{4}-\d{2}-\d{2}([T ]|$)/.test(value.trim())
  return isPlainObject(value) && "$date" in value
}

/** Whether a column looks temporal based on the currently loaded sample. */
export function isTemporalColumn(documents: MongoDocument[], column: string): boolean {
  if (!column) return false
  for (const doc of documents) {
    const value = doc[column]
    if (value === undefined || value === null) continue
    return isDateLike(value)
  }
  return false
}

/** Converts Dates, epoch numbers, ISO strings and BSON $date values to a Date. */
export function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === "number" && Number.isFinite(value)) {
    // Mongo stores milliseconds; tolerate seconds for hand-written charts.
    const ms = Math.abs(value) < 1e11 ? value * 1000 : value
    const date = new Date(ms)
    return Number.isNaN(date.getTime()) ? null : date
  }
  if (typeof value === "string") {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  if (isPlainObject(value)) {
    if ("$date" in value) return toDate(value.$date)
    if ("$numberLong" in value) return toDate(Number(value.$numberLong))
  }
  return null
}

/** Start of the bucket containing date, in UTC or the local time zone. */
export function timeBucketStart(
  date: Date,
  unit: ChartTimeBucket,
  timeZone: ChartTimeZone = "utc",
): Date {
  const local = timeZone === "local"
  const year = local ? date.getFullYear() : date.getUTCFullYear()
  const month = local ? date.getMonth() : date.getUTCMonth()
  const day = local ? date.getDate() : date.getUTCDate()
  const make = (y: number, m: number, d: number) =>
    local ? new Date(y, m, d) : new Date(Date.UTC(y, m, d))
  const d = make(year, month, day)
  switch (unit) {
    case "week": {
      const offset = ((local ? d.getDay() : d.getUTCDay()) + 6) % 7
      if (local) d.setDate(d.getDate() - offset)
      else d.setUTCDate(d.getUTCDate() - offset)
      return d
    }
    case "month":
      return make(year, month, 1)
    case "quarter":
      return make(year, Math.floor(month / 3) * 3, 1)
    case "year":
      return make(year, 0, 1)
    default:
      return d
  }
}

/** End (exclusive) of a bucket started at `start`. */
export function timeBucketEnd(
  start: Date,
  unit: ChartTimeBucket,
  timeZone: ChartTimeZone = "utc",
): Date {
  const local = timeZone === "local"
  const end = new Date(start)
  const addDays = (days: number) =>
    local ? end.setDate(end.getDate() + days) : end.setUTCDate(end.getUTCDate() + days)
  const addMonths = (months: number) =>
    local ? end.setMonth(end.getMonth() + months) : end.setUTCMonth(end.getUTCMonth() + months)
  switch (unit) {
    case "week":
      addDays(7)
      break
    case "month":
      addMonths(1)
      break
    case "quarter":
      addMonths(3)
      break
    case "year":
      local ? end.setFullYear(end.getFullYear() + 1) : end.setUTCFullYear(end.getUTCFullYear() + 1)
      break
    default:
      addDays(1)
  }
  return end
}

export function timeBucketLabel(
  start: Date,
  unit: ChartTimeBucket,
  timeZone: ChartTimeZone = "utc",
): string {
  const local = timeZone === "local"
  const y = local ? start.getFullYear() : start.getUTCFullYear()
  const m = String((local ? start.getMonth() : start.getUTCMonth()) + 1).padStart(2, "0")
  const d = String((local ? start.getDate() : start.getUTCDate())).padStart(2, "0")
  switch (unit) {
    case "month":
      return `${y}-${m}`
    case "quarter":
      return `${y} Q${Math.floor((local ? start.getMonth() : start.getUTCMonth()) / 3) + 1}`
    case "year":
      return String(y)
    default:
      return `${y}-${m}-${d}`
  }
}

interface Bucket {
  start: Date
  end: Date
  label: string
}

function bucketOf(
  value: unknown,
  unit: ChartTimeBucket,
  timeZone: ChartTimeZone,
): Bucket | null {
  const date = toDate(value)
  if (!date) return null
  const start = timeBucketStart(date, unit, timeZone)
  return {
    start,
    end: timeBucketEnd(start, unit, timeZone),
    label: timeBucketLabel(start, unit, timeZone),
  }
}

/** Sort, limit and optionally merge the tail into an "Other" category. */
function finalizeChartData(
  categories: string[],
  series: ChartSeries[],
  rawCategories: unknown[],
  ranges: (Bucket | undefined)[] | undefined,
  config: ChartConfig,
  othersLabel: string,
): ChartData {
  let order = categories.map((_, index) => index)
  if (ranges && config.timeBucket !== "none") {
    order = order.sort((a, b) => {
      const ra = ranges[a]
      const rb = ranges[b]
      if (!ra || !rb) return a - b
      return ra.start.getTime() - rb.start.getTime() || a - b
    })
  } else if (config.sort !== "none" && series.length > 0) {
    const totals = categories.map((_, index) =>
      series.reduce((sum, item) => sum + (item.values[index] ?? 0), 0),
    )
    order = order.sort((a, b) =>
      config.sort === "asc" ? totals[a] - totals[b] : totals[b] - totals[a],
    )
  }

  let ordered = order
  const cap = Math.max(1, config.limit)
  let merged: number[] = []
  if (order.length > cap) {
    ordered = order.slice(0, cap)
    merged = order.slice(cap)
  }

  const mergedValues = series.map((item) =>
    merged.reduce((sum, index) => sum + (item.values[index] ?? 0), 0),
  )
  const outCategories = ordered.map((index) => categories[index])
  const outRaw = ordered.map((index) => rawCategories[index])
  let outRanges = ranges ? ordered.map((index) => ranges[index]) : undefined
  let outSeries = series.map((item) => ({
    name: item.name,
    values: ordered.map((index) => item.values[index] ?? 0),
  }))

  if (merged.length > 0 && config.others) {
    outCategories.push(othersLabel)
    outRaw.push(undefined)
    if (outRanges) outRanges = [...outRanges, undefined]
    outSeries = outSeries.map((item, index) => ({
      name: item.name,
      values: [...item.values, mergedValues[index] ?? 0],
    }))
  }

  return {
    categories: outCategories,
    series: outSeries,
    rawCategories: outRaw,
    ranges: outRanges?.map((bucket) =>
      bucket ? { start: bucket.start.toISOString(), end: bucket.end.toISOString() } : undefined,
    ),
  }
}

/**
 * Turns a list of documents plus a chart config into plot-ready categories and
 * series. `count` ignores the y fields; every other aggregate groups by x.
 */
export function buildChartData(
  documents: MongoDocument[],
  config: ChartConfig,
  othersLabel = "Other",
): ChartData {
  const { x, y, aggregate, group, type } = config
  const temporal = isTemporalColumn(documents, x)
  const bucket = temporal && aggregate !== "none" ? config.timeBucket : "none"
  // A pie slice is already a category, so a second grouping dimension does not
  // apply; scatter is handled separately.
  const groupField = type === "pie" || type === "scatter" ? "" : group

  const labels: string[] = []
  const raws: unknown[] = []
  const ranges: (Bucket | undefined)[] = []
  const indexByLabel = new Map<string, number>()
  let hasRanges = false

  const categoryFor = (doc: MongoDocument): { label: string; raw: unknown; bucket?: Bucket } => {
    const value = x ? doc[x] : undefined
    if (bucket !== "none") {
      const entry = bucketOf(value, bucket, config.timeZone)
      if (entry) return { label: entry.label, raw: entry.start, bucket: entry }
    }
    return { label: formatCategory(value), raw: value }
  }

  const addCategory = (entry: { label: string; raw: unknown; bucket?: Bucket }): number => {
    const existing = indexByLabel.get(entry.label)
    if (existing !== undefined) return existing
    const index = labels.length
    labels.push(entry.label)
    raws.push(entry.raw)
    ranges.push(entry.bucket)
    if (entry.bucket) hasRanges = true
    indexByLabel.set(entry.label, index)
    return index
  }

  let series: ChartSeries[] = []

  if (groupField) {
    // group value -> category index -> documents
    const groups = new Map<string, Map<number, MongoDocument[]>>()
    for (const doc of documents) {
      const index = addCategory(categoryFor(doc))
      const groupKey = formatCategory(doc[groupField])
      let byCategory = groups.get(groupKey)
      if (!byCategory) {
        byCategory = new Map()
        groups.set(groupKey, byCategory)
      }
      const bucketDocs = byCategory.get(index)
      if (bucketDocs) bucketDocs.push(doc)
      else byCategory.set(index, [doc])
    }

    const measure = (docs: MongoDocument[]): number => {
      if (aggregate === "count" || y.length === 0) return docs.length
      const numbers = docs
        .map((doc) => toNumeric(doc[y[0]]))
        .filter((value): value is number => value !== null)
      if (numbers.length === 0) return 0
      return aggregateValues(numbers, aggregate)
    }

    series = [...groups.entries()]
      .map(([name, byCategory]) => ({
        name,
        byCategory,
        total: [...byCategory.values()].reduce((sum, docs) => sum + measure(docs), 0),
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, MAX_GROUP_SERIES)
      .map(({ name, byCategory }) => ({
        name,
        values: labels.map((_, index) => measure(byCategory.get(index) ?? [])),
      }))
  } else {
    const groups = new Map<number, MongoDocument[]>()

    for (const doc of documents) {
      const index = addCategory(categoryFor(doc))
      const bucketDocs = groups.get(index)
      if (bucketDocs) bucketDocs.push(doc)
      else groups.set(index, [doc])
    }

    if (aggregate === "none") {
      // Raw: one point per document, capped by "Max points". Keep document
      // order rather than the label map so repeated labels stay aligned.
      const points = documents.slice(0, Math.max(1, config.limit))
      series = y.map((field) => ({
        name: field,
        values: points.map((doc) => toNumeric(doc[field]) ?? 0),
      }))
      if (series.length === 0 && points.length > 0) {
        series = [{ name: "count", values: points.map(() => 1) }]
      }
      return {
        categories: points.map((doc) => formatCategory(x ? doc[x] : undefined)),
        series,
        rawCategories: points.map((doc) => (x ? doc[x] : undefined)),
        ranges: undefined,
      }
    }

    if (aggregate === "count" || y.length === 0) {
      series = [
        {
          name: "count",
          values: labels.map((_, index) => groups.get(index)?.length ?? 0),
        },
      ]
    } else {
      series = y.map((field) => ({
        name: field,
        values: labels.map((_, index) => {
          const numbers = (groups.get(index) ?? [])
            .map((doc) => toNumeric(doc[field]))
            .filter((value): value is number => value !== null)
          return numbers.length === 0 ? 0 : aggregateValues(numbers, aggregate)
        }),
      }))
    }
  }

  return finalizeChartData(
    labels,
    series,
    raws,
    hasRanges ? ranges : undefined,
    config,
    othersLabel,
  )
}

/** Formats one X-axis category using the configured display format. */
export function formatXAxisLabel(
  raw: unknown,
  fallback: string,
  format: ChartXAxisFormat,
  locale: string,
  timeZone: ChartTimeZone,
): string {
  if (format === "auto") return fallback
  const tag = locale === "zh" ? "zh-CN" : "en-US"
  if (format === "date" || format === "datetime" || format === "year" || format === "month") {
    const date = toDate(raw)
    if (!date) return fallback
    const options: Intl.DateTimeFormatOptions = {
      ...(timeZone === "utc" ? { timeZone: "UTC" } : {}),
    }
    if (format === "year") options.year = "numeric"
    else if (format === "month") {
      options.year = "numeric"
      options.month = "2-digit"
    } else {
      options.year = "numeric"
      options.month = "2-digit"
      options.day = "2-digit"
      if (format === "datetime") {
        options.hour = "2-digit"
        options.minute = "2-digit"
      }
    }
    try {
      return new Intl.DateTimeFormat(tag, options).format(date)
    } catch {
      return fallback
    }
  }
  const numeric = toNumeric(raw)
  if (numeric === null) return fallback
  if (format === "percent") return `${(numeric * 100).toFixed(1)}%`
  if (format === "compact") return formatNumber(numeric)
  return numeric.toLocaleString(tag)
}

/** Applies the X-axis label format without touching raw values used for filters. */
export function applyXAxisFormat(
  data: ChartData,
  config: ChartConfig,
  locale: string,
): ChartData {
  if (config.xAxisFormat === "auto") return data
  return {
    ...data,
    categories: data.categories.map((label, index) =>
      formatXAxisLabel(
        data.rawCategories[index],
        label,
        config.xAxisFormat,
        locale,
        config.timeZone,
      ),
    ),
  }
}

/** Aggregation pipeline that produces the same shape as buildChartData remotely. */
export function buildChartPipeline(
  config: ChartConfig,
  filter: unknown,
  temporal: boolean,
): unknown[] {
  const { x, y, aggregate, group, type } = config
  const unit = temporal && config.timeBucket !== "none" && aggregate !== "none"
    ? config.timeBucket
    : "none"
  const groupField = type === "pie" || type === "scatter" ? "" : group
  const xExpr =
    unit === "none"
      ? `$${x}`
      : {
          $dateTrunc: {
            // $convert tolerates BSON dates, ISO strings and epoch numbers; a
            // plain field reference would fail for string timestamps.
            date: { $convert: { input: `$${x}`, to: "date", onError: null, onNull: null } },
            unit,
            startOfWeek: "monday",
            timezone:
              config.timeZone === "local"
                ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
                : "UTC",
          },
        }
  const accumulators: Record<string, unknown> = {}
  if (aggregate === "count" || y.length === 0) {
    accumulators.v0 = { $sum: 1 }
  } else {
    const fields = groupField ? y.slice(0, 1) : y
    fields.forEach((field, index) => {
      const op =
        aggregate === "sum"
          ? "$sum"
          : aggregate === "avg"
            ? "$avg"
            : aggregate === "min"
              ? "$min"
              : aggregate === "max"
                ? "$max"
                : "$sum"
      accumulators[`v${index}`] = { [op]: `$${field}` }
    })
  }

  const stages: unknown[] = []
  if (filter && typeof filter === "object" && Object.keys(filter as object).length > 0) {
    stages.push({ $match: filter })
  }
  stages.push({
    $group: {
      _id: { x: xExpr, g: groupField ? `$${groupField}` : null },
      ...accumulators,
    },
  })
  stages.push({ $sort: { "_id.x": 1, "_id.g": 1 } })
  return stages
}

/** Maps aggregation rows (as returned by /aggregate) back to chart data. */
export function chartDataFromRows(
  rows: MongoDocument[],
  config: ChartConfig,
  othersLabel = "Other",
): ChartData {
  const { y, aggregate, group, type } = config
  const temporal = config.timeBucket !== "none"
  const groupField = type === "pie" || type === "scatter" ? "" : group

  const labels: string[] = []
  const raws: unknown[] = []
  const ranges: (Bucket | undefined)[] = []
  const indexByLabel = new Map<string, number>()
  const seriesMaps = new Map<string, Map<number, number>>()

  for (const row of rows) {
    const id = (row._id ?? {}) as Record<string, unknown>
    const rawX = id.x
    const bucket = temporal ? bucketOf(rawX, config.timeBucket, config.timeZone) : null
    const label = bucket ? bucket.label : formatCategory(rawX)
    let index = indexByLabel.get(label)
    if (index === undefined) {
      index = labels.length
      indexByLabel.set(label, index)
      labels.push(label)
      raws.push(bucket ? bucket.start : rawX)
      ranges.push(bucket ?? undefined)
    }

    const fields = groupField ? [groupField] : aggregate === "count" || y.length === 0 ? [] : y
    if (groupField) {
      const name = formatCategory(id.g)
      let values = seriesMaps.get(name)
      if (!values) {
        values = new Map()
        seriesMaps.set(name, values)
      }
      values.set(index, toNumeric(row.v0) ?? 0)
    } else if (fields.length === 0) {
      let values = seriesMaps.get("count")
      if (!values) {
        values = new Map()
        seriesMaps.set("count", values)
      }
      values.set(index, toNumeric(row.v0) ?? 0)
    } else {
      fields.forEach((field, fieldIndex) => {
        let values = seriesMaps.get(field)
        if (!values) {
          values = new Map()
          seriesMaps.set(field, values)
        }
        values.set(index, toNumeric(row[`v${fieldIndex}`]) ?? 0)
      })
    }
  }

  const series = [...seriesMaps.entries()].map(([name, values]) => ({
    name,
    values: labels.map((_, index) => values.get(index) ?? 0),
  }))

  return finalizeChartData(
    labels,
    series,
    raws,
    ranges.some(Boolean) ? ranges : undefined,
    config,
    othersLabel,
  )
}

/**
 * Largest-Triangle-Three-Buckets downsampling for dense line/area charts. The
 * category order and both endpoints are preserved so trends keep their shape.
 */
export function downsampleChartData(data: ChartData, maxPoints: number): ChartData {
  const n = data.categories.length
  if (n <= maxPoints || maxPoints < 3 || data.series.length === 0) return data

  const totals = data.categories.map((_, index) =>
    data.series.reduce((sum, series) => sum + Math.abs(series.values[index] ?? 0), 0),
  )
  const sampled: number[] = [0]
  const bucketSize = (n - 2) / (maxPoints - 2)
  let anchor = 0

  for (let i = 0; i < maxPoints - 2; i++) {
    const start = Math.floor(i * bucketSize) + 1
    const end = Math.min(n, Math.floor((i + 1) * bucketSize) + 1)
    const nextStart = Math.floor((i + 1) * bucketSize) + 1
    const nextEnd = Math.min(n, Math.floor((i + 2) * bucketSize) + 1)

    let avgX = 0
    let avgY = 0
    let count = 0
    for (let j = nextStart; j < nextEnd; j++) {
      avgX += j
      avgY += totals[j]
      count++
    }
    if (count === 0) {
      avgX = n - 1
      avgY = totals[n - 1]
      count = 1
    }
    avgX /= count
    avgY /= count

    let bestArea = -1
    let best = start
    for (let j = start; j < end; j++) {
      const area = Math.abs(
        (anchor - avgX) * (totals[j] - totals[anchor]) -
          (anchor - j) * (avgY - totals[anchor]),
      )
      if (area > bestArea) {
        bestArea = area
        best = j
      }
    }
    sampled.push(best)
    anchor = best
  }
  sampled.push(n - 1)

  return {
    categories: sampled.map((index) => data.categories[index]),
    series: data.series.map((series) => ({
      name: series.name,
      values: sampled.map((index) => series.values[index] ?? 0),
    })),
    rawCategories: sampled.map((index) => data.rawCategories[index]),
    ranges: data.ranges ? sampled.map((index) => data.ranges![index]) : undefined,
  }
}

/** Scatter points from raw documents (x and the first y field must be numeric). */
export function buildScatterData(
  documents: MongoDocument[],
  config: ChartConfig,
): { points: ScatterPoint[]; xField: string; yField: string } {
  const xField = config.x
  const yField = config.y[0] ?? ""
  const points: ScatterPoint[] = []
  for (const doc of documents) {
    const x = toNumeric(doc[xField])
    const y = toNumeric(doc[yField])
    if (x === null || y === null) continue
    points.push({
      x,
      y,
      label: formatCategory(doc._id ?? `${x}, ${y}`),
      group: config.group ? formatCategory(doc[config.group]) : "",
    })
    if (points.length >= 1200) break
  }
  return { points, xField, yField }
}

/** Heuristics used to pick sensible defaults for a fresh result set. */
export function suggestChartConfig(
  documents: MongoDocument[],
  columns: string[],
  previous?: ChartConfig | null,
): ChartConfig {
  const sample = documents.slice(0, 200)
  const distinct = new Map<string, number>()
  const numericRatio = new Map<string, number>()

  for (const column of columns) {
    const seen = new Set<string>()
    let numeric = 0
    let present = 0
    for (const doc of sample) {
      const value = doc[column]
      if (value === undefined) continue
      present++
      if (toNumeric(value) !== null) numeric++
      if (seen.size < 1000) seen.add(formatCategory(value))
    }
    distinct.set(column, seen.size)
    numericRatio.set(column, present === 0 ? 0 : numeric / present)
  }

  const isNumericColumn = (column: string) => (numericRatio.get(column) ?? 0) >= 0.6

  // Prefer a categorical (non-numeric, low cardinality) column for the x axis.
  let x = previous?.x && columns.includes(previous.x) ? previous.x : ""
  if (!x) {
    let best: string | null = null
    let bestScore = Number.POSITIVE_INFINITY
    for (const column of columns) {
      if (column === "_id" || isNumericColumn(column)) continue
      const score = distinct.get(column) ?? Number.POSITIVE_INFINITY
      if (score < bestScore) {
        best = column
        bestScore = score
      }
    }
    x = best ?? columns.find((column) => column !== "_id") ?? columns[0] ?? ""
  }

  const temporalColumns = new Set(
    columns.filter((column) => isTemporalColumn(documents, column)),
  )
  const numericColumns = columns.filter(isNumericColumn)
  let y =
    previous?.y && previous.y.length > 0 && previous.y.every((field) => columns.includes(field))
      ? previous.y
      : numericColumns.slice(0, 2)

  // Raw is the default so the chart starts from the actual documents rather
  // than silently summing numeric fields. Count remains the fallback when the
  // page has no numeric column to plot.
  let aggregate: ChartAggregate = previous?.aggregate ?? (y.length > 0 ? "none" : "count")
  if (y.length === 0) {
    aggregate = "count"
    y = []
  }

  const group =
    previous?.group && previous.group !== x && columns.includes(previous.group)
      ? previous.group
      : ""

  const temporal = temporalColumns.has(x)
  const timeBucket: ChartTimeBucket = temporal
    ? previous?.timeBucket ?? "auto"
    : "none"

  return {
    type: previous?.type ?? (temporal ? "line" : "bar"),
    x,
    y,
    aggregate,
    sort: previous?.sort ?? "none",
    limit: previous?.limit ?? 20,
    group,
    stacked: previous?.stacked ?? false,
    timeBucket,
    others: previous?.others ?? true,
    showValues: previous?.showValues ?? false,
    numberFormat: previous?.numberFormat ?? "auto",
    unit: previous?.unit ?? "",
    decimals: previous?.decimals ?? null,
    title: previous?.title ?? "",
    percentStacked: previous?.percentStacked ?? false,
    referenceLine: previous?.referenceLine ?? null,
    timeZone: previous?.timeZone ?? "utc",
    yAxisScale: previous?.yAxisScale ?? "none",
    xAxisFormat: previous?.xAxisFormat ?? "auto",
  }
}

/** A "nice" axis scale with rounded tick values. */
export interface Scale {
  min: number
  max: number
  ticks: number[]
}

function niceNum(range: number, round: boolean): number {
  const exponent = Math.floor(Math.log10(range || 1))
  const fraction = (range || 1) / Math.pow(10, exponent)
  let nice: number
  if (round) {
    if (fraction < 1.5) nice = 1
    else if (fraction < 3) nice = 2
    else if (fraction < 7) nice = 5
    else nice = 10
  } else {
    if (fraction <= 1) nice = 1
    else if (fraction <= 2) nice = 2
    else if (fraction <= 5) nice = 5
    else nice = 10
  }
  return nice * Math.pow(10, exponent)
}

export function niceScale(min: number, max: number, tickCount = 5): Scale {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0
    max = 1
  }
  if (min === max) {
    if (min === 0) max = 1
    else {
      min = Math.min(0, min)
      max = Math.max(0, max)
    }
  }
  const range = niceNum(max - min || 1, false)
  const step = niceNum(range / Math.max(1, tickCount - 1), true)
  const niceMin = Math.floor(min / step) * step
  const niceMax = Math.ceil(max / step) * step

  const ticks: number[] = []
  for (let value = niceMin; value <= niceMax + step / 2; value += step) {
    ticks.push(Number(value.toFixed(10)))
  }
  if (ticks.length < 2) ticks.push(niceMax + step)
  return { min: niceMin, max: niceMax, ticks }
}

/** Compact number formatting for axis labels and tooltips. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "—"
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(2).replace(/\.?0+$/, "")
}
