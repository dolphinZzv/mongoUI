import * as React from "react"
import { Loader2, Play, Save } from "lucide-react"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { JsonEditor } from "@/components/json-editor"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { prettyJSON } from "@/lib/mongo"
import type { MongoDocument } from "@/lib/types"

interface DataQualityDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionId: string
  database: string
  collection: string
}

type Scan = "types" | "duplicates" | "missing"

/** JSON Schema validator editor plus quick duplicate/type/null scans. */
export function DataQualityDialog({
  open,
  onOpenChange,
  connectionId,
  database,
  collection,
}: DataQualityDialogProps) {
  const { t } = useI18n()
  const [tab, setTab] = React.useState<"validator" | "scan">("validator")
  const [validatorText, setValidatorText] = React.useState("{}")
  const [level, setLevel] = React.useState("strict")
  const [action, setAction] = React.useState("error")
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [field, setField] = React.useState("")
  const [scan, setScan] = React.useState<Scan>("types")
  const [rows, setRows] = React.useState<MongoDocument[]>([])
  const [running, setRunning] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setLoading(true)
    setRows([])
    void api
      .getValidator(connectionId, database, collection)
      .then((state) => {
        setValidatorText(prettyJSON(state.validator ?? {}))
        setLevel(state.validationLevel === "moderate" ? "moderate" : "strict")
        setAction(state.validationAction === "warn" ? "warn" : "error")
      })
      .catch(() => toast.error(t("quality.loadFailed")))
      .finally(() => setLoading(false))
  }, [open, connectionId, database, collection, t])

  const save = async () => {
    let parsed: unknown
    try {
      parsed = JSON.parse(validatorText.trim() || "{}")
    } catch {
      toast.error(t("docs.invalidJson"))
      return
    }
    setSaving(true)
    try {
      await api.updateValidator(connectionId, database, collection, {
        validator: parsed,
        validationLevel: level,
        validationAction: action,
      })
      toast.success(t("quality.saved"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("quality.saveFailed"))
    } finally {
      setSaving(false)
    }
  }

  const runScan = async () => {
    const name = field.trim()
    if (!name) return
    setRunning(true)
    try {
      const pipeline =
        scan === "duplicates"
          ? [
              { $group: { _id: `$${name}`, count: { $sum: 1 } } },
              { $match: { count: { $gt: 1 } } },
              { $sort: { count: -1 } },
              { $limit: 20 },
            ]
          : scan === "missing"
            ? [
                {
                  $group: {
                    _id: {
                      $cond: [
                        { $or: [{ $eq: [`$${name}`, null] }, { $eq: [{ $type: `$${name}` }, "missing"] }] },
                        "missing",
                        "present",
                      ],
                    },
                    count: { $sum: 1 },
                  },
                },
              ]
            : [
                { $group: { _id: { $type: `$${name}` }, count: { $sum: 1 } } },
                { $sort: { count: -1 } },
              ]
      const result = await api.aggregate(connectionId, database, collection, pipeline, 100)
      setRows(result.documents)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("quality.scanFailed"))
    } finally {
      setRunning(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-3 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("quality.title")}</DialogTitle>
          <DialogDescription>{t("quality.desc")}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-1 rounded-md border p-0.5">
          {(["validator", "scan"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTab(item)}
              className={
                tab === item
                  ? "bg-accent text-accent-foreground rounded px-2 py-1 text-xs font-medium"
                  : "text-muted-foreground hover:text-foreground rounded px-2 py-1 text-xs"
              }
            >
              {t(item === "validator" ? "quality.validator" : "quality.scan")}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-muted-foreground flex items-center gap-2 text-xs">
            <Loader2 className="size-3.5 animate-spin" /> {t("common.loading")}
          </div>
        ) : tab === "validator" ? (
          <div className="space-y-3">
            <JsonEditor
              value={validatorText}
              onChange={setValidatorText}
              rows={8}
              className="min-h-[10rem]"
              placeholder='{ "$jsonSchema": { "bsonType": "object", "required": ["email"] } }'
            />
            <div className="flex flex-wrap items-center gap-3">
              <div className="grid gap-1.5">
                <Label className="text-xs">{t("quality.level")}</Label>
                <Select value={level} onValueChange={setLevel}>
                  <SelectTrigger size="sm" className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="strict">{t("quality.level.strict")}</SelectItem>
                    <SelectItem value="moderate">{t("quality.level.moderate")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">{t("quality.action")}</Label>
                <Select value={action} onValueChange={setAction}>
                  <SelectTrigger size="sm" className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="error">{t("quality.action.error")}</SelectItem>
                    <SelectItem value="warn">{t("quality.action.warn")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button className="mt-5" size="sm" onClick={() => void save()} disabled={saving}>
                {saving ? <Loader2 className="animate-spin" /> : <Save />}
                {t("common.save")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="grid gap-1.5">
                <Label className="text-xs">{t("quality.field")}</Label>
                <Input
                  value={field}
                  onChange={(event) => setField(event.target.value)}
                  placeholder="email"
                  className="h-8 w-48 font-mono text-xs"
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">{t("quality.scanType")}</Label>
                <Select value={scan} onValueChange={(value) => setScan(value as Scan)}>
                  <SelectTrigger size="sm" className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="types">{t("quality.scan.types")}</SelectItem>
                    <SelectItem value="duplicates">{t("quality.scan.duplicates")}</SelectItem>
                    <SelectItem value="missing">{t("quality.scan.missing")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" onClick={() => void runScan()} disabled={running || !field.trim()}>
                {running ? <Loader2 className="animate-spin" /> : <Play />}
                {t("common.run")}
              </Button>
            </div>
            <div className="scrollbar-thin min-h-0 flex-1 overflow-auto rounded-lg border">
              {rows.length === 0 ? (
                <div className="text-muted-foreground flex h-32 items-center justify-center text-xs">
                  {t("quality.noResults")}
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="px-2 py-1 text-left font-medium">{t("quality.value")}</th>
                      <th className="px-2 py-1 text-right font-medium">{t("quality.count")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => (
                      <tr key={index} className="border-t">
                        <td className="max-w-[28rem] truncate px-2 py-1 font-mono">
                          {prettyJSON(row._id)}
                        </td>
                        <td className="px-2 py-1 text-right font-mono">
                          {String((row as Record<string, unknown>).count ?? "")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
