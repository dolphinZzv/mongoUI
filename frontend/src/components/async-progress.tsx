import { Loader2 } from "lucide-react"

import { useI18n } from "@/lib/i18n"
import { useElapsed } from "@/lib/useElapsed"
import { cn } from "@/lib/utils"

interface AsyncProgressProps {
  active: boolean
  /** Overrides the default "Working…" label. */
  label?: string
  /** Known total, enabling a determinate bar when combined with `processed`. */
  total?: number | null
  /** Number of items processed so far (requires `total`). */
  processed?: number | null
  className?: string
}

/**
 * A compact progress indicator for long-running operations. Shows an animated
 * determinate bar when a total is known, otherwise an indeterminate sweep, and
 * always counts elapsed seconds so the user can tell it has not stalled.
 */
export function AsyncProgress({
  active,
  label,
  total,
  processed,
  className,
}: AsyncProgressProps) {
  const { t } = useI18n()
  const seconds = useElapsed(active)

  if (!active) return null

  const determinate = typeof total === "number" && total > 0 && typeof processed === "number"
  const percent = determinate ? Math.min(100, Math.round((processed / total) * 100)) : null

  return (
    <div className={cn("space-y-1.5", className)} role="status" aria-live="polite">
      <div className="text-muted-foreground flex items-center gap-2 text-xs">
        <Loader2 className="size-3.5 shrink-0 animate-spin" />
        <span className="truncate">{label ?? t("common.working")}</span>
        <span className="ml-auto shrink-0 font-mono tabular-nums">
          {percent !== null ? `${percent}% · ` : ""}
          {seconds}s
        </span>
      </div>
      <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
        {determinate ? (
          <div
            className="bg-primary h-full rounded-full transition-[width] duration-300"
            style={{ width: `${percent}%` }}
          />
        ) : (
          <div className="bg-primary/70 h-full w-1/3 animate-[progress-inline_1.2s_ease-in-out_infinite] rounded-full" />
        )}
      </div>
    </div>
  )
}
