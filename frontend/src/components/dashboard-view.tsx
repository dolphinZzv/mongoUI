import * as React from "react"
import { BarChart3, LayoutDashboard, Link2, Loader2, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { ChartFilterBox } from "@/components/chart-filter-box"
import { ChartView } from "@/components/chart-view"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { copyToClipboard } from "@/lib/clipboard"
import { api } from "@/lib/api"
import { useChartFilter } from "@/hooks/useChartFilter"
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

const REFRESH_OPTIONS = [0, 30, 60, 300] as const

function readInitialFilter() {
  return new URLSearchParams(window.location.search).get("filter") ?? "{}"
}

function readInitialRefresh() {
  const raw = Number(new URLSearchParams(window.location.search).get("refresh"))
  return (REFRESH_OPTIONS as readonly number[]).includes(raw) ? raw : 0
}

function parseFilter(text: string): unknown | null {
  try {
    const value = JSON.parse(text.trim() || "{}")
    return value && typeof value === "object" && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

function mergeFilters(baseText: string | undefined, shared: unknown): unknown {
  const base = parseFilter(baseText ?? "{}")
  if (base === null) return {}
  if (!shared || Object.keys(shared as Record<string, unknown>).length === 0) return base
  if (!base || Object.keys(base as Record<string, unknown>).length === 0) return shared
  return { $and: [base, shared] }
}

function isEmptyFilter(value: unknown) {
  return !value || Object.keys(value as Record<string, unknown>).length === 0
}

/** Cross-connection dashboard made of server-shared pinned chart views. */
export function DashboardView({ connections, onOpenChart }: DashboardViewProps) {
  const { t } = useI18n()
  const aliases = useAliases()
  const { filterText, setFilterText, debounced, parsed } = useChartFilter(readInitialFilter())
  const [charts, setCharts] = React.useState<DashboardChart[]>([])
  const [loading, setLoading] = React.useState(false)
  const [refreshSeconds, setRefreshSeconds] = React.useState(readInitialRefresh)
  const [refreshSignal, setRefreshSignal] = React.useState(0)
  const requestRef = React.useRef(0)

  const load = React.useCallback(async () => {
    const request = ++requestRef.current
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
      if (request === requestRef.current) setCharts(results.flat())
    } finally {
      if (request === requestRef.current) setLoading(false)
    }
  }, [connections])

  React.useEffect(() => {
    void load()
  }, [load])

  React.useEffect(() => {
    if (refreshSeconds <= 0) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") setRefreshSignal((value) => value + 1)
    }, refreshSeconds * 1000)
    return () => window.clearInterval(timer)
  }, [refreshSeconds])

  // Keep the shared filter and refresh interval in the URL so the copy-link
  // button produces a dashboard that restores the same view.
  React.useEffect(() => {
    if (parsed === null) return
    const params = new URLSearchParams(window.location.search)
    if (isEmptyFilter(parsed)) params.delete("filter")
    else params.set("filter", debounced.trim())
    if (refreshSeconds > 0) params.set("refresh", String(refreshSeconds))
    else params.delete("refresh")
    const query = params.toString()
    const next = window.location.pathname + (query ? `?${query}` : "")
    if (next !== window.location.pathname + window.location.search) {
      window.history.replaceState(null, "", next)
    }
  }, [debounced, parsed, refreshSeconds])

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
        <Select
          value={String(refreshSeconds)}
          onValueChange={(value) => setRefreshSeconds(Number(value))}
        >
          <SelectTrigger size="sm" className="w-32" aria-label={t("dashboard.refresh")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REFRESH_OPTIONS.map((seconds) => (
              <SelectItem key={seconds} value={String(seconds)}>
                {seconds === 0
                  ? t("dashboard.refreshOff")
                  : t("dashboard.refreshEvery", { seconds })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => void share()}>
          <Link2 /> {t("dashboard.share")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setRefreshSignal((value) => value + 1)
            void load()
          }}
          disabled={loading}
        >
          {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />} {t("common.refresh")}
        </Button>
      </div>

      <div className="border-b px-4 py-3">
        <span className="text-xs font-medium">{t("dashboard.filter")}</span>
        <ChartFilterBox
          value={filterText}
          onChange={setFilterText}
          parsed={parsed}
        />
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
                filter={mergeFilters(view.filter, parsed)}
                filterValid={parsed !== null}
                initialConfig={view.config}
                refreshSignal={refreshSignal}
                height={220}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
