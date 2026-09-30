import * as React from "react"

export type Locale = "en" | "zh"

const STORAGE_KEY = "mongoui-lang"

export const LOCALES: { value: Locale; label: string }[] = [
  { value: "en", label: "English" },
  { value: "zh", label: "中文" },
]

const en: Record<string, string> = {
  // common
  "common.save": "Save",
  "common.cancel": "Cancel",
  "common.confirm": "Confirm",
  "common.create": "Create",
  "common.delete": "Delete",
  "common.edit": "Edit",
  "common.close": "Close",
  "common.refresh": "Refresh",
  "common.run": "Run",
  "common.format": "Format",
  "common.copy": "Copy",
  "common.copyJson": "Copy JSON",
  "common.copied": "Copied",
  "common.copyFailed": "Copy failed — select the text and copy manually",
  "common.loading": "Loading…",
  "common.actions": "Actions",
  "common.optional": "optional",
  "common.name": "Name",
  "common.description": "Description",

  // app / header
  "app.tagline":
    "A lightweight MongoDB administration console. Connect to a deployment, browse databases and collections, query documents, run aggregation pipelines and manage indexes — all in one place.",
  "app.feature.browse": "Browse",
  "app.feature.browseText": "Databases, collections and live stats.",
  "app.feature.query": "Query",
  "app.feature.queryText": "Filters, projections, sorting, SQL and aggregation.",
  "app.feature.admin": "Admin",
  "app.feature.adminText": "Indexes, schema analysis and server info.",
  "app.recent": "Recent connections",
  "app.newConnection": "New connection",
  "app.connecting": "Connecting to {{name}}…",
  "app.connectNow": "Connect now",
  "app.loadingConnection": "Loading connection…",
  "app.browserAgent": "Browser agent access",

  // language / theme
  "lang.label": "Language",
  "theme.light": "Light",
  "theme.dark": "Dark",
  "theme.system": "System",
  "theme.title": "Switch light / dark theme",
  "theme.aria": "Theme: {{label}}. Switch light, dark or system theme.",

  // agent toggle
  "agent.button": "Agent",
  "agent.title": "Browser agent access",
  "agent.allow": "Allow browser agent",
  "agent.hint":
    "When on, an in-browser agent (WebMCP / extension / console) can read and modify your data through",
  "agent.webmcp": "WebMCP:",
  "agent.webmcpYes": "available — tools are registered automatically.",
  "agent.webmcpNo": "not available in this browser; the window fallback still works.",
  "agent.tools": "{{count}} tools",
  "agent.toolsHint": "exposed while enabled:",
  "agent.serverMcp": "Server MCP",
  "agent.serverMcpHint":
    "External agents (Claude Desktop, Cursor, ...) can drive mongoUI over the Model Context Protocol:",
  "agent.serverMcpReadonly":
    "Start the server with -mcp-readonly to expose read tools only; the local agent can also use mongoui mcp over stdio.",

  // sidebar
  "sidebar.filter": "Filter connections, databases, collections…",
  "sidebar.filterAria": "Filter connections, databases and collections",
  "sidebar.clearFilter": "Clear filter",
  "sidebar.nothingMatches": "Nothing matches “{{query}}”.",
  "sidebar.loadingConnections": "Loading connections…",
  "sidebar.noConnections": "No connections yet",
  "sidebar.emptyHint": "Add a MongoDB connection to get started.",
  "sidebar.connections": "{{count}} connection",
  "sidebar.connections_plural": "{{count}} connections",
  "sidebar.loadingDatabases": "Loading databases…",
  "sidebar.noDatabases": "No databases",
  "sidebar.noCollections": "No collections",
  "sidebar.toggleConnection": "Toggle connection {{name}}",
  "sidebar.toggleDatabase": "Toggle database {{name}}",
  "sidebar.pin": "Pin to top",
  "sidebar.unpin": "Unpin",
  "sidebar.pinned": "Pinned",
  "sidebar.toggle": "Toggle sidebar",
  "sidebar.resize": "Drag to resize (double-click to reset)",
  "recent.title": "Recent queries",
  "recent.clear": "Clear history",
  "sidebar.connect": "Connect",
  "sidebar.disconnect": "Disconnect",
  "sidebar.createDatabase": "Create database",
  "sidebar.createCollection": "Create collection",
  "sidebar.dropDatabase": "Drop database",
  "sidebar.dropCollection": "Drop collection",
  "sidebar.editConnection": "Edit connection",
  "sidebar.deleteConnection": "Delete connection",
  "sidebar.connected": "Connected to {{name}}",
  "sidebar.disconnected": "Disconnected from {{name}}",
  "sidebar.connectFailed": "Failed to connect",
  "sidebar.disconnectFailed": "Failed to disconnect",
  "sidebar.listDatabasesFailed": "Failed to list databases",
  "sidebar.listCollectionsFailed": "Failed to list collections",
  "sidebar.confirmDropDatabase": "Drop database \"{{name}}\"?",
  "sidebar.confirmDropDatabaseDesc": "This permanently deletes the database and every collection inside it.",
  "sidebar.confirmDropCollection": "Drop collection \"{{name}}\"?",
  "sidebar.confirmDropCollectionDesc": "This permanently deletes the collection and all of its documents.",
  "sidebar.confirmDeleteConnection": "Delete connection \"{{name}}\"?",
  "sidebar.confirmDeleteConnectionDesc": "Only the saved profile is removed; the database itself is untouched.",

  // collection view
  "collection.copyPath": "Copy path",
  "collection.pathCopied": "Collection path copied",
  "collection.tab.documents": "Documents",
  "collection.tab.sql": "SQL",
  "collection.tab.aggregation": "Aggregation",
  "collection.tab.indexes": "Indexes",
  "collection.tab.schema": "Schema",
  "collection.tab.stats": "Stats",

  // connection dialog
  "connection.new": "New connection",
  "connection.edit": "Edit connection",
  "connection.desc": "Store a MongoDB connection string. Credentials are kept locally on the server.",
  "connection.namePlaceholder": "Local development",
  "connection.uri": "Connection string",
  "connection.color": "Color",
  "connection.readOnly": "Read-only mode",
  "connection.readOnlyHint": "Disable all write operations for this connection.",
  "connection.ssh": "SSH tunnel",
  "connection.sshHint": "Reach MongoDB through a bastion / jump host.",
  "connection.sshHost": "SSH host",
  "connection.sshPort": "Port",
  "connection.sshUser": "SSH user",
  "connection.sshAuth": "Authentication",
  "connection.authPassword": "Password",
  "connection.authPrivateKey": "Private key",
  "connection.sshPassword": "SSH password",
  "connection.sshPrivateKey": "Private key (PEM / OpenSSH)",
  "connection.sshPassphrase": "Key passphrase (optional)",
  "connection.sshKnownHosts": "known_hosts file (optional)",
  "connection.sshKnownHostsHint":
    "When empty the host key is not verified (traffic is still encrypted). Set a known_hosts path on the server to enable strict checking.",
  "connection.test": "Test connection",
  "connection.saveChanges": "Save changes",
  "connection.created": "Connection created",
  "connection.updated": "Connection updated",
  "connection.nameUriRequired": "Name and connection string are required",
  "connection.enterUri": "Please enter a connection string first",
  "connection.testOk": "Connection successful",
  "connection.testFailed": "Connection failed",
  "connection.saveFailed": "Failed to save connection",
  "connection.sshHostRequired": "SSH host is required",
  "connection.sshUserRequired": "SSH user is required",
  "connection.sshPasswordRequired": "SSH password is required",
  "connection.sshKeyRequired": "SSH private key is required",

  // documents tab
  "docs.filter": "Filter",
  "docs.sort": "Sort",
  "docs.projection": "Projection",
  "docs.find": "Find",
  "docs.insert": "Insert",
  "docs.refresh": "Refresh",
  "docs.deleteSelected": "Delete selected",
  "docs.noDocuments": "No documents match this query.",
  "docs.rows": "{{count}} document",
  "docs.rows_plural": "{{count}} documents",
  "docs.page": "Page {{page}} / {{pages}}",
  "docs.prev": "Previous page",
  "docs.next": "Next page",
  "docs.insertTitle": "Insert document",
  "docs.editTitle": "Edit document",
  "docs.insertAction": "Insert",
  "docs.saveChanges": "Save changes",
  "docs.editDocument": "Edit document",
  "docs.copyJson": "Copy JSON",
  "docs.deleteDocument": "Delete document",
  "docs.selectAll": "Select all",
  "docs.selectRow": "Select row",
  "docs.limit": "Limit",
  "docs.skip": "Skip",
  "docs.filterPlaceholder": "Filter, e.g. { \"age\": { \"$gt\": 18 } }",
  "docs.sortProjection": "Sort & projection",
  "docs.readonlyTip": "Connection is read-only",
  "docs.selected": "{{count}} selected",
  "docs.clear": "Clear",
  "docs.deleteMatching": "Delete matching filter…",
  "docs.invalidJson": "Invalid JSON in query",
  "docs.queryFailed": "Query failed",
  "docs.insertedOne": "Inserted {{count}} document",
  "docs.insertedMany": "Inserted {{count}} documents",
  "docs.noId": "Cannot update a document without an _id",
  "docs.updated": "Document updated",
  "docs.deleted": "Document deleted",
  "docs.deletedMany": "Deleted {{count}} documents",
  "docs.copyOk": "Copied JSON to clipboard",
  "docs.editDesc": "Save replaces the whole document. Keep the _id field intact.",
  "docs.insertDesc": "Provide one document, or an array of documents for a bulk insert.",
  "docs.deleteFilter": "Delete all documents matching the filter?",
  "docs.deleteSelectedMany": "Delete {{count}} selected documents?",
  "docs.deleteOne": "Delete this document?",
  "docs.deleteDesc": "This action cannot be undone.",
  "docs.sortBy": "Sort by {{column}}",
  "docs.sortedAsc": "Sorted ascending — click to change",
  "docs.sortedDesc": "Sorted descending — click to change",

  // sql tab
  "sql.template.all": "All",
  "sql.template.count": "Count",
  "sql.template.distinct": "Distinct",
  "sql.template.group": "Group & count",
  "sql.template.filter": "Filter",
  "sql.limit": "Limit",
  "sql.run": "Run",
  "sql.generated": "Generated MongoDB query",
  "sql.notRun": "Not run yet",
  "sql.rows": "{{count}} row",
  "sql.rows_plural": "{{count}} rows",
  "sql.ofMatching": " of {{total}} matching",
  "sql.empty": "No rows returned.",
  "sql.placeholder": "Write a SQL query and press Run.",
  "sql.writeFirst": "Write a SQL query first",
  "sql.failed": "SQL query failed",
  "sql.help":
    "SELECT with WHERE / IN / LIKE / IS NULL, ORDER BY, LIMIT, GROUP BY, HAVING, DISTINCT and COUNT / SUM / AVG / MIN / MAX. Autocomplete covers keywords and collection / field names. Press Ctrl/⌘ + Enter to run.",

  // aggregation tab
  "agg.pipeline": "Pipeline",
  "agg.postLimit": "Post-limit",
  "agg.notRun": "Not run yet",
  "agg.empty": "No results.",
  "agg.placeholder": "Write a pipeline and press Run.",
  "agg.failed": "Aggregation failed",
  "agg.notJson": "Pipeline is not valid JSON",
  "agg.mustBeArray": "Pipeline must be an array of stages",
  "agg.example.limit": "Limit 10",
  "agg.example.sort": "Sort newest",
  "agg.example.group": "Group & count",
  "agg.example.sample": "Field stats",

  // shared result view
  "result.table": "Table",
  "result.json": "JSON",

  // connection overview
  "overview.connected": "Connected",
  "overview.disconnected": "Not connected",
  "overview.serverInfo": "Server information",
  "overview.databases": "Databases",
  "overview.totalSize": "Total size",
  "overview.name": "Name",
  "overview.loadDbFailed": "Failed to load databases",

  "auth.setupTitle": "Enable two-factor authentication",
  "auth.setupIntro":
    "Scan the QR code with an authenticator app (Google Authenticator, 1Password, ...), then enter the 6-digit code to finish setup.",
  "auth.secretLabel": "Or enter this secret manually",
  "auth.saveSecret": "Save this secret somewhere safe — it is required to sign in.",
  "auth.codeLabel": "6-digit code",
  "auth.confirm": "Enable",
  "auth.loginTitle": "Sign in",
  "auth.loginIntro": "Enter the 6-digit code from your authenticator app.",
  "auth.login": "Sign in",
  "auth.invalidCode": "Invalid code, please try again",
  "auth.setupFailed": "Could not start setup",
  "auth.signOut": "Sign out",

  "resource.createDatabase": "Create database",
  "resource.databaseName": "Database name",
  "resource.initialCollection": "Initial collection",
  "resource.createCollection": "Create collection",
  "resource.collectionName": "Collection name",
  "resource.capped": "Capped collection",
  "resource.maxDocuments": "Max documents",
  "resource.dbNameRequired": "Database name is required",
  "resource.dbCreated": "Database \"{{name}}\" created",
  "resource.createDbFailed": "Failed to create database",
  "resource.colNameRequired": "Collection name is required",
  "resource.colCreated": "Collection \"{{name}}\" created",
  "resource.createColFailed": "Failed to create collection",

  "indexes.loadFailed": "Failed to load indexes",
  "indexes.invalidJson": "Invalid JSON",
  "indexes.created": "Index created",
  "indexes.createFailed": "Failed to create index",
  "indexes.name": "Name",
  "indexes.keys": "Keys",
  "indexes.properties": "Properties",
  "indexes.cannotDrop": "The default index cannot be dropped",
  "indexes.drop": "Drop index",
  "indexes.createTitle": "Create index",
  "indexes.options": "Options",
  "indexes.dropTitle": "Drop index \"{{name}}\"?",
  "indexes.dropLabel": "Drop index",
  "indexes.dropped": "Index dropped",

  "schema.field": "Field",
  "schema.types": "Types",
  "schema.failed": "Failed to analyse schema",

  "stats.documents": "Documents",
  "stats.logicalSize": "Logical size",
  "stats.storageSize": "Storage size",
  "stats.indexes": "Indexes",
  "stats.capped": "Capped",
  "stats.failed": "Failed to load statistics",
}

