# MCP 使用指南 / MCP Guide

mongoUI 内置 **Model Context Protocol** server，AI Agent 可以通过 MCP 直接操作 MongoDB（浏览库/集合、查询、聚合、SQL、增删改、索引管理），而无需自行连接数据库。

- [1. 快速接入](#1-快速接入)
- [2. 只读模式](#2-只读模式)
- [3. 工具参考](#3-工具参考)
- [4. 示例](#4-示例)
- [5. 原始 JSON-RPC / curl](#5-原始-json-rpc--curl)
- [6. 排错](#6-排错)

---

## 1. 快速接入

MCP server 有两种传输方式，按需选择其一。

### 1.1 stdio（本地子进程）

适合 Claude Desktop / Cursor / Cline 等本地客户端。

```jsonc
// claude_desktop_config.json —— 或直接复制 examples/mcp.stdio.json
{
  "mcpServers": {
    "mongoui": {
      "command": "mongoui",
      "args": ["mcp"],
      "env": { "MONGOUI_DATA": "/home/me/.mongoui" }
    }
  }
}
```

- `mongoui mcp` 使用与网页端相同的 `-data` 目录（`connections.json`），因此连接配置与网页端一致。
- `MONGOUI_DATA` 不填时默认 `data`（相对当前目录）。

### 1.2 HTTP（Streamable HTTP，连接正在运行的 server）

适合远程 / 容器化 agent，无需本地安装二进制。

```bash
mongoui                 # 启动服务，默认 0.0.0.0:8080
# MCP 端点：http://<host>:8080/mcp
```

```jsonc
// 支持 HTTP transport 的客户端 —— 或直接复制 examples/mcp.http.json
{
  "mcpServers": {
    "mongoui": {
      "type": "http",
      "url": "http://localhost:8080/mcp"
    }
  }
}
```

若服务端设置了 `MONGOUI_MCP_TOKEN`（或 `-mcp-token`），需带令牌：

```jsonc
{
  "mcpServers": {
    "mongoui": {
      "type": "http",
      "url": "http://localhost:8080/mcp",
      "headers": { "Authorization": "Bearer my-secret" }
    }
  }
}
```

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/mcp` | JSON-RPC 请求。`Accept: application/json` 返回 JSON；`Accept: text/event-stream` 返回 SSE |
| `DELETE` | `/mcp` | 结束会话，返回 200 |
| `GET` | `/mcp` | 不支持（无服务端推送流），返回 405 |

响应头会返回 `Mcp-Session-Id`，客户端可回传以复用会话。

---

## 2. 只读模式

MCP 可以整体以**只读**运行，此时写工具不会出现在 `tools/list` 中，直接调用也会被拒绝：

```bash
mongoui -mcp-readonly                 # HTTP
mongoui mcp -read-only                # stdio
MONGOUI_MCP_READONLY=1 mongoui        # 环境变量
```

此外，连接配置里的 **只读模式** 也会生效：标记为只读的连接即使用写工具也会返回错误。两层保护可以独立使用：

- 只想让 agent 查询：整个 MCP 用 `-mcp-readonly`。
- 只限制某个连接：给该连接打开只读。

只读模式下 `mongoui_aggregate` 仍会拒绝 `$out` / `$merge` 这类写管道。

---

## 3. 工具参考

共 20 个工具（只读模式下暴露 12 个）。

### 只读工具

| 工具 | 参数 | 说明 |
| --- | --- | --- |
| `mongoui_list_connections` | – | 列出连接（id/name/connected/readOnly） |
| `mongoui_connect` | `connectionId` | 建立连接（之后才能读写数据） |
| `mongoui_disconnect` | `connectionId` | 断开连接 |
| `mongoui_server_info` | `connectionId` | `buildInfo` |
| `mongoui_list_databases` | `connectionId` | 库列表 + 大小 |
| `mongoui_list_collections` | `connectionId`, `database` | 集合列表 |
| `mongoui_collection_stats` | `connectionId`, `database`, `collection` | `collStats` |
| `mongoui_collection_schema` | `connectionId`, `database`, `collection` | 抽样字段/类型统计 |
| `mongoui_find` | `connectionId`, `database`, `collection`, `filter?`, `sort?`, `projection?`, `skip?`, `limit?` | 查询文档（Extended JSON） |
| `mongoui_aggregate` | `connectionId`, `database`, `collection`, `pipeline`, `limit?` | 聚合管道 |
| `mongoui_sql` | `connectionId`, `database`, `query`, `limit?` | SQL 查询（SELECT） |
| `mongoui_list_indexes` | `connectionId`, `database`, `collection` | 索引列表 |

### 写工具（只读模式下隐藏）

| 工具 | 参数 |
| --- | --- |
| `mongoui_insert` | `connectionId`, `database`, `collection`, `documents: object[]` |
| `mongoui_update` | `connectionId`, `database`, `collection`, `filter`, `update`, `many?`, `upsert?` |
| `mongoui_delete` | `connectionId`, `database`, `collection`, `filter`, `many?` |
| `mongoui_create_collection` | `connectionId`, `database`, `collection`, `capped?`, `size?`, `max?` |
| `mongoui_drop_collection` | `connectionId`, `database`, `collection` |
| `mongoui_drop_database` | `connectionId`, `database` |
| `mongoui_create_index` | `connectionId`, `database`, `collection`, `keys`, `options?` |
| `mongoui_drop_index` | `connectionId`, `database`, `collection`, `name` |

`filter` / `sort` / `projection` / `documents` / `pipeline` / `keys` / `options` 均为 **MongoDB Extended JSON**（relaxed），例如 `{"_id":{"$oid":"..."}}`、`{"createdAt":{"$date":"2024-01-01T00:00:00Z"}}`。

---

## 4. 示例

**用户提示词**

> 用 mongoui 看一下 mongoui_demo 库里 orders 集合各状态的订单数和总金额，按金额从高到低排序。

**Agent 调用序列**

```jsonc
// 1. 找到连接
mongoui_list_connections {}
// → [{ "id": "local-1", "name": "local", "connected": false }, ...]

// 2. 连接
mongoui_connect { "connectionId": "local-1" }

// 3. 聚合统计
mongoui_aggregate {
  "connectionId": "local-1",
  "database": "mongoui_demo",
  "collection": "orders",
  "pipeline": [
    { "$group": { "_id": "$status", "count": { "$sum": 1 }, "revenue": { "$sum": "$total" } } },
    { "$sort": { "revenue": -1 } }
  ]
}

// 也可以用 SQL
mongoui_sql {
  "connectionId": "local-1",
  "database": "mongoui_demo",
  "query": "SELECT status, COUNT(*) AS n, SUM(total) AS revenue FROM orders GROUP BY status ORDER BY revenue DESC"
}
```

**写操作（非只读）**

```jsonc
mongoui_insert {
  "connectionId": "local-1", "database": "demo", "collection": "users",
  "documents": [{ "name": "Alice", "age": 30 }, { "name": "Bob", "age": 25 }]
}

mongoui_update {
  "connectionId": "local-1", "database": "demo", "collection": "users",
  "filter": { "name": "Alice" }, "update": { "$set": { "age": 31 } }, "many": false
}

mongoui_delete {
  "connectionId": "local-1", "database": "demo", "collection": "users",
  "filter": { "age": { "$lt": 26 } }, "many": true
}
```

---

## 5. 原始 JSON-RPC / curl

### stdio

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize"}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | mongoui mcp
```

### HTTP

```bash
curl -s http://localhost:8080/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize"}'

curl -s http://localhost:8080/mcp \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc":"2.0","id":3,"method":"tools/call",
    "params":{
      "name":"mongoui_list_connections",
      "arguments":{}
    }
  }'
```

---

## 6. 排错

| 现象 | 原因 / 处理 |
| --- | --- |
| `command not found: mongoui` | 未安装或不在 `PATH` |
| HTTP `401 unauthorized` | 服务端开启了 `MONGOUI_MCP_TOKEN`，需带 `Authorization: Bearer <token>` |
| HTTP `405` | `GET /mcp` 不支持；请用 `POST` |
| `connection is not active` | 先调用 `mongoui_connect` |
| `unknown connection "..."` | 连接 id 不对，先 `mongoui_list_connections` |
| 写工具不存在 | 服务端运行在只读模式（`-mcp-readonly` / `MONGOUI_MCP_READONLY=1`） |
| `connection ... is marked read-only` | 该连接配置了只读模式，请在网页端关闭或换一个连接 |
| 网页看不到 agent 的改动 | 两者使用同一个 `-data` 目录 / 同一个运行中的 server；刷新网页 |
