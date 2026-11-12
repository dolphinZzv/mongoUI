import * as React from "react"
import { BarChart3, Maximize2, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useI18n } from "@/lib/i18n"
import type { ChartConfig } from "@/lib/chart"
import type { MongoDocument } from "@/lib/types"

const ChartView = React.lazy(() =>
  import("@/components/chart-view").then((module) => ({ default: module.ChartView })),
)

export interface DocumentsChartPaneProps {
  documents: MongoDocument[]
  columns: string[]
  fieldTypes: Record<string, string>
  connectionId: string
  database: string
  collection: string
  selectedColumns: Set<string>
  width: number
  currentFilter: string
  filter: unknown
  filterValid: boolean
  initialConfig?: ChartConfig
  onConfigChange: (config: ChartConfig) => void
  onResizeStart: (event: React.PointerEvent) => void
  onOpenChartDialog: () => void
  onClose: () => void
  onDrilldown: (filter: Record<string, unknown>) => void
}

/** Resizable right-hand visualization panel used by the documents tab. */
export function DocumentsChartPane({
  documents,
  columns,
  fieldTypes,
  connectionId,
  database,
  collection,
  selectedColumns,
  width,
  currentFilter,
  filter,
  filterValid,
  initialConfig,
  onConfigChange,
  onResizeStart,
  onOpenChartDialog,
  onClose,
  onDrilldown,
}: DocumentsChartPaneProps) {
  const { t } = useI18n()
  return (
    <>
      <div
        role="separator"
        aria-orientation="vertical"
        title={t("docs.dragToResize")}
        onPointerDown={onResizeStart}
        className="bg-border hover:bg-primary/40 hidden w-1 shrink-0 cursor-col-resize lg:block"
      />
      <aside
        className="bg-background absolute inset-0 z-30 flex w-full flex-col border-l lg:static lg:z-auto lg:w-[var(--chart-pane-width)] lg:min-w-[320px] lg:max-w-[70%]"
        style={{ "--chart-pane-width": `${width}px` } as React.CSSProperties}
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
            onClick={onOpenChartDialog}
            title={t("docs.openChartDialog")}
            aria-label={t("docs.openChartDialog")}
          >
            <Maximize2 />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            title={t("docs.closeVisualization")}
            aria-label={t("docs.closeVisualization")}
          >
            <X />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          <React.Suspense
            fallback={<p className="text-muted-foreground p-4 text-xs">{t("common.loading")}</p>}
          >
            <ChartView
              documents={documents}
              columns={columns}
              fieldTypes={fieldTypes}
              connectionId={connectionId}
              database={database}
              collection={collection}
              filter={filter}
              filterValid={filterValid}
              initialConfig={initialConfig}
              onConfigChange={onConfigChange}
              scope={`${connectionId}::${database}::${collection}`}
              storageKey={`docs:${connectionId}:${database}:${collection}`}
              currentFilter={currentFilter}
              onDrilldown={onDrilldown}
              height={520}
            />
          </React.Suspense>
        </div>
      </aside>
    </>
  )
}
