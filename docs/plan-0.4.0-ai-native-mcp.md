# 0.4.0 规划：AI-Native —— DBDog 作为本地 MCP 服务

> 状态：**已取消（2026-10-22）**——决策：不做 AI-Native/MCP，评估结论是使用价值有限。0.x 版本号继续沿 patch 递增。本文档仅作决策记录保留，里面的选型分析（stdio 传输、rmcp SDK、守卫下沉 Rust 侧等）在将来重启同类需求时仍可参考。
>
> 原状态：规划（未实施） · 原目标版本：0.4.0 · 起草日期：2026-10-13

## 1. 背景与目标

0.4.0 把 DBDog 从「人用的数据库 GUI」升级为「AI 可调用的数据检索工具」（AI-Native）：

- **不内嵌 AI**——不带任何模型调用、不依赖任何 LLM API，零额外成本；
- **被 AI 调用**——通过 [MCP（Model Context Protocol）](https://modelcontextprotocol.io)把 DBDog 已有的能力暴露给本地 AI 客户端（Claude Desktop / Cursor / Cline / Claude Code 等），让 AI 能查 MySQL、浏览 Memcached、读 ZooKeeper；
- **可配置扩展**——除了复用 GUI 里已建的连接，还支持在 MCP 配置中直接新增数据库连接，GUI 不运行也可用。

一句话：AI 客户端负责「思考」，DBDog 负责「安全地把数据取出来」。

## 2. 总体架构

```
┌─────────────┐  MCP (stdio)   ┌────────────────┐
│ Claude      │◄──────────────►│ dbdog-mcp.exe   │
│ Cursor      │  JSON-RPC      │ (无 GUI 独立进程)│
│ Cline …     │                └───────┬────────┘
└─────────────┘                        │ 复用
                                       ▼
                          ┌─────────────────────────┐
                          │ dbdog-core（现有 lib）    │
                          │ drivers/mysql (sqlx)     │
                          │ drivers/memcached (TCP)  │
                          │ drivers/zookeeper (TCP)  │
                          │ query/ 守卫与执行         │
                          │ connection/storage+crypto│
                          └────────┬────────────────┘
                                   │ 读取同一份配置/凭据
                 ┌─────────────────┼──────────────────┐
                 ▼                 ▼                  ▼
         connections.json      mcp.json          OS 凭据存储
         (GUI 建的连接)      (MCP 专属配置)      (keyring/XOR)
                 ▲
       ┌─────────┴─────────┐
       │ DBDog GUI (tauri) │── 负责：连接管理、MCP 授权/开关、调用日志、
       └───────────────────┘    生成各 AI 客户端的接入配置片段
```

核心原则：**GUI 与 MCP 是同一套核心的两个前端**。MCP 进程与 GUI 共享连接配置和凭据存储，互不依赖对方运行。

## 3. 进程与传输模型（关键选型）

**推荐：独立 `dbdog-mcp` 二进制 + stdio 传输。**

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| A. GUI 内嵌 HTTP/SSE server（127.0.0.1:port + token） | 复用 AppState 连接池；GUI 可实时观测 | DBDog 必须运行中；部分客户端只支持 stdio；多一个本地端口暴露面 | 0.5.x 备选 |
| B. 独立 `dbdog-mcp` 二进制，stdio 传输 | stdio 是**所有** MCP 客户端的公共分母；AI 客户端自行拉起/退出进程；GUI 不必运行；无端口、无 token 管理 | 需要解决配置目录定位与打包；每个客户端进程各自持有连接池 | **0.4.0 采用** |

实现路径：现有 `src-tauri` crate 已有 `lib.rs`（模块均 pub re-export），**新增 `[[bin]] name = "dbdog-mcp"`** 复用同一 lib，不需要 workspace 重构。MCP SDK 用 `rmcp`（MCP 官方 Rust SDK，stdio transport 开箱即用）。若后续 tauri 依赖链接成为负担（编译时间/体积），再拆 `dbdog-core` workspace crate（放 0.5.x）。

## 4. MCP 工具面（检索为主，写默认关闭）

命名统一 `dbdog_` 前缀；`connection` 参数一律填连接名称（`mcp.json` 内唯一）。

### MySQL

| 工具 | 说明 | 默认 |
|------|------|------|
| `dbdog_list_connections` | 列出授权给 MCP 的连接（名称/类型/host/默认库，**不含凭据**） | 开 |
| `mysql_databases` | 库清单（information_schema.schemata） | 开 |
| `mysql_tables(connection, database)` | 表清单 + 行数估计 + 表注释 | 开 |
| `mysql_schema(connection, database, table)` | 列/类型/索引/建表 DDL（复用 metadata 模块） | 开 |
| `mysql_query(connection, sql, limit?)` | **只读白名单**：SELECT/SHOW/DESC/EXPLAIN/WITH；强制 LIMIT 包裹（复用 `limitGuardSql` 思路在 Rust 侧实现）、行数上限、超时 | 开 |
| `mysql_execute(connection, sql)` | UPDATE/INSERT/DELETE/DDL；强校验顶层 WHERE（复用 `hasTopLevelWhere`） | **关**（配置显式开启） |

### Memcached

| 工具 | 说明 | 默认 |
|------|------|------|
| `memcached_get(connection, key)` | 读单个 key | 开 |
| `memcached_keys(connection, cursor?)` | 遍历 key（stats cachedump 分页，复用现有实现） | 开 |
| `memcached_stats(connection)` | 服务统计 | 开 |
| `memcached_set / delete / flush_all` | 写操作 | **关** |

### ZooKeeper

| 工具 | 说明 | 默认 |
|------|------|------|
| `zk_tree(connection, path?, depth?)` | 子树结构（带深度限制） | 开 |
| `zk_get(connection, path)` | 读节点数据与 stat | 开 |

**统一结果约束**（对齐业内工具返回预算：Claude Code 默认在 25K tokens 处截断 MCP 输出，即约 100KB 英文 / 40–70KB 中文文本；多数数据库类 MCP 服务端默认每次返回 10–100 行）：

- **行数截断**：默认 100 行（`mysql_query` 可传更小的 `limit`，不可超过 `maxRows`）；
- **单元格截断**：默认 1000 字符/值（超长 JSON/TEXT 返回前缀 + `_truncatedInCell: true`）——真正的爆上下文元凶往往是几个宽 TEXT 列，行数控制不住它；
- **字节硬顶**：默认 64 KB（`maxResultBytes`），超过即整结果截断并标注 `_truncated: true`，附收窄建议（加 WHERE/减少列）——更大数据量引导用户走 GUI 的导出功能，不往模型上下文里灌。

## 5. 配置模型

### 5.1 `mcp.json`（app_data_dir，与 connections.json 同目录）

```jsonc
{
  "enabled": true,              // 总开关（GUI 控制生成客户端配置片段时引用）
  "readOnly": true,             // 全局只读：true 时 mysql_execute/写工具直接拒绝
  "allowMysqlExecute": false,   // 写 SQL 总开关（readOnly=true 时无效）
  "maxRows": 100,
  "queryTimeoutSecs": 15,
  "maxResultBytes": 65536,      // 64KB 硬顶（业内锚点：Claude Code 25K tokens ≈ 100KB 英文）
  "connections": [              // ① 授权复用 GUI 已建的连接（按 id 引用）
    { "id": "<uuid>", "allow": true, "tools": { "mysqlExecute": false } }
  ],
  "local": [                    // ② MCP 专属新增连接（GUI 不可见或无需开 GUI）
    {
      "name": "prod-report",
      "type": "mysql",
      "host": "10.0.0.5", "port": 3306,
      "username": "report_ro", "database": "report",
      "password": { "env": "DBDOG_PROD_REPORT_PWD" }  // 凭据走环境变量引用，不落盘明文
    }
  ]
}
```

「支持配置增加数据库」两条路都通：

1. **GUI 授权**：设置页把已有连接勾选授权给 MCP（写进 `connections` 数组）；
2. **配置直增**：`local` 数组直接声明新连接，密码支持 `{ "env": "VAR" }` 引用环境变量（推荐）或 `{ "plain": "..." }`（明文，文档标注风险）。GUI 的 MCP 管理页同样提供新增表单（复用 ConnectionFormModal 交互），落盘到 `local`。

### 5.2 GUI：设置页新增「MCP」分区

- 总开关 / 只读模式 / 写工具开关 / 行数与超时上限
- 连接授权列表（勾选哪些连接对 MCP 可见）+ 新增连接入口
- 调用日志查看（最近 N 条：时间 / 工具 / 连接 / SQL 摘要 / 耗时 / 行数）
- **一键生成客户端配置片段**：Claude Desktop（`claude_desktop_config.json`）、Cursor（`mcp.json`）、Claude Code（`claude mcp add`）三种格式复制到剪贴板，指向 dbdog-mcp.exe 绝对路径

## 6. 安全与守卫

1. **默认只读**：`readOnly=true` 出厂默认；写工具需两层显式开启（全局 `allowMysqlExecute` + 连接级 `tools.mysqlExecute`）。
2. **SQL 守卫前移**：白名单校验、LIMIT 包裹、无 WHERE 的 UPDATE/DELETE 拦截全部在 Rust 侧 `query/` 模块实现（现有前端守卫逻辑下沉复用），MCP 与 GUI 走同一条守卫路径。
3. **凭据不扩散**：MCP 工具结果永不回显密码；`dbdog_list_connections` 只回显主机/库名等非敏感字段；日志对 SQL 中的字符串字面量做摘要化处理（只留长度与哈希前 8 位）。
4. **审计日志**：每次 MCP 调用追加写 `mcp-audit.jsonl`（本地），GUI 可查看；这是排查「AI 到底查了什么」的唯一真相源。
5. **资源上限**：每客户端连接池 2–4；查询超时默认 15s；单结果 256 KB 截断。
6. **本地信任模型明示**：本地 MCP 意味着本机 AI 客户端（及其宿主进程）可以按配置查询这些数据库——文档与 GUI 开关文案都要写清楚，避免用户误以为有沙箱隔离。

## 7. 代码改造点

| 改造 | 内容 | 规模 |
|------|------|------|
| `ConnectionStorage` 去 `AppHandle` 化 | `config_path()` 改为构造注入 `data_dir`；GUI 传 `app_data_dir()`，`dbdog-mcp` 用 `dirs` crate 按 identifier `com.dbdog.app` 解析同一目录（Windows: `%APPDATA%\com.dbdog.app`） | 小 |
| 守卫逻辑下沉 | `limitGuardSql` / 白名单 / `hasTopLevelWhere` 在 Rust 侧成体系（现仅前端 TS 有），供 MCP 与未来 GUI 共用 | 中 |
| `[[bin]] dbdog-mcp` | `src-tauri/src/bin/mcp.rs`：rmcp stdio server，注册第 4 节工具，读 `mcp.json` | 中 |
| GUI MCP 管理页 | 设置页新增分区（表单/授权列表/日志/配置片段生成），i18n 双语 | 中 |
| 打包 | tauri bundle 额外携带 `dbdog-mcp.exe`（`externalBin`/资源复制，msi+nsis 验证） | 小 |

## 8. 里程碑与验收

| 里程碑 | 内容 | 验收标准 |
|--------|------|----------|
| M1 核心解耦 | ConnectionStorage 去 AppHandle；`dbdog-mcp` 空架子（rmcp stdio，`dbdog_list_connections` 能跑） | Claude Desktop 配置后能列出连接；GUI 未运行也可用 |
| M2 MySQL 工具面 | databases/tables/schema/query + 只读守卫 + 审计日志 + mcp.json 加载 | AI 能完成「看库→看表→看结构→抽样查询」闭环；无 LIMIT 的 SELECT 被包裹；写 SQL 默认拒绝 |
| M3 GUI 管理页 | 授权/新增连接/日志/客户端配置片段生成 | GUI 勾选连接后 MCP 立即可见；新增 `local` 连接 AI 可直接查 |
| M4 MC + ZK 工具面 | 第 4 节 Memcached/ZooKeeper 工具 | get/keys/stats、tree/get 全通 |
| M5 文档与发布 | README「AI 接入」章节（三种客户端示例）、changelog、msi/nsis 带 bin | 新用户 5 分钟内从安装到 AI 首次查询成功 |

## 9. 风险与开放问题

- **凭据解密路径**：Windows 侧凭据是 XOR 加密存 `connections.json`（keyring 仅非 Windows），sidecar 链接同一 `crypto` 模块即可解密——可行，但意味着「拿到配置文件+本机执行权」即等于拿到数据库凭据，与本地 MCP 信任模型一致，需在文档明示。
- **同 crate 双 bin 的链接开销**：`dbdog-mcp` 会链入 tauri 依赖（编译变慢、体积变大但功能无损）。若不可接受，M2 后评估拆 `dbdog-core` workspace。
- **超大库的 schema 工具**：`mysql_tables` 在几千张表的库上要做分页/按需加载，避免一次灌爆上下文。
- **开放问题**：是否提供 Streamable HTTP 传输（多客户端共享一个进程/连接池，需 token 鉴权）——倾向 0.5.x 再议；是否支持 PostgreSQL/Redis（驱动层已按 trait 抽象，加驱动属增量工作）——收集需求后排期。
