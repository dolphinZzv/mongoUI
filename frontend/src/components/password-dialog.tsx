import * as React from "react"
import { KeyRound, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { useAuth } from "@/components/auth-gate"
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
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"

interface PasswordDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Change (or add) the signed-in local account's password. */
export function PasswordDialog({ open, onOpenChange }: PasswordDialogProps) {
  const { t } = useI18n()
  const { hasPassword, refresh } = useAuth()
  const [current, setCurrent] = React.useState("")
  const [next, setNext] = React.useState("")
  const [confirm, setConfirm] = React.useState("")
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setCurrent("")
    setNext("")
    setConfirm("")
    setBusy(false)
  }, [open])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (next.length < 8) {
      toast.error(t("auth.passwordTooShort"))
      return
    }
    if (next !== confirm) {
      toast.error(t("auth.passwordMismatch"))
      return
    }
    setBusy(true)
    try {
      await api.authChangePassword(current, next)
      toast.success(t("auth.passwordUpdated"))
      await refresh?.()
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("auth.passwordUpdateFailed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("auth.changePasswordTitle")}</DialogTitle>
          <DialogDescription>
            {hasPassword ? t("auth.changePasswordDesc") : t("auth.addPasswordDesc")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {hasPassword ? (
            <div className="space-y-1">
              <Label htmlFor="current-password">{t("auth.currentPasswordLabel")}</Label>
              <Input
                id="current-password"
                type="password"
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
                autoComplete="current-password"
                autoFocus
              />
            </div>
          ) : null}
          <div className="space-y-1">
            <Label htmlFor="new-password">{t("auth.newPasswordLabel")}</Label>
            <Input
              id="new-password"
              type="password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
              autoComplete="new-password"
              placeholder={t("auth.passwordHint")}
              autoFocus={!hasPassword}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-password-confirm">{t("auth.passwordConfirmLabel")}</Label>
            <Input
              id="new-password-confirm"
              type="password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="new-password"
            />
          </div>
          <Button
            type="submit"
            className="w-full"
            disabled={
              busy || next.length < 8 || !confirm || (!!hasPassword && !current)
            }
          >
            {busy ? <Loader2 className="animate-spin" /> : <KeyRound />}
            {t("auth.updatePassword")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
