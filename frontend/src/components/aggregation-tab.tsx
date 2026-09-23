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
import { JsonEditor } from "@/components/json-editor"
import { JsonView } from "@/components/json-view"
import { api } from "@/lib/api"
import { classForType, collectColumns, formatValue, valueType } from "@/lib/mongo"
import { cn } from "@/lib/utils"
import type { MongoDocument } from "@/lib/types"

interface AggregationTabProps {
  connectionId: string
  database: string
  collection: string
}

const EXAMPLES: { label: string; pipeline: string }[] = [
  {
    label: "Limit 10",
    pipeline: `[\n  { "$limit": 10 }\n]`,
  },
  {
    label: "Sort newest",
    pipeline: `[\n  { "$sort": { "_id": -1 } },\n  { "$limit": 20 }\n]`,
  },
  {
    label: "Group & count",
    pipeline: `[\n  { "$group": { "_id": "$status", "count": { "$sum": 1 } } },\n  { "$sort": { "count": -1 } }\n]`,
  },
  {
    label: "Field stats",
    pipeline: `[\n  { "$sample": { "size": 100 } },\n  { "$project": { "name": 1 } }\n]`,
  },
]

export function AggregationTab({ connectionId, database, collection }: AggregationTabProps) {
  const [pipeline, setPipeline] = React.useState("[\n  { \"$limit\": 20 }\n]")
  const [limit, setLimit] = React.useState("")
  const [documents, setDocuments] = React.useState<MongoDocument[]>([])
  const [loading, setLoading] = React.useState(false)
  const [ran, setRan] = React.useState(false)
  const [view, setView] = React.useState<"table" | "json">("table")

  const run = async () => {
    let parsed: unknown
    try {
      parsed = JSON.parse(pipeline.trim() || "[]")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Pipeline is not valid JSON")
      return
    }
    if (!Array.isArray(parsed)) {
      toast.error("Pipeline must be an array of stages")
      return
    }
    setLoading(true)
    try {
      const res = await api.aggregate(
        connectionId,
        database,
        collection,
        parsed,
        limit.trim() ? Number(limit) : undefined,
      )
      setDocuments(res.documents)
      setRan(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Aggregation failed")
    } finally {
      setLoading(false)
    }
  }

  const columns = React.useMemo(() => collectColumns(documents), [documents])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-3 border-b p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Pipeline</span>
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((example) => (
              <button
                key={example.label}
                type="button"
                onClick={() => setPipeline(example.pipeline)}
                className="text-muted-foreground hover:text-foreground hover:bg-accent rounded-full border px-2.5 py-0.5 text-xs transition-colors"
              >
                {example.label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Label htmlFor="agg-limit" className="text-muted-foreground text-xs">
              Post-limit
            </Label>
            <Input
              id="agg-limit"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              placeholder="none"
              className="h-8 w-20 font-mono text-xs"
              inputMode="numeric"
            />
            <Button onClick={() => void run()} disabled={loading} size="sm">
              {loading ? <Loader2 className="animate-spin" /> : <Play />}
              Run
            </Button>
          </div>
        </div>
        <JsonEditor
          value={pipeline}
          onChange={setPipeline}
          rows={6}
          className="min-h-[8rem]"
          placeholder='[ { "$match": {} } ]'
        />
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
          {ran ? `${documents.length} result${documents.length === 1 ? "" : "s"}` : "Not run yet"}
        </span>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-auto p-3">
        {!ran ? (
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
            Write a pipeline and press Run.
          </div>
        ) : view === "json" ? (
          <JsonView value={documents} maxHeight="none" />
        ) : documents.length === 0 ? (
          <div className="text-muted-foreground flex h-32 items-center justify-center text-sm">
            No results.
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
