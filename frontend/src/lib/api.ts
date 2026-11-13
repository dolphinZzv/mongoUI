import type { SavedChartView } from "@/lib/chart"
import type {
  AggregateResult,
  AIFilterInput,
  AIFilterResult,
  AISettings,
  AlertRule,
  AlertRuntimeState,
  ReportRule,
  ReportRuntimeState,
  RunbookRule,
  RunbookRuntimeState,
  SavedQuery,
  SMTPSettings,
  AISettingsInput,
  AITestResult,
  AliasState,
  AliasUpdate,
  AIProposal,
  AuditEntry,
  AuthRole,
  AuthScope,
  AuthSetup,
  AuthStatus,
  AuthToken,
  AuthTokenCreate,
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
  ExportDownload,
  FeedbackInput,
  FeedbackResult,
  FindRequest,
  FindResult,
  ImportResult,
  IndexInfo,
  IndexStat,
  ValidatorState,
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

function filenameFromDisposition(value: string | null): string | undefined {
  if (!value) return undefined
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(value)
  if (utf8) {
    try {
      return decodeURIComponent(utf8[1])
    } catch {
      /* fall through to the quoted form */
    }
  }
  const quoted = /filename="([^"]*)"/i.exec(value)
  return quoted?.[1]
}

/** Fetch a streaming download endpoint and keep the server-provided filename. */
async function download(path: string, init?: RequestInit): Promise<ExportDownload> {
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
    if (isAbortError(err)) throw err
    throw new ApiError(err instanceof Error ? err.message : "Network request failed", 0)
  }

  if (!res.ok) {
    if (res.status === 401) {
      try {
        window.dispatchEvent(new Event("mongoui-unauthorized"))
      } catch {
        /* ignore */
      }
    }
    let message = res.statusText || `Request failed with status ${res.status}`
    try {
      const body = (await res.json()) as { error?: unknown }
      if (body && typeof body.error === "string") message = body.error
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(message, res.status)
  }

  const blob = await res.blob()
  const countHeader = res.headers.get("X-Mongoui-Export-Count")
  const parsedCount = countHeader === null ? undefined : Number(countHeader)
  return {
    blob,
    filename: filenameFromDisposition(res.headers.get("Content-Disposition")) ?? "export",
    count:
      parsedCount !== undefined && Number.isFinite(parsedCount) && parsedCount >= 0
        ? parsedCount
        : undefined,
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
  listDatabases: (id: string, opts?: { sizes?: boolean }) =>
    request<DatabaseList>(
      `/connections/${id}/databases${opts?.sizes ? "?sizes=1" : ""}`,
    ),
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
  listAIProposals: () =>
    request<{ proposals: AIProposal[] }>("/ai/proposals", { cache: "no-store" }),
  approveAIProposal: (id: string) =>
    request<{ approved: boolean }>(`/ai/proposals/${enc(id)}/approve`, { method: "POST" }),
  rejectAIProposal: (id: string) =>
    request<{ rejected: boolean }>(`/ai/proposals/${enc(id)}/reject`, { method: "POST" }),
  applyAIProposal: (id: string) =>
    request<{ applied: boolean; result?: string }>(`/ai/proposals/${enc(id)}/apply`, {
      method: "POST",
    }),
  rollbackAIProposal: (id: string) =>
    request<{ rolledBack: boolean }>(`/ai/proposals/${enc(id)}/rollback`, { method: "POST" }),
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
  watchUrl: (id: string, db: string, col: string, filter: string) =>
    `/api/connections/${id}/databases/${enc(db)}/collections/${enc(col)}/watch?filter=${encodeURIComponent(filter)}`,
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
    download(
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
      verify?: boolean
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
  authStatus: () => request<AuthStatus>("/auth/status", { cache: "no-store" }),
  authSetupBegin: () => request<AuthSetup>("/auth/setup/begin", { method: "POST" }),
  authSetupConfirm: (code: string) =>
    request<{ enabled: boolean }>("/auth/setup/confirm", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),
  authSetupPassword: (username: string, password: string) =>
    request<{ enabled: boolean; username: string; role: AuthRole }>("/auth/setup/password", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  authLogin: (username: string, code: string) =>
    request<{ authenticated: boolean; username?: string; role?: AuthRole }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, code }),
    }),
  authLoginPassword: (username: string, password: string) =>
    request<{ authenticated: boolean; username?: string; role?: AuthRole }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password, method: "password" }),
    }),
  authChangePassword: (currentPassword: string, newPassword: string) =>
    request<{ updated: boolean }>("/auth/password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  listAuthTokens: () => request<AuthToken[]>("/auth/tokens", { cache: "no-store" }),
  createAuthToken: (name: string, scopes: AuthScope[], expiresAt?: string) =>
    request<AuthTokenCreate>("/auth/tokens", {
      method: "POST",
      body: JSON.stringify({ name, scopes, expiresAt }),
    }),
  deleteAuthToken: (id: string) =>
    request<{ deleted: string }>(`/auth/tokens/${enc(id)}`, { method: "DELETE" }),
  authLogout: (all = false) =>
    request<{ authenticated: boolean }>("/auth/logout", {
      method: "POST",
      body: all ? JSON.stringify({ all: true }) : undefined,
    }),
  authOIDCConfig: () =>
    request<{ enabled: boolean; buttonLabel?: string }>("/auth/oidc/config"),
  getOIDCSettings: () => request<OIDCConfig>("/auth/oidc/settings"),
  updateOIDCSettings: (input: Partial<OIDCConfig>) =>
    request<OIDCConfig>("/auth/oidc/settings", {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  listAuthUsers: () => request<AuthUser[]>("/auth/users", { cache: "no-store" }),
  createAuthUser: (username: string, role: AuthRole) =>
    request<AuthUserSetup>("/auth/users", {
      method: "POST",
      body: JSON.stringify({ username, role }),
    }),
  createAuthUserPassword: (username: string, role: AuthRole, password: string) =>
    request<AuthUser>("/auth/users", {
      method: "POST",
      body: JSON.stringify({ username, role, password }),
    }),
  updateAuthUserPassword: (id: string, password: string) =>
    request<{ id: string; role?: AuthRole }>(`/auth/users/${enc(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ password }),
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
  updateAuthUserConnections: (id: string, connectionIds: string[]) =>
    request<{ id: string }>(`/auth/users/${enc(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ connectionIds }),
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

  // feedback --------------------------------------------------------------------
  submitFeedback: (input: FeedbackInput) =>
    request<FeedbackResult>("/feedback", { method: "POST", body: JSON.stringify(input) }),

  // aliases ---------------------------------------------------------------------
  getAliases: () => request<AliasState>("/aliases"),
  updateAlias: (input: AliasUpdate) =>
    request<AliasState>("/aliases", { method: "PATCH", body: JSON.stringify(input) }),

  // AI / BYOK ------------------------------------------------------------------
  getAISettings: () => request<AISettings>("/ai"),
  updateAISettings: (input: AISettingsInput) =>
    request<AISettings>("/ai", { method: "PUT", body: JSON.stringify(input) }),
  testAISettings: (input: AISettingsInput) =>
    request<AITestResult>("/ai/test", { method: "POST", body: JSON.stringify(input) }),
  generateAIFilter: (input: AIFilterInput) =>
    request<AIFilterResult>("/ai/filter", { method: "POST", body: JSON.stringify(input) }),

  // shared chart views ------------------------------------------------------------
  getAlerts: () =>
    request<{ rules: AlertRule[]; statuses: Record<string, AlertRuntimeState> }>("/alerts"),
  saveAlerts: (rules: AlertRule[]) =>
    request<{ rules: AlertRule[]; statuses: Record<string, AlertRuntimeState> }>("/alerts", {
      method: "PUT",
      body: JSON.stringify({ rules }),
    }),
  testAlert: (rule: AlertRule) =>
    request<{ sent: boolean }>("/alerts/test", {
      method: "POST",
      body: JSON.stringify(rule),
    }),
  getRunbooks: () =>
    request<{ runbooks: RunbookRule[]; statuses: Record<string, RunbookRuntimeState> }>(
      "/runbooks",
    ),
  saveRunbooks: (runbooks: RunbookRule[]) =>
    request<{ runbooks: RunbookRule[]; statuses: Record<string, RunbookRuntimeState> }>(
      "/runbooks",
      { method: "PUT", body: JSON.stringify({ runbooks }) },
    ),
  runRunbook: (id: string) =>
    request<{ started: boolean }>(`/runbooks/${encodeURIComponent(id)}/run`, { method: "POST" }),
  getReports: () =>
    request<{ reports: ReportRule[]; statuses?: Record<string, ReportRuntimeState> }>("/reports", {
      cache: "no-store",
    }),
  saveReports: (reports: ReportRule[]) =>
    request<{ reports: ReportRule[]; statuses?: Record<string, ReportRuntimeState> }>("/reports", {
      method: "PUT",
      body: JSON.stringify({ reports }),
    }),
  runReport: (id: string) =>
    request<{ started: boolean }>(`/reports/${encodeURIComponent(id)}/run`, { method: "POST" }),
  getSMTP: () => request<SMTPSettings>("/smtp"),
  saveSMTP: (settings: SMTPSettings) =>
    request<SMTPSettings>("/smtp", { method: "PUT", body: JSON.stringify(settings) }),
  getSavedQueries: (scope: string) =>
    request<{ version: number; queries: SavedQuery[] }>(
      `/queries?scope=${encodeURIComponent(scope)}`,
    ),
  saveSavedQueries: (scope: string, queries: SavedQuery[], version: number) =>
    request<{ version: number; queries: SavedQuery[] }>("/queries", {
      method: "PUT",
      body: JSON.stringify({ scope, version, queries }),
    }),
  getChartViews: (scope: string) =>
    request<{ version: number; views: SavedChartView[] }>(
      `/chart-views?scope=${encodeURIComponent(scope)}`,
    ),
  getConnectionChartViews: (connectionId: string) =>
    request<{ scopes: Record<string, SavedChartView[]> }>(
      `/chart-views?connectionId=${encodeURIComponent(connectionId)}`,
    ),
  saveChartViews: (scope: string, views: SavedChartView[], version: number) =>
    request<{ version: number; views: SavedChartView[] }>("/chart-views", {
      method: "PUT",
      body: JSON.stringify({ scope, version, views }),
    }),

  // indexes ---------------------------------------------------------------------
  getValidator: (id: string, db: string, col: string) =>
    request<ValidatorState>(
      `/connections/${id}/databases/${enc(db)}/collections/${enc(col)}/validator`,
    ),
  updateValidator: (
    id: string,
    db: string,
    col: string,
    input: { validator: unknown; validationLevel: string; validationAction: string },
  ) =>
    request<{ saved: boolean }>(
      `/connections/${id}/databases/${enc(db)}/collections/${enc(col)}/validator`,
      { method: "PUT", body: JSON.stringify(input) },
    ),
  indexStats: (id: string, db: string, col: string) =>
    request<{ indexes: IndexStat[] }>(
      `/connections/${id}/databases/${enc(db)}/collections/${enc(col)}/index-stats`,
    ),
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
