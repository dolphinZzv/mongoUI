import * as React from "react"
import {
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { AliasDialog } from "@/components/alias-dialog"
import { ConnectionTree } from "@/components/sidebar/connection-tree"
import { PinnedSection, type PinnedNavItem } from "@/components/sidebar/pinned-section"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { Input } from "@/components/ui/input"
import {
  CreateCollectionDialog,
  CreateDatabaseDialog,
} from "@/components/resource-dialogs"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api } from "@/lib/api"
import {
  collectionLabel,
  databaseLabel,
  useAliases,
  type AliasTarget,
} from "@/lib/aliases"
import { compileTextFilter } from "@/lib/filter"
import { useI18n } from "@/lib/i18n"
import { removePinnedQuery, renamePinnedQuery, usePinnedQueries, type PinnedQuery } from "@/lib/pinnedQueries"
import {
  connPin,
  dbKey,
  isSystemCollection,
  isSystemDatabase,
  pinnedFirst,
  readExpanded,
  readPinned,
  readShowSystemCollections,
  readShowSystemDatabases,
  writeExpanded,
  writePinned,
  writeShowSystemCollections,
  writeShowSystemDatabases,
} from "@/lib/sidebarPrefs"
import type { CollectionInfo, Connection, DatabaseInfo, Selection } from "@/lib/types"

interface AppSidebarProps {
  connections: Connection[]
  loading: boolean
  selection: Selection
  onSelect: (selection: Selection) => void
  /** Open a collection with a pinned filter applied. */
  onOpenQuery: (selection: Selection, filter: string) => void
  onNewConnection: () => void
  onEditConnection: (connection: Connection) => void
  onRefresh: () => void
}

type PendingConfirm =
  | { type: "drop-database"; connectionId: string; database: string }
  | { type: "drop-collection"; connectionId: string; database: string; collection: string }
  | { type: "delete-connection"; connection: Connection }
  | null

