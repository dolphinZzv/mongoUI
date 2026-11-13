import { AlertCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import { MongoFilterEditor } from "@/components/mongo-filter-editor"
import { useI18n } from "@/lib/i18n"

interface ChartFilterBoxProps {
  value: string
  onChange: (value: string) => void
  /** Parsed JSON, or null when the current text is invalid. */
  parsed: unknown | null
  suggestions?: string[]
  /** When set, offer to reset/apply when the chart filter differs. */
  compareFilter?: string
  onReset?: () => void
  onApply?: () => void
}

/** Filter editor + validation + the "chart filter differs from table" banner. */
export function ChartFilterBox({
  value,
  onChange,
  parsed,
  suggestions,
  compareFilter,
  onReset,
  onApply,
}: ChartFilterBoxProps) {
  const { t } = useI18n()
  const differs =
    parsed !== null &&
    compareFilter !== undefined &&
    value.trim() !== compareFilter.trim()

  return (
    <div className="space-y-1">
      <MongoFilterEditor
        value={value}
        onChange={onChange}
        placeholder={t("docs.filterPlaceholder")}
        suggestions={suggestions}
      />
      {parsed === null ? (
        <p className="text-destructive flex items-center gap-1.5 text-xs" role="alert">
          <AlertCircle className="size-3.5" /> {t("docs.invalidJson")}
        </p>
      ) : null}
      {differs ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-300">
          <span>{t("chart.filterDiffers")}</span>
          {onReset ? (
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={onReset}
            >
              {t("chart.resetToTable")}
            </Button>
          ) : null}
          {onApply ? (
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={onApply}
            >
              {t("chart.applyToDocuments")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
