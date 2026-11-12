import {
  AreaChart as AreaIcon,
  BarChart3,
  Check,
  ChevronDown,
  LineChart,
  PieChart,
  Search,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useI18n } from "@/lib/i18n"
import type {
  ChartAggregate,
  ChartAxisScale,
  ChartConfig,
  ChartSort,
  ChartTimeBucket,
  ChartTimeZone,
  ChartType,
} from "@/lib/chart"
import { cn } from "@/lib/utils"

const CHART_TYPES: {
  value: ChartType
  labelKey: string
  icon: React.ComponentType<{ className?: string }>
}[] = [
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

export interface ChartConfigPanelProps {
  config: ChartConfig
  update: (patch: Partial<ChartConfig>) => void
  temporalX: boolean
  xOptions: string[]
  fieldNames: string[]
  numericColumns: string[]
  typeOf: (name: string) => string
  toggleY: (field: string) => void
  fieldQuery: string
  onFieldQueryChange: (value: string) => void
  fieldMatches: (name: string) => boolean
}

export function ChartConfigPanel({
  config,
  update,
  temporalX,
  xOptions,
  fieldNames,
  numericColumns,
  typeOf,
  toggleY,
  fieldQuery,
  onFieldQueryChange,
  fieldMatches,
}: ChartConfigPanelProps) {
  const { t } = useI18n()
  return (
    <div className="max-h-[45%] shrink-0 overflow-y-auto border-t p-3">
      <div className="flex flex-wrap items-end gap-3">
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
              .filter((column) => column !== config.x)
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

      <div className="grid gap-1.5">
        <Label className="text-xs">{t("chart.autoRefresh")}</Label>
        <Select
          value={String(config.refreshInterval)}
          onValueChange={(value) => update({ refreshInterval: Number(value) })}
        >
          <SelectTrigger size="sm" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="0">{t("chart.refreshOff")}</SelectItem>
            <SelectItem value="5">5s</SelectItem>
            <SelectItem value="10">10s</SelectItem>
            <SelectItem value="30">30s</SelectItem>
            <SelectItem value="60">1m</SelectItem>
            <SelectItem value="300">5m</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {temporalX && config.type !== "scatter" && config.aggregate !== "none" ? (
        <div className="grid gap-1.5">
          <Label className="text-xs">{t("chart.liveWindow")}</Label>
          <Select
            value={String(config.liveWindowMinutes)}
            onValueChange={(value) => {
              const minutes = Number(value)
              update({
                liveWindowMinutes: minutes,
                refreshInterval:
                  minutes > 0 && config.refreshInterval === 0
                    ? 5
                    : config.refreshInterval,
              })
            }}
          >
            <SelectTrigger size="sm" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">{t("chart.window.all")}</SelectItem>
              <SelectItem value="1">{t("chart.window.1m")}</SelectItem>
              <SelectItem value="5">{t("chart.window.5m")}</SelectItem>
              <SelectItem value="15">{t("chart.window.15m")}</SelectItem>
              <SelectItem value="60">{t("chart.window.1h")}</SelectItem>
              <SelectItem value="1440">{t("chart.window.24h")}</SelectItem>
              <SelectItem value="10080">{t("chart.window.7d")}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-[11px]">{t("chart.liveHint")}</p>
        </div>
      ) : null}

      <div className="grid gap-1.5">
        <Label className="text-xs">{t("chart.alertOperator")}</Label>
        <div className="flex items-center gap-2">
          <Select
            value={config.alertOperator}
            onValueChange={(value) =>
              update({ alertOperator: value as ChartConfig["alertOperator"] })
            }
          >
            <SelectTrigger size="sm" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">{t("chart.alert.off")}</SelectItem>
              <SelectItem value="above">{t("chart.alert.above")}</SelectItem>
              <SelectItem value="below">{t("chart.alert.below")}</SelectItem>
            </SelectContent>
          </Select>
          <Input
            value={config.alertThreshold === null ? "" : String(config.alertThreshold)}
            onChange={(event) => {
              const raw = event.target.value.trim()
              const next = Number(raw)
              update({
                alertThreshold:
                  raw === "" || !Number.isFinite(next) ? null : next,
              })
            }}
            placeholder={t("chart.alertThreshold")}
            inputMode="decimal"
            className="h-8 w-24 text-xs"
          />
        </div>
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

      <div className="grid w-full gap-1.5">
        <Label className="text-xs">{t("chart.yAxis")}</Label>
        {numericColumns.length > 0 ? (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                title={config.y.join(", ") || t("chart.pickField")}
                className="h-8 w-full justify-between gap-2 px-2.5 text-xs font-normal"
              >
                <span
                  className={cn(
                    "truncate font-mono",
                    config.y.length === 0 && "text-muted-foreground font-sans",
                  )}
                >
                  {config.y.length > 0 ? config.y.join(", ") : t("chart.pickField")}
                </span>
                <ChevronDown className="size-3.5 shrink-0 opacity-60" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-1">
              <div className="border-b p-1.5">
                <div className="relative">
                  <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2" />
                  <Input
                    value={fieldQuery}
                    onChange={(event) => onFieldQueryChange(event.target.value)}
                    placeholder={t("chart.searchFields")}
                    className="h-7 pl-7 text-xs"
                  />
                </div>
              </div>
              <div
                role="listbox"
                aria-label={t("chart.yAxis")}
                aria-multiselectable="true"
                className="max-h-60 overflow-y-auto p-1"
              >
                {numericColumns.filter(fieldMatches).length > 0 ? (
                  numericColumns
                    .filter(fieldMatches)
                    .map((column) => {
                      const active = config.y.includes(column)
                      return (
                        <button
                          key={column}
                          type="button"
                          role="option"
                          aria-selected={active}
                          title={`${column}${typeOf(column) ? ` · ${typeOf(column)}` : ""}`}
                          onClick={() => toggleY(column)}
                          className={cn(
                            "hover:bg-accent focus-visible:bg-accent flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left font-mono text-xs outline-hidden",
                            active && "bg-primary/5",
                          )}
                        >
                          <span
                            className={cn(
                              "flex size-3.5 shrink-0 items-center justify-center rounded-sm border",
                              active
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-input",
                            )}
                          >
                            {active ? <Check className="size-3" /> : null}
                          </span>
                          <span className="truncate">{column}</span>
                          {typeOf(column) ? (
                            <span className="text-muted-foreground ml-auto pl-2 text-[10px] uppercase">
                              {typeOf(column)}
                            </span>
                          ) : null}
                        </button>
                      )
                    })
                ) : (
                  <p className="text-muted-foreground px-2 py-3 text-xs">
                    {t("chart.noFieldMatches")}
                  </p>
                )}
              </div>
              {config.aggregate === "count" && config.type !== "scatter" ? (
                <p className="text-muted-foreground border-t px-2 py-1.5 text-[11px]">
                  {t("chart.countHint")}
                </p>
              ) : null}
            </PopoverContent>
          </Popover>
        ) : (
          <p className="text-muted-foreground text-xs">{t("chart.noNumeric")}</p>
        )}
      </div>
      </div>
    </div>
  )
}
