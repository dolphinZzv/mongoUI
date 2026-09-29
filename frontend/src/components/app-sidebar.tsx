import * as React from "react"
import {
  ChevronRight,
  Database,
  Ellipsis,
  Loader2,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Table2,
  Trash2,
  Unplug,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { Input } from "@/components/ui/input"
import {
  CreateCollectionDialog,
  CreateDatabaseDialog,
} from "@/components/resource-dialogs"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { CollectionInfo, Connection, DatabaseInfo, Selection } from "@/lib/types"

interface AppSidebarProps {
  connections: Connection[]
  loading: boolean
  selection: Selection
  onSelect: (selection: Selection) => void
  onNewConnection: () => void
  onEditConnection: (connection: Connection) => void
  onRefresh: () => void
}

type PendingConfirm =
  | { type: "drop-database"; connectionId: string; database: string }
  | { type: "drop-collection"; connectionId: string; database: string; collection: string }
  | { type: "delete-connection"; connection: Connection }
  | null

const dbKey = (connectionId: string, database: string) => `${connectionId}::${database}`

// Sidebar expansion is remembered so a refresh keeps the tree open.
const EXPANDED_KEY = "mongoui-sidebar-expanded"

interface ExpandedState {
  conns: Record<string, boolean>
  dbs: Record<string, boolean>
}

function readExpanded(): ExpandedState {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY)
    if (!raw) return { conns: {}, dbs: {} }
    const parsed = JSON.parse(raw) as Partial<ExpandedState>
    return { conns: parsed.conns ?? {}, dbs: parsed.dbs ?? {} }
  } catch {
    return { conns: {}, dbs: {} }
  }
}