export function AppSidebar({
  connections,
  loading,
  selection,
  onSelect,
  onOpenQuery,
  onNewConnection,
  onEditConnection,
  onRefresh,
}: AppSidebarProps) {
  const { t } = useI18n()
  const [expandedConns, setExpandedConns] = React.useState<Record<string, boolean>>(
    () => readExpanded().conns,
  )
  const [databases, setDatabases] = React.useState<Record<string, DatabaseInfo[]>>({})
  const [loadingDbs, setLoadingDbs] = React.useState<Record<string, boolean>>({})
  const [expandedDbs, setExpandedDbs] = React.useState<Record<string, boolean>>(
    () => readExpanded().dbs,
  )
  const [collections, setCollections] = React.useState<Record<string, CollectionInfo[]>>({})
  const [loadingCols, setLoadingCols] = React.useState<Record<string, boolean>>({})
  // Remember which loads failed so the effects below do not retry them forever
  // (e.g. a 409 "connection is not active" after the user disconnects).
  const [failedDbs, setFailedDbs] = React.useState<Record<string, boolean>>({})
  const [failedCols, setFailedCols] = React.useState<Record<string, boolean>>({})
  const [busyConn, setBusyConn] = React.useState<Record<string, boolean>>({})
  const [filter, setFilter] = React.useState("")
  const aliases = useAliases()
  const [aliasTarget, setAliasTarget] = React.useState<AliasTarget | null>(null)
  const [pinned, setPinned] = React.useState<Set<string>>(() => readPinned())
  const [showSystemCollections, setShowSystemCollections] = React.useState(
    () => readShowSystemCollections(),
  )
  const [showSystemDatabases, setShowSystemDatabases] = React.useState(
    () => readShowSystemDatabases(),
  )

  const [dbDialogFor, setDbDialogFor] = React.useState<string | null>(null)
  const [colDialogFor, setColDialogFor] = React.useState<{ connectionId: string; database: string } | null>(null)
  const [confirm, setConfirm] = React.useState<PendingConfirm>(null)

  const loadDatabases = React.useCallback(async (connectionId: string) => {
    setLoadingDbs((prev) => ({ ...prev, [connectionId]: true }))
    try {
      const res = await api.listDatabases(connectionId)
      setDatabases((prev) => ({ ...prev, [connectionId]: res.databases }))
      setFailedDbs((prev) => {
        if (!prev[connectionId]) return prev
        const next = { ...prev }
        delete next[connectionId]
        return next
      })
    } catch (err) {
      setFailedDbs((prev) => ({ ...prev, [connectionId]: true }))
      toast.error(err instanceof Error ? err.message : t("sidebar.listDatabasesFailed"))
    } finally {
      setLoadingDbs((prev) => ({ ...prev, [connectionId]: false }))
    }
  }, [])

  const loadCollections = React.useCallback(async (connectionId: string, database: string) => {
    const key = dbKey(connectionId, database)
    setLoadingCols((prev) => ({ ...prev, [key]: true }))
    try {
      const res = await api.listCollections(connectionId, database)
      setCollections((prev) => ({ ...prev, [key]: res }))
      setFailedCols((prev) => {
        if (!prev[key]) return prev
        const next = { ...prev }
        delete next[key]
        return next
      })
    } catch (err) {
      setFailedCols((prev) => ({ ...prev, [key]: true }))
      toast.error(err instanceof Error ? err.message : t("sidebar.listCollectionsFailed"))
    } finally {
      setLoadingCols((prev) => ({ ...prev, [key]: false }))
    }
  }, [])

  const query = filter.trim()
  const filtering = query.length > 0
  const matches = React.useMemo(() => compileTextFilter(query), [query])

  // While filtering, make sure nested databases/collections are loaded so the
  // search covers the whole tree rather than only expanded branches.
  React.useEffect(() => {
    if (!filtering) return
    for (const connection of connections) {
      if (connection.connected && !failedDbs[connection.id] && !databases[connection.id] && !loadingDbs[connection.id]) {
        void loadDatabases(connection.id)
      }
    }
  }, [filtering, connections, databases, loadingDbs, failedDbs, loadDatabases])

  React.useEffect(() => {
    if (!filtering) return
    for (const connection of connections) {
      if (!connection.connected) continue
      const dbs = databases[connection.id]
      if (!dbs) continue
      for (const database of dbs) {
        const key = dbKey(connection.id, database.name)
        if (!failedCols[key] && !collections[key] && !loadingCols[key]) {
          void loadCollections(connection.id, database.name)
        }
      }
    }
  }, [filtering, connections, databases, collections, loadingCols, failedCols, loadCollections])

  // Load databases for expanded, connected connections.
  React.useEffect(() => {
    for (const connection of connections) {
      if (connection.connected && expandedConns[connection.id] && !failedDbs[connection.id] && !databases[connection.id] && !loadingDbs[connection.id]) {
        void loadDatabases(connection.id)
      }
    }
    // Drop cached data and failure flags of disconnected connections.
    const disconnected = connections.filter((c) => !c.connected).map((c) => c.id)
    const stale = Object.keys(databases).filter((id) => disconnected.includes(id))
    if (disconnected.length > 0) {
      setFailedDbs((prev) => {
        if (!disconnected.some((id) => prev[id])) return prev
        const next = { ...prev }
        for (const id of disconnected) delete next[id]
        return next
      })
      setFailedCols((prev) => {
        const doomed = Object.keys(prev).filter((key) =>
          disconnected.some((id) => key.startsWith(`${id}::`)),
        )
        if (doomed.length === 0) return prev
        const next = { ...prev }
        for (const key of doomed) delete next[key]
        return next
      })
    }
    if (stale.length > 0) {
      setDatabases((prev) => {
        const next = { ...prev }
        for (const id of stale) delete next[id]
        return next
      })
      setCollections((prev) => {
        const next = { ...prev }
        for (const key of Object.keys(next)) {
          if (stale.some((id) => key.startsWith(`${id}::`))) delete next[key]
        }
        return next
      })
    }
  }, [connections, expandedConns, databases, loadingDbs, failedDbs, loadDatabases])

  // Load collections for expanded databases, but only while their connection is
  // live; a disconnected connection must not keep retrying (and toasting).
  React.useEffect(() => {
    for (const [key, open] of Object.entries(expandedDbs)) {
      if (!open) continue
      if (failedCols[key] || collections[key] || loadingCols[key]) continue
      const [connectionId, database] = key.split("::")
      if (!connections.some((c) => c.id === connectionId && c.connected)) continue
      void loadCollections(connectionId, database)
    }
  }, [connections, expandedDbs, collections, loadingCols, failedCols, loadCollections])

  React.useEffect(() => {
    writeExpanded({ conns: expandedConns, dbs: expandedDbs })
  }, [expandedConns, expandedDbs])

  React.useEffect(() => {
    writePinned(pinned)
  }, [pinned])

  React.useEffect(() => {
    writeShowSystemCollections(showSystemCollections)
  }, [showSystemCollections])

  React.useEffect(() => {
    writeShowSystemDatabases(showSystemDatabases)
  }, [showSystemDatabases])

  const togglePin = React.useCallback((key: string) => {
    setPinned((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const handleConnect = async (connection: Connection) => {
    setBusyConn((prev) => ({ ...prev, [connection.id]: true }))
    try {
      await api.connect(connection.id)
      setExpandedConns((prev) => ({ ...prev, [connection.id]: true }))
      toast.success(t("sidebar.connected", { name: connection.name }))
      onRefresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("sidebar.connectFailed"))
      setExpandedConns((prev) => ({ ...prev, [connection.id]: false }))
    } finally {
      setBusyConn((prev) => ({ ...prev, [connection.id]: false }))
    }
  }

  // Restore a deep-linked collection: connect if needed, then expand the
  // connection and database so the tree reveals the selection.
  const autoConnectedRef = React.useRef<Set<string>>(new Set())
  const autoExpandedRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (selection.kind !== "collection") return
    const connection = connections.find((c) => c.id === selection.connectionId)
    if (!connection) return
    if (!connection.connected) {
      if (busyConn[connection.id] || autoConnectedRef.current.has(connection.id)) return
      autoConnectedRef.current.add(connection.id)
      void handleConnect(connection)
      return
    }
    const key = dbKey(selection.connectionId, selection.database)
    if (autoExpandedRef.current === key) return
    autoExpandedRef.current = key
    setExpandedConns((prev) => (prev[connection.id] ? prev : { ...prev, [connection.id]: true }))
    setExpandedDbs((prev) => (prev[key] ? prev : { ...prev, [key]: true }))
  }, [selection, connections, busyConn])

  const handleDisconnect = async (connection: Connection) => {
    setBusyConn((prev) => ({ ...prev, [connection.id]: true }))
    try {
      await api.disconnect(connection.id)
      setExpandedConns((prev) => ({ ...prev, [connection.id]: false }))
      toast.success(t("sidebar.disconnected", { name: connection.name }))
      onRefresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("sidebar.disconnectFailed"))
    } finally {
      setBusyConn((prev) => ({ ...prev, [connection.id]: false }))
    }
  }

  const toggleConnection = (connection: Connection) => {
    if (expandedConns[connection.id]) {
      setExpandedConns((prev) => ({ ...prev, [connection.id]: false }))
      return
    }
    onSelect({ kind: "connection", connectionId: connection.id })
    if (!connection.connected) {
      void handleConnect(connection)
    } else {
      setExpandedConns((prev) => ({ ...prev, [connection.id]: true }))
    }
  }

  const toggleDatabase = (connectionId: string, database: string) => {
    const key = dbKey(connectionId, database)
    setExpandedDbs((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const runConfirm = async () => {
    if (!confirm) return
    try {
      if (confirm.type === "drop-database") {
        await api.dropDatabase(confirm.connectionId, confirm.database)
        toast.success(t("sidebar.databaseDropped", { name: confirm.database }))
        await loadDatabases(confirm.connectionId)
        if (selection.kind === "collection" && selection.database === confirm.database) {
          onSelect({ kind: "connection", connectionId: confirm.connectionId })
        }
      } else if (confirm.type === "drop-collection") {
        await api.dropCollection(confirm.connectionId, confirm.database, confirm.collection)
        toast.success(t("sidebar.collectionDropped", { name: confirm.collection }))
        await loadCollections(confirm.connectionId, confirm.database)
        if (
          selection.kind === "collection" &&
          selection.collection === confirm.collection &&
          selection.database === confirm.database
        ) {
          onSelect({ kind: "connection", connectionId: confirm.connectionId })
        }
      } else if (confirm.type === "delete-connection") {
        await api.deleteConnection(confirm.connection.id)
        toast.success(t("sidebar.connectionRemoved"))
        setDatabases((prev) => {
          const next = { ...prev }
          delete next[confirm.connection.id]
          return next
        })
        if (selection.kind !== "welcome" && selection.connectionId === confirm.connection.id) {
          onSelect({ kind: "welcome" })
        }
        onRefresh()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("sidebar.operationFailed"))
    }
  }

  const confirmContent = React.useMemo(() => {
    if (!confirm) return null
    if (confirm.type === "drop-database") {
      return {
        title: t("sidebar.confirmDropDatabase", { name: confirm.database }),
        description: t("sidebar.confirmDropDatabaseDesc"),
        confirmLabel: t("sidebar.dropDatabase"),
        confirmText: confirm.database,
      }
    }
    if (confirm.type === "drop-collection") {
      return {
        title: t("sidebar.confirmDropCollection", { name: confirm.collection }),
        description: t("sidebar.confirmDropCollectionDesc"),
        confirmLabel: t("sidebar.dropCollection"),
        confirmText: confirm.collection,
      }
    }
    return {
      title: t("sidebar.confirmDeleteConnection", { name: confirm.connection.name }),
      description: t("sidebar.confirmDeleteConnectionDesc"),
      confirmLabel: t("common.delete"),
      confirmText: confirm.connection.name,
    }
  }, [confirm, t])

  const noMatches =
    filtering &&
    connections.every((connection) => {
      if (matches(connection.name)) return false
      const dbs = databases[connection.id] ?? []
      return !dbs.some((database) => {
        if (!showSystemDatabases && isSystemDatabase(database.name)) return false
        if (matches(database.name) || matches(databaseLabel(aliases, connection.id, database.name))) {
          return true
        }
        const key = dbKey(connection.id, database.name)
        return (collections[key] ?? []).some(
          (collection) =>
            (showSystemCollections || !isSystemCollection(collection.name)) &&
            (matches(collection.name) ||
              matches(collectionLabel(aliases, connection.id, database.name, collection.name))),
        )
      })
    })

  const orderedConnections = React.useMemo(
    () => pinnedFirst(connections, pinned, (c) => connPin(c.id)),
    [connections, pinned],
  )

  const pinnedItems = React.useMemo(() => {
    const items: PinnedNavItem[] = []
    for (const key of pinned) {
      if (key.startsWith("c:")) {
        const id = key.slice(2)
        const connection = connections.find((c) => c.id === id)
        if (!connection) continue
        items.push({
          key,
          label: connection.name,
          kind: "connection",
          onClick: () => onSelect({ kind: "connection", connectionId: id }),
        })
      } else if (key.startsWith("d:")) {
        const [connectionId, database] = key.slice(2).split("::")
        const connection = connections.find((c) => c.id === connectionId)
        if (!connection || !database) continue
        if (!showSystemDatabases && isSystemDatabase(database)) continue
        items.push({
          key,
          label: `${connection.name} / ${databaseLabel(aliases, connectionId, database)}`,
          title: `${connection.name} / ${database}`,
          kind: "database",
          onClick: () => {
            setExpandedConns((prev) => ({ ...prev, [connectionId]: true }))
            setExpandedDbs((prev) => ({ ...prev, [dbKey(connectionId, database)]: true }))
            onSelect({ kind: "connection", connectionId })
          },
        })
      } else if (key.startsWith("x:")) {
        const [connectionId, database, collection] = key.slice(2).split("::")
        const connection = connections.find((c) => c.id === connectionId)
        if (!connection || !database || !collection) continue
        if (!showSystemDatabases && isSystemDatabase(database)) continue
        if (!showSystemCollections && isSystemCollection(collection)) continue
        items.push({
          key,
          label: `${connection.name} / ${databaseLabel(aliases, connectionId, database)} / ${collectionLabel(aliases, connectionId, database, collection)}`,
          title: `${connection.name} / ${database} / ${collection}`,
          kind: "collection",
          onClick: () =>
            onSelect({ kind: "collection", connectionId, database, collection }),
        })
      }
    }
    return items
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinned, connections, onSelect, showSystemCollections, showSystemDatabases, aliases])

  const pinnedQueries = usePinnedQueries()
  const pinnedQueryItems = React.useMemo(
    () =>
      pinnedQueries.flatMap((query) => {
        if (!showSystemDatabases && isSystemDatabase(query.database)) return []
        const connection = connections.find((c) => c.id === query.connectionId)
        if (!connection) return []
        return [{ query, connectionName: connection.name }]
      }),
    [pinnedQueries, connections, showSystemDatabases, aliases],
  )

  const [renamingKey, setRenamingKey] = React.useState<string | null>(null)
  const [renameValue, setRenameValue] = React.useState("")
  const skipRenameCommit = React.useRef(false)

  const pinnedQueryKey = (query: PinnedQuery) =>
    `q:${query.connectionId}:${query.database}:${query.collection}:${query.filter}`

  const startRename = (query: PinnedQuery) => {
    skipRenameCommit.current = false
    setRenamingKey(pinnedQueryKey(query))
    setRenameValue(query.name ?? query.collection)
  }

  const commitRename = (query: PinnedQuery) => {
    setRenamingKey(null)
    if (skipRenameCommit.current) {
      skipRenameCommit.current = false
      return
    }
    renamePinnedQuery(query, renameValue)
  }

  return (
    <div className="bg-sidebar text-sidebar-foreground flex h-full min-h-0 flex-col border-r" data-testid="sidebar">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
        <div className="from-primary to-chart-2 flex size-7 items-center justify-center rounded-md bg-gradient-to-br text-xs font-bold text-white">
          M
        </div>
        <span className="font-semibold tracking-tight">MongoUI</span>
        <div className="ml-auto flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={onNewConnection} aria-label={t("app.newConnection")}>
                <Plus />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("app.newConnection")}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 border-b px-2 py-2">
        <div className="relative min-w-0 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t("sidebar.filter")}
            aria-label={t("sidebar.filterAria")}
            spellCheck={false}
            autoComplete="off"
            className="h-8 pr-7 pl-8 text-xs"
          />
          {filter ? (
            <button
              type="button"
              onClick={() => setFilter("")}
              aria-label={t("sidebar.clearFilter")}
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 rounded-sm p-0.5"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              title={t("sidebar.filterOptions")}
              aria-label={t("sidebar.filterOptions")}
            >
              <SlidersHorizontal />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 space-y-3">
            <div className="space-y-1">
              <p className="text-xs font-medium">{t("sidebar.filterSyntaxTitle")}</p>
              <p className="text-muted-foreground text-[11px] leading-relaxed">
                {t("sidebar.filterSyntax")}
              </p>
            </div>
            <div className="bg-border h-px" />
            <div className="flex items-center justify-between gap-3">
              <label
                htmlFor="sidebar-show-system-collections"
                className="cursor-pointer text-xs"
              >
                {t("sidebar.showSystemCollections")}
              </label>
              <Switch
                id="sidebar-show-system-collections"
                checked={showSystemCollections}
                onCheckedChange={setShowSystemCollections}
                aria-label={t("sidebar.showSystemCollections")}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <label
                htmlFor="sidebar-show-system-databases"
                className="cursor-pointer text-xs"
              >
                {t("sidebar.showSystemDatabases")}
              </label>
              <Switch
                id="sidebar-show-system-databases"
                checked={showSystemDatabases}
                onCheckedChange={setShowSystemDatabases}
                aria-label={t("sidebar.showSystemDatabases")}
              />
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-0.5 p-2">
          {!filtering && (pinnedItems.length > 0 || pinnedQueryItems.length > 0) ? (
            <PinnedSection
              items={pinnedItems}
              queries={pinnedQueryItems}
              queryKey={pinnedQueryKey}
              renamingKey={renamingKey}
              renameValue={renameValue}
              onRenameValueChange={setRenameValue}
              onStartRename={startRename}
              onCommitRename={commitRename}
              onCancelRename={() => {
                skipRenameCommit.current = true
                setRenamingKey(null)
              }}
              onRemoveQuery={removePinnedQuery}
              onOpenQuery={onOpenQuery}
              onTogglePin={togglePin}
            />
          ) : null}
          <ConnectionTree
            loading={loading}
            connections={connections}
            selection={selection}
            filter={filter}
            filtering={filtering}
            matches={matches}
            noMatches={noMatches}
            orderedConnections={orderedConnections}
            showSystemDatabases={showSystemDatabases}
            showSystemCollections={showSystemCollections}
            databases={databases}
            collections={collections}
            loadingDbs={loadingDbs}
            loadingCols={loadingCols}
            failedDbs={failedDbs}
            failedCols={failedCols}
            busyConn={busyConn}
            expandedConns={expandedConns}
            expandedDbs={expandedDbs}
            pinned={pinned}
            onSelect={onSelect}
            onNewConnection={onNewConnection}
            onEditConnection={onEditConnection}
            handleConnect={handleConnect}
            handleDisconnect={handleDisconnect}
            toggleConnection={toggleConnection}
            toggleDatabase={toggleDatabase}
            loadDatabases={loadDatabases}
            loadCollections={loadCollections}
            setFailedDbs={setFailedDbs}
            setFailedCols={setFailedCols}
            setDbDialogFor={setDbDialogFor}
            setColDialogFor={setColDialogFor}
            setAliasTarget={setAliasTarget}
            togglePin={togglePin}
            setConfirm={setConfirm}
          />
        </div>
      </ScrollArea>

      <div className="text-muted-foreground flex shrink-0 items-center justify-between border-t px-3 py-2 text-xs">
        <span className="flex items-center gap-1.5">
          {t(connections.length === 1 ? "sidebar.connections" : "sidebar.connections_plural", {
            count: connections.length,
          })}
          <span className="text-muted-foreground/60">·</span>
          <span title={t("sidebar.embeddedVersion")}>v{__APP_VERSION__}</span>
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              for (const connection of connections) {
                if (connection.connected && expandedConns[connection.id]) {
                  void loadDatabases(connection.id)
                }
              }
              for (const [key, open] of Object.entries(expandedDbs)) {
                if (!open) continue
                const [connectionId, database] = key.split("::")
                void loadCollections(connectionId, database)
              }
              onRefresh()
            }}
            title={t("common.refresh")}
          >
            <RefreshCw />
          </Button>
        </div>
      </div>

      <CreateDatabaseDialog
        open={dbDialogFor !== null}
        onOpenChange={(open) => !open && setDbDialogFor(null)}
        connectionId={dbDialogFor ?? ""}
        onCreated={() => {
          if (dbDialogFor) {
            void loadDatabases(dbDialogFor)
            setExpandedConns((prev) => ({ ...prev, [dbDialogFor]: true }))
          }
        }}
      />
      <CreateCollectionDialog
        open={colDialogFor !== null}
        onOpenChange={(open) => !open && setColDialogFor(null)}
        connectionId={colDialogFor?.connectionId ?? ""}
        database={colDialogFor?.database ?? ""}
        onCreated={() => {
          if (colDialogFor) {
            void loadCollections(colDialogFor.connectionId, colDialogFor.database)
            setExpandedDbs((prev) => ({
              ...prev,
              [dbKey(colDialogFor.connectionId, colDialogFor.database)]: true,
            }))
          }
        }}
      />
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirmContent?.title ?? ""}
        description={confirmContent?.description}
        confirmLabel={confirmContent?.confirmLabel}
        confirmText={confirmContent?.confirmText}
        onConfirm={runConfirm}
      />
      <AliasDialog
        target={aliasTarget}
        onOpenChange={(open) => {
          if (!open) setAliasTarget(null)
        }}
      />
    </div>
  )
}
