import * as React from "react"
import { Activity, Copy, Loader2, Play } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { AggregationBuilder } from "@/components/aggregation/builder"
import { ExplainDialog } from "@/components/explain-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { JsonEditor } from "@/components/json-editor"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { QueryLibrary } from "@/components/query-library"
import { QueryResultPanel } from "@/components/query-result-panel"
import { RecentQueries } from "@/components/recent-queries"
import { useRecentQueries } from "@/hooks/useRecentQueries"
import { api, isAbortError } from "@/lib/api"
import { copyToClipboard } from "@/lib/clipboard"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { columnPrefsKey, readColumnPrefs } from "@/lib/columnPrefs"
import { collectColumns } from "@/lib/mongo"
import { toAggregateJS } from "@/lib/queryText"
import type { MongoDocument } from "@/lib/types"

interface AggregationTabProps {
  connectionId: string
  database: string
  collection: string
  /** SQL / aggregation switch rendered inside the query toolbar. */
  modeSwitch?: React.ReactNode
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

function readStored(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) || fallback
  } catch {
    return fallback
  }
}

const DEFAULT_PIPELINE = "[\n  { \"$limit\": 20 }\n]"

export function AggregationTab({
  connectionId,
  database,
  collection,
  modeSwitch,
}: AggregationTabProps) {
  const { t } = useI18n()
  const [sourceDatabase, setSourceDatabase] = React.useState(database)
  const [sourceCollection, setSourceCollection] = React.useState(collection)
  const pipelineStorageKey = `mongoui-agg:${connectionId}:${sourceDatabase}:${sourceCollection}`
  const [pipeline, setPipeline] = React.useState(() =>
    readStored(pipelineStorageKey, DEFAULT_PIPELINE),
  )
  const [limit, setLimit] = React.useState("")
  const [documents, setDocuments] = React.useState<MongoDocument[]>([])
  const [databases, setDatabases] = React.useState<string[]>([database])
  const [collections, setCollections] = React.useState<string[]>([collection])
  const columnPrefs = React.useMemo(
    () => readColumnPrefs(columnPrefsKey(connectionId, sourceDatabase, sourceCollection)),
    [connectionId, sourceDatabase, sourceCollection],
  )
  const [durationMs, setDurationMs] = React.useState<number | undefined>()
  const [loading, setLoading] = React.useState(false)
  const [ran, setRan] = React.useState(false)
  const [page, setPage] = React.useState({ skip: 0, limit: 0, hasMore: false })
  const abortRef = React.useRef<AbortController | null>(null)
  const [view, setView] = React.useState<"table" | "json" | "chart">("table")
  const [mode, setMode] = React.useState<"visual" | "json">("visual")
  const [explainOpen, setExplainOpen] = React.useState(false)
  const [explainPipeline, setExplainPipeline] = React.useState<unknown[] | null>(null)
  const {
    items: recentPipelines,
    push: pushRecentPipeline,
    clear: clearRecentPipelines,
    favorites: favoritePipelines,
    toggleFavorite: toggleFavoritePipeline,
    removeFavorite: removeFavoritePipeline,
    metaFor: recentPipelineMeta,
  } = useRecentQueries(`agg:${connectionId}:${sourceDatabase}:${sourceCollection}`)

  const explainRequest = React.useMemo(
    () => (explainPipeline ? { type: "aggregate" as const, pipeline: explainPipeline } : null),
    [explainPipeline],
  )

  React.useEffect(() => {
    setSourceDatabase(database)
    setSourceCollection(collection)
  }, [database, collection])

  React.useEffect(() => {
    setPipeline(readStored(pipelineStorageKey, DEFAULT_PIPELINE))
    setRan(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineStorageKey])

  React.useEffect(() => {
    try {
      localStorage.setItem(pipelineStorageKey, pipeline)
    } catch {
      /* storage may be unavailable */
    }
  }, [pipeline, pipelineStorageKey])

  React.useEffect(() => {
    let cancelled = false
    void api
      .listDatabases(connectionId)
      .then((result) => {
        if (cancelled) return
        const names = result.databases.map((item) => item.name)
        setDatabases(names.length > 0 ? names : [database])
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [connectionId, database])

  React.useEffect(() => {
    let cancelled = false
    void api
      .listCollections(connectionId, sourceDatabase)
      .then((result) => {
        if (cancelled) return
        const names = result.map((item) => item.name)
        setCollections(names.length > 0 ? names : [sourceCollection])
        setSourceCollection((previous) =>
          names.includes(previous) ? previous : (names[0] ?? ""),
        )
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [connectionId, sourceDatabase])

  React.useEffect(() => () => abortRef.current?.abort(), [])

  const cancel = () => {
    if (!abortRef.current) return
    abortRef.current.abort()
    abortRef.current = null
    setLoading(false)
    toast.info(t("docs.cancelled"))
  }

  const execute = async (skipValue: number, record: boolean) => {
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
    if (!sourceDatabase || !sourceCollection) {
      toast.error(t("agg.sourceRequired"))
      return
    }
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setDurationMs(undefined)
    try {
      const res = await api.aggregate(
        connectionId,
        sourceDatabase,
        sourceCollection,
        parsed,
        limit.trim() ? Number(limit) : undefined,
        controller.signal,
        skipValue,
      )
      setDocuments(res.documents)
      setDurationMs(res.durationMs)
      setPage({
        skip: res.skip ?? skipValue,
        limit: res.limit ?? res.documents.length,
        hasMore: Boolean(res.hasMore),
      })
      setRan(true)
      if (record) {
        pushRecentPipeline(pipeline, {
          rows: res.documents.length,
          durationMs: res.durationMs,
          at: Date.now(),
        })
      }
    } catch (err) {
      if (isAbortError(err)) return
      toast.error(err instanceof Error ? err.message : t("agg.failed"))
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
        setLoading(false)
      }
    }
  }

  const run = () => void execute(0, true)

  const movePage = (direction: -1 | 1) => {
    const size = page.limit > 0 ? page.limit : 50
    void execute(Math.max(0, page.skip + direction * size), false)
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
          {modeSwitch}
          <span className="text-sm font-medium">{t("agg.pipeline")}</span>
          <div className="flex items-center gap-1">
            <Select
              value={sourceDatabase || undefined}
              onValueChange={setSourceDatabase}
            >
              <SelectTrigger size="sm" className="w-36 font-mono text-xs">
                <SelectValue placeholder={t("agg.database")} />
              </SelectTrigger>
              <SelectContent>
                {databases.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-muted-foreground text-xs">/</span>
            <Select
              value={sourceCollection || undefined}
              onValueChange={setSourceCollection}
            >
              <SelectTrigger size="sm" className="w-40 font-mono text-xs">
                <SelectValue placeholder={t("agg.collection")} />
              </SelectTrigger>
              <SelectContent>
                {collections.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1 rounded-md border p-0.5">
            <button
              type="button"
              onClick={() => setMode("visual")}
              className={cn(
                "rounded px-2 py-1 text-xs transition-colors",
                mode === "visual"
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t("agg.visual")}
            </button>
            <button
              type="button"
              onClick={() => setMode("json")}
              className={cn(
                "rounded px-2 py-1 text-xs transition-colors",
                mode === "json"
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t("agg.json")}
            </button>
          </div>
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
            <QueryLibrary
              scope={`${connectionId}::${sourceDatabase}::${sourceCollection}`}
              kind="aggregation"
              text={pipeline}
              onPick={setPipeline}
            />
            <RecentQueries
              items={recentPipelines}
              favorites={favoritePipelines}
              onPick={setPipeline}
              onClear={clearRecentPipelines}
              onToggleFavorite={toggleFavoritePipeline}
              onRemoveFavorite={removeFavoritePipeline}
              metaFor={recentPipelineMeta}
            />
            <Button onClick={() => void run()} disabled={loading} size="sm">
              {loading ? <Loader2 className="animate-spin" /> : <Play />}
              {t("common.run")}
            </Button>
            <Button onClick={explain} disabled={loading} size="sm" variant="outline">
              <Activity /> {t("explain.title")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void copyToClipboard(
                  toAggregateJS(sourceCollection, pipeline, sourceDatabase),
                ).then((ok) =>
                  ok ? toast.success(t("common.copied")) : toast.error(t("common.copyFailed")),
                )
              }
            >
              <Copy /> {t("agg.copyJs")}
            </Button>
          </div>
        </div>
        {mode === "visual" ? (
          <AggregationBuilder pipeline={pipeline} onChange={setPipeline} />
        ) : (
          <JsonEditor
            value={pipeline}
            onChange={setPipeline}
            rows={6}
            className="min-h-[8rem]"
            placeholder='[ { "$match": {} } ]'
          />
        )}
      </div>

      <QueryResultPanel
        ran={ran}
        view={view}
        onViewChange={setView}
        documents={documents}
        columns={columns}
        storageKey={`agg:${connectionId}:${sourceDatabase}:${sourceCollection}`}
        count={documents.length}
        durationMs={durationMs}
        notRunText={t("agg.notRun")}
        emptyText={t("agg.empty")}
        loading={loading}
        onCancel={cancel}
        pagination={
          ran
            ? {
                skip: page.skip,
                count: documents.length,
                hasMore: page.hasMore,
                onPrev: () => movePage(-1),
                onNext: () => movePage(1),
              }
            : undefined
        }
        dictionaries={columnPrefs.dictionaries}
        renderers={columnPrefs.renderers}
        colors={columnPrefs.colors}
      />

      <ExplainDialog
        open={explainOpen}
        onOpenChange={setExplainOpen}
        connectionId={connectionId}
        database={sourceDatabase}
        collection={sourceCollection}
        request={explainRequest}
      />
    </div>
  )
}
