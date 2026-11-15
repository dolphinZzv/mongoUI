import * as React from "react"
import { Loader2, Play } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { QueryLibrary } from "@/components/query-library"
import { QueryResultPanel } from "@/components/query-result-panel"
import { RecentQueries } from "@/components/recent-queries"
import { SqlEditor } from "@/components/sql-editor"
import { api, isAbortError } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { useRecentQueries } from "@/hooks/useRecentQueries"
import { columnPrefsKey, readColumnPrefs } from "@/lib/columnPrefs"
import { collectColumns } from "@/lib/mongo"
import type { SQLResult } from "@/lib/types"

interface SqlTabProps {
  connectionId: string
  database: string
  collection: string
  /** SQL / aggregation switch rendered inside the query toolbar. */
  modeSwitch?: React.ReactNode
}

/** Quotes an identifier for SQL when it is not a simple name. */
function quoteIdent(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : "`" + name.replace(/`/g, "``") + "`"
}

function readStored(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) || fallback
  } catch {
    return fallback
  }
}

function templates(collection: string): { labelKey: string; sql: string }[] {
  const c = quoteIdent(collection)
  return [
    { labelKey: "sql.template.all", sql: `SELECT * FROM ${c} LIMIT 50` },
    { labelKey: "sql.template.count", sql: `SELECT COUNT(*) AS count FROM ${c}` },
    { labelKey: "sql.template.distinct", sql: `SELECT DISTINCT status FROM ${c} LIMIT 100` },
    {
      labelKey: "sql.template.group",
      sql: `SELECT status, COUNT(*) AS count\nFROM ${c}\nGROUP BY status\nORDER BY count DESC`,
    },
    {
      labelKey: "sql.template.filter",
      sql: `SELECT * FROM ${c}\nWHERE status = 'active'\nORDER BY _id DESC\nLIMIT 20`,
    },
  ]
}

