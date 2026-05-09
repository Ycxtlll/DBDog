# DBDog Phase 1 详细设计文档

> **版本**: 0.1.0  
> **阶段**: Phase 1 — MySQL/MariaDB 核心功能  
> **对应架构**: [ARCHITECTURE.md](./ARCHITECTURE.md)  
> **对应需求**: [REQUIREMENTS.md](./REQUIREMENTS.md)

---

## 1. 概述

Phase 1 交付 MySQL/MariaDB 数据库管理的核心闭环功能，涵盖连接、查询、Schema 浏览、数据工具、命令面板、设置六大模块。

**核心设计目标**:
- 连接配置本地持久化 + OS 密钥链，零明文
- Schema 双层缓存（L1 内存 + L2 磁盘），千级表秒开
- 查询结果默认截断 1000 行，支持流式导出
- 所有长列表虚拟化渲染，万级节点不卡顿
- 向后兼容的 IPC 协议，为未来多数据库扩展预留接口

**Phase 1 不包含**: ER 图、健康监控、查询历史与书签（移至 Phase 2+）

---

## 2. 共享数据模型

### 2.1 连接配置

```rust
// src-tauri/src/connection/model.rs

use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub id: Uuid,
    pub name: String,
    #[serde(rename = "type")]
    pub db_type: DatabaseType,        // Phase 1 仅 mysql
    pub host: String,
    pub port: u16,
    pub username: String,
    #[serde(skip_serializing)]       // 禁止明文落盘
    pub password: Option<String>,
    pub database: Option<String>,     // 默认库
    pub max_connections: Option<u32>, // 默认 10
    pub ssl_mode: Option<SslMode>,
    pub ssl_cert_path: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DatabaseType {
    Mysql,
    // Phase 2/3 扩展: Redis, Memcached, Zookeeper
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum SslMode {
    Disabled,
    Required,
    VerifyCa,
    VerifyFull,
}
```

```typescript
// src/types/index.ts

export interface ConnectionConfig {
  id: string;
  name: string;
  type: 'mysql';
  host: string;
  port: number;
  username: string;
  database?: string;
  maxConnections?: number;
  sslMode?: 'disabled' | 'required' | 'verify-ca' | 'verify-full';
  sslCertPath?: string;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ServerInfo {
  version: string;
  connectionId: string;
}
```

### 2.2 查询结果

```rust
// src-tauri/src/query/result.rs

use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Serialize)]
pub struct QueryResult {
    pub columns: Vec<ColumnMeta>,
    pub rows: Vec<Vec<Value>>,
    pub total_count: u64,
    pub truncated: bool,
    pub elapsed_ms: u64,
}

#[derive(Debug, Serialize)]
pub struct UpdateResult {
    pub rows_affected: u64,
    pub last_insert_id: Option<u64>,
    pub elapsed_ms: u64,
}

#[derive(Debug, Serialize)]
pub struct ColumnMeta {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
}
```

```typescript
// src/types/index.ts

export interface ColumnMeta {
  name: string;
  dataType: string;
  nullable: boolean;
}

export interface QueryResult {
  columns: ColumnMeta[];
  rows: unknown[][];
  totalCount: number;
  truncated: boolean;
  elapsedMs: number;
}

export interface UpdateResult {
  rowsAffected: number;
  lastInsertId?: number;
  elapsedMs: number;
}
```

### 2.3 Schema 数据结构

```rust
// src-tauri/src/schema/model.rs

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct Database {
    pub name: String,
    pub charset: Option<String>,
    pub collation: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Table {
    pub name: String,
    pub engine: Option<String>,
    pub rows: Option<u64>,
    pub size_mb: Option<f64>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Column {
    pub name: String,
    pub ordinal_position: u32,
    pub data_type: String,
    pub nullable: bool,
    pub is_primary_key: bool,
    pub is_auto_increment: bool,
    pub default_value: Option<String>,
    pub comment: Option<String>,
    pub max_length: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Index {
    pub name: String,
    pub columns: Vec<String>,
    pub is_unique: bool,
    pub is_primary: bool,
    pub index_type: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ForeignKey {
    pub name: String,
    pub column: String,
    pub referenced_table: String,
    pub referenced_column: String,
    pub update_rule: String,
    pub delete_rule: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Trigger {
    pub name: String,
    pub event: String,
    pub timing: String,
    pub statement: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TableDetails {
    pub columns: Vec<Column>,
    pub indexes: Vec<Index>,
    pub foreign_keys: Vec<ForeignKey>,
    pub triggers: Vec<Trigger>,
    pub create_table_sql: String,
}
```

