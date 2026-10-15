import * as React from "react"
import { Loader2, Save } from "lucide-react"
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
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import type { AuthRole, OIDCConfig } from "@/lib/types"

interface OIDCDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface FormState {
  enabled: boolean
  issuer: string
  clientId: string
  clientSecret: string
  redirectUrl: string
  scopes: string
  buttonLabel: string
  tokenAuthMethod: "client_secret_basic" | "client_secret_post"
  usernameClaim: string
  groupsClaim: string
  defaultRole: AuthRole
  adminGroups: string
  readWriteGroups: string
  readOnlyGroups: string
  requireGroupMatch: boolean
  allowedDomains: string
  allowedEmails: string
  requireVerifiedEmail: boolean
  autoCreateUsers: boolean
  syncRole: boolean
  hasClientSecret: boolean
}

const emptyForm: FormState = {
  enabled: false,
  issuer: "",
  clientId: "",
  clientSecret: "",
  redirectUrl: "",
  scopes: "openid profile email",
  buttonLabel: "",
  tokenAuthMethod: "client_secret_basic",
  usernameClaim: "",
  groupsClaim: "",
  defaultRole: "readonly",
  adminGroups: "",
  readWriteGroups: "",
  readOnlyGroups: "",
  requireGroupMatch: false,
  allowedDomains: "",
  allowedEmails: "",
  requireVerifiedEmail: false,
  autoCreateUsers: true,
  syncRole: true,
  hasClientSecret: false,
}

const splitList = (value: string): string[] =>
  value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)

const joinList = (value?: string[]): string => (value ?? []).join(", ")

function formFromConfig(cfg: OIDCConfig): FormState {
  return {
    enabled: cfg.enabled,
    issuer: cfg.issuer ?? "",
    clientId: cfg.clientId ?? "",
    clientSecret: "",
    redirectUrl: cfg.redirectUrl ?? "",
    scopes: (cfg.scopes ?? ["openid", "profile", "email"]).join(" "),
    buttonLabel: cfg.buttonLabel ?? "",
    tokenAuthMethod: cfg.tokenAuthMethod ?? "client_secret_basic",
    usernameClaim: cfg.usernameClaim ?? "",
    groupsClaim: cfg.groupsClaim ?? "",
    defaultRole: cfg.defaultRole ?? "readonly",
    adminGroups: joinList(cfg.adminGroups),
    readWriteGroups: joinList(cfg.readWriteGroups),
    readOnlyGroups: joinList(cfg.readOnlyGroups),
    requireGroupMatch: cfg.requireGroupMatch ?? false,
    allowedDomains: joinList(cfg.allowedDomains),
    allowedEmails: joinList(cfg.allowedEmails),
    requireVerifiedEmail: cfg.requireVerifiedEmail ?? false,
    autoCreateUsers: cfg.autoCreateUsers ?? true,
    syncRole: cfg.syncRole ?? true,
    hasClientSecret: cfg.hasClientSecret ?? false,
  }
}

