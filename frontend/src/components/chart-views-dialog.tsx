import { Plus, Trash2 } from "lucide-react"

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
import { useI18n } from "@/lib/i18n"
import type { SavedChartView } from "@/lib/chart"

export interface ChartViewsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  views: SavedChartView[]
  scope?: string
  viewName: string
  onViewNameChange: (value: string) => void
  shareView: boolean
  onShareViewChange: (value: boolean) => void
  pinView: boolean
  onPinViewChange: (value: boolean) => void
  onSave: () => void
  onApply: (view: SavedChartView) => void
  onDelete: (view: SavedChartView) => void
}

export function ChartViewsDialog({
  open,
  onOpenChange,
  views,
  scope,
  viewName,
  onViewNameChange,
  shareView,
  onShareViewChange,
  pinView,
  onPinViewChange,
  onSave,
  onApply,
  onDelete,
}: ChartViewsDialogProps) {
  const { t } = useI18n()
  return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("chart.views")}</DialogTitle>
            <DialogDescription>{t("chart.viewsDesc")}</DialogDescription>
          </DialogHeader>
          <div className="max-h-56 space-y-1 overflow-auto">
            {views.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("chart.noViews")}</p>
            ) : (
              views.map((view) => (
                <div
                  key={`${view.shared ? "team" : "local"}-${view.id}`}
                  className="hover:bg-accent/50 flex items-center gap-2 rounded-md border px-2 py-1.5"
                >
                  <button
                    type="button"
                    onClick={() => onApply(view)}
                    className="min-w-0 flex-1 text-left text-sm"
                    title={view.name}
                  >
                    <span className="block truncate">{view.name}</span>
                    <span className="text-muted-foreground text-[10px]">
                      {view.shared ? t("chart.teamView") : t("chart.localView")}
                      {view.pinned ? ` · ${t("chart.pinnedView")}` : ""}
                      {view.updatedBy ? ` · ${view.updatedBy}` : ""}
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("chart.deleteView")}
                    onClick={() => void onDelete(view)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{t("chart.viewName")}</Label>
            <div className="flex items-center gap-2">
              <Input
                value={viewName}
                onChange={(event) => onViewNameChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    onSave()
                  }
                }}
                placeholder={t("chart.viewNamePlaceholder")}
              />
              <Button onClick={() => void onSave()} disabled={!viewName.trim()}>
                <Plus /> {t("common.save")}
              </Button>
            </div>
            {scope ? (
              <label className="flex items-center gap-2 text-xs">
                <Switch checked={shareView} onCheckedChange={onShareViewChange} />
                {t("chart.shareTeam")}
              </label>
            ) : null}
            {scope && shareView ? (
              <label className="flex items-center gap-2 text-xs">
                <Switch checked={pinView} onCheckedChange={onPinViewChange} />
                {t("chart.pinOverview")}
              </label>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  )
}
