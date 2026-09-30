import * as React from "react"
import { Database, Leaf, Loader2, LogOut, Menu, PanelLeft, PanelLeftClose, Plus, Server, Table2, X } from "lucide-react"
import { toast } from "sonner"

import { AgentToggle } from "@/components/agent-toggle"
import { AppSidebar } from "@/components/app-sidebar"
import { useAuth } from "@/components/auth-gate"
import { CollectionView } from "@/components/collection-view"
import { ConnectionDialog } from "@/components/connection-dialog"
import { ConnectionOverview } from "@/components/connection-overview"
import { LanguageToggle } from "@/components/language-toggle"
import { Button } from "@/components/ui/button"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ThemeToggle } from "@/components/theme-toggle"
import { useAgentTools } from "@/hooks/useAgentTools"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { useRouter } from "@/lib/router"
import { ThemeProvider } from "@/lib/theme"
import { cn } from "@/lib/utils"
import type { Connection, Selection } from "@/lib/types"

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = React.useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches,
  )
  React.useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)")
    const onChange = () => setIsDesktop(mq.matches)
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])
  return isDesktop
}

const SIDEBAR_KEY = "mongoui-sidebar-width"
const SIDEBAR_COLLAPSED_KEY = "mongoui-sidebar-collapsed"
const SIDEBAR_DEFAULT = 288
const SIDEBAR_MIN = 200
const SIDEBAR_MAX = 520