---

## 3. 连接管理模块

### 3.1 模块职责

| 文件 | 职责 |
|------|------|
| `connection/manager.rs` | PoolManager：DashMap<Uuid, MySqlPool> 管理 |
| `connection/model.rs` | ConnectionConfig 结构体与校验 |
| `connection/storage.rs` | connections.json 读写 + keyring 密码存取 |
| `commands/connection.rs` | Tauri IPC 命令：list/save/delete/test/connect/disconnect |

### 3.2 PoolManager

```rust
// src-tauri/src/connection/manager.rs

use dashmap::DashMap;
use sqlx::mysql::MySqlPool;
use uuid::Uuid;

pub struct PoolManager {
    pools: DashMap<Uuid, MySqlPool>,
}

impl PoolManager {
    pub fn new() -> Self {
        Self { pools: DashMap::new() }
    }

    /// 幂等连接：同一 UUID 重复 connect 返回已有池
    pub async fn connect(&self, id: Uuid, pool: MySqlPool) {
        self.pools.entry(id).or_insert(pool);
    }

    pub fn get(&self, id: &Uuid) -> Option<MySqlPool> {
        self.pools.get(id).map(|e| e.clone())
    }

    pub async fn disconnect(&self, id: &Uuid) {
        if let Some((_, pool)) = self.pools.remove(id) {
            pool.close().await;
        }
    }

    pub fn is_connected(&self, id: &Uuid) -> bool {
        self.pools.contains_key(id)
    }
}
```

### 3.3 密码安全存储流程

```
save_connection(config)
    │
    ├── 密码存在？
    │   ├── Yes ──► keyring::set_password("dbdog", config.id.to_string(), password)
    │   └── No ──► 跳过
    │
    ├── config 中 password 字段设为 None
    │
    └── serde_json::to_string_pretty(config) ──► 写入 connections.json

load_connections()
    │
    ├── 读取 connections.json ──► Vec<ConnectionConfig>
    │
    └── 遍历每个 config
            └── keyring::get_password("dbdog", config.id.to_string())
                    ├── Ok(password) ──► config.password = Some(password)
                    └── Err(_) ──► config.password = None（前端降级弹窗输入）
```

### 3.4 连接状态流转

```
[disconnected] -- 用户点击 Connect --► [connecting]
    │                                          │
    │                                          ├── 成功 ──► [connected]
    │                                          │              │
    │                                          │              ├── 用户点击 Disconnect ──► [disconnected]
    │                                          │              │
    │                                          │              └── 网络异常 ──► [error]
    │                                          │                                 │
    │                                          │                                 └── 用户 Retry ──► [connecting]
    │                                          │
    │                                          └── 失败 ──► [error]
    │
    └── 用户点击 Test ──► 不创建池，仅验证网络+认证 ──► 返回版本号或错误
```

### 3.5 IPC 命令

```rust
#[tauri::command]
pub async fn list_connections(state: tauri::State<'_, AppState>) -> Result<Vec<ConnectionConfig>, AppError>;

#[tauri::command]
pub async fn save_connection(
    state: tauri::State<'_, AppState>,
    config: ConnectionConfig,
) -> Result<ConnectionConfig, AppError>;

#[tauri::command]
pub async fn delete_connection(
    state: tauri::State<'_, AppState>,
    id: Uuid,
) -> Result<(), AppError>;

#[tauri::command]
pub async fn test_connection(
    state: tauri::State<'_, AppState>,
    config: ConnectionConfig,
) -> Result<String, AppError>;

#[tauri::command]
pub async fn connect(
    state: tauri::State<'_, AppState>,
    id: Uuid,
) -> Result<ServerInfo, AppError>;

#[tauri::command]
pub async fn disconnect(
    state: tauri::State<'_, AppState>,
    id: Uuid,
) -> Result<(), AppError>;
```

