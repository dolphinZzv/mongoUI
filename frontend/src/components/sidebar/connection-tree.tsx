import * as React from "react"
import {
  ChevronRight,
  Database,
  Ellipsis,
  Loader2,
  Pencil,
  Pin,
  PinOff,
  Plug,
  Plus,
  Table2,
  Tag,
  Trash2,
  Unplug,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  aliasCollectionKey,
  aliasDbKey,
  collectionLabel,
  databaseLabel,
  useAliases,
} from "@/lib/aliases"
import { useI18n } from "@/lib/i18n"
import {
  colPin,
  connPin,
  dbKey,
  dbPin,
  isSystemCollection,
  isSystemDatabase,
  pinnedFirst,
} from "@/lib/sidebarPrefs"
import { cn } from "@/lib/utils"
import type { CollectionInfo, Connection, DatabaseInfo, Selection } from "@/lib/types"

type PendingConfirm =
  | { type: "delete-connection"; connection: Connection }
  | { type: "drop-database"; connectionId: string; database: string }
  | { type: "drop-collection"; connectionId: string; database: string; collection: string }

interface ConnectionTreeProps {
  loading: boolean
  connections: Connection[]
  selection: Selection
  filter: string
  filtering: boolean
  matches: (value: string) => boolean
  noMatches: boolean
  orderedConnections: Connection[]
  showSystemDatabases: boolean
  showSystemCollections: boolean
  databases: Record<string, DatabaseInfo[]>
  collections: Record<string, CollectionInfo[]>
  loadingDbs: Record<string, boolean>
  loadingCols: Record<string, boolean>
  failedDbs: Record<string, boolean>
  failedCols: Record<string, boolean>
  busyConn: Record<string, boolean>
  expandedConns: Record<string, boolean>
  expandedDbs: Record<string, boolean>
  pinned: Set<string>
  onSelect: (selection: Selection) => void
  onNewConnection: () => void
  onEditConnection: (connection: Connection) => void
  handleConnect: (connection: Connection) => Promise<void>
  handleDisconnect: (connection: Connection) => Promise<void>
  toggleConnection: (connection: Connection) => void
  toggleDatabase: (connectionId: string, database: string) => void
  loadDatabases: (connectionId: string) => Promise<void> | void
  loadCollections: (connectionId: string, database: string) => Promise<void> | void
  setFailedDbs: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  setFailedCols: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  setDbDialogFor: React.Dispatch<React.SetStateAction<string | null>>
  setColDialogFor: React.Dispatch<
    React.SetStateAction<{ connectionId: string; database: string } | null>
  >
  setAliasTarget: React.Dispatch<React.SetStateAction<import("@/lib/aliases").AliasTarget | null>>
  togglePin: (key: string) => void
  setConfirm: React.Dispatch<React.SetStateAction<PendingConfirm | null>>
}

