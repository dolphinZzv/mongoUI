import * as React from "react"
import { Loader2, Play, Plus, TrendingUp } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { JsonView } from "@/components/json-view"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { isPlainObject } from "@/lib/mongo"
import type { ExplainRequest, ExplainVerbosity } from "@/lib/types"

interface ExplainDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionId: string
  database: string
  collection: string
  request: Omit<ExplainRequest, "verbosity"> | null
}

/** Reads a numeric BSON value that may be encoded as Extended JSON. */
function numberOf(value: unknown): number | null {
  if (typeof value === "number") return value
  if (isPlainObject(value)) {
    for (const key of ["$numberInt", "$numberLong", "$numberDouble", "$numberDecimal"]) {
      if (key in value) {
        const n = Number(value[key])
        return Number.isFinite(n) ? n : null
      }
    }
  }
  return null
}

interface Stat {
  labelKey: string
  value: string
}

function summarize(result: Record<string, unknown> | null): { stats: Stat[]; topStage: string | null } {
  if (!result) return { stats: [], topStage: null }
  const stats: Stat[] = []
  const execution = isPlainObject(result.executionStats) ? result.executionStats : null
  if (execution) {
    const fields: [string, string][] = [
      ["explain.executionTimeMillis", "executionTimeMillis"],
      ["explain.totalKeysExamined", "totalKeysExamined"],
      ["explain.totalDocsExamined", "totalDocsExamined"],
      ["explain.nReturned", "nReturned"],
    ]
    for (const [labelKey, key] of fields) {
      const n = numberOf(execution[key])
      if (n !== null) stats.push({ labelKey, value: n.toLocaleString() })
    }
  }

  const planner = isPlainObject(result.queryPlanner) ? result.queryPlanner : null
  const winning = planner && isPlainObject(planner.winningPlan) ? planner.winningPlan : null
  let topStage: string | null = null
  if (winning) {
    topStage = typeof winning.stage === "string" ? winning.stage : winning.queryPlanner ? "COLLSCAN" : null
  }
  return { stats, topStage }
}

/**
 * Suggests a compound index for a find query that is not served by an index.
 * Equality fields come first, then sort fields, which matches MongoDB's
 * ESR-ish guidance for the common case.
 */
function suggestIndex(
  request: Omit<ExplainRequest, "verbosity"> | null,
  topStage: string | null,
): Record<string, 1 | -1> | null {
  if (!request || request.type !== "find") return null
  if (topStage && topStage !== "COLLSCAN") return null
  const index: Record<string, 1 | -1> = {}
  const add = (field: string, direction: 1 | -1) => {
    if (!field || field.startsWith("$") || field in index) return
    index[field] = direction
  }
  const filter = isPlainObject(request.filter) ? request.filter : {}
  for (const [key, value] of Object.entries(filter)) {
    if (key === "$and" && Array.isArray(value)) {
      for (const item of value) {
        if (isPlainObject(item)) for (const field of Object.keys(item)) add(field, 1)
      }
      continue
    }
    if (key.startsWith("$")) continue
    add(key, 1)
  }
  const sort = isPlainObject(request.sort) ? request.sort : null
  if (sort) for (const [field, direction] of Object.entries(sort)) add(field, direction === -1 ? -1 : 1)
  return Object.keys(index).length > 0 ? index : null
}

export function ExplainDialog({
  open,
  onOpenChange,
  connectionId,
  database,
  collection,
  request,
}: ExplainDialogProps) {
  const { t } = useI18n()
  const [verbosity, setVerbosity] = React.useState<ExplainVerbosity>("executionStats")
  const [result, setResult] = React.useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = React.useState(false)

  const run = React.useCallback(
    async (level: ExplainVerbosity, payload: Omit<ExplainRequest, "verbosity">) => {
      setLoading(true)
      try {
        const res = await api.explain(connectionId, database, collection, {
          ...payload,
          verbosity: level,
        })
        setResult(res)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("explain.failed"))
      } finally {
        setLoading(false)
      }
    },
    [connectionId, database, collection, t],
  )

  React.useEffect(() => {
    if (open && request) {
      setResult(null)
      void run(verbosity, request)
    }
    // Only re-run when the dialog opens or the query changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, request])

  const { stats, topStage } = summarize(result)
  const suggestion = suggestIndex(request, topStage)
  const millis = result && isPlainObject(result.executionStats)
    ? numberOf(result.executionStats.executionTimeMillis)
    : null
  const [creating, setCreating] = React.useState(false)

  const createIndex = async () => {
    if (!suggestion) return
    setCreating(true)
    try {
      const res = await api.createIndex(connectionId, database, collection, suggestion, {})
      toast.success(t("explain.indexCreated", { name: res.name }))
      if (request) void run(verbosity, request)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("explain.indexCreateFailed"))
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("explain.title")}</DialogTitle>
          <DialogDescription>
            {t("explain.desc", {
              type: request?.type === "aggregate" ? t("explain.aggregate") : t("explain.find"),
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex shrink-0 flex-wrap items-end gap-3 py-3">
          <div className="grid gap-1.5">
            <Label className="text-xs">{t("explain.verbosity")}</Label>
            <Select
              value={verbosity}
              onValueChange={(value) => {
                const next = value as ExplainVerbosity
                setVerbosity(next)
                if (request) void run(next, request)
              }}
            >
              <SelectTrigger size="sm" className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="queryPlanner">queryPlanner</SelectItem>
                <SelectItem value="executionStats">executionStats</SelectItem>
                <SelectItem value="allPlansExecution">allPlansExecution</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={loading || !request}
            onClick={() => request && void run(verbosity, request)}
          >
            {loading ? <Loader2 className="animate-spin" /> : <Play />}
            {t("explain.rerun")}
          </Button>
          {topStage ? (
            <span className="text-muted-foreground text-xs">
              {t("explain.winningStage")}:{" "}
              <span className="text-foreground font-mono">{topStage}</span>
            </span>
          ) : null}
          {millis !== null && millis >= 100 ? (
            <span className="text-xs text-amber-600 dark:text-amber-400">
              {t("explain.slow", { ms: millis })}
            </span>
          ) : null}
        </div>

        {stats.length > 0 ? (
          <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4">
            {stats.map((stat) => (
              <div key={stat.labelKey} className="rounded-lg border p-2.5">
                <div className="text-muted-foreground flex items-center gap-1 text-[11px]">
                  <TrendingUp className="size-3" />
                  {t(stat.labelKey)}
                </div>
                <div className="mt-0.5 font-mono text-sm">{stat.value}</div>
              </div>
            ))}
          </div>
        ) : null}

        {suggestion ? (
          <div className="shrink-0 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium">{t("explain.indexSuggestion")}</p>
                <p className="text-muted-foreground text-xs">{t("explain.indexSuggestionDesc")}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void createIndex()}
                disabled={creating}
              >
                {creating ? <Loader2 className="animate-spin" /> : <Plus />}
                {t("explain.createIndex")}
              </Button>
            </div>
            <pre className="bg-muted/40 scrollbar-thin mt-2 overflow-auto rounded p-2 font-mono text-[11px]">
              {`db.${collection}.createIndex(${JSON.stringify(suggestion)})`}
            </pre>
          </div>
        ) : null}

        <div className="mt-3 min-h-0 flex-1 overflow-auto">
          {loading ? (
            <div className="text-muted-foreground flex h-40 items-center justify-center">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : result ? (
            <JsonView value={result} maxHeight="none" />
          ) : (
            <div className="text-muted-foreground flex h-40 items-center justify-center text-sm">
              {t("explain.empty")}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
