import * as React from "react"
import { Loader2, Plus } from "lucide-react"
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
import { JsonEditor } from "@/components/json-editor"
import { Label } from "@/components/ui/label"
import { KeysEditor } from "@/components/index-editor/keys-editor"
import { OptionsEditor } from "@/components/index-editor/options-editor"
import {
  emptyOptionsForm,
  keysToRows,
  managedOptions,
  newKeyRow,
  optionsFormFrom,
  optionsFormToDocument,
  rowsToKeys,
  structuralSignature,
  type IndexOptionsForm,
  type KeyRow,
} from "@/components/index-editor/model"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { isPlainObject } from "@/lib/mongo"
import type { IndexInfo } from "@/lib/types"

interface IndexEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionId: string
  database: string
  collection: string
  /** Existing index to edit, or null to create a new one. */
  index: IndexInfo | null
  onSaved: () => void
}

export function IndexEditorDialog({
  open,
  onOpenChange,
  connectionId,
  database,
  collection,
  index,
  onSaved,
}: IndexEditorDialogProps) {
  const { t } = useI18n()
  const isEdit = index !== null

  const [mode, setMode] = React.useState<"builder" | "json">("builder")
  const [rows, setRows] = React.useState<KeyRow[]>([newKeyRow("field")])
  const [keysJSON, setKeysJSON] = React.useState('{\n  "field": 1\n}')
  const [optionsJSON, setOptionsJSON] = React.useState("{}")
  const [options, setOptions] = React.useState<IndexOptionsForm>(emptyOptionsForm)
  const [advancedOpen, setAdvancedOpen] = React.useState(false)

  const [fieldNames, setFieldNames] = React.useState<string[]>([])
  const [busy, setBusy] = React.useState(false)
  const [pendingRecreate, setPendingRecreate] = React.useState<{
    keys: Record<string, unknown>
    options: Record<string, unknown>
  } | null>(null)

  const original = React.useRef<{
    keys: string
    structure: string
    options: Record<string, unknown>
  } | null>(null)

  const hasTextKey = rows.some((row) => row.type === "text")

  // Reset the form whenever the dialog opens for a different index.
  React.useEffect(() => {
    if (!open) return
    setMode("builder")
    setAdvancedOpen(false)
    if (index) {
      const opts = index as Record<string, unknown>
      const indexRows = keysToRows(index.key)
      setRows(indexRows)
      setOptions(optionsFormFrom(opts))
      original.current = {
        keys: JSON.stringify(rowsToKeys(indexRows)),
        structure: structuralSignature(managedOptions(opts)),
        options: opts,
      }
    } else {
      setRows([newKeyRow("field")])
      setOptions(emptyOptionsForm())
      original.current = null
    }
  }, [open, index])

  // Suggest field names from a schema sample (best effort).
  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    api
      .collectionSchema(connectionId, database, collection)
      .then((res) => {
        if (!cancelled) setFieldNames(res.fields.map((field) => field.name))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [open, connectionId, database, collection])

  const updateRow = (id: string, patch: Partial<KeyRow>) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  const moveRow = (from: number, to: number) => {
    setRows((prev) => {
      if (to < 0 || to >= prev.length) return prev
      const next = [...prev]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
  }

  /** Parses the current form into keys/options, reporting validation errors. */
  const parseForm = (): {
    keys: Record<string, unknown>
    options: Record<string, unknown>
  } | null => {
    let keys: Record<string, unknown>
    let optionsDoc: Record<string, unknown>
    try {
      if (mode === "json") {
        const parsedKeys = JSON.parse(keysJSON)
        if (!isPlainObject(parsedKeys)) throw new Error(t("indexes.keysObject"))
        keys = parsedKeys
        optionsDoc = optionsJSON.trim() ? JSON.parse(optionsJSON) : {}
        if (!isPlainObject(optionsDoc)) throw new Error(t("indexes.optionsObject"))
      } else {
        keys = rowsToKeys(rows)
        if (Object.keys(keys).length === 0) throw new Error(t("indexes.keysRequired"))
        optionsDoc = optionsFormToDocument(options)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("indexes.invalidJson"))
      return null
    }
    return { keys, options: optionsDoc }
  }

  const createIndex = async (keys: Record<string, unknown>, optionsDoc: Record<string, unknown>) => {
    await api.createIndex(connectionId, database, collection, keys, optionsDoc)
    toast.success(t("indexes.created"))
    onOpenChange(false)
    onSaved()
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const parsed = parseForm()
    if (!parsed) return

    if (!isEdit) {
      setBusy(true)
      try {
        await createIndex(parsed.keys, parsed.options)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("indexes.createFailed"))
      } finally {
        setBusy(false)
      }
      return
    }

    const orig = original.current
    if (!orig) return
    const keysChanged = JSON.stringify(parsed.keys) !== orig.keys
    const structureChanged = structuralSignature(parsed.options) !== orig.structure
    // TTL can be changed in place, but not removed, so dropping it recreates.
    const ttlRemoved =
      orig.options.expireAfterSeconds !== undefined &&
      parsed.options.expireAfterSeconds === undefined

    if (keysChanged || structureChanged || ttlRemoved) {
      // Keys or structural options cannot be altered in place.
      setPendingRecreate(parsed)
      return
    }

    const update: { hidden?: boolean; expireAfterSeconds?: number } = {}
    if (parsed.options.hidden !== orig.options.hidden) {
      update.hidden = Boolean(parsed.options.hidden)
    }
    if (parsed.options.expireAfterSeconds !== orig.options.expireAfterSeconds) {
      update.expireAfterSeconds = parsed.options.expireAfterSeconds as number
    }
    if (Object.keys(update).length === 0) {
      onOpenChange(false)
      return
    }
    setBusy(true)
    try {
      await api.updateIndex(connectionId, database, collection, index.name, update)
      toast.success(t("indexes.updated"))
      onOpenChange(false)
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("indexes.updateFailed"))
    } finally {
      setBusy(false)
    }
  }

  const recreate = async () => {
    if (!pendingRecreate || !index) return
    setBusy(true)
    try {
      try {
        await api.dropIndex(connectionId, database, collection, index.name)
      } catch {
        // The index may already be gone; creating it below is what matters.
      }
      await api.createIndex(
        connectionId,
        database,
        collection,
        pendingRecreate.keys,
        pendingRecreate.options,
      )
      toast.success(t("indexes.recreated"))
      setPendingRecreate(null)
      onOpenChange(false)
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("indexes.createFailed"))
    } finally {
      setBusy(false)
    }
  }

  const switchMode = (next: "builder" | "json") => {
    if (next === mode) return
    if (next === "json") {
      const keys = rowsToKeys(rows)
      if (Object.keys(keys).length === 0) {
        toast.error(t("indexes.keysRequired"))
        return
      }
      setKeysJSON(JSON.stringify(keys, null, 2))
      try {
        setOptionsJSON(JSON.stringify(optionsFormToDocument(options), null, 2))
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("indexes.invalidJson"))
        return
      }
      setMode("json")
      return
    }
    // json -> builder
    try {
      const parsedKeys = JSON.parse(keysJSON)
      if (!isPlainObject(parsedKeys)) throw new Error(t("indexes.keysObject"))
      setRows(keysToRows(parsedKeys))
      const opts = optionsJSON.trim() ? JSON.parse(optionsJSON) : {}
      if (!isPlainObject(opts)) throw new Error(t("indexes.optionsObject"))
      setOptions(optionsFormFrom(opts))
      setMode("builder")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("indexes.invalidJson"))
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <form onSubmit={submit} className="flex max-h-[85vh] flex-col">
            <DialogHeader>
              <DialogTitle>
                {isEdit ? t("indexes.editTitle") : t("indexes.createTitle")}
              </DialogTitle>
              <DialogDescription>{t("indexes.editorHint")}</DialogDescription>
            </DialogHeader>

            <div className="flex gap-1 py-3">
              <Button
                type="button"
                variant={mode === "builder" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => switchMode("builder")}
              >
                {t("indexes.builder")}
              </Button>
              <Button
                type="button"
                variant={mode === "json" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => switchMode("json")}
              >
                {t("indexes.jsonMode")}
              </Button>
            </div>

            <div className="scrollbar-thin min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 pb-2">
              {mode === "builder" ? (
                <>
                  <KeysEditor
                    rows={rows}
                    fieldNames={fieldNames}
                    onUpdateRow={updateRow}
                    onMoveRow={moveRow}
                    onRemoveRow={(id) =>
                      setRows((prev) => prev.filter((item) => item.id !== id))
                    }
                    onAddRow={() => setRows((prev) => [...prev, newKeyRow()])}
                  />
                  <OptionsEditor
                    value={options}
                    onChange={(patch) => setOptions((prev) => ({ ...prev, ...patch }))}
                    hasTextKey={hasTextKey}
                    advancedOpen={advancedOpen}
                    onAdvancedOpenChange={setAdvancedOpen}
                  />
                </>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <Label>{t("indexes.keys")}</Label>
                    <JsonEditor
                      value={keysJSON}
                      onChange={setKeysJSON}
                      allowEmpty={false}
                      rows={5}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>{t("indexes.options")}</Label>
                    <JsonEditor value={optionsJSON} onChange={setOptionsJSON} rows={6} />
                  </div>
                </div>
              )}
            </div>

            {isEdit ? (
              <p className="text-muted-foreground pt-2 text-xs">{t("indexes.editRecreateHint")}</p>
            ) : null}

            <DialogFooter className="pt-3">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : isEdit ? null : <Plus />}
                {isEdit ? t("common.save") : t("common.create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingRecreate !== null}
        onOpenChange={(open) => !open && setPendingRecreate(null)}
        title={t("indexes.recreateTitle", { name: index?.name ?? "" })}
        description={t("indexes.recreateDesc")}
        confirmLabel={t("indexes.recreate")}
        onConfirm={recreate}
      />
    </>
  )
}
