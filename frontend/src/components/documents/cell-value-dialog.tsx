import { Copy } from "lucide-react"
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
import { copyToClipboard } from "@/lib/clipboard"
import { useI18n } from "@/lib/i18n"
import { classForType, formatValue, prettyJSON, valueType } from "@/lib/mongo"
import { cn } from "@/lib/utils"

interface CellValueDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  column: string
  value: unknown
}

/** Render the complete value, preferring readable JSON for objects/arrays. */
function fullValueText(value: unknown): string {
  if (typeof value === "string") return value
  if (value === null || value === undefined) return "null"
  if (typeof value === "object") return prettyJSON(value)
  return formatValue(value)
}

/** Read-only preview for table cells whose content does not fit in the grid. */
export function CellValueDialog({ open, onOpenChange, column, value }: CellValueDialogProps) {
  const { t } = useI18n()
  const type = valueType(value)
  const text = fullValueText(value)

  const copy = async () => {
    const ok = await copyToClipboard(text)
    if (ok) toast.success(t("common.copied"))
    else toast.error(t("common.copyFailed"))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-6 font-mono text-base">{column}</DialogTitle>
          <DialogDescription>
            {t("docs.valuePreviewDesc", { type, count: text.length })}
          </DialogDescription>
        </DialogHeader>
        <pre
          className={cn(
            "scrollbar-thin bg-muted/30 max-h-[60vh] overflow-auto rounded-md border p-3",
            "font-mono text-xs break-words whitespace-pre-wrap",
            classForType(type),
          )}
        >
          {text}
        </pre>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => void copy()}>
            <Copy /> {t("docs.copyValue")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
