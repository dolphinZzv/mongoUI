# MongoUI

一个轻量的 MongoDB 可视化管理工具（类似 Navicat / MongoDB Compass 的简化版）。

- **后端**：Go + [chi](https://github.com/go-chi/chi) + 官方 [mongo-go-driver](https://github.com/mongodb/mongo-go-driver)
- **前端**：React 19 + TypeScript + Vite + Tailwind CSS v4 + [shadcn/ui](https://ui.shadcn.com/)（Radix UI）
- 前端构建产物通过 `go:embed` 嵌入 Go 二进制，**单文件部署**，无需额外静态服务器

## 界面预览

| 明亮主题 | 暗黑主题 |
| --- | --- |
| ![明亮主题首页](docs/home-light.png) | ![暗黑主题首页](docs/home-dark.png) |

右上角的主题切换器支持 **Light / Dark / System** 三种模式，选择会保存在浏览器（`localStorage`），跟随系统模式会随操作系统实时变化：

![主题切换菜单](docs/theme-menu.png)

## 功能

| 模块 | 能力 |
| --- | --- |
| 连接管理 | 新增 / 编辑 / 删除连接、连通性测试、连接 / 断开、只读模式、颜色标记，连接配置持久化到本地 JSON |
| SSH 隧道 | 通过跳板机 / 堡垒机连接内网 MongoDB（密码或私钥认证，可选 known_hosts 严格校验） |
| 数据浏览 | 数据库 / 集合树形导航，数据库大小、集合列表 |
| 文档操作 | 过滤器编辑器（MongoDB 语法高亮、操作符 / 字段名自动补全、常用过滤模板）、排序、投影、分页；插入（支持批量数组）、整文档编辑替换、单条 / 批量 / 按条件删除；行选择批量删除、复制 JSON |
| 聚合管道 | 多行 JSON 编辑器 + 常用模板，表格 / JSON 两种结果视图 |
| SQL 查询 | 用 SQL 查询 MongoDB，自动翻译为 find / aggregation，支持 WHERE / IN / LIKE / GROUP BY / HAVING / DISTINCT / 聚合函数，并展示生成的 MQL |
| 索引 | 查看索引（键、唯一、稀疏、TTL、部分索引等）、创建、删除 |
| Schema 分析 | 抽样文档统计字段覆盖率与类型分布 |
| 统计信息 | `collStats` / `dbStats` 关键指标卡片 + 原始 JSON |
| 服务器信息 | 版本、构建信息、运行时长、数据库总大小 |
| 数据管理 | 创建 / 删除数据库、创建 / 删除集合（含 capped 选项） |
| 数据导入 / 导出 | JSON（Extended JSON 数组或 NDJSON）与 CSV 导入导出；导出可套用当前过滤 / 排序 / 投影，导入可先清空目标集合 |
| 集合复制 / 迁移 | 把集合（可按过滤）复制到同一连接下的其它数据库 / 集合，可选复制索引、先清空目标 |
| 执行计划 | 对 find / 聚合管道运行 `explain`（queryPlanner / executionStats / allPlansExecution），展示关键指标与原始计划 JSON |
| 查询可视化 | 把 find / SQL / 聚合结果切换为图表（柱状 / 折线 / 面积 / 饼图），自选 X 轴、数值字段与聚合方式（计数 / 求和 / 平均 / 最大 / 最小）；纯 SVG 无额外依赖 |
| 主题 / i18n | 明亮 / 暗黑 / 跟随系统三种模式；中文 / English 双语，顶栏切换并自动跟随浏览器语言，偏好保存在浏览器 |
| 登录 | 首次启动引导开启 TOTP 两步验证，之后所有 API 需登录（签名会话 Cookie） |
| 运维 | 守护进程后台运行（`-daemon` / `-stop` / `-status`）、一键安装脚本、`mongoui update` 自更新 |
| 浏览器 Agent | WebMCP（`navigator.modelContext`）+ `window.mongouiAgent`，把连接 / 查询 / 聚合 / 索引等操作暴露给浏览器内 agent，**默认关闭**、需显式开启 |
| MCP | 内置 Model Context Protocol server（stdio / HTTP），把连接、查询、聚合、SQL、增删改、索引等暴露给外部 Agent；支持整体只读模式 |

所有 BSON 值均以 **MongoDB Extended JSON**（relaxed 模式）在前后端之间传输，因此 `ObjectId`、`Date`、`Decimal128`、`Long`、`Binary` 等类型都能无损保留：

```json
{ "_id": { "$oid": "507f1f77bcf86cd799439011" }, "createdAt": { "$date": "2024-01-01T00:00:00Z" } }
```

## SQL 查询

集合视图新增 **SQL** 标签页，可以直接用 SQL 查询 MongoDB：编辑器带语法高亮（关键字 / 函数 / 字符串 / 数字 / 注释）与自动补全（关键字 / 函数 / 集合名 / 字段名），查询会被翻译成 find / aggregation 执行，并在界面里展示生成的 MQL（方便学习与调试）。按 Ctrl/⌘ + Enter 运行。

```sql
SELECT status, COUNT(*) AS n, SUM(total) AS revenue
FROM orders
WHERE total > 0
GROUP BY status
HAVING n > 1
ORDER BY revenue DESC
LIMIT 20
```

支持的范围：

- `SELECT` / `SELECT DISTINCT`，字段别名 `AS`
- `WHERE`：`= != <> > >= < <=`、`IN` / `NOT IN`、`LIKE` / `NOT LIKE`、`IS [NOT] NULL`、`AND` / `OR` / `NOT`、括号
- `ORDER BY ... [ASC|DESC]`、`LIMIT n [OFFSET m]`（也支持 MySQL 的 `LIMIT m, n`）
- `GROUP BY` / `HAVING`，聚合函数 `COUNT / SUM / AVG / MIN / MAX`
- 点号字段路径（如 `address.city`）

执行接口为 `POST /api/connections/{id}/databases/{db}/sql`（body `{ query, limit? }`），响应包含 `documents`、`columns` 以及翻译后的 `mql`。

## 过滤器与常用语法

文档页的过滤框是一个轻量的 MongoDB 过滤器编辑器（不引入额外依赖）：

- **语法高亮**：字段名、`$` 操作符、字符串 / 数字 / 布尔 / `null` 分色显示。
- **自动补全**：输入 `$` 补全查询 / BSON 操作符（带简要说明），输入字段名按当前结果列补全；`Enter` / `Tab` 接受，`↑` / `↓` 选择。
- **常用模板**：右侧魔棒可插入等于、比较、`$in`、正则、`$exists`、`$or` / `$and`、日期范围、按 `_id` 查询等模板。
- **历史与收藏**：过滤历史保存在浏览器，可把常用查询收藏起来，随时从下拉里取用。

语法与 MongoDB 一致（Extended JSON），例如：

```json
{ "status": "paid", "total": { "$gte": 100 }, "createdAt": { "$gte": { "$date": "2024-01-01T00:00:00Z" } } }
```

## 导入 / 导出与集合复制

- **导出**：`POST /api/connections/{id}/databases/{db}/collections/{col}/export`，body `{ format: "json"|"csv", filter?, sort?, projection?, limit? }`，返回文件名、MIME 与内容，由前端触发下载。JSON 使用 Extended JSON，CSV 会展开顶层字段。
- **导入**：`POST .../import`，body `{ format: "json"|"csv", content, drop? }`。JSON 支持数组或 NDJSON；CSV 以首行为表头，并自动推断数字 / 布尔 / 内嵌 JSON；`drop: true` 会先清空集合（可用作备份恢复）。
- **复制 / 迁移**：`POST .../copy`，body `{ targetDatabase, targetCollection, filter?, dropTarget?, copyIndexes? }`，把文档批量写入同一连接下的目标集合，并可选重建源索引。

## 执行计划（explain）

`POST /api/connections/{id}/databases/{db}/collections/{col}/explain`，body `{ type: "find"|"aggregate", filter?, sort?, projection?, pipeline?, limit?, verbosity? }`。界面在文档页与聚合页都提供入口，可切换 `queryPlanner` / `executionStats` / `allPlansExecution`，并展示耗时、扫描索引键 / 文档数、返回条数等指标与完整计划 JSON。

MCP 也暴露了 `mongoui_explain` 工具。

## 查询结果可视化（query to chart）

文档页、SQL 页与聚合页都可以把当前结果切换成图表（文档页在“更多操作”里打开可视化弹窗）：

- **图表类型**：柱状图、折线图、面积图、饼图。
- **X 轴**：任意字段，按值分类聚合。
- **数值**：可选多个数值字段（求和 / 平均 / 最大 / 最小），或直接用「计数」。
- **排序与上限**：按数值升 / 降序排列，并限制展示的分类数（默认 20）。
- **自动识别**：打开时自动选一个低基数的分类字段作 X 轴、数值字段作 Y 轴；配置按集合 / 查询记忆在浏览器 `localStorage`。
- 图表用原生 SVG 绘制，使用主题的 `--chart-*` 配色，暗黑模式自动适配，**不引入任何图表依赖**。

> 图表基于当前返回的文档（SQL / 聚合受结果上限约束，文档页为当前页）。需要全量统计时，用 SQL 的 `GROUP BY` 或聚合的 `$group` 先聚合成少量文档再可视化。

## URL 路由与状态保持

当前视图会写进 URL，刷新、分享链接、浏览器前进/后退都能恢复：

| 视图 | URL |
| --- | --- |
| 首页 | `/` |
| 连接概览 | `/connections/{connectionId}` |
| 集合视图 | `/connections/{connectionId}/databases/{db}/collections/{collection}` |
| 集合标签页 | 上表 URL 后追加 `?tab=documents\|sql\|aggregation\|indexes\|schema\|stats` |

- 直接打开深链接会按需自动连接该连接，并在左侧树里自动展开定位到对应集合。
- 侧边栏的展开状态保存在 `localStorage`，刷新后保持。
- 主题与浏览器 Agent 开关同样保存在 `localStorage`。

## 快速开始

### 环境要求

- Go 1.26+
- Node.js 20+
- 一个可访问的 MongoDB（本地、Docker 或 Atlas 均可）

### 生产模式（单二进制）

```bash
make build     # 构建前端 → 复制到 backend/web/dist → 编译 Go
make run       # 默认监听 :8080，数据目录 ./data
```

然后打开 <http://localhost:8080>。

### 开发模式（前后端分离）

```bash
make install        # 安装前端依赖

# 终端 1：后端（:8080）
make dev-backend

# 终端 2：前端（:5173，已配置 /api 代理到 :8080）
make dev-frontend
```

打开 <http://localhost:5173>。

### 本地起一个 MongoDB 测试

```bash
make docker-mongo   # docker run -p 27017:27017 mongo:8
```

## Docker

镜像内置前端，单容器即可运行；连接配置持久化在 `/data` 卷。

```bash
docker build -t mongoui .
docker run -d --name mongoui -p 8080:8080 -v mongoui-data:/data mongoui

# 或使用 compose
docker compose up -d
```

生产使用建议顺带保护 MCP 端点：

```bash
docker run -d -p 8080:8080 -v mongoui-data:/data \
  -e MONGOUI_MCP_TOKEN=change-me \
  mongoui
```

推送 `v*` tag 时 GitHub Actions 会自动构建并发布镜像到 GHCR：`ghcr.io/dolphinzzv/mongoui`。

> 容器内连接宿主机上的 MongoDB：Linux 下用 `--network host`，或把连接串指向宿主机 IP；Docker Desktop 可用 `host.docker.internal:27017`。

## 一键安装（从 GitHub Releases）

无需 Go/Node 环境，直接下载对应平台的预编译二进制（已内嵌前端）：

```bash
curl -fsSL https://raw.githubusercontent.com/dolphinZzv/mongoUI/main/scripts/install.sh | sh
```

指定版本 / 目录 / 顺便装 systemd 服务：

```bash
# 指定版本与安装目录
curl -fsSL https://raw.githubusercontent.com/dolphinZzv/mongoUI/main/scripts/install.sh \
  | sh -s -- --version v0.2.0 --dir "$HOME/.local/bin"

# 或先下载脚本再执行（避免管道问题）
curl -fsSL -o install.sh https://raw.githubusercontent.com/dolphinZzv/mongoUI/main/scripts/install.sh
sh install.sh --dir /usr/local/bin --service
```

脚本会自动识别 `linux/darwin` × `amd64/arm64`，下载归档并用 `checksums.txt` 校验 SHA-256。

## 后台运行（守护进程）

Unix 上可以让服务在后台常驻（脱离终端，写 pid 与日志文件）：

```bash
mongoui -addr :8080 -daemon                 # 后台启动
mongoui -status                             # 查看运行状态
mongoui -stop                               # 停止
```

- pid 文件默认 `<data>/mongoui.pid`，日志默认 `<data>/mongoui.log`，可用 `-pidfile` / `-logfile` 覆盖
- `-addr`、`-data` 等参数会被传递给后台子进程

Windows 不支持 `-daemon`，请使用 NSSM、任务计划程序或 Windows 服务。

## 自动更新

二进制内置自更新命令，会查询 GitHub Releases、校验 SHA-256 并原子替换自身：

```bash
mongoui update            # 更新到最新版本
mongoui update -check     # 只检查是否有新版本
mongoui update -force     # 已是新版也重新安装
mongoui update -version v0.2.0
```

仓库地址可用 `-repo owner/name` 或 `MONGOUI_REPO` 覆盖；设置 `GITHUB_TOKEN` 可提高 API 速率限制。更新后需重启进程（`mongoui -stop && mongoui -daemon`）。

## 浏览器 Agent（WebMCP）

MongoUI 可以把一组操作暴露给**浏览器内的 agent**，让它直接读取 / 操作当前服务，无需额外部署 MCP server。该能力**默认关闭**：需在右上角的 **Agent** 中手动开启，关闭后立即注销工具。

- **WebMCP**：当浏览器提供实验性的 `navigator.modelContext`（如 Edge）时自动注册工具。
- **兜底通道**：开启后始终暴露 `window.mongouiAgent`，扩展 / 书签 / 控制台均可调用：

```js
window.mongouiAgent.tools                       // [{ name, description }]
await window.mongouiAgent.call("mongoui_list_connections")
await window.mongouiAgent.call("mongoui_find", {
  connectionId: "<id>",
  database: "demo",
  collection: "users",
  filter: { age: { $gte: 30 } },
  limit: 20,
})
```

工具覆盖连接与库 / 集合浏览、查询、聚合、执行计划（explain）、Schema、索引，以及插入 / 更新 / 删除等写操作。所有调用都走同一个后端 REST API，因此仍受只读模式与后端校验约束；完整列表见 `frontend/src/lib/agentTools.ts`（界面里也会列出）。

## MCP（Model Context Protocol）

mongoUI 内置 MCP server，外部 AI Agent（Claude Desktop、Cursor、Cline 等）可以通过 MCP 直接操作 MongoDB——浏览库/集合、查询、聚合、SQL、执行计划（explain）、增删改、索引管理，无需自行连接数据库。

- **stdio**：`mongoui mcp`（本地子进程，共用 `-data` 目录里的连接配置）。
- **HTTP（Streamable HTTP）**：运行中的 server 在 `POST /mcp` 提供端点。

```jsonc
// Claude Desktop / Cursor —— 完整示例见 examples/ 与 docs/mcp.md
{
  "mcpServers": {
    "mongoui": {
      "type": "http",
      "url": "http://localhost:8080/mcp"
    }
  }
}
```

**只读模式**：用 `-mcp-readonly`（或 `MONGOUI_MCP_READONLY=1`）启动后，写工具不会出现在 `tools/list` 中，直接调用也会被拒绝；连接自身的「只读模式」同样生效，两层保护可独立使用。

详见 [docs/mcp.md](docs/mcp.md)。

### 登录与两步验证（TOTP）

首次打开界面会引导开启 TOTP：用验证器 App 扫描二维码（或手动输入密钥），输入 6 位验证码即启用。之后每次访问都需登录，会话由 **HttpOnly + SameSite=Strict 的签名 Cookie** 维持（默认 30 天）。

- 启用后所有 `/api/*` 需要登录（`/api/health` 除外）；静态前端不受影响，所以登录页始终能打开。
- 密钥经 AES-256-GCM 加密后保存在 `<data>/auth.json`；会话签名密钥由主密钥派生（`MONGOUI_SECRET_KEY`），**换主密钥会导致会话失效并需重新登录**。
- 启用 TOTP 后 `/mcp` 不在会话保护范围内，请务必设置 `MONGOUI_MCP_TOKEN`，否则 agent 端点等于无鉴权（启动时会有告警日志）。
- 想重置：删除 `<data>/auth.json` 重启，会重新进入首次设置。

## 配置

通过命令行参数或环境变量配置：

| 参数 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `-addr` | `MONGOUI_ADDR` | `:8080` | HTTP 监听地址 |
| `-data` | `MONGOUI_DATA` | `data` | 连接配置存储目录（`connections.json`） |
| `-web` | — | 空 | 从指定目录提供前端资源（覆盖内嵌版本） |
| `-mcp-readonly` | `MONGOUI_MCP_READONLY` | 关 | MCP 只读模式（不暴露写工具） |
| `-mcp-token` | `MONGOUI_MCP_TOKEN` | 空 | `/mcp` 的 Bearer 令牌（非空时校验） |
| `-tls-cert` | `MONGOUI_TLS_CERT` | 空 | TLS 证书；与 `-tls-key` 同时设置时启用 HTTPS |
| `-tls-key` | `MONGOUI_TLS_KEY` | 空 | TLS 私钥 |
| — | `MONGOUI_KNOWN_HOSTS` | `~/.ssh/known_hosts` | SSH 跳板机主机密钥校验文件 |
| — | `MONGOUI_SECRET_KEY` | 自动生成 | 加密连接密钥的主密钥（32 字节 hex/base64）；不填则用 `<data>/secret.key` |
| — | `MONGOUI_ALLOW_ORIGIN` | 空 | 允许跨域访问的来源（逗号分隔）；默认仅同源 |

```bash
./bin/mongoui -addr :9000 -data /var/lib/mongoui
```

### SSH 隧道（跳板机）

在连接编辑弹窗里打开 **SSH tunnel**，即可通过跳板机访问内网 MongoDB。MongoDB 自身无需对运行 mongoui 的机器开放：驱动会把每个到 MongoDB 的 TCP 连接交给 SSH 服务器转发。

| 字段 | 说明 |
| --- | --- |
| SSH host / port | 跳板机地址，默认端口 `22` |
| SSH user | 登录用户名 |
| Authentication | `Password` 或 `Private key`（PEM / OpenSSH，可带 passphrase） |
| known_hosts file | 可选，服务器上的 OpenSSH known_hosts 路径；留空时依次回退到 `MONGOUI_KNOWN_HOSTS`、`~/.ssh/known_hosts` |

> 主机密钥默认**严格校验**（用上面的 known_hosts）。只有当上述文件都不存在时，才回退到“接受任意主机密钥”并打印警告。

`mongodb+srv://` 同样可用：SRV 解析在本机完成，随后由 SSH 服务器去连接解析出的节点。

## 安全说明

- 连接串（含账号密码）与 SSH 密码 / 私钥在 `connections.json` 中默认以 **AES-256-GCM 加密**存储（`enc:v1:` 前缀）。主密钥来自 `MONGOUI_SECRET_KEY`（32 字节 hex/base64），未设置时首次启动自动生成 `<data>/secret.key`（权限 `0600`）。**请务必备份主密钥或 `secret.key`，丢失后将无法解密连接配置。** 旧版明文配置会在启动时自动加密。请仅在可信环境使用，不要将 `data/` 提交到版本库（已在 `.gitignore` 中忽略）。
- 只读模式在**网页端、HTTP API 与 MCP 写工具中均服务端强制生效**（对只读连接的写操作返回 403，包括聚合里的 `$out` / `$merge`）。
- 跨域默认**关闭（仅同源）**：如需让其他源访问 API/MCP，请设置 `MONGOUI_ALLOW_ORIGIN`（逗号分隔）。
- 请求体限制 32MB，聚合结果默认限量，服务端设置了读/写/空闲超时，响应带 `X-Content-Type-Options` / `X-Frame-Options` / `Referrer-Policy`。
- 连接列表接口对 **URI 密码与 SSH 凭据做了脱敏**（密码显示为 `xxxxxxxx`、SSH 密钥清空）；完整凭据仅在打开编辑弹窗时按单个连接获取，保存时会用完整值回写，不会丢失。
- 首次启动会**强制引导设置 TOTP 两步验证**（见下），之后所有 `/api/*` 需要登录会话（`/api/health` 除外）。
- `/mcp` 端点同样默认无鉴权，对外暴露时请设置 `MONGOUI_MCP_TOKEN`（或 `-mcp-token`），并可用 `-mcp-readonly` 限制为只读。

## 持续集成与发布

**CI**（`.github/workflows/ci.yml`）在 push / PR 时运行：

- 后端：校验 `go mod tidy`、`go vet`、`go test -race`（上传覆盖率）
- 前端：`tsc --noEmit`、`vite build`
- 单文件二进制：执行 `scripts/build.sh` 产出内嵌前端的二进制，并启动做冒烟检查（校验 `/api/health` 返回 `uiEmbedded:true` 与首页可访问）

**Release**（`.github/workflows/release.yml` + `.goreleaser.yaml`）在推送 `v*` tag 时触发 GoReleaser：

- 先构建前端并嵌入 Go，再交叉编译 linux / macOS / Windows（amd64、arm64）
- 生成 `tar.gz`（Windows 为 `zip`）归档、`checksums.txt` 与自动 changelog，发布到 GitHub Releases
- 归档里的二进制已内嵌前端，下载解压后直接运行即可

发布新版本：

```bash
./scripts/sync-version.sh v0.2.4   # 同步 frontend/package.json 版本（必须与 tag 一致）
git tag v0.2.4
git push origin v0.2.4
```

> `frontend/package.json` 的版本必须与 tag 一致：CI 会在 tag 构建时校验，`scripts/build.sh` 也会拒绝内嵌过期前端（缺少主题 / 版本标记）的构建，避免再次出现「内嵌包版本停留在 0.1.0」这类发布旧 UI 的问题。Release 也会在构建前自动同步一次。

也可在 Actions 页面手动触发 Release workflow 的 snapshot 构建（不创建 GitHub Release）。

## 版本信息

版本号会被注入二进制，可通过 `-version` 查看，`/api/health` 也会返回：

```bash
./bin/mongoui -version
# mongoui v0.1.0 (commit abc1234, built 2024-01-01T00:00:00Z)
```

本地 `scripts/build.sh` 会从 git tag / commit 自动注入；CI 中由 GoReleaser 注入。前端构建会把同一个版本号写进界面（首页与侧边栏底部），方便确认手上的二进制到底内嵌了哪个版本。

## 开发命令

```bash
make help        # 查看所有命令
make test        # 运行后端单元测试
make vet         # go vet
make fmt         # gofmt
make clean       # 清理构建产物
```

## 后续可扩展方向

- 多用户与更细粒度的权限（当前是单一 TOTP 登录 + 每连接只读开关）
- 跨设备的查询收藏同步（当前历史与收藏保存在浏览器 `localStorage`）
- 定时备份 / 导出任务与进度展示
- 更完整的索引编辑器（可视化选择字段、collation、隐藏索引等）
- 复制的高级选项（字段映射 / 限速 / 跨连接迁移）
