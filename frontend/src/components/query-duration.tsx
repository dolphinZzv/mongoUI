import { Timer } from "lucide-react"

import { useI18n } from "@/lib/i18n"
import { cn, formatDuration } from "@/lib/utils"

/** Compact query timing badge shared by documents, SQL and aggregation. */
export function QueryDuration({ ms, className }: { ms?: number; className?: string }) {
  const { t } = useI18n()
  if (ms === undefined || !Number.isFinite(ms)) return null
  return (
    <span
      title={t("result.queryTime")}
      className={cn("text-muted-foreground inline-flex items-center gap-1 text-xs", className)}
    >
      <Timer className="size-3" />
      {formatDuration(ms)}
    </span>
  )
}
