import * as React from "react"
import { Loader2, Play, Save, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"

interface Runbook {
  id: string
  name: string
  script: string
}

interface RunbooksDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionId: string
  database: string
  collection?: string
  onPick: (script: string) => void
}

function storageKey(connectionId: string, database: string): string {
  return `mongoui-runbooks:${connectionId}:${database}`
}

function readRunbooks(key: string): Runbook[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "[]") as Runbook[]
    return Array.isArray(parsed) ? parsed.filter((item) => item && item.name && item.script) : []
  } catch {
    return []
  }
}

/** Saved mongosh-style scripts that can be loaded or executed as runbooks. */
export function RunbooksDialog({
  open,
  onOpenChange,
  connectionId,
  database,
  collection,
  onPick,
}: RunbooksDialogProps) {
  const { t } = useI18n()
  const key = storageKey(connectionId, database)
  const [runbooks, setRunbooks] = React.useState<Runbook[]>(() => readRunbooks(key))
  const [name, setName] = React.useState("")
  const [script, setScript] = React.useState("")
  const [busy, setBusy] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (open) {
      setRunbooks(readRunbooks(key))
      setName("")
      setScript(collection ? `db.${collection}.find({}).limit(20)` : "db.getCollectionNames()")
    }
  }, [open, key, collection])

  const persist = (next: Runbook[]) => {
    setRunbooks(next)
    try {
      localStorage.setItem(key, JSON.stringify(next))
    } catch {
      /* storage may be unavailable */
    }
  }

  const save = () => {
    const trimmed = name.trim()
    if (!trimmed || !script.trim()) return
    persist([
      ...runbooks,
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: trimmed, script },
    ])
    setName("")
    toast.success(t("runbook.saved"))
  }

  const run = async (runbook: Runbook) => {
    setBusy(runbook.id)
    try {
      const result = await api.runScript(connectionId, database, runbook.script)
      toast.success(result.summary || t("runbook.ran"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("runbook.failed"))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-3 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("runbook.title")}</DialogTitle>
          <DialogDescription>{t("runbook.desc")}</DialogDescription>
        </DialogHeader>

        <div className="scrollbar-thin max-h-48 space-y-1 overflow-auto">
          {runbooks.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("runbook.empty")}</p>
          ) : (
            runbooks.map((runbook) => (
              <div
                key={runbook.id}
                className="hover:bg-accent/50 flex items-center gap-2 rounded-md border px-2 py-1.5"
              >
                <button
                  type="button"
                  onClick={() => {
                    onPick(runbook.script)
                    onOpenChange(false)
                  }}
                  className="min-w-0 flex-1 truncate text-left text-sm"
                  title={runbook.name}
                >
                  {runbook.name}
                </button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => void run(runbook)}
                  disabled={busy !== null}
                  aria-label={t("script.run")}
                >
                  {busy === runbook.id ? <Loader2 className="animate-spin" /> : <Play />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => persist(runbooks.filter((item) => item.id !== runbook.id))}
                  aria-label={t("common.delete")}
                >
                  <Trash2 />
                </Button>
              </div>
            ))
          )}
        </div>

        <div className="space-y-2">
          <Label className="text-xs">{t("runbook.name")}</Label>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("runbook.namePlaceholder")}
          />
          <Textarea
            value={script}
            onChange={(event) => setScript(event.target.value)}
            rows={5}
            className="font-mono text-xs"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              {t("common.close")}
            </Button>
            <Button size="sm" onClick={save} disabled={!name.trim() || !script.trim()}>
              <Save /> {t("runbook.save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
