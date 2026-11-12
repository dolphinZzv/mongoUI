import * as React from "react"
import { AlertCircle, Ban, Play, Plus, RefreshCw } from "lucide-react"

import { MongoFilterEditor } from "@/components/mongo-filter-editor"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/lib/i18n"
import { jsonError } from "@/lib/jsonText"
import { cn } from "@/lib/utils"

export interface DocumentsFilterBarProps {
  /** The applied filter, mirrored from the query hook. */
  value: string
  onApply: (filter: string) => void
  onRefresh: () => void
  loading: boolean
  onCancel: () => void
  readOnly: boolean
  onInsert: () => void
  /** Sort/projection errors from the query hook; filter errors are local. */
  queryError: string | null
  suggestions: string[]
}

/**
 * Owns the draft filter text so typing does not re-render the document table.
 * The draft is committed with Run, Ctrl/Cmd+Enter or plain Enter.
 */
export function DocumentsFilterBar({
  value,
  onApply,
  onRefresh,
  loading,
  onCancel,
  readOnly,
  onInsert,
  queryError,
  suggestions,
}: DocumentsFilterBarProps) {
  const { t } = useI18n()
  const [draft, setDraft] = React.useState(value)

  React.useEffect(() => {
    setDraft(value)
  }, [value])

  const draftError = jsonError(draft)
  const error = draftError ?? queryError

  const apply = React.useCallback(() => {
    if (draftError) return
    onApply(draft)
  }, [draft, draftError, onApply])

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1 basis-full sm:basis-auto">
          <MongoFilterEditor
            value={draft}
            onChange={setDraft}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey) return
              event.preventDefault()
              apply()
            }}
            placeholder={t("docs.filterPlaceholder")}
            suggestions={suggestions}
          />
        </div>
        {loading ? (
          <Button variant="outline" onClick={onCancel} title={t("docs.cancelQuery")}>
            <Ban /> {t("docs.cancelQuery")}
          </Button>
        ) : (
          <Button
            data-testid="documents-run"
            onClick={apply}
            disabled={Boolean(error)}
            title={error ? `${t("docs.invalidJson")}: ${error}` : t("docs.runShortcut")}
          >
            <Play /> {t("common.run")}
          </Button>
        )}
        <Button
          variant="outline"
          size="icon"
          onClick={onRefresh}
          title={t("common.refresh")}
          aria-label={t("common.refresh")}
          data-testid="documents-refresh"
        >
          <RefreshCw className={cn(loading && "animate-spin")} />
        </Button>
        <Button
          className="ml-auto sm:ml-0"
          onClick={onInsert}
          disabled={readOnly}
          title={readOnly ? t("docs.readonlyTip") : t("docs.insertTitle")}
        >
          <Plus /> {t("docs.insert")}
        </Button>
      </div>

      {error ? (
        <p className="text-destructive flex items-start gap-1.5 text-xs" role="alert">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 break-words">
            {t("docs.invalidJson")}: {error}
          </span>
        </p>
      ) : null}
    </>
  )
}
