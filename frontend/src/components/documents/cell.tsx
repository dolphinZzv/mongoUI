import * as React from "react"

import { Input } from "@/components/ui/input"
import { classForType, formatValue, prettyJSON, valueType } from "@/lib/mongo"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { MongoDocument } from "@/lib/types"

/** A single BSON value rendered as a type-colored, truncated monospace cell. */
export function CellValue({ value }: { value: unknown }) {
  const type = valueType(value)
  const text = formatValue(value)
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground font-mono text-xs italic">null</span>
  }
  const display = text.length > 90 ? `${text.slice(0, 90)}…` : text
  return (
    <span className={cn("font-mono text-xs", classForType(type))} title={text}>
      {display}
    </span>
  )
}

/** Render a value as compact Extended JSON so it can round-trip through parse. */
function inlineText(value: unknown): string {
  if (value === undefined) return ""
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

type ParsedInline = { ok: true; value: unknown } | { ok: false }

/**
 * Parse an inline edit draft. JSON is preferred so numbers, booleans, null and
 * Extended JSON (ObjectId/date/…) keep their types. Bare text is accepted for
 * string-ish cells, which makes editing a string feel natural.
 */
function parseInline(text: string, current: unknown): ParsedInline {
  const trimmed = text.trim()
  if (trimmed === "") return { ok: true, value: undefined }
  try {
    return { ok: true, value: JSON.parse(trimmed) }
  } catch {
    if (typeof current === "string" || current === undefined) {
      return { ok: true, value: text }
    }
    return { ok: false }
  }
}

interface InlineCellEditorProps {
  value: unknown
  busy: boolean
  onSave: (value: unknown) => Promise<boolean>
  onCancel: () => void
}

/**
 * In-place editor for a table cell. Enter or blur saves, Escape cancels.
 * Complex values are edited as JSON; a string can be typed without quotes.
 */
export function InlineCellEditor({ value, busy, onSave, onCancel }: InlineCellEditorProps) {
  const { t } = useI18n()
  const [draft, setDraft] = React.useState(() => inlineText(value))
  const [error, setError] = React.useState<string | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const committingRef = React.useRef(false)
  const cancelledRef = React.useRef(false)

  React.useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [])

  const commit = React.useCallback(async () => {
    if (busy || committingRef.current || cancelledRef.current) return
    committingRef.current = true
    try {
      const parsed = parseInline(draft, value)
      if (!parsed.ok) {
        setError(t("docs.inlineInvalid"))
        inputRef.current?.focus()
        return
      }
      setError(null)
      const saved = await onSave(parsed.value)
      if (!saved) inputRef.current?.focus()
    } finally {
      committingRef.current = false
    }
  }, [busy, draft, onSave, t, value])

  return (
    <div
      className="min-w-0"
      onDoubleClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
    >
      <Input
        ref={inputRef}
        value={draft}
        disabled={busy}
        spellCheck={false}
        autoComplete="off"
        aria-label={t("docs.editValue")}
        aria-invalid={error !== null}
        title={t("docs.inlineEditHint")}
        onChange={(event) => {
          setDraft(event.target.value)
          if (error) setError(null)
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            void commit()
          } else if (event.key === "Escape") {
            event.preventDefault()
            cancelledRef.current = true
            onCancel()
          }
        }}
        onBlur={() => void commit()}
        className={cn(
          "h-7 min-w-0 px-1.5 py-0 font-mono text-xs",
          error ? "border-destructive focus-visible:ring-destructive/30" : "",
        )}
      />
      {error ? <p className="text-destructive mt-0.5 text-[10px]">{error}</p> : null}
    </div>
  )
}

interface CellContextMenuProps {
  x: number
  y: number
  column: string
  value: unknown
  document: MongoDocument
  onCopy: (text: string) => void
  onEdit?: () => void
}

/** Right-click menu for a table cell: copy value / JSON / field / _id / $set. */
export function CellContextMenu({
  x,
  y,
  column,
  value,
  document,
  onCopy,
  onEdit,
}: CellContextMenuProps) {
  const { t } = useI18n()
  const item =
    "hover:bg-accent/50 flex w-full items-center rounded px-2 py-1.5 text-left text-sm"

  return (
    <div
      data-cell-menu
      style={{ top: y, left: x }}
      className="bg-popover text-popover-foreground fixed z-50 min-w-44 rounded-md border p-1 shadow-md"
    >
      {onEdit ? (
        <>
          <button type="button" onClick={onEdit} className={item}>
            {t("docs.editValue")}
          </button>
          <div className="bg-border -mx-1 my-1 h-px" />
        </>
      ) : null}
      <button type="button" onClick={() => onCopy(formatValue(value))} className={item}>
        {t("docs.copyValue")}
      </button>
      <button
        type="button"
        onClick={() => onCopy(JSON.stringify(value, null, 2))}
        className={item}
      >
        {t("docs.copyValueJson")}
      </button>
      <button type="button" onClick={() => onCopy(column)} className={item}>
        {t("docs.copyField")}
      </button>
      <div className="bg-border -mx-1 my-1 h-px" />
      {"_id" in document ? (
        <button type="button" onClick={() => onCopy(prettyJSON(document._id))} className={item}>
          {t("docs.copyId")}
        </button>
      ) : null}
      <button type="button" onClick={() => onCopy(prettyJSON(document))} className={item}>
        {t("docs.copyDocument")}
      </button>
      <div className="bg-border -mx-1 my-1 h-px" />
      <button
        type="button"
        onClick={() => onCopy(prettyJSON({ $set: { [column]: value } }))}
        className={item}
      >
        {t("docs.copyAsSet")}
      </button>
    </div>
  )
}
