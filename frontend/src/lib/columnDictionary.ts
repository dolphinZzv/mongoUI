import type { ColumnDictionaryEntry } from "@/lib/columnPrefs"

/** Stable lookup key for scalar and BSON/Extended-JSON cell values. */
export function dictionaryValueKey(value: unknown): string {
  if (value === null) return "null"
  if (value === undefined) return "undefined"
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value)
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function findDictionaryEntry(
  entries: ColumnDictionaryEntry[] | undefined,
  value: unknown,
): ColumnDictionaryEntry | undefined {
  if (!entries || entries.length === 0) return undefined
  const key = dictionaryValueKey(value)
  return entries.find((entry) => entry.value === key)
}
