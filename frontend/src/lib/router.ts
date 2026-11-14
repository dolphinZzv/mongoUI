import * as React from "react"

import type { ChartConfig } from "@/lib/chart"
import type { Selection } from "@/lib/types"

/**
 * A tiny History-API router. It keeps the current selection (and the active
 * collection tab) in the URL so that a refresh, a shared link or the browser
 * back/forward buttons restore the exact view.
 *
 * Routes:
 *   /                                                        welcome
 *   /connections/:connectionId                               connection overview
 *   /connections/:connectionId/databases/:db/collections/:c  collection view
 *   ...?tab=documents|sql|aggregation|indexes|schema|stats   active tab
 *
 * The documents tab also mirrors its query (filter/sort/projection) and
 * pagination (limit/skip) into the URL so a refresh restores the exact page.
 */

/** Chart state that travels in the URL so a link restores the same chart. */
export interface ChartShareState {
  config: ChartConfig
  filter: string
}

export interface DocsQueryState {
  filter: string
  sort: string
  projection: string
  limit: number
  skip: number
  /** Explicit pinned columns when present in the URL; absent means use local prefs. */
  pinned?: string[]
  /** Open chart dialog, configuration and its own filter. */
  chart?: ChartShareState
}

export const DOCS_QUERY_DEFAULTS: DocsQueryState = {
  filter: "{}",
  sort: '{"_id": -1}',
  projection: "",
  limit: 50,
  skip: 0,
}

export interface RouteState {
  selection: Selection
  tab?: string
  docs?: DocsQueryState
}

export const COLLECTION_TABS = [
  "documents",
  "chart",
  "query",
  // Legacy URLs remain valid; they open Query with the corresponding mode.
  "sql",
  "aggregation",
  "indexes",
  "schema",
  "stats",
] as const

const TAB_SET = new Set<string>(COLLECTION_TABS)

const DOCS_PARAM_KEYS = ["filter", "sort", "projection", "limit", "skip", "pin", "chart"] as const

function seg(value: string): string {
  return encodeURIComponent(value)
}

function parseCount(value: string | null, fallback: number, min = 0): number {
  if (value === null) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.floor(parsed))
}

function base64UrlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function base64UrlDecode(text: string): string {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4)
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** Encodes the chart state for the `chart` query parameter (URL-safe base64). */
export function encodeChartParam(chart: ChartShareState): string {
  return base64UrlEncode(JSON.stringify(chart))
}

/** Decodes and validates a `chart` query parameter; malformed values are ignored. */
export function decodeChartParam(value: string | null): ChartShareState | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(base64UrlDecode(value)) as Partial<ChartShareState>
    if (!parsed || typeof parsed !== "object" || !parsed.config) return undefined
    return {
      config: parsed.config,
      filter: typeof parsed.filter === "string" ? parsed.filter : "{}",
    }
  } catch {
    return undefined
  }
}

function parseDocs(search: string): DocsQueryState | undefined {
  const params = new URLSearchParams(search)
  if (!DOCS_PARAM_KEYS.some((key) => params.has(key))) return undefined
  const pinValues = params.getAll("pin")
  const pinned = params.has("pin")
    ? pinValues.length === 1 && pinValues[0] === ""
      ? []
      : pinValues.filter((value) => value !== "")
    : undefined
  return {
    filter: params.get("filter") ?? DOCS_QUERY_DEFAULTS.filter,
    sort: params.get("sort") ?? DOCS_QUERY_DEFAULTS.sort,
    projection: params.get("projection") ?? DOCS_QUERY_DEFAULTS.projection,
    limit: parseCount(params.get("limit"), DOCS_QUERY_DEFAULTS.limit, 1),
    skip: parseCount(params.get("skip"), DOCS_QUERY_DEFAULTS.skip),
    pinned,
    chart: decodeChartParam(params.get("chart")),
  }
}

