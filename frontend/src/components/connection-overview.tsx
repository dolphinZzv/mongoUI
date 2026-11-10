import * as React from "react"
import { AlertCircle, BarChart3, Database, HardDrive, Loader2, RefreshCw, Server, ShieldCheck } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { databaseLabel, useAliases } from "@/lib/aliases"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { formatBytes } from "@/lib/mongo"
import type { SavedChartView } from "@/lib/chart"
import type { Connection, DatabaseInfo, Selection } from "@/lib/types"

interface ConnectionOverviewProps {
  connection: Connection
  onOpenChart?: (selection: Selection, chart: SavedChartView) => void
}

function maskUri(uri: string): string {
  return uri.replace(/\/\/([^:@/]+):([^@/]+)@/, "//$1:••••••@")
}

function pick(value: unknown, key: string): unknown {
  if (value && typeof value === "object" && key in value) {
    return (value as Record<string, unknown>)[key]
  }
  return undefined
}

function display(value: unknown): string {
  if (value === undefined || value === null) return "—"
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

export function ConnectionOverview({ connection, onOpenChart }: ConnectionOverviewProps) {
  const { t } = useI18n()
  const aliases = useAliases()
  const [databases, setDatabases] = React.useState<DatabaseInfo[]>([])
  const [totalSize, setTotalSize] = React.useState(0)
  const [server, setServer] = React.useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [pinnedCharts, setPinnedCharts] = React.useState<
    { scope: string; view: SavedChartView }[]
  >([])

  const load = React.useCallback(async () => {
    setError(null)
    if (!connection.connected) {
      setDatabases([])
      setServer(null)
      return
    }
    setLoading(true)
    try {
      const [dbResult, serverResult, chartResult] = await Promise.all([
        api.listDatabases(connection.id),
        api.serverInfo(connection.id).catch(() => null),
        api.getConnectionChartViews(connection.id).catch(() => ({ scopes: {} })),
      ])
      setDatabases(dbResult.databases)
      setTotalSize(dbResult.totalSize)
      setServer(serverResult)
      setPinnedCharts(
        Object.entries(chartResult.scopes ?? {}).flatMap(([scope, views]) =>
          views.filter((view) => view.pinned).map((view) => ({ scope, view })),
        ),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : t("overview.loadDbFailed"))
    } finally {
      setLoading(false)
    }
  }, [connection.id, connection.connected, t])

  React.useEffect(() => {
    void load()
  }, [load])

  const hello = server?.hello
  const buildInfo = server?.buildInfo
  const version = display(pick(buildInfo, "version"))
  const uptime = pick(hello, "uptime") ?? pick(buildInfo, "uptime")

  return (
    <div className="scrollbar-thin h-full min-h-0 overflow-auto">
      <div className="border-b p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className="size-3 rounded-full"
            style={{ backgroundColor: connection.color || "#10b981" }}
          />
          <h1 className="text-lg font-semibold">{connection.name}</h1>
          <Badge variant={connection.connected ? "default" : "secondary"}>
            {connection.connected ? t("overview.connected") : t("overview.disconnected")}
          </Badge>
          {connection.readOnly ? (
            <Badge variant="outline">
              <ShieldCheck /> {t("overview.readOnly")}
            </Badge>
          ) : null}
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => void load()}>
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />} {t("common.refresh")}
          </Button>
        </div>
        <p className="text-muted-foreground mt-2 font-mono text-xs">{maskUri(connection.uri)}</p>
      </div>

      {error ? (
        <div className="border-destructive/40 bg-destructive/5 text-destructive flex flex-wrap items-center gap-2 border-b px-4 py-2 text-xs">
          <AlertCircle className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate" title={error}>
            {error}
          </span>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            {t("error.retry")}
          </Button>
        </div>
      ) : null}

      {!connection.connected ? (
        <div className="text-muted-foreground flex h-64 flex-col items-center justify-center gap-2 text-sm">
          <Server className="size-8" />
          {t("overview.connectHint")}
        </div>
      ) : (
        <div className="space-y-4 p-4">
          {pinnedCharts.length > 0 ? (
            <div className="space-y-2">
              <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                {t("overview.pinnedCharts")}
              </h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {pinnedCharts.map(({ scope, view }) => {
                  const [connectionId, database, collection] = scope.split("::")
                  if (!database || !collection) return null
                  return (
                    <button
                      key={`${scope}-${view.id}`}
                      type="button"
                      onClick={() =>
                        onOpenChart?.(
                          { kind: "collection", connectionId, database, collection },
                          view,
                        )
                      }
                      className="hover:bg-accent/50 flex items-center gap-3 rounded-lg border p-3 text-left transition-colors"
                    >
                      <BarChart3 className="text-muted-foreground size-4 shrink-0" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{view.name}</span>
                        <span className="text-muted-foreground block truncate text-xs">
                          {database}.{collection}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="gap-0 py-4">
              <CardHeader className="px-4">
                <CardTitle className="text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-wide uppercase">
                  <Server className="size-3.5" /> {t("overview.version")}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4">
                <p className="text-xl font-semibold">{version}</p>
              </CardContent>
            </Card>
            <Card className="gap-0 py-4">
              <CardHeader className="px-4">
                <CardTitle className="text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-wide uppercase">
                  <Database className="size-3.5" /> {t("overview.databases")}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4">
                <p className="text-xl font-semibold">{databases.length}</p>
              </CardContent>
            </Card>
            <Card className="gap-0 py-4">
              <CardHeader className="px-4">
                <CardTitle className="text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-wide uppercase">
                  <HardDrive className="size-3.5" /> {t("overview.dataSize")}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4">
                <p className="text-xl font-semibold">{formatBytes(totalSize)}</p>
              </CardContent>
            </Card>
            <Card className="gap-0 py-4">
              <CardHeader className="px-4">
                <CardTitle className="text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-wide uppercase">
                  {t("overview.uptime")}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4">
                <p className="text-xl font-semibold">
                  {uptime !== undefined ? `${Math.round(Number(uptime) / 60)} ${t("overview.min")}` : "—"}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card className="gap-0 py-0">
            <CardHeader className="border-b py-3">
              <CardTitle className="text-sm">{t("overview.databases")}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>{t("overview.name")}</TableHead>
                    <TableHead className="text-right">{t("overview.sizeOnDisk")}</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && databases.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="h-20 text-center">
                        <Loader2 className="text-muted-foreground mx-auto size-4 animate-spin" />
                      </TableCell>
                    </TableRow>
                  ) : null}
                  {databases.map((database) => (
                    <TableRow key={database.name}>
                      <TableCell>
                        <span
                          className="flex items-center gap-2 text-sm"
                          title={database.name}
                        >
                          <Database className="text-muted-foreground size-3.5" />
                          {databaseLabel(aliases, connection.id, database.name)}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-right text-xs">
                        {formatBytes(database.sizeOnDisk)}
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  ))}
                  {!loading && databases.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-muted-foreground h-20 text-center text-sm">
                        {t("overview.noDatabases")}
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {buildInfo ? (
            <Card className="gap-0 py-0">
              <CardHeader className="border-b py-3">
                <CardTitle className="text-sm">{t("overview.buildInfo")}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-x-8 gap-y-2 p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <Info label={t("overview.version")} value={display(pick(buildInfo, "version"))} />
                <Info label={t("overview.build.gitVersion")} value={display(pick(buildInfo, "gitVersion"))} />
                <Info label={t("overview.build.allocator")} value={display(pick(buildInfo, "allocator"))} />
                <Info label={t("overview.build.jsEngine")} value={display(pick(buildInfo, "javascriptEngine"))} />
                <Info label={t("overview.build.modules")} value={display(pick(buildInfo, "modules"))} />
                <Info label={t("overview.build.bits")} value={display(pick(buildInfo, "bits"))} />
                <Info label={t("overview.build.debug")} value={display(pick(buildInfo, "debug"))} />
                <Info label={t("overview.build.maxBson")} value={display(pick(buildInfo, "maxBsonObjectSize"))} />
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b py-1 last:border-0 sm:border-0">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="truncate font-mono text-xs" title={value}>
        {value}
      </span>
    </div>
  )
}
