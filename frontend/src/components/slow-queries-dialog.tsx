import * as React from "react"
import { Loader2, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { formatValue, prettyJSON } from "@/lib/mongo"
import type { Connection, DatabaseInfo, MongoDocument, Selection } from "@/lib/types"

interface SlowQueriesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connections: Connection[]
  selection: Selection
}

/** Reads the database profiler (db.system.profile) for recent slow operations. */
export function SlowQueriesDialog({
  open,
  onOpenChange,
  connections,
  selection,
}: SlowQueriesDialogProps) {
  const { t } = useI18n()
  const [connectionId, setConnectionId] = React.useState("")
  const [database, setDatabase] = React.useState("")
  const [databases, setDatabases] = React.useState<DatabaseInfo[]>([])
  const [minMillis, setMinMillis] = React.useState("100")
  const [entries, setEntries] = React.useState<MongoDocument[]>([])
  const [enabled, setEnabled] = React.useState(true)
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    if (selection.kind !== "welcome") {
      setConnectionId(selection.connectionId)
      if (selection.kind === "collection") setDatabase(selection.database)
    } else if (connections[0]) {
      setConnectionId(connections[0].id)
    }
  }, [open, selection, connections])

  React.useEffect(() => {
    if (!open || !connectionId) return
    let cancelled = false
    void api
      .listDatabases(connectionId)
      .then((res) => {
        if (cancelled) return
        setDatabases(res.databases)
        setDatabase((prev) =>
          res.databases.some((entry) => entry.name === prev) ? prev : (res.databases[0]?.name ?? ""),
        )
      })
      .catch((err) => {
        if (!cancelled) toast.error(err instanceof Error ? err.message : t("profile.failed"))
      })
    return () => {
      cancelled = true
    }
  }, [open, connectionId, t])

  const load = React.useCallback(
    async (id: string, db: string, min: string) => {
      if (!id || !db) return
      setLoading(true)
      try {
        const res = await api.databaseProfile(id, db, {
          limit: 100,
          minMillis: Number(min) > 0 ? Number(min) : undefined,
        })
        setEnabled(res.enabled)
        setEntries(res.entries)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("profile.failed"))
      } finally {
        setLoading(false)
      }
    },
    [t],
  )

  React.useEffect(() => {
    if (open && connectionId && database) void load(connectionId, database, minMillis)
    // minMillis is applied by the refresh button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, connectionId, database, load])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("profile.title")}</DialogTitle>
          <DialogDescription>{t("profile.desc")}</DialogDescription>
        </DialogHeader>

        <div className="flex shrink-0 flex-wrap items-end gap-3">
          <div className="grid gap-1">
            <Label className="text-xs">{t("search.connection")}</Label>
            <Select value={connectionId} onValueChange={setConnectionId}>
              <SelectTrigger size="sm" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {connections.map((connection) => (
                  <SelectItem key={connection.id} value={connection.id}>
                    {connection.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">{t("search.database")}</Label>
            <Select value={database} onValueChange={setDatabase}>
              <SelectTrigger size="sm" className="w-48">
                <SelectValue placeholder={t("search.database")} />
              </SelectTrigger>
              <SelectContent>
                {databases.map((entry) => (
                  <SelectItem key={entry.name} value={entry.name}>
                    {entry.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">{t("profile.minMillis")}</Label>
            <Input
              value={minMillis}
              onChange={(event) => setMinMillis(event.target.value)}
              inputMode="numeric"
              className="h-8 w-24 font-mono text-xs"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load(connectionId, database, minMillis)}
            disabled={loading || !database}
          >
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />} {t("common.refresh")}
          </Button>
        </div>

        <div className="scrollbar-thin min-h-0 flex-1 space-y-2 overflow-auto">
          {!enabled ? (
            <p className="text-muted-foreground rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
              {t("profile.off")}
            </p>
          ) : null}
          {enabled && entries.length === 0 && !loading ? (
            <p className="text-muted-foreground p-8 text-center text-sm">{t("profile.empty")}</p>
          ) : null}
          {entries.map((entry, index) => (
            <details key={index} className="rounded-md border p-2">
              <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="font-mono font-medium text-amber-600 dark:text-amber-400">
                  {String(entry.millis ?? "?")} ms
                </span>
                <span className="font-mono">{String(entry.op ?? "")}</span>
                <span className="text-muted-foreground">{String(entry.ns ?? "")}</span>
                <span className="text-muted-foreground ml-auto font-mono">
                  {formatValue(entry.ts)}
                </span>
              </summary>
              <pre className="bg-muted/40 scrollbar-thin mt-2 max-h-64 overflow-auto rounded p-2 font-mono text-[11px]">
                {prettyJSON(entry)}
              </pre>
            </details>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
