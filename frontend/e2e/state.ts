import { readFileSync } from "node:fs"

export interface E2EState {
  connectionId: string
  database: string
  collection: string
  crudCollection: string
  cookie: string
}

export function readState(): E2EState {
  return JSON.parse(readFileSync(new URL("./.state.json", import.meta.url), "utf8")) as E2EState
}

export function collectionPath(state: E2EState, collection = state.collection): string {
  return `/connections/${encodeURIComponent(state.connectionId)}/databases/${encodeURIComponent(
    state.database,
  )}/collections/${encodeURIComponent(collection)}`
}