export function AppSidebar({
  connections,
  loading,
  selection,
  onSelect,
  onNewConnection,
  onEditConnection,
  onRefresh,
}: AppSidebarProps) {
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
  const [busyConn, setBusyConn] = React.useState<Record<string, boolean>>({})
  const [filter, setFilter] = React.useState("")

  const [dbDialogFor, setDbDialogFor] = React.useState<string | null>(null)
  const [colDialogFor, setColDialogFor] = React.useState<{ connectionId: string; database: string } | null>(null)
  const [confirm, setConfirm] = React.useState<PendingConfirm>(null)

  const loadDatabases = React.useCallback(async (connectionId: string) => {
    setLoadingDbs((prev) => ({ ...prev, [connectionId]: true }))
    try {
      const res = await api.listDatabases(connectionId)
      setDatabases((prev) => ({ ...prev, [connectionId]: res.databases }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to list databases")
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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to list collections")
    } finally {
      setLoadingCols((prev) => ({ ...prev, [key]: false }))
    }
  }, [])

  const query = filter.trim().toLowerCase()
  const filtering = query.length > 0
  const matches = (value: string) => value.toLowerCase().includes(query)

  // While filtering, make sure nested databases/collections are loaded so the
  // search covers the whole tree rather than only expanded branches.
  React.useEffect(() => {
    if (!filtering) return
    for (const connection of connections) {
      if (connection.connected && !databases[connection.id] && !loadingDbs[connection.id]) {
        void loadDatabases(connection.id)
      }
    }
  }, [filtering, connections, databases, loadingDbs, loadDatabases])

  React.useEffect(() => {
    if (!filtering) return
    for (const connection of connections) {
      const dbs = databases[connection.id]
      if (!dbs) continue
      for (const database of dbs) {
        const key = dbKey(connection.id, database.name)
        if (!collections[key] && !loadingCols[key]) {
          void loadCollections(connection.id, database.name)
        }
      }
    }
  }, [filtering, connections, databases, collections, loadingCols, loadCollections])

  // Load databases for expanded, connected connections.
  React.useEffect(() => {
    for (const connection of connections) {
      if (connection.connected && expandedConns[connection.id] && !databases[connection.id] && !loadingDbs[connection.id]) {
        void loadDatabases(connection.id)
      }
    }
    // Drop cached data of disconnected connections.
    const stale = Object.keys(databases).filter(
      (id) => !connections.some((c) => c.id === id && c.connected),
    )
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
  }, [connections, expandedConns, databases, loadingDbs, loadDatabases])

  // Load collections for expanded databases.
  React.useEffect(() => {
    for (const [key, open] of Object.entries(expandedDbs)) {
      if (!open) continue
      if (collections[key] || loadingCols[key]) continue
      const [connectionId, database] = key.split("::")
      void loadCollections(connectionId, database)
    }
  }, [expandedDbs, collections, loadingCols, loadCollections])

  React.useEffect(() => {
    try {
      localStorage.setItem(
        EXPANDED_KEY,
        JSON.stringify({ conns: expandedConns, dbs: expandedDbs }),
      )
    } catch {
      /* storage may be unavailable */
    }
  }, [expandedConns, expandedDbs])

  const handleConnect = async (connection: Connection) => {
    setBusyConn((prev) => ({ ...prev, [connection.id]: true }))
    try {
      await api.connect(connection.id)
      setExpandedConns((prev) => ({ ...prev, [connection.id]: true }))
      toast.success(`Connected to ${connection.name}`)
      onRefresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to connect")
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
      toast.success(`Disconnected from ${connection.name}`)
      onRefresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to disconnect")
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
        toast.success(`Database "${confirm.database}" dropped`)
        await loadDatabases(confirm.connectionId)
        if (selection.kind === "collection" && selection.database === confirm.database) {
          onSelect({ kind: "connection", connectionId: confirm.connectionId })
        }
      } else if (confirm.type === "drop-collection") {
        await api.dropCollection(confirm.connectionId, confirm.database, confirm.collection)
        toast.success(`Collection "${confirm.collection}" dropped`)
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
        toast.success("Connection removed")
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
      toast.error(err instanceof Error ? err.message : "Operation failed")
    }
  }

  const confirmContent = React.useMemo(() => {
    if (!confirm) return null
    if (confirm.type === "drop-database") {
      return {
        title: `Drop database "${confirm.database}"?`,
        description: `This permanently deletes the database and every collection inside it.`,
        confirmLabel: "Drop database",
      }
    }
    if (confirm.type === "drop-collection") {
      return {
        title: `Drop collection "${confirm.collection}"?`,
        description: "This permanently deletes the collection and all of its documents.",
        confirmLabel: "Drop collection",
      }
    }
    return {
      title: `Delete connection "${confirm.connection.name}"?`,
      description: "Only the saved profile is removed; the database itself is untouched.",
      confirmLabel: "Delete",
    }
  }, [confirm])

  const noMatches =
    filtering &&
    connections.every((connection) => {
      if (matches(connection.name)) return false
      const dbs = databases[connection.id] ?? []
      return !dbs.some((database) => {
        if (matches(database.name)) return true
        const key = dbKey(connection.id, database.name)
        return (collections[key] ?? []).some((collection) => matches(collection.name))
      })
    })

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
              <Button variant="ghost" size="icon-sm" onClick={onNewConnection} aria-label="New connection">
                <Plus />
              </Button>
            </TooltipTrigger>
            <TooltipContent>New connection</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="shrink-0 border-b px-2 py-2">
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter connections, databases, collections…"
            aria-label="Filter connections, databases and collections"
            spellCheck={false}
            autoComplete="off"
            className="h-8 pr-7 pl-8 text-xs"
          />
          {filter ? (
            <button
              type="button"
              onClick={() => setFilter("")}
              aria-label="Clear filter"
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 rounded-sm p-0.5"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-0.5 p-2">
          {loading && connections.length === 0 ? (
            <div className="flex items-center gap-2 px-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading connections…
            </div>
          ) : null}

          {!loading && connections.length === 0 ? (
            <div className="px-3 py-8 text-center">
              <Database className="text-muted-foreground mx-auto mb-3 size-8" />
              <p className="text-sm font-medium">No connections yet</p>
              <p className="text-muted-foreground mt-1 text-xs">
                Add a MongoDB connection to get started.
              </p>
              <Button size="sm" className="mt-4" onClick={onNewConnection}>
                <Plus /> New connection
              </Button>
            </div>
          ) : null}

          {noMatches ? (
            <div className="text-muted-foreground px-3 py-8 text-center text-xs">
              Nothing matches “{filter.trim()}”.
            </div>
          ) : null}

          {connections.map((connection) => {
            const connectionMatches = matches(connection.name)
            const isExpanded = filtering || Boolean(expandedConns[connection.id])
            const isSelected =
              selection.kind === "connection" && selection.connectionId === connection.id
            const dbs = databases[connection.id] ?? []
            const visibleDbs = filtering
              ? dbs.filter((database) => {
                  if (connectionMatches || matches(database.name)) return true
                  const key = dbKey(connection.id, database.name)
                  return (collections[key] ?? []).some((collection) => matches(collection.name))
                })
              : dbs
            if (filtering && !connectionMatches && visibleDbs.length === 0) return null
            return (
              <div key={connection.id}>
                <div
                  className={cn(
                    "group hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex items-center gap-1 rounded-md px-1 py-1",
                    isSelected && "bg-sidebar-accent text-sidebar-accent-foreground",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggleConnection(connection)}
                    aria-label={`Toggle connection ${connection.name}`}
                    className="text-muted-foreground hover:text-foreground flex size-5 shrink-0 items-center justify-center"
                  >
                    {busyConn[connection.id] ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <ChevronRight
                        className={cn("size-3.5 transition-transform", isExpanded && "rotate-90")}
                      />
                    )}
                  </button>
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: connection.color || "#10b981" }}
                  />
                  <button
                    type="button"
                    onClick={() => onSelect({ kind: "connection", connectionId: connection.id })}
                    data-testid={`conn-${connection.name}`}
                    className="min-w-0 flex-1 truncate text-left text-sm"
                    title={connection.name}
                  >
                    {connection.name}
                  </button>
                  {connection.readOnly ? (
                    <span className="text-muted-foreground shrink-0 text-[10px] uppercase">
                      ro
                    </span>
                  ) : null}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
                      >
                        <Ellipsis />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-52">
                      {connection.connected ? (
                        <DropdownMenuItem onSelect={() => void handleDisconnect(connection)}>
                          <Unplug /> Disconnect
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onSelect={() => void handleConnect(connection)}>
                          <Plug /> Connect
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        onSelect={() => setDbDialogFor(connection.id)}
                        disabled={!connection.connected || connection.readOnly}
                      >
                        <Plus /> Create database
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => onEditConnection(connection)}>
                        <Pencil /> Edit connection
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => setConfirm({ type: "delete-connection", connection })}
                      >
                        <Trash2 /> Delete connection
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {isExpanded ? (
                  <div className="mt-0.5 ml-4 space-y-0.5 border-l pl-2">
                    {loadingDbs[connection.id] && visibleDbs.length === 0 ? (
                      <div className="text-muted-foreground flex items-center gap-2 px-2 py-1 text-xs">
                        <Loader2 className="size-3 animate-spin" /> Loading databases…
                      </div>
                    ) : null}
                    {visibleDbs.length === 0 && !loadingDbs[connection.id] ? (
                      <div className="text-muted-foreground px-2 py-1 text-xs">No databases</div>
                    ) : null}
                    {visibleDbs.map((database) => {
                      const key = dbKey(connection.id, database.name)
                      const dbOpen = filtering || Boolean(expandedDbs[key])
                      const allCols = collections[key] ?? []
                      const dbMatches = matches(database.name)
                      const cols =
                        !filtering || connectionMatches || dbMatches
                          ? allCols
                          : allCols.filter((collection) => matches(collection.name))
                      return (
                        <div key={key}>
                          <div className="group hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex items-center gap-1 rounded-md px-1 py-1">
                            <button
                              type="button"
                              onClick={() => toggleDatabase(connection.id, database.name)}
                              aria-label={`Toggle database ${database.name}`}
                              className="text-muted-foreground hover:text-foreground flex size-5 shrink-0 items-center justify-center"
                            >
                              <ChevronRight
                                className={cn(
                                  "size-3 transition-transform",
                                  dbOpen && "rotate-90",
                                )}
                              />
                            </button>
                            <Database className="text-muted-foreground size-3.5 shrink-0" />
                            <button
                              type="button"
                              onClick={() => toggleDatabase(connection.id, database.name)}
                              data-testid={`db-${database.name}`}
                              className="min-w-0 flex-1 truncate text-left text-sm"
                              title={database.name}
                            >
                              {database.name}
                            </button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
                                >
                                  <Ellipsis />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="start" className="w-52">
                                <DropdownMenuItem
                                  disabled={connection.readOnly}
                                  onSelect={() =>
                                    setColDialogFor({
                                      connectionId: connection.id,
                                      database: database.name,
                                    })
                                  }
                                >
                                  <Plus /> Create collection
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  variant="destructive"
                                  disabled={connection.readOnly}
                                  onSelect={() =>
                                    setConfirm({
                                      type: "drop-database",
                                      connectionId: connection.id,
                                      database: database.name,
                                    })
                                  }
                                >
                                  <Trash2 /> Drop database
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>

                          {dbOpen ? (
                            <div className="mt-0.5 ml-5 space-y-0.5 border-l pl-2">
                              {loadingCols[key] && cols.length === 0 ? (
                                <div className="text-muted-foreground flex items-center gap-2 px-2 py-1 text-xs">
                                  <Loader2 className="size-3 animate-spin" /> Loading…
                                </div>
                              ) : null}
                              {cols.length === 0 && !loadingCols[key] ? (
                                <div className="text-muted-foreground px-2 py-1 text-xs">
                                  No collections
                                </div>
                              ) : null}
                              {cols.map((collection) => {
                                const colSelected =
                                  selection.kind === "collection" &&
                                  selection.connectionId === connection.id &&
                                  selection.database === database.name &&
                                  selection.collection === collection.name
                                return (
                                  <div
                                    key={collection.name}
                                    className={cn(
                                      "group hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex items-center gap-1 rounded-md px-1 py-1",
                                      colSelected &&
                                        "bg-sidebar-accent text-sidebar-accent-foreground",
                                    )}
                                  >
                                    <Table2 className="text-muted-foreground size-3.5 shrink-0" />
                                    <button
                                      type="button"
                                      onClick={() =>
                                        onSelect({
                                          kind: "collection",
                                          connectionId: connection.id,
                                          database: database.name,
                                          collection: collection.name,
                                        })
                                      }
                                      data-testid={`col-${database.name}-${collection.name}`}
                                      className="min-w-0 flex-1 truncate text-left text-sm"
                                      title={collection.name}
                                    >
                                      {collection.name}
                                    </button>
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="icon-sm"
                                          className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
                                        >
                                          <Ellipsis />
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="start" className="w-48">
                                        <DropdownMenuItem
                                          variant="destructive"
                                          disabled={connection.readOnly}
                                          onSelect={() =>
                                            setConfirm({
                                              type: "drop-collection",
                                              connectionId: connection.id,
                                              database: database.name,
                                              collection: collection.name,
                                            })
                                          }
                                        >
                                          <Trash2 /> Drop collection
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </div>
                                )
                              })}
                            </div>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </ScrollArea>

      <div className="text-muted-foreground flex shrink-0 items-center justify-between border-t px-3 py-2 text-xs">
        <span className="flex items-center gap-1.5">
          {connections.length} connection{connections.length === 1 ? "" : "s"}
          <span className="text-muted-foreground/60">·</span>
          <span title="Embedded front-end version">v{__APP_VERSION__}</span>
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
            title="Refresh"
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
        onConfirm={runConfirm}
      />
    </div>
  )
}
