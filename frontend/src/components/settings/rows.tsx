import * as React from "react"
import { ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"

/** Label + control row used by the settings panels. */
export function SettingRow({
  title,
  description,
  control,
}: {
  title: string
  description?: string
  control: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium">{title}</p>
        {description ? <p className="text-muted-foreground text-xs">{description}</p> : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  )
}

/** Clickable row that opens a nested dialog. */
export function ActionRow({
  icon,
  title,
  description,
  onClick,
  destructive = false,
}: {
  icon: React.ReactNode
  title: string
  description?: string
  onClick: () => void
  destructive?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "hover:bg-accent/50 flex w-full items-center gap-3 px-4 py-3 text-left transition-colors",
        destructive && "text-destructive",
      )}
    >
      <span className="text-muted-foreground shrink-0 [&_svg]:size-4">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        {description ? (
          <span className="text-muted-foreground block text-xs">{description}</span>
        ) : null}
      </span>
      <ChevronRight className="text-muted-foreground size-4 shrink-0" />
    </button>
  )
}
