import * as React from "react"
import { Loader2, Tag, Trash2 } from "lucide-react"
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
  aliasCollectionKey,
  aliasDbKey,
  setCollectionAlias,
  setDatabaseAlias,
  useAliasStore,
  type AliasTarget,
} from "@/lib/aliases"
import { useI18n } from "@/lib/i18n"

interface AliasDialogProps {
  target: AliasTarget | null
  onOpenChange: (open: boolean) => void
}

/** Edit the browser-local display alias for a database or collection. */
export function AliasDialog({ target, onOpenChange }: AliasDialogProps) {
  const { t } = useI18n()
  const { aliases, mode } = useAliasStore()
  const [value, setValue] = React.useState("")
  const [busy, setBusy] = React.useState(false)

  const current = React.useMemo(() => {
    if (!target) return ""
    return target.kind === "database"
      ? aliases.databases[aliasDbKey(target.connectionId, target.database)] || ""
      : aliases.collections[
          aliasCollectionKey(target.connectionId, target.database, target.collection)
        ] || ""
  }, [aliases, target])

  React.useEffect(() => {
    if (!target) return
    setValue(current)
  }, [target, current])

  React.useEffect(() => {
    setBusy(false)
  }, [target])

  const actual =
    target?.kind === "database"
      ? target.database
      : target
        ? `${target.database} / ${target.collection}`
        : ""

  const save = async () => {
    if (!target || busy) return
    setBusy(true)
    try {
      if (target.kind === "database") {
        await setDatabaseAlias(target.connectionId, target.database, value)
      } else {
        await setCollectionAlias(target.connectionId, target.database, target.collection, value)
      }
      toast.success(value.trim() ? t("alias.saved") : t("alias.removed"))
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("alias.saveFailed"))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!target || busy) return
    setBusy(true)
    try {
      if (target.kind === "database") {
        await setDatabaseAlias(target.connectionId, target.database, "")
      } else {
        await setCollectionAlias(target.connectionId, target.database, target.collection, "")
      }
      toast.success(t("alias.removed"))
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("alias.saveFailed"))
    } finally {
      setBusy(false)
    }
  }

  const trimmed = value.trim()
  const changed = trimmed !== current

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="size-4" />
            {target?.kind === "database"
              ? t("alias.databaseTitle")
              : t("alias.collectionTitle")}
          </DialogTitle>
          <DialogDescription>{t("alias.desc")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="bg-muted/50 rounded-md border px-3 py-2">
            <p className="text-muted-foreground text-[11px] uppercase">
              {target?.kind === "database" ? t("alias.databaseLabel") : t("alias.collectionLabel")}
            </p>
            <p className="mt-0.5 truncate font-mono text-xs" title={actual}>
              {actual}
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="alias-value">{t("alias.name")}</Label>
            <Input
              id="alias-value"
              autoFocus
              maxLength={80}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={t("alias.placeholder")}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  if (changed) void save()
                }
              }}
            />
            <p className="text-muted-foreground text-xs">{t("alias.hint")}</p>
            <p className="text-muted-foreground text-[11px]">
              {mode === "team" ? t("alias.storageTeam") : t("alias.storageLocal")}
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={() => void remove()}
            disabled={!current || busy}
            className="text-destructive hover:text-destructive"
          >
            {busy ? <Loader2 className="animate-spin" /> : <Trash2 />} {t("alias.remove")}
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              {t("common.cancel")}
            </Button>
            <Button type="button" onClick={() => void save()} disabled={!changed || busy}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              {t("common.save")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
