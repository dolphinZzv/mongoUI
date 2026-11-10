import * as React from "react"

/** Stored value meaning "use the browser's time zone". */
export const LOCAL_TIME_ZONE = "local"
export const UTC_TIME_ZONE = "utc"

const STORAGE_KEY = "mongoui-date-timezone"
const CHANGE_EVENT = "mongoui-date-timezone-change"

const FALLBACK_ZONES = [
  "UTC",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "America/Chicago",
  "America/Los_Angeles",
  "America/New_York",
  "America/Sao_Paulo",
  "Asia/Dubai",
  "Asia/Hong_Kong",
  "Asia/Kolkata",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Europe/Berlin",
  "Europe/London",
  "Europe/Paris",
  "Pacific/Auckland",
]

/** IANA zones supported by the browser, with a small fallback for old engines. */
export function supportedTimeZones(): string[] {
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    const zones = intl.supportedValuesOf?.("timeZone")
    if (zones && zones.length > 0) return zones
  } catch {
    /* fall through */
  }
  return FALLBACK_ZONES
}

export function readDateTimeZone(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || LOCAL_TIME_ZONE
  } catch {
    return LOCAL_TIME_ZONE
  }
}

export function writeDateTimeZone(timeZone: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, timeZone)
  } catch {
    /* storage may be unavailable */
  }
  try {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
  } catch {
    /* ignore */
  }
}

/** Reactive date time zone, shared by the settings panel and table cells. */
export function useDateTimeZone(): string {
  const [timeZone, setTimeZone] = React.useState(readDateTimeZone)

  React.useEffect(() => {
    const onChange = () => setTimeZone(readDateTimeZone())
    window.addEventListener(CHANGE_EVENT, onChange)
    window.addEventListener("storage", onChange)
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange)
      window.removeEventListener("storage", onChange)
    }
  }, [])

  return timeZone
}

/** Resolves the stored value to an Intl timeZone option (undefined = browser local). */
export function intlTimeZone(timeZone: string): string | undefined {
  if (!timeZone || timeZone === LOCAL_TIME_ZONE) return undefined
  if (timeZone === UTC_TIME_ZONE) return "UTC"
  return timeZone
}
