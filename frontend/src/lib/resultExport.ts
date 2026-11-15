import type { MongoDocument } from "@/lib/types"

function safeCell(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/** Keep spreadsheet apps from evaluating attacker-controlled result values. */
function csvSafe(value: string): string {
  if (!value) return value
  switch (value[0]) {
    case "=":
    case "+":
    case "@":
    case "\t":
    case "\r":
      return `'${value}`
    case "-":
      return value.length > 1 && value[1] >= "0" && value[1] <= "9" ? value : `'${value}`
    default:
      return value
  }
}

function escapeCSV(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function resultToJSON(documents: MongoDocument[]): string {
  return JSON.stringify(documents, null, 2)
}

export function resultToCSV(documents: MongoDocument[]): string {
  const seen = new Set<string>()
  const headers: string[] = []
  for (const doc of documents) {
    for (const key of Object.keys(doc)) {
      if (seen.has(key)) continue
      seen.add(key)
      headers.push(key)
    }
  }
  if (headers.includes("_id")) {
    headers.splice(headers.indexOf("_id"), 1)
    headers.unshift("_id")
  }
  const lines = [headers.map((header) => escapeCSV(csvSafe(header))).join(",")]
  for (const doc of documents) {
    lines.push(
      headers
        .map((header) => escapeCSV(csvSafe(safeCell(doc[header]))))
        .join(","),
    )
  }
  return `${lines.join("\n")}\n`
}

export function resultExportName(storageKey: string, extension: string): string {
  const base = storageKey.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
  return `${base || "query-result"}.${extension}`
}
