import * as React from "react"
import { AlertCircle, Ban, Braces, Eraser, ListFilter, Play, Plus, RefreshCw, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { MongoFilterEditor } from "@/components/mongo-filter-editor"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/lib/i18n"
import { jsonObjectError } from "@/lib/jsonText"
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
  /** Open the visual query builder with the current draft as its seed. */
  onOpenBuilder: () => void
  /** Reset the filter to the match-all document. */
  onClear: () => void
  /** Ask the configured BYOK model to repair an invalid MQL draft. */
  onFixWithAI: (query: string, error: string) => Promise<string>
  /** Restored draft, e.g. when returning to a collection tab. */
  initialDraft?: string
  /** localStorage scope for the unapplied MQL draft. */
  draftStorageKey?: string
  /** Report whether the draft differs from the applied filter. */
  onDirtyChange?: (dirty: boolean) => void
}

/**
 * Owns the draft MQL filter text so typing does not re-render the document
 * table. The draft is committed with Run, Ctrl/Cmd+Enter or plain Enter.
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
  onOpenBuilder,
  onClear,
  onFixWithAI,
  initialDraft,
  draftStorageKey,
  onDirtyChange,
}: DocumentsFilterBarProps) {
  const { t } = useI18n()
  const [draft, setDraft] = React.useState(initialDraft ?? value)
  const lastValueRef = React.useRef(value)
  const [fixing, setFixing] = React.useState(false)

  // Only re-seed from the applied filter when it actually changes. This keeps
  // a restored draft intact when the collection tab is remounted.
  React.useEffect(() => {
    if (value === lastValueRef.current) return
    lastValueRef.current = value
    setDraft(value)
  }, [value])

  React.useEffect(() => {
    if (draftStorageKey) {
      try {
        if (draft.trim() === value.trim()) localStorage.removeItem(draftStorageKey)
        else localStorage.setItem(draftStorageKey, draft)
      } catch {
        /* storage may be unavailable */
      }
    }
    onDirtyChange?.(draft.trim() !== value.trim())
  }, [draft, value, draftStorageKey, onDirtyChange])

  const draftError = jsonObjectError(draft)
  const error = draftError ?? queryError
  const hasFilter = draft.trim() !== "" && draft.trim() !== "{}"

  const apply = React.useCallback(() => {
    if (draftError) return
    onApply(draft)
  }, [draft, draftError, onApply])

  const formatDraft = () => {
    if (draftError) return
    try {
      setDraft(JSON.stringify(JSON.parse(draft.trim() || "{}"), null, 2))
    } catch {
      /* the inline error already explains the problem */
    }
  }

  const fixWithAI = async () => {
    if (!draftError || fixing) return
    setFixing(true)
    try {
      const fixed = await onFixWithAI(draft, draftError)
      setDraft(fixed)
      toast.success(t("mql.fixApplied"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("mql.fixFailed"))
    } finally {
      setFixing(false)
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className="border-primary/30 bg-primary/5 text-primary rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wider"
          title={t("mql.entryHint")}
        >
          MQL
        </span>
        <span className="text-muted-foreground hidden text-[11px] sm:inline">
          {t("mql.entryHint")}
        </span>
        {!error && hasFilter ? (
          <span className="text-[11px] text-emerald-600 dark:text-emerald-400">
            {t("mql.valid")}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={onOpenBuilder}
            title={t("filter.builder")}
          >
            <ListFilter className="size-3.5" /> {t("filter.visual")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={formatDraft}
            disabled={Boolean(error)}
            title={t("docs.formatQuery")}
          >
            <Braces className="size-3.5" /> {t("docs.format")}
          </Button>
        </div>
      </div>

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
          onClick={onClear}
          disabled={!hasFilter || loading}
          title={t("mql.clear")}
          aria-label={t("mql.clear")}
          data-testid="documents-clear"
        >
          <Eraser />
        </Button>
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
        <div className="flex flex-wrap items-start gap-2">
          <p className="text-destructive flex min-w-0 flex-1 items-start gap-1.5 text-xs" role="alert">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0 break-words">
              {t("docs.invalidJson")}: {error}
            </span>
          </p>
          {draftError ? (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => void fixWithAI()}
              disabled={fixing}
              title={t("mql.fixAIHint")}
              data-testid="mql-ai-fix"
            >
              {fixing ? <RefreshCw className="animate-spin" /> : <Sparkles />}
              {fixing ? t("mql.fixing") : t("mql.fixAI")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  )
}
