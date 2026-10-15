import { X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { CollectionTab } from "@/lib/collectionTabs"

interface CollectionTabsProps {
  tabs: CollectionTab[]
  activeKey: string | null
  onActivate: (tab: CollectionTab) => void
  onClose: (tab: CollectionTab) => void
  onCloseAll: () => void
}

/** A horizontal strip of open collection tabs. */
export function CollectionTabs({
  tabs,
  activeKey,
  onActivate,
  onClose,
  onCloseAll,
}: CollectionTabsProps) {
  const { t } = useI18n()
  if (tabs.length === 0) return null

  return (
    <div className="bg-muted/30 flex h-9 shrink-0 items-center gap-1 border-b px-1">
      <div className="scrollbar-thin flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const active = tab.key === activeKey
          return (
            <div
              key={tab.key}
              className={cn(
                "group flex max-w-56 shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs",
                active
                  ? "bg-background border-border text-foreground shadow-xs"
                  : "text-muted-foreground hover:bg-background/60 border-transparent",
              )}
            >
              <button
                type="button"
                onClick={() => onActivate(tab)}
                aria-current={active ? "page" : undefined}
                className="min-w-0 flex-1 truncate text-left"
                title={`${tab.database} / ${tab.collection}`}
              >
                <span className="text-muted-foreground">{tab.database}</span>
                <span className="text-muted-foreground"> / </span>
                <span className="font-medium">{tab.collection}</span>
              </button>
              <button
                type="button"
                aria-label={t("tabs.close")}
                title={t("tabs.close")}
                onClick={() => onClose(tab)}
                className="hover:text-foreground shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100"
              >
                <X className="size-3" />
              </button>
            </div>
          )
        })}
      </div>
      {tabs.length > 1 ? (
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          title={t("tabs.closeAll")}
          aria-label={t("tabs.closeAll")}
          onClick={onCloseAll}
        >
          <X />
        </Button>
      ) : null}
    </div>
  )
}
