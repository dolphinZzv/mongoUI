import * as React from "react"
import { Copy, Loader2 } from "lucide-react"
import { toast } from "sonner"

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
import { useI18n } from "@/lib/i18n"
import type { Connection } from "@/lib/types"

interface CopyCollectionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionId: string
  database: string
  collection: string
  filter?: string
  onCopied: () => void
}

const SAME_CONNECTION = "__same__"

export function CopyCollectionDialog({
  open,
  onOpenChange,
  connectionId,
  database,
  collection,
  filter = "",
  onCopied,
}: CopyCollectionDialogProps) {
  const { t } = useI18n()
  const [connections, setConnections] = React.useState<Connection[]>([])
  const [targetConnectionId, setTargetConnectionId] = React.useState(SAME_CONNECTION)
  const [targetDatabase, setTargetDatabase] = React.useState(database)
  const [targetCollection, setTargetCollection] = React.useState(`${collection}_copy`)
  const [dropTarget, setDropTarget] = React.useState(false)
  const [copyIndexes, setCopyIndexes] = React.useState(true)
  const [fieldMapText, setFieldMapText] = React.useState("")
  const [excludeText, setExcludeText] = React.useState("")
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setTargetConnectionId(SAME_CONNECTION)
      setTargetDatabase(database)
      setTargetCollection(`${collection}_copy`)
      setDropTarget(false)
      setCopyIndexes(true)
      setFieldMapText("")
      setExcludeText("")
      void api.listConnections().then(setConnections).catch(() => setConnections([]))
    }
  }, [open, database, collection])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!targetDatabase.trim() || !targetCollection.trim()) {
      toast.error(t("copy.required"))
      return
    }
    let filterValue: unknown
    if (filter.trim()) {
      try {
        filterValue = JSON.parse(filter)
      } catch {
        toast.error(t("transfer.invalidJson"))
        return
      }
    }
    let fieldMap: Record<string, string> | undefined
    if (fieldMapText.trim()) {
      try {
        const parsed = JSON.parse(fieldMapText)
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid")
        fieldMap = Object.fromEntries(
          Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [key, String(value)]),
        )
      } catch {
        toast.error(t("copy.fieldMapInvalid"))
        return
      }
    }
    const excludeFields = excludeText
      .split(",")
      .map((field) => field.trim())
      .filter(Boolean)

    setBusy(true)
    try {
      const res = await api.copyCollection(connectionId, database, collection, {
        targetConnectionId:
          targetConnectionId === SAME_CONNECTION ? undefined : targetConnectionId,
        targetDatabase: targetDatabase.trim(),
        targetCollection: targetCollection.trim(),
        filter: filterValue,
        dropTarget,
        copyIndexes,
        fieldMap,
        excludeFields,
      })
      toast.success(
        t("copy.copied", {
          count: res.copied,
          path: `${res.targetDatabase}.${res.targetCollection}`,
        }),
      )
      if (res.warnings?.length) {
        toast.warning(t("copy.indexWarnings"))
      }
      onCopied()
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("copy.failed"))
    } finally {
      setBusy(false)
    }
  }

  const differentConnection =
    targetConnectionId !== SAME_CONNECTION && targetConnectionId !== connectionId
  const sameTarget =
    !differentConnection &&
    targetDatabase.trim() === database &&
    targetCollection.trim() === collection

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden sm:max-w-lg">
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>{t("copy.title")}</DialogTitle>
            <DialogDescription>
              {t("copy.desc", { path: `${database}.${collection}` })}
            </DialogDescription>
          </DialogHeader>
          <div className="scrollbar-thin grid gap-4 overflow-auto py-4">
            <div className="grid gap-2">
              <Label htmlFor="copy-conn">{t("copy.targetConnection")}</Label>
              <Select value={targetConnectionId} onValueChange={setTargetConnectionId}>
                <SelectTrigger id="copy-conn" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SAME_CONNECTION}>{t("copy.sameConnection")}</SelectItem>
                  {connections
                    .filter((connection) => connection.id !== connectionId)
                    .map((connection) => (
                      <SelectItem key={connection.id} value={connection.id}>
                        {connection.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="copy-db">{t("copy.targetDatabase")}</Label>
              <Input
                id="copy-db"
                value={targetDatabase}
                onChange={(e) => setTargetDatabase(e.target.value)}
                className="font-mono text-xs"
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="copy-col">{t("copy.targetCollection")}</Label>
              <Input
                id="copy-col"
                value={targetCollection}
                onChange={(e) => setTargetCollection(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="copy-fieldmap">{t("copy.fieldMap")}</Label>
              <Textarea
                id="copy-fieldmap"
                value={fieldMapText}
                onChange={(e) => setFieldMapText(e.target.value)}
                placeholder='{ "oldName": "newName" }'
                spellCheck={false}
                className="min-h-16 font-mono text-xs"
              />
              <p className="text-muted-foreground text-xs">{t("copy.fieldMapHint")}</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="copy-exclude">{t("copy.excludeFields")}</Label>
              <Input
                id="copy-exclude"
                value={excludeText}
                onChange={(e) => setExcludeText(e.target.value)}
                placeholder="fieldA, fieldB"
                className="font-mono text-xs"
              />
              <p className="text-muted-foreground text-xs">{t("copy.excludeHint")}</p>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="copy-indexes">{t("copy.copyIndexes")}</Label>
                <p className="text-muted-foreground text-xs">{t("copy.copyIndexesHint")}</p>
              </div>
              <Switch id="copy-indexes" checked={copyIndexes} onCheckedChange={setCopyIndexes} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="copy-drop">{t("copy.dropTarget")}</Label>
                <p className="text-muted-foreground text-xs">{t("copy.dropTargetHint")}</p>
              </div>
              <Switch id="copy-drop" checked={dropTarget} onCheckedChange={setDropTarget} />
            </div>
            {sameTarget ? (
              <p className="text-destructive text-xs">{t("copy.sameTarget")}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={busy || sameTarget}>
              {busy ? <Loader2 className="animate-spin" /> : <Copy />}
              {t("copy.action")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
