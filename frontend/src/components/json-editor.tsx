import * as React from "react"

import { Textarea } from "@/components/ui/textarea"
import { highlightJson } from "@/lib/jsonHighlight"
import { cn } from "@/lib/utils"

export function validateJSON(value: string, { allowEmpty = true } = {}): string | null {
  const trimmed = value.trim()
  if (!trimmed) return allowEmpty ? null : "This field cannot be empty"
  try {
    JSON.parse(trimmed)
    return null
  } catch (err) {
    return err instanceof Error ? err.message : "Invalid JSON"
  }
}

export function formatJSONString(value: string, indent = 2): string {
  try {
    return JSON.stringify(JSON.parse(value), null, indent)
  } catch {
    return value
  }
}

interface JsonEditorProps extends Omit<React.ComponentProps<"textarea">, "value" | "onChange"> {
  value: string
  onChange: (value: string) => void
  allowEmpty?: boolean
  showError?: boolean
}

/**
 * A JSON textarea with syntax highlighting: a transparent <textarea> sits over
 * a highlighted <pre> and their scroll positions are kept in sync.
 */
export function JsonEditor({
  value,
  onChange,
  allowEmpty = true,
  showError = true,
  className,
  ...props
}: JsonEditorProps) {
  const error = validateJSON(value, { allowEmpty })
  const preRef = React.useRef<HTMLPreElement>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  const syncScroll = React.useCallback(() => {
    const pre = preRef.current
    const textarea = textareaRef.current
    if (!pre || !textarea) return
    pre.scrollTop = textarea.scrollTop
    pre.scrollLeft = textarea.scrollLeft
  }, [])

  const html = React.useMemo(() => highlightJson(value) + "\n", [value])

  return (
    <div className="space-y-1">
      <div
        className={cn(
          "focus-within:border-ring focus-within:ring-ring/50 relative min-h-[7rem] overflow-hidden rounded-md border shadow-xs transition-[color,box-shadow] focus-within:ring-[3px]",
          error && "border-destructive focus-within:ring-destructive/30",
        )}
      >
        <pre
          ref={preRef}
          aria-hidden="true"
          className="scrollbar-thin pointer-events-none absolute inset-0 m-0 overflow-auto p-3 font-mono text-xs leading-relaxed whitespace-pre"
        >
          <code dangerouslySetInnerHTML={{ __html: html }} />
        </pre>
        <Textarea
          ref={textareaRef}
          spellCheck={false}
          autoComplete="off"
          wrap="off"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onScroll={syncScroll}
          className={cn(
            "scrollbar-thin caret-foreground relative block resize-y overflow-auto border-0 bg-transparent p-3 font-mono text-xs leading-relaxed whitespace-pre text-transparent outline-none focus-visible:ring-0 md:text-xs dark:bg-transparent [field-sizing:fixed]",
            className,
          )}
          {...props}
        />
      </div>
      {showError && error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  )
}