/** Connection → database → collection tree, including its loading/error states. */
export function ConnectionTree({
  loading,
  connections,
  selection,
  filter,
  filtering,
  matches,
  noMatches,
  orderedConnections,
  showSystemDatabases,
  showSystemCollections,
  databases,
  collections,
  loadingDbs,
  loadingCols,
  failedDbs,
  failedCols,
  busyConn,
  expandedConns,
  expandedDbs,
  pinned,
  onSelect,
  onNewConnection,
  onEditConnection,
  handleConnect,
  handleDisconnect,
  toggleConnection,
  toggleDatabase,
  loadDatabases,
  loadCollections,
  setFailedDbs,
  setFailedCols,
  setDbDialogFor,
  setColDialogFor,
  setAliasTarget,
  togglePin,
  setConfirm,
}: ConnectionTreeProps) {
  const { t } = useI18n()
  const aliases = useAliases()

  return (
    <>
          {loading && connections.length === 0 ? (
            <div className="flex items-center gap-2 px-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> {t("sidebar.loadingConnections")}
            </div>
          ) : null}

          {!loading && connections.length === 0 ? (
            <div className="px-3 py-8 text-center">
              <Database className="text-muted-foreground mx-auto mb-3 size-8" />
              <p className="text-sm font-medium">{t("sidebar.noConnections")}</p>
              <p className="text-muted-foreground mt-1 text-xs">
                {t("sidebar.emptyHint")}
              </p>
              <Button size="sm" className="mt-4" onClick={onNewConnection}>
                <Plus /> {t("app.newConnection")}
              </Button>
            </div>
          ) : null}

          {noMatches ? (
            <div className="text-muted-foreground px-3 py-8 text-center text-xs">
              {t("sidebar.nothingMatches", { query: filter.trim() })}
            </div>
          ) : null}

          {orderedConnections.map((connection) => {
            const connectionMatches = matches(connection.name)
            const isExpanded = filtering || Boolean(expandedConns[connection.id])
            const isSelected =
              selection.kind === "connection" && selection.connectionId === connection.id
            const dbs = (databases[connection.id] ?? []).filter(
              (database) => showSystemDatabases || !isSystemDatabase(database.name),
            )
            const visibleDbs = filtering
              ? dbs.filter((database) => {
                  if (
                    connectionMatches ||
                    matches(database.name) ||
                    matches(databaseLabel(aliases, connection.id, database.name))
                  ) {
                    return true
                  }
                  const key = dbKey(connection.id, database.name)
                  return (collections[key] ?? []).some(
                    (collection) =>
                      (showSystemCollections || !isSystemCollection(collection.name)) &&
                      (matches(collection.name) ||
                        matches(
                          collectionLabel(aliases, connection.id, database.name, collection.name),
                        )),
                  )
                })
              : dbs
            if (filtering && !connectionMatches && visibleDbs.length === 0) return null
            const orderedDbs = pinnedFirst(visibleDbs, pinned, (db) =>
              dbPin(connection.id, db.name),
            )
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
                    aria-label={t("sidebar.toggleConnection", { name: connection.name })}
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
                        aria-label={t("common.actions")}
                        className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 max-md:opacity-100"
                      >
                        <Ellipsis />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-52">
                      {connection.connected ? (
                        <DropdownMenuItem onSelect={() => void handleDisconnect(connection)}>
                          <Unplug /> {t("sidebar.disconnect")}
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onSelect={() => void handleConnect(connection)}>
                          <Plug /> {t("sidebar.connect")}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        onSelect={() => setDbDialogFor(connection.id)}
                        disabled={!connection.connected || connection.readOnly}
                      >
                        <Plus /> {t("sidebar.createDatabase")}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => togglePin(connPin(connection.id))}>
                        {pinned.has(connPin(connection.id)) ? <PinOff /> : <Pin />}
                        {pinned.has(connPin(connection.id)) ? t("sidebar.unpin") : t("sidebar.pin")}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => onEditConnection(connection)}>
                        <Pencil /> {t("sidebar.editConnection")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => setConfirm({ type: "delete-connection", connection })}
                      >
                        <Trash2 /> {t("sidebar.deleteConnection")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {isExpanded ? (
                  <div className="mt-0.5 ml-4 space-y-0.5 border-l pl-2">
                    {failedDbs[connection.id] ? (
                      <div className="text-destructive flex items-center gap-1 px-2 py-1 text-xs">
                        <span className="min-w-0 flex-1 truncate">{t("sidebar.loadFailed")}</span>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-[11px]"
                          onClick={() => {
                            setFailedDbs((prev) => {
                              const next = { ...prev }
                              delete next[connection.id]
                              return next
                            })
                            void loadDatabases(connection.id)
                          }}
                        >
                          {t("sidebar.retry")}
                        </Button>
                      </div>
                    ) : null}
                    {loadingDbs[connection.id] && visibleDbs.length === 0 ? (
                      <div className="text-muted-foreground flex items-center gap-2 px-2 py-1 text-xs">
                        <Loader2 className="size-3 animate-spin" /> {t("sidebar.loadingDatabases")}
                      </div>
                    ) : null}
                    {visibleDbs.length === 0 &&
                    !loadingDbs[connection.id] &&
                    !failedDbs[connection.id] ? (
                      <div className="text-muted-foreground px-2 py-1 text-xs">{t("sidebar.noDatabases")}</div>
                    ) : null}
                    {orderedDbs.map((database) => {
                      const key = dbKey(connection.id, database.name)
                      const dbOpen = filtering || Boolean(expandedDbs[key])
                      const allCols = (collections[key] ?? []).filter(
                        (collection) =>
                          showSystemCollections || !isSystemCollection(collection.name),
                      )
                      const dbName = databaseLabel(aliases, connection.id, database.name)
                      const dbMatches = matches(database.name) || matches(dbName)
                      const cols =
                        !filtering || connectionMatches || dbMatches
                          ? allCols
                          : allCols.filter(
                              (collection) =>
                                matches(collection.name) ||
                                matches(
                                  collectionLabel(
                                    aliases,
                                    connection.id,
                                    database.name,
                                    collection.name,
                                  ),
                                ),
                            )
                      const orderedCols = pinnedFirst(cols, pinned, (col) =>
                        colPin(connection.id, database.name, col.name),
                      )
                      return (
                        <div key={key}>
                          <div className="group hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex items-center gap-1 rounded-md px-1 py-1">
                            <button
                              type="button"
                              onClick={() => toggleDatabase(connection.id, database.name)}
                              aria-label={t("sidebar.toggleDatabase", { name: database.name })}
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
                              {dbName}
                            </button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={t("common.actions")}
                                  className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 max-md:opacity-100"
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
                                  <Plus /> {t("sidebar.createCollection")}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onSelect={() =>
                                    setAliasTarget({
                                      kind: "database",
                                      connectionId: connection.id,
                                      database: database.name,
                                    })
                                  }
                                >
                                  <Tag /> {aliases.databases[aliasDbKey(connection.id, database.name)] ? t("alias.edit") : t("alias.set")}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onSelect={() => togglePin(dbPin(connection.id, database.name))}
                                >
                                  {pinned.has(dbPin(connection.id, database.name)) ? (
                                    <PinOff />
                                  ) : (
                                    <Pin />
                                  )}
                                  {pinned.has(dbPin(connection.id, database.name))
                                    ? t("sidebar.unpin")
                                    : t("sidebar.pin")}
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
                                  <Trash2 /> {t("sidebar.dropDatabase")}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>

                          {dbOpen ? (
                            <div className="mt-0.5 ml-5 space-y-0.5 border-l pl-2">
                              {failedCols[key] ? (
                                <div className="text-destructive flex items-center gap-1 px-2 py-1 text-xs">
                                  <span className="min-w-0 flex-1 truncate">
                                    {t("sidebar.loadFailed")}
                                  </span>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-6 px-2 text-[11px]"
                                    onClick={() => {
                                      setFailedCols((prev) => {
                                        const next = { ...prev }
                                        delete next[key]
                                        return next
                                      })
                                      void loadCollections(connection.id, database.name)
                                    }}
                                  >
                                    {t("sidebar.retry")}
                                  </Button>
                                </div>
                              ) : null}
                              {loadingCols[key] && cols.length === 0 ? (
                                <div className="text-muted-foreground flex items-center gap-2 px-2 py-1 text-xs">
                                  <Loader2 className="size-3 animate-spin" /> {t("common.loading")}
                                </div>
                              ) : null}
                              {cols.length === 0 && !loadingCols[key] && !failedCols[key] ? (
                                <div className="text-muted-foreground px-2 py-1 text-xs">
                                  {t("sidebar.noCollections")}
                                </div>
                              ) : null}
                              {orderedCols.map((collection) => {
                                const colSelected =
                                  selection.kind === "collection" &&
                                  selection.connectionId === connection.id &&
                                  selection.database === database.name &&
                                  selection.collection === collection.name
                                const colName = collectionLabel(
                                  aliases,
                                  connection.id,
                                  database.name,
                                  collection.name,
                                )
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
                                      {colName}
                                    </button>
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="icon-sm"
                                          aria-label={t("common.actions")}
                                          className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 max-md:opacity-100"
                                        >
                                          <Ellipsis />
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="start" className="w-48">
                                        <DropdownMenuItem
                                          onSelect={() =>
                                            setAliasTarget({
                                              kind: "collection",
                                              connectionId: connection.id,
                                              database: database.name,
                                              collection: collection.name,
                                            })
                                          }
                                        >
                                          <Tag />{" "}
                                          {aliases.collections[
                                            aliasCollectionKey(
                                              connection.id,
                                              database.name,
                                              collection.name,
                                            )
                                          ]
                                            ? t("alias.edit")
                                            : t("alias.set")}
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          onSelect={() =>
                                            togglePin(
                                              colPin(
                                                connection.id,
                                                database.name,
                                                collection.name,
                                              ),
                                            )
                                          }
                                        >
                                          {pinned.has(
                                            colPin(connection.id, database.name, collection.name),
                                          ) ? (
                                            <PinOff />
                                          ) : (
                                            <Pin />
                                          )}
                                          {pinned.has(
                                            colPin(connection.id, database.name, collection.name),
                                          )
                                            ? t("sidebar.unpin")
                                            : t("sidebar.pin")}
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
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
                                          <Trash2 /> {t("sidebar.dropCollection")}
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
    </>
  )
}
