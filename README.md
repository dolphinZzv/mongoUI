# MongoUI

一个轻量的 MongoDB 可视化管理工具（类似 Navicat / MongoDB Compass 的简化版）。

- **后端**：Go + [chi](https://github.com/go-chi/chi) + 官方 [mongo-go-driver](https://github.com/mongodb/mongo-go-driver)
- **前端**：React 19 + TypeScript + Vite + Tailwind CSS v4 + [shadcn/ui](https://ui.shadcn.com/)（Radix UI）
- 前端构建产物通过 `go:embed` 嵌入 Go 二进制，**单文件部署**，无需额外静态服务器

## 功能

| 模块 | 能力 |
| --- | --- |
| 连接管理 | 新增 / 编辑 / 删除连接、连通性测试、连接 / 断开、只读模式、颜色标记，连接配置持久化到本地 JSON |
| 数据浏览 | 数据库 / 集合树形导航，数据库大小、集合列表 |
| 文档操作 | 过滤、排序、投影、分页；插入（支持批量数组）、整文档编辑替换、单条 / 批量 / 按条件删除；行选择批量删除、复制 JSON |
| 聚合管道 | 多行 JSON 编辑器 + 常用模板，表格 / JSON 两种结果视图 |
| 索引 | 查看索引（键、唯一、稀疏、TTL、部分索引等）、创建、删除 |
| Schema 分析 | 抽样文档统计字段覆盖率与类型分布 |
| 统计信息 | `collStats` / `dbStats` 关键指标卡片 + 原始 JSON |
| 服务器信息 | 版本、构建信息、运行时长、数据库总大小 |
| 数据管理 | 创建 / 删除数据库、创建 / 删除集合（含 capped 选项） |
| 主题 | 明亮 / 暗黑 / 跟随系统三种模式，偏好保存在浏览器 |
| 运维 | 守护进程后台运行（`-daemon` / `-stop` / `-status`）、一键安装脚本、`mongoui update` 自更新 |

所有 BSON 值均以 **MongoDB Extended JSON**（relaxed 模式）在前后端之间传输，因此 `ObjectId`、`Date`、`Decimal128`、`Long`、`Binary` 等类型都能无损保留：

```json
{ "_id": { "$oid": "507f1f77bcf86cd799439011" }, "createdAt": { "$date": "2024-01-01T00:00:00Z" } }
```

## 目录结构

```
mongoui/
├── backend/                     # Go API 服务
│   ├── main.go                  # 启动、静态资源托管、优雅退出
│   ├── internal/
│   │   ├── api/                 # HTTP 路由与处理器
│   │   │   ├── router.go        # chi 路由 + CORS + 中间件
│   │   │   ├── response.go      # Extended JSON / 响应辅助
│   │   │   ├── handlers_connection.go
│   │   │   ├── handlers_database.go
│   │   │   ├── handlers_document.go
│   │   │   ├── handlers_index.go
│   │   │   └── handlers_server.go
│   │   ├── config/store.go      # 连接配置持久化（JSON 文件 + 原子写）
│   │   └── mongoclient/manager.go # 连接池（按连接 ID 缓存 client）
│   └── web/embed.go             # 嵌入 frontend/dist
├── frontend/                    # React 前端
│   ├── src/
│   │   ├── App.tsx              # 布局与全局状态
│   │   ├── components/          # 业务组件
│   │   │   ├── app-sidebar.tsx          # 连接 / 库 / 集合树
│   │   │   ├── connection-dialog.tsx
│   │   │   ├── connection-overview.tsx
│   │   │   ├── collection-view.tsx      # 集合详情 + 标签页
│   │   │   ├── documents-tab.tsx
│   │   │   ├── document-dialog.tsx
│   │   │   ├── aggregation-tab.tsx
│   │   │   ├── indexes-tab.tsx
│   │   │   ├── schema-tab.tsx
│   │   │   ├── stats-tab.tsx
│   │   │   ├── json-editor.tsx / json-view.tsx
│   │   │   ├── confirm-dialog.tsx
│   │   │   └── ui/              # shadcn/ui 组件
│   │   └── lib/                 # api 客户端、类型、ExtJSON 工具
│   └── vite.config.ts           # /api 代理到后端
├── Makefile
└── README.md
```

## 快速开始

### 环境要求

- Go 1.22+
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

## 配置

通过命令行参数或环境变量配置：

| 参数 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `-addr` | `MONGOUI_ADDR` | `:8080` | HTTP 监听地址 |
| `-data` | `MONGOUI_DATA` | `data` | 连接配置存储目录（`connections.json`） |
| `-web` | — | 空 | 从指定目录提供前端资源（覆盖内嵌版本） |

```bash
./bin/mongoui -addr :9000 -data /var/lib/mongoui
```

## API

所有接口以 `/api` 为前缀，统一返回 `{ "data": ... }` 或 `{ "error": "..." }`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| GET | `/api/connections` | 连接列表 |
| POST | `/api/connections` | 新建连接 |
| PUT | `/api/connections/{id}` | 更新连接（在线时自动重连） |
| DELETE | `/api/connections/{id}` | 删除连接 |
| POST | `/api/connections/test` | 测试连接串（不保存） |
| POST | `/api/connections/{id}/connect` \| `/disconnect` | 建立 / 断开连接 |
| GET | `/api/connections/{id}/server` | 服务器信息（hello / buildInfo） |
| GET | `/api/connections/{id}/databases` | 数据库列表（含大小） |
| POST | `/api/connections/{id}/databases` | 创建数据库 |
| DELETE | `/api/connections/{id}/databases/{db}` | 删除数据库 |
| GET | `/api/connections/{id}/databases/{db}/stats` | dbStats |
| GET / POST | `/api/connections/{id}/databases/{db}/collections` | 集合列表 / 创建集合 |
| DELETE | `/api/connections/{id}/databases/{db}/collections/{col}` | 删除集合 |
| GET | `.../{col}/stats` \| `/schema` | 集合统计 / Schema 抽样 |
| POST | `.../{col}/find` | 查询文档（filter/sort/projection/skip/limit） |
| POST | `.../{col}/insert` | 插入文档（数组即批量） |
| POST | `.../{col}/update` | 更新（带 `$` 操作符 → update；否则整文档替换） |
| POST | `.../{col}/delete` | 删除文档 |
| POST | `.../{col}/aggregate` | 聚合管道 |
| GET / POST | `.../{col}/indexes` | 索引列表 / 创建 |
| DELETE | `.../{col}/indexes/{name}` | 删除索引 |

示例：

```bash
# 查询 age >= 30 的文档，按 age 升序
curl -X POST localhost:8080/api/connections/<id>/databases/demo/collections/users/find \
  -H 'Content-Type: application/json' \
  -d '{"filter":{"age":{"$gte":30}},"sort":{"age":1},"limit":20}'

# 聚合
curl -X POST localhost:8080/api/connections/<id>/databases/demo/collections/users/aggregate \
  -H 'Content-Type: application/json' \
  -d '{"pipeline":[{"$group":{"_id":"$status","n":{"$sum":1}}}]}'
```

## 安全说明

- 连接串（含账号密码）以**明文**保存在 `-data` 指定的 `connections.json` 中，文件权限为 `0600`。请仅在可信环境使用，不要将 `data/` 提交到版本库（已在 `.gitignore` 中忽略）。
- 只读模式会在前端禁用所有写操作，但后端未强制拦截；如需强约束请使用只读数据库账号。
- 服务默认无鉴权，请勿直接暴露到公网；建议通过 SSH 隧道或反向代理 + 认证访问。

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
git tag v0.1.0
git push origin v0.1.0
```

也可在 Actions 页面手动触发 Release workflow 的 snapshot 构建（不创建 GitHub Release）。

## 版本信息

版本号会被注入二进制，可通过 `-version` 查看，`/api/health` 也会返回：

```bash
./bin/mongoui -version
# mongoui v0.1.0 (commit abc1234, built 2024-01-01T00:00:00Z)
```

本地 `scripts/build.sh` 会从 git tag / commit 自动注入；CI 中由 GoReleaser 注入。

## 开发命令

```bash
make help        # 查看所有命令
make test        # 运行后端单元测试
make vet         # go vet
make fmt         # gofmt
make clean       # 清理构建产物
```

## 后续可扩展方向

- 连接鉴权 / 多用户
- 数据导入导出（JSON / CSV）
- 查询历史与收藏
- 集合间的复制 / 迁移
- 更完整的索引编辑器与执行计划（explain）可视化
- 深色 / 浅色主题切换（当前默认深色）
