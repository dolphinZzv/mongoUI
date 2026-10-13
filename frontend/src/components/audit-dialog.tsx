import * as React from "react"
import { Loader2, RefreshCw, ScrollText } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import type { AuditEntry, Connection } from "@/lib/types"

interface AuditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connections: Connection[]
}

const ALL = "__all__"

/** A view of the server's in-memory write-operation audit log. */
export function AuditDialog({ open, onOpenChange, connections }: AuditDialogProps) {
  const { t } = useI18n()
  const [connectionId, setConnectionId] = React.useState<string>(ALL)
  const [entries, setEntries] = React.useState<AuditEntry[]>([])
  const [loading, setLoading] = React.useState(false)

  const load = React.useCallback(
    async (id: string) => {
      setLoading(true)
      try {
        const res = await api.listAudit({ connectionId: id === ALL ? undefined : id, limit: 200 })
        setEntries(res.entries)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("audit.failed"))
      } finally {
        setLoading(false)
      }
    },
    [t],
  )

  React.useEffect(() => {
    if (open) void load(connectionId)
  }, [open, connectionId, load])

  const connectionName = (id: string) => connections.find((c) => c.id === id)?.name ?? id

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("audit.title")}</DialogTitle>
          <DialogDescription>{t("audit.desc")}</DialogDescription>
        </DialogHeader>

        <div className="flex shrink-0 items-center gap-2">
          <Select value={connectionId} onValueChange={setConnectionId}>
            <SelectTrigger size="sm" className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("audit.allConnections")}</SelectItem>
              {connections.map((connection) => (
                <SelectItem key={connection.id} value={connection.id}>
                  {connection.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load(connectionId)}
            disabled={loading}
          >
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />} {t("common.refresh")}
          </Button>
        </div>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-auto rounded-md border">
          {entries.length === 0 && !loading ? (
            <p className="text-muted-foreground p-8 text-center text-sm">{t("audit.empty")}</p>
          ) : null}
          {entries.length > 0 ? (
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-muted-foreground sticky top-0 text-left">
                <tr>
                  <th className="px-2 py-1.5 font-medium">{t("audit.time")}</th>
                  <th className="px-2 py-1.5 font-medium">{t("audit.operation")}</th>
                  <th className="px-2 py-1.5 font-medium">{t("audit.target")}</th>
                  <th className="px-2 py-1.5 font-medium">{t("audit.status")}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, index) => (
                  <tr key={`${entry.time}-${index}`} className="border-t">
                    <td className="px-2 py-1 font-mono whitespace-nowrap">
                      {new Date(entry.time).toLocaleString()}
                    </td>
                    <td className="px-2 py-1">
                      <span className="font-mono">{entry.method}</span> {entry.operation}
                    </td>
                    <td className="px-2 py-1">
                      <span className="text-muted-foreground">
                        {connectionName(entry.connectionId)}
                      </span>
                      {entry.database
                        ? ` / ${entry.database}${entry.collection ? ` / ${entry.collection}` : ""}`
                        : null}
                    </td>
                    <td className="px-2 py-1 font-mono">{entry.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>

        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          <ScrollText className="size-3.5" /> {t("audit.inMemory")}
        </div>
      </DialogContent>
    </Dialog>
  )
}
