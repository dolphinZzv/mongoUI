import * as React from "react"
import { Loader2, PlugZap, Save } from "lucide-react"
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
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { Connection, SSHConfig } from "@/lib/types"

const COLORS = [
  "#10b981",
  "#3b82f6",
  "#8b5cf6",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#14b8a6",
  "#64748b",
]

const SUGGESTIONS = [
  { label: "Local", uri: "mongodb://127.0.0.1:27017" },
  { label: "Docker", uri: "mongodb://root:example@127.0.0.1:27017/?authSource=admin" },
  { label: "Atlas SRV", uri: "mongodb+srv://user:password@cluster0.xxxxx.mongodb.net/" },
]

interface ConnectionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connection?: Connection | null
  onSaved: (connection: Connection) => void
}

interface FormState {
  name: string
  uri: string
  color: string
  readOnly: boolean
  sshEnabled: boolean
  sshHost: string
  sshPort: string
  sshUser: string
  sshAuth: "password" | "privateKey"
  sshPassword: string
  sshPrivateKey: string
  sshPassphrase: string
  sshKnownHosts: string
}

const EMPTY: FormState = {
  name: "",
  uri: "",
  color: COLORS[0],
  readOnly: false,
  sshEnabled: false,
  sshHost: "",
  sshPort: "22",
  sshUser: "",
  sshAuth: "password",
  sshPassword: "",
  sshPrivateKey: "",
  sshPassphrase: "",
  sshKnownHosts: "",
}

function sshFromConnection(connection: Connection | null | undefined): Partial<FormState> {
  const ssh = connection?.ssh
  if (!ssh) return {}
  return {
    sshEnabled: Boolean(ssh.enabled),
    sshHost: ssh.host ?? "",
    sshPort: ssh.port ? String(ssh.port) : "22",
    sshUser: ssh.user ?? "",
    sshAuth: ssh.authMethod === "privateKey" ? "privateKey" : "password",
    sshPassword: ssh.password ?? "",
    sshPrivateKey: ssh.privateKey ?? "",
    sshPassphrase: ssh.passphrase ?? "",
    sshKnownHosts: ssh.knownHosts ?? "",
  }
}