/** Admin dialog for configuring OpenID Connect single sign-on. */
export function OIDCDialog({ open, onOpenChange }: OIDCDialogProps) {
  const { t } = useI18n()
  const [form, setForm] = React.useState<FormState>(emptyForm)
  const [loading, setLoading] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setLoading(true)
    api
      .getOIDCSettings()
      .then((cfg) => setForm(formFromConfig(cfg)))
      .catch((err) => toast.error(err instanceof Error ? err.message : t("oidc.loadFailed")))
      .finally(() => setLoading(false))
  }, [open, t])

  const patch = (next: Partial<FormState>) => setForm((prev) => ({ ...prev, ...next }))

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      const cfg = await api.updateOIDCSettings({
        enabled: form.enabled,
        issuer: form.issuer.trim(),
        clientId: form.clientId.trim(),
        clientSecret: form.clientSecret,
        redirectUrl: form.redirectUrl.trim(),
        scopes: form.scopes.split(/\s+/).filter(Boolean),
        buttonLabel: form.buttonLabel.trim(),
        tokenAuthMethod: form.tokenAuthMethod,
        usernameClaim: form.usernameClaim.trim(),
        groupsClaim: form.groupsClaim.trim(),
        defaultRole: form.defaultRole,
        adminGroups: splitList(form.adminGroups),
        readWriteGroups: splitList(form.readWriteGroups),
        readOnlyGroups: splitList(form.readOnlyGroups),
        requireGroupMatch: form.requireGroupMatch,
        allowedDomains: splitList(form.allowedDomains),
        allowedEmails: splitList(form.allowedEmails),
        requireVerifiedEmail: form.requireVerifiedEmail,
        autoCreateUsers: form.autoCreateUsers,
        syncRole: form.syncRole,
      })
      setForm(formFromConfig(cfg))
      toast.success(t("oidc.saved"))
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("oidc.saveFailed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("oidc.title")}</DialogTitle>
          <DialogDescription>{t("oidc.desc")}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="text-muted-foreground size-5 animate-spin" />
          </div>
        ) : (
          <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
            <div className="scrollbar-thin min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5">
                  <Label htmlFor="oidc-enabled">{t("oidc.enabled")}</Label>
                  <p className="text-muted-foreground text-xs">{t("oidc.enabledHint")}</p>
                </div>
                <Switch
                  id="oidc-enabled"
                  checked={form.enabled}
                  onCheckedChange={(checked) => patch({ enabled: checked })}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="oidc-issuer">{t("oidc.issuer")}</Label>
                  <Input
                    id="oidc-issuer"
                    value={form.issuer}
                    onChange={(event) => patch({ issuer: event.target.value })}
                    placeholder="https://accounts.example.com"
                    spellCheck={false}
                  />
                  <p className="text-muted-foreground text-xs">{t("oidc.issuerHint")}</p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="oidc-client-id">{t("oidc.clientId")}</Label>
                  <Input
                    id="oidc-client-id"
                    value={form.clientId}
                    onChange={(event) => patch({ clientId: event.target.value })}
                    spellCheck={false}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="oidc-client-secret">{t("oidc.clientSecret")}</Label>
                  <Input
                    id="oidc-client-secret"
                    type="password"
                    value={form.clientSecret}
                    onChange={(event) => patch({ clientSecret: event.target.value })}
                    placeholder={form.hasClientSecret ? t("oidc.secretKeep") : ""}
                    autoComplete="new-password"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="oidc-button-label">{t("oidc.buttonLabel")}</Label>
                  <Input
                    id="oidc-button-label"
                    value={form.buttonLabel}
                    onChange={(event) => patch({ buttonLabel: event.target.value })}
                    placeholder={t("oidc.buttonLabelPlaceholder")}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="oidc-token-auth">{t("oidc.tokenAuth")}</Label>
                  <Select
                    value={form.tokenAuthMethod}
                    onValueChange={(value) =>
                      patch({ tokenAuthMethod: value as FormState["tokenAuthMethod"] })
                    }
                  >
                    <SelectTrigger id="oidc-token-auth">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="client_secret_basic">client_secret_basic</SelectItem>
                      <SelectItem value="client_secret_post">client_secret_post</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="oidc-scopes">{t("oidc.scopes")}</Label>
                  <Input
                    id="oidc-scopes"
                    value={form.scopes}
                    onChange={(event) => patch({ scopes: event.target.value })}
                    placeholder="openid profile email"
                    spellCheck={false}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="oidc-redirect">{t("oidc.redirectUrl")}</Label>
                  <Input
                    id="oidc-redirect"
                    value={form.redirectUrl}
                    onChange={(event) => patch({ redirectUrl: event.target.value })}
                    placeholder={t("oidc.redirectHint")}
                    spellCheck={false}
                  />
                </div>
              </div>

              <div className="space-y-3 rounded-lg border p-3">
                <p className="text-sm font-medium">{t("oidc.identity")}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="oidc-username-claim">{t("oidc.usernameClaim")}</Label>
                    <Input
                      id="oidc-username-claim"
                      value={form.usernameClaim}
                      onChange={(event) => patch({ usernameClaim: event.target.value })}
                      placeholder="preferred_username, email, sub"
                      spellCheck={false}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="oidc-groups-claim">{t("oidc.groupsClaim")}</Label>
                    <Input
                      id="oidc-groups-claim"
                      value={form.groupsClaim}
                      onChange={(event) => patch({ groupsClaim: event.target.value })}
                      placeholder="groups"
                      spellCheck={false}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="oidc-default-role">{t("oidc.defaultRole")}</Label>
                    <Select
                      value={form.defaultRole}
                      onValueChange={(value) => patch({ defaultRole: value as AuthRole })}
                    >
                      <SelectTrigger id="oidc-default-role">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">admin</SelectItem>
                        <SelectItem value="readwrite">readwrite</SelectItem>
                        <SelectItem value="readonly">readonly</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 text-sm">
                      <Switch
                        checked={form.requireGroupMatch}
                        onCheckedChange={(checked) => patch({ requireGroupMatch: checked })}
                      />
                      {t("oidc.requireGroupMatch")}
                    </label>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1">
                    <Label htmlFor="oidc-admin-groups">{t("oidc.adminGroups")}</Label>
                    <Input
                      id="oidc-admin-groups"
                      value={form.adminGroups}
                      onChange={(event) => patch({ adminGroups: event.target.value })}
                      placeholder="mongoui-admins"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="oidc-rw-groups">{t("oidc.readWriteGroups")}</Label>
                    <Input
                      id="oidc-rw-groups"
                      value={form.readWriteGroups}
                      onChange={(event) => patch({ readWriteGroups: event.target.value })}
                      placeholder="mongoui-writers"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="oidc-ro-groups">{t("oidc.readOnlyGroups")}</Label>
                    <Input
                      id="oidc-ro-groups"
                      value={form.readOnlyGroups}
                      onChange={(event) => patch({ readOnlyGroups: event.target.value })}
                      placeholder="mongoui-viewers"
                    />
                  </div>
                </div>
                <p className="text-muted-foreground text-xs">{t("oidc.groupsHint")}</p>
              </div>

              <div className="space-y-3 rounded-lg border p-3">
                <p className="text-sm font-medium">{t("oidc.access")}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="oidc-domains">{t("oidc.allowedDomains")}</Label>
                    <Input
                      id="oidc-domains"
                      value={form.allowedDomains}
                      onChange={(event) => patch({ allowedDomains: event.target.value })}
                      placeholder="example.com, corp.example.com"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="oidc-emails">{t("oidc.allowedEmails")}</Label>
                    <Input
                      id="oidc-emails"
                      value={form.allowedEmails}
                      onChange={(event) => patch({ allowedEmails: event.target.value })}
                      placeholder="admin@example.com"
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={form.requireVerifiedEmail}
                    onCheckedChange={(checked) => patch({ requireVerifiedEmail: checked })}
                  />
                  {t("oidc.requireVerifiedEmail")}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={form.autoCreateUsers}
                    onCheckedChange={(checked) => patch({ autoCreateUsers: checked })}
                  />
                  {t("oidc.autoCreate")}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={form.syncRole}
                    onCheckedChange={(checked) => patch({ syncRole: checked })}
                  />
                  {t("oidc.syncRole")}
                </label>
              </div>
            </div>

            <DialogFooter className="shrink-0 pt-3">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Save />}
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
