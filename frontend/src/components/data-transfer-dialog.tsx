import * as React from "react"
import { Download, FileUp, Loader2, Upload } from "lucide-react"
import { toast } from "sonner"

import { AsyncProgress } from "@/components/async-progress"
import { ConfirmDialog } from "@/components/confirm-dialog"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"
import { downloadText } from "@/lib/download"
import { useI18n } from "@/lib/i18n"
import type { TransferFormat } from "@/lib/types"

interface ExportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionId: string
  database: string
  collection: string
  filter: string
  sort: string
  projection: string
}

function parseOptional(text: string, label: string): { value?: unknown; error?: string } {
  const trimmed = text.trim()
  if (!trimmed) return {}
  try {
    return { value: JSON.parse(trimmed) }
  } catch {
    return { error: label }
  }
}

/** Best-effort document count so long imports can show some feedback. */
function countDocuments(content: string, format: TransferFormat): number | null {
  const text = content.trim()
  if (!text) return 0
  if (format === "csv") {
    const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "")
    return Math.max(0, lines.length - 1)
  }
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed.length : 1
  } catch {
    return text.split(/\r?\n/).filter((line) => line.trim() !== "").length
  }
}

export function ExportDialog({
  open,
  onOpenChange,
  connectionId,
  database,
  collection,
  filter,
  sort,
  projection,
}: ExportDialogProps) {
  const { t } = useI18n()
  const [format, setFormat] = React.useState<TransferFormat>("json")
  const [limit, setLimit] = React.useState("10000")
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setFormat("json")
      setLimit("10000")
    }
  }, [open])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const filterResult = parseOptional(filter, t("docs.filter"))
    if (filterResult.error) {
      toast.error(`${t("transfer.invalidJson")}: ${filterResult.error}`)
      return
    }
    const sortResult = parseOptional(sort, t("docs.sort"))
    if (sortResult.error) {
      toast.error(`${t("transfer.invalidJson")}: ${sortResult.error}`)
      return
    }
    const projectionResult = parseOptional(projection, t("docs.projection"))
    if (projectionResult.error) {
      toast.error(`${t("transfer.invalidJson")}: ${projectionResult.error}`)
      return
    }

    setBusy(true)
    try {
      const res = await api.exportDocuments(connectionId, database, collection, {
        format,
        filter: filterResult.value,
        sort: sortResult.value,
        projection: projectionResult.value,
        limit: limit.trim() ? Number(limit) : undefined,
      })
      downloadText(res.filename, res.content, res.contentType)
      toast.success(t("transfer.exported", { count: res.count }))
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("transfer.exportFailed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{t("transfer.exportTitle")}</DialogTitle>
            <DialogDescription>
              {t("transfer.exportDesc", { path: `${database}.${collection}` })}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>{t("transfer.format")}</Label>
              <Select value={format} onValueChange={(value) => setFormat(value as TransferFormat)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="json">JSON (Extended JSON)</SelectItem>
                  <SelectItem value="csv">CSV</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="export-limit">{t("transfer.limit")}</Label>
              <Input
                id="export-limit"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                inputMode="numeric"
                placeholder="10000"
              />
            </div>
            <p className="text-muted-foreground text-xs">{t("transfer.usesFilter")}</p>
          </div>
          {busy ? (
            <AsyncProgress active className="mb-3" label={t("transfer.exporting")} />
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Download />}
              {t("transfer.exportAction")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface ImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionId: string
  database: string
  collection: string
  onImported: () => void
}

export function ImportDialog({
  open,
  onOpenChange,
  connectionId,
  database,
  collection,
  onImported,
}: ImportDialogProps) {
  const { t } = useI18n()
  const [format, setFormat] = React.useState<TransferFormat>("json")
  const [content, setContent] = React.useState("")
  const [drop, setDrop] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const fileRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (open) {
      setFormat("json")
      setContent("")
      setDrop(false)
    }
  }, [open])

  const [discardOpen, setDiscardOpen] = React.useState(false)
  const dirty = content.trim().length > 0 || drop

  React.useEffect(() => {
    if (!open || !dirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [open, dirty])

  const requestClose = (next: boolean) => {
    if (!next && dirty && !busy) {
      setDiscardOpen(true)
      return
    }
    onOpenChange(next)
  }

  const parsedCount = React.useMemo(() => countDocuments(content, format), [content, format])

  const loadFile = async (file: File | undefined) => {
    if (!file) return
    try {
      const text = await file.text()
      setContent(text)
      if (/\.csv$/i.test(file.name)) setFormat("csv")
      else if (/\.(json|ndjson)$/i.test(file.name)) setFormat("json")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("transfer.readFailed"))
    }
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!content.trim()) {
      toast.error(t("transfer.emptyInput"))
      return
    }
    setBusy(true)
    try {
      const res = await api.importDocuments(connectionId, database, collection, {
        format,
        content,
        drop,
      })
      toast.success(t("transfer.imported", { count: res.insertedCount }))
      onImported()
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("transfer.importFailed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{t("transfer.importTitle")}</DialogTitle>
            <DialogDescription>
              {t("transfer.importDesc", { path: `${database}.${collection}` })}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>{t("transfer.format")}</Label>
                <Select
                  value={format}
                  onValueChange={(value) => setFormat(value as TransferFormat)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="json">JSON (array or NDJSON)</SelectItem>
                    <SelectItem value="csv">CSV</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>{t("transfer.file")}</Label>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".json,.ndjson,.csv,application/json,text/csv"
                  className="hidden"
                  onChange={(e) => void loadFile(e.target.files?.[0])}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileRef.current?.click()}
                  className="justify-start"
                >
                  <FileUp /> {t("transfer.chooseFile")}
                </Button>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="import-content">{t("transfer.content")}</Label>
              <Textarea
                id="import-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={
                  format === "csv" ? "name,age\nAlice,30" : '[{ "name": "Alice" }]'
                }
                className="scrollbar-thin min-h-[12rem] font-mono text-xs"
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="import-drop">{t("transfer.drop")}</Label>
                <p className="text-muted-foreground text-xs">{t("transfer.dropHint")}</p>
              </div>
              <Switch id="import-drop" checked={drop} onCheckedChange={setDrop} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => requestClose(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Upload />}
              {t("transfer.importAction")}
            </Button>
          </DialogFooter>
          {busy ? (
            <AsyncProgress
              active
              className="mt-3"
              label={
                parsedCount !== null
                  ? `${t("transfer.importing")} · ${t("transfer.parsed", { count: parsedCount })}`
                  : t("transfer.importing")
              }
            />
          ) : null}
        </form>
      </DialogContent>
    </Dialog>
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title={t("common.discardTitle")}
        description={t("common.discardDesc")}
        confirmLabel={t("common.discard")}
        destructive={false}
        onConfirm={() => {
          setDiscardOpen(false)
          onOpenChange(false)
        }}
      />
    </>
  )
}
