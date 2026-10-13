export interface SSHConfig {
  enabled: boolean
  host?: string
  port?: number
  user?: string
  authMethod?: "password" | "privateKey"
  password?: string
  privateKey?: string
  passphrase?: string
  knownHosts?: string
}

export interface Connection {
  id: string
  name: string
  uri: string
  color?: string
  readOnly?: boolean
  ssh?: SSHConfig
  createdAt: string
  updatedAt: string
  connected: boolean
}

export interface ConnectionInput {
  name: string
  uri: string
  color?: string
  readOnly?: boolean
  ssh?: SSHConfig
}

export interface DatabaseInfo {
  name: string
  sizeOnDisk: number
  empty: boolean
}

export interface DatabaseList {
  databases: DatabaseInfo[]
  totalSize: number
}

export interface CollectionInfo {
  name: string
  type?: string
  options?: Record<string, unknown>
  info?: Record<string, unknown>
  idIndex?: Record<string, unknown>
}

export type MongoDocument = Record<string, unknown>

export interface FindResult {
  documents: MongoDocument[]
  total: number
  skip: number
  limit: number
}

export interface AggregateResult {
  documents: MongoDocument[]
  count: number
}

export interface FindRequest {
  filter?: unknown
  sort?: unknown
  projection?: unknown
  skip?: number
  limit?: number
}

export interface UpdateRequest {
  filter: unknown
  update: unknown
  many?: boolean
  upsert?: boolean
}

export interface DeleteRequest {
  filter: unknown
  many?: boolean
}

export interface FieldStat {
  name: string
  count: number
  types: Record<string, number>
}

export interface SchemaResult {
  sampled: number
  fields: FieldStat[]
}

export interface SQLResult {
  documents: MongoDocument[]
  count: number
  total: number
  skip: number
  limit: number
  columns: string[] | null
  mql: Record<string, unknown>
}

export type TransferFormat = "json" | "csv"

export interface ExportResult {
  filename: string
  contentType: string
  content: string
  count: number
}

export interface ImportResult {
  insertedCount: number
}

export interface CopyResult {
  copied: number
  targetDatabase: string
  targetCollection: string
  indexesCopied?: number
  warnings?: string[]
}

export type ExplainVerbosity = "queryPlanner" | "executionStats" | "allPlansExecution"

export interface ExplainRequest {
  type: "find" | "aggregate"
  filter?: unknown
  sort?: unknown
  projection?: unknown
  pipeline?: unknown
  skip?: number
  limit?: number
  verbosity?: ExplainVerbosity
}

export type AuthRole = "admin" | "readwrite" | "readonly"

export interface AuthStatus {
  enabled: boolean
  authenticated: boolean
  needsSetup: boolean
  username?: string
  role?: AuthRole
}

export interface AuthSetup {
  secret: string
  otpauthUrl: string
  qr: string
}

export interface AuthUser {
  id: string
  username: string
  role: AuthRole
  createdAt: string
}

export interface AuthUserSetup {
  id: string
  secret: string
  otpauthUrl: string
  qr: string
}

export interface BackupTask {
  id: string
  name: string
  connectionId: string
  database: string
  collection: string
  format: "json" | "csv"
  intervalMinutes: number
  enabled: boolean
  createdAt: string
  lastRun?: string
  lastStatus?: "ok" | "error"
  lastError?: string
  lastFile?: string
  lastCount?: number
}

export interface MCPSettings {
  enabled: boolean
  read: boolean
  write: boolean
}

export interface UpdateSettings {
  auto: boolean
  intervalMinutes: number
}

export interface UpdateStatus {
  current: string
  latest: string
  updateAvailable: boolean
  installedVersion: string
  restartRequired: boolean
  lastChecked: string
  lastError?: string
}

export interface UpdateState {
  settings: UpdateSettings
  status: UpdateStatus | null
}

export interface IndexInfo {
  v?: number
  key: Record<string, unknown>
  name: string
  unique?: boolean
  sparse?: boolean
  hidden?: boolean
  expireAfterSeconds?: number
  partialFilterExpression?: unknown
  collation?: unknown
  weights?: Record<string, number>
  default_language?: string
  language_override?: string
  wildcardProjection?: unknown
  [key: string]: unknown
}

export type Selection =
  | { kind: "welcome" }
  | { kind: "connection"; connectionId: string }
  | { kind: "collection"; connectionId: string; database: string; collection: string }

export interface SearchHit {
  collection: string
  count: number
  sample: MongoDocument[]
}

export interface ProfileResult {
  enabled: boolean
  entries: MongoDocument[]
}

export interface AuditEntry {
  time: string
  connectionId: string
  database: string
  collection: string
  method: string
  operation: string
  path: string
  status: number
}

export interface SearchResult {
  term: string
  mode: "value" | "field"
  results: SearchHit[]
}
