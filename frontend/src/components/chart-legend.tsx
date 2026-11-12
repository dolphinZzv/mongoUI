import { CHART_COLORS, type ChartSeries, type ChartType } from "@/lib/chart"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export interface ChartLegendProps {
  type: ChartType
  categories: string[]
  scatterGroups: string[]
  series: ChartSeries[]
  hidden: Set<string>
  onToggleSeries: (name: string) => void
}

export function ChartLegend({
  type,
  categories,
  scatterGroups,
  series,
  hidden,
  onToggleSeries,
}: ChartLegendProps) {
  const { t } = useI18n()
  if (type === "pie" || type === "scatter") {
    return (
      <>
        {(type === "pie" ? categories : scatterGroups).map((name, index) => (
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
        ))}
      </>
    )
  }
  return (
    <>
      {series.map((item, index) => (
        <button
          key={item.name}
          type="button"
          onClick={() => onToggleSeries(item.name)}
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
      ))}
    </>
  )
}
