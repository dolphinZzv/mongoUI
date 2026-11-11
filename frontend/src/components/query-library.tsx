import * as React from "react"
import { Bookmark, Loader2, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import type { SavedQuery } from "@/lib/types"

interface QueryLibraryProps {
  scope: string
  kind: SavedQuery["kind"]
  text: string
  onPick: (text: string) => void
}

function newID(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  return `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** Team-shared SQL / aggregation snippets for the current collection scope. */
export function QueryLibrary({ scope, kind, text, onPick }: QueryLibraryProps) {
  const { t } = useI18n()
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState("")
  const [queries, setQueries] = React.useState<SavedQuery[]>([])
  const [version, setVersion] = React.useState(0)
  const [busy, setBusy] = React.useState(false)

  const load = React.useCallback(async () => {
    try {
      const result = await api.getSavedQueries(scope)
      setQueries(result.queries ?? [])
      setVersion(result.version ?? 0)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("queryLibrary.failed"))
    }
  }, [scope, t])

  React.useEffect(() => {
    if (!open) return
    setQueries([])
    setVersion(0)
    void load()
  }, [open, load])

  const persist = async (next: SavedQuery[]) => {
    setBusy(true)
    try {
      const result = await api.saveSavedQueries(scope, next, version)
      setQueries(result.queries ?? [])
      setVersion(result.version ?? version + 1)
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("queryLibrary.conflict"))
      await load()
      return false
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error(t("queryLibrary.nameRequired"))
      return
    }
    if (!text.trim()) {
      toast.error(t("queryLibrary.textRequired"))
      return
    }
    const existing = queries.find((query) => query.kind === kind && query.name === trimmed)
    const next = existing
      ? queries.map((query) => (query.id === existing.id ? { ...query, text } : query))
      : [{ id: newID(), name: trimmed, kind, text }, ...queries]
    if (await persist(next)) {
      setName("")
      toast.success(t("queryLibrary.saved"))
    }
  }

  const remove = async (query: SavedQuery) => {
    if (await persist(queries.filter((item) => item.id !== query.id))) {
      toast.success(t("queryLibrary.deleted"))
    }
  }

  const visible = queries.filter((query) => query.kind === kind)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          title={t("queryLibrary.title")}
          aria-label={t("queryLibrary.title")}
        >
          <Bookmark />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 gap-2">
        <div className="flex items-center gap-2">
          <Bookmark className="text-primary size-4" />
          <span className="text-sm font-medium">{t("queryLibrary.title")}</span>
          <span className="text-muted-foreground ml-auto text-[11px]">
            {t("queryLibrary.count", { count: visible.length })}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("queryLibrary.namePlaceholder")}
            className="h-8 text-xs"
            onKeyDown={(event) => {
              if (event.key === "Enter") void save()
            }}
          />
          <Button size="sm" onClick={() => void save()} disabled={busy || !text.trim()}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            {t("queryLibrary.save")}
          </Button>
        </div>
        <div className="scrollbar-thin max-h-64 overflow-auto">
          {visible.length === 0 ? (
            <p className="text-muted-foreground px-1 py-6 text-center text-xs">
              {t("queryLibrary.empty")}
            </p>
          ) : (
            visible.map((query) => (
              <div
                key={query.id}
                className="hover:bg-accent flex items-center gap-2 rounded px-1 py-1.5"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => {
                    onPick(query.text)
                    setOpen(false)
                  }}
                  title={query.text}
                >
                  <span className="block truncate text-xs font-medium">{query.name}</span>
                  <span className="text-muted-foreground block truncate font-mono text-[11px]">
                    {query.text.replace(/\s+/g, " ")}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={t("queryLibrary.delete")}
                  title={t("queryLibrary.delete")}
                  className="text-muted-foreground hover:text-destructive shrink-0 rounded p-1"
                  onClick={() => void remove(query)}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
