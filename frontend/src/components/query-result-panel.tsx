import { Ban, BarChart3, Braces, Copy, Download, FileJson, FileSpreadsheet, Table2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ChartView } from "@/components/chart-view"
import { ResultTable } from "@/components/documents/result-table"
import { JsonView } from "@/components/json-view"
import { QueryDuration } from "@/components/query-duration"
import { copyToClipboard } from "@/lib/clipboard"
import { downloadText } from "@/lib/download"
import { resultExportName, resultToCSV, resultToJSON } from "@/lib/resultExport"
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
  loading?: boolean
  onCancel?: () => void
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
  loading = false,
  onCancel,
  dictionaries,
  renderers,
  colors,
}: QueryResultPanelProps) {
  const { t } = useI18n()
  const canExport = ran && documents.length > 0

  const copyResults = async () => {
    const ok = await copyToClipboard(resultToJSON(documents))
    if (ok) toast.success(t("common.copied"))
    else toast.error(t("common.copyFailed"))
  }

  const exportResults = (format: "json" | "csv") => {
    const content = format === "csv" ? resultToCSV(documents) : resultToJSON(documents)
    downloadText(
      resultExportName(storageKey, format),
      content,
      format === "csv" ? "text/csv;charset=utf-8" : "application/json",
    )
  }

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
        <span className="bg-border mx-1 h-5 w-px" />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => void copyResults()}
          disabled={!canExport}
          title={t("result.copy")}
          aria-label={t("result.copy")}
          data-testid="query-copy"
        >
          <Copy />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={!canExport}
              title={t("result.export")}
              aria-label={t("result.export")}
              data-testid="query-export"
            >
              <Download />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => exportResults("json")}>
              <FileJson /> {t("result.exportJson")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => exportResults("csv")}>
              <FileSpreadsheet /> {t("result.exportCsv")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {loading && onCancel ? (
          <Button variant="outline" size="sm" onClick={onCancel} data-testid="query-cancel">
            <Ban /> {t("result.cancel")}
          </Button>
        ) : null}
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
