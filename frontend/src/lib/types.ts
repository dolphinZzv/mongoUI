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

export type Selection =
  | { kind: "welcome" }
  | { kind: "connection"; connectionId: string }
  | { kind: "collection"; connectionId: string; database: string; collection: string }
