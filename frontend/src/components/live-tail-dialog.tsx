import * as React from "react"
import { Loader2, Play, Square, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { JsonEditor } from "@/components/json-editor"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { prettyJSON } from "@/lib/mongo"

interface LiveTailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionId: string
  database: string
  collection: string
  initialFilter?: string
}

interface TailEvent {
  at: string
  payload: unknown
}

/** Server-Sent Events view of a collection's change stream. */
export function LiveTailDialog({
  open,
  onOpenChange,
  connectionId,
  database,
  collection,
  initialFilter,
}: LiveTailDialogProps) {
  const { t } = useI18n()
  const [filterText, setFilterText] = React.useState(initialFilter ?? "{}")
  const [running, setRunning] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [events, setEvents] = React.useState<TailEvent[]>([])
  const sourceRef = React.useRef<EventSource | null>(null)

  const stop = React.useCallback(() => {
    sourceRef.current?.close()
    sourceRef.current = null
    setRunning(false)
  }, [])

  React.useEffect(() => {
    if (!open) stop()
    return () => stop()
  }, [open, stop])

  React.useEffect(() => {
    if (!open) return
    setFilterText(initialFilter ?? "{}")
    setEvents([])
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const start = () => {
    let parsed: unknown
    try {
      parsed = JSON.parse(filterText.trim() || "{}")
    } catch {
      setError(t("docs.invalidJson"))
      return
    }
    stop()
    setEvents([])
    setError(null)
    const source = new EventSource(
      api.watchUrl(connectionId, database, collection, JSON.stringify(parsed)),
    )
    sourceRef.current = source
    setRunning(true)
    source.onopen = () => setError(null)
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as unknown
        setEvents((prev) => [
          { at: new Date().toLocaleTimeString(), payload },
          ...prev,
        ].slice(0, 200))
      } catch {
        /* ignore malformed frames */
      }
    }
    source.addEventListener("error", () => {
      setError(t("live.error"))
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-3 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("live.title")}</DialogTitle>
          <DialogDescription>{t("live.desc")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          <p className="text-muted-foreground text-xs">{t("live.filter")}</p>
          <JsonEditor
            value={filterText}
            onChange={setFilterText}
            rows={3}
            className="min-h-[4.5rem]"
            placeholder='{ "operationType": "insert" }'
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {running ? (
            <Button variant="outline" size="sm" onClick={stop}>
              <Square /> {t("live.stop")}
            </Button>
          ) : (
            <Button size="sm" onClick={start}>
              <Play /> {t("live.start")}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEvents([])}
            disabled={events.length === 0}
          >
            <Trash2 /> {t("live.clear")}
          </Button>
          <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
            {running ? (
              <>
                <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
                {t("live.connected")}
              </>
            ) : (
              t("live.waiting")
            )}
          </span>
          {error ? <span className="text-destructive text-xs">{error}</span> : null}
        </div>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-auto rounded-lg border">
          {events.length === 0 ? (
            <div className="text-muted-foreground flex h-32 items-center justify-center gap-2 text-xs">
              {running ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {t("live.waiting")}
            </div>
          ) : (
            <div className="divide-y">
              {events.map((entry, index) => (
                <div key={`${entry.at}-${index}`} className="p-2">
                  <div className="text-muted-foreground mb-1 font-mono text-[10px]">{entry.at}</div>
                  <pre className="scrollbar-thin max-h-40 overflow-auto text-[11px] leading-relaxed">
                    {prettyJSON(entry.payload)}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
