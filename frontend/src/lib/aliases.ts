import * as React from "react"

import { api } from "@/lib/api"
import type { AliasState, AliasUpdate } from "@/lib/types"

/** Browser-local display aliases for databases and collections. */
export type AliasMode = "local" | "team"

export type AliasTarget =
  | { kind: "database"; connectionId: string; database: string }
  | { kind: "collection"; connectionId: string; database: string; collection: string }

export interface AliasStoreSnapshot {
  mode: AliasMode
  aliases: AliasState
  teamLoading: boolean
  teamError: string | null
}

const ALIASES_KEY = "mongoui-aliases"
const MODE_KEY = "mongoui-alias-mode"

export const aliasDbKey = (connectionId: string, database: string) =>
  `${connectionId}::${database}`

export const aliasCollectionKey = (
  connectionId: string,
  database: string,
  collection: string,
) => `${connectionId}::${database}::${collection}`

function emptyAliases(): AliasState {
  return { databases: {}, collections: {} }
}

const EMPTY_ALIASES = emptyAliases()
const SERVER_SNAPSHOT: AliasStoreSnapshot = {
  mode: "local",
  aliases: EMPTY_ALIASES,
  teamLoading: false,
  teamError: null,
}

function normalizeMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {}
  const out: Record<string, string> = {}
  for (const [key, alias] of Object.entries(value)) {
    if (typeof alias !== "string") continue
    const trimmed = alias.trim()
    if (key && trimmed) out[key] = trimmed
  }
  return out
}

function normalizeState(value: unknown): AliasState {
  if (!value || typeof value !== "object") return emptyAliases()
  const parsed = value as Partial<AliasState>
  return {
    databases: normalizeMap(parsed.databases),
    collections: normalizeMap(parsed.collections),
  }
}

function readLocalAliases(): AliasState {
  try {
    const raw = localStorage.getItem(ALIASES_KEY)
    if (!raw) return EMPTY_ALIASES
    return normalizeState(JSON.parse(raw))
  } catch {
    return EMPTY_ALIASES
  }
}

function readMode(): AliasMode {
  try {
    return localStorage.getItem(MODE_KEY) === "team" ? "team" : "local"
  } catch {
    return "local"
  }
}

let localAliases = readLocalAliases()
let teamAliases = emptyAliases()
let mode = readMode()
let teamAttempted = false
let teamLoaded = false
let teamLoading = false
let teamError: string | null = null
let teamRequest: Promise<void> | null = null

let snapshot = buildSnapshot()
const listeners = new Set<() => void>()

function buildSnapshot(): AliasStoreSnapshot {
  return {
    mode,
    aliases: mode === "team" ? teamAliases : localAliases,
    teamLoading: mode === "team" && teamLoading,
    teamError: mode === "team" ? teamError : null,
  }
}

function emit() {
  snapshot = buildSnapshot()
  for (const listener of listeners) listener()
}

function persistLocal(next: AliasState) {
  localAliases = next
  try {
    localStorage.setItem(ALIASES_KEY, JSON.stringify(next))
  } catch {
    /* storage may be unavailable */
  }
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key === ALIASES_KEY) {
      localAliases = readLocalAliases()
      emit()
      return
    }
    if (event.key !== MODE_KEY) return
    mode = readMode()
    teamAttempted = false
    emit()
    if (mode === "team") void ensureTeamAliases().catch(() => undefined)
  }
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", onStorage)
  }
}

async function ensureTeamAliases(force = false): Promise<void> {
  if (teamRequest) return teamRequest
  if (teamLoaded && !force) return
  if (teamAttempted && !force) return

  teamAttempted = true
  teamLoading = true
  teamError = null
  emit()

  teamRequest = api
    .getAliases()
    .then((data) => {
      teamAliases = normalizeState(data)
      teamLoaded = true
      teamError = null
    })
    .catch((err) => {
      teamError = err instanceof Error ? err.message : String(err)
      throw err
    })
    .finally(() => {
      teamLoading = false
      teamRequest = null
      emit()
    })
  return teamRequest
}

/** Force a fresh read of the shared aliases (used by Settings → Aliases). */
export function refreshTeamAliases(): Promise<void> {
  teamAttempted = false
  return ensureTeamAliases(true)
}

export function useAliasStore(): AliasStoreSnapshot {
  const store = React.useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => SERVER_SNAPSHOT,
  )

  React.useEffect(() => {
    if (store.mode === "team" && !teamAttempted) {
      void ensureTeamAliases().catch(() => undefined)
    }
  }, [store.mode])

  return store
}

export function useAliases(): AliasState {
  return useAliasStore().aliases
}

export function setAliasMode(next: AliasMode): void {
  mode = next
  teamError = null
  if (next === "team") teamAttempted = false
  try {
    localStorage.setItem(MODE_KEY, next)
  } catch {
    /* storage may be unavailable */
  }
  emit()
  if (next === "team") void ensureTeamAliases().catch(() => undefined)
}

function withAlias(state: AliasState, update: AliasUpdate): AliasState {
  const databases = { ...state.databases }
  const collections = { ...state.collections }
  const value = update.alias.trim()
  if (update.kind === "database") {
    const key = aliasDbKey(update.connectionId, update.database)
    if (value) databases[key] = value
    else delete databases[key]
  } else {
    const key = aliasCollectionKey(update.connectionId, update.database, update.collection ?? "")
    if (value) collections[key] = value
    else delete collections[key]
  }
  return { databases, collections }
}

async function updateTeamAlias(update: AliasUpdate): Promise<void> {
  const previous = teamAliases
  teamAliases = withAlias(teamAliases, update)
  teamLoaded = true
  teamError = null
  emit()
  try {
    teamAliases = normalizeState(await api.updateAlias(update))
    teamError = null
    emit()
  } catch (err) {
    teamAliases = previous
    teamError = err instanceof Error ? err.message : String(err)
    emit()
    throw err
  }
}

export async function setDatabaseAlias(
  connectionId: string,
  database: string,
  alias: string,
): Promise<void> {
  const update: AliasUpdate = { kind: "database", connectionId, database, alias }
  if (mode === "team") return updateTeamAlias(update)
  persistLocal(withAlias(localAliases, update))
}

export async function setCollectionAlias(
  connectionId: string,
  database: string,
  collection: string,
  alias: string,
): Promise<void> {
  const update: AliasUpdate = { kind: "collection", connectionId, database, collection, alias }
  if (mode === "team") return updateTeamAlias(update)
  persistLocal(withAlias(localAliases, update))
}

export function databaseLabel(
  aliases: AliasState,
  connectionId: string,
  database: string,
): string {
  return aliases.databases[aliasDbKey(connectionId, database)] || database
}

export function collectionLabel(
  aliases: AliasState,
  connectionId: string,
  database: string,
  collection: string,
): string {
  return aliases.collections[aliasCollectionKey(connectionId, database, collection)] || collection
}