export function buildPath(selection: Selection, tab?: string, docs?: DocsQueryState): string {
  switch (selection.kind) {
    case "welcome":
      return "/"
    case "dashboard":
      return "/dashboard"
    case "connection":
      return `/connections/${seg(selection.connectionId)}`
    case "collection": {
      const base = `/connections/${seg(selection.connectionId)}/databases/${seg(
        selection.database,
      )}/collections/${seg(selection.collection)}`
      const activeTab = tab && TAB_SET.has(tab) ? tab : undefined
      const params = new URLSearchParams()
      if (activeTab && activeTab !== "documents") {
        params.set("tab", activeTab)
      }
      // The documents query only makes sense on the documents tab.
      if ((!activeTab || activeTab === "documents") && docs) {
        if (docs.filter && docs.filter !== DOCS_QUERY_DEFAULTS.filter) {
          params.set("filter", docs.filter)
        }
        if (docs.sort) params.set("sort", docs.sort)
        if (docs.projection) params.set("projection", docs.projection)
        if (docs.limit !== DOCS_QUERY_DEFAULTS.limit) {
          params.set("limit", String(docs.limit))
        }
        if (docs.skip !== DOCS_QUERY_DEFAULTS.skip) {
          params.set("skip", String(docs.skip))
        }
        if (docs.pinned !== undefined) {
          if (docs.pinned.length === 0) {
            params.append("pin", "")
          } else {
            for (const column of docs.pinned) params.append("pin", column)
          }
        }
        if (docs.chart) {
          params.set("chart", encodeChartParam(docs.chart))
        }
      }
      if (activeTab === "chart" && docs?.chart) {
        params.set("chart", encodeChartParam(docs.chart))
      }
      const query = params.toString()
      return query ? `${base}?${query}` : base
    }
  }
}

export function parseLocation(pathname: string, search: string): RouteState {
  const parts = pathname
    .split("/")
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part)
      } catch {
        return part
      }
    })
  const params = new URLSearchParams(search)
  const tab = params.get("tab") ?? undefined

  if (parts[0] === "dashboard") {
    return { selection: { kind: "dashboard" } }
  }

  if (parts[0] === "connections" && parts[1]) {
    if (parts.length >= 6 && parts[2] === "databases" && parts[4] === "collections") {
      const activeTab = tab && TAB_SET.has(tab) ? tab : undefined
      return {
        selection: {
          kind: "collection",
          connectionId: parts[1],
          database: parts[3],
          collection: parts[5],
        },
        tab: activeTab,
        docs:
          activeTab === "chart"
            ? { ...DOCS_QUERY_DEFAULTS, chart: decodeChartParam(params.get("chart")) }
            : !activeTab || activeTab === "documents"
              ? parseDocs(search)
              : undefined,
      }
    }
    return { selection: { kind: "connection", connectionId: parts[1] } }
  }
  return { selection: { kind: "welcome" } }
}

export interface Router {
  selection: Selection
  tab?: string
  docs?: DocsQueryState
  navigate: (
    selection: Selection,
    tab?: string,
    options?: { replace?: boolean; docs?: DocsQueryState },
  ) => void
}

export function useRouter(): Router {
  const [state, setState] = React.useState<RouteState>(() =>
    parseLocation(window.location.pathname, window.location.search),
  )

  React.useEffect(() => {
    const onPopState = () =>
      setState(parseLocation(window.location.pathname, window.location.search))
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [])

  const navigate = React.useCallback(
    (
      selection: Selection,
      tab?: string,
      options?: { replace?: boolean; docs?: DocsQueryState },
    ) => {
      const path = buildPath(selection, tab, options?.docs)
      const current = window.location.pathname + window.location.search
      if (path !== current) {
        if (options?.replace) window.history.replaceState(null, "", path)
        else window.history.pushState(null, "", path)
      }
      setState({ selection, tab, docs: options?.docs })
    },
    [],
  )

  return { selection: state.selection, tab: state.tab, docs: state.docs, navigate }
}
