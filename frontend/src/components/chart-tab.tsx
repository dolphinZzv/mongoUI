import * as React from "react"
import { AlertCircle } from "lucide-react"

import { ChartView } from "@/components/chart-view"
import { MongoFilterEditor } from "@/components/mongo-filter-editor"
import { useI18n } from "@/lib/i18n"
import type { ChartConfig } from "@/lib/chart"
import type { ChartShareState } from "@/lib/router"

interface ChartTabProps {
  connectionId: string
  database: string
  collection: string
  /** The documents filter is offered as a starting point. */
  initialFilter?: string
  /** Chart state restored from the URL. */
  initialChart?: ChartShareState
  /** Mirror the current chart state into the URL. */
  onChartChange?: (chart: ChartShareState) => void
}

/**
 * First-class chart workspace: the collection tab keeps the chart controls and
 * its own filter visible without going through the documents overflow menu.
 */
export function ChartTab({
  connectionId,
  database,
  collection,
  initialFilter,
  initialChart,
  onChartChange,
}: ChartTabProps) {
  const { t } = useI18n()
  const [filterText, setFilterText] = React.useState(
    initialChart?.filter ?? initialFilter ?? "{}",
  )
  const [debounced, setDebounced] = React.useState(
    initialChart?.filter ?? initialFilter ?? "{}",
  )
  const [chartConfig, setChartConfig] = React.useState<ChartConfig | undefined>(
    initialChart?.config,
  )

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(filterText), 500)
    return () => window.clearTimeout(timer)
  }, [filterText])

  React.useEffect(() => {
    if (!initialChart) return
    setChartConfig(initialChart.config)
    setFilterText(initialChart.filter)
    setDebounced(initialChart.filter)
  }, [initialChart])

  React.useEffect(() => {
    if (!chartConfig) return
    const timer = window.setTimeout(() => {
      onChartChange?.({ config: chartConfig, filter: filterText })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [chartConfig, filterText, onChartChange])

  const parsed = React.useMemo(() => {
    try {
      return JSON.parse(debounced.trim() || "{}") as unknown
    } catch {
      return null
    }
  }, [debounced])

  const scope = `${connectionId}::${database}::${collection}`

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3">
      <MongoFilterEditor
        value={filterText}
        onChange={setFilterText}
        placeholder={t("docs.filterPlaceholder")}
      />
      {parsed === null ? (
        <p className="text-destructive flex items-center gap-1.5 text-xs" role="alert">
          <AlertCircle className="size-3.5" /> {t("docs.invalidJson")}
        </p>
      ) : null}
      <ChartView
        className="min-h-0 flex-1"
        documents={[]}
        columns={[]}
        fieldTypes={{}}
        connectionId={connectionId}
        database={database}
        collection={collection}
        filter={parsed ?? {}}
        filterValid={parsed !== null}
        initialConfig={chartConfig}
        onConfigChange={setChartConfig}
        scope={scope}
        storageKey={`docs:${connectionId}:${database}:${collection}`}
        currentFilter={filterText}
        onApplyFilterText={(next) => {
          setFilterText(next)
          setDebounced(next)
        }}
        height={460}
      />
    </div>
  )
}
