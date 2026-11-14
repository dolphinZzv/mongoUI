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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import type { AuthUser, Connection } from "@/lib/types"

interface UserConnectionsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: AuthUser | null
  connections: Connection[]
  onSaved: (roles: Record<string, "readonly" | "readwrite">) => void
}

type ConnectionRole = "readonly" | "readwrite"

/** Admin-only editor for per-connection read/write access. */
export function UserConnectionsDialog({
  open,
  onOpenChange,
  user,
  connections,
  onSaved,
}: UserConnectionsDialogProps) {
  const { t } = useI18n()
  const [all, setAll] = React.useState(true)
  const [roles, setRoles] = React.useState<Record<string, ConnectionRole>>({})
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!open || !user) return
    if (user.connectionRoles && Object.keys(user.connectionRoles).length > 0) {
      setAll(false)
      setRoles(user.connectionRoles)
      return
    }
    if (user.connectionIds?.length) {
      const fallback: ConnectionRole = user.role === "readonly" ? "readonly" : "readwrite"
      setAll(false)
      setRoles(Object.fromEntries(user.connectionIds.map((id) => [id, fallback])))
      return
    }
    setAll(true)
    setRoles({})
  }, [open, user])

  const toggle = (id: string, checked: boolean) => {
    setRoles((prev) => {
      const next = { ...prev }
      if (checked) next[id] = "readwrite"
      else delete next[id]
      return next
    })
  }

  const save = async () => {
    if (!user) return
    const value = all ? {} : roles
    if (!all && Object.keys(value).length === 0) {
      toast.error(t("users.connectionsRequired"))
      return
    }
    setBusy(true)
    try {
      await api.updateAuthUserConnectionRoles(user.id, value)
      onSaved(value)
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
                if (value === true) setRoles({})
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
            {connections.map((connection) => {
              const checked = all || Boolean(roles[connection.id])
              return (
                <div
                  key={connection.id}
                  className="hover:bg-accent/40 flex items-center gap-2 rounded px-2 py-1.5"
                >
                  <Checkbox
                    checked={checked}
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
                  {checked && !all ? (
                    <Select
                      value={roles[connection.id] ?? "readwrite"}
                      onValueChange={(value) =>
                        setRoles((prev) => ({
                          ...prev,
                          [connection.id]: value as ConnectionRole,
                        }))
                      }
                    >
                      <SelectTrigger size="sm" className="w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="readonly">{t("users.role.readonly")}</SelectItem>
                        <SelectItem value="readwrite">{t("users.role.readwrite")}</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={busy || (!all && Object.keys(roles).length === 0)}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
