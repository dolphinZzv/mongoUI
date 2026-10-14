import * as React from "react"
import { Eraser, Loader2, Play, ShieldAlert, SquareTerminal, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { JsonView } from "@/components/json-view"
import { RecentQueries } from "@/components/recent-queries"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { useRecentQueries } from "@/hooks/useRecentQueries"
import type { ScriptResult } from "@/lib/types"

interface ScriptPanelProps {
  connectionId: string
  database: string
  collection?: string
  readOnly?: boolean
  onClose: () => void
}

function initialScript(collection?: string): string {
  if (collection) return `db.${collection}.find({}).limit(20)`
  return "db.getCollectionNames()"
}

function templates(collection: string | undefined) {
  const c = collection ?? "collection"
  const now = new Date().toISOString()
  return [
    { key: "script.template.find", script: `db.${c}.find({}).limit(20)` },
    { key: "script.template.count", script: `db.${c}.countDocuments({})` },
    {
      key: "script.template.aggregate",
      script: `db.${c}.aggregate([\n  { $match: {} },\n  { $limit: 10 }\n])`,
    },
    {
      key: "script.template.insert",
      script: `db.${c}.insertOne({ name: "example", createdAt: ISODate("${now}") })`,
    },
    {
      key: "script.template.update",
      script: `db.${c}.updateMany({}, { $set: { updatedAt: ISODate("${now}") } })`,
    },
    { key: "script.template.names", script: "db.getCollectionNames()" },
    { key: "script.template.stats", script: "db.stats()" },
  ]
}

/** App-level right-hand console for running mongosh-style scripts. */
export function ScriptPanel({ connectionId, database, collection, readOnly, onClose }: ScriptPanelProps) {
  const { t } = useI18n()
  const [script, setScript] = React.useState(() => initialScript(collection))
  const [result, setResult] = React.useState<ScriptResult | null>(null)
  const [loading, setLoading] = React.useState(false)
  const { items: recent, push, clear } = useRecentQueries(`script:${connectionId}:${database}`)

  const run = React.useCallback(async () => {
    if (!script.trim()) {
      toast.error(t("script.writeFirst"))
      return
    }
    setLoading(true)
    try {
      const res = await api.runScript(connectionId, database, script)
      setResult(res)
      push(script)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("script.failed"))
    } finally {
      setLoading(false)
    }
  }, [connectionId, database, script, t, push])

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault()
      void run()
    }
  }

  return (
    <div className="bg-sidebar text-sidebar-foreground flex h-full min-h-0 flex-col border-l">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
        <SquareTerminal className="text-muted-foreground size-4" />
        <span className="font-medium">{t("script.title")}</span>
        <span className="text-muted-foreground ml-auto truncate font-mono text-xs" title={`${database}${collection ? ` / ${collection}` : ""}`}>
          {database}
          {collection ? ` / ${collection}` : ""}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          title={t("script.close")}
          aria-label={t("script.close")}
        >
          <X />
        </Button>
      </div>

      <div className="shrink-0 space-y-2 border-b p-3">
        <div className="flex flex-wrap gap-1.5">
          {templates(collection).map((template) => (
            <button
              key={template.key}
              type="button"
              onClick={() => setScript(template.script)}
              className="text-muted-foreground hover:text-foreground hover:bg-accent rounded-full border px-2.5 py-0.5 text-xs transition-colors"
            >
              {t(template.key)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => void run()} disabled={loading} size="sm">
            {loading ? <Loader2 className="animate-spin" /> : <Play />}
            {t("script.run")}
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              setScript("")
              setResult(null)
            }}
            title={t("common.clear")}
            aria-label={t("common.clear")}
          >
            <Eraser />
          </Button>
          <RecentQueries
            items={recent}
            onPick={(value) => setScript(value)}
            onClear={clear}
            className="ml-auto"
          />
        </div>
        <Textarea
          value={script}
          onChange={(event) => setScript(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("script.placeholder")}
          spellCheck={false}
          className="min-h-40 resize-y font-mono text-xs"
          data-testid="script-editor"
        />
        {readOnly ? (
          <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <ShieldAlert className="size-3.5 shrink-0" />
            {t("script.readOnly")}
          </p>
        ) : null}
        <p className="text-muted-foreground text-[11px] leading-relaxed">{t("script.help")}</p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        <p className="text-muted-foreground mb-2 text-[10px] tracking-wide uppercase">
          {t("script.results")}
        </p>
        {!result ? (
          <p className="text-muted-foreground text-xs">{t("script.noResults")}</p>
        ) : (
          <div className="space-y-2">
            {result.results.map((item, index) => (
              <div key={`${index}-${item.statement}`} className="rounded-md border">
                <div className="flex items-center gap-2 border-b px-2 py-1.5">
                  <Badge variant={item.ok ? "secondary" : "destructive"}>
                    {item.ok ? item.kind || "ok" : "error"}
                  </Badge>
                  {item.kind === "documents" ? (
                    <span className="text-muted-foreground text-[11px]">{item.count ?? 0}</span>
                  ) : null}
                  <code
                    className="text-muted-foreground truncate font-mono text-[11px]"
                    title={item.statement}
                  >
                    {item.statement}
                  </code>
                </div>
                <div className="p-2">
                  {item.error ? (
                    <p className="text-destructive font-mono text-xs break-words">{item.error}</p>
                  ) : item.kind === "documents" ? (
                    <JsonView value={item.documents ?? []} maxHeight="22rem" />
                  ) : (
                    <JsonView value={item.value ?? null} maxHeight="22rem" />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
