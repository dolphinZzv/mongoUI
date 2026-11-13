import * as React from "react"

import { AggregationTab } from "@/components/aggregation-tab"
import { SqlTab } from "@/components/sql-tab"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export type QueryMode = "sql" | "aggregation"

export interface QueryTabProps {
  connectionId: string
  database: string
  collection: string
  mode: QueryMode
  onModeChange?: (mode: QueryMode) => void
}

/**
 * One workspace for the two server-side query languages. SQL and aggregation
 * keep their own editors/results, but no longer need separate collection tabs.
 */
export function QueryTab({
  connectionId,
  database,
  collection,
  mode,
  onModeChange,
}: QueryTabProps) {
  const { t } = useI18n()
  const [localMode, setLocalMode] = React.useState<QueryMode>(mode)
  React.useEffect(() => setLocalMode(mode), [mode])
  const active = onModeChange ? mode : localMode
  const change = (next: QueryMode) => {
    if (onModeChange) onModeChange(next)
    else setLocalMode(next)
  }

  const modeSwitch = (
    <div
      role="tablist"
      aria-label={t("collection.tab.query")}
      className="bg-muted/40 inline-flex items-center rounded-md border p-0.5"
    >
      {(["sql", "aggregation"] as const).map((value) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={active === value}
          data-testid={`query-mode-${value}`}
          onClick={() => change(value)}
          className={cn(
            "rounded px-2.5 py-1 text-xs font-medium transition-colors",
            active === value
              ? "bg-background text-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t(value === "sql" ? "collection.tab.sql" : "collection.tab.aggregation")}
        </button>
      ))}
    </div>
  )

  if (active === "aggregation") {
    return (
      <AggregationTab
        connectionId={connectionId}
        database={database}
        collection={collection}
        modeSwitch={modeSwitch}
      />
    )
  }
  return (
    <SqlTab
      connectionId={connectionId}
      database={database}
      collection={collection}
      modeSwitch={modeSwitch}
    />
  )
}
