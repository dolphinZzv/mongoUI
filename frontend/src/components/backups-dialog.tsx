import * as React from "react"
import { Download, History, Loader2, Play, Plus, RefreshCw, Trash2 } from "lucide-react"
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
import { Switch } from "@/components/ui/switch"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { formatBytes } from "@/lib/mongo"
import type { BackupFile, BackupTask, Connection } from "@/lib/types"

interface BackupsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Manage scheduled collection exports (admin only). */
export function BackupsDialog({ open, onOpenChange }: BackupsDialogProps) {
  const { t } = useI18n()
  const [connections, setConnections] = React.useState<Connection[]>([])
  const [tasks, setTasks] = React.useState<BackupTask[]>([])
  const [loading, setLoading] = React.useState(false)
  const [adding, setAdding] = React.useState(false)
  const [connectionId, setConnectionId] = React.useState("")
  const [database, setDatabase] = React.useState("")
  const [collection, setCollection] = React.useState("")
  const [format, setFormat] = React.useState("json")
  const [interval, setIntervalMinutes] = React.useState("60")
  const [enabled, setEnabled] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [openTaskId, setOpenTaskId] = React.useState<string | null>(null)
  const [files, setFiles] = React.useState<BackupFile[]>([])
  const [filesLoading, setFilesLoading] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.listBackups()
      setTasks(res.tasks)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("backups.failed"))
    } finally {
      setLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    if (!open) return
    setAdding(false)
    void api
      .listConnections()
      .then((list) => {
        setConnections(list)
        setConnectionId((prev) => prev || list[0]?.id || "")
      })
      .catch(() => setConnections([]))
    void load()
  }, [open, load])

  const create = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!connectionId || !database.trim() || !collection.trim()) return
    setBusy(true)
    try {
      await api.createBackup({
        connectionId,
        database: database.trim(),
        collection: collection.trim(),
        format,
        intervalMinutes: Number(interval) || 60,
        enabled,
      })
      setDatabase("")
      setCollection("")
      setAdding(false)
      toast.success(t("backups.created"))
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("backups.failed"))
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (task: BackupTask, value: boolean) => {
    try {
      await api.updateBackup(task.id, { enabled: value })
      setTasks((prev) => prev.map((entry) => (entry.id === task.id ? { ...entry, enabled: value } : entry)))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("backups.failed"))
    }
  }

  const run = async (task: BackupTask) => {
    try {
      await api.runBackup(task.id)
      toast.success(t("backups.running"))
      window.setTimeout(() => void load(), 1500)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("backups.failed"))
    }
  }

  const remove = async (task: BackupTask) => {
    try {
      await api.deleteBackup(task.id)
      setTasks((prev) => prev.filter((entry) => entry.id !== task.id))
      toast.success(t("backups.deleted"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("backups.failed"))
    }
  }

  const toggleHistory = async (task: BackupTask) => {
    if (openTaskId === task.id) {
      setOpenTaskId(null)
      return
    }
    setOpenTaskId(task.id)
    setFiles([])
    setFilesLoading(true)
    try {
      const res = await api.listBackupFiles(task.id)
      setFiles(res.files)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("backups.failed"))
    } finally {
      setFilesLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("backups.title")}</DialogTitle>
          <DialogDescription>{t("backups.desc")}</DialogDescription>
        </DialogHeader>

        <div className="flex shrink-0 justify-end">
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={loading ? "animate-spin" : ""} /> {t("common.refresh")}
          </Button>
        </div>

        <div className="scrollbar-thin min-h-0 flex-1 space-y-2 overflow-auto">
          {tasks.length === 0 && !loading ? (
            <p className="text-muted-foreground p-6 text-center text-sm">{t("backups.empty")}</p>
          ) : null}
          {tasks.map((task) => (
            <div key={task.id} className="rounded-md border p-2">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{task.name}</p>
                  <p className="text-muted-foreground text-[11px]">
                    {task.database}.{task.collection} · {task.format.toUpperCase()} · {task.intervalMinutes}m
                  </p>
                </div>
                <Switch checked={task.enabled} onCheckedChange={(value) => void toggle(task, value)} />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => void toggleHistory(task)}
                  title={t("backups.history")}
                >
                  <History />
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={() => void run(task)} title={t("backups.runNow")}>
                  <Play />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => void remove(task)}
                  title={t("backups.delete")}
                >
                  <Trash2 />
                </Button>
              </div>
              <p className="text-muted-foreground mt-1 text-[11px]">
                {t("backups.lastRun")}: {task.lastRun ? new Date(task.lastRun).toLocaleString() : t("backups.never")}
                {task.lastStatus === "ok" ? ` · ${task.lastCount ?? 0} docs` : null}
                {task.lastStatus === "error" ? ` · ${task.lastError}` : null}
              </p>
              {openTaskId === task.id ? (
                <div className="mt-2 space-y-1 border-t pt-2">
                  {filesLoading ? (
                    <Loader2 className="text-muted-foreground mx-auto size-4 animate-spin" />
                  ) : null}
                  {!filesLoading && files.length === 0 ? (
                    <p className="text-muted-foreground text-[11px]">{t("backups.noFiles")}</p>
                  ) : null}
                  {files.map((file) => (
                    <div key={file.name} className="flex items-center gap-2 text-[11px]">
                      <span
                        className="text-muted-foreground min-w-0 flex-1 truncate font-mono"
                        title={file.name}
                      >
                        {file.name}
                      </span>
                      <span className="text-muted-foreground shrink-0">{formatBytes(file.size)}</span>
                      <span className="text-muted-foreground shrink-0">
                        {new Date(file.modified).toLocaleString()}
                      </span>
                      <a
                        href={`/api/backups/${encodeURIComponent(task.id)}/files/${encodeURIComponent(file.name)}`}
                        download
                        className="text-muted-foreground hover:text-foreground shrink-0"
                        title={t("backups.download")}
                      >
                        <Download className="size-3.5" />
                      </a>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>

        {adding ? (
          <form onSubmit={create} className="grid shrink-0 gap-2 border-t pt-3">
            <div className="grid gap-1">
              <Label className="text-xs">{t("search.connection")}</Label>
              <Select value={connectionId} onValueChange={setConnectionId}>
                <SelectTrigger size="sm" className="w-full">
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
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1">
                <Label className="text-xs">{t("backups.database")}</Label>
                <Input value={database} onChange={(e) => setDatabase(e.target.value)} className="font-mono text-xs" />
              </div>
              <div className="grid gap-1">
                <Label className="text-xs">{t("backups.collection")}</Label>
                <Input value={collection} onChange={(e) => setCollection(e.target.value)} className="font-mono text-xs" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1">
                <Label className="text-xs">{t("backups.format")}</Label>
                <Select value={format} onValueChange={setFormat}>
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="json">JSON</SelectItem>
                    <SelectItem value="csv">CSV</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1">
                <Label className="text-xs">{t("backups.interval")}</Label>
                <Input
                  value={interval}
                  onChange={(e) => setIntervalMinutes(e.target.value.replace(/\D/g, ""))}
                  inputMode="numeric"
                  className="font-mono text-xs"
                />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">{t("backups.enabled")}</Label>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={busy || !database.trim() || !collection.trim()}>
                {busy ? <Loader2 className="animate-spin" /> : <Plus />}
                {t("backups.add")}
              </Button>
            </div>
          </form>
        ) : (
          <Button variant="outline" className="shrink-0" onClick={() => setAdding(true)}>
            <Plus /> {t("backups.add")}
          </Button>
        )}
      </DialogContent>
    </Dialog>
  )
}
