import { api } from "@/lib/api"
import type { FindRequest, MongoDocument } from "@/lib/types"

/**
 * Tools an in-browser agent (WebMCP, a browser extension, the console, ...) can
 * call to explore and manage MongoDB through the running server.
 *
 * Every tool is a thin wrapper around the same REST API the UI uses, so there
 * is no privileged back door: the agent is bound by the server's own read-only
 * flag and validation. All tools are gated behind an explicit opt-in (see
 * `lib/webmcp.ts`) and are off by default.
 */

export interface AgentTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  execute: (args: Record<string, unknown>) => unknown | Promise<unknown>
}

// --- argument helpers -------------------------------------------------------

function str(args: Record<string, unknown>, key: string): string | undefined {
  return typeof args[key] === "string" ? (args[key] as string) : undefined
}

function num(args: Record<string, unknown>, key: string): number | undefined {
  return typeof args[key] === "number" && Number.isFinite(args[key]) ? (args[key] as number) : undefined
}

function bool(args: Record<string, unknown>, key: string): boolean | undefined {
  return typeof args[key] === "boolean" ? (args[key] as boolean) : undefined
}

function obj(args: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const v = args[key]
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
}

function list(args: Record<string, unknown>, key: string): unknown[] {
  const v = args[key]
  return Array.isArray(v) ? v : []
}

function requiredStr(args: Record<string, unknown>, key: string): string {
  const v = str(args, key)
  if (!v) throw new Error(`${key} is required`)
  return v
}

const connectionId = {
  connectionId: { type: "string", description: "Connection id from mongoui_list_connections" },
}
const collectionTarget = {
  ...connectionId,
  database: { type: "string" },
  collection: { type: "string" },
}

