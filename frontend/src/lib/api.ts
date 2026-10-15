import type {
  AggregateResult,
  AuditEntry,
  AuthRole,
  AuthSetup,
  AuthStatus,
  AuthUser,
  AuthUserSetup,
  BackupFile,
  BackupTask,
  CollectionInfo,
  Connection,
  ConnectionInput,
  CopyResult,
  DatabaseList,
  DeleteRequest,
  ExplainRequest,
  ExportResult,
  FindRequest,
  FindResult,
  ImportResult,
  IndexInfo,
  MCPSettings,
  MongoDocument,
  OIDCConfig,
  ProfileResult,
  SchemaResult,
  SearchResult,
  ScriptResult,
  SQLResult,
  TransferFormat,
  UpdateSettings,
  UpdateState,
  UpdateStatus,
  UpdateRequest,
} from "@/lib/types"

const BASE = "/api"

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

export function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  )
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(BASE + path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    })
  } catch (err) {
    // A user-cancelled request must not be turned into a generic network error.
    if (isAbortError(err)) throw err
    throw new ApiError(err instanceof Error ? err.message : "Network request failed", 0)
  }

  const text = await res.text()
  let body: unknown = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
  }

  if (!res.ok) {
    // A 401 means the session expired or was never established; let the auth
    // gate show the login screen again.
    if (res.status === 401) {
      try {
        window.dispatchEvent(new Event("mongoui-unauthorized"))
      } catch {
        /* ignore */
      }
    }
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : res.statusText || `Request failed with status ${res.status}`
    throw new ApiError(message, res.status)
  }

  if (body && typeof body === "object" && "data" in body) {
    return (body as { data: T }).data
  }
  return body as T
}

function enc(value: string) {
  return encodeURIComponent(value)
}

const post = (path: string, body?: unknown) =>
  request<unknown>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) })

