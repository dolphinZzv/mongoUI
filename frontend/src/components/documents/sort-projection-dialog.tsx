import * as React from "react"

import { JsonEditor } from "@/components/json-editor"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { useI18n } from "@/lib/i18n"
import { jsonObjectError } from "@/lib/jsonText"

interface SortProjectionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sort: string
  projection: string
  /** Persist the drafts and rerun the query. */
  onApply: (sort: string, projection: string) => void
}

/**
 * Editor for the sort and projection JSON. It lives in the overflow menu so
 * the documents toolbar stays compact; applying reruns the query immediately.
 */
export function SortProjectionDialog({
  open,
  onOpenChange,
  sort,
  projection,
  onApply,
}: SortProjectionDialogProps) {
  const { t } = useI18n()
  const [sortDraft, setSortDraft] = React.useState(sort)
  const [projectionDraft, setProjectionDraft] = React.useState(projection)

  // Seed the drafts each time the dialog opens so cancelled edits are dropped.
  React.useEffect(() => {
    if (!open) return
    setSortDraft(sort)
    setProjectionDraft(projection)
  }, [open, sort, projection])

  const sortError = jsonObjectError(sortDraft)
  const projectionError = jsonObjectError(projectionDraft)
  const error = sortError ?? projectionError

  const apply = (event: React.FormEvent) => {
    event.preventDefault()
    if (error) return
    onApply(sortDraft.trim(), projectionDraft.trim())
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={apply} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("docs.sortProjection")}</DialogTitle>
            <DialogDescription>{t("docs.sortProjectionDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs" htmlFor="documents-sort">
                {t("docs.sort")}
              </Label>
              <JsonEditor
                id="documents-sort"
                value={sortDraft}
                onChange={setSortDraft}
                placeholder='{ "createdAt": -1 }'
                className="min-h-[6rem]"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs" htmlFor="documents-projection">
                {t("docs.projection")}
              </Label>
              <JsonEditor
                id="documents-projection"
                value={projectionDraft}
                onChange={setProjectionDraft}
                placeholder='{ "name": 1, "email": 1 }'
                className="min-h-[6rem]"
              />
            </div>
          </div>
          {error ? (
            <p className="text-destructive text-xs" role="alert">
              {t("docs.invalidJson")}: {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={Boolean(error)}>
              {t("common.run")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