const zh: Record<string, string> = {
  // common
  "common.save": "保存",
  "common.cancel": "取消",
  "common.confirm": "确认",
  "common.create": "创建",
  "common.delete": "删除",
  "common.edit": "编辑",
  "common.close": "关闭",
  "common.refresh": "刷新",
  "common.run": "运行",
  "common.format": "格式化",
  "common.copy": "复制",
  "common.copyJson": "复制 JSON",
  "common.copied": "已复制",
  "common.copyFailed": "复制失败，请手动选择文本复制",
  "common.loading": "加载中…",
  "common.actions": "操作",
  "common.optional": "可选",
  "common.name": "名称",
  "common.description": "描述",

  // app / header
  "app.tagline":
    "一个轻量的 MongoDB 可视化管理工具。连接部署、浏览数据库与集合、查询文档、运行聚合管道、管理索引，全部在一个界面完成。",
  "app.feature.browse": "浏览",
  "app.feature.browseText": "数据库、集合与实时统计。",
  "app.feature.query": "查询",
  "app.feature.queryText": "过滤、投影、排序、SQL 与聚合。",
  "app.feature.admin": "管理",
  "app.feature.adminText": "索引、Schema 分析与服务器信息。",
  "app.recent": "最近的连接",
  "app.newConnection": "新建连接",
  "app.connecting": "正在连接 {{name}}…",
  "app.connectNow": "立即连接",
  "app.loadingConnection": "正在加载连接…",
  "app.browserAgent": "浏览器 Agent 授权",

  // language / theme
  "lang.label": "语言",
  "theme.light": "明亮",
  "theme.dark": "暗黑",
  "theme.system": "跟随系统",
  "theme.title": "切换明亮 / 暗黑主题",
  "theme.aria": "主题：{{label}}。可切换明亮、暗黑或跟随系统。",

  // agent toggle
  "agent.button": "Agent",
  "agent.title": "浏览器 Agent 授权",
  "agent.allow": "允许浏览器 Agent 操作",
  "agent.hint":
    "开启后，浏览器内的 agent（WebMCP / 扩展 / 控制台）可以通过",
  "agent.webmcp": "WebMCP：",
  "agent.webmcpYes": "可用 —— 会自动注册工具。",
  "agent.webmcpNo": "当前浏览器不支持；window 兜底通道仍可用。",
  "agent.tools": "{{count}} 个工具",
  "agent.toolsHint": "开启后暴露：",
  "agent.serverMcp": "服务端 MCP",
  "agent.serverMcpHint":
    "外部 agent（Claude Desktop、Cursor 等）可以通过 Model Context Protocol 操作 mongoUI：",
  "agent.serverMcpReadonly":
    "用 -mcp-readonly 启动可只暴露只读工具；本地 agent 也可用 stdio 方式 `mongoui mcp`。",

  // sidebar
  "sidebar.filter": "过滤连接、数据库、集合…",
  "sidebar.filterAria": "过滤连接、数据库与集合",
  "sidebar.clearFilter": "清除过滤",
  "sidebar.nothingMatches": "没有匹配“{{query}}”的内容。",
  "sidebar.loadingConnections": "正在加载连接…",
  "sidebar.noConnections": "还没有连接",
  "sidebar.emptyHint": "添加一个 MongoDB 连接开始使用。",
  "sidebar.connections": "{{count}} 个连接",
  "sidebar.connections_plural": "{{count}} 个连接",
  "sidebar.loadingDatabases": "正在加载数据库…",
  "sidebar.noDatabases": "没有数据库",
  "sidebar.noCollections": "没有集合",
  "sidebar.toggleConnection": "展开/收起连接 {{name}}",
  "sidebar.toggleDatabase": "展开/收起数据库 {{name}}",
  "sidebar.pin": "置顶",
  "sidebar.unpin": "取消置顶",
  "sidebar.pinned": "已置顶",
  "sidebar.toggle": "折叠 / 展开侧边栏",
  "sidebar.resize": "拖动调整宽度（双击复位）",
  "recent.title": "最近查询",
  "recent.clear": "清空历史",
  "sidebar.connect": "连接",
  "sidebar.disconnect": "断开",
  "sidebar.createDatabase": "创建数据库",
  "sidebar.createCollection": "创建集合",
  "sidebar.dropDatabase": "删除数据库",
  "sidebar.dropCollection": "删除集合",
  "sidebar.editConnection": "编辑连接",
  "sidebar.deleteConnection": "删除连接",
  "sidebar.connected": "已连接到 {{name}}",
  "sidebar.disconnected": "已断开 {{name}}",
  "sidebar.connectFailed": "连接失败",
  "sidebar.disconnectFailed": "断开失败",
  "sidebar.listDatabasesFailed": "获取数据库列表失败",
  "sidebar.listCollectionsFailed": "获取集合列表失败",
  "sidebar.confirmDropDatabase": "删除数据库 “{{name}}”？",
  "sidebar.confirmDropDatabaseDesc": "将永久删除该数据库及其中的所有集合。",
  "sidebar.confirmDropCollection": "删除集合 “{{name}}”？",
  "sidebar.confirmDropCollectionDesc": "将永久删除该集合及其中的所有文档。",
  "sidebar.confirmDeleteConnection": "删除连接 “{{name}}”？",
  "sidebar.confirmDeleteConnectionDesc": "仅删除已保存的连接配置，数据库本身不受影响。",

  // collection view
  "collection.copyPath": "复制路径",
  "collection.pathCopied": "已复制集合路径",
  "collection.tab.documents": "文档",
  "collection.tab.sql": "SQL",
  "collection.tab.aggregation": "聚合",
  "collection.tab.indexes": "索引",
  "collection.tab.schema": "Schema",
  "collection.tab.stats": "统计",

  // connection dialog
  "connection.new": "新建连接",
  "connection.edit": "编辑连接",
  "connection.desc": "保存 MongoDB 连接串。凭证仅保存在本机服务端。",
  "connection.namePlaceholder": "本地开发",
  "connection.uri": "连接串",
  "connection.color": "颜色",
  "connection.readOnly": "只读模式",
  "connection.readOnlyHint": "禁用该连接的所有写操作。",
  "connection.ssh": "SSH 隧道",
  "connection.sshHint": "通过跳板机 / 堡垒机访问 MongoDB。",
  "connection.sshHost": "SSH 主机",
  "connection.sshPort": "端口",
  "connection.sshUser": "SSH 用户",
  "connection.sshAuth": "认证方式",
  "connection.authPassword": "密码",
  "connection.authPrivateKey": "私钥",
  "connection.sshPassword": "SSH 密码",
  "connection.sshPrivateKey": "私钥（PEM / OpenSSH）",
  "connection.sshPassphrase": "私钥口令（可选）",
  "connection.sshKnownHosts": "known_hosts 文件（可选）",
  "connection.sshKnownHostsHint":
    "留空则不校验主机密钥（流量仍加密）；填写服务器上的 known_hosts 路径可启用严格校验。",
  "connection.test": "测试连接",
  "connection.saveChanges": "保存修改",
  "connection.created": "连接已创建",
  "connection.updated": "连接已更新",
  "connection.nameUriRequired": "名称和连接串不能为空",
  "connection.enterUri": "请先填写连接串",
  "connection.testOk": "连接成功",
  "connection.testFailed": "连接失败",
  "connection.saveFailed": "保存连接失败",
  "connection.sshHostRequired": "SSH 主机不能为空",
  "connection.sshUserRequired": "SSH 用户不能为空",
  "connection.sshPasswordRequired": "SSH 密码不能为空",
  "connection.sshKeyRequired": "SSH 私钥不能为空",

  // documents tab
  "docs.filter": "过滤",
  "docs.sort": "排序",
  "docs.projection": "投影",
  "docs.find": "查询",
  "docs.insert": "插入",
  "docs.refresh": "刷新",
  "docs.deleteSelected": "删除所选",
  "docs.noDocuments": "没有匹配的文档。",
  "docs.rows": "{{count}} 条文档",
  "docs.rows_plural": "{{count}} 条文档",
  "docs.page": "第 {{page}} / {{pages}} 页",
  "docs.prev": "上一页",
  "docs.next": "下一页",
  "docs.insertTitle": "插入文档",
  "docs.editTitle": "编辑文档",
  "docs.insertAction": "插入",
  "docs.saveChanges": "保存修改",
  "docs.editDocument": "编辑文档",
  "docs.copyJson": "复制 JSON",
  "docs.deleteDocument": "删除文档",
  "docs.selectAll": "全选",
  "docs.selectRow": "选择该行",
  "docs.limit": "每页",
  "docs.skip": "跳过",
  "docs.filterPlaceholder": "过滤，例如 { \"age\": { \"$gt\": 18 } }",
  "docs.sortProjection": "排序与投影",
  "docs.readonlyTip": "连接为只读",
  "docs.selected": "已选 {{count}} 条",
  "docs.clear": "清除",
  "docs.deleteMatching": "删除匹配过滤条件的文档…",
  "docs.invalidJson": "查询中的 JSON 不合法",
  "docs.queryFailed": "查询失败",
  "docs.insertedOne": "已插入 {{count}} 条文档",
  "docs.insertedMany": "已插入 {{count}} 条文档",
  "docs.noId": "缺少 _id，无法更新文档",
  "docs.updated": "文档已更新",
  "docs.deleted": "文档已删除",
  "docs.deletedMany": "已删除 {{count}} 条文档",
  "docs.copyOk": "已复制 JSON 到剪贴板",
  "docs.editDesc": "保存会替换整个文档，请保留 _id 字段。",
  "docs.insertDesc": "填写一个文档，或数组表示批量插入。",
  "docs.deleteFilter": "删除所有匹配该过滤条件的文档？",
  "docs.deleteSelectedMany": "删除所选 {{count}} 条文档？",
  "docs.deleteOne": "删除该文档？",
  "docs.deleteDesc": "此操作不可撤销。",
  "docs.sortBy": "按 {{column}} 排序",
  "docs.sortedAsc": "已升序 —— 点击切换",
  "docs.sortedDesc": "已降序 —— 点击切换",

  // sql tab
  "sql.template.all": "全部",
  "sql.template.count": "计数",
  "sql.template.distinct": "去重",
  "sql.template.group": "分组计数",
  "sql.template.filter": "过滤",
  "sql.limit": "限制",
  "sql.run": "运行",
  "sql.generated": "生成的 MongoDB 查询",
  "sql.notRun": "尚未运行",
  "sql.rows": "{{count}} 行",
  "sql.rows_plural": "{{count}} 行",
  "sql.ofMatching": "（共 {{total}} 条匹配）",
  "sql.empty": "没有返回结果。",
  "sql.placeholder": "编写 SQL 查询并点击运行。",
  "sql.writeFirst": "请先编写 SQL 查询",
  "sql.failed": "SQL 查询失败",
  "sql.help":
    "支持 SELECT + WHERE / IN / LIKE / IS NULL、ORDER BY、LIMIT、GROUP BY、HAVING、DISTINCT 以及 COUNT / SUM / AVG / MIN / MAX。自动补全覆盖关键字与集合 / 字段名。按 Ctrl/⌘ + Enter 运行。",

  // aggregation tab
  "agg.pipeline": "管道",
  "agg.postLimit": "结果限制",
  "agg.notRun": "尚未运行",
  "agg.empty": "没有结果。",
  "agg.placeholder": "编写管道并点击运行。",
  "agg.failed": "聚合失败",
  "agg.notJson": "管道不是合法的 JSON",
  "agg.mustBeArray": "管道必须是阶段数组",
  "agg.example.limit": "限制 10 条",
  "agg.example.sort": "按最新排序",
  "agg.example.group": "分组计数",
  "agg.example.sample": "字段抽样",

  // shared result view
  "result.table": "表格",
  "result.json": "JSON",

  // connection overview
  "overview.connected": "已连接",
  "overview.disconnected": "未连接",
  "overview.serverInfo": "服务器信息",
  "overview.databases": "数据库",
  "overview.totalSize": "总大小",
  "overview.name": "名称",
  "overview.loadDbFailed": "获取数据库列表失败",

  "auth.setupTitle": "开启两步验证（TOTP）",
  "auth.setupIntro":
    "用验证器 App（Google Authenticator、1Password 等）扫描二维码，然后输入 6 位验证码完成设置。",
  "auth.secretLabel": "或手动输入以下密钥",
  "auth.saveSecret": "请妥善保存该密钥，登录时需要用到。",
  "auth.codeLabel": "6 位验证码",
  "auth.confirm": "启用",
  "auth.loginTitle": "登录",
  "auth.loginIntro": "请输入验证器 App 中的 6 位验证码。",
  "auth.login": "登录",
  "auth.invalidCode": "验证码不正确，请重试",
  "auth.setupFailed": "无法开始设置",
  "auth.signOut": "退出登录",

  "resource.createDatabase": "创建数据库",
  "resource.databaseName": "数据库名",
  "resource.initialCollection": "初始集合",
  "resource.createCollection": "创建集合",
  "resource.collectionName": "集合名",
  "resource.capped": "固定大小集合（capped）",
  "resource.maxDocuments": "最大文档数",
  "resource.dbNameRequired": "数据库名不能为空",
  "resource.dbCreated": "数据库 “{{name}}” 已创建",
  "resource.createDbFailed": "创建数据库失败",
  "resource.colNameRequired": "集合名不能为空",
  "resource.colCreated": "集合 “{{name}}” 已创建",
  "resource.createColFailed": "创建集合失败",

  "indexes.loadFailed": "加载索引失败",
  "indexes.invalidJson": "JSON 不合法",
  "indexes.created": "索引已创建",
  "indexes.createFailed": "创建索引失败",
  "indexes.name": "名称",
  "indexes.keys": "键",
  "indexes.properties": "属性",
  "indexes.cannotDrop": "默认索引不能删除",
  "indexes.drop": "删除索引",
  "indexes.createTitle": "创建索引",
  "indexes.options": "选项",
  "indexes.dropTitle": "删除索引 “{{name}}”？",
  "indexes.dropLabel": "删除索引",
  "indexes.dropped": "索引已删除",

  "schema.field": "字段",
  "schema.types": "类型",
  "schema.failed": "Schema 分析失败",

  "stats.documents": "文档数",
  "stats.logicalSize": "逻辑大小",
  "stats.storageSize": "存储大小",
  "stats.indexes": "索引",
  "stats.capped": "固定大小",
  "stats.failed": "加载统计失败",
}

const dictionaries: Record<Locale, Record<string, string>> = { en, zh }

function detect(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === "en" || stored === "zh") return stored
  } catch {
    /* storage may be unavailable */
  }
  if (typeof navigator !== "undefined" && /^zh/i.test(navigator.language)) return "zh"
  return "en"
}

interface I18nValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: string, vars?: Record<string, string | number>) => string
}

const I18nContext = React.createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = React.useState<Locale>(detect)

  const setLocale = React.useCallback((next: Locale) => {
    setLocaleState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* storage may be unavailable */
    }
  }, [])

  React.useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en"
  }, [locale])

  const t = React.useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const dict = dictionaries[locale] ?? en
      let text = dict[key] ?? en[key] ?? key
      if (vars) {
        for (const [name, value] of Object.entries(vars)) {
          text = text.replace(new RegExp(`\\{\\{${name}\\}\\}`, "g"), String(value))
        }
      }
      return text
    },
    [locale],
  )

  const value = React.useMemo<I18nValue>(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const ctx = React.useContext(I18nContext)
  if (!ctx) throw new Error("useI18n must be used within I18nProvider")
  return ctx
}