---

## 4. SQL 编辑器与查询执行模块

### 4.1 模块职责

| 文件 | 职责 |
|------|------|
| `query/engine.rs` | 查询路由（SELECT → execute_query, DML/DDL → execute_update） |
| `query/result.rs` | QueryResult / UpdateResult 结构定义 |
| `query/cancel.rs` | KILL QUERY 机制 |
| `commands/query.rs` | IPC 命令：execute_query / execute_update / cancel_query / explain_query |

### 4.2 查询路由逻辑

```rust
fn classify_sql(sql: &str) -> SqlType {
    let first_word = sql.trim().split_whitespace().next()
        .map(|s| s.to_uppercase())
        .unwrap_or_default();
    
    match first_word.as_str() {
        "SELECT" | "SHOW" | "DESCRIBE" | "DESC" | "EXPLAIN" => SqlType::Query,
        _ => SqlType::Update,
    }
}
```

### 4.3 execute_query 流程

```
前端: invoke("execute_query", { connection_id, sql, limit = 1000 })
    │
    ▼
Rust: query::engine::execute_query(pool, sql, limit)
    │
    ├── 解析 SQL 类型（必须为 SELECT/SHOW/DESCRIBE/EXPLAIN）
    │
    ├── sqlx::query(&sql).fetch_all(&pool).await
    │
    ├── 统计返回行数
    │   ├── 行数 > limit ──► 截断，truncated = true
    │   └── 行数 ≤ limit ──► truncated = false
    │
    ├── 将 sqlx::Row 转换为 Vec<Vec<serde_json::Value>>
    │   ├── 数值型 ──► serde_json::Number
    │   ├── 字符串 ──► serde_json::String
    │   ├── NULL ──► serde_json::Null
    │   └── 二进制 ──► Base64 编码字符串（标记类型）
    │
    └── 返回 QueryResult { columns, rows, total_count, truncated, elapsed_ms }
```

### 4.4 execute_update 流程

```
前端: invoke("execute_update", { connection_id, sql })
    │
    ▼
Rust: query::engine::execute_update(pool, sql)
    │
    ├── sqlx::query(&sql).execute(&pool).await
    │
    └── 返回 UpdateResult { rows_affected, last_insert_id, elapsed_ms }
```

### 4.5 查询取消机制

```rust
// query/cancel.rs

pub async fn cancel_query(pool: &MySqlPool, target_thread_id: u64) -> Result<(), AppError> {
    let kill_sql = format!("KILL QUERY {}", target_thread_id);
    sqlx::query(&kill_sql).execute(pool).await
        .map_err(|e| AppError::QueryFailed(format!("KILL QUERY 失败: {}", e)))?;
    Ok(())
}
```

前端取消流程：
1. 执行查询前，通过 `SELECT CONNECTION_ID()` 获取当前线程 ID
2. 前端展示 Cancel 按钮，绑定 `thread_id`
3. 用户点击 Cancel ──► 调用 `cancel_query(connection_id, thread_id)`
4. Rust 在新连接上执行 `KILL QUERY <thread_id>`
5. 原查询的 `fetch_all` 返回 `MySqlError: query execution was interrupted`
6. 前端捕获错误，标记状态为 `cancelled`

### 4.6 EXPLAIN 可视化

```
用户点击 Explain 按钮
    │
    ▼
前端自动在 SQL 前追加 "EXPLAIN "（如已是 EXPLAIN 则不追加）
    │
    ▼
invoke("execute_query", { sql: "EXPLAIN " + original_sql, limit: 1000 })
    │
    ▼
Rust 正常执行 SELECT 式查询，返回结果集
    │
    ▼
前端 ExplainVisualizer 组件渲染：
    ├── 表格展示各列（id, select_type, table, type, key, rows, Extra）
    ├── type = "ALL"（全表扫描）──► 标红
    ├── type = "index" / "range" / "ref" / "eq_ref" / "const" ──► 标绿
    └── Extra 含 "Using filesort" / "Using temporary" ──► 标黄警告
```

