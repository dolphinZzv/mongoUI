import * as React from "react"
import { Loader2, Save, Wand2 } from "lucide-react"
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
import { JsonEditor, formatJSONString, validateJSON } from "@/components/json-editor"
import { useI18n } from "@/lib/i18n"

interface DocumentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  initialValue: string
  submitLabel?: string
  onSubmit: (value: unknown) => Promise<void>
}

export function DocumentDialog({
  open,
  onOpenChange,
  title,
  description,
  initialValue,
  submitLabel = "Save",
  onSubmit,
}: DocumentDialogProps) {
  const [value, setValue] = React.useState(initialValue)
  const [busy, setBusy] = React.useState(false)
  const { t } = useI18n()

  React.useEffect(() => {
    if (open) setValue(initialValue)
  }, [open, initialValue])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const error = validateJSON(value, { allowEmpty: false })
    if (error) {
      toast.error(error)
      return
    }
    setBusy(true)
    try {
      await onSubmit(JSON.parse(value))
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Operation failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden sm:max-w-2xl">
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto py-4 pr-1">
            <JsonEditor
              value={value}
              onChange={setValue}
              allowEmpty={false}
              rows={14}
              className="min-h-[18rem] max-h-[55vh]"
              placeholder='{ "name": "Alice" }'
            />
          </div>
          <DialogFooter className="shrink-0 sm:justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={() => setValue((prev) => formatJSONString(prev))}
            >
              <Wand2 /> {t("common.format")}
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Save />}
                {submitLabel}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
