import { AlertCircle, RefreshCw, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { MongoFilterEditor } from "@/components/mongo-filter-editor"
import { useI18n } from "@/lib/i18n"
import { jsonObjectError } from "@/lib/jsonText"
import * as React from "react"

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
  /** Optional AI repair for an invalid MQL filter. */
  onFixWithAI?: (query: string, error: string) => Promise<string>
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
  onFixWithAI,
}: ChartFilterBoxProps) {
  const { t } = useI18n()
  const [fixing, setFixing] = React.useState(false)
  const differs =
    parsed !== null &&
    compareFilter !== undefined &&
    value.trim() !== compareFilter.trim()

  const fix = async () => {
    if (!onFixWithAI || fixing) return
    setFixing(true)
    try {
      onChange(await onFixWithAI(value, jsonObjectError(value) ?? t("docs.invalidJson")))
      toast.success(t("mql.fixApplied"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("mql.fixFailed"))
    } finally {
      setFixing(false)
    }
  }

  return (
    <div className="space-y-1">
      <MongoFilterEditor
        value={value}
        onChange={onChange}
        placeholder={t("docs.filterPlaceholder")}
        suggestions={suggestions}
      />
      {parsed === null ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-destructive flex items-center gap-1.5 text-xs" role="alert">
            <AlertCircle className="size-3.5" /> {t("docs.invalidJson")}
          </p>
          {onFixWithAI ? (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => void fix()}
              disabled={fixing}
              title={t("mql.fixAIHint")}
              data-testid="chart-mql-ai-fix"
            >
              {fixing ? <RefreshCw className="animate-spin" /> : <Sparkles />}
              {fixing ? t("mql.fixing") : t("mql.fixAI")}
            </Button>
          ) : null}
        </div>
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