### 4.7 IPC 命令

```rust
#[tauri::command]
pub async fn execute_query(
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
    sql: String,
    limit: Option<u32>,
) -> Result<QueryResult, AppError>;

#[tauri::command]
pub async fn execute_update(
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
    sql: String,
) -> Result<UpdateResult, AppError>;

#[tauri::command]
pub async fn cancel_query(
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
    thread_id: u64,
) -> Result<(), AppError>;
```

---

## 5. 结果网格模块

### 5.1 模块职责

纯前端模块，无 Rust 后端参与。

| 文件 | 职责 |
|------|------|
| `components/grid/ResultGrid.tsx` | AG Grid 包装组件 |
| `components/grid/ExportButton.tsx` | 导出功能（CSV/JSON/Excel） |

### 5.2 AG Grid 配置

```typescript
const gridOptions: GridOptions = {
  rowModelType: 'clientSide',
  rowData: result.rows,
  columnDefs: result.columns.map(col => ({
    field: col.name,
    headerName: col.name,
    headerTooltip: `${col.name} (${col.dataType})`,
    autoWidth: true,
    filter: getFilterType(col.dataType),
    sortable: true,
  })),
  rowBuffer: 10,
  pagination: false,
  suppressRowClickSelection: true,
};

function getFilterType(dataType: string): string {
  if (dataType.includes('INT') || dataType.includes('FLOAT') || dataType.includes('DECIMAL')) {
    return 'agNumberColumnFilter';
  }
  if (dataType.includes('DATE') || dataType.includes('TIME')) {
    return 'agDateColumnFilter';
  }
  return 'agTextColumnFilter';
}
```

### 5.3 数据导出流程

```
用户点击导出按钮，选择格式
    │
    ├── CSV ──► 前端直接生成 Blob，触发下载
    │   └── AG Grid api.getDataAsCsv({ onlySelected: false, columnKeys: visibleColumns })
    │
    ├── JSON ──► 前端 JSON.stringify(rowData)，触发下载
    │
    └── Excel (xlsx) ──► invoke("export_to_excel", { connection_id, sql, format: "xlsx" })
        │
        ▼
        Rust 端流式执行查询，逐行写入 xlsx 文件
        │
        ▼
        返回文件路径，前端通过 Tauri fs API 读取并触发下载
```

---

## 6. Schema 浏览器模块

### 6.1 模块职责

| 文件 | 职责 |
|------|------|
| `schema/cache.rs` | L1 内存缓存（DashMap） |
| `schema/disk.rs` | L2 磁盘缓存（JSON 文件） |
| `schema/model.rs` | Schema 数据结构 |
| `drivers/mysql/metadata.rs` | MySQL Schema 采集实现 |
| `commands/schema.rs` | IPC 命令 |

### 6.2 缓存键设计

```rust
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct CacheKey {
    conn_id: Uuid,
    db: String,
    obj_type: ObjectType,
    obj_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum ObjectType {
    Database,
    Table,
    Column,
    Index,
    ForeignKey,
    Trigger,
    CreateTableSql,
}

#[derive(Debug, Clone)]
struct CachedValue {
    data: serde_json::Value,
    cached_at: chrono::DateTime<chrono::Utc>,
}

impl CachedValue {
    fn is_expired_l1(&self) -> bool {
        self.cached_at < chrono::Utc::now() - chrono::Duration::minutes(5)
    }
    
    fn is_expired_l2(&self) -> bool {
        self.cached_at < chrono::Utc::now() - chrono::Duration::hours(1)
    }
}
```

### 6.3 缓存读取流程

```
get_schema(connection_id, database, object_type, object_name)
    │
    ├── L1 查找 (DashMap)
    │   ├── 命中且未过期 ──► 直接返回
    │   └── 命中但过期 / 未命中 ──► 继续 L2
    │
    ├── L2 查找 (磁盘 JSON)
    │   ├── 命中且未过期 ──► 加载到 L1，返回
    │   └── 命中但过期 / 未命中 ──► 继续数据库
    │
    ├── 数据库查询 (DatabaseMetadata Trait)
    │   └── 写入 L1 + L2，返回
```

