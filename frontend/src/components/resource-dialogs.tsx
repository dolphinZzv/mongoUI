import * as React from "react"
import { Loader2, Plus } from "lucide-react"
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

interface CreateDatabaseDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionId: string
  onCreated: () => void
}

export function CreateDatabaseDialog({
  open,
  onOpenChange,
  connectionId,
  onCreated,
}: CreateDatabaseDialogProps) {
  const [name, setName] = React.useState("")
  const [collection, setCollection] = React.useState("default")
  const [busy, setBusy] = React.useState(false)
  const { t } = useI18n()

  React.useEffect(() => {
    if (open) {
      setName("")
      setCollection("default")
    }
  }, [open])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim()) {
      toast.error(t("resource.dbNameRequired"))
      return
    }
    setBusy(true)
    try {
      await api.createDatabase(connectionId, name.trim(), collection.trim() || "default")
      toast.success(t("resource.dbCreated", { name: name.trim() }))
      onCreated()
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("resource.createDbFailed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{t("resource.createDatabase")}</DialogTitle>
            <DialogDescription>
              MongoDB creates databases lazily, so an initial collection is required.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="db-name">{t("resource.databaseName")}</Label>
              <Input
                id="db-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="analytics"
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="db-collection">{t("resource.initialCollection")}</Label>
              <Input
                id="db-collection"
                value={collection}
                onChange={(e) => setCollection(e.target.value)}
                placeholder="default"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Plus />}
              {t("common.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface CreateCollectionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionId: string
  database: string
  onCreated: () => void
}

export function CreateCollectionDialog({
  open,
  onOpenChange,
  connectionId,
  database,
  onCreated,
}: CreateCollectionDialogProps) {
  const [name, setName] = React.useState("")
  const [capped, setCapped] = React.useState(false)
  const [size, setSize] = React.useState("1048576")
  const [max, setMax] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const { t } = useI18n()

  React.useEffect(() => {
    if (open) {
      setName("")
      setCapped(false)
      setSize("1048576")
      setMax("")
    }
  }, [open])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim()) {
      toast.error(t("resource.colNameRequired"))
      return
    }
    setBusy(true)
    try {
      await api.createCollection(connectionId, database, {
        name: name.trim(),
        capped,
        size: capped ? Number(size) || 0 : undefined,
        max: capped && max ? Number(max) || 0 : undefined,
      })
      toast.success(t("resource.colCreated", { name: name.trim() }))
      onCreated()
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("resource.createColFailed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{t("resource.createCollection")}</DialogTitle>
            <DialogDescription>
              Add a new collection to <span className="font-mono">{database}</span>.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="col-name">{t("resource.collectionName")}</Label>
              <Input
                id="col-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="events"
                autoFocus
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="col-capped">{t("resource.capped")}</Label>
                <p className="text-muted-foreground text-xs">
                  Fixed-size collection that overwrites oldest entries.
                </p>
              </div>
              <Switch id="col-capped" checked={capped} onCheckedChange={setCapped} />
            </div>
            {capped ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="col-size">Size (bytes)</Label>
                  <Input
                    id="col-size"
                    value={size}
                    onChange={(e) => setSize(e.target.value)}
                    inputMode="numeric"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="col-max">{t("resource.maxDocuments")}</Label>
                  <Input
                    id="col-max"
                    value={max}
                    onChange={(e) => setMax(e.target.value)}
                    placeholder="optional"
                    inputMode="numeric"
                  />
                </div>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Plus />}
              {t("common.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
