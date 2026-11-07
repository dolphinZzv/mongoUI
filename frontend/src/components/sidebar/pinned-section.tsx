import { Database, Filter, Pencil, PinOff, Plug, Table2 } from "lucide-react"

import { Input } from "@/components/ui/input"
import { collectionLabel, databaseLabel, useAliases } from "@/lib/aliases"
import { useI18n } from "@/lib/i18n"
import type { PinnedQuery } from "@/lib/pinnedQueries"
import type { Selection } from "@/lib/types"

export interface PinnedNavItem {
  key: string
  label: string
  title?: string
  kind: "connection" | "database" | "collection"
  onClick: () => void
}

interface PinnedSectionProps {
  items: PinnedNavItem[]
  queries: { query: PinnedQuery; connectionName: string }[]
  queryKey: (query: PinnedQuery) => string
  renamingKey: string | null
  renameValue: string
  onRenameValueChange: (value: string) => void
  onStartRename: (query: PinnedQuery) => void
  onCommitRename: (query: PinnedQuery) => void
  onCancelRename: () => void
  onRemoveQuery: (query: PinnedQuery) => void
  onOpenQuery: (selection: Selection, filter: string) => void
  onTogglePin: (key: string) => void
}

/** Pinned connections/databases/collections and pinned queries, above the tree. */
export function PinnedSection({
  items,
  queries,
  queryKey,
  renamingKey,
  renameValue,
  onRenameValueChange,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onRemoveQuery,
  onOpenQuery,
  onTogglePin,
}: PinnedSectionProps) {
  const { t } = useI18n()
  const aliases = useAliases()

  return (
    <>
      {items.length > 0 ? (
        <div className="mb-2 space-y-0.5 border-b pb-2">
          <p className="text-muted-foreground px-1 pb-1 text-[10px] tracking-wide uppercase">
            {t("sidebar.pinned")}
          </p>
          {items.map((item) => (
            <div
              key={item.key}
              className="group hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex items-center gap-1 rounded-md px-1 py-1"
            >
              {item.kind === "connection" ? (
                <Plug className="text-muted-foreground size-3.5 shrink-0" />
              ) : item.kind === "database" ? (
                <Database className="text-muted-foreground size-3.5 shrink-0" />
              ) : (
                <Table2 className="text-muted-foreground size-3.5 shrink-0" />
              )}
              <button
                type="button"
                onClick={item.onClick}
                data-testid={`pinned-${item.key}`}
                className="min-w-0 flex-1 truncate text-left text-sm"
                title={item.title ?? item.label}
              >
                {item.label}
              </button>
              <button
                type="button"
                onClick={() => onTogglePin(item.key)}
                aria-label={t("sidebar.unpin")}
                className="text-muted-foreground hover:text-foreground shrink-0 p-0.5 opacity-0 group-hover:opacity-100 max-md:opacity-100"
              >
                <PinOff className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {queries.length > 0 ? (
        <div className="mb-2 space-y-0.5 border-b pb-2">
          <p className="text-muted-foreground px-1 pb-1 text-[10px] tracking-wide uppercase">
            {t("sidebar.pinnedQueries")}
          </p>
          {queries.map(({ query, connectionName }) => {
            const key = queryKey(query)
            const actualLabel = `${connectionName} / ${query.database} / ${query.collection}`
            const defaultLabel = `${connectionName} / ${databaseLabel(aliases, query.connectionId, query.database)} / ${collectionLabel(aliases, query.connectionId, query.database, query.collection)}`
            const label = query.name?.trim() || defaultLabel
            return (
              <div
                key={key}
                className="group hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex items-center gap-1 rounded-md px-1 py-1"
              >
                <Filter className="text-muted-foreground size-3.5 shrink-0" />
                {renamingKey === key ? (
                  <Input
                    autoFocus
                    value={renameValue}
                    onChange={(event) => onRenameValueChange(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault()
                        onCommitRename(query)
                      } else if (event.key === "Escape") {
                        event.preventDefault()
                        onCancelRename()
                      }
                    }}
                    onBlur={() => onCommitRename(query)}
                    placeholder={t("sidebar.renameQuery")}
                    className="h-6 flex-1 text-xs"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      onOpenQuery(
                        {
                          kind: "collection",
                          connectionId: query.connectionId,
                          database: query.database,
                          collection: query.collection,
                        },
                        query.filter,
                      )
                    }
                    className="min-w-0 flex-1 text-left"
                    title={`${actualLabel}\n${query.filter}`}
                  >
                    <span className="block truncate text-sm">{label}</span>
                    <span className="text-muted-foreground block truncate font-mono text-[10px]">
                      {query.filter}
                    </span>
                  </button>
                )}
                {renamingKey !== key ? (
                  <>
                    <button
                      type="button"
                      onClick={() => onStartRename(query)}
                      aria-label={t("sidebar.renameQuery")}
                      title={t("sidebar.renameQuery")}
                      className="text-muted-foreground hover:text-foreground shrink-0 p-0.5 opacity-0 group-hover:opacity-100 max-md:opacity-100"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveQuery(query)}
                      aria-label={t("sidebar.removePinnedQuery")}
                      className="text-muted-foreground hover:text-foreground shrink-0 p-0.5 opacity-0 group-hover:opacity-100 max-md:opacity-100"
                    >
                      <PinOff className="size-3.5" />
                    </button>
                  </>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}
    </>
  )
}