### 6.4 缓存失效策略

```rust
pub fn invalidate_connection(&self, conn_id: &Uuid) {
    self.l1.retain(|key, _| key.conn_id != *conn_id);
    self.l2.remove_dir_all(format!("{}/{}", self.base_path, conn_id))?;
}

pub fn invalidate_database(&self, conn_id: &Uuid, db: &str) {
    self.l1.retain(|key, _| !(key.conn_id == *conn_id && key.db == db));
}

pub fn invalidate_on_ddl(&self, conn_id: &Uuid, sql: &str) {
    let sql_upper = sql.to_uppercase();
    if sql_upper.contains("CREATE") 
        || sql_upper.contains("ALTER") 
        || sql_upper.contains("DROP")
        || sql_upper.contains("RENAME")
        || sql_upper.contains("TRUNCATE") {
        self.invalidate_connection(conn_id);
    }
}
```

### 6.5 Schema 采集 SQL（MySQL）

```sql
-- 数据库列表
SELECT schema_name AS name, default_character_set_name AS charset, 
       default_collation_name AS collation
FROM information_schema.schemata
WHERE schema_name NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys');

-- 表列表
SELECT table_name AS name, engine, table_rows AS rows,
       ROUND(data_length / 1024 / 1024, 2) AS size_mb, table_comment AS comment
FROM information_schema.tables
WHERE table_schema = ? AND table_type = 'BASE TABLE';

-- 字段列表
SELECT column_name, ordinal_position, data_type, is_nullable,
       column_key, extra, column_default, column_comment, character_maximum_length
FROM information_schema.columns
WHERE table_schema = ? AND table_name = ?;

-- 索引列表
SELECT index_name, column_name, non_unique, index_type
FROM information_schema.statistics
WHERE table_schema = ? AND table_name = ?;

-- 外键列表
SELECT constraint_name, column_name, referenced_table_name, referenced_column_name,
       update_rule, delete_rule
FROM information_schema.referential_constraints rc
JOIN information_schema.key_column_usage kcu 
    ON rc.constraint_name = kcu.constraint_name
WHERE rc.constraint_schema = ? AND rc.table_name = ?;

-- 触发器列表
SELECT trigger_name, event_manipulation, action_timing, action_statement
FROM information_schema.triggers
WHERE event_object_schema = ? AND event_object_table = ?;

-- CREATE TABLE SQL
SHOW CREATE TABLE `db`.`table`;
```

### 6.6 IPC 命令

```rust
#[tauri::command]
pub async fn get_databases(
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
) -> Result<Vec<Database>, AppError>;

#[tauri::command]
pub async fn get_tables(
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
    database: String,
) -> Result<Vec<Table>, AppError>;

#[tauri::command]
pub async fn get_table_details(
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
    database: String,
    table: String,
) -> Result<TableDetails, AppError>;

#[tauri::command]
pub async fn refresh_schema(
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
    database: Option<String>,
) -> Result<(), AppError>;

#[tauri::command]
pub async fn search_schema(
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
    keyword: String,
) -> Result<Vec<SearchResult>, AppError>;
```

---

## 7. 数据工具模块

### 7.1 模块职责

| 文件 | 职责 |
|------|------|
| `components/drawer/TableStructureDrawer.tsx` | 表结构详情抽屉 |

### 7.2 表结构查看

右键点击 Schema 树中的表节点，选择 "View Structure"：

```
前端: invoke("get_table_details", { connection_id, database, table })
    │
    ▼
Rust: 返回 TableDetails（columns, indexes, foreign_keys, triggers, create_table_sql）
    │
    ▼
前端: 右侧滑出 TableStructureDrawer，展示：
    ├── Columns 标签页（VirtualList）
    ├── Indexes 标签页（VirtualList）
    ├── Foreign Keys 标签页（VirtualList）
    ├── Triggers 标签页（VirtualList）
    └── CREATE TABLE SQL（只读编辑器）
```

