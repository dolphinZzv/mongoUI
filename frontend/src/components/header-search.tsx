import * as React from "react"
import { Database, Filter, Loader2, Search, Server, Table2 } from "lucide-react"

import { Input } from "@/components/ui/input"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { usePinnedQueries } from "@/lib/pinnedQueries"
import { dbKey } from "@/lib/sidebarPrefs"
import { cn } from "@/lib/utils"
import type { CollectionTab } from "@/lib/collectionTabs"
import type { CollectionInfo, Connection, DatabaseInfo, Selection } from "@/lib/types"

const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

interface HeaderSearchProps {
  connections: Connection[]
  tabs: CollectionTab[]
  onSelect: (selection: Selection) => void
  onOpenQuery: (selection: Selection, filter: string) => void
  onOpenGlobalSearch: (term?: string) => void
  onOpenPalette: () => void
}

interface SearchItem {
  id: string
  label: string
  hint?: string
  group: string
  icon: React.ReactNode
  run: () => void
}

/**
 * Header quick-search for navigating connections, databases and collections.
 * Metadata is loaded lazily the first time the user types, so opening the
 * search box stays cheap on connections with many databases.
 */
export function HeaderSearch({
  connections,
  tabs,
  onSelect,
  onOpenQuery,
  onOpenGlobalSearch,
  onOpenPalette,
}: HeaderSearchProps) {
  const { t } = useI18n()
  const pinnedQueries = usePinnedQueries()
  const [query, setQuery] = React.useState("")
  const [open, setOpen] = React.useState(false)
  const [active, setActive] = React.useState(0)
  const [databases, setDatabases] = React.useState<Record<string, DatabaseInfo[]>>({})
  const [failedDbs, setFailedDbs] = React.useState<Record<string, boolean>>({})
  const [collections, setCollections] = React.useState<Record<string, CollectionInfo[]>>({})
  const [failedCols, setFailedCols] = React.useState<Record<string, boolean>>({})
  const [loadingDbs, setLoadingDbs] = React.useState(false)
  const [loadingCols, setLoadingCols] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)

  const connectedIds = React.useMemo(
    () => connections.filter((connection) => connection.connected).map((connection) => connection.id),
    [connections],
  )

  const searching = open && query.trim().length > 0
  const loading = loadingDbs || loadingCols

  // Fetch databases only once the user starts typing. A connection that failed
  // is remembered so a broken server is not retried on every keystroke.
  React.useEffect(() => {
    if (!searching) {
      setLoadingDbs(false)
      return
    }
    let cancelled = false
    const missing = connectedIds.filter(
      (id) => databases[id] === undefined && !failedDbs[id],
    )
    if (missing.length === 0) {
      setLoadingDbs(false)
      return
    }
    setLoadingDbs(true)
    void (async () => {
      const results = await Promise.all(
        missing.map(async (id) => {
          try {
            const res = await api.listDatabases(id)
            return { id, databases: res.databases, failed: false as const }
          } catch {
            return { id, databases: null, failed: true as const }
          }
        }),
      )
      if (cancelled) return
      setDatabases((prev) => {
        const next = { ...prev }
        for (const result of results) {
          if (result.databases) next[result.id] = result.databases
        }
        return next
      })
      setFailedDbs((prev) => {
        const next = { ...prev }
        for (const result of results) {
          if (result.failed) next[result.id] = true
        }
        return next
      })
      setLoadingDbs(false)
    })()
    return () => {
      cancelled = true
    }
  }, [searching, connectedIds, databases, failedDbs])

  // Collections are fetched after their database list is available.
  React.useEffect(() => {
    if (!searching) {
      setLoadingCols(false)
      return
    }
    let cancelled = false
    const pending: { key: string; connectionId: string; database: string }[] = []
    for (const connectionId of connectedIds) {
      for (const database of databases[connectionId] ?? []) {
        const key = dbKey(connectionId, database.name)
        if (collections[key] === undefined && !failedCols[key]) {
          pending.push({ key, connectionId, database: database.name })
        }
      }
    }
    if (pending.length === 0) {
      setLoadingCols(false)
      return
    }
    setLoadingCols(true)
    void (async () => {
      const results = await Promise.all(
        pending.map(async (entry) => {
          try {
            const res = await api.listCollections(entry.connectionId, entry.database)
            return { key: entry.key, collections: res, failed: false as const }
          } catch {
            return { key: entry.key, collections: null, failed: true as const }
          }
        }),
      )
      if (cancelled) return
      setCollections((prev) => {
        const next = { ...prev }
        for (const result of results) {
          if (result.collections) next[result.key] = result.collections
        }
        return next
      })
      setFailedCols((prev) => {
        const next = { ...prev }
        for (const result of results) {
          if (result.failed) next[result.key] = true
        }
        return next
      })
      setLoadingCols(false)
    })()
    return () => {
      cancelled = true
    }
  }, [searching, connectedIds, databases, collections, failedCols])

  const close = React.useCallback(() => {
    setOpen(false)
    setQuery("")
    setActive(0)
    inputRef.current?.blur()
  }, [])

  const items = React.useMemo<SearchItem[]>(() => {
    const needle = query.trim().toLowerCase()
    const matches = (...values: (string | undefined)[]) =>
      !needle || values.some((value) => value?.toLowerCase().includes(needle))
    const connectionName = (id: string) =>
      connections.find((connection) => connection.id === id)?.name ?? id
    const groups = {
      navigation: t("headerSearch.navigation"),
      tabs: t("headerSearch.tabs"),
      queries: t("sidebar.pinnedQueries"),
      collections: t("headerSearch.collections"),
      actions: t("headerSearch.actions"),
    }
    const next: SearchItem[] = []

    for (const connection of connections) {
      if (!matches(connection.name, connection.uri)) continue
      next.push({
        id: `conn:${connection.id}`,
        label: connection.name,
        hint: t("palette.connection"),
        group: groups.navigation,
        icon: <Server />,
        run: () => {
          close()
          onSelect({ kind: "connection", connectionId: connection.id })
        },
      })
    }

    for (const tab of tabs) {
      if (!matches(tab.collection, tab.database, connectionName(tab.connectionId))) continue
      next.push({
        id: `tab:${tab.key}`,
        label: tab.collection,
        hint: `${connectionName(tab.connectionId)} / ${tab.database}`,
        group: groups.tabs,
        icon: <Table2 />,
        run: () => {
          close()
          onSelect({
            kind: "collection",
            connectionId: tab.connectionId,
            database: tab.database,
            collection: tab.collection,
          })
        },
      })
    }

    for (const pinned of pinnedQueries) {
      const connection = connections.find((entry) => entry.id === pinned.connectionId)
      if (!connection) continue
      const label = pinned.name?.trim() || pinned.collection
      if (!matches(label, pinned.collection, pinned.database, connection.name, pinned.filter)) {
        continue
      }
      next.push({
        id: `query:${pinned.connectionId}:${pinned.database}:${pinned.collection}:${pinned.filter}`,
        label,
        hint: `${connection.name} / ${pinned.database} / ${pinned.collection}`,
        group: groups.queries,
        icon: <Filter />,
        run: () => {
          close()
          onOpenQuery(
            {
              kind: "collection",
              connectionId: pinned.connectionId,
              database: pinned.database,
              collection: pinned.collection,
            },
            pinned.filter,
          )
        },
      })
    }

    const collectionItems: SearchItem[] = []
    for (const connection of connections) {
      if (!connection.connected) continue
      for (const database of databases[connection.id] ?? []) {
        for (const collection of collections[dbKey(connection.id, database.name)] ?? []) {
          if (!matches(collection.name, database.name, connection.name)) continue
          collectionItems.push({
            id: `col:${connection.id}:${database.name}:${collection.name}`,
            label: collection.name,
            hint: `${connection.name} / ${database.name}`,
            group: groups.collections,
            icon: <Table2 />,
            run: () => {
              close()
              onSelect({
                kind: "collection",
                connectionId: connection.id,
                database: database.name,
                collection: collection.name,
              })
            },
          })
        }
      }
    }
    next.push(...collectionItems.slice(0, 40))

    if (needle) {
      next.push({
        id: "global-search",
        label: t("headerSearch.globalSearch", { term: query.trim() }),
        hint: t("search.title"),
        group: groups.actions,
        icon: <Database />,
        run: () => {
          close()
          onOpenGlobalSearch(query.trim())
        },
      })
    }
    next.push({
      id: "command-palette",
      label: t("headerSearch.commandPalette"),
      hint: IS_MAC ? "⌘K" : "Ctrl K",
      group: groups.actions,
      icon: <Search />,
      run: () => {
        close()
        onOpenPalette()
      },
    })

    return next
  }, [
    query,
    connections,
    tabs,
    pinnedQueries,
    databases,
    collections,
    t,
    close,
    onSelect,
    onOpenQuery,
    onOpenGlobalSearch,
    onOpenPalette,
  ])

  React.useEffect(() => {
    setActive((prev) => Math.min(Math.max(prev, 0), Math.max(items.length - 1, 0)))
  }, [items.length])

  React.useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-search-index="${active}"]`)
    node?.scrollIntoView({ block: "nearest" })
  }, [active, items])

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setOpen(true)
      setActive((prev) => (items.length ? (prev + 1) % items.length : 0))
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setOpen(true)
      setActive((prev) => (items.length ? (prev - 1 + items.length) % items.length : 0))
    } else if (event.key === "Enter") {
      event.preventDefault()
      const item = items[active]
      if (item) item.run()
      else if (query.trim()) {
        const term = query.trim()
        close()
        onOpenGlobalSearch(term)
      }
    } else if (event.key === "Escape") {
      event.preventDefault()
      close()
    }
  }

  let lastGroup = ""

  return (
    <Popover open={open} onOpenChange={(next) => (next ? setOpen(true) : setOpen(false))}>
      <PopoverAnchor asChild>
        <div className="relative hidden lg:block">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setOpen(true)
              setActive(0)
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder={t("headerSearch.placeholder")}
            aria-label={t("headerSearch.placeholder")}
            role="combobox"
            aria-expanded={open}
            aria-controls="header-search-results"
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
            className="h-8 w-44 pr-3 pl-8 text-xs xl:w-56 2xl:w-64"
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-[min(32rem,calc(100vw-2rem))] gap-0 overflow-hidden p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div
          ref={listRef}
          id="header-search-results"
          role="listbox"
          className="scrollbar-thin max-h-[min(60vh,28rem)] overflow-auto p-1"
        >
          {items.length === 0 && !loading ? (
            <p className="text-muted-foreground px-2 py-6 text-center text-sm">
              {t("headerSearch.empty")}
            </p>
          ) : null}
          {items.map((item, index) => {
            const showGroup = item.group !== lastGroup
            lastGroup = item.group
            return (
              <React.Fragment key={item.id}>
                {showGroup ? (
                  <p className="text-muted-foreground px-2 pt-3 pb-1 text-[10px] tracking-wide uppercase">
                    {item.group}
                  </p>
                ) : null}
                <button
                  type="button"
                  data-search-index={index}
                  role="option"
                  aria-selected={index === active}
                  onMouseEnter={() => setActive(index)}
                  onClick={item.run}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm",
                    index === active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
                  )}
                >
                  <span className="text-muted-foreground [&_svg]:size-4">{item.icon}</span>
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.hint ? (
                    <span className="text-muted-foreground max-w-[45%] truncate font-mono text-[11px]">
                      {item.hint}
                    </span>
                  ) : null}
                </button>
              </React.Fragment>
            )
          })}
        </div>
        <div className="bg-muted/30 text-muted-foreground flex items-center gap-3 border-t px-3 py-2 text-[11px]">
          <span className="flex items-center gap-1">
            <kbd className="rounded border px-1 py-0.5 font-mono">↑</kbd>
            <kbd className="rounded border px-1 py-0.5 font-mono">↓</kbd>
            {t("palette.navigate")}
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border px-1 py-0.5 font-mono">↵</kbd>
            {t("palette.run")}
          </span>
          {loading ? (
            <span className="ml-auto flex items-center gap-1">
              <Loader2 className="size-3 animate-spin" />
              {t("headerSearch.searching")}
            </span>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}
