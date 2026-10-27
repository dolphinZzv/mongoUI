import * as React from "react"
import { Check, Copy, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { useAuth } from "@/components/auth-gate"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
import { copyToClipboard } from "@/lib/clipboard"
import { useI18n } from "@/lib/i18n"
import type { AuthScope, AuthToken } from "@/lib/types"

interface TokensDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const EXPIRY_OPTIONS = ["never", "30", "90", "365"] as const
type ExpiryOption = (typeof EXPIRY_OPTIONS)[number]

/** Self-service personal access tokens with role-bounded scopes. */
export function TokensDialog({ open, onOpenChange }: TokensDialogProps) {
  const { t } = useI18n()
  const { role } = useAuth()
  const [tokens, setTokens] = React.useState<AuthToken[]>([])
  const [loading, setLoading] = React.useState(false)
  const [name, setName] = React.useState("")
  const [scopes, setScopes] = React.useState<AuthScope[]>(["read"])
  const [expiry, setExpiry] = React.useState<ExpiryOption>("never")
  const [newToken, setNewToken] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [deleting, setDeleting] = React.useState<AuthToken | null>(null)
  const [copied, setCopied] = React.useState(false)

  const canWrite = role === "admin" || role === "readwrite"
  const canAdmin = role === "admin"

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      setTokens((await api.listAuthTokens()) ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("tokens.failed"))
    } finally {
      setLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    if (!open) return
    setName("")
    setScopes(["read"])
    setExpiry("never")
    setNewToken("")
    setDeleting(null)
    setCopied(false)
    void load()
  }, [open, load])

  const toggleScope = (scope: AuthScope) => {
    setScopes((prev) => {
      const has = prev.includes(scope)
      if (scope === "read") return prev
      if (scope === "admin") {
        if (has) return prev.filter((item) => item !== "admin")
        return Array.from(new Set([...prev, "read", "write", "admin"]))
      }
      if (has) return prev.filter((item) => item !== "write" && item !== "admin")
      return Array.from(new Set([...prev, "read", "write"]))
    })
  }

  const create = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try {
      const expiresAt =
        expiry === "never"
          ? undefined
          : new Date(Date.now() + Number(expiry) * 24 * 60 * 60 * 1000).toISOString()
      const result = await api.createAuthToken(name.trim(), scopes, expiresAt)
      setNewToken(result.token)
      setCopied(false)
      setName("")
      setScopes(["read"])
      setExpiry("never")
      toast.success(t("tokens.created"))
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("tokens.createFailed"))
    } finally {
      setBusy(false)
    }
  }

  const copyToken = async () => {
    if (!newToken) return
    setCopied(await copyToClipboard(newToken))
  }

  const remove = async () => {
    if (!deleting) return
    try {
      await api.deleteAuthToken(deleting.id)
      setTokens((prev) => prev.filter((token) => token.id !== deleting.id))
      toast.success(t("tokens.deleted"))
      setDeleting(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("tokens.failed"))
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("tokens.title")}</DialogTitle>
            <DialogDescription>{t("tokens.desc")}</DialogDescription>
          </DialogHeader>

          {newToken ? (
            <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
              <p className="text-sm font-medium">{t("tokens.copyNow")}</p>
              <div className="flex items-center gap-1">
                <code className="bg-background min-w-0 flex-1 rounded px-2 py-1.5 font-mono text-xs break-all">
                  {newToken}
                </code>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => void copyToken()}
                  title={t("common.copy")}
                  aria-label={t("common.copy")}
                >
                  {copied ? <Check className="text-emerald-600" /> : <Copy />}
                </Button>
              </div>
              <p className="text-muted-foreground text-xs">{t("tokens.copyNowHint")}</p>
              <Button variant="outline" size="sm" onClick={() => setNewToken("")}>
                {t("tokens.done")}
              </Button>
            </div>
          ) : null}

          <form onSubmit={create} className="space-y-3 border-b pb-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-1 sm:col-span-2">
                <Label className="text-xs">{t("tokens.name")}</Label>
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t("tokens.namePlaceholder")}
                />
              </div>
              <div className="grid gap-1">
                <Label className="text-xs">{t("tokens.expiry")}</Label>
                <Select value={expiry} onValueChange={(value) => setExpiry(value as ExpiryOption)}>
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPIRY_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option === "never" ? t("tokens.expiry.never") : t("tokens.expiry.days", { days: option })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("tokens.scopes")}</Label>
              <div className="grid gap-1.5 text-sm">
                <label className="flex items-center gap-2">
                  <Checkbox checked disabled />
                  <span>{t("tokens.scope.read")}</span>
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={scopes.includes("write")}
                    disabled={!canWrite}
                    onCheckedChange={() => toggleScope("write")}
                  />
                  <span>{t("tokens.scope.write")}</span>
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={scopes.includes("admin")}
                    disabled={!canAdmin}
                    onCheckedChange={() => toggleScope("admin")}
                  />
                  <span>{t("tokens.scope.admin")}</span>
                </label>
              </div>
              <p className="text-muted-foreground text-xs">{t("tokens.scopesHint")}</p>
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={busy || !name.trim()}>
                {busy ? <Loader2 className="animate-spin" /> : <Plus />}
                {t("tokens.create")}
              </Button>
            </div>
          </form>

          <div className="flex shrink-0 items-center justify-between gap-2">
            <p className="text-muted-foreground text-xs">
              {t("tokens.count", { count: tokens.length })}
            </p>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => void load()}
              disabled={loading}
              title={t("common.refresh")}
              aria-label={t("common.refresh")}
            >
              <RefreshCw className={loading ? "animate-spin" : ""} />
            </Button>
          </div>
          <div className="scrollbar-thin min-h-0 flex-1 space-y-2 overflow-auto">
            {loading && tokens.length === 0 ? (
              <div className="text-muted-foreground flex justify-center py-6">
                <Loader2 className="size-5 animate-spin" />
              </div>
            ) : null}
            {tokens.length === 0 && !loading ? (
              <p className="text-muted-foreground py-4 text-center text-xs">{t("tokens.empty")}</p>
            ) : null}
            {tokens.map((token) => (
              <div key={token.id} className="flex items-start gap-2 rounded-md border p-2">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                    {token.name}
                    {token.scopes.map((scope) => (
                      <Badge key={scope} variant="secondary" className="px-1.5 py-0 text-[9px] uppercase">
                        {t(`tokens.scope.${scope}`)}
                      </Badge>
                    ))}
                  </p>
                  <p className="text-muted-foreground mt-0.5 font-mono text-[11px]">
                    {token.prefix}…
                  </p>
                  <p className="text-muted-foreground text-[11px]">
                    {t("tokens.createdAt", { date: token.createdAt })}
                    {token.lastUsedAt ? ` · ${t("tokens.lastUsed", { date: token.lastUsedAt })}` : ""}
                    {token.expiresAt ? ` · ${t("tokens.expires", { date: token.expiresAt })}` : ""}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setDeleting(token)}
                  title={t("tokens.delete")}
                  aria-label={t("tokens.delete")}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(value) => {
          if (!value) setDeleting(null)
        }}
        title={t("tokens.deleteTitle", { name: deleting?.name ?? "" })}
        description={t("tokens.deleteDesc")}
        confirmLabel={t("tokens.delete")}
        onConfirm={remove}
      />
    </>
  )
}