---

## 8. 命令面板模块

### 8.1 设计

纯前端模块，无 Rust 后端参与。

| 文件 | 职责 |
|------|------|
| `components/command-palette/CommandPalette.tsx` | 命令面板弹窗 |
| `hooks/useCommandPalette.ts` | 命令注册与快捷键绑定 |

### 8.2 命令注册表

```typescript
interface Command {
  id: string;
  title: string;
  category: string;
  shortcut?: string;
  icon?: string;
  action: () => void;
}

const commands: Command[] = [
  { id: 'conn.new', title: 'New Connection', category: 'Connection', action: () => openConnectionDialog() },
  { id: 'query.new', title: 'New Query', category: 'Query', shortcut: 'Ctrl+T', action: () => queryStore.newTab() },
  { id: 'query.execute', title: 'Execute Query', category: 'Query', shortcut: 'Ctrl+Enter', action: () => executeCurrentQuery() },
  { id: 'query.format', title: 'Format SQL', category: 'Query', shortcut: 'Shift+Alt+F', action: () => formatSql() },
  { id: 'view.sidebar', title: 'Toggle Sidebar', category: 'View', shortcut: 'Ctrl+B', action: () => layoutStore.toggleSidebar() },
  { id: 'view.explain', title: 'Explain Query', category: 'View', action: () => explainCurrentQuery() },
  { id: 'settings.open', title: 'Open Settings', category: 'Settings', shortcut: 'Ctrl+,', action: () => openSettings() },
  { id: 'theme.toggle', title: 'Toggle Theme', category: 'Settings', action: () => uiStore.toggleTheme() },
];
```

### 8.3 交互流程

```
用户按下 Ctrl+K（或 Cmd+K）
    │
    ▼
命令面板弹窗打开，输入框获得焦点
    │
    ▼
用户输入关键词，VirtualList 实时过滤并高亮匹配字符
    │
    ├── 上下箭头选择
    ├── Enter 执行
    └── Esc 关闭
```

---

## 9. 设置模块

### 9.1 设计

设置分为两层持久化：
- **应用级设置**: 存储在 `settings.json`（`{app_data}/settings.json`）
- **连接级设置**: 存储在 `connections.json` 的各连接配置中

### 9.2 设置数据结构

```typescript
export interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  language: 'en' | 'zh';
  editor: {
    tabSize: 2 | 4 | 8;
    fontSize: number;
    vimMode: boolean;
    autoComplete: boolean;
    wordWrap: boolean;
  };
  query: {
    defaultLimit: number;
    cancelOnNavigate: boolean;
  };
  performance: {
    connectionTimeoutSecs: number;
    schemaCacheTtlSecs: number;
    maxPoolSize: number;
  };
}
```

### 9.3 设置面板

以弹窗/抽屉形式打开，修改即时生效：
- 主题切换：修改 `data-theme` 属性，CodeMirror + AG Grid 同步适配
- 语言切换：react-i18next 切换 namespace
- 编辑器配置：CodeMirror 实例重配置

---

## 10. 错误码定义

### 10.1 Rust 错误枚举

```rust
#[derive(Debug, thiserror::Error, serde::Serialize)]
pub enum AppError {
    #[error("数据库连接失败: {0}")]
    ConnectionFailed(String),
    #[error("SQL 执行错误: {0}")]
    QueryFailed(String),
    #[error("查询已取消")]
    QueryCancelled,
    #[error("Schema 缓存未命中")]
    SchemaCacheMiss,
    #[error("密钥链操作失败: {0}")]
    KeyringError(String),
    #[error("配置读写失败: {0}")]
    ConfigError(String),
    #[error("无效的 SQL 类型: {0}")]
    InvalidSqlType(String),
    #[error("连接未找到: {0}")]
    ConnectionNotFound(String),
    #[error("驱动不支持: {0}")]
    DriverNotSupported(String),
    #[error("未知错误: {0}")]
    Unknown(String),
}
```

### 10.2 前端错误映射

