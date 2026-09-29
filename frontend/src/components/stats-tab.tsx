import * as React from "react"
import { BarChart3, Loader2, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { JsonView } from "@/components/json-view"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { formatBytes } from "@/lib/mongo"

interface StatsTabProps {
  connectionId: string
  database: string
  collection: string
}

function number(value: unknown): number {
  if (typeof value === "number") return value
  if (typeof value === "string") return Number(value)
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    if ("$numberLong" in record) return Number(record.$numberLong)
    if ("$numberDouble" in record) return Number(record.$numberDouble)
    if ("$numberInt" in record) return Number(record.$numberInt)
  }
  return 0
}

function StatCard({ title, value, hint }: { title: string; value: string; hint?: string }) {
  return (
    <Card className="gap-0 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
        {hint ? <p className="text-muted-foreground mt-1 text-xs">{hint}</p> : null}
      </CardContent>
    </Card>
  )
}

export function StatsTab({ connectionId, database, collection }: StatsTabProps) {
  const { t } = useI18n()
  const [collectionStats, setCollectionStats] = React.useState<Record<string, unknown> | null>(null)
  const [databaseStats, setDatabaseStats] = React.useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const [colStats, dbStats] = await Promise.all([
        api.collectionStats(connectionId, database, collection),
        api.databaseStats(connectionId, database).catch(() => null),
      ])
      setCollectionStats(colStats)
      setDatabaseStats(dbStats)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("stats.failed"))
    } finally {
      setLoading(false)
    }
  }, [connectionId, database, collection])

  React.useEffect(() => {
    void load()
  }, [load])

  const stats = collectionStats ?? {}
  const count = number(stats.count)
  const size = number(stats.size)
  const storageSize = number(stats.storageSize)
  const avgObjSize = number(stats.avgObjSize)
  const totalIndexSize = number(stats.totalIndexSize)
  const nindexes = number(stats.nindexes)

  return (
    <div className="scrollbar-thin h-full min-h-0 overflow-auto">
      <div className="flex items-center gap-3 border-b p-3">
        <BarChart3 className="text-muted-foreground size-4" />
        <span className="text-sm font-medium">Collection statistics</span>
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => void load()}>
          {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />} Refresh
        </Button>
      </div>

      <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard title={t("stats.documents")} value={count.toLocaleString()} />
        <StatCard title={t("stats.logicalSize")} value={formatBytes(size)} hint={`${size.toLocaleString()} bytes`} />
        <StatCard title={t("stats.storageSize")} value={formatBytes(storageSize)} />
        <StatCard title="Avg. document" value={formatBytes(avgObjSize)} />
        <StatCard title={t("stats.indexes")} value={String(nindexes)} hint={formatBytes(totalIndexSize)} />
        <StatCard
          title={t("stats.capped")}
          value={stats.capped ? "Yes" : "No"}
          hint={typeof stats.ns === "string" ? stats.ns : undefined}
        />
      </div>

      <div className="space-y-6 p-3 pt-0">
        <section className="space-y-2">
          <h3 className="text-sm font-medium">collStats</h3>
          <JsonView value={collectionStats ?? {}} maxHeight="24rem" />
        </section>
        {databaseStats ? (
          <section className="space-y-2">
            <h3 className="text-sm font-medium">dbStats</h3>
            <JsonView value={databaseStats} maxHeight="24rem" />
          </section>
        ) : null}
      </div>
    </div>
  )
}
