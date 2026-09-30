import * as React from "react"
import { Activity, BarChart3, Braces, Loader2, Play, Table2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { ChartView } from "@/components/chart-view"
import { ExplainDialog } from "@/components/explain-dialog"
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
import { useI18n } from "@/lib/i18n"
import { classForType, collectColumns, formatValue, valueType } from "@/lib/mongo"
import { cn } from "@/lib/utils"
import type { MongoDocument } from "@/lib/types"

interface AggregationTabProps {
  connectionId: string
  database: string
  collection: string
}

const EXAMPLES: { labelKey: string; pipeline: string }[] = [
  {
    labelKey: "agg.example.limit",
    pipeline: `[\n  { "$limit": 10 }\n]`,
  },
  {
    labelKey: "agg.example.sort",
    pipeline: `[\n  { "$sort": { "_id": -1 } },\n  { "$limit": 20 }\n]`,
  },
  {
    labelKey: "agg.example.group",
    pipeline: `[\n  { "$group": { "_id": "$status", "count": { "$sum": 1 } } },\n  { "$sort": { "count": -1 } }\n]`,
  },
  {
    labelKey: "agg.example.sample",
    pipeline: `[\n  { "$sample": { "size": 100 } },\n  { "$project": { "name": 1 } }\n]`,
  },
]

export function AggregationTab({ connectionId, database, collection }: AggregationTabProps) {
  const { t } = useI18n()
  const [pipeline, setPipeline] = React.useState("[\n  { \"$limit\": 20 }\n]")
  const [limit, setLimit] = React.useState("")
  const [documents, setDocuments] = React.useState<MongoDocument[]>([])
  const [loading, setLoading] = React.useState(false)
  const [ran, setRan] = React.useState(false)
  const [view, setView] = React.useState<"table" | "json" | "chart">("table")
  const [explainOpen, setExplainOpen] = React.useState(false)
  const [explainPipeline, setExplainPipeline] = React.useState<unknown[] | null>(null)

  const explainRequest = React.useMemo(
    () => (explainPipeline ? { type: "aggregate" as const, pipeline: explainPipeline } : null),
    [explainPipeline],
  )

  const run = async () => {
    let parsed: unknown
    try {
      parsed = JSON.parse(pipeline.trim() || "[]")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("agg.notJson"))
      return
    }
    if (!Array.isArray(parsed)) {
      toast.error(t("agg.mustBeArray"))
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
      toast.error(err instanceof Error ? err.message : t("agg.failed"))
    } finally {
      setLoading(false)
    }
  }

  const columns = React.useMemo(() => collectColumns(documents), [documents])

  const explain = () => {
    let parsed: unknown
    try {
      parsed = JSON.parse(pipeline.trim() || "[]")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("agg.notJson"))
      return
    }
    if (!Array.isArray(parsed)) {
      toast.error(t("agg.mustBeArray"))
      return
    }
    setExplainPipeline(parsed)
    setExplainOpen(true)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-3 border-b p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{t("agg.pipeline")}</span>
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((example) => (
              <button
                key={example.labelKey}
                type="button"
                onClick={() => setPipeline(example.pipeline)}
                className="text-muted-foreground hover:text-foreground hover:bg-accent rounded-full border px-2.5 py-0.5 text-xs transition-colors"
              >
                {t(example.labelKey)}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Label htmlFor="agg-limit" className="text-muted-foreground text-xs">
              {t("agg.postLimit")}
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
              {t("common.run")}
            </Button>
            <Button onClick={explain} disabled={loading} size="sm" variant="outline">
              <Activity /> {t("explain.title")}
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
          {ran
            ? t(documents.length === 1 ? "sql.rows" : "sql.rows_plural", {
                count: documents.length,
              })
            : t("agg.notRun")}
        </span>
      </div>

      {ran && view === "chart" ? (
        <ChartView
          className="min-h-0 flex-1"
          documents={documents}
          columns={columns}
          storageKey={`agg:${connectionId}:${database}:${collection}`}
        />
      ) : (
        <div className="scrollbar-thin min-h-0 flex-1 overflow-auto p-3">
          {!ran ? (
            <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
              {t("agg.placeholder")}
            </div>
          ) : view === "json" ? (
            <JsonView value={documents} maxHeight="none" />
          ) : documents.length === 0 ? (
            <div className="text-muted-foreground flex h-32 items-center justify-center text-sm">
              {t("agg.empty")}
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

      <ExplainDialog
        open={explainOpen}
        onOpenChange={setExplainOpen}
        connectionId={connectionId}
        database={database}
        collection={collection}
        request={explainRequest}
      />
    </div>
  )
}
