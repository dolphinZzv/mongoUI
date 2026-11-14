import * as React from "react"
import { Loader2, Menu, PanelLeft, PanelLeftClose, ScanSearch, Search, SquareTerminal, X } from "lucide-react"
import { toast } from "sonner"

import { AppSidebar } from "@/components/app-sidebar"
import { CollectionTabs } from "@/components/collection-tabs"
import { ConnectionStatus } from "@/components/connection-status"
import { FeedbackWidget } from "@/components/feedback-widget"
import { HeaderSearch } from "@/components/header-search"
import { DashboardView } from "@/components/dashboard-view"
import { WelcomeScreen } from "@/components/welcome-screen"
import { useAuth } from "@/components/auth-gate"
import { LazyMount } from "@/components/lazy-mount"
import { SettingsDialog } from "@/components/settings-dialog"
import { ShortcutsDialog } from "@/components/shortcuts-dialog"
import { Button } from "@/components/ui/button"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useAgentTools } from "@/hooks/useAgentTools"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { DOCS_QUERY_DEFAULTS, useRouter, type DocsQueryState } from "@/lib/router"
import { normalizeChartConfig } from "@/lib/chart"
import { readTabs, tabKey, writeTabs, type CollectionTab } from "@/lib/collectionTabs"
import { ThemeProvider } from "@/lib/theme"
import { cn } from "@/lib/utils"
import type { Connection, Selection } from "@/lib/types"

// Loaded on demand so the first screen (sidebar + documents) stays small.
const CollectionView = React.lazy(() =>
  import("@/components/collection-view").then((m) => ({ default: m.CollectionView })),
)
const ConnectionOverview = React.lazy(() =>
  import("@/components/connection-overview").then((m) => ({ default: m.ConnectionOverview })),
)
const ConnectionDialog = React.lazy(() =>
  import("@/components/connection-dialog").then((m) => ({ default: m.ConnectionDialog })),
)
const CommandPalette = React.lazy(() =>
  import("@/components/command-palette").then((m) => ({ default: m.CommandPalette })),
)
const GlobalSearchDialog = React.lazy(() =>
  import("@/components/global-search-dialog").then((m) => ({ default: m.GlobalSearchDialog })),
)
const AuditDialog = React.lazy(() =>
  import("@/components/audit-dialog").then((m) => ({ default: m.AuditDialog })),
)
const SlowQueriesDialog = React.lazy(() =>
  import("@/components/slow-queries-dialog").then((m) => ({ default: m.SlowQueriesDialog })),
)
const ScriptPanel = React.lazy(() =>
  import("@/components/script-panel").then((m) => ({ default: m.ScriptPanel })),
)

const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

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

const SCRIPT_OPEN_KEY = "mongoui-script-open"
const SCRIPT_WIDTH_KEY = "mongoui-script-width"
const SCRIPT_DEFAULT = 420
const SCRIPT_MIN = 320
const SCRIPT_MAX = 760

