import * as React from "react"
import { Database, HardDrive, Loader2, RefreshCw, Server, ShieldCheck } from "lucide-react"
import { toast } from "sonner"

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
import { api } from "@/lib/api"
import { formatBytes } from "@/lib/mongo"
import type { Connection, DatabaseInfo } from "@/lib/types"

interface ConnectionOverviewProps {
  connection: Connection
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

export function ConnectionOverview({ connection }: ConnectionOverviewProps) {
  const [databases, setDatabases] = React.useState<DatabaseInfo[]>([])
  const [totalSize, setTotalSize] = React.useState(0)
  const [server, setServer] = React.useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = React.useState(false)

  const load = React.useCallback(async () => {
    if (!connection.connected) {
      setDatabases([])
      setServer(null)
      return
    }
    setLoading(true)
    try {
      const [dbResult, serverResult] = await Promise.all([
        api.listDatabases(connection.id),
        api.serverInfo(connection.id).catch(() => null),
      ])
      setDatabases(dbResult.databases)
      setTotalSize(dbResult.totalSize)
      setServer(serverResult)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load databases")
    } finally {
      setLoading(false)
    }
  }, [connection.id, connection.connected])

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
            {connection.connected ? "Connected" : "Disconnected"}
          </Badge>
          {connection.readOnly ? (
            <Badge variant="outline">
              <ShieldCheck /> Read-only
            </Badge>
          ) : null}
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => void load()}>
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />} Refresh
          </Button>
        </div>
        <p className="text-muted-foreground mt-2 font-mono text-xs">{maskUri(connection.uri)}</p>
      </div>

      {!connection.connected ? (
        <div className="text-muted-foreground flex h-64 flex-col items-center justify-center gap-2 text-sm">
          <Server className="size-8" />
          Connect this connection to browse its server.
        </div>
      ) : (
        <div className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="gap-0 py-4">
              <CardHeader className="px-4">
                <CardTitle className="text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-wide uppercase">
                  <Server className="size-3.5" /> Version
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4">
                <p className="text-xl font-semibold">{version}</p>
              </CardContent>
            </Card>
            <Card className="gap-0 py-4">
              <CardHeader className="px-4">
                <CardTitle className="text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-wide uppercase">
                  <Database className="size-3.5" /> Databases
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4">
                <p className="text-xl font-semibold">{databases.length}</p>
              </CardContent>
            </Card>
            <Card className="gap-0 py-4">
              <CardHeader className="px-4">
                <CardTitle className="text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-wide uppercase">
                  <HardDrive className="size-3.5" /> Data size
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4">
                <p className="text-xl font-semibold">{formatBytes(totalSize)}</p>
              </CardContent>
            </Card>
            <Card className="gap-0 py-4">
              <CardHeader className="px-4">
                <CardTitle className="text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-wide uppercase">
                  Uptime
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4">
                <p className="text-xl font-semibold">
                  {uptime !== undefined ? `${Math.round(Number(uptime) / 60)} min` : "—"}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card className="gap-0 py-0">
            <CardHeader className="border-b py-3">
              <CardTitle className="text-sm">Databases</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Name</TableHead>
                    <TableHead className="text-right">Size on disk</TableHead>
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
                        <span className="flex items-center gap-2 text-sm">
                          <Database className="text-muted-foreground size-3.5" />
                          {database.name}
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
                        No databases.
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
                <CardTitle className="text-sm">Build info</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-x-8 gap-y-2 p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <Info label="Version" value={display(pick(buildInfo, "version"))} />
                <Info label="Git version" value={display(pick(buildInfo, "gitVersion"))} />
                <Info label="Allocator" value={display(pick(buildInfo, "allocator"))} />
                <Info label="JS engine" value={display(pick(buildInfo, "javascriptEngine"))} />
                <Info label="Modules" value={display(pick(buildInfo, "modules"))} />
                <Info label="Bits" value={display(pick(buildInfo, "bits"))} />
                <Info label="Debug" value={display(pick(buildInfo, "debug"))} />
                <Info label="Max BSON" value={display(pick(buildInfo, "maxBsonObjectSize"))} />
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
