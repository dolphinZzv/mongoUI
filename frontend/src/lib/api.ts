import type {
  AggregateResult,
  AuthSetup,
  AuthStatus,
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
  SchemaResult,
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
  find: (id: string, db: string, col: string, req: FindRequest) =>
    request<FindResult>(`/connections/${id}/databases/${enc(db)}/collections/${enc(col)}/find`, {
      method: "POST",
      body: JSON.stringify(req),
    }),
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
  aggregate: (id: string, db: string, col: string, pipeline: unknown[], limit?: number) =>
    request<AggregateResult>(
      `/connections/${id}/databases/${enc(db)}/collections/${enc(col)}/aggregate`,
      { method: "POST", body: JSON.stringify({ pipeline, limit }) },
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
      targetDatabase: string
      targetCollection: string
      filter?: unknown
      dropTarget?: boolean
      copyIndexes?: boolean
    },
  ) =>
    request<CopyResult>(
      `/connections/${id}/databases/${enc(db)}/collections/${enc(col)}/copy`,
      { method: "POST", body: JSON.stringify(req) },
    ),

  // SQL -------------------------------------------------------------------------
  runSQL: (id: string, db: string, query: string, limit?: number) =>
    request<SQLResult>(`/connections/${id}/databases/${enc(db)}/sql`, {
      method: "POST",
      body: JSON.stringify({ query, limit }),
    }),

  // auth ------------------------------------------------------------------------
  authStatus: () => request<AuthStatus>("/auth/status"),
  authSetupBegin: () => request<AuthSetup>("/auth/setup/begin", { method: "POST" }),
  authSetupConfirm: (code: string) =>
    request<{ enabled: boolean }>("/auth/setup/confirm", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),
  authLogin: (code: string) =>
    request<{ authenticated: boolean }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),
  authLogout: () => request<{ authenticated: boolean }>("/auth/logout", { method: "POST" }),

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
