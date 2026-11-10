import * as React from "react"
import { AlertCircle } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ChartView } from "@/components/chart-view"
import { MongoFilterEditor } from "@/components/mongo-filter-editor"
import { copyToClipboard } from "@/lib/clipboard"
import { useI18n } from "@/lib/i18n"
import { encodeChartParam } from "@/lib/router"
import type { ChartConfig } from "@/lib/chart"
import type { MongoDocument } from "@/lib/types"
import { toast } from "sonner"

interface ChartDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  documents: MongoDocument[]
  columns: string[]
  fieldTypes?: Record<string, string>
  connectionId?: string
  database?: string
  collection?: string
  /** Current documents filter; the chart can refine it without closing. */
  filter?: string
  /** Chart state restored from the URL. */
  initialConfig?: ChartConfig
  initialFilter?: string
  onConfigChange?: (config: ChartConfig) => void
  onFilterChange?: (filter: string) => void
  storageKey?: string
  /** Push the chart's filter back to the documents tab. */
  onApplyFilter?: (filter: string) => void
}

/**
 * A large dialog that plots the collection. It owns a filter editor so users can
 * refine the query and see the chart update in place instead of closing,
 * re-running the table and losing the chart configuration.
 */
export function ChartDialog({
  open,
  onOpenChange,
  documents,
  columns,
  fieldTypes,
  connectionId,
  database,
  collection,
  filter,
  initialConfig,
  initialFilter,
  onConfigChange,
  onFilterChange,
  storageKey,
  onApplyFilter,
}: ChartDialogProps) {
  const { t } = useI18n()
  const [filterText, setFilterText] = React.useState(initialFilter ?? filter ?? "{}")
  const [debounced, setDebounced] = React.useState(initialFilter ?? filter ?? "{}")

  // Start from the table's filter each time the dialog opens; edits made inside
  // the dialog stay local until the user applies them.
  React.useEffect(() => {
    if (!open) return
    setFilterText(initialFilter ?? filter ?? "{}")
    setDebounced(initialFilter ?? filter ?? "{}")
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(filterText), 500)
    return () => window.clearTimeout(timer)
  }, [filterText])

  React.useEffect(() => {
    onFilterChange?.(debounced)
  }, [debounced, onFilterChange])

  const parsed = React.useMemo(() => {
    try {
      return JSON.parse(debounced.trim() || "{}") as unknown
    } catch {
      return null
    }
  }, [debounced])

  const drilldown = (extra: Record<string, unknown>) => {
    let current: Record<string, unknown> = {}
    try {
      current = JSON.parse(filterText.trim() || "{}") as Record<string, unknown>
    } catch {
      current = {}
    }
    const next =
      Object.keys(current).length > 0 ? { $and: [current, extra] } : extra
    const text = JSON.stringify(next, null, 2)
    setFilterText(text)
    setDebounced(text)
  }

  const share = async (config: ChartConfig) => {
    const url = new URL(window.location.href)
    url.searchParams.set(
      "chart",
      encodeChartParam({ config, filter: filterText }),
    )
    const copied = await copyToClipboard(url.toString())
    if (copied) toast.success(t("chart.linkCopied"))
    else toast.error(t("chart.linkFailed"))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[88vh] max-h-[calc(100vh-2rem)] flex-col gap-3 overflow-hidden sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>{t("chart.title")}</DialogTitle>
          <DialogDescription>{t("chart.desc")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          <MongoFilterEditor
            value={filterText}
            onChange={setFilterText}
            placeholder={t("docs.filterPlaceholder")}
            suggestions={columns}
          />
          {parsed === null ? (
            <p className="text-destructive flex items-center gap-1.5 text-xs" role="alert">
              <AlertCircle className="size-3.5" /> {t("docs.invalidJson")}
            </p>
          ) : null}
        </div>

        <ChartView
          className="min-h-0 flex-1"
          documents={documents}
          columns={columns}
          fieldTypes={fieldTypes}
          connectionId={connectionId}
          database={database}
          collection={collection}
          filter={parsed ?? {}}
          filterValid={parsed !== null}
          initialConfig={initialConfig}
          onConfigChange={onConfigChange}
          onShare={share}
          storageKey={storageKey}
          height={420}
          onDrilldown={drilldown}
          onApplyFilter={
            onApplyFilter
              ? () => {
                  onApplyFilter(filterText)
                  onOpenChange(false)
                }
              : undefined
          }
        />
      </DialogContent>
    </Dialog>
  )
}
