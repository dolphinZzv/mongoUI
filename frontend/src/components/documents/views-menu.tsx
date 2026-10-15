import { Bookmark, BookmarkPlus, Pin, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useI18n } from "@/lib/i18n"
import type { SavedView } from "@/lib/savedViews"

interface ViewsMenuProps {
  views: SavedView[]
  onSaveCurrent: () => void
  onApply: (view: SavedView) => void
  onPin: (view: SavedView) => void
  onDelete: (id: string) => void
}

/** Dropdown for saving, applying, pinning and deleting named views. */
export function ViewsMenu({ views, onSaveCurrent, onApply, onPin, onDelete }: ViewsMenuProps) {
  const { t } = useI18n()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" title={t("views.title")} aria-label={t("views.title")}>
          <Bookmark />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuItem onSelect={onSaveCurrent}>
          <BookmarkPlus /> {t("views.saveCurrent")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {views.length === 0 ? (
          <DropdownMenuItem disabled>{t("views.empty")}</DropdownMenuItem>
        ) : null}
        {views.map((view) => (
          <DropdownMenuItem
            key={view.id}
            onSelect={() => onApply(view)}
            className="font-mono text-xs"
          >
            <Bookmark className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate" title={`${view.name}\n${view.filter}`}>
              {view.name}
            </span>
            <button
              type="button"
              aria-label={t("views.pin")}
              title={t("views.pin")}
              className="text-muted-foreground hover:text-foreground shrink-0 rounded p-0.5"
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                event.preventDefault()
                onPin(view)
              }}
            >
              <Pin className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label={t("common.delete")}
              title={t("common.delete")}
              className="text-muted-foreground hover:text-foreground shrink-0 rounded p-0.5"
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                event.preventDefault()
                onDelete(view.id)
              }}
            >
              <Trash2 className="size-3.5" />
            </button>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
