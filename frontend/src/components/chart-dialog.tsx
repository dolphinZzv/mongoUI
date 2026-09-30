import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ChartView } from "@/components/chart-view"
import { useI18n } from "@/lib/i18n"
import type { MongoDocument } from "@/lib/types"

interface ChartDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  documents: MongoDocument[]
  columns: string[]
  storageKey?: string
}

/** A large dialog that plots the currently visible documents as a chart. */
export function ChartDialog({
  open,
  onOpenChange,
  documents,
  columns,
  storageKey,
}: ChartDialogProps) {
  const { t } = useI18n()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] max-h-[calc(100vh-2rem)] flex-col overflow-hidden sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{t("chart.title")}</DialogTitle>
          <DialogDescription>{t("chart.desc")}</DialogDescription>
        </DialogHeader>
        <ChartView
          className="min-h-0 flex-1"
          documents={documents}
          columns={columns}
          storageKey={storageKey}
          height={420}
        />
      </DialogContent>
    </Dialog>
  )
}