export function SqlTab({ connectionId, database, collection, modeSwitch }: SqlTabProps) {
  const { t } = useI18n()
  const queryStorageKey = `mongoui-sql:${connectionId}:${database}:${collection}`
  const defaultQuery = `SELECT * FROM ${quoteIdent(collection)} LIMIT 50`
  const [query, setQuery] = React.useState(() => readStored(queryStorageKey, defaultQuery))
  const [limit, setLimit] = React.useState("")
  const [result, setResult] = React.useState<SQLResult | null>(null)
  const columnPrefs = React.useMemo(
    () => readColumnPrefs(columnPrefsKey(connectionId, database, collection)),
    [connectionId, database, collection],
  )
  const [loading, setLoading] = React.useState(false)
  const [ran, setRan] = React.useState(false)
  const abortRef = React.useRef<AbortController | null>(null)
  const [view, setView] = React.useState<"table" | "json" | "chart">("table")
  const [suggestions, setSuggestions] = React.useState<string[]>([])
  const {
    items: recentSql,
    push: pushRecent,
    clear: clearRecent,
    favorites: favoriteSql,
    toggleFavorite: toggleFavoriteSql,
    removeFavorite: removeFavoriteSql,
    metaFor: recentSqlMeta,
  } = useRecentQueries(`sql:${connectionId}:${database}`)

  // Complete collection and field names alongside the SQL keywords.
  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      const words = new Set<string>()
      try {
        const collections = await api.listCollections(connectionId, database)
        for (const c of collections) {
          words.add(c.name)
          words.add(`${database}.${c.name}`)
        }
      } catch {
        /* ignore: completion is best-effort */
      }
      try {
        const databases = await api.listDatabases(connectionId)
        for (const db of databases.databases) words.add(db.name)
        // Keep cross-database completion bounded: fetch collection names for a
        // reasonable number of databases without hammering large deployments.
        await Promise.all(
          databases.databases
            .filter((db) => db.name !== database)
            .slice(0, 20)
            .map(async (db) => {
              try {
                const collections = await api.listCollections(connectionId, db.name)
                for (const c of collections) words.add(`${db.name}.${c.name}`)
              } catch {
                /* ignore */
              }
            }),
        )
      } catch {
        /* ignore */
      }
      try {
        const schema = await api.collectionSchema(connectionId, database, collection)
        for (const field of schema.fields) words.add(field.name)
      } catch {
        /* ignore */
      }
      if (!cancelled) setSuggestions([...words])
    })()
    return () => {
      cancelled = true
    }
  }, [connectionId, database, collection])

  // Restore the last query for this collection, or start from the template.
  React.useEffect(() => {
    setQuery(readStored(queryStorageKey, defaultQuery))
    setResult(null)
    setRan(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryStorageKey])

  React.useEffect(() => {
    try {
      localStorage.setItem(queryStorageKey, query)
    } catch {
      /* storage may be unavailable */
    }
  }, [query, queryStorageKey])

  React.useEffect(() => () => abortRef.current?.abort(), [])

  const cancel = React.useCallback(() => {
    if (!abortRef.current) return
    abortRef.current.abort()
    abortRef.current = null
    setLoading(false)
    toast.info(t("docs.cancelled"))
  }, [t])

  const execute = React.useCallback(
    async (skipValue: number | undefined, record: boolean) => {
      if (!query.trim()) {
        toast.error(t("sql.writeFirst"))
        return
      }
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setLoading(true)
      try {
        const res = await api.runSQL(
          connectionId,
          database,
          query,
          limit.trim() ? Number(limit) : undefined,
          controller.signal,
          skipValue,
        )
        setResult(res)
        setRan(true)
        if (record) {
          pushRecent(query, {
            rows: res.documents.length,
            total: res.total,
            durationMs: res.durationMs,
            at: Date.now(),
          })
        }
      } catch (err) {
        if (isAbortError(err)) return
        toast.error(err instanceof Error ? err.message : t("sql.failed"))
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null
          setLoading(false)
        }
      }
    },
    [connectionId, database, query, limit, t, pushRecent],
  )

  const run = React.useCallback(() => execute(undefined, true), [execute])

  const movePage = (direction: -1 | 1) => {
    const currentSkip = result?.skip ?? 0
    const size = result?.limit && result.limit > 0 ? result.limit : 50
    void execute(Math.max(0, currentSkip + direction * size), false)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault()
      void run()
    }
  }

  const documents = result?.documents ?? []
  const columns = React.useMemo(() => {
    if (result?.columns && result.columns.length > 0) return result.columns
    return collectColumns(documents)
  }, [result, documents])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-3 border-b p-3">
        <div className="flex flex-wrap items-center gap-2">
          {modeSwitch}
          <span className="text-sm font-medium">SQL</span>
          <div className="flex flex-wrap gap-1.5">
            {templates(collection).map((template) => (
              <button
                key={template.labelKey}
                type="button"
                onClick={() => setQuery(template.sql)}
                className="text-muted-foreground hover:text-foreground hover:bg-accent rounded-full border px-2.5 py-0.5 text-xs transition-colors"
              >
                {t(template.labelKey)}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Label htmlFor="sql-limit" className="text-muted-foreground text-xs">
              {t("sql.limit")}
            </Label>
            <Input
              id="sql-limit"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              placeholder="auto"
              className="h-8 w-20 font-mono text-xs"
              inputMode="numeric"
            />
            <Button onClick={() => void run()} disabled={loading} size="sm">
              {loading ? <Loader2 className="animate-spin" /> : <Play />}
              {t("sql.run")}
            </Button>
            <QueryLibrary
              scope={`${connectionId}::${database}::${collection}`}
              kind="sql"
              text={query}
              onPick={setQuery}
            />
            <RecentQueries
              items={recentSql}
              favorites={favoriteSql}
              onPick={(value) => setQuery(value)}
              onClear={clearRecent}
              onToggleFavorite={toggleFavoriteSql}
              onRemoveFavorite={removeFavoriteSql}
              metaFor={recentSqlMeta}
            />
          </div>
        </div>

        <SqlEditor
          value={query}
          onChange={setQuery}
          onKeyDown={onKeyDown}
          suggestions={suggestions}
          placeholder={`SELECT * FROM ${quoteIdent(collection)} LIMIT 20`}
        />
        <p className="text-muted-foreground text-xs">{t("sql.help")}</p>

      </div>

      <QueryResultPanel
        ran={ran}
        view={view}
        onViewChange={setView}
        documents={documents}
        columns={columns}
        storageKey={`sql:${connectionId}:${database}:${collection}`}
        count={result?.count ?? 0}
        total={result?.total}
        durationMs={result?.durationMs}
        notRunText={t("sql.notRun")}
        emptyText={t("sql.empty")}
        loading={loading}
        onCancel={cancel}
        pagination={
          result
            ? {
                skip: result.skip,
                count: documents.length,
                hasMore: Boolean(result.hasMore),
                onPrev: () => movePage(-1),
                onNext: () => movePage(1),
              }
            : undefined
        }
        dictionaries={columnPrefs.dictionaries}
        renderers={columnPrefs.renderers}
        colors={columnPrefs.colors}
      />
    </div>
  )
}
