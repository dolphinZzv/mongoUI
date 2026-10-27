import * as React from "react"
import { KeyRound, Loader2, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { useAuth } from "@/components/auth-gate"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { useI18n } from "@/lib/i18n"
import type { AuthRole, AuthUser, AuthUserSetup } from "@/lib/types"

interface UsersDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const ROLES: AuthRole[] = ["admin", "readwrite", "readonly"]

type NewUserMethod = "password" | "totp"

/** Admin-only account management: list, add, change role, reset password, delete. */
export function UsersDialog({ open, onOpenChange }: UsersDialogProps) {
  const { t } = useI18n()
  const { username: currentUsername } = useAuth()
  const [users, setUsers] = React.useState<AuthUser[]>([])
  const [loading, setLoading] = React.useState(false)
  const [adding, setAdding] = React.useState(false)
  const [newUsername, setNewUsername] = React.useState("")
  const [newRole, setNewRole] = React.useState<AuthRole>("readwrite")
  const [newMethod, setNewMethod] = React.useState<NewUserMethod>("password")
  const [newPassword, setNewPassword] = React.useState("")
  const [newPasswordConfirm, setNewPasswordConfirm] = React.useState("")
  const [pending, setPending] = React.useState<AuthUserSetup | null>(null)
  const [code, setCode] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [resetting, setResetting] = React.useState<AuthUser | null>(null)
  const [resetPassword, setResetPassword] = React.useState("")
  const [resetPasswordConfirm, setResetPasswordConfirm] = React.useState("")
  const [resetBusy, setResetBusy] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      setUsers((await api.listAuthUsers()) ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("users.failed"))
    } finally {
      setLoading(false)
    }
  }, [t])

  const resetAddForm = () => {
    setAdding(false)
    setPending(null)
    setCode("")
    setNewUsername("")
    setNewRole("readwrite")
    setNewMethod("password")
    setNewPassword("")
    setNewPasswordConfirm("")
  }

  React.useEffect(() => {
    if (!open) return
    setAdding(false)
    setPending(null)
    setCode("")
    setNewUsername("")
    setNewRole("readwrite")
    setNewMethod("password")
    setNewPassword("")
    setNewPasswordConfirm("")
    setResetting(null)
    setResetPassword("")
    setResetPasswordConfirm("")
    void load()
  }, [open, load])

  const create = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!newUsername.trim()) return
    if (newMethod === "password") {
      if (newPassword.length < 8) {
        toast.error(t("auth.passwordTooShort"))
        return
      }
      if (newPassword !== newPasswordConfirm) {
        toast.error(t("auth.passwordMismatch"))
        return
      }
    }
    setBusy(true)
    try {
      if (newMethod === "password") {
        const user = await api.createAuthUserPassword(
          newUsername.trim(),
          newRole,
          newPassword,
        )
        toast.success(t("users.added", { name: user.username }))
        resetAddForm()
        await load()
      } else {
        setPending(await api.createAuthUser(newUsername.trim(), newRole))
        setCode("")
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("users.failed"))
    } finally {
      setBusy(false)
    }
  }

  const confirm = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!pending) return
    setBusy(true)
    try {
      const user = await api.confirmAuthUser(pending.id, code.trim())
      toast.success(t("users.added", { name: user.username }))
      setPending(null)
      setAdding(false)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("auth.invalidCode"))
    } finally {
      setBusy(false)
    }
  }

  const changeRole = async (id: string, role: AuthRole) => {
    try {
      await api.updateAuthUserRole(id, role)
      setUsers((prev) => prev.map((user) => (user.id === id ? { ...user, role } : user)))
      toast.success(t("users.roleUpdated"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("users.failed"))
    }
  }

  const submitResetPassword = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!resetting) return
    if (resetPassword.length < 8) {
      toast.error(t("auth.passwordTooShort"))
      return
    }
    if (resetPassword !== resetPasswordConfirm) {
      toast.error(t("auth.passwordMismatch"))
      return
    }
    setResetBusy(true)
    try {
      await api.updateAuthUserPassword(resetting.id, resetPassword)
      toast.success(t("users.passwordUpdated", { name: resetting.username }))
      setResetting(null)
      setResetPassword("")
      setResetPasswordConfirm("")
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("users.failed"))
    } finally {
      setResetBusy(false)
    }
  }

  const remove = async (user: AuthUser) => {
    try {
      await api.deleteAuthUser(user.id)
      setUsers((prev) => prev.filter((entry) => entry.id !== user.id))
      toast.success(t("users.removed"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("users.failed"))
    }
  }

  const sourceLabel = (user: AuthUser) =>
    user.source === "oidc"
      ? t("users.source.oidc")
      : user.source === "password"
        ? t("users.source.password")
        : t("users.source.totp")

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("users.title")}</DialogTitle>
            <DialogDescription>{t("users.desc")}</DialogDescription>
          </DialogHeader>

          {pending ? (
            <form onSubmit={confirm} className="space-y-4 overflow-auto">
              <p className="text-sm font-medium">{t("users.confirmTitle", { name: newUsername })}</p>
              <div className="flex justify-center">
                <img
                  src={pending.qr}
                  alt="TOTP QR code"
                  className="size-44 rounded-lg border bg-white p-2"
                />
              </div>
              <code className="bg-muted block rounded px-2 py-1.5 font-mono text-xs break-all">
                {pending.secret}
              </code>
              <p className="text-muted-foreground text-xs">{t("users.confirmDesc")}</p>
              <div className="space-y-1">
                <Label htmlFor="new-user-code">{t("auth.codeLabel")}</Label>
                <Input
                  id="new-user-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  className="font-mono tracking-[0.3em]"
                  autoFocus
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setPending(null)}>
                  {t("common.cancel")}
                </Button>
                <Button type="submit" disabled={busy || code.length !== 6}>
                  {busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
                  {t("users.confirm")}
                </Button>
              </div>
            </form>
          ) : (
            <>
              <div className="flex shrink-0 items-center justify-between gap-2">
                <p className="text-muted-foreground text-xs">
                  {t("users.count", { count: users.length })}
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
                {loading && users.length === 0 ? (
                  <div className="text-muted-foreground flex justify-center py-6">
                    <Loader2 className="size-5 animate-spin" />
                  </div>
                ) : null}
                {users.map((user) => (
                  <div key={user.id} className="flex items-center gap-2 rounded-md border p-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {user.username}
                        <span className="text-muted-foreground ml-1.5 text-[10px] uppercase">
                          {sourceLabel(user)}
                        </span>
                        {currentUsername && user.username === currentUsername ? (
                          <Badge variant="secondary" className="ml-1.5 px-1 py-0 text-[9px]">
                            {t("users.current")}
                          </Badge>
                        ) : null}
                      </p>
                      <p className="text-muted-foreground text-[11px]">
                        {user.email ? `${user.email} · ` : ""}
                        {user.createdAt}
                      </p>
                    </div>
                    <Select
                      value={user.role}
                      onValueChange={(value) => void changeRole(user.id, value as AuthRole)}
                    >
                      <SelectTrigger size="sm" className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES.map((role) => (
                          <SelectItem key={role} value={role}>
                            {t(`users.role.${role}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {user.source !== "oidc" ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => {
                          setResetting(user)
                          setResetPassword("")
                          setResetPasswordConfirm("")
                        }}
                        title={t("users.setPassword")}
                        aria-label={t("users.setPassword")}
                      >
                        <KeyRound />
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => void remove(user)}
                      title={t("users.delete")}
                      aria-label={t("users.delete")}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))}
              </div>

              {adding ? (
                <form onSubmit={create} className="space-y-3 border-t pt-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="grid gap-1 sm:col-span-2">
                      <Label className="text-xs">{t("users.username")}</Label>
                      <Input
                        value={newUsername}
                        onChange={(event) => setNewUsername(event.target.value)}
                        autoFocus
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-xs">{t("users.role")}</Label>
                      <Select
                        value={newRole}
                        onValueChange={(value) => setNewRole(value as AuthRole)}
                      >
                        <SelectTrigger size="sm" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLES.map((role) => (
                            <SelectItem key={role} value={role}>
                              {t(`users.role.${role}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-xs">{t("users.method")}</Label>
                      <Select
                        value={newMethod}
                        onValueChange={(value) => setNewMethod(value as NewUserMethod)}
                      >
                        <SelectTrigger size="sm" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="password">{t("users.method.password")}</SelectItem>
                          <SelectItem value="totp">{t("users.method.totp")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {newMethod === "password" ? (
                    <>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="grid gap-1">
                          <Label className="text-xs">{t("users.password")}</Label>
                          <Input
                            type="password"
                            value={newPassword}
                            onChange={(event) => setNewPassword(event.target.value)}
                            autoComplete="new-password"
                            placeholder={t("auth.passwordHint")}
                          />
                        </div>
                        <div className="grid gap-1">
                          <Label className="text-xs">{t("users.passwordConfirm")}</Label>
                          <Input
                            type="password"
                            value={newPasswordConfirm}
                            onChange={(event) => setNewPasswordConfirm(event.target.value)}
                            autoComplete="new-password"
                          />
                        </div>
                      </div>
                      <p className="text-muted-foreground text-xs">{t("auth.passwordHint")}</p>
                    </>
                  ) : null}
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={resetAddForm}>
                      {t("common.cancel")}
                    </Button>
                    <Button
                      type="submit"
                      disabled={
                        busy ||
                        !newUsername.trim() ||
                        (newMethod === "password" &&
                          (newPassword.length < 8 || !newPasswordConfirm))
                      }
                    >
                      {busy ? <Loader2 className="animate-spin" /> : <Plus />}
                      {t("users.add")}
                    </Button>
                  </div>
                </form>
              ) : (
                <Button
                  variant="outline"
                  className="w-full shrink-0"
                  onClick={() => setAdding(true)}
                >
                  <Plus /> {t("users.add")}
                </Button>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={resetting !== null}
        onOpenChange={(value) => {
          if (!value) setResetting(null)
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("users.setPasswordTitle", { name: resetting?.username ?? "" })}</DialogTitle>
            <DialogDescription>{t("users.setPasswordDesc")}</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitResetPassword} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="reset-password">{t("users.password")}</Label>
              <Input
                id="reset-password"
                type="password"
                value={resetPassword}
                onChange={(event) => setResetPassword(event.target.value)}
                autoComplete="new-password"
                placeholder={t("auth.passwordHint")}
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="reset-password-confirm">{t("users.passwordConfirm")}</Label>
              <Input
                id="reset-password-confirm"
                type="password"
                value={resetPasswordConfirm}
                onChange={(event) => setResetPasswordConfirm(event.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setResetting(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={
                  resetBusy || resetPassword.length < 8 || !resetPasswordConfirm
                }
              >
                {resetBusy ? <Loader2 className="animate-spin" /> : <KeyRound />}
                {t("users.setPassword")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
