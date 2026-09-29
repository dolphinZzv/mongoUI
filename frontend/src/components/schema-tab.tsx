import * as React from "react"
import { RefreshCw, ScanSearch } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import type { SchemaResult } from "@/lib/types"

interface SchemaTabProps {
  connectionId: string
  database: string
  collection: string
}

export function SchemaTab({ connectionId, database, collection }: SchemaTabProps) {
  const { t } = useI18n()
  const [schema, setSchema] = React.useState<SchemaResult | null>(null)
  const [loading, setLoading] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.collectionSchema(connectionId, database, collection)
      setSchema(res)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("schema.failed"))
    } finally {
      setLoading(false)
    }
  }, [connectionId, database, collection])

  React.useEffect(() => {
    void load()
  }, [load])

  const sampled = schema?.sampled ?? 0

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b p-3">
        <ScanSearch className="text-muted-foreground size-4" />
        <span className="text-sm">
          Sampled <span className="font-semibold">{sampled}</span> document
          {sampled === 1 ? "" : "s"}
        </span>
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => void load()}>
          <RefreshCw className={loading ? "animate-spin" : undefined} /> Re-sample
        </Button>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-auto">
        <Table>
          <TableHeader className="bg-background sticky top-0 z-10">
            <TableRow className="hover:bg-transparent">
              <TableHead>{t("schema.field")}</TableHead>
              <TableHead className="w-48">Coverage</TableHead>
              <TableHead>{t("schema.types")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!loading && (schema?.fields.length ?? 0) === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-muted-foreground h-24 text-center text-sm">
                  No documents to analyse.
                </TableCell>
              </TableRow>
            ) : null}
            {schema?.fields.map((field) => {
              const coverage = sampled > 0 ? Math.round((field.count / sampled) * 100) : 0
              return (
                <TableRow key={field.name}>
                  <TableCell className="font-mono text-xs font-medium">{field.name}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="bg-muted h-1.5 w-24 overflow-hidden rounded-full">
                        <div
                          className="bg-primary h-full rounded-full"
                          style={{ width: `${coverage}%` }}
                        />
                      </div>
                      <span className="text-muted-foreground text-xs">{coverage}%</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(field.types)
                        .sort((a, b) => b[1] - a[1])
                        .map(([type, count]) => (
                          <Badge key={type} variant="outline" className="font-mono">
                            {type}
                            <span className="text-muted-foreground ml-1">{count}</span>
                          </Badge>
                        ))}
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