export default function App() {
  const { t } = useI18n()
  const { enabled: authEnabled } = useAuth()
  const [connections, setConnections] = React.useState<Connection[]>([])
  const [loading, setLoading] = React.useState(true)
  const { selection, tab, docs, navigate } = useRouter()
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [paletteOpen, setPaletteOpen] = React.useState(false)
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [searchTerm, setSearchTerm] = React.useState("")
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false)
  const [auditOpen, setAuditOpen] = React.useState(false)
  const [profileOpen, setProfileOpen] = React.useState(false)
  const [feedbackOpen, setFeedbackOpen] = React.useState(false)
  const [tabs, setTabs] = React.useState<CollectionTab[]>(() => readTabs())
  // Last closed tab, for Alt+Shift+T (reopen).
  const lastClosedTabRef = React.useRef<CollectionTab | null>(null)
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
  const [scriptOpen, setScriptOpen] = React.useState(() => {
    try {
      return localStorage.getItem(SCRIPT_OPEN_KEY) === "1"
    } catch {
      return false
    }
  })
  const [scriptWidth, setScriptWidth] = React.useState(() => {
    try {
      const raw = Number(localStorage.getItem(SCRIPT_WIDTH_KEY))
      return Number.isFinite(raw) && raw >= SCRIPT_MIN && raw <= SCRIPT_MAX
        ? raw
        : SCRIPT_DEFAULT
    } catch {
      return SCRIPT_DEFAULT
    }
  })

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

  React.useEffect(() => {
    try {
      localStorage.setItem(SCRIPT_OPEN_KEY, scriptOpen ? "1" : "0")
    } catch {
      /* storage may be unavailable */
    }
  }, [scriptOpen])

  React.useEffect(() => {
    try {
      localStorage.setItem(SCRIPT_WIDTH_KEY, String(scriptWidth))
    } catch {
      /* storage may be unavailable */
    }
  }, [scriptWidth])

  // The script console is bound to a collection; close it when there is none.
  React.useEffect(() => {
    if (selection.kind !== "collection") setScriptOpen(false)
  }, [selection])

  const toggleSidebar = () => {
    if (isDesktop) setSidebarCollapsed((prev) => !prev)
    else setSidebarOpen((prev) => !prev)
  }

  const clampSidebarWidth = (value: number) =>
    Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, value))
  const clampScriptWidth = (value: number) =>
    Math.min(SCRIPT_MAX, Math.max(SCRIPT_MIN, value))

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

  const startScriptResize = (event: React.MouseEvent) => {
    event.preventDefault()
    const onMove = (e: MouseEvent) => {
      // The panel is anchored to the right edge, so its width is the distance
      // from the pointer to the viewport's right edge.
      setScriptWidth(
        Math.min(SCRIPT_MAX, Math.max(SCRIPT_MIN, window.innerWidth - e.clientX)),
      )
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

  // Cmd/Ctrl+K opens the command palette.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setPaletteOpen((prev) => !prev)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  // "?" opens the keyboard shortcut cheat sheet, unless the user is typing.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      ) {
        return
      }
      if (event.key === "?") {
        event.preventDefault()
        setShortcutsOpen(true)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  // Poll the connection list so the sidebar and health chip stay current even
  // when nothing in the UI triggers a refresh.
  React.useEffect(() => {
    const timer = window.setInterval(() => {
      void api
        .listConnections()
        .then(setConnections)
        .catch(() => undefined)
    }, 30000)
    return () => window.clearInterval(timer)
  }, [])

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
    if (loading || (selection.kind !== "connection" && selection.kind !== "collection")) return
    if (!connections.some((connection) => connection.id === selection.connectionId)) {
      navigate({ kind: "welcome" }, undefined, { replace: true })
    }
  }, [connections, loading, selection, navigate])

  const selectedConnection = React.useMemo(
    () =>
      selection.kind !== "connection" && selection.kind !== "collection"
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

  // Mirror the documents query/pagination into the URL so a refresh restores
  // the exact page. Replacing avoids flooding the history with every edit.
  const handleDocsChange = React.useCallback(
    (next: DocsQueryState) => {
      if (selection.kind !== "collection") return
      navigate(selection, tab, { replace: true, docs: next })
    },
    [selection, tab, navigate],
  )

  // Open a collection from a query pinned in the sidebar, applying its filter.
  const handleOpenQuery = React.useCallback(
    (next: Selection, filter: string) => {
      if (next.kind !== "collection") return
      navigate(next, undefined, { docs: { ...DOCS_QUERY_DEFAULTS, filter } })
      setSidebarOpen(false)
    },
    [navigate],
  )

  const openGlobalSearch = React.useCallback((term?: string) => {
    setSearchTerm(term ?? "")
    setSearchOpen(true)
  }, [])

  const activeTabKey = selection.kind === "collection" ? tabKey(selection) : null

  // Record the active collection (with its tab and documents query) as an open
  // tab, updating it as the router state changes.
  React.useEffect(() => {
    if (selection.kind !== "collection") return
    const key = tabKey(selection)
    setTabs((prev) => {
      const existing = prev.find((entry) => entry.key === key)
      if (existing) {
        if (existing.tab === tab && existing.docs === docs) return prev
        return prev.map((entry) => (entry.key === key ? { ...entry, tab, docs } : entry))
      }
      return [
        ...prev,
        {
          key,
          connectionId: selection.connectionId,
          database: selection.database,
          collection: selection.collection,
          tab,
          docs,
        },
      ]
    })
  }, [selection, tab, docs])

  React.useEffect(() => {
    writeTabs(tabs)
  }, [tabs])

  // Drop tabs whose connection no longer exists.
  React.useEffect(() => {
    if (loading) return
    setTabs((prev) => {
      const next = prev.filter((entry) =>
        connections.some((connection) => connection.id === entry.connectionId),
      )
      return next.length === prev.length ? prev : next
    })
  }, [connections, loading])

  const activateTab = (entry: CollectionTab) => {
    navigate(
      {
        kind: "collection",
        connectionId: entry.connectionId,
        database: entry.database,
        collection: entry.collection,
      },
      entry.tab,
      { docs: entry.docs },
    )
  }

  const closeTab = (target: CollectionTab) => {
    const index = tabs.findIndex((entry) => entry.key === target.key)
    const next = tabs.filter((entry) => entry.key !== target.key)
    lastClosedTabRef.current = target
    setTabs(next)
    if (activeTabKey !== target.key) return
    const neighbour = next[Math.min(index, next.length - 1)]
    if (neighbour) activateTab(neighbour)
    else navigate({ kind: "welcome" }, undefined, { replace: true })
  }

  const closeAllTabs = () => {
    setTabs([])
    if (selection.kind === "collection") {
      navigate({ kind: "welcome" }, undefined, { replace: true })
    }
  }

  // Keyboard tab navigation: Alt+[ / Alt+] cycle, Alt+1..9 jump, Alt+Shift+W
  // closes and Alt+Shift+T reopens the last closed collection. Uses event.code
  // so it works on layouts where Alt changes the produced character.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.metaKey || event.ctrlKey) return
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      ) {
        return
      }
      if (event.code === "BracketRight" || event.code === "BracketLeft") {
        if (tabs.length === 0) return
        event.preventDefault()
        const current = tabs.findIndex((entry) => entry.key === activeTabKey)
        const delta = event.code === "BracketRight" ? 1 : -1
        const next = tabs[(current + delta + tabs.length) % tabs.length]
        if (next) activateTab(next)
        return
      }
      const digit = /^Digit([1-9])$/.exec(event.code)
      if (digit) {
        const next = tabs[Number(digit[1]) - 1]
        if (!next) return
        event.preventDefault()
        activateTab(next)
        return
      }
      if (event.shiftKey && event.code === "KeyW") {
        if (selection.kind !== "collection") return
        const active = tabs.find((entry) => entry.key === activeTabKey)
        if (!active) return
        event.preventDefault()
        closeTab(active)
        return
      }
      if (event.shiftKey && event.code === "KeyT") {
        const last = lastClosedTabRef.current
        if (!last) return
        event.preventDefault()
        lastClosedTabRef.current = null
        activateTab(last)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [activeTabKey, tabs, selection, activateTab, closeTab])

  const renderContent = () => {
    if (selection.kind === "dashboard") {
      return (
        <React.Suspense fallback={<ContentFallback />}>
          <DashboardView
            connections={connections}
            onOpenChart={(next, chart) => {
              navigate(next, "documents", {
                docs: {
                  ...DOCS_QUERY_DEFAULTS,
                  chart: {
                    config: normalizeChartConfig(chart.config),
                    filter: chart.filter ?? "{}",
                  },
                },
              })
            }}
          />
        </React.Suspense>
      )
    }

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
        <React.Suspense fallback={<ContentFallback />}>
          <CollectionView
            connectionId={selection.connectionId}
            database={selection.database}
            collection={selection.collection}
            readOnly={Boolean(selectedConnection?.readOnly)}
            tab={tab}
            docs={docs}
            onDocsChange={handleDocsChange}
            onTabChange={handleTabChange}
          />
        </React.Suspense>
      )
    }

    if (selection.kind === "connection" && selectedConnection) {
      return (
        <React.Suspense fallback={<ContentFallback />}>
          <ConnectionOverview
            connection={selectedConnection}
            onOpenChart={(next, chart) => {
              navigate(next, "documents", {
                docs: {
                  ...DOCS_QUERY_DEFAULTS,
                  chart: {
                    config: normalizeChartConfig(chart.config),
                    filter: chart.filter ?? "{}",
                  },
                },
              })
            }}
          />
        </React.Suspense>
      )
    }

    return (
      <WelcomeScreen
        connections={connections}
        onOpenConnection={(connection) =>
          handleSelect({ kind: "connection", connectionId: connection.id })
        }
        onNewConnection={openNewConnection}
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenShortcuts={() => setShortcutsOpen(true)}
      />
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
            onOpenQuery={handleOpenQuery}
            onNewConnection={openNewConnection}
            onEditConnection={openEditConnection}
            onRefresh={() => void refreshConnections()}
          />
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t("sidebar.resize")}
            aria-valuenow={sidebarWidth}
            aria-valuemin={SIDEBAR_MIN}
            aria-valuemax={SIDEBAR_MAX}
            tabIndex={0}
            onMouseDown={startResize}
            onDoubleClick={() => setSidebarWidth(SIDEBAR_DEFAULT)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
              event.preventDefault()
              setSidebarWidth((prev) =>
                clampSidebarWidth(prev + (event.key === "ArrowRight" ? 16 : -16)),
              )
            }}
            title={t("sidebar.resize")}
            className="hover:bg-primary/40 focus-visible:ring-ring absolute inset-y-0 -right-1 z-50 hidden w-2 cursor-col-resize focus-visible:ring-2 focus-visible:outline-hidden md:block"
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
              {selection.kind === "dashboard" ? (
                <span className="font-medium">{t("dashboard.title")}</span>
              ) : selection.kind !== "welcome" && selectedConnection ? (
                <span className="font-medium">{selectedConnection.name}</span>
              ) : (
                <span className="font-medium md:hidden">MongoUI</span>
              )}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <HeaderSearch
                connections={connections}
                tabs={tabs}
                onSelect={handleSelect}
                onOpenQuery={handleOpenQuery}
                onOpenGlobalSearch={openGlobalSearch}
                onOpenPalette={() => setPaletteOpen(true)}
              />
              {selectedConnection ? (
                <ConnectionStatus
                  connection={selectedConnection}
                  onReconnect={() => void refreshConnections()}
                />
              ) : null}
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => openGlobalSearch()}
                title={t("search.globalTitle")}
                aria-label={t("search.globalTitle")}
              >
                <ScanSearch />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPaletteOpen(true)}
                title={t("palette.open")}
                className="text-muted-foreground gap-2 lg:hidden"
              >
                <Search className="size-3.5" />
                <kbd className="hidden font-mono text-[10px] sm:inline">
                  {IS_MAC ? "⌘K" : "Ctrl K"}
                </kbd>
              </Button>
              <Button
                variant={scriptOpen ? "secondary" : "ghost"}
                size="icon-sm"
                onClick={() => setScriptOpen((prev) => !prev)}
                disabled={selection.kind !== "collection"}
                title={t("script.toggle")}
                aria-label={t("script.toggle")}
              >
                <SquareTerminal />
              </Button>
              <SettingsDialog authEnabled={authEnabled} onFeedback={() => setFeedbackOpen(true)} />
            </div>
          </header>
          <CollectionTabs
            tabs={tabs}
            activeKey={activeTabKey}
            onActivate={activateTab}
            onClose={closeTab}
            onCloseAll={closeAllTabs}
          />
          <main className="min-h-0 flex-1">{renderContent()}</main>
        </div>

        {scriptOpen && selection.kind === "collection" ? (
          <>
            {!isDesktop ? (
              <div
                className="fixed inset-0 z-30 bg-black/50 md:hidden"
                onClick={() => setScriptOpen(false)}
              />
            ) : null}
            <aside
              style={{ "--script-width": `${scriptWidth}px` } as React.CSSProperties}
              className="bg-sidebar fixed inset-y-0 right-0 z-40 w-[85%] max-w-sm shrink-0 border-l shadow-xl md:relative md:z-auto md:w-[var(--script-width)] md:max-w-none md:shadow-none"
            >
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label={t("sidebar.resize")}
                aria-valuenow={scriptWidth}
                aria-valuemin={SCRIPT_MIN}
                aria-valuemax={SCRIPT_MAX}
                tabIndex={0}
                onMouseDown={startScriptResize}
                onDoubleClick={() => setScriptWidth(SCRIPT_DEFAULT)}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
                  event.preventDefault()
                  // This panel is anchored right, so ArrowLeft widens it.
                  setScriptWidth((prev) =>
                    clampScriptWidth(prev + (event.key === "ArrowLeft" ? 16 : -16)),
                  )
                }}
                title={t("sidebar.resize")}
                className="hover:bg-primary/40 focus-visible:ring-ring absolute inset-y-0 -left-1 z-50 hidden w-2 cursor-col-resize focus-visible:ring-2 focus-visible:outline-hidden md:block"
              />
              <React.Suspense fallback={<ContentFallback />}>
                <ScriptPanel
                  connectionId={selection.connectionId}
                  database={selection.database}
                  collection={selection.collection}
                  readOnly={selectedConnection?.readOnly}
                  onClose={() => setScriptOpen(false)}
                />
              </React.Suspense>
            </aside>
          </>
        ) : null}
      </div>

      <LazyMount active={dialogOpen}>
        <ConnectionDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          connection={editingConnection}
          onSaved={(saved) => {
            void refreshConnections()
            navigate({ kind: "connection", connectionId: saved.id })
          }}
        />
      </LazyMount>
      <LazyMount active={paletteOpen}>
        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          connections={connections}
          selection={selection}
          onSelect={handleSelect}
          onOpenQuery={handleOpenQuery}
          onTabChange={handleTabChange}
          onNewConnection={openNewConnection}
          onRefresh={() => void refreshConnections()}
          onGlobalSearch={() => openGlobalSearch()}
          onAudit={() => setAuditOpen(true)}
          onProfile={() => setProfileOpen(true)}
          onShortcuts={() => setShortcutsOpen(true)}
        />
      </LazyMount>
      <LazyMount active={searchOpen}>
        <GlobalSearchDialog
          open={searchOpen}
          onOpenChange={setSearchOpen}
          connections={connections}
          selection={selection}
          initialTerm={searchTerm}
          onOpenQuery={handleOpenQuery}
        />
      </LazyMount>
      <LazyMount active={auditOpen}>
        <AuditDialog open={auditOpen} onOpenChange={setAuditOpen} connections={connections} />
      </LazyMount>
      <LazyMount active={profileOpen}>
        <SlowQueriesDialog
          open={profileOpen}
          onOpenChange={setProfileOpen}
          connections={connections}
          selection={selection}
        />
      </LazyMount>
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <FeedbackWidget open={feedbackOpen} onOpenChange={setFeedbackOpen} />
      <Toaster />
      </TooltipProvider>
    </ThemeProvider>
  )
}

function ContentFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="text-muted-foreground size-5 animate-spin" />
    </div>
  )
}
