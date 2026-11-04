import * as React from "react"
import { Loader2, MessageSquare, Send, X } from "lucide-react"
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
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"

const DISMISSED_KEY = "mongoui-feedback-dismissed"

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1"
  } catch {
    return false
  }
}

function writeDismissed(dismissed: boolean): void {
  try {
    localStorage.setItem(DISMISSED_KEY, dismissed ? "1" : "0")
  } catch {
    /* storage may be unavailable */
  }
}

interface FeedbackWidgetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Floating feedback entry point that opens a GitHub issue via the backend. */
export function FeedbackWidget({ open, onOpenChange }: FeedbackWidgetProps) {
  const { t } = useI18n()
  const [hidden, setHidden] = React.useState(() => readDismissed())
  const [title, setTitle] = React.useState("")
  const [body, setBody] = React.useState("")
  const [busy, setBusy] = React.useState(false)

  // Opening from the settings menu should also restore a dismissed button.
  React.useEffect(() => {
    if (!open || !hidden) return
    setHidden(false)
    writeDismissed(false)
  }, [open, hidden])

  const dismiss = () => {
    setHidden(true)
    writeDismissed(true)
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const cleanTitle = title.trim()
    const cleanBody = body.trim()
    if (!cleanTitle || !cleanBody) return

    setBusy(true)
    try {
      await api.submitFeedback({ title: cleanTitle, body: cleanBody })
      toast.success(t("feedback.sent"))
      setTitle("")
      setBody("")
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("feedback.failed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {hidden ? null : (
        <div
          data-testid="feedback-widget"
          className="bg-background/95 fixed right-4 bottom-4 z-40 flex items-center rounded-full border p-1 shadow-lg backdrop-blur"
        >
          <button
            type="button"
            onClick={() => onOpenChange(true)}
            title={t("feedback.title")}
            className="hover:bg-accent focus-visible:ring-ring flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium outline-none focus-visible:ring-2"
          >
            <MessageSquare className="size-4" />
            <span className="hidden sm:inline">{t("feedback.button")}</span>
          </button>
          <button
            type="button"
            onClick={dismiss}
            title={t("feedback.dismiss")}
            aria-label={t("feedback.dismiss")}
            className="text-muted-foreground hover:bg-accent hover:text-foreground rounded-full p-1.5"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("feedback.title")}</DialogTitle>
            <DialogDescription>{t("feedback.desc")}</DialogDescription>
          </DialogHeader>

          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-1.5">
              <Label htmlFor="feedback-title">{t("feedback.subject")}</Label>
              <Input
                id="feedback-title"
                autoFocus
                required
                maxLength={160}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={t("feedback.subjectPlaceholder")}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="feedback-body">{t("feedback.details")}</Label>
              <Textarea
                id="feedback-body"
                required
                rows={6}
                maxLength={8000}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder={t("feedback.detailsPlaceholder")}
                className="min-h-32 resize-y"
              />
            </div>
            <p className="text-muted-foreground text-xs">{t("feedback.contextHint")}</p>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={busy}
              >
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={busy || !title.trim() || !body.trim()}>
                {busy ? <Loader2 className="animate-spin" /> : <Send />}
                {busy ? t("feedback.sending") : t("feedback.send")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
