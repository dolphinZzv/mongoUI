import { intlTimeZone, LOCAL_TIME_ZONE } from "@/lib/dateTime"

/** Convert integer/BSON numeric/date-like values into a Date for display. */
export function toDisplayDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    const raw = record.$date
    if (typeof raw === "string" || typeof raw === "number") {
      const date = new Date(raw)
      if (!Number.isNaN(date.getTime())) return date
    }
    if (raw && typeof raw === "object") {
      const nested = raw as Record<string, unknown>
      if (typeof nested.$numberLong === "string") {
        const numeric = Number(nested.$numberLong)
        if (Number.isFinite(numeric)) {
          const date = new Date(numeric)
          if (!Number.isNaN(date.getTime())) return date
        }
      }
    }
  }

  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : value && typeof value === "object"
          ? numberFromExtendedJSON(value as Record<string, unknown>)
          : Number.NaN
  if (!Number.isFinite(numeric)) return null

  // Unix timestamps are normally 10 digits (seconds) or 13 digits
  // (milliseconds); older millisecond dates still exceed 1e11.
  const millis = Math.abs(numeric) < 1e11 ? numeric * 1000 : numeric
  const date = new Date(millis)
  return Number.isNaN(date.getTime()) ? null : date
}

function numberFromExtendedJSON(record: Record<string, unknown>): number {
  for (const key of ["$numberLong", "$numberInt", "$numberDecimal"]) {
    const raw = record[key]
    if (typeof raw === "number") return raw
    if (typeof raw === "string" && raw.trim() !== "") {
      const parsed = Number(raw)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return Number.NaN
}

/** Human-readable date/time for a timestamp or BSON date in the chosen zone. */
export function formatDateValue(
  value: unknown,
  locale: string,
  timeZone: string = LOCAL_TIME_ZONE,
): string | null {
  const date = toDisplayDate(value)
  if (!date) return null
  const tag = locale === "zh" ? "zh-CN" : "en-US"
  const zone = intlTimeZone(timeZone)
  try {
    return new Intl.DateTimeFormat(tag, {
      dateStyle: "medium",
      timeStyle: "medium",
      ...(zone ? { timeZone: zone } : {}),
    }).format(date)
  } catch {
    try {
      return new Intl.DateTimeFormat(tag, {
        dateStyle: "medium",
        timeStyle: "medium",
      }).format(date)
    } catch {
      return date.toLocaleString()
    }
  }
}
