import * as React from "react"
import { Loader2 } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { buttonVariants } from "@/components/ui/button"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: React.ReactNode
  confirmLabel?: string
  destructive?: boolean
  /**
   * When set, the user must type this exact text before the confirm button
   * enables. Used for irreversible operations such as dropping a collection.
   */
  confirmText?: string
  onConfirm: () => void | Promise<void>
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = true,
  confirmText,
  onConfirm,
}: ConfirmDialogProps) {
  const { t } = useI18n()
  const [busy, setBusy] = React.useState(false)
  const [typed, setTyped] = React.useState("")

  React.useEffect(() => {
    if (open) {
      setTyped("")
      setBusy(false)
    }
  }, [open])

  const confirmed = !confirmText || typed === confirmText

  const handleConfirm = async (event: React.MouseEvent) => {
    event.preventDefault()
    if (!confirmed) return
    setBusy(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? (
            <AlertDialogDescription asChild>
              <div className="text-muted-foreground text-sm">{description}</div>
            </AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        {confirmText ? (
          <div className="grid gap-2">
            <Label htmlFor="confirm-text" className="text-xs">
              {t("confirm.typeToConfirm", { name: confirmText })}
            </Label>
            <Input
              id="confirm-text"
              autoFocus
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && confirmed) {
                  event.preventDefault()
                  void handleConfirm(event as unknown as React.MouseEvent)
                }
              }}
              spellCheck={false}
              autoComplete="off"
              className="font-mono"
              placeholder={confirmText}
            />
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={busy || !confirmed}
            className={cn(destructive && buttonVariants({ variant: "destructive" }))}
          >
            {busy ? <Loader2 className="animate-spin" /> : null}
            {confirmLabel ?? t("common.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
