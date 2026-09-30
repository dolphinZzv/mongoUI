import * as React from "react"
import { BarChart3, Braces, Loader2, Play, Table2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { ChartView } from "@/components/chart-view"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { JsonView } from "@/components/json-view"
import { RecentQueries } from "@/components/recent-queries"
import { SqlEditor } from "@/components/sql-editor"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { useRecentQueries } from "@/hooks/useRecentQueries"
import { classForType, collectColumns, formatValue, valueType } from "@/lib/mongo"
import { cn } from "@/lib/utils"
import type { SQLResult } from "@/lib/types"

interface SqlTabProps {
  connectionId: string
  database: string
  collection: string
}

/** Quotes an identifier for SQL when it is not a simple name. */
function quoteIdent(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : "`" + name.replace(/`/g, "``") + "`"
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

export function SqlTab({ connectionId, database, collection }: SqlTabProps) {
  const { t } = useI18n()
  const [query, setQuery] = React.useState(`SELECT * FROM ${quoteIdent(collection)} LIMIT 50`)
  const [limit, setLimit] = React.useState("")
  const [result, setResult] = React.useState<SQLResult | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [ran, setRan] = React.useState(false)
  const [view, setView] = React.useState<"table" | "json" | "chart">("table")
  const [suggestions, setSuggestions] = React.useState<string[]>([])
  const {
    items: recentSql,
    push: pushRecent,
    clear: clearRecent,
  } = useRecentQueries(`sql:${connectionId}:${database}`)

  // Complete collection and field names alongside the SQL keywords.
  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      const words = new Set<string>()
      try {
        const collections = await api.listCollections(connectionId, database)
        for (const c of collections) words.add(c.name)
      } catch {
        /* ignore: completion is best-effort */
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

  // Reset the editor when the selected collection changes.
  React.useEffect(() => {
    setQuery(`SELECT * FROM ${quoteIdent(collection)} LIMIT 50`)
    setResult(null)
    setRan(false)
  }, [collection])

  const run = React.useCallback(async () => {
    if (!query.trim()) {
      toast.error(t("sql.writeFirst"))
      return
    }
    setLoading(true)
    try {
      const res = await api.runSQL(
        connectionId,
        database,
        query,
        limit.trim() ? Number(limit) : undefined,
      )
      setResult(res)
      setRan(true)
      pushRecent(query)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("sql.failed"))
    } finally {
      setLoading(false)
    }
  }, [connectionId, database, query, limit, t, pushRecent])

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
            <RecentQueries
              items={recentSql}
              onPick={(value) => setQuery(value)}
              onClear={clearRecent}
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

        {ran && result ? (
          <details className="rounded-md border">
            <summary className="text-muted-foreground hover:text-foreground cursor-pointer px-3 py-2 text-xs select-none">
              {t("sql.generated")}
            </summary>
            <div className="border-t p-2">
              <JsonView value={result.mql} maxHeight="16rem" />
            </div>
          </details>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <Button
          variant={view === "table" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setView("table")}
        >
          <Table2 /> {t("result.table")}
        </Button>
        <Button
          variant={view === "json" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setView("json")}
        >
          <Braces /> {t("result.json")}
        </Button>
        <Button
          variant={view === "chart" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setView("chart")}
          disabled={!ran}
        >
          <BarChart3 /> {t("result.chart")}
        </Button>
        <span className="text-muted-foreground ml-auto text-xs">
          {ran && result
            ? t(result.count === 1 ? "sql.rows" : "sql.rows_plural", { count: result.count }) +
              (result.total > result.count ? t("sql.ofMatching", { total: result.total }) : "")
            : t("sql.notRun")}
        </span>
      </div>

      {ran && view === "chart" ? (
        <ChartView
          className="min-h-0 flex-1"
          documents={documents}
          columns={columns}
          storageKey={`sql:${connectionId}:${database}:${collection}`}
        />
      ) : (
        <div className="scrollbar-thin min-h-0 flex-1 overflow-auto p-3">
          {!ran ? (
            <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
              {t("sql.placeholder")}
            </div>
          ) : view === "json" ? (
            <JsonView value={documents} maxHeight="none" />
          ) : documents.length === 0 ? (
          <div className="text-muted-foreground flex h-32 items-center justify-center text-sm">
            {t("sql.empty")}
          </div>
        ) : (
          <Table>
            <TableHeader className="bg-background sticky top-0 z-10">
              <TableRow className="hover:bg-transparent">
                {columns.map((column) => (
                  <TableHead key={column} className="font-mono text-xs">
                    {column}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((doc, index) => (
                <TableRow key={index}>
                  {columns.map((column) => {
                    const value = doc[column]
                    return (
                      <TableCell key={column} className="max-w-[320px] truncate">
                        <span
                          className={cn("font-mono text-xs", classForType(valueType(value)))}
                          title={formatValue(value)}
                        >
                          {formatValue(value).slice(0, 90)}
                        </span>
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          )}
        </div>
      )}
    </div>
  )
}
