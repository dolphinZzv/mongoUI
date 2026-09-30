import { History, Star, Trash2 } from "lucide-react"

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
import { cn } from "@/lib/utils"

interface RecentQueriesProps {
  items: string[]
  favorites?: string[]
  onPick: (query: string) => void
  onClear: () => void
  onToggleFavorite?: (query: string) => void
  onRemoveFavorite?: (query: string) => void
  className?: string
}

function shorten(query: string) {
  return query.replace(/\s+/g, " ").slice(0, 120)
}

/** A dropdown of favourite and recently executed queries. */
export function RecentQueries({
  items,
  favorites = [],
  onPick,
  onClear,
  onToggleFavorite,
  onRemoveFavorite,
  className,
}: RecentQueriesProps) {
  const { t } = useI18n()
  if (items.length === 0 && favorites.length === 0) return null

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
        {favorites.length > 0 ? (
          <>
            <DropdownMenuLabel>{t("recent.favorites")}</DropdownMenuLabel>
            {favorites.map((query, index) => (
              <DropdownMenuItem
                key={`fav-${index}-${query}`}
                onSelect={() => onPick(query)}
                className="font-mono text-xs"
              >
                <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-400" />
                <span className="truncate" title={query}>
                  {shorten(query)}
                </span>
                <button
                  type="button"
                  aria-label={t("recent.removeFavorite")}
                  title={t("recent.removeFavorite")}
                  className="text-muted-foreground hover:text-foreground ml-auto shrink-0 rounded p-0.5"
                  onPointerDown={(event) => event.stopPropagation()}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    event.preventDefault()
                    onRemoveFavorite?.(query)
                  }}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuLabel>{t("recent.title")}</DropdownMenuLabel>
        {items.length === 0 ? (
          <DropdownMenuItem disabled className="text-xs">
            {t("recent.empty")}
          </DropdownMenuItem>
        ) : (
          items.map((query, index) => (
            <DropdownMenuItem
              key={`${index}-${query}`}
              onSelect={() => onPick(query)}
              className="font-mono text-xs"
            >
              <span className="truncate" title={query}>
                {shorten(query)}
              </span>
              {onToggleFavorite ? (
                <button
                  type="button"
                  aria-label={t("recent.addFavorite")}
                  title={t("recent.addFavorite")}
                  className="text-muted-foreground hover:text-foreground ml-auto shrink-0 rounded p-0.5"
                  onPointerDown={(event) => event.stopPropagation()}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    event.preventDefault()
                    onToggleFavorite(query)
                  }}
                >
                  <Star
                    className={cn(
                      "size-3.5",
                      favorites.includes(query) && "fill-amber-400 text-amber-400",
                    )}
                  />
                </button>
              ) : null}
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onClear}>
          <Trash2 /> {t("recent.clear")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
