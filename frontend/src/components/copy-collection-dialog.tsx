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
import { Switch } from "@/components/ui/switch"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"

interface CopyCollectionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionId: string
  database: string
  collection: string
  filter?: string
  onCopied: () => void
}

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
  const [targetDatabase, setTargetDatabase] = React.useState(database)
  const [targetCollection, setTargetCollection] = React.useState(`${collection}_copy`)
  const [dropTarget, setDropTarget] = React.useState(false)
  const [copyIndexes, setCopyIndexes] = React.useState(true)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setTargetDatabase(database)
      setTargetCollection(`${collection}_copy`)
      setDropTarget(false)
      setCopyIndexes(true)
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

    setBusy(true)
    try {
      const res = await api.copyCollection(connectionId, database, collection, {
        targetDatabase: targetDatabase.trim(),
        targetCollection: targetCollection.trim(),
        filter: filterValue,
        dropTarget,
        copyIndexes,
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

  const sameTarget =
    targetDatabase.trim() === database && targetCollection.trim() === collection

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{t("copy.title")}</DialogTitle>
            <DialogDescription>
              {t("copy.desc", { path: `${database}.${collection}` })}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
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
