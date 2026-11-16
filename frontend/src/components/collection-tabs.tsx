import * as React from "react"
import { createPortal } from "react-dom"
import { Check, Layers3, Pin, PinOff, X } from "lucide-react"

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
  dirtyKeys: Set<string>
  onActivate: (tab: CollectionTab) => void
  onClose: (tab: CollectionTab) => void
  onCloseAll: () => void
  onCloseOthers: (tab: CollectionTab) => void
  onCloseLeft: (tab: CollectionTab) => void
  onCloseRight: (tab: CollectionTab) => void
  onReorder: (sourceKey: string, targetKey: string, position: "before" | "after") => void
  onTogglePin: (tab: CollectionTab) => void
}

/** A horizontal strip of open collection tabs. */
export function CollectionTabs({
  tabs,
  connections,
  activeKey,
  dirtyKeys,
  onActivate,
  onClose,
  onCloseAll,
  onCloseOthers,
  onCloseLeft,
  onCloseRight,
  onReorder,
  onTogglePin,
}: CollectionTabsProps) {
  const { t } = useI18n()
  const aliases = useAliases()
  const tabRefs = React.useRef(new Map<string, HTMLDivElement>())
  const [dragKey, setDragKey] = React.useState<string | null>(null)
  const [dropTarget, setDropTarget] = React.useState<{
    key: string
    position: "before" | "after"
  } | null>(null)
  const [menu, setMenu] = React.useState<{
    x: number
    y: number
    tab: CollectionTab
  } | null>(null)

  React.useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close()
    }
    window.addEventListener("pointerdown", close)
    window.addEventListener("keydown", onKey)
    window.addEventListener("scroll", close, true)
    return () => {
      window.removeEventListener("pointerdown", close)
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("scroll", close, true)
    }
  }, [menu])

  // Keep the active tab visible when it was opened from search, a shortcut or
  // the sidebar while the strip is scrolled to another part of the list.
  React.useEffect(() => {
    if (!activeKey) return
    tabRefs.current.get(activeKey)?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [activeKey, tabs.length])

  if (tabs.length === 0) return null

  const connectionByID = new Map(connections.map((connection) => [connection.id, connection]))
  const dragTab = dragKey ? tabs.find((tab) => tab.key === dragKey) : undefined
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
              draggable
              onDragStart={(event) => {
                setDragKey(tab.key)
                event.dataTransfer.effectAllowed = "move"
                event.dataTransfer.setData("text/plain", tab.key)
              }}
              onDragEnd={() => {
                setDragKey(null)
                setDropTarget(null)
              }}
              onDragOver={(event) => {
                if (!dragKey || dragKey === tab.key) return
                if (Boolean(dragTab?.pinned) !== Boolean(tab.pinned)) return
                event.preventDefault()
                event.dataTransfer.dropEffect = "move"
                const rect = event.currentTarget.getBoundingClientRect()
                setDropTarget({
                  key: tab.key,
                  position: event.clientX < rect.left + rect.width / 2 ? "before" : "after",
                })
              }}
              onDragLeave={(event) => {
                if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
                setDropTarget((current) => (current?.key === tab.key ? null : current))
              }}
              onDrop={(event) => {
                event.preventDefault()
                if (dragKey && dropTarget?.key === tab.key) {
                  onReorder(dragKey, tab.key, dropTarget.position)
                }
                setDragKey(null)
                setDropTarget(null)
              }}
              onContextMenu={(event) => {
                event.preventDefault()
                setMenu({
                  x: Math.min(event.clientX, window.innerWidth - 208),
                  y: Math.min(event.clientY, window.innerHeight - 190),
                  tab,
                })
              }}
              onAuxClick={(event) => {
                if (event.button !== 1) return
                event.preventDefault()
                onClose(tab)
              }}
              data-dragging={dragKey === tab.key ? "true" : undefined}
              className={cn(
                "group relative flex max-w-56 shrink-0 cursor-grab items-center gap-1.5 rounded-md border px-2 py-1 text-xs active:cursor-grabbing",
                active
                  ? "bg-background border-border text-foreground shadow-xs"
                  : "text-muted-foreground hover:bg-background/60 border-transparent",
                dragKey === tab.key && "opacity-40",
              )}
            >
              {dropTarget?.key === tab.key ? (
                <span
                  aria-hidden
                  className={cn(
                    "bg-primary absolute inset-y-0 z-10 w-0.5 rounded",
                    dropTarget.position === "before" ? "-left-1" : "-right-1",
                  )}
                />
              ) : null}
              <span
                aria-hidden
                className="size-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: connection?.color || "var(--primary)" }}
              />
              {tab.pinned ? (
                <Pin className="text-muted-foreground size-3 shrink-0" aria-hidden />
              ) : null}
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
              {dirtyKeys.has(tab.key) ? (
                <span
                  aria-label={t("tabs.unapplied")}
                  title={t("tabs.unapplied")}
                  className="size-1.5 shrink-0 rounded-full bg-amber-500"
                />
              ) : null}
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
      {menu
        ? createPortal(
            <div
              role="menu"
              data-testid="tab-context-menu"
              className="bg-popover text-popover-foreground fixed z-50 min-w-48 rounded-md border p-1 shadow-md"
              style={{ left: menu.x, top: menu.y }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                role="menuitem"
                className="hover:bg-accent flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm"
                onClick={() => {
                  onTogglePin(menu.tab)
                  setMenu(null)
                }}
              >
                {menu.tab.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                {menu.tab.pinned ? t("tabs.unpin") : t("tabs.pin")}
              </button>
              <div className="bg-border my-1 h-px" />
              <button
                type="button"
                role="menuitem"
                className="hover:bg-accent flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm"
                onClick={() => {
                  onClose(menu.tab)
                  setMenu(null)
                }}
              >
                {t("tabs.close")}
              </button>
              <button
                type="button"
                role="menuitem"
                className="hover:bg-accent flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm"
                disabled={tabs.length <= 1}
                onClick={() => {
                  onCloseOthers(menu.tab)
                  setMenu(null)
                }}
              >
                {t("tabs.closeOthers")}
              </button>
              <button
                type="button"
                role="menuitem"
                className="hover:bg-accent flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm disabled:opacity-40"
                disabled={tabs.findIndex((tab) => tab.key === menu.tab.key) <= 0}
                onClick={() => {
                  onCloseLeft(menu.tab)
                  setMenu(null)
                }}
              >
                {t("tabs.closeLeft")}
              </button>
              <button
                type="button"
                role="menuitem"
                className="hover:bg-accent flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm disabled:opacity-40"
                disabled={
                  tabs.findIndex((tab) => tab.key === menu.tab.key) >= tabs.length - 1
                }
                onClick={() => {
                  onCloseRight(menu.tab)
                  setMenu(null)
                }}
              >
                {t("tabs.closeRight")}
              </button>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
