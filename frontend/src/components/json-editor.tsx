import * as React from "react"

import { Textarea } from "@/components/ui/textarea"
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

export function JsonEditor({
  value,
  onChange,
  allowEmpty = true,
  showError = true,
  className,
  ...props
}: JsonEditorProps) {
  const error = validateJSON(value, { allowEmpty })
  return (
    <div className="space-y-1">
      <Textarea
        spellCheck={false}
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          "scrollbar-thin min-h-[7rem] resize-y rounded-md font-mono text-xs leading-relaxed",
          error && "border-destructive focus-visible:ring-destructive/30",
          className,
        )}
        {...props}
      />
      {showError && error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  )
}
