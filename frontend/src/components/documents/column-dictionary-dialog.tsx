import * as React from "react"
import { Plus, Trash2 } from "lucide-react"
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
import { useI18n } from "@/lib/i18n"
import type { ColumnDictionaryEntry } from "@/lib/columnPrefs"

interface ColumnDictionaryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  column: string
  entries: ColumnDictionaryEntry[]
  onSave: (entries: ColumnDictionaryEntry[]) => void
}

/** Editor for a column's raw-value → display-label mappings. */
export function ColumnDictionaryDialog({
  open,
  onOpenChange,
  column,
  entries,
  onSave,
}: ColumnDictionaryDialogProps) {
  const { t } = useI18n()
  const [draft, setDraft] = React.useState<ColumnDictionaryEntry[]>([])

  React.useEffect(() => {
    if (!open) return
    setDraft(entries.length > 0 ? entries.map((entry) => ({ ...entry })) : [])
  }, [open, entries])

  const update = (index: number, patch: Partial<ColumnDictionaryEntry>) => {
    setDraft((prev) =>
      prev.map((entry, current) => (current === index ? { ...entry, ...patch } : entry)),
    )
  }

  const remove = (index: number) => {
    setDraft((prev) => prev.filter((_, current) => current !== index))
  }

  const save = () => {
    const mapped = new Map<string, string>()
    for (const entry of draft) {
      const value = entry.value.trim()
      const label = entry.label.trim()
      if (value && label) mapped.set(value, label)
    }
    const clean = Array.from(mapped.entries()).map(([value, label]) => ({ value, label }))
    onSave(clean)
    toast.success(t("dictionary.saved"))
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("dictionary.title")}</DialogTitle>
          <DialogDescription>
            {t("dictionary.desc", { column })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="text-muted-foreground grid grid-cols-[1fr_1fr_auto] gap-2 px-1 text-[11px] uppercase">
            <span>{t("dictionary.raw")}</span>
            <span>{t("dictionary.label")}</span>
            <span className="w-8" />
          </div>

          {draft.length === 0 ? (
            <p className="text-muted-foreground rounded-md border border-dashed px-3 py-6 text-center text-xs">
              {t("dictionary.empty")}
            </p>
          ) : null}

          <div className="scrollbar-thin max-h-[45vh] space-y-2 overflow-auto pr-1">
            {draft.map((entry, index) => (
              <div key={index} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                <Input
                  value={entry.value}
                  onChange={(event) => update(index, { value: event.target.value })}
                  placeholder={t("dictionary.rawPlaceholder")}
                  spellCheck={false}
                  className="font-mono text-xs"
                />
                <Input
                  value={entry.label}
                  onChange={(event) => update(index, { label: event.target.value })}
                  placeholder={t("dictionary.labelPlaceholder")}
                  className="text-xs"
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => remove(index)}
                  title={t("dictionary.remove")}
                  aria-label={t("dictionary.remove")}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setDraft((prev) => [...prev, { value: "", label: "" }])}
          >
            <Plus /> {t("dictionary.add")}
          </Button>
          <p className="text-muted-foreground text-[11px]">{t("dictionary.hint")}</p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={save}>{t("common.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
