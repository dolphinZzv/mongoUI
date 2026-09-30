import * as React from "react"
import { Loader2, Play, TrendingUp } from "lucide-react"
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
