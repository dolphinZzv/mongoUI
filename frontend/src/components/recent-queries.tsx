import { History, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useI18n } from "@/lib/i18n"

interface RecentQueriesProps {
  items: string[]
  onPick: (query: string) => void
  onClear: () => void
  className?: string
}

/** A dropdown of recently executed queries. Renders nothing when empty. */
export function RecentQueries({ items, onPick, onClear, className }: RecentQueriesProps) {
  const { t } = useI18n()
  if (items.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className={className}
          title={t("recent.title")}
          aria-label={t("recent.title")}
        >
          <History />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-96">
        <DropdownMenuLabel>{t("recent.title")}</DropdownMenuLabel>
        {items.map((query, index) => (
          <DropdownMenuItem
            key={`${index}-${query}`}
            onSelect={() => onPick(query)}
            className="font-mono text-xs"
          >
            <span className="truncate" title={query}>
              {query.replace(/\s+/g, " ").slice(0, 120)}
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onClear}>
          <Trash2 /> {t("recent.clear")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