export default function App() {
  const { t } = useI18n()
  const { enabled: authEnabled } = useAuth()
  const [connections, setConnections] = React.useState<Connection[]>([])
  const [loading, setLoading] = React.useState(true)
  const { selection, tab, navigate } = useRouter()
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editingConnection, setEditingConnection] = React.useState<Connection | null>(null)
  const [sidebarOpen, setSidebarOpen] = React.useState(false)
  const isDesktop = useIsDesktop()
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1"
    } catch {
      return false
    }
  })
  const [sidebarWidth, setSidebarWidth] = React.useState(() => {
    try {
      const raw = Number(localStorage.getItem(SIDEBAR_KEY))
      return Number.isFinite(raw) && raw >= SIDEBAR_MIN && raw <= SIDEBAR_MAX
        ? raw
        : SIDEBAR_DEFAULT
    } catch {
      return SIDEBAR_DEFAULT
    }
  })
  const sidebarRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? "1" : "0")
    } catch {
      /* storage may be unavailable */
    }
  }, [sidebarCollapsed])

  React.useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, String(sidebarWidth))
    } catch {
      /* storage may be unavailable */
    }
  }, [sidebarWidth])

  const toggleSidebar = () => {
    if (isDesktop) setSidebarCollapsed((prev) => !prev)
    else setSidebarOpen((prev) => !prev)
  }

  const startResize = (event: React.MouseEvent) => {
    event.preventDefault()
    const onMove = (e: MouseEvent) => {
      const left = sidebarRef.current?.getBoundingClientRect().left ?? 0
      setSidebarWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, e.clientX - left)))
    }
    const onUp = () => {
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
      document.body.style.userSelect = ""
    }
    document.body.style.userSelect = "none"
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }

  // Expose the agent tools to WebMCP / window.mongouiAgent when the user opts in.
  useAgentTools()

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

  // Keep the selection in sync when a connection disappears (or the URL points
  // at one that no longer exists).
  React.useEffect(() => {
    if (loading || selection.kind === "welcome") return
    if (!connections.some((connection) => connection.id === selection.connectionId)) {
      navigate({ kind: "welcome" }, undefined, { replace: true })
    }
  }, [connections, loading, selection, navigate])

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
    navigate(next)
    setSidebarOpen(false)
  }

  const handleTabChange = React.useCallback(
    (next: string) => {
      if (selection.kind !== "collection") return
      // Replacing keeps one history entry per collection.
      navigate(selection, next, { replace: true })
    },
    [selection, navigate],
  )

  const renderContent = () => {
    if (selection.kind === "collection") {
      // On a deep link the view mounts before the (auto-)connect finishes;
      // wait for the connection so tabs do not fire against a dead client.
      if (!selectedConnection) {
        return (
          <div className="text-muted-foreground flex h-full items-center justify-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" /> {t("app.loadingConnection")}
          </div>
        )
      }
      if (!selectedConnection.connected) {
        return (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <Loader2 className="text-muted-foreground size-5 animate-spin" />
            <p className="text-muted-foreground text-sm">
              {t("app.connecting", { name: selectedConnection.name })}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void api.connect(selectedConnection.id).then(() => refreshConnections())
              }}
            >
              {t("app.connectNow")}
            </Button>
          </div>
        )
      }
      return (
        <CollectionView
          connectionId={selection.connectionId}
          database={selection.database}
          collection={selection.collection}
          readOnly={Boolean(selectedConnection?.readOnly)}
          tab={tab}
          onTabChange={handleTabChange}
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
          <p className="text-muted-foreground mt-3 max-w-xl text-sm">{t("app.tagline")}</p>

          <div className="mt-8 grid w-full gap-3 sm:grid-cols-3">
            <Feature
              icon={<Database className="size-4" />}
              title={t("app.feature.browse")}
              text={t("app.feature.browseText")}
            />
            <Feature
              icon={<Table2 className="size-4" />}
              title={t("app.feature.query")}
              text={t("app.feature.queryText")}
            />
            <Feature
              icon={<Server className="size-4" />}
              title={t("app.feature.admin")}
              text={t("app.feature.adminText")}
            />
          </div>

          {connections.length === 0 ? (
            <Button className="mt-8" onClick={openNewConnection}>
              <Plus /> {t("app.newConnection")}
            </Button>
          ) : (
            <div className="mt-8 w-full">
              <p className="text-muted-foreground mb-3 text-xs tracking-wide uppercase">
                {t("app.recent")}
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

          <p className="text-muted-foreground mt-10 text-xs">
            MongoUI v{__APP_VERSION__}
          </p>
        </div>
      </div>
    )
  }

  return (
    <ThemeProvider>
      <TooltipProvider delayDuration={200}>
        <div className="bg-background flex h-screen overflow-hidden">
        {sidebarOpen ? (
          <div
            className="fixed inset-0 z-30 bg-black/50 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        ) : null}

        <div
          ref={sidebarRef}
          style={{ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}
          className={cn(
            "bg-sidebar fixed inset-y-0 left-0 z-40 w-72 -translate-x-full transition-transform duration-200 md:relative md:z-auto md:w-[var(--sidebar-width)] md:translate-x-0",
            sidebarOpen && "translate-x-0",
            sidebarCollapsed && "md:hidden",
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
          <div
            role="separator"
            aria-orientation="vertical"
            onMouseDown={startResize}
            onDoubleClick={() => setSidebarWidth(SIDEBAR_DEFAULT)}
            title={t("sidebar.resize")}
            className="hover:bg-primary/40 absolute inset-y-0 -right-1 z-50 hidden w-2 cursor-col-resize md:block"
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleSidebar}
              title={t("sidebar.toggle")}
              aria-label={t("sidebar.toggle")}
            >
              {isDesktop ? (
                sidebarCollapsed ? (
                  <PanelLeft />
                ) : (
                  <PanelLeftClose />
                )
              ) : sidebarOpen ? (
                <X />
              ) : (
                <Menu />
              )}
            </Button>
            <div className="min-w-0 truncate text-sm">
              {/* The collection view already renders its own db/collection path,
                  so the top bar only shows the connection (scope) instead of
                  repeating it. */}
              {selection.kind !== "welcome" && selectedConnection ? (
                <span className="font-medium">{selectedConnection.name}</span>
              ) : (
                <span className="font-medium md:hidden">MongoUI</span>
              )}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <LanguageToggle />
              {authEnabled ? (
                <Button
                  variant="outline"
                  size="sm"
                  title={t("auth.signOut")}
                  aria-label={t("auth.signOut")}
                  onClick={() => {
                    void api.authLogout().then(() => window.location.reload())
                  }}
                >
                  <LogOut />
                </Button>
              ) : null}
              <AgentToggle />
              <ThemeToggle />
            </div>
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
            navigate({ kind: "connection", connectionId: saved.id })
          }}
        />
        <Toaster />
      </TooltipProvider>
    </ThemeProvider>
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