export const api = {
  // connections -----------------------------------------------------------------
  listConnections: () => request<Connection[]>("/connections"),
  // getConnection returns the full record (used when editing); the list is redacted.
  getConnection: (id: string) => request<Connection>(`/connections/${id}`),
  createConnection: (input: ConnectionInput) =>
    request<Connection>("/connections", { method: "POST", body: JSON.stringify(input) }),
  updateConnection: (id: string, input: ConnectionInput) =>
    request<Connection>(`/connections/${id}`, { method: "PUT", body: JSON.stringify(input) }),
  deleteConnection: (id: string) => request<{ id: string }>(`/connections/${id}`, { method: "DELETE" }),
  connect: (id: string) => request<Connection>(`/connections/${id}/connect`, { method: "POST" }),
  disconnect: (id: string) => request<unknown>(`/connections/${id}/disconnect`, { method: "POST" }),
  testConnection: (input: ConnectionInput) =>
    request<{ ok: boolean; message: string }>("/connections/test", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  serverInfo: (id: string) => request<Record<string, unknown>>(`/connections/${id}/server`),

  // databases -------------------------------------------------------------------
  listDatabases: (id: string) => request<DatabaseList>(`/connections/${id}/databases`),
  createDatabase: (id: string, name: string, collection: string) =>
    post(`/connections/${id}/databases`, { name, collection }),
  dropDatabase: (id: string, db: string) =>
    request<unknown>(`/connections/${id}/databases/${enc(db)}`, { method: "DELETE" }),
  databaseStats: (id: string, db: string) =>
    request<Record<string, unknown>>(`/connections/${id}/databases/${enc(db)}/stats`),

  // collections -----------------------------------------------------------------
  listCollections: (id: string, db: string) =>
    request<CollectionInfo[]>(`/connections/${id}/databases/${enc(db)}/collections`),
  createCollection: (
    id: string,
    db: string,
    body: { name: string; capped?: boolean; size?: number; max?: number },
  ) => post(`/connections/${id}/databases/${enc(db)}/collections`, body),
  dropCollection: (id: string, db: string, col: string) =>
    request<unknown>(`/connections/${id}/databases/${enc(db)}/collections/${enc(col)}`, {
      method: "DELETE",
    }),
  collectionStats: (id: string, db: string, col: string) =>
    request<Record<string, unknown>>(
      `/connections/${id}/databases/${enc(db)}/collections/${enc(col)}/stats`,
    ),
  collectionSchema: (id: string, db: string, col: string) =>
    request<SchemaResult>(`/connections/${id}/databases/${enc(db)}/collections/${enc(col)}/schema`),

  // documents -------------------------------------------------------------------
  find: (id: string, db: string, col: string, req: FindRequest, signal?: AbortSignal) =>
    request<FindResult>(`/connections/${id}/databases/${enc(db)}/collections/${enc(col)}/find`, {
      method: "POST",
      body: JSON.stringify(req),
      signal,
    }),
  searchDatabase: (
    id: string,
    db: string,
    req: {
      term: string
      field?: string
      mode?: "value" | "field"
      limit?: number
      maxCollections?: number
    },
  ) =>
    request<SearchResult>(`/connections/${id}/databases/${enc(db)}/search`, {
      method: "POST",
      body: JSON.stringify(req),
    }),
  listAudit: (params?: { connectionId?: string; limit?: number }) => {
    const query = new URLSearchParams()
    if (params?.connectionId) query.set("connectionId", params.connectionId)
    if (params?.limit) query.set("limit", String(params.limit))
    const suffix = query.toString()
    return request<{ entries: AuditEntry[] }>(`/audit${suffix ? `?${suffix}` : ""}`)
  },
  databaseProfile: (id: string, db: string, params?: { limit?: number; minMillis?: number }) => {
    const query = new URLSearchParams()
    if (params?.limit) query.set("limit", String(params.limit))
    if (params?.minMillis) query.set("minMillis", String(params.minMillis))
    const suffix = query.toString()
    return request<ProfileResult>(
      `/connections/${id}/databases/${enc(db)}/profile${suffix ? `?${suffix}` : ""}`,
    )
  },
  insert: (id: string, db: string, col: string, documents: MongoDocument[]) =>
    request<{ insertedCount: number; insertedIds: unknown[] }>(
      `/connections/${id}/databases/${enc(db)}/collections/${enc(col)}/insert`,
      { method: "POST", body: JSON.stringify({ documents }) },
    ),
  update: (id: string, db: string, col: string, req: UpdateRequest) =>
    request<{ matchedCount: number; modifiedCount: number; upsertedCount: number }>(
      `/connections/${id}/databases/${enc(db)}/collections/${enc(col)}/update`,
      { method: "POST", body: JSON.stringify(req) },
    ),
  remove: (id: string, db: string, col: string, req: DeleteRequest) =>
    request<{ deletedCount: number }>(
      `/connections/${id}/databases/${enc(db)}/collections/${enc(col)}/delete`,
      { method: "POST", body: JSON.stringify(req) },
    ),
  aggregate: (
    id: string,
    db: string,
    col: string,
    pipeline: unknown[],
    limit?: number,
    signal?: AbortSignal,
  ) =>
    request<AggregateResult>(
      `/connections/${id}/databases/${enc(db)}/collections/${enc(col)}/aggregate`,
      { method: "POST", body: JSON.stringify({ pipeline, limit }), signal },
    ),
  explain: (id: string, db: string, col: string, req: ExplainRequest) =>
    request<Record<string, unknown>>(
      `/connections/${id}/databases/${enc(db)}/collections/${enc(col)}/explain`,
      { method: "POST", body: JSON.stringify(req) },
    ),
  exportDocuments: (
    id: string,
    db: string,
    col: string,
    req: { format: TransferFormat; filter?: unknown; sort?: unknown; projection?: unknown; limit?: number },
  ) =>
    request<ExportResult>(
      `/connections/${id}/databases/${enc(db)}/collections/${enc(col)}/export`,
      { method: "POST", body: JSON.stringify(req) },
    ),
  importDocuments: (
    id: string,
    db: string,
    col: string,
    req: { format: TransferFormat; content: string; drop?: boolean },
  ) =>
    request<ImportResult>(
      `/connections/${id}/databases/${enc(db)}/collections/${enc(col)}/import`,
      { method: "POST", body: JSON.stringify(req) },
    ),
  copyCollection: (
    id: string,
    db: string,
    col: string,
    req: {
      targetConnectionId?: string
      targetDatabase: string
      targetCollection: string
      filter?: unknown
      dropTarget?: boolean
      copyIndexes?: boolean
      fieldMap?: Record<string, string>
      excludeFields?: string[]
    },
  ) =>
    request<CopyResult>(
      `/connections/${id}/databases/${enc(db)}/collections/${enc(col)}/copy`,
      { method: "POST", body: JSON.stringify(req) },
    ),

  // SQL -------------------------------------------------------------------------
  runSQL: (id: string, db: string, query: string, limit?: number, signal?: AbortSignal) =>
    request<SQLResult>(`/connections/${id}/databases/${enc(db)}/sql`, {
      method: "POST",
      body: JSON.stringify({ query, limit }),
      signal,
    }),
  runScript: (id: string, db: string, script: string, limit?: number, signal?: AbortSignal) =>
    request<ScriptResult>(`/connections/${id}/databases/${enc(db)}/script`, {
      method: "POST",
      body: JSON.stringify({ script, limit }),
      signal,
    }),

  // auth ------------------------------------------------------------------------
  authStatus: () => request<AuthStatus>("/auth/status"),
  authSetupBegin: () => request<AuthSetup>("/auth/setup/begin", { method: "POST" }),
  authSetupConfirm: (code: string) =>
    request<{ enabled: boolean }>("/auth/setup/confirm", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),
  authLogin: (username: string, code: string) =>
    request<{ authenticated: boolean; username?: string; role?: AuthRole }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, code }),
    }),
  authLogout: () => request<{ authenticated: boolean }>("/auth/logout", { method: "POST" }),
  authOIDCConfig: () =>
    request<{ enabled: boolean; buttonLabel?: string }>("/auth/oidc/config"),
  getOIDCSettings: () => request<OIDCConfig>("/auth/oidc/settings"),
  updateOIDCSettings: (input: Partial<OIDCConfig>) =>
    request<OIDCConfig>("/auth/oidc/settings", {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  listAuthUsers: () => request<AuthUser[]>("/auth/users"),
  createAuthUser: (username: string, role: AuthRole) =>
    request<AuthUserSetup>("/auth/users", {
      method: "POST",
      body: JSON.stringify({ username, role }),
    }),
  confirmAuthUser: (id: string, code: string) =>
    request<AuthUser>(`/auth/users/${enc(id)}/confirm`, {
      method: "POST",
      body: JSON.stringify({ code }),
    }),
  updateAuthUserRole: (id: string, role: AuthRole) =>
    request<{ id: string; role: AuthRole }>(`/auth/users/${enc(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    }),
  deleteAuthUser: (id: string) =>
    request<{ deleted: string }>(`/auth/users/${enc(id)}`, { method: "DELETE" }),

  // backups ---------------------------------------------------------------------
  listBackups: () => request<{ tasks: BackupTask[] }>("/backups"),
  createBackup: (task: {
    name?: string
    connectionId: string
    database: string
    collection: string
    format?: string
    intervalMinutes?: number
    enabled?: boolean
    filter?: unknown
  }) => request<BackupTask>("/backups", { method: "POST", body: JSON.stringify(task) }),
  updateBackup: (id: string, update: { enabled?: boolean; intervalMinutes?: number }) =>
    request<BackupTask>(`/backups/${enc(id)}`, { method: "PATCH", body: JSON.stringify(update) }),
  deleteBackup: (id: string) =>
    request<{ deleted: string }>(`/backups/${enc(id)}`, { method: "DELETE" }),
  runBackup: (id: string) =>
    request<{ started: boolean }>(`/backups/${enc(id)}/run`, { method: "POST" }),
  listBackupFiles: (id: string) => request<{ files: BackupFile[] }>(`/backups/${enc(id)}/files`),

  // MCP -------------------------------------------------------------------------
  mcpSettings: () => request<MCPSettings>("/mcp"),
  updateMcpSettings: (input: Partial<MCPSettings>) =>
    request<MCPSettings>("/mcp", { method: "PUT", body: JSON.stringify(input) }),

  // self-update -----------------------------------------------------------------
  getUpdate: () => request<UpdateState>("/update"),
  updateUpdateSettings: (input: Partial<UpdateSettings>) =>
    request<UpdateSettings>("/update", { method: "PUT", body: JSON.stringify(input) }),
  checkUpdate: () => request<UpdateStatus>("/update/check", { method: "POST" }),
  installUpdate: () => request<UpdateStatus>("/update/install", { method: "POST" }),

  // indexes ---------------------------------------------------------------------
  listIndexes: (id: string, db: string, col: string) =>
    request<IndexInfo[]>(
      `/connections/${id}/databases/${enc(db)}/collections/${enc(col)}/indexes`,
    ),
  createIndex: (id: string, db: string, col: string, keys: unknown, options: unknown) =>
    request<{ name: string }>(
      `/connections/${id}/databases/${enc(db)}/collections/${enc(col)}/indexes`,
      { method: "POST", body: JSON.stringify({ keys, options }) },
    ),
  updateIndex: (
    id: string,
    db: string,
    col: string,
    name: string,
    update: { hidden?: boolean; expireAfterSeconds?: number },
  ) =>
    request<{ updated: string }>(
      `/connections/${id}/databases/${enc(db)}/collections/${enc(col)}/indexes/${enc(name)}`,
      { method: "PATCH", body: JSON.stringify(update) },
    ),
  dropIndex: (id: string, db: string, col: string, name: string) =>
    request<{ dropped: string }>(
      `/connections/${id}/databases/${enc(db)}/collections/${enc(col)}/indexes/${enc(name)}`,
      { method: "DELETE" },
    ),
}
