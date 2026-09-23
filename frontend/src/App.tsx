import * as React from "react"
import { Database, Leaf, Menu, Plus, Server, Table2, X } from "lucide-react"
import { toast } from "sonner"

import { AppSidebar } from "@/components/app-sidebar"
import { CollectionView } from "@/components/collection-view"
import { ConnectionDialog } from "@/components/connection-dialog"
import { ConnectionOverview } from "@/components/connection-overview"
import { Button } from "@/components/ui/button"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { Connection, Selection } from "@/lib/types"

export default function App() {
  const [connections, setConnections] = React.useState<Connection[]>([])
  const [loading, setLoading] = React.useState(true)
  const [selection, setSelection] = React.useState<Selection>({ kind: "welcome" })
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editingConnection, setEditingConnection] = React.useState<Connection | null>(null)
  const [sidebarOpen, setSidebarOpen] = React.useState(false)

  const refreshConnections = React.useCallback(async () => {
    try {
      const list = await api.listConnections()
      setConnections(list)
      return list
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load connections")
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void refreshConnections()
  }, [refreshConnections])

  // Keep the selection in sync when a connection disappears.
  React.useEffect(() => {
    if (selection.kind === "welcome") return
    if (!connections.some((connection) => connection.id === selection.connectionId)) {
      setSelection({ kind: "welcome" })
    }
  }, [connections, selection])

  const selectedConnection = React.useMemo(
    () =>
      selection.kind === "welcome"
        ? undefined
        : connections.find((connection) => connection.id === selection.connectionId),
    [connections, selection],
  )

  const openNewConnection = () => {
    setEditingConnection(null)
    setDialogOpen(true)
  }

  const openEditConnection = (connection: Connection) => {
    setEditingConnection(connection)
    setDialogOpen(true)
  }

  const handleSelect = (next: Selection) => {
    setSelection(next)
    setSidebarOpen(false)
  }

  const renderContent = () => {
    if (selection.kind === "collection") {
      return (
        <CollectionView
          connectionId={selection.connectionId}
          database={selection.database}
          collection={selection.collection}
          readOnly={Boolean(selectedConnection?.readOnly)}
        />
      )
    }

    if (selection.kind === "connection" && selectedConnection) {
      return <ConnectionOverview connection={selectedConnection} />
    }

    return (
      <div className="scrollbar-thin h-full overflow-auto">
        <div className="mx-auto flex max-w-3xl flex-col items-center justify-center px-6 py-20 text-center">
          <div className="from-primary to-chart-2 mb-6 flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br shadow-lg">
            <Leaf className="size-7 text-white" />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">MongoUI</h1>
          <p className="text-muted-foreground mt-3 max-w-xl text-sm">
            A lightweight MongoDB administration console. Connect to a deployment, browse
            databases and collections, query documents, run aggregation pipelines and manage
            indexes — all in one place.
          </p>

          <div className="mt-8 grid w-full gap-3 sm:grid-cols-3">
            <Feature icon={<Database className="size-4" />} title="Browse" text="Databases, collections and live stats." />
            <Feature icon={<Table2 className="size-4" />} title="Query" text="Filters, projections, sorting and aggregation." />
            <Feature icon={<Server className="size-4" />} title="Admin" text="Indexes, schema analysis and server info." />
          </div>

          {connections.length === 0 ? (
            <Button className="mt-8" onClick={openNewConnection}>
              <Plus /> New connection
            </Button>
          ) : (
            <div className="mt-8 w-full">
              <p className="text-muted-foreground mb-3 text-xs tracking-wide uppercase">
                Recent connections
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {connections.map((connection) => (
                  <Button
                    key={connection.id}
                    variant="outline"
                    onClick={() => handleSelect({ kind: "connection", connectionId: connection.id })}
                  >
                    <span
                      className="size-2 rounded-full"
                      style={{ backgroundColor: connection.color || "#10b981" }}
                    />
                    {connection.name}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="bg-background flex h-screen overflow-hidden">
        {sidebarOpen ? (
          <div
            className="fixed inset-0 z-30 bg-black/50 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        ) : null}

        <div
          className={cn(
            "bg-sidebar fixed inset-y-0 left-0 z-40 w-72 -translate-x-full transition-transform duration-200 md:static md:z-auto md:translate-x-0",
            sidebarOpen && "translate-x-0",
          )}
        >
          <AppSidebar
            connections={connections}
            loading={loading}
            selection={selection}
            onSelect={handleSelect}
            onNewConnection={openNewConnection}
            onEditConnection={openEditConnection}
            onRefresh={() => void refreshConnections()}
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3 md:hidden">
            <Button variant="ghost" size="icon-sm" onClick={() => setSidebarOpen((prev) => !prev)}>
              {sidebarOpen ? <X /> : <Menu />}
            </Button>
            <span className="font-medium">MongoUI</span>
          </header>
          <main className="min-h-0 flex-1">{renderContent()}</main>
        </div>
      </div>

      <ConnectionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        connection={editingConnection}
        onSaved={(saved) => {
          void refreshConnections()
          setSelection({ kind: "connection", connectionId: saved.id })
        }}
      />
      <Toaster />
    </TooltipProvider>
  )
}

function Feature({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="bg-card rounded-xl border p-4 text-left">
      <div className="text-primary flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
      </div>
      <p className="text-muted-foreground mt-1 text-xs">{text}</p>
    </div>
  )
}