export function ConnectionDialog({
  open,
  onOpenChange,
  connection,
  onSaved,
}: ConnectionDialogProps) {
  const { t } = useI18n()
  const [form, setForm] = React.useState<FormState>(EMPTY)
  const [saving, setSaving] = React.useState(false)
  const [testing, setTesting] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    if (connection) {
      setForm({
        ...EMPTY,
        name: connection.name,
        uri: connection.uri,
        color: connection.color || COLORS[0],
        readOnly: Boolean(connection.readOnly),
        ...sshFromConnection(connection),
      })
    } else {
      setForm(EMPTY)
    }
  }, [open, connection])

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const buildSSH = (): SSHConfig | undefined => {
    if (!form.sshEnabled) return undefined
    const port = Number(form.sshPort)
    return {
      enabled: true,
      host: form.sshHost.trim(),
      port: Number.isFinite(port) && port > 0 ? port : 22,
      user: form.sshUser.trim(),
      authMethod: form.sshAuth,
      password: form.sshAuth === "password" ? form.sshPassword : undefined,
      privateKey: form.sshAuth === "privateKey" ? form.sshPrivateKey : undefined,
      passphrase:
        form.sshAuth === "privateKey" && form.sshPassphrase ? form.sshPassphrase : undefined,
      knownHosts: form.sshKnownHosts.trim() || undefined,
    }
  }

  /** Returns an error message when the SSH section is incomplete. */
  const sshError = (): string | null => {
    if (!form.sshEnabled) return null
    if (!form.sshHost.trim()) return t("connection.sshHostRequired")
    if (!form.sshUser.trim()) return t("connection.sshUserRequired")
    if (form.sshAuth === "password" && !form.sshPassword) return t("connection.sshPasswordRequired")
    if (form.sshAuth === "privateKey" && !form.sshPrivateKey.trim())
      return t("connection.sshKeyRequired")
    return null
  }

  const buildPayload = (name: string) => ({
    name,
    uri: form.uri.trim(),
    color: form.color,
    readOnly: form.readOnly,
    ssh: buildSSH(),
  })

  const handleTest = async () => {
    if (!form.uri.trim()) {
      toast.error(t("connection.enterUri"))
      return
    }
    const err = sshError()
    if (err) {
      toast.error(err)
      return
    }
    setTesting(true)
    try {
      const res = await api.testConnection(buildPayload(form.name || "test"))
      toast.success(res.message || t("connection.testOk"))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("connection.testFailed"))
    } finally {
      setTesting(false)
    }
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!form.name.trim() || !form.uri.trim()) {
      toast.error(t("connection.nameUriRequired"))
      return
    }
    const err = sshError()
    if (err) {
      toast.error(err)
      return
    }
    setSaving(true)
    try {
      const payload = buildPayload(form.name.trim())
      const saved = connection
        ? await api.updateConnection(connection.id, payload)
        : await api.createConnection(payload)
      toast.success(connection ? t("connection.updated") : t("connection.created"))
      onSaved(saved)
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("connection.saveFailed"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{connection ? t("connection.edit") : t("connection.new")}</DialogTitle>
            <DialogDescription>{t("connection.desc")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="conn-name">{t("common.name")}</Label>
              <Input
                id="conn-name"
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
                placeholder={t("connection.namePlaceholder")}
                autoFocus
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="conn-uri">{t("connection.uri")}</Label>
              <Input
                id="conn-uri"
                value={form.uri}
                onChange={(e) => update("uri", e.target.value)}
                placeholder="mongodb://user:password@host:27017/?authSource=admin"
                className="font-mono text-xs"
              />
              <div className="flex flex-wrap gap-1.5 pt-1">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => update("uri", s.uri)}
                    className="text-muted-foreground hover:text-foreground hover:bg-accent rounded-full border px-2.5 py-0.5 text-xs transition-colors"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-2">
              <Label>{t("connection.color")}</Label>
              <div className="flex flex-wrap items-center gap-2">
                {COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={color}
                    onClick={() => update("color", color)}
                    className={cn(
                      "size-6 rounded-full border-2 transition-transform",
                      form.color === color
                        ? "border-foreground scale-110"
                        : "border-transparent hover:scale-105",
                    )}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="conn-readonly">{t("connection.readOnly")}</Label>
                <p className="text-muted-foreground text-xs">
                  {t("connection.readOnlyHint")}
                </p>
              </div>
              <Switch
                id="conn-readonly"
                checked={form.readOnly}
                onCheckedChange={(checked) => update("readOnly", checked)}
              />
            </div>

            <div className="rounded-lg border">
              <div className="flex items-center justify-between p-3">
                <div className="space-y-0.5">
                  <Label htmlFor="conn-ssh">{t("connection.ssh")}</Label>
                  <p className="text-muted-foreground text-xs">{t("connection.sshHint")}</p>
                </div>
                <Switch
                  id="conn-ssh"
                  checked={form.sshEnabled}
                  onCheckedChange={(checked) => update("sshEnabled", checked)}
                />
              </div>

              {form.sshEnabled ? (
                <div className="grid gap-3 border-t p-3">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2 grid gap-2">
                      <Label htmlFor="ssh-host">{t("connection.sshHost")}</Label>
                      <Input
                        id="ssh-host"
                        value={form.sshHost}
                        onChange={(e) => update("sshHost", e.target.value)}
                        placeholder="bastion.example.com"
                        className="font-mono text-xs"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="ssh-port">{t("connection.sshPort")}</Label>
                      <Input
                        id="ssh-port"
                        type="number"
                        inputMode="numeric"
                        value={form.sshPort}
                        onChange={(e) => update("sshPort", e.target.value)}
                        placeholder="22"
                      />
                    </div>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="ssh-user">{t("connection.sshUser")}</Label>
                    <Input
                      id="ssh-user"
                      value={form.sshUser}
                      onChange={(e) => update("sshUser", e.target.value)}
                      placeholder="ubuntu"
                      className="font-mono text-xs"
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label>{t("connection.sshAuth")}</Label>
                    <div className="inline-flex w-fit rounded-md border p-0.5">
                      {(["password", "privateKey"] as const).map((method) => (
                        <button
                          key={method}
                          type="button"
                          onClick={() => update("sshAuth", method)}
                          className={cn(
                            "rounded px-3 py-1 text-xs transition-colors",
                            form.sshAuth === method
                              ? "bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {method === "password"
                            ? t("connection.authPassword")
                            : t("connection.authPrivateKey")}
                        </button>
                      ))}
                    </div>
                  </div>

                  {form.sshAuth === "password" ? (
                    <div className="grid gap-2">
                      <Label htmlFor="ssh-password">{t("connection.sshPassword")}</Label>
                      <Input
                        id="ssh-password"
                        type="password"
                        value={form.sshPassword}
                        onChange={(e) => update("sshPassword", e.target.value)}
                        autoComplete="off"
                      />
                    </div>
                  ) : (
                    <>
                      <div className="grid gap-2">
                        <Label htmlFor="ssh-key">{t("connection.sshPrivateKey")}</Label>
                        <Textarea
                          id="ssh-key"
                          value={form.sshPrivateKey}
                          onChange={(e) => update("sshPrivateKey", e.target.value)}
                          placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                          spellCheck={false}
                          rows={5}
                          className="scrollbar-thin min-h-[6rem] font-mono text-xs"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="ssh-passphrase">{t("connection.sshPassphrase")}</Label>
                        <Input
                          id="ssh-passphrase"
                          type="password"
                          value={form.sshPassphrase}
                          onChange={(e) => update("sshPassphrase", e.target.value)}
                          autoComplete="off"
                        />
                      </div>
                    </>
                  )}

                  <div className="grid gap-2">
                    <Label htmlFor="ssh-known-hosts">{t("connection.sshKnownHosts")}</Label>
                    <Input
                      id="ssh-known-hosts"
                      value={form.sshKnownHosts}
                      onChange={(e) => update("sshKnownHosts", e.target.value)}
                      placeholder="/home/user/.ssh/known_hosts"
                      className="font-mono text-xs"
                    />
                    <p className="text-muted-foreground text-xs">
                      {t("connection.sshKnownHostsHint")}
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <Button type="button" variant="outline" onClick={handleTest} disabled={testing}>
              {testing ? <Loader2 className="animate-spin" /> : <PlugZap />}
              {t("connection.test")}
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="animate-spin" /> : <Save />}
                {connection ? t("connection.saveChanges") : t("common.create")}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
