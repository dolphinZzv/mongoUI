import * as React from "react"
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ConfirmDialog } from "@/components/confirm-dialog"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { JsonEditor } from "@/components/json-editor"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
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

interface KeyRow {
  id: string
  field: string
  type: string
}

let keySeq = 0
const newKeyRow = (field = "", type = "1"): KeyRow => ({
  id: `k${++keySeq}`,
  field,
  type,
})

const KEY_TYPES: { value: string; labelKey: string }[] = [
  { value: "1", labelKey: "indexes.type.asc" },
  { value: "-1", labelKey: "indexes.type.desc" },
  { value: "text", labelKey: "indexes.type.text" },
  { value: "hashed", labelKey: "indexes.type.hashed" },
  { value: "2dsphere", labelKey: "indexes.type.2dsphere" },
  { value: "2d", labelKey: "indexes.type.2d" },
]

function keyValue(type: string): unknown {
  if (type === "1") return 1
  if (type === "-1") return -1
  return type
}

function keysToRows(key: unknown): KeyRow[] {
  if (!isPlainObject(key)) return [newKeyRow()]
  const rows = Object.entries(key).map(([field, value]) => newKeyRow(field, String(value)))
  return rows.length > 0 ? rows : [newKeyRow()]
}

function rowsToKeys(rows: KeyRow[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const row of rows) {
    const field = row.field.trim()
    if (field) out[field] = keyValue(row.type)
  }
  return out
}

/** JSON string for an optional value; empty string when it is absent. */
function optionalJSON(value: unknown): string {
  if (value === undefined || value === null) return ""
  return JSON.stringify(value, null, 2)
}

/** The builder-managed option fields (everything except v/ns/keys). */
function managedOptions(opts: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const fields = [
    "name",
    "unique",
    "sparse",
    "hidden",
    "expireAfterSeconds",
    "partialFilterExpression",
    "collation",
    "weights",
    "default_language",
    "language_override",
    "wildcardProjection",
  ]
  for (const field of fields) {
    if (opts[field] !== undefined) out[field] = opts[field]
  }
  return out
}

