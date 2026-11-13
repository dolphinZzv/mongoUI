import { BarChart3, Braces, Table2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ChartView } from "@/components/chart-view"
import { ResultTable } from "@/components/documents/result-table"
import { JsonView } from "@/components/json-view"
import { QueryDuration } from "@/components/query-duration"
import type {
  ColumnColorRules,
  ColumnDictionaries,
  ColumnRenderers,
} from "@/lib/columnPrefs"
import { useI18n } from "@/lib/i18n"
import type { MongoDocument } from "@/lib/types"

export type QueryResultView = "table" | "json" | "chart"

interface QueryResultPanelProps {
  ran: boolean
  view: QueryResultView
  onViewChange: (view: QueryResultView) => void
  documents: MongoDocument[]
  columns: string[]
  /** Per-surface key for pinned columns and chart config. */
  storageKey: string
  count: number
  /** Total matching rows when the query reports more than the page. */
  total?: number
  durationMs?: number
  notRunText: string
  emptyText: string
  dictionaries?: ColumnDictionaries
  renderers?: ColumnRenderers
  colors?: ColumnColorRules
}

/**
 * Shared result toolbar + table/JSON/chart body for SQL and aggregation.
 * The editors differ; the way their result sets are inspected should not.
 */
export function QueryResultPanel({
  ran,
  view,
  onViewChange,
  documents,
  columns,
  storageKey,
  count,
  total,
  durationMs,
  notRunText,
  emptyText,
  dictionaries,
  renderers,
  colors,
}: QueryResultPanelProps) {
  const { t } = useI18n()

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <Button
          variant={view === "table" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => onViewChange("table")}
        >
          <Table2 /> {t("result.table")}
        </Button>
        <Button
          variant={view === "json" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => onViewChange("json")}
        >
          <Braces /> {t("result.json")}
        </Button>
        <Button
          variant={view === "chart" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => onViewChange("chart")}
          disabled={!ran}
        >
          <BarChart3 /> {t("result.chart")}
        </Button>
        <span className="text-muted-foreground ml-auto flex items-center gap-2 text-xs">
          <span>
            {ran
              ? t(count === 1 ? "sql.rows" : "sql.rows_plural", { count }) +
                (total !== undefined && total > count
                  ? t("sql.ofMatching", { total })
                  : "")
              : notRunText}
          </span>
          {ran ? <QueryDuration ms={durationMs} /> : null}
        </span>
      </div>

      {ran && view === "chart" ? (
        <ChartView
          className="min-h-0 flex-1"
          documents={documents}
          columns={columns}
          storageKey={storageKey}
        />
      ) : documents.length > 0 && view === "table" ? (
        // The result grid owns its own scroller so sticky columns can pin to it.
        <ResultTable
          documents={documents}
          columns={columns}
          storageKey={storageKey}
          dictionaries={dictionaries}
          renderers={renderers}
          colors={colors}
        />
      ) : (
        <div className="scrollbar-thin min-h-0 flex-1 overflow-auto p-3">
          {!ran ? (
            <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
              {notRunText}
            </div>
          ) : view === "json" ? (
            <JsonView value={documents} maxHeight="none" />
          ) : (
            <div className="text-muted-foreground flex h-32 items-center justify-center text-sm">
              {emptyText}
            </div>
          )}
        </div>
      )}
    </>
  )
}
