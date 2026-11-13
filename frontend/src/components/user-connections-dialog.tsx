import * as React from "react"
import { Database, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import type { AuthUser, Connection } from "@/lib/types"

interface UserConnectionsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: AuthUser | null
  connections: Connection[]
  onSaved: (connectionIds: string[]) => void
}

/** Admin-only editor for a user's connection allowlist. Empty means all. */
export function UserConnectionsDialog({
  open,
  onOpenChange,
  user,
  connections,
  onSaved,
}: UserConnectionsDialogProps) {
  const { t } = useI18n()
  const [all, setAll] = React.useState(true)
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!open || !user) return
    const ids = user.connectionIds ?? []
    setAll(ids.length === 0)
    setSelected(new Set(ids))
    setBusy(false)
  }, [open, user])

  const toggle = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const save = async () => {
    if (!user) return
    const ids = all ? [] : [...selected]
    if (!all && ids.length === 0) {
      toast.error(t("users.connectionsRequired"))
      return
    }
    setBusy(true)
    try {
      await api.updateAuthUserConnections(user.id, ids)
      onSaved(ids)
      toast.success(t("users.connectionsSaved", { name: user.username }))
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("users.failed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("users.connectionsTitle", { name: user?.username ?? "" })}</DialogTitle>
          <DialogDescription>{t("users.connectionsDesc")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="hover:bg-accent/40 flex cursor-pointer items-start gap-2 rounded-md border p-2">
            <Checkbox
              checked={all}
              onCheckedChange={(value) => {
                setAll(value === true)
                if (value === true) setSelected(new Set())
              }}
              className="mt-0.5"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{t("users.connectionsAll")}</span>
              <span className="text-muted-foreground block text-xs">
                {t("users.connectionsAllDesc")}
              </span>
            </span>
          </label>

          <div className="scrollbar-thin max-h-64 space-y-1 overflow-auto">
            {connections.length === 0 ? (
              <p className="text-muted-foreground py-4 text-center text-xs">
                {t("users.connectionsEmpty")}
              </p>
            ) : null}
            {connections.map((connection) => (
              <label
                key={connection.id}
                className="hover:bg-accent/40 flex cursor-pointer items-center gap-2 rounded px-2 py-1.5"
              >
                <Checkbox
                  checked={all || selected.has(connection.id)}
                  disabled={all}
                  onCheckedChange={(value) => toggle(connection.id, value === true)}
                />
                <Database className="text-muted-foreground size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-sm">{connection.name}</span>
                {connection.readOnly ? (
                  <Badge variant="secondary" className="text-[9px]">
                    {t("overview.readOnly")}
                  </Badge>
                ) : null}
              </label>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={busy || (!all && selected.size === 0)}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
