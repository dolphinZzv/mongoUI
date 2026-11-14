import * as React from "react"
import { BarChart3, LayoutDashboard, Link2, Loader2, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { ChartView } from "@/components/chart-view"
import { Button } from "@/components/ui/button"
import { copyToClipboard } from "@/lib/clipboard"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { collectionLabel, databaseLabel, useAliases } from "@/lib/aliases"
import type { SavedChartView } from "@/lib/chart"
import type { Connection, Selection } from "@/lib/types"

interface DashboardViewProps {
  connections: Connection[]
  onOpenChart: (selection: Selection, chart: SavedChartView) => void
}

interface DashboardChart {
  connection: Connection
  scope: string
  view: SavedChartView
}

/** Cross-connection dashboard made of server-shared pinned chart views. */
export function DashboardView({ connections, onOpenChart }: DashboardViewProps) {
  const { t } = useI18n()
  const aliases = useAliases()
  const [charts, setCharts] = React.useState<DashboardChart[]>([])
  const [loading, setLoading] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const results = await Promise.all(
        connections.map(async (connection) => {
          if (!connection.connected) return []
          try {
            const res = await api.getConnectionChartViews(connection.id)
            return Object.entries(res.scopes ?? {}).flatMap(([scope, views]) =>
              views.filter((view) => view.pinned).map((view) => ({ connection, scope, view })),
            )
          } catch {
            return []
          }
        }),
      )
      setCharts(results.flat())
    } finally {
      setLoading(false)
    }
  }, [connections])

  React.useEffect(() => {
    void load()
  }, [load])

  const share = async () => {
    const ok = await copyToClipboard(window.location.href)
    if (ok) toast.success(t("dashboard.linkCopied"))
    else toast.error(t("common.copyFailed"))
  }

  return (
    <div className="scrollbar-thin h-full min-h-0 overflow-auto">
      <div className="flex flex-wrap items-center gap-2 border-b p-4">
        <LayoutDashboard className="text-primary size-5" />
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold">{t("dashboard.title")}</h1>
          <p className="text-muted-foreground text-xs">{t("dashboard.desc")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void share()}>
          <Link2 /> {t("dashboard.share")}
        </Button>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />} {t("common.refresh")}
        </Button>
      </div>

      {!loading && charts.length === 0 ? (
        <div className="text-muted-foreground flex h-64 flex-col items-center justify-center gap-2 text-sm">
          <BarChart3 className="size-8" />
          {t("dashboard.empty")}
        </div>
      ) : null}

      <div className="grid gap-3 p-4 lg:grid-cols-2 2xl:grid-cols-3">
        {charts.map(({ connection, scope, view }) => {
          const [, database, collection] = scope.split("::")
          if (!database || !collection) return null
          let filter: unknown = {}
          try {
            filter = JSON.parse(view.filter || "{}")
          } catch {
            filter = {}
          }
          return (
            <div key={`${connection.id}:${scope}:${view.id}`} className="rounded-lg border p-2">
              <div className="mb-1 flex items-center gap-2 px-1">
                <BarChart3 className="text-muted-foreground size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{view.name}</span>
                <span className="text-muted-foreground hidden max-w-48 truncate text-xs sm:block">
                  {connection.name} · {databaseLabel(aliases, connection.id, database)}.
                  {collectionLabel(aliases, connection.id, database, collection)}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px]"
                  onClick={() =>
                    onOpenChart(
                      { kind: "collection", connectionId: connection.id, database, collection },
                      view,
                    )
                  }
                >
                  {t("chart.openShort")}
                </Button>
              </div>
              <ChartView
                compact
                documents={[]}
                columns={[]}
                connectionId={connection.id}
                database={database}
                collection={collection}
                filter={filter}
                initialConfig={view.config}
                height={220}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