/** Options that force a drop + recreate when changed. */
function structuralSignature(opts: Record<string, unknown>): string {
  const clone = { ...opts }
  delete clone.hidden
  delete clone.expireAfterSeconds
  return JSON.stringify(clone)
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

  const [name, setName] = React.useState("")
  const [unique, setUnique] = React.useState(false)
  const [sparse, setSparse] = React.useState(false)
  const [hidden, setHidden] = React.useState(false)
  const [ttlEnabled, setTTLEnabled] = React.useState(false)
  const [ttlSeconds, setTTLSeconds] = React.useState("3600")
  const [partialFilter, setPartialFilter] = React.useState("")
  const [collation, setCollation] = React.useState("")
  const [weights, setWeights] = React.useState("")
  const [defaultLanguage, setDefaultLanguage] = React.useState("")
  const [languageOverride, setLanguageOverride] = React.useState("")
  const [wildcardProjection, setWildcardProjection] = React.useState("")
  const [advancedOpen, setAdvancedOpen] = React.useState(false)

  const [fieldNames, setFieldNames] = React.useState<string[]>([])
  const [busy, setBusy] = React.useState(false)
  const [pendingRecreate, setPendingRecreate] = React.useState<{
    keys: Record<string, unknown>
    options: Record<string, unknown>
  } | null>(null)

  const original = React.useRef<{ keys: string; structure: string; options: Record<string, unknown> } | null>(null)

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
      setName(String(opts.name ?? ""))
      setUnique(Boolean(opts.unique))
      setSparse(Boolean(opts.sparse))
      setHidden(Boolean(opts.hidden))
      setTTLEnabled(opts.expireAfterSeconds !== undefined && opts.expireAfterSeconds !== null)
      setTTLSeconds(opts.expireAfterSeconds !== undefined ? String(opts.expireAfterSeconds) : "3600")
      setPartialFilter(optionalJSON(opts.partialFilterExpression))
      setCollation(optionalJSON(opts.collation))
      setWeights(optionalJSON(opts.weights))
      setDefaultLanguage(String(opts.default_language ?? ""))
      setLanguageOverride(String(opts.language_override ?? ""))
      setWildcardProjection(optionalJSON(opts.wildcardProjection))
      original.current = {
        keys: JSON.stringify(rowsToKeys(indexRows)),
        structure: structuralSignature(managedOptions(opts)),
        options: opts,
      }
    } else {
      setRows([newKeyRow("field")])
      setName("")
      setUnique(false)
      setSparse(false)
      setHidden(false)
      setTTLEnabled(false)
      setTTLSeconds("3600")
      setPartialFilter("")
      setCollation("")
      setWeights("")
      setDefaultLanguage("")
      setLanguageOverride("")
      setWildcardProjection("")
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

  const buildOptions = (): Record<string, unknown> => {
    const opts: Record<string, unknown> = {}
    if (name.trim()) opts.name = name.trim()
    if (unique) opts.unique = true
    if (sparse) opts.sparse = true
    if (hidden) opts.hidden = true
    if (ttlEnabled) opts.expireAfterSeconds = Number(ttlSeconds)
    if (partialFilter.trim()) opts.partialFilterExpression = JSON.parse(partialFilter)
    if (collation.trim()) opts.collation = JSON.parse(collation)
    if (weights.trim()) opts.weights = JSON.parse(weights)
    if (defaultLanguage.trim()) opts.default_language = defaultLanguage.trim()
    if (languageOverride.trim()) opts.language_override = languageOverride.trim()
    if (wildcardProjection.trim()) opts.wildcardProjection = JSON.parse(wildcardProjection)
    return opts
  }

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
  const parseForm = (): { keys: Record<string, unknown>; options: Record<string, unknown> } | null => {
    let keys: Record<string, unknown>
    let options: Record<string, unknown>
    try {
      if (mode === "json") {
        const parsedKeys = JSON.parse(keysJSON)
        if (!isPlainObject(parsedKeys)) throw new Error(t("indexes.keysObject"))
        keys = parsedKeys
        options = optionsJSON.trim() ? JSON.parse(optionsJSON) : {}
        if (!isPlainObject(options)) throw new Error(t("indexes.optionsObject"))
      } else {
        keys = rowsToKeys(rows)
        if (Object.keys(keys).length === 0) throw new Error(t("indexes.keysRequired"))
        options = buildOptions()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("indexes.invalidJson"))
      return null
    }
    return { keys, options }
  }

  const createIndex = async (keys: Record<string, unknown>, options: Record<string, unknown>) => {
    await api.createIndex(connectionId, database, collection, keys, options)
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
    if (parsed.options.hidden !== orig.options.hidden) update.hidden = Boolean(parsed.options.hidden)
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
      await api.createIndex(connectionId, database, collection, pendingRecreate.keys, pendingRecreate.options)
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
        setOptionsJSON(JSON.stringify(buildOptions(), null, 2))
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
      setName(String(opts.name ?? ""))
      setUnique(Boolean(opts.unique))
      setSparse(Boolean(opts.sparse))
      setHidden(Boolean(opts.hidden))
      setTTLEnabled(opts.expireAfterSeconds !== undefined && opts.expireAfterSeconds !== null)
      setTTLSeconds(opts.expireAfterSeconds !== undefined ? String(opts.expireAfterSeconds) : "3600")
      setPartialFilter(optionalJSON(opts.partialFilterExpression))
      setCollation(optionalJSON(opts.collation))
      setWeights(optionalJSON(opts.weights))
      setDefaultLanguage(String(opts.default_language ?? ""))
      setLanguageOverride(String(opts.language_override ?? ""))
      setWildcardProjection(optionalJSON(opts.wildcardProjection))
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
              <DialogTitle>{isEdit ? t("indexes.editTitle") : t("indexes.createTitle")}</DialogTitle>
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
                  <div className="space-y-2">
                    <Label>{t("indexes.keys")}</Label>
                    {rows.map((row, i) => (
                      <div key={row.id} className="flex items-center gap-2">
                        <Input
                          list="mongoui-index-fields"
                          value={row.field}
                          placeholder={t("indexes.fieldPlaceholder")}
                          onChange={(event) => updateRow(row.id, { field: event.target.value })}
                          className="flex-1 font-mono text-xs"
                        />
                        <Select
                          value={row.type}
                          onValueChange={(value) => updateRow(row.id, { type: value })}
                        >
                          <SelectTrigger className="w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {KEY_TYPES.map((type) => (
                              <SelectItem key={type.value} value={type.value}>
                                {t(type.labelKey)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={i === 0}
                          onClick={() => moveRow(i, i - 1)}
                          title={t("indexes.moveUp")}
                        >
                          <ArrowUp />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={i === rows.length - 1}
                          onClick={() => moveRow(i, i + 1)}
                          title={t("indexes.moveDown")}
                        >
                          <ArrowDown />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={rows.length === 1}
                          onClick={() => setRows((prev) => prev.filter((item) => item.id !== row.id))}
                          title={t("common.delete")}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setRows((prev) => [...prev, newKeyRow()])}
                    >
                      <Plus /> {t("indexes.addField")}
                    </Button>
                    <datalist id="mongoui-index-fields">
                      {fieldNames.map((field) => (
                        <option key={field} value={field} />
                      ))}
                    </datalist>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="index-name">{t("indexes.name")}</Label>
                    <Input
                      id="index-name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder={t("indexes.namePlaceholder")}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox checked={unique} onCheckedChange={(v) => setUnique(Boolean(v))} />
                      {t("indexes.unique")}
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox checked={sparse} onCheckedChange={(v) => setSparse(Boolean(v))} />
                      {t("indexes.sparse")}
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox checked={hidden} onCheckedChange={(v) => setHidden(Boolean(v))} />
                      {t("indexes.hidden")}
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <Switch checked={ttlEnabled} onCheckedChange={setTTLEnabled} />
                      {t("indexes.ttl")}
                    </label>
                  </div>

                  {ttlEnabled ? (
                    <div className="space-y-1">
                      <Label htmlFor="index-ttl">{t("indexes.ttlSeconds")}</Label>
                      <Input
                        id="index-ttl"
                        type="number"
                        min={0}
                        value={ttlSeconds}
                        onChange={(event) => setTTLSeconds(event.target.value)}
                        className="w-40"
                      />
                    </div>
                  ) : null}

                  <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                    <CollapsibleTrigger asChild>
                      <Button type="button" variant="ghost" size="sm" className="gap-1 px-0">
                        <ChevronDown
                          className={`size-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
                        />
                        {t("indexes.advanced")}
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-3 space-y-3">
                      <div className="space-y-1">
                        <Label>{t("indexes.partialFilter")}</Label>
                        <JsonEditor
                          value={partialFilter}
                          onChange={setPartialFilter}
                          rows={3}
                          placeholder='{ "status": "active" }'
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>{t("indexes.collation")}</Label>
                        <JsonEditor
                          value={collation}
                          onChange={setCollation}
                          rows={3}
                          placeholder='{ "locale": "en", "strength": 2 }'
                        />
                      </div>
                      {hasTextKey ? (
                        <>
                          <div className="space-y-1">
                            <Label>{t("indexes.weights")}</Label>
                            <JsonEditor
                              value={weights}
                              onChange={setWeights}
                              rows={3}
                              placeholder='{ "title": 10, "body": 1 }'
                            />
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1">
                              <Label>{t("indexes.defaultLanguage")}</Label>
                              <Input
                                value={defaultLanguage}
                                onChange={(event) => setDefaultLanguage(event.target.value)}
                                placeholder="english"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label>{t("indexes.languageOverride")}</Label>
                              <Input
                                value={languageOverride}
                                onChange={(event) => setLanguageOverride(event.target.value)}
                                placeholder="language"
                              />
                            </div>
                          </div>
                        </>
                      ) : null}
                      <div className="space-y-1">
                        <Label>{t("indexes.wildcardProjection")}</Label>
                        <JsonEditor
                          value={wildcardProjection}
                          onChange={setWildcardProjection}
                          rows={3}
                          placeholder='{ "field": 1 }'
                        />
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <Label>{t("indexes.keys")}</Label>
                    <JsonEditor value={keysJSON} onChange={setKeysJSON} allowEmpty={false} rows={5} />
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
