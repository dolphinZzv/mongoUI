import * as React from "react"
import { Check, Layers3, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { collectionLabel, databaseLabel, useAliases } from "@/lib/aliases"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { CollectionTab } from "@/lib/collectionTabs"
import type { Connection } from "@/lib/types"

interface CollectionTabsProps {
  tabs: CollectionTab[]
  connections: Connection[]
  activeKey: string | null
  onActivate: (tab: CollectionTab) => void
  onClose: (tab: CollectionTab) => void
  onCloseAll: () => void
}

/** A horizontal strip of open collection tabs. */
export function CollectionTabs({
  tabs,
  connections,
  activeKey,
  onActivate,
  onClose,
  onCloseAll,
}: CollectionTabsProps) {
  const { t } = useI18n()
  const aliases = useAliases()
  const tabRefs = React.useRef(new Map<string, HTMLDivElement>())

  // Keep the active tab visible when it was opened from search, a shortcut or
  // the sidebar while the strip is scrolled to another part of the list.
  React.useEffect(() => {
    if (!activeKey) return
    tabRefs.current.get(activeKey)?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [activeKey, tabs.length])

  if (tabs.length === 0) return null

  const connectionByID = new Map(connections.map((connection) => [connection.id, connection]))
  const labels = new Map<string, number>()
  for (const tab of tabs) {
    const key = `${tab.database}::${tab.collection}`
    labels.set(key, (labels.get(key) ?? 0) + 1)
  }

  const labelFor = (tab: CollectionTab) => {
    const connection = connectionByID.get(tab.connectionId)
    const database = databaseLabel(aliases, tab.connectionId, tab.database)
    const collection = collectionLabel(aliases, tab.connectionId, tab.database, tab.collection)
    const duplicate = (labels.get(`${tab.database}::${tab.collection}`) ?? 0) > 1
    return { connection, database, collection, duplicate }
  }

  // A single open collection already has a large breadcrumb in the content
  // header; showing a second navigation strip only steals vertical space.
  if (tabs.length === 1) return null

  return (
    <div className="bg-muted/30 flex h-9 shrink-0 items-center gap-1 border-b px-1">
      <div className="scrollbar-thin flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const active = tab.key === activeKey
          const { connection, database: dbName, collection: colName, duplicate } = labelFor(tab)
          return (
            <div
              key={tab.key}
              ref={(node) => {
                if (node) tabRefs.current.set(tab.key, node)
                else tabRefs.current.delete(tab.key)
              }}
              className={cn(
                "group flex max-w-56 shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
                active
                  ? "bg-background border-border text-foreground shadow-xs"
                  : "text-muted-foreground hover:bg-background/60 border-transparent",
              )}
              onAuxClick={(event) => {
                if (event.button !== 1) return
                event.preventDefault()
                onClose(tab)
              }}
            >
              <span
                aria-hidden
                className="size-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: connection?.color || "var(--primary)" }}
              />
              <button
                type="button"
                onClick={() => onActivate(tab)}
                aria-current={active ? "page" : undefined}
                className="min-w-0 flex-1 truncate text-left"
                title={`${connection?.name ?? tab.connectionId} · ${tab.database} / ${tab.collection}`}
              >
                {duplicate && connection ? (
                  <span className="text-muted-foreground">{connection.name} · </span>
                ) : null}
                <span className="text-muted-foreground">{dbName}</span>
                <span className="text-muted-foreground"> / </span>
                <span className="font-medium">{colName}</span>
              </button>
              <button
                type="button"
                aria-label={t("tabs.close")}
                title={t("tabs.close")}
                onClick={() => onClose(tab)}
                className="hover:text-foreground shrink-0 rounded p-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
              >
                <X className="size-3" />
              </button>
            </div>
          )
        })}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0"
            title={t("tabs.all")}
            aria-label={t("tabs.all")}
          >
            <Layers3 />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-80 w-72 overflow-auto">
          <DropdownMenuLabel>{t("tabs.all")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {tabs.map((tab) => {
            const { connection, database, collection } = labelFor(tab)
            return (
              <DropdownMenuItem
                key={tab.key}
                onSelect={() => onActivate(tab)}
                className="gap-2"
              >
                <span
                  aria-hidden
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: connection?.color || "var(--primary)" }}
                />
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-muted-foreground">{connection?.name ?? tab.connectionId} · </span>
                  {database} / {collection}
                </span>
                {tab.key === activeKey ? <Check className="text-primary size-3.5 shrink-0" /> : null}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
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
    </div>
  )
}
