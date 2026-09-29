import * as React from "react"
import { Braces, Loader2, Play, Table2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
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
import { Textarea } from "@/components/ui/textarea"
import { JsonView } from "@/components/json-view"
import { api } from "@/lib/api"
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

function templates(collection: string): { label: string; sql: string }[] {
  const c = quoteIdent(collection)
  return [
    { label: "All", sql: `SELECT * FROM ${c} LIMIT 50` },
    { label: "Count", sql: `SELECT COUNT(*) AS count FROM ${c}` },
    { label: "Distinct", sql: `SELECT DISTINCT status FROM ${c} LIMIT 100` },
    {
      label: "Group & count",
      sql: `SELECT status, COUNT(*) AS count\nFROM ${c}\nGROUP BY status\nORDER BY count DESC`,
    },
    {
      label: "Filter",
      sql: `SELECT * FROM ${c}\nWHERE status = 'active'\nORDER BY _id DESC\nLIMIT 20`,
    },
  ]
}

export function SqlTab({ connectionId, database, collection }: SqlTabProps) {
  const [query, setQuery] = React.useState(`SELECT * FROM ${quoteIdent(collection)} LIMIT 50`)
  const [limit, setLimit] = React.useState("")
  const [result, setResult] = React.useState<SQLResult | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [ran, setRan] = React.useState(false)
  const [view, setView] = React.useState<"table" | "json">("table")

  // Reset the editor when the selected collection changes.
  React.useEffect(() => {
    setQuery(`SELECT * FROM ${quoteIdent(collection)} LIMIT 50`)
    setResult(null)
    setRan(false)
  }, [collection])

  const run = React.useCallback(async () => {
    if (!query.trim()) {
      toast.error("Write a SQL query first")
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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "SQL query failed")
    } finally {
      setLoading(false)
    }
  }, [connectionId, database, query, limit])

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
                key={template.label}
                type="button"
                onClick={() => setQuery(template.sql)}
                className="text-muted-foreground hover:text-foreground hover:bg-accent rounded-full border px-2.5 py-0.5 text-xs transition-colors"
              >
                {template.label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Label htmlFor="sql-limit" className="text-muted-foreground text-xs">
              Limit
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
              Run
            </Button>
          </div>
        </div>

        <Textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoComplete="off"
          rows={5}
          placeholder={`SELECT * FROM ${quoteIdent(collection)} LIMIT 20`}
          className="scrollbar-thin max-h-[18rem] min-h-[7rem] resize-y font-mono text-xs leading-relaxed [field-sizing:fixed]"
        />
        <p className="text-muted-foreground text-xs">
          SELECT with WHERE / IN / LIKE / IS NULL, ORDER BY, LIMIT, GROUP BY, HAVING,
          DISTINCT and COUNT / SUM / AVG / MIN / MAX. Press Ctrl/⌘ + Enter to run.
        </p>

        {ran && result ? (
          <details className="rounded-md border">
            <summary className="text-muted-foreground hover:text-foreground cursor-pointer px-3 py-2 text-xs select-none">
              Generated MongoDB query
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
          <Table2 /> Table
        </Button>
        <Button
          variant={view === "json" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setView("json")}
        >
          <Braces /> JSON
        </Button>
        <span className="text-muted-foreground ml-auto text-xs">
          {ran && result
            ? `${result.count} row${result.count === 1 ? "" : "s"}` +
              (result.total > result.count ? ` of ${result.total} matching` : "")
            : "Not run yet"}
        </span>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-auto p-3">
        {!ran ? (
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
            Write a SQL query and press Run.
          </div>
        ) : view === "json" ? (
          <JsonView value={documents} maxHeight="none" />
        ) : documents.length === 0 ? (
          <div className="text-muted-foreground flex h-32 items-center justify-center text-sm">
            No rows returned.
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
    </div>
  )
}
