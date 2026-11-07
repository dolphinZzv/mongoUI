import * as React from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/confirm-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useI18n } from "@/lib/i18n"
import { api } from "@/lib/api"
import { GroupEditor } from "./query-builder/group-editor"
import { ProjectionEditor } from "./query-builder/projection-editor"
import {
  buildFilter,
  buildProjection,
  emptyRoot,
  parseFilter,
  parseProjection,
  type GroupNode,
  type ProjectionState,
} from "./query-builder/model"

export interface MongoQueryBuilderProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionId: string
  database: string
  collection: string
  /** Field names offered for autocomplete, e.g. the visible columns. */
  fields?: string[]
  /** Current filter JSON used to seed the builder when it opens. */
  value: string
  /** Current projection JSON used to seed the builder when it opens. */
  projection?: string
  /** BSON type per field, used for typed value inputs. */
  fieldTypes?: Record<string, string>
  /** Called with the compiled filter and projection JSON when the user applies. */
  onApply: (filter: string, projection: string) => void
}

export function MongoQueryBuilder({
  open,
  onOpenChange,
  connectionId,
  database,
  collection,
  fields = [],
  value,
  projection = "",
  fieldTypes = {},
  onApply,
}: MongoQueryBuilderProps) {
  const { t } = useI18n()
  const [root, setRoot] = React.useState<GroupNode>(() => parseFilter(value))
  const [describe, setDescribe] = React.useState("")
  const [generating, setGenerating] = React.useState(false)
  const [projectionState, setProjectionState] = React.useState<ProjectionState>(() =>
    parseProjection(projection),
  )
  const [discardOpen, setDiscardOpen] = React.useState(false)
  const baselineRef = React.useRef("")

  // Re-seed from the JSON editors every time the dialog opens, so the views
  // never drift apart.
  React.useEffect(() => {
    if (open) {
      const seededRoot = parseFilter(value)
      const seededProjection = parseProjection(projection)
      setRoot(seededRoot)
      setProjectionState(seededProjection)
      baselineRef.current = JSON.stringify(seededRoot) + "|" + JSON.stringify(seededProjection)
    }
  }, [open, value, projection])

  const dirty = JSON.stringify(root) + "|" + JSON.stringify(projectionState) !== baselineRef.current

  React.useEffect(() => {
    if (!open || !dirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [open, dirty])

  const requestClose = (next: boolean) => {
    if (!next && dirty) {
      setDiscardOpen(true)
      return
    }
    onOpenChange(next)
  }

  const preview = React.useMemo(() => {
    const parts = [
      `${t("filter.conditions")}:\n${JSON.stringify(buildFilter(root, fieldTypes), null, 2)}`,
    ]
    const projectionJson = buildProjection(projectionState)
    if (projectionJson) {
      parts.push(`${t("filter.columns")}:\n${JSON.stringify(JSON.parse(projectionJson), null, 2)}`)
    }
    return parts.join("\n\n")
  }, [root, projectionState, fieldTypes, t])

  const apply = () => {
    onApply(JSON.stringify(buildFilter(root, fieldTypes)), buildProjection(projectionState))
    onOpenChange(false)
  }

  const generate = async () => {
    const description = describe.trim()
    if (!description || generating) return
    setGenerating(true)
    try {
      const result = await api.generateAIFilter({
        description,
        connectionId,
        database,
        collection,
        fields,
        fieldTypes,
      })
      setRoot(parseFilter(JSON.stringify(result.filter)))
      toast.success(t("filter.aiGenerated", { provider: result.provider }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("filter.aiFailed"))
    } finally {
      setGenerating(false)
    }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("filter.builderTitle")}</DialogTitle>
          <DialogDescription>{t("filter.builderDesc")}</DialogDescription>
        </DialogHeader>

        <div className="scrollbar-thin max-h-[55vh] space-y-4 overflow-auto pr-1">
          <div className="flex gap-2">
            <Input
              value={describe}
              onChange={(event) => setDescribe(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  void generate()
                }
              }}
              placeholder={t("filter.describePlaceholder")}
              className="h-8 flex-1 text-xs"
            />
            <Button variant="outline" size="sm" onClick={() => void generate()} disabled={generating}>
              {generating ? <Loader2 className="animate-spin" /> : null}
              {generating ? t("filter.generating") : t("filter.generate")}
            </Button>
          </div>
          <p className="text-muted-foreground text-[11px]">{t("filter.aiHint")}</p>
          <section className="space-y-2">
            <h4 className="text-xs font-medium">{t("filter.conditions")}</h4>
            <GroupEditor
              group={root}
              depth={0}
              fields={fields}
              fieldTypes={fieldTypes}
              onChange={setRoot}
            />
          </section>
          <section className="space-y-2">
            <h4 className="text-xs font-medium">{t("filter.columns")}</h4>
            <ProjectionEditor
              state={projectionState}
              knownFields={fields}
              onChange={setProjectionState}
            />
          </section>
        </div>

        <div className="space-y-1">
          <p className="text-muted-foreground text-xs font-medium">{t("filter.preview")}</p>
          <pre className="bg-muted/40 scrollbar-thin max-h-40 overflow-auto rounded-md border p-2 font-mono text-xs">
            {preview}
          </pre>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            className="sm:mr-auto"
            onClick={() => {
              setRoot(emptyRoot())
              setProjectionState({ mode: "none", fields: [] })
            }}
          >
            {t("filter.clearAll")}
          </Button>
          <Button variant="outline" onClick={() => requestClose(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={apply}>{t("filter.apply")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title={t("common.discardTitle")}
        description={t("common.discardDesc")}
        confirmLabel={t("common.discard")}
        destructive={false}
        onConfirm={() => {
          setDiscardOpen(false)
          onOpenChange(false)
        }}
      />
    </>
  )
}
