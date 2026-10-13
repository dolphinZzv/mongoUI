import * as React from "react"
import {
  Braces,
  Database,
  Home,
  Moon,
  Plus,
  RefreshCw,
  ScrollText,
  Search,
  Server,
  Star,
  Sun,
  Table2,
} from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useI18n } from "@/lib/i18n"
import { usePinnedQueries } from "@/lib/pinnedQueries"
import { COLLECTION_TABS } from "@/lib/router"
import { useTheme } from "@/lib/theme"
import { cn } from "@/lib/utils"
import type { Connection, Selection } from "@/lib/types"

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connections: Connection[]
  selection: Selection
  onSelect: (selection: Selection) => void
  onOpenQuery: (selection: Selection, filter: string) => void
  onTabChange: (tab: string) => void
  onNewConnection: () => void
  onRefresh: () => void
  onGlobalSearch: () => void
  onAudit: () => void
}

interface PaletteCommand {
  id: string
  label: string
  hint?: string
  keywords?: string
  icon: React.ReactNode
  group: string
  run: () => void
}

export function CommandPalette({
  open,
  onOpenChange,
  connections,
  selection,
  onSelect,
  onOpenQuery,
  onTabChange,
  onNewConnection,
  onRefresh,
  onGlobalSearch,
  onAudit,
}: CommandPaletteProps) {
  const { t, setLocale } = useI18n()
  const { setTheme } = useTheme()
  const pinnedQueries = usePinnedQueries()
  const [query, setQuery] = React.useState("")
  const [active, setActive] = React.useState(0)
  const listRef = React.useRef<HTMLDivElement>(null)

  // Reset the search each time the palette opens.
  React.useEffect(() => {
    if (open) {
      setQuery("")
      setActive(0)
    }
  }, [open])

  const close = React.useCallback(
    (run: () => void) => () => {
      run()
      onOpenChange(false)
    },
    [onOpenChange],
  )

  const commands = React.useMemo<PaletteCommand[]>(() => {
    const items: PaletteCommand[] = []
    const navigation = t("palette.navigation")
    const tabs = t("palette.tabs")
    const queries = t("palette.queries")
    const actions = t("palette.actions")

    items.push({
      id: "home",
      label: t("palette.home"),
      icon: <Home />,
      group: navigation,
      run: close(() => onSelect({ kind: "welcome" })),
    })

    for (const connection of connections) {
      items.push({
        id: `conn:${connection.id}`,
        label: connection.name,
        hint: t("palette.connection"),
        keywords: connection.uri,
        icon: <Server />,
        group: navigation,
        run: close(() => onSelect({ kind: "connection", connectionId: connection.id })),
      })
    }

    if (selection.kind === "collection") {
      for (const tab of COLLECTION_TABS) {
        items.push({
          id: `tab:${tab}`,
          label: t(`collection.tab.${tab}`),
          icon: <Table2 />,
          group: tabs,
          run: close(() => onTabChange(tab)),
        })
      }
    }

    for (const pinned of pinnedQueries) {
      const connection = connections.find((c) => c.id === pinned.connectionId)
      if (!connection) continue
      items.push({
        id: `query:${pinned.connectionId}:${pinned.database}:${pinned.collection}:${pinned.filter}`,
        label: `${connection.name} / ${pinned.database} / ${pinned.collection}`,
        hint: pinned.filter,
        keywords: pinned.filter,
        icon: <Star />,
        group: queries,
        run: close(() =>
          onOpenQuery(
            {
              kind: "collection",
              connectionId: pinned.connectionId,
              database: pinned.database,
              collection: pinned.collection,
            },
            pinned.filter,
          ),
        ),
      })
    }

    items.push(
      {
        id: "new-connection",
        label: t("app.newConnection"),
        icon: <Plus />,
        group: actions,
        run: close(onNewConnection),
      },
      {
        id: "refresh",
        label: t("common.refresh"),
        icon: <RefreshCw />,
        group: actions,
        run: close(onRefresh),
      },
      {
        id: "global-search",
        label: t("search.title"),
        keywords: "search find value field database",
        icon: <Search />,
        group: actions,
        run: close(onGlobalSearch),
      },
      {
        id: "audit",
        label: t("audit.title"),
        keywords: "audit log history writes",
        icon: <ScrollText />,
        group: actions,
        run: close(onAudit),
      },
      {
        id: "theme-light",
        label: t("theme.light"),
        icon: <Sun />,
        group: actions,
        run: close(() => setTheme("light")),
      },
      {
        id: "theme-dark",
        label: t("theme.dark"),
        icon: <Moon />,
        group: actions,
        run: close(() => setTheme("dark")),
      },
      {
        id: "lang-en",
        label: `Language: English`,
        keywords: "english en language locale",
        icon: <Braces />,
        group: actions,
        run: close(() => setLocale("en")),
      },
      {
        id: "lang-zh",
        label: "语言: 中文",
        keywords: "chinese zh 中文 语言",
        icon: <Braces />,
        group: actions,
        run: close(() => setLocale("zh")),
      },
    )

    return items
  }, [
    t,
    connections,
    selection,
    pinnedQueries,
    close,
    onSelect,
    onOpenQuery,
    onTabChange,
    onNewConnection,
    onRefresh,
    onGlobalSearch,
    onAudit,
    setTheme,
    setLocale,
  ])

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return commands
    return commands.filter((command) =>
      `${command.label} ${command.hint ?? ""} ${command.keywords ?? ""}`
        .toLowerCase()
        .includes(needle),
    )
  }, [commands, query])

  // Keep the highlighted row in range as the result list changes.
  React.useEffect(() => {
    setActive((prev) => Math.min(Math.max(prev, 0), Math.max(filtered.length - 1, 0)))
  }, [filtered.length])

  React.useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-command-index="${active}"]`)
    node?.scrollIntoView({ block: "nearest" })
  }, [active, filtered])

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActive((prev) => (filtered.length ? (prev + 1) % filtered.length : 0))
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActive((prev) => (filtered.length ? (prev - 1 + filtered.length) % filtered.length : 0))
    } else if (event.key === "Enter") {
      event.preventDefault()
      filtered[active]?.run()
    }
  }

  let lastGroup = ""

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[15%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{t("palette.open")}</DialogTitle>
          <DialogDescription>{t("palette.open")}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="text-muted-foreground size-4 shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("palette.placeholder")}
            aria-label={t("palette.open")}
            className="placeholder:text-muted-foreground h-11 w-full bg-transparent text-sm outline-none"
          />
          <kbd className="text-muted-foreground hidden shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] sm:block">
            Esc
          </kbd>
        </div>
        <div ref={listRef} className="scrollbar-thin max-h-[50vh] overflow-auto p-1">
          {filtered.length === 0 ? (
            <p className="text-muted-foreground px-2 py-6 text-center text-sm">
              {t("palette.empty")}
            </p>
          ) : null}
          {filtered.map((command, index) => {
            const showGroup = command.group !== lastGroup
            lastGroup = command.group
            return (
              <React.Fragment key={command.id}>
                {showGroup ? (
                  <p className="text-muted-foreground px-2 pt-3 pb-1 text-[10px] tracking-wide uppercase">
                    {command.group}
                  </p>
                ) : null}
                <button
                  type="button"
                  data-command-index={index}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => command.run()}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm",
                    index === active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
                  )}
                >
                  <span className="text-muted-foreground [&_svg]:size-4">{command.icon}</span>
                  <span className="min-w-0 flex-1 truncate">{command.label}</span>
                  {command.hint ? (
                    <span className="text-muted-foreground max-w-[45%] truncate font-mono text-[11px]">
                      {command.hint}
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
          <span className="flex items-center gap-1">
            <Database className="size-3" />
            {connections.length}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