export const agentTools: AgentTool[] = [
  {
    name: "mongoui_list_connections",
    description:
      "List the saved MongoDB connections with their id, name, connected state and read-only flag. Call this first to resolve a connectionId.",
    inputSchema: { type: "object", properties: {} },
    execute: () => api.listConnections(),
  },
  {
    name: "mongoui_connect",
    description: "Open a connection to a saved MongoDB deployment.",
    inputSchema: { type: "object", properties: connectionId, required: ["connectionId"] },
    execute: (args) => api.connect(requiredStr(args, "connectionId")),
  },
  {
    name: "mongoui_disconnect",
    description: "Close a previously opened connection.",
    inputSchema: { type: "object", properties: connectionId, required: ["connectionId"] },
    execute: (args) => api.disconnect(requiredStr(args, "connectionId")),
  },
  {
    name: "mongoui_server_info",
    description: "Return server build/hello information for an open connection.",
    inputSchema: { type: "object", properties: connectionId, required: ["connectionId"] },
    execute: (args) => api.serverInfo(requiredStr(args, "connectionId")),
  },
  {
    name: "mongoui_list_databases",
    description: "List databases on an open connection, including on-disk size.",
    inputSchema: { type: "object", properties: connectionId, required: ["connectionId"] },
    execute: (args) => api.listDatabases(requiredStr(args, "connectionId")),
  },
  {
    name: "mongoui_list_collections",
    description: "List the collections of a database.",
    inputSchema: {
      type: "object",
      properties: { ...connectionId, database: { type: "string" } },
      required: ["connectionId", "database"],
    },
    execute: (args) =>
      api.listCollections(requiredStr(args, "connectionId"), requiredStr(args, "database")),
  },
  {
    name: "mongoui_collection_stats",
    description: "Return collStats for a collection.",
    inputSchema: { type: "object", properties: collectionTarget, required: ["connectionId", "database", "collection"] },
    execute: (args) =>
      api.collectionStats(
        requiredStr(args, "connectionId"),
        requiredStr(args, "database"),
        requiredStr(args, "collection"),
      ),
  },
  {
    name: "mongoui_collection_schema",
    description:
      "Sample documents from a collection and report field coverage and BSON type distribution.",
    inputSchema: { type: "object", properties: collectionTarget, required: ["connectionId", "database", "collection"] },
    execute: (args) =>
      api.collectionSchema(
        requiredStr(args, "connectionId"),
        requiredStr(args, "database"),
        requiredStr(args, "collection"),
      ),
  },
  {
    name: "mongoui_find",
    description:
      "Query documents. `filter`, `sort` and `projection` use MongoDB Extended JSON (relaxed), e.g. {\"_id\":{\"$oid\":\"...\"}}. Returns documents plus the total match count.",
    inputSchema: {
      type: "object",
      properties: {
        ...collectionTarget,
        filter: { type: "object", description: "MongoDB query filter" },
        sort: { type: "object", description: "Sort spec, e.g. {\"age\":-1}" },
        projection: { type: "object", description: "Projection spec" },
        skip: { type: "number" },
        limit: { type: "number" },
      },
      required: ["connectionId", "database", "collection"],
    },
    execute: (args) => {
      const req: FindRequest = {
        filter: obj(args, "filter") ?? {},
        sort: obj(args, "sort"),
        projection: obj(args, "projection"),
        skip: num(args, "skip"),
        limit: num(args, "limit"),
      }
      return api.find(
        requiredStr(args, "connectionId"),
        requiredStr(args, "database"),
        requiredStr(args, "collection"),
        req,
      )
    },
  },
  {
    name: "mongoui_aggregate",
    description: "Run an aggregation pipeline against a collection.",
    inputSchema: {
      type: "object",
      properties: {
        ...collectionTarget,
        pipeline: { type: "array", description: "Array of pipeline stages", items: { type: "object" } },
        limit: { type: "number" },
      },
      required: ["connectionId", "database", "collection", "pipeline"],
    },
    execute: (args) => {
      const pipeline = list(args, "pipeline")
      if (pipeline.length === 0) throw new Error("pipeline must be a non-empty array")
      return api.aggregate(
        requiredStr(args, "connectionId"),
        requiredStr(args, "database"),
        requiredStr(args, "collection"),
        pipeline,
        num(args, "limit"),
      )
    },
  },
  {
    name: "mongoui_list_indexes",
    description: "List the indexes defined on a collection.",
    inputSchema: { type: "object", properties: collectionTarget, required: ["connectionId", "database", "collection"] },
    execute: (args) =>
      api.listIndexes(
        requiredStr(args, "connectionId"),
        requiredStr(args, "database"),
        requiredStr(args, "collection"),
      ),
  },
  {
    name: "mongoui_insert",
    description:
      "Insert one or more documents (Extended JSON). Inserting an array inserts all documents in one batch.",
    inputSchema: {
      type: "object",
      properties: {
        ...collectionTarget,
        documents: { type: "array", items: { type: "object" }, description: "Documents to insert" },
      },
      required: ["connectionId", "database", "collection", "documents"],
    },
    execute: (args) => {
      const documents = list(args, "documents") as MongoDocument[]
      if (documents.length === 0) throw new Error("documents must be a non-empty array")
      return api.insert(
        requiredStr(args, "connectionId"),
        requiredStr(args, "database"),
        requiredStr(args, "collection"),
        documents,
      )
    },
  },
  {
    name: "mongoui_update",
    description:
      "Update documents. If `update` contains `$` operators it is treated as an update document, otherwise it replaces whole documents. Set many=true to update every match.",
    inputSchema: {
      type: "object",
      properties: {
        ...collectionTarget,
        filter: { type: "object", description: "Which documents to update" },
        update: { type: "object", description: "Update document or full replacement" },
        many: { type: "boolean", description: "Update all matches (default: first match)" },
        upsert: { type: "boolean" },
      },
      required: ["connectionId", "database", "collection", "filter", "update"],
    },
    execute: (args) =>
      api.update(
        requiredStr(args, "connectionId"),
        requiredStr(args, "database"),
        requiredStr(args, "collection"),
        {
          filter: obj(args, "filter") ?? {},
          update: obj(args, "update") ?? {},
          many: bool(args, "many"),
          upsert: bool(args, "upsert"),
        },
      ),
  },
  {
    name: "mongoui_delete",
    description: "Delete documents matching a filter. Set many=true to delete every match.",
    inputSchema: {
      type: "object",
      properties: {
        ...collectionTarget,
        filter: { type: "object", description: "Which documents to delete" },
        many: { type: "boolean", description: "Delete all matches (default: first match)" },
      },
      required: ["connectionId", "database", "collection", "filter"],
    },
    execute: (args) =>
      api.remove(
        requiredStr(args, "connectionId"),
        requiredStr(args, "database"),
        requiredStr(args, "collection"),
        { filter: obj(args, "filter") ?? {}, many: bool(args, "many") },
      ),
  },
  {
    name: "mongoui_create_index",
    description: "Create an index from a key spec, e.g. {\"email\":1} with optional options (unique, sparse, name, expireAfterSeconds).",
    inputSchema: {
      type: "object",
      properties: {
        ...collectionTarget,
        keys: { type: "object", description: "Index key spec" },
        options: { type: "object", description: "Index options" },
      },
      required: ["connectionId", "database", "collection", "keys"],
    },
    execute: (args) =>
      api.createIndex(
        requiredStr(args, "connectionId"),
        requiredStr(args, "database"),
        requiredStr(args, "collection"),
        obj(args, "keys") ?? {},
        obj(args, "options") ?? {},
      ),
  },
  {
    name: "mongoui_drop_index",
    description: "Drop an index by name.",
    inputSchema: {
      type: "object",
      properties: { ...collectionTarget, name: { type: "string" } },
      required: ["connectionId", "database", "collection", "name"],
    },
    execute: (args) =>
      api.dropIndex(
        requiredStr(args, "connectionId"),
        requiredStr(args, "database"),
        requiredStr(args, "collection"),
        requiredStr(args, "name"),
      ),
  },
]

/** Runs a tool by name. Used by the WebMCP bridge and the window fallback. */
export async function callAgentTool(
  name: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const tool = agentTools.find((t) => t.name === name)
  if (!tool) throw new Error(`unknown tool: ${name}`)
  return await tool.execute(args)
}