```typescript
const errorMessages: Record<string, string> = {
  CONNECTION_FAILED: 'common.error.connectionFailed',
  QUERY_FAILED: 'common.error.queryFailed',
  QUERY_CANCELLED: 'common.error.queryCancelled',
  INVALID_SQL_TYPE: 'common.error.invalidSqlType',
  CONNECTION_NOT_FOUND: 'common.error.connectionNotFound',
};

function localizeError(error: { code: string; message: string }): string {
  const key = errorMessages[error.code];
  return key ? t(key) : error.message;
}
```

---

## 11. 前端状态流转汇总

### 11.1 Zustand Store 设计

```typescript
// stores/layoutStore.ts
interface LayoutState {
  sidebarVisible: boolean;
  sidebarWidth: number;
  sidebarView: 'connection' | 'schema';
  drawer: { type: 'tableStructure' | null; params?: Record<string, unknown> };
  toggleSidebar: () => void;
  openDrawer: (type: string, params?: Record<string, unknown>) => void;
  closeDrawer: () => void;
}

// stores/connectionStore.ts
interface ConnectionState {
  configs: ConnectionConfig[];
  activeId: string | null;
  statusMap: Record<string, ConnectionStatus>;
  serverInfoMap: Record<string, ServerInfo>;
  loadConfigs: () => Promise<void>;
  saveConfig: (config: ConnectionConfig) => Promise<void>;
  deleteConfig: (id: string) => Promise<void>;
  connect: (id: string) => Promise<void>;
  disconnect: (id: string) => Promise<void>;
}

// stores/queryStore.ts
interface QueryTab {
  id: string;
  name: string;
  sql: string;
  result?: QueryResult | UpdateResult;
  isExecuting: boolean;
  isCancelled: boolean;
  error?: string;
  selectedDatabase?: string;
}

interface QueryState {
  tabs: QueryTab[];
  activeTabId: string;
  newTab: () => void;
  closeTab: (id: string) => void;
  setTabSql: (id: string, sql: string) => void;
  execute: (id: string) => Promise<void>;
  cancel: (id: string) => Promise<void>;
}
```

### 11.2 关键交互时序

```
连接并执行查询的完整流程
═══════════════════════════════════════════════════════════════

用户                    Frontend                    Rust Backend
  │                         │                              │
  │ 点击 Connect            │                              │
  │────────────────────────>│                              │
  │                         │ invoke("connect", id)        │
  │                         │─────────────────────────────>│
  │                         │                              │
  │                         │                              ├── PoolManager.connect()
  │                         │                              ├── 预热 Schema 缓存（异步）
  │                         │                              │
  │                         │     ServerInfo               │
  │                         │<─────────────────────────────│
  │                         │                              │
  │ 状态变为 connected      │                              │
  │<────────────────────────│                              │
  │                         │                              │
  │ 输入 SQL，点击执行       │                              │
  │────────────────────────>│                              │
  │                         │ invoke("execute_query")      │
  │                         │─────────────────────────────>│
  │                         │                              │
  │                         │                              ├── 执行 SQL
  │                         │                              ├── 截断检查
  │                         │                              │
  │                         │     QueryResult              │
  │                         │<─────────────────────────────│
  │                         │                              │
  │ 展示结果网格            │                              │
  │<────────────────────────│                              │
```

---

## 12. 验收标准映射

| 需求编号 | 验收标准 | 对应设计章节 |
|----------|----------|-------------|
| FR-CM-01 ~ 04 | 连接 CRUD、安全存储、生命周期、列表 UI | §3 |
| FR-ED-01 ~ 05 | 多标签编辑器、CodeMirror、自动补全、执行控制、EXPLAIN | §4 |
| FR-RG-01 ~ 03 | AG Grid、导出、筛选排序 | §5 |
| FR-SB-01 ~ 04 | Schema 树、搜索、表结构、缓存 | §6 |
| FR-DT-01 ~ 02 | 数据生成器、表结构查看 | §7 |
| FR-CP-01 | 命令面板 | §8 |
| FR-ST-01 ~ 03 | 外观、编辑器、连接性能设置 | §9 |
