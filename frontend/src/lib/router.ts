import * as React from "react"

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
 */

export interface RouteState {
  selection: Selection
  tab?: string
}

export const COLLECTION_TABS = [
  "documents",
  "sql",
  "aggregation",
  "indexes",
  "schema",
  "stats",
] as const

const TAB_SET = new Set<string>(COLLECTION_TABS)

function seg(value: string): string {
  return encodeURIComponent(value)
}

export function buildPath(selection: Selection, tab?: string): string {
  switch (selection.kind) {
    case "welcome":
      return "/"
    case "connection":
      return `/connections/${seg(selection.connectionId)}`
    case "collection": {
      const base = `/connections/${seg(selection.connectionId)}/databases/${seg(
        selection.database,
      )}/collections/${seg(selection.collection)}`
      if (tab && TAB_SET.has(tab) && tab !== "documents") {
        return `${base}?tab=${tab}`
      }
      return base
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
  const tab = new URLSearchParams(search).get("tab") ?? undefined

  if (parts[0] === "connections" && parts[1]) {
    if (parts.length >= 6 && parts[2] === "databases" && parts[4] === "collections") {
      return {
        selection: {
          kind: "collection",
          connectionId: parts[1],
          database: parts[3],
          collection: parts[5],
        },
        tab: tab && TAB_SET.has(tab) ? tab : undefined,
      }
    }
    return { selection: { kind: "connection", connectionId: parts[1] } }
  }
  return { selection: { kind: "welcome" } }
}

export interface Router {
  selection: Selection
  tab?: string
  navigate: (selection: Selection, tab?: string, options?: { replace?: boolean }) => void
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
    (selection: Selection, tab?: string, options?: { replace?: boolean }) => {
      const path = buildPath(selection, tab)
      const current = window.location.pathname + window.location.search
      if (path !== current) {
        if (options?.replace) window.history.replaceState(null, "", path)
        else window.history.pushState(null, "", path)
      }
      setState({ selection, tab })
    },
    [],
  )

  return { selection: state.selection, tab: state.tab, navigate }
}
