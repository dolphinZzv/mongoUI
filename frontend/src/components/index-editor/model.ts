import { isPlainObject } from "@/lib/mongo"

export interface KeyRow {
  id: string
  field: string
  type: string
}

let keySeq = 0
export const newKeyRow = (field = "", type = "1"): KeyRow => ({
  id: `k${++keySeq}`,
  field,
  type,
})

export const KEY_TYPES: { value: string; labelKey: string }[] = [
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

export function keysToRows(key: unknown): KeyRow[] {
  if (!isPlainObject(key)) return [newKeyRow()]
  const rows = Object.entries(key).map(([field, value]) => newKeyRow(field, String(value)))
  return rows.length > 0 ? rows : [newKeyRow()]
}

export function rowsToKeys(rows: KeyRow[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const row of rows) {
    const field = row.field.trim()
    if (field) out[field] = keyValue(row.type)
  }
  return out
}

/** JSON string for an optional value; empty string when it is absent. */
export function optionalJSON(value: unknown): string {
  if (value === undefined || value === null) return ""
  return JSON.stringify(value, null, 2)
}

/** The builder-managed option fields (everything except v/ns/keys). */
export function managedOptions(opts: Record<string, unknown>): Record<string, unknown> {
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
export function structuralSignature(opts: Record<string, unknown>): string {
  const clone = { ...opts }
  delete clone.hidden
  delete clone.expireAfterSeconds
  return JSON.stringify(clone)
}

/** Editable representation of the index options form. */
export interface IndexOptionsForm {
  name: string
  unique: boolean
  sparse: boolean
  hidden: boolean
  ttlEnabled: boolean
  ttlSeconds: string
  partialFilter: string
  collation: string
  weights: string
  defaultLanguage: string
  languageOverride: string
  wildcardProjection: string
}

export const emptyOptionsForm = (): IndexOptionsForm => ({
  name: "",
  unique: false,
  sparse: false,
  hidden: false,
  ttlEnabled: false,
  ttlSeconds: "3600",
  partialFilter: "",
  collation: "",
  weights: "",
  defaultLanguage: "",
  languageOverride: "",
  wildcardProjection: "",
})

export function optionsFormFrom(opts: Record<string, unknown>): IndexOptionsForm {
  return {
    name: String(opts.name ?? ""),
    unique: Boolean(opts.unique),
    sparse: Boolean(opts.sparse),
    hidden: Boolean(opts.hidden),
    ttlEnabled: opts.expireAfterSeconds !== undefined && opts.expireAfterSeconds !== null,
    ttlSeconds:
      opts.expireAfterSeconds !== undefined ? String(opts.expireAfterSeconds) : "3600",
    partialFilter: optionalJSON(opts.partialFilterExpression),
    collation: optionalJSON(opts.collation),
    weights: optionalJSON(opts.weights),
    defaultLanguage: String(opts.default_language ?? ""),
    languageOverride: String(opts.language_override ?? ""),
    wildcardProjection: optionalJSON(opts.wildcardProjection),
  }
}

export function optionsFormToDocument(form: IndexOptionsForm): Record<string, unknown> {
  const opts: Record<string, unknown> = {}
  if (form.name.trim()) opts.name = form.name.trim()
  if (form.unique) opts.unique = true
  if (form.sparse) opts.sparse = true
  if (form.hidden) opts.hidden = true
  if (form.ttlEnabled) opts.expireAfterSeconds = Number(form.ttlSeconds)
  if (form.partialFilter.trim()) opts.partialFilterExpression = JSON.parse(form.partialFilter)
  if (form.collation.trim()) opts.collation = JSON.parse(form.collation)
  if (form.weights.trim()) opts.weights = JSON.parse(form.weights)
  if (form.defaultLanguage.trim()) opts.default_language = form.defaultLanguage.trim()
  if (form.languageOverride.trim()) opts.language_override = form.languageOverride.trim()
  if (form.wildcardProjection.trim()) opts.wildcardProjection = JSON.parse(form.wildcardProjection)
  return opts
}
