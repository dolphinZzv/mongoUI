import * as React from "react"
import { AlertCircle } from "lucide-react"

import { ChartView } from "@/components/chart-view"
import { MongoFilterEditor } from "@/components/mongo-filter-editor"
import { useI18n } from "@/lib/i18n"

interface ChartTabProps {
  connectionId: string
  database: string
  collection: string
  /** The documents filter is offered as a starting point. */
  initialFilter?: string
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
}: ChartTabProps) {
  const { t } = useI18n()
  const [filterText, setFilterText] = React.useState(initialFilter ?? "{}")
  const [debounced, setDebounced] = React.useState(initialFilter ?? "{}")

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(filterText), 500)
    return () => window.clearTimeout(timer)
  }, [filterText])

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
