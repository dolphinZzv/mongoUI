import * as React from "react"
import { Database, Loader2, Search } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { prettyJSON } from "@/lib/mongo"
import type { Connection, DatabaseInfo, SearchHit, Selection } from "@/lib/types"

interface GlobalSearchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connections: Connection[]
  selection: Selection
  /** Prefill the term, e.g. when opened from the header quick search. */
  initialTerm?: string
  onOpenQuery: (selection: Selection, filter: string) => void
}

/** Search a value or field name across every collection of a database. */
export function GlobalSearchDialog({
  open,
  onOpenChange,
  connections,
  selection,
  initialTerm,
  onOpenQuery,
}: GlobalSearchDialogProps) {
  const { t } = useI18n()
  const [connectionId, setConnectionId] = React.useState("")
  const [database, setDatabase] = React.useState("")
  const [databases, setDatabases] = React.useState<DatabaseInfo[]>([])
  const [term, setTerm] = React.useState("")
  const [mode, setMode] = React.useState<"value" | "field">("value")
  const [field, setField] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const [searched, setSearched] = React.useState(false)
  const [results, setResults] = React.useState<SearchHit[]>([])

  React.useEffect(() => {
    if (!open) return
    setTerm(initialTerm ?? "")
  }, [open, initialTerm])

  React.useEffect(() => {
    if (!open) return
    setSearched(false)
    setResults([])
    if (selection.kind !== "welcome") {
      setConnectionId(selection.connectionId)
      if (selection.kind === "collection") setDatabase(selection.database)
    } else if (connections[0]) {
      setConnectionId(connections[0].id)
    }
  }, [open, selection, connections])

  React.useEffect(() => {
    if (!open || !connectionId) return
    let cancelled = false
    void api
      .listDatabases(connectionId)
      .then((res) => {
        if (cancelled) return
        setDatabases(res.databases)
        setDatabase((prev) =>
          res.databases.some((entry) => entry.name === prev) ? prev : (res.databases[0]?.name ?? ""),
        )
      })
      .catch((err) => {
        if (!cancelled) toast.error(err instanceof Error ? err.message : t("search.failed"))
      })
    return () => {
      cancelled = true
    }
  }, [open, connectionId, t])

  const runSearch = async () => {
    const trimmed = term.trim()
    if (!connectionId || !database || trimmed.length < 2) return
    setLoading(true)
    try {
      const res = await api.searchDatabase(connectionId, database, {
        term: trimmed,
        mode,
        field: mode === "value" ? field.trim() || undefined : undefined,
      })
      setResults(res.results)
      setSearched(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("search.failed"))
    } finally {
      setLoading(false)
    }
  }

  const openHit = (hit: SearchHit) => {
    const filter = field.trim()
      ? JSON.stringify({ [field.trim()]: { $regex: term.trim(), $options: "i" } })
      : "{}"
    onOpenQuery({ kind: "collection", connectionId, database, collection: hit.collection }, filter)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("search.title")}</DialogTitle>
          <DialogDescription>{t("search.desc")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">{t("search.connection")}</Label>
            <Select value={connectionId} onValueChange={setConnectionId}>
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {connections.map((connection) => (
                  <SelectItem key={connection.id} value={connection.id}>
                    {connection.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("search.database")}</Label>
            <Select value={database} onValueChange={setDatabase}>
              <SelectTrigger size="sm" className="w-full">
                <SelectValue placeholder={t("search.database")} />
              </SelectTrigger>
              <SelectContent>
                {databases.map((entry) => (
                  <SelectItem key={entry.name} value={entry.name}>
                    {entry.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">{t("search.mode")}</Label>
            <div className="flex gap-2">
              <Select value={mode} onValueChange={(value) => setMode(value as "value" | "field")}>
                <SelectTrigger size="sm" className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="value">{t("search.modeValue")}</SelectItem>
                  <SelectItem value="field">{t("search.modeField")}</SelectItem>
                </SelectContent>
              </Select>
              {mode === "value" ? (
                <Input
                  value={field}
                  onChange={(event) => setField(event.target.value)}
                  placeholder={t("search.field")}
                  spellCheck={false}
                  className="h-8 flex-1 font-mono text-xs"
                />
              ) : null}
            </div>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">{t("search.term")}</Label>
            <div className="flex gap-2">
              <Input
                autoFocus
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    void runSearch()
                  }
                }}
                placeholder={t("search.termPlaceholder")}
                className="h-9 flex-1"
              />
              <Button
                onClick={() => void runSearch()}
                disabled={loading || term.trim().length < 2 || !database}
              >
                {loading ? <Loader2 className="animate-spin" /> : <Search />}
                {t("search.action")}
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">{t("search.hint")}</p>
          </div>
        </div>

        <div className="scrollbar-thin max-h-[45vh] overflow-auto">
          {searched && !loading && results.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">{t("search.empty")}</p>
          ) : null}
          <div className="space-y-2">
            {results.map((hit) => (
              <div key={hit.collection} className="rounded-md border p-2">
                <div className="flex items-center gap-2">
                  <Database className="text-muted-foreground size-4 shrink-0" />
                  <button
                    type="button"
                    onClick={() => openHit(hit)}
                    className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline"
                  >
                    {hit.collection}
                  </button>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {t("search.matches", { count: hit.count })}
                  </span>
                  <Button variant="outline" size="sm" onClick={() => openHit(hit)}>
                    {t("search.open")}
                  </Button>
                </div>
                {hit.sample[0] ? (
                  <pre className="bg-muted/40 scrollbar-thin mt-2 max-h-32 overflow-auto rounded p-2 font-mono text-[11px]">
                    {prettyJSON(hit.sample[0])}
                  </pre>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
