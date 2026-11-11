import * as React from "react"
import { Check, Copy, Lightbulb, Loader2, Plus, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { api } from "@/lib/api"
import { copyToClipboard } from "@/lib/clipboard"
import { useI18n } from "@/lib/i18n"
import { prettyJSON } from "@/lib/mongo"
import type { IndexStat } from "@/lib/types"

interface IndexAdvisorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionId: string
  database: string
  collection: string
  filter?: string
  sort?: string
}

function collectFields(value: unknown, fields: Set<string>) {
  if (!value || typeof value !== "object") return
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "$and" || key === "$or" || key === "$nor") {
      if (Array.isArray(child)) child.forEach((entry) => collectFields(entry, fields))
    } else if (!key.startsWith("$")) {
      fields.add(key)
    }
  }
}

/** Read-only index advisor: unused/duplicate indexes and a query-shaped suggestion. */
export function IndexAdvisorDialog({
  open,
  onOpenChange,
  connectionId,
  database,
  collection,
  filter,
  sort,
}: IndexAdvisorDialogProps) {
  const { t } = useI18n()
  const [stats, setStats] = React.useState<IndexStat[]>([])
  const [loading, setLoading] = React.useState(false)
  const [creating, setCreating] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [planStages, setPlanStages] = React.useState<string[]>([])

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await api.indexStats(connectionId, database, collection)
      setStats(result.indexes ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : t("advisor.loadFailed"))
    } finally {
      setLoading(false)
    }
  }, [connectionId, database, collection, t])

  React.useEffect(() => {
    if (!open) return
    void load()
    let parsedFilter: unknown = {}
    let parsedSort: unknown = undefined
    try {
      parsedFilter = JSON.parse(filter?.trim() || "{}")
    } catch {
      parsedFilter = {}
    }
    try {
      parsedSort = sort?.trim() ? JSON.parse(sort) : undefined
    } catch {
      parsedSort = undefined
    }
    void api
      .explain(connectionId, database, collection, {
        type: "find",
        filter: parsedFilter,
        sort: parsedSort,
      })
      .then((result) => {
        const stages: string[] = []
        const visit = (node: unknown) => {
          if (!node || typeof node !== "object") return
          const record = node as Record<string, unknown>
          if (typeof record.stage === "string") stages.push(record.stage)
          visit(record.inputStage)
          if (Array.isArray(record.inputStages)) record.inputStages.forEach(visit)
          if (Array.isArray(record.shards)) record.shards.forEach(visit)
        }
        const planner = (result as Record<string, unknown>).queryPlanner as
          | Record<string, unknown>
          | undefined
        visit(planner?.winningPlan)
        setPlanStages([...new Set(stages)])
      })
      .catch(() => setPlanStages([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, connectionId, database, collection, filter, sort])

  const suggestion = React.useMemo(() => {
    const fields = new Set<string>()
    try {
      collectFields(JSON.parse(filter?.trim() || "{}"), fields)
    } catch {
      /* ignore invalid filters */
    }
    try {
      const sortSpec = JSON.parse(sort?.trim() || "{}")
      if (sortSpec && typeof sortSpec === "object") {
        for (const key of Object.keys(sortSpec as Record<string, unknown>)) fields.add(key)
      }
    } catch {
      /* ignore invalid sort */
    }
    const names = [...fields].filter((field) => field !== "_id")
    if (names.length === 0) return null
    const keys = Object.fromEntries(names.map((field) => [field, 1]))
    const covered = stats.some((index) => {
      const indexFields = Object.keys(index.key ?? {})
      if (indexFields.length === 0) return false
      const first = names[0]
      return indexFields[0] === first
    })
    return covered ? null : keys
  }, [filter, sort, stats])

  const unused = stats.filter(
    (index) => index.name !== "_id_" && (index.accesses?.ops ?? 0) === 0,
  )
  const duplicates = stats.filter((index, position) => {
    const key = JSON.stringify(index.key ?? {})
    return stats.findIndex((other) => JSON.stringify(other.key ?? {}) === key) !== position
  })

  const createSuggestion = async () => {
    if (!suggestion) return
    setCreating(true)
    try {
      await api.createIndex(connectionId, database, collection, suggestion, {
        name: `adv_${Object.keys(suggestion).join("_")}`,
      })
      toast.success(t("advisor.created"))
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("advisor.createFailed"))
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-3 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("advisor.title")}</DialogTitle>
          <DialogDescription>{t("advisor.desc")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {t("common.refresh")}
          </Button>
          {error ? <span className="text-destructive text-xs">{error}</span> : null}
        </div>

        {unused.length > 0 ? (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
            <p className="flex items-center gap-1.5 font-medium">
              <Lightbulb className="size-3.5" /> {t("advisor.unused", { count: unused.length })}
            </p>
            <p className="text-muted-foreground mt-1 font-mono">
              {unused.map((index) => index.name).join(", ")}
            </p>
          </div>
        ) : null}

        {duplicates.length > 0 ? (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
            <p className="font-medium">{t("advisor.duplicates", { count: duplicates.length })}</p>
            <p className="text-muted-foreground mt-1 font-mono">
              {duplicates.map((index) => index.name).join(", ")}
            </p>
          </div>
        ) : null}

        {planStages.length > 0 ? (
          <div className="rounded-lg border p-3 text-xs">
            <p className="font-medium">{t("advisor.plan")}</p>
            <p className="text-muted-foreground mt-1 font-mono">
              {planStages.join(" → ")}
              {planStages.includes("COLLSCAN") ? ` · ${t("advisor.collscan")}` : ""}
            </p>
          </div>
        ) : null}

        {suggestion ? (
          <div className="rounded-lg border p-3">
            <p className="flex items-center gap-1.5 text-xs font-medium">
              <Lightbulb className="size-3.5" /> {t("advisor.suggestion")}
            </p>
            <pre className="scrollbar-thin mt-2 max-h-40 overflow-auto rounded bg-muted p-2 font-mono text-[11px]">
              {prettyJSON(suggestion)}
            </pre>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void createSuggestion()} disabled={creating}>
                {creating ? <Loader2 className="animate-spin" /> : <Plus />}
                {t("advisor.create")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void copyToClipboard(prettyJSON(suggestion)).then((ok) =>
                    ok ? toast.success(t("common.copied")) : toast.error(t("common.copyFailed")),
                  )
                }
              >
                <Copy /> {t("common.copy")}
              </Button>
            </div>
          </div>
        ) : null}

        <div className="scrollbar-thin min-h-0 flex-1 overflow-auto rounded-lg border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 sticky top-0">
              <tr>
                <th className="px-2 py-1 text-left font-medium">{t("indexes.name")}</th>
                <th className="px-2 py-1 text-left font-medium">{t("indexes.keys")}</th>
                <th className="px-2 py-1 text-right font-medium">{t("advisor.ops")}</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((index) => {
                const isUnused = unused.some((entry) => entry.name === index.name)
                return (
                  <tr key={index.name} className="border-t">
                    <td className="px-2 py-1 font-mono">
                      <span className="flex items-center gap-1">
                        {index.name}
                        {isUnused ? <Check className="size-3 text-amber-500" /> : null}
                      </span>
                    </td>
                    <td className="px-2 py-1 font-mono">{JSON.stringify(index.key ?? {})}</td>
                    <td className="px-2 py-1 text-right font-mono">
                      {index.accesses?.ops ?? 0}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  )
}
