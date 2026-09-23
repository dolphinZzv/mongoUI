import type { MongoDocument } from "@/lib/types"

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Returns a short human readable type name for an Extended JSON value. */
export function valueType(value: unknown): string {
  if (value === null || value === undefined) return "null"
  if (Array.isArray(value)) return "array"
  if (isPlainObject(value)) {
    const keys = Object.keys(value)
    if (keys.length === 1) {
      switch (keys[0]) {
        case "$oid":
          return "objectId"
        case "$date":
          return "date"
        case "$numberDecimal":
          return "decimal"
        case "$numberLong":
          return "long"
        case "$numberInt":
          return "int"
        case "$numberDouble":
          return "double"
        case "$binary":
          return "binary"
        case "$regularExpression":
          return "regex"
        case "$timestamp":
          return "timestamp"
        case "$minKey":
          return "minKey"
        case "$maxKey":
          return "maxKey"
        case "$code":
          return "code"
        case "$uuid":
          return "uuid"
      }
    }
    return "object"
  }
  switch (typeof value) {
    case "string":
      return "string"
    case "number":
      return Number.isInteger(value) ? "int" : "double"
    case "boolean":
      return "bool"
    default:
      return typeof value
  }
}

/** Flattens an Extended JSON value to a compact, readable string. */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "null"
  if (Array.isArray(value)) return compact(value)
  if (isPlainObject(value)) {
    const keys = Object.keys(value)
    if (keys.length === 1) {
      switch (keys[0]) {
        case "$oid":
          return String(value.$oid)
        case "$date": {
          const date = value.$date
          if (typeof date === "string") return date
          if (isPlainObject(date) && "$numberLong" in date) {
            return new Date(Number(date.$numberLong)).toISOString()
          }
          return compact(date)
        }
        case "$numberDecimal":
        case "$numberLong":
        case "$numberInt":
        case "$numberDouble":
          return String(value[keys[0]])
        case "$timestamp":
          return compact(value.$timestamp)
        case "$regularExpression":
          return `/${(value.$regularExpression as Record<string, unknown>)?.pattern ?? ""}/`
        case "$binary":
          return "binary"
      }
    }
    return compact(value)
  }
  return String(value)
}

function compact(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/** Best effort key used to identify a document (the _id ext-json). */
export function documentId(doc: MongoDocument): string | null {
  if (!("_id" in doc)) return null
  return JSON.stringify(doc._id)
}

export function prettyJSON(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/** Collects the union of top level keys across documents, in first-seen order. */
export function collectColumns(documents: MongoDocument[]): string[] {
  const columns: string[] = []
  const seen = new Set<string>()
  for (const doc of documents) {
    for (const key of Object.keys(doc)) {
      if (!seen.has(key)) {
        seen.add(key)
        columns.push(key)
      }
    }
  }
  if (columns.includes("_id")) {
    columns.splice(columns.indexOf("_id"), 1)
    columns.unshift("_id")
  }
  return columns
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function classForType(type: string): string {
  switch (type) {
    case "string":
      return "text-emerald-400"
    case "int":
    case "double":
    case "long":
    case "decimal":
      return "text-sky-400"
    case "bool":
      return "text-violet-400"
    case "null":
      return "text-muted-foreground"
    case "objectId":
      return "text-amber-400"
    case "date":
    case "timestamp":
      return "text-rose-400"
    case "array":
      return "text-cyan-400"
    default:
      return "text-foreground"
  }
}
