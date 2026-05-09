# DBDog 架构设计文档 (ADD)

> **版本**: 0.1.0  
> **状态**: 草案  
> **对应需求**: [REQUIREMENTS.md](./REQUIREMENTS.md)  
> **架构选型**: Tauri 2.x (Rust) + React/TypeScript

---

## 1. 架构总览

DBDog 采用 **Tauri 2.x + React/TypeScript** 的桌面端分层架构：

- **Frontend (WebView)**: React 18 + TypeScript，**UI 布局参考 Beekeeper Studio**（左侧 Sidebar + 中央 Editor/Grid + 底部 StatusBar），**编码思想贯彻 VS Code 虚拟化**（一切长列表虚拟渲染、一切面板按需挂载、一切状态延迟恢复）
- **Backend (Rust)**: Tauri 命令层 + 业务领域层，负责数据库连接池、SQL 执行、本地持久化
- **Native OS**: 通过 Tauri API 与 OS 密钥链、文件系统、窗口管理交互

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend Layer                        │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Toolbar                                                │ │
│  │  [Logo]  Connection: ▼  [New Query] [Save] [Settings]   │ │
│  └─────────────────────────────────────────────────────────┘ │
│  ┌──────────┬────────────────────────────────────────────────┤
│  │          │  ┌─────┬─────┬──────────────────────────────┐ │
│  │  Sidebar │  │ Tab1│ Tab2│  [x]                         │ │  ← Editor Tabs
│  │          │  ├─────┴─────┴──────────────────────────────┤ │
│  │  [Conn A]│  │                                            │ │
│  │  [Conn B]│  │           CodeMirror 6                     │ │  ← SQL Editor
│  │  ▼       │  │           (Viewport Render)                │ │
│  │  ├ db1   │  │                                            │ │
│  │  │ ├ tbl│  ├────────────────────────────────────────────┤ │
│  │  │ └ tbl│  │  AG Grid Community                           │ │  ← Result Grid
│  │  └ db2   │  │  (Virtual Scroll / Filter / Sort / Export)   │ │
│  │          │  │                                              │ │
│  │          │  └────────────────────────────────────────────┘ │
│  └──────────┴────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Status Bar                                             │ │
│  │  [MySQL 8.0] [test_db] [Rows: 1,000] [12ms] [Ln 4, Col]│ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌──────────────────────────────┬──────────────────────────┐ │
│  │                              │  Drawer / Modal          │ │  ← 表结构/ER图/健康
│  │     (背景遮罩时弹出)          │  (Lazy Mount)            │ │     监控等以抽屉
│  │                              │                          │ │     或弹窗形式打开
│  └──────────────────────────────┴──────────────────────────┘ │
│                                                              │
└─────────────────────────┬────────────────────────────────────┘
                          │ Tauri Commands (IPC)
┌─────────────────────────┼────────────────────────────────────┐
│                      Backend Layer                           │
│                         │                                    │
│  ┌──────────────────────┴──────────────────────┐            │
│  │           Tauri Command Router               │            │
│  │  (connection │ query │ schema)               │            │
│  └──────────────────────┬──────────────────────┘            │
│                         │                                    │
│  ┌────────────┬─────────┴──────────┬─────────────┐          │
│  │ Connection │   Query Engine     │   Schema    │          │
│  │  Manager   │   (Driver Trait)   │   Cache     │          │
│  └─────┬──────┘         │          └──────┬──────┘          │
│        │                │                 │                 │
│  ┌─────┴──────┐  ┌──────┴──────┐  ┌──────┴──────┐          │
│  │   Pool     │  │   MySQL     │  │  L1/L2      │          │
│  │  Manager   │  │   Driver    │  │   Cache     │          │
│  │ (DashMap)  │  │  (sqlx)     │  │ (DashMap/FS)│          │
│  └────────────┘  └─────────────┘  └─────────────┘          │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Persistence Layer                       │   │
│  │  connections.json  │  keyring          │            │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 技术栈选型

### 2.1 前端

| 类别 | 技术 | 版本 | 说明 |
|------|------|------|------|
| 框架 | React | 18.x | UI 渲染 |
| 语言 | TypeScript | 5.x | 类型安全 |
| 构建 | Vite | 5.x/6.x | Tauri 默认集成 |
| 状态管理 | Zustand | 4.x/5.x | 按领域拆分 store |
| 虚拟列表 | `@tanstack/react-virtual` | 3.x | 一切长列表虚拟化核心 |
| 路由 | TanStack Router | 1.x | 类型安全路由 |
| UI 组件 | shadcn/ui + Tailwind | 3.x | 基础组件库 |
| 编辑器 | CodeMirror 6 | 6.x | 自带 Viewport 渲染（虚拟化） |
| 数据网格 | AG Grid Community | 31.x+ | 虚拟滚动结果展示 |
| 图表 | @xyflow/react | 12.x | ER 图渲染（Phase 2+） |
| 国际化 | react-i18next | 14.x+ | 命名空间翻译 |
| SQL 格式化 | sql-formatter | 15.x+ | 编辑器美化 |

### 2.2 后端 (Rust)

| 类别 | Crate | 版本 | 说明 |
|------|-------|------|------|
| 桌面框架 | tauri | 2.x | 主进程 + IPC |
| 异步运行时 | tokio | 1.x | 异步 I/O |
| MySQL 驱动 | sqlx | 0.8.x | 异步、编译期检查 SQL |
| 连接池 | sqlx::Pool | - | 内置于 sqlx |
| 密钥链 | keyring | 3.x | 跨平台凭据存储 |
| 内存缓存 | dashmap | 6.x | 并发安全的 HashMap |
| 本地数据库 | rusqlite / sqlx | 0.32.x | 查询历史、书签持久化 |
| 序列化 | serde + serde_json | 1.x | 配置与协议序列化 |
| 错误处理 | thiserror + anyhow | 1.x | 结构化错误 vs 泛型错误 |
| 日志 | tracing + tracing-subscriber | 0.1.x | 结构化日志 |
| 时间 | chrono | 0.4.x | 时间戳处理 |

---

## 3. 目录结构

```
DBDog/
├── src/                          # 前端源码 (React + TypeScript)
│   ├── main.tsx                  # 入口
│   ├── App.tsx                   # 根组件
│   ├── layout/                   # 主布局骨架（参考 Beekeeper Studio）
│   │   ├── MainLayout.tsx        # 主布局：Sidebar + Editor/Grid + StatusBar
│   │   ├── Sidebar.tsx           # 左侧边栏（连接列表 + Schema 树，可折叠）
│   │   ├── EditorArea.tsx        # 中央编辑器区域（多标签 + 结果网格上下分割）
│   │   └── StatusBar.tsx         # 底部状态栏
│   ├── components/               # 通用组件
│   │   ├── ui/                   # shadcn/ui 组件
│   │   ├── virtual/              # 虚拟化组件层（VS Code 编码思想核心）
│   │   │   ├── VirtualList.tsx   # 基于 @tanstack/react-virtual 的通用虚拟列表
│   │   │   ├── VirtualTree.tsx   # 虚拟化树形组件（Schema 树）
│   │   │   └── LazyMount.tsx     # 懒加载/条件挂载包装器
│   │   ├── sidebar/              # Sidebar 内容面板
│   │   │   ├── ConnectionPanel.tsx    # 连接列表（VirtualList）
│   │   │   └── SchemaTreePanel.tsx    # Schema 树（VirtualTree）
│   │   ├── editor/               # SQL 编辑器
│   │   │   ├── SqlEditor.tsx     # CodeMirror 6 包装
│   │   │   └── EditorTabBar.tsx  # 标签栏
│   │   ├── grid/                 # 结果网格
│   │   │   └── ResultGrid.tsx    # AG Grid 包装
│   │   ├── drawer/               # 右侧抽屉/弹窗（表结构详情）
│   │   │   └── TableStructureDrawer.tsx  # 表结构详情抽屉
│   │   ├── statusbar/            # 状态栏部件
│   │   └── command-palette/      # 命令面板（Ctrl+K）
│   ├── pages/
│   │   └── MainPage.tsx          # 入口：渲染 MainLayout
│   ├── stores/                   # Zustand Stores
│   │   ├── layoutStore.ts        # 布局状态（Sidebar 折叠、抽屉显隐、尺寸）
│   │   ├── connectionStore.ts
│   │   ├── queryStore.ts
│   │   ├── schemaCacheStore.ts
│   │   └── uiStore.ts            # 主题、语言、全局状态
│   ├── hooks/
│   │   ├── useVirtualList.ts     # 虚拟列表 hook 封装
│   │   ├── useConnections.ts
│   │   ├── useQueryExecution.ts
│   │   ├── useSchema.ts
│   │   └── useCommandPalette.ts
│   ├── services/                 # Tauri IPC 调用封装
│   │   ├── connectionService.ts
│   │   ├── queryService.ts
│   │   ├── schemaService.ts

│   ├── types/
│   │   └── index.ts
│   └── lib/
│       ├── i18n.ts
│       └── utils.ts
├── src-tauri/                    # Tauri / Rust 源码
│   ├── src/
│   │   ├── main.rs               # 入口，注册命令与状态
│   │   ├── lib.rs                # 模块导出（测试用）
│   │   ├── commands/             # Tauri IPC 命令处理器
│   │   │   ├── connection.rs
│   │   │   ├── query.rs
│   │   │   ├── schema.rs

│   │   ├── drivers/              # 数据库驱动抽象与实现
│   │   │   ├── mod.rs            # DatabaseDriver / DatabaseMetadata / DatabaseHealth Trait
│   │   │   └── mysql/
│   │   │       ├── driver.rs
│   │   │       ├── metadata.rs
│   │   │       └── health.rs
│   │   ├── connection/
│   │   │   ├── manager.rs        # PoolManager (DashMap<UUID, MySqlPool>)
│   │   │   ├── model.rs          # ConnectionConfig 结构
│   │   │   └── storage.rs        # connections.json 读写
│   │   ├── schema/
│   │   │   ├── cache.rs          # L1 DashMap 缓存
│   │   │   ├── disk.rs           # L2 磁盘缓存 (JSON)
│   │   │   └── model.rs          # Schema 数据结构
│   │   ├── query/
│   │   │   ├── engine.rs         # execute_query / execute_update 路由
│   │   │   ├── result.rs         # QueryResult / UpdateResult 结构
│   │   │   └── cancel.rs         # KILL QUERY 机制
│   │   ├── persistence/          # 本地持久化 (SQLite)
│   │   │   ├── db.rs             # SQLite 连接与迁移

│   │   ├── error.rs              # 全局错误类型 (AppError)
│   │   └── state.rs              # AppState (Tauri Managed State)
│   └── migrations/
│       └── 001_init.sql
├── docs/
│   ├── REQUIREMENTS.md
│   └── ARCHITECTURE.md           # 本文档
└── ...
```

---

## 4. UI 设计

### 4.1 布局（参考 Beekeeper Studio）

Beekeeper Studio 风格的三栏式布局，专注于数据库工具的高效操作流：

```
┌──────────────────────────────────────────────────────────────┐
│  Toolbar                                                     │
│  [Logo]  Connection: ▼  [New Query] [Save] [Settings]        │
├──────────┬───────────────────────────────────────────────────┤
│          │  ┌─────┬─────┬─────────────────────────────────┐ │
│  Sidebar │  │ Tab1│ Tab2│  [x]                            │ │  ← Editor Tabs
│          │  ├─────┴─────┴─────────────────────────────────┤ │
│  [Conn A]│  │                                               │ │
│  [Conn B]│  │              CodeMirror 6                     │ │  ← SQL Editor
│  ▼       │  │              (Viewport Render)                │ │
│  ├ db1   │  │                                               │ │
│  │ ├ tbl│  ├───────────────────────────────────────────────┤ │
│  │ └ tbl│  │  AG Grid Community                            │ │  ← Result Grid
│  └ db2   │  │  (Virtual Scroll / Filter / Sort / Export)    │ │
│          │  │                                               │ │
│          │  └───────────────────────────────────────────────┘ │
├──────────┴───────────────────────────────────────────────────┤
│  Status Bar                                                  │
│  [MySQL 8.0] [test_db] [Rows: 1,000] [12ms] [Ln 4, Col 15] │
└──────────────────────────────────────────────────────────────┘
```

**右侧抽屉 / 弹窗**（表结构详情等以覆盖层形式打开）：

```
┌────────────────────────────────┬───────────────────────────┐
│                                │  Drawer / Modal           │
│     Main Editor Area           │  ┌─────────────────────┐  │
│     (背景遮罩)                  │  │ Table Structure     │  │
│                                │  │ - Columns           │  │
│                                │  │ - Indexes           │  │
│                                │  │ - FKs               │  │
│                                │  └─────────────────────┘  │
│                                │  ┌─────────────────────┐  │
│                                │  │ ER Diagram          │  │
│                                │  │ (@xyflow/react)     │  │
│                                │  └─────────────────────┘  │
└────────────────────────────────┴───────────────────────────┘
```

#### 布局区域说明

| 区域 | 说明 | 交互 |
|------|------|------|
| **Toolbar** | 顶部工具栏，连接切换、新建查询、保存、设置入口 | 常驻 |
| **Sidebar** | 左侧可折叠边栏，上半为连接列表，下半为选中连接的 Schema 树 | 可折叠/调整宽度 |
| **Editor** | 中央上方，多标签 SQL 编辑器（CodeMirror 6） | 多 Tab，拖拽排序 |
| **Result Grid** | 中央下方，查询结果展示（AG Grid），与 Editor 上下可拖拽分割 | 与 Editor 分割比例可调 |
| **StatusBar** | 底部状态栏，连接状态、当前库、返回行数、执行耗时、光标位置 | 常驻 |
| **Drawer/Modal** | 表结构详情（右侧滑出） | 按需打开，关闭即卸载 |

### 4.2 虚拟化设计（VS Code 编码思想）

前端实现全面贯彻 VS Code 的虚拟化性能哲学：**视口即边界，不可见即不存在**。

#### 核心原则

1. **视口即边界**：任何超出视口的 DOM 节点不渲染，滚动时实时计算可见窗口
2. **面板按需挂载**：抽屉/弹窗关闭时从 React 树完全卸载（非 `display: none`），释放内存与事件监听
3. **状态延迟恢复**：面板重新可见时不阻塞主线程，优先渲染骨架屏，后台填充数据
4. **编辑器多 Group（未来）**：支持水平/垂直分栏，每个 Group 独立管理 Tab 与状态（VS Code 思想）

#### 虚拟化组件层

所有列表类组件统一基于 `@tanstack/react-virtual` 实现：

```typescript
// src/components/virtual/VirtualList.tsx
// 通用虚拟列表，支持固定/动态行高

interface VirtualListProps<T> {
  items: T[];
  rowHeight: number | ((item: T) => number);
  renderItem: (item: T, style: React.CSSProperties) => React.ReactNode;
  overscan?: number;        // 视口外预渲染行数（默认 5）
  scrollToIndex?: number;   // 定位到指定索引
}

// 使用场景：连接列表、历史记录、进程列表、状态变量列表
```

```typescript
// src/components/virtual/VirtualTree.tsx
// 虚拟化树形组件，支持展开/折叠、搜索过滤

interface VirtualTreeProps<T> {
  roots: TreeNode<T>[];
  getChildren: (node: T) => TreeNode<T>[];
  renderNode: (node: T, depth: number, style: React.CSSProperties) => React.ReactNode;
  expandedKeys: Set<string>;
  onToggle: (key: string) => void;
}

// 使用场景：Schema 树（千级数据库/万级表时的核心性能保障）
```

```typescript
// src/components/virtual/LazyMount.tsx
// 懒加载/条件挂载包装器

interface LazyMountProps {
  visible: boolean;
  keepAlive?: boolean;      // true: 首次挂载后隐藏但不卸载（类似 Vue keep-alive）
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

// 使用场景：抽屉内容、设置页（大数据量时释放内存）
```

#### 各区域虚拟化策略

| UI 区域 | 组件 | 虚拟化方案 | 说明 |
|---------|------|-----------|------|
| **Sidebar - 连接列表** | `VirtualList` | 固定行高 32px | 连接数通常 < 100，但为一致性统一虚拟化 |
| **Sidebar - Schema 树** | `VirtualTree` | 动态行高 24-28px | 千级库/万级表时的核心性能保障 |
| **Sidebar - 历史记录** | `VirtualList` | 固定行高 48px | 支持万级历史不卡顿 |
| **Sidebar - 书签树** | `VirtualTree` | 固定行高 28px | 文件夹 + 书签混合树 |
| **Editor - SQL 编辑器** | CodeMirror 6 | 内置 Viewport 渲染 | 百万行 SQL 仅渲染视口内行 |
| **Editor - 结果网格** | AG Grid Community | 内置虚拟滚动 | 后端截断 + 前端虚拟滚动双保险 |
| **Drawer - 进程列表** | `VirtualList` | 固定行高 32px | 实时刷新不造成 DOM 抖动 |
| **Drawer - 状态变量** | `VirtualList` | 固定行高 28px | 千级变量虚拟化 |

| **命令面板** | `VirtualList` | 固定行高 40px | 模糊搜索结果列表虚拟化 |

#### 抽屉/弹窗懒加载策略

采用严格的**条件挂载**策略，关闭时从 React 树完全移除：

```
用户打开表结构抽屉
    │
    ▼
layoutStore.openDrawer('tableStructure', { db, table })
    │
    ▼
TableStructureDrawer 挂载 ──► 渲染骨架屏 ──► 异步请求数据
    │
    ▼
数据到达 ──► 渲染 VirtualList ──► 用户可交互
    │
    ▼
用户点击关闭或点击遮罩
    │
    ▼
layoutStore.closeDrawer('tableStructure')
    │
    ▼
TableStructureDrawer 完全卸载（组件 destroy，释放内存）
```

对于需要保持状态的场景（如表结构抽屉中的滚动位置），使用 `keepAlive` 模式：首次挂载后隐藏但不卸载，内存中保留状态。

#### 编辑器多 Group 分栏（VS Code 思想，未来扩展）

中央编辑器区域预留分栏扩展能力：

- 支持多个 `EditorGroup`，可水平/垂直分割
- 每个 Group 独立维护 Tab 列表、当前激活 Tab、滚动位置
- 拖拽 Tab 可在 Group 之间移动，或新建 Group
- 分栏状态持久化到 `layoutStore`，重启后恢复

```typescript
// stores/layoutStore.ts

interface EditorGroup {
  id: string;
  tabs: QueryTab[];
  activeTabId: string;
}

interface LayoutState {
  // 分栏布局（未来扩展）
  groups: EditorGroup[];
  activeGroupId: string;
  splitDirection: 'horizontal' | 'vertical';
  
  // 可见性控制
  sidebarVisible: boolean;
  sidebarWidth: number;
  sidebarView: 'connection' | 'schema';
  
  // 抽屉
  drawer: {
    type: 'tableStructure' | null;
    params?: Record<string, unknown>;
  };
}
```

---

## 5. 核心模块设计

### 5.1 连接管理 (Connection Management)

#### 状态机

```
[disconnected] -- Connect --> [connecting] -- success --> [connected]
                                            -- failure --> [error]
[connected] -- Disconnect --> [disconnected]
[error] -- Retry / Edit --> [connecting]
```

#### PoolManager

- 使用 `DashMap<Uuid, MySqlPool>` 存储活跃连接池
- 同一 UUID 重复 `Connect` 时幂等：若池中已存在且未关闭，直接返回
- `Disconnect` 时从 DashMap 移除并调用 `pool.close()`

#### 密码生命周期

```
用户输入 ──► 前端 ──► IPC ──► Rust
                              │
                              ▼
                     keyring::set_password()  ──► OS 密钥链
                              │
                              ▼
                     ConnectionConfig 保存到 connections.json
                     （密码字段 #[serde(skip_serializing)]）
```

### 5.2 驱动抽象 (Driver Trait)

```rust
// src-tauri/src/drivers/mod.rs

#[async_trait]
pub trait DatabaseDriver: Send + Sync {
    async fn test(&self, config: &ConnectionConfig) -> Result<String, AppError>;
    async fn connect(&self, config: &ConnectionConfig) -> Result<Pool, AppError>;
    async fn execute_query(&self, pool: &Pool, sql: &str, limit: u32) -> Result<QueryResult, AppError>;
    async fn execute_update(&self, pool: &Pool, sql: &str) -> Result<UpdateResult, AppError>;
    async fn cancel_query(&self, pool: &Pool, thread_id: u64) -> Result<(), AppError>;
}

#[async_trait]
pub trait DatabaseMetadata: Send + Sync {
    async fn fetch_databases(&self, pool: &Pool) -> Result<Vec<Database>, AppError>;
    async fn fetch_tables(&self, pool: &Pool, db: &str) -> Result<Vec<Table>, AppError>;
    async fn fetch_columns(&self, pool: &Pool, db: &str, table: &str) -> Result<Vec<Column>, AppError>;
    async fn fetch_indexes(&self, pool: &Pool, db: &str, table: &str) -> Result<Vec<Index>, AppError>;
    async fn fetch_foreign_keys(&self, pool: &Pool, db: &str, table: &str) -> Result<Vec<ForeignKey>, AppError>;
    async fn fetch_triggers(&self, pool: &Pool, db: &str, table: &str) -> Result<Vec<Trigger>, AppError>;
    async fn fetch_create_table(&self, pool: &Pool, db: &str, table: &str) -> Result<String, AppError>;
}

#[async_trait]
pub trait DatabaseHealth: Send + Sync {
    async fn process_list(&self, pool: &Pool) -> Result<Vec<Process>, AppError>;
    async fn kill_process(&self, pool: &Pool, id: u64) -> Result<(), AppError>;
    async fn status_variables(&self, pool: &Pool) -> Result<Vec<StatusVar>, AppError>;
    async fn global_variables(&self, pool: &Pool) -> Result<Vec<Variable>, AppError>;
    async fn innodb_status(&self, pool: &Pool) -> Result<InnodbStatus, AppError>;
}
```

#### 扩展新数据库

新增数据库后端仅需三步：
1. 在 `src-tauri/src/drivers/` 下新建目录（如 `redis/`），实现上述三个 Trait
2. 在 `AppState` 初始化时注册 driver 实例
3. 前端连接对话框增加新数据库类型选项

### 5.3 Schema 缓存系统

#### 分层缓存

```
┌─────────────────────────────────────────┐
│              L1 内存缓存                 │
│    DashMap<CacheKey, CachedValue>       │
│    TTL: 5 min, 进程级共享                │
│                                         │
│    CacheKey = (connection_uuid, db,     │
│                 object_type, object_name)│
└─────────────────────────────────────────┘
                    │  miss
                    ▼
┌─────────────────────────────────────────┐
│              L2 磁盘缓存                 │
│    {app_data}/schema_cache/{conn_id}/   │
│    TTL: 1 hour                          │
│                                         │
│    文件: {db}_{type}_{name}.json        │
│    含 `cached_at` 时间戳                 │
└─────────────────────────────────────────┘
                    │  miss / expired
                    ▼
┌─────────────────────────────────────────┐
│              数据库查询                   │
│    通过 DatabaseMetadata Trait 实时获取  │
│    写入 L1 + L2                         │
└─────────────────────────────────────────┘
```

#### 缓存失效策略

| 触发条件 | 行为 |
|----------|------|
| 执行 DDL (CREATE/ALTER/DROP/RENAME/TRUNCATE) | 按 connection_uuid 精确失效对应连接的 L1 + L2 |
| 用户手动刷新 | 按库级别失效 |
| TTL 到期 | 首次访问时懒加载，后台不主动清理 |
| 应用启动 Connect | L2 数据自动预热到 L1 |

### 5.4 查询执行引擎

#### 执行路由

```
用户点击执行
    │
    ▼
前端分析 SQL 类型（首词匹配）
    │
    ├── SELECT / SHOW / EXPLAIN ──► invoke("execute_query")
    │                                 返回 QueryResult {
    │                                   columns: Vec<ColumnMeta>,
    │                                   rows: Vec<Vec<serde_json::Value>>,
    │                                   total_count: u64,
    │                                   truncated: bool,
    │                                   elapsed_ms: u64
    │                                 }
    │
    └── INSERT / UPDATE / DELETE / DDL ──► invoke("execute_update")
                                          返回 UpdateResult {
                                            rows_affected: u64,
                                            last_insert_id: Option<u64>,
                                            elapsed_ms: u64
                                          }
```

#### 查询取消机制

```
前端点击 Cancel
    │
    ▼
invoke("cancel_query", { connection_id, thread_id })
    │
    ▼
Rust 端执行独立的 KILL QUERY <thread_id>
    │
    ▼
原查询 sqlx 执行返回错误 (MySqlError: query interrupted)
    │
    ▼
前端捕获错误，状态标记为 cancelled
```

### 5.5 本地持久化 (SQLite)

#### 数据库文件

- 位置: `{app_data}/dbdog.db`
- 通过 `rusqlite` 或 `sqlx::SqlitePool` 访问
- 启动时自动执行 `migrations/` 下按版本排序的 SQL 脚本

#### 核心表结构（概要）

Phase 1 不依赖本地 SQLite 持久化（无历史记录、无书签）。未来 Phase 2+ 扩展时按需添加。

```sql
-- Phase 1 暂无本地表
-- Phase 2+ 将添加：query_history, bookmarks, bookmark_folders
```

---

## 6. 前端状态管理 (Zustand)

按领域拆分为多个独立 Store，避免单 Store 膨胀：

| Store | 职责 | 持久化 |
|-------|------|--------|
| `layoutStore` | 布局状态（Sidebar 折叠、抽屉显隐、分栏、尺寸） | 是（localStorage） |
| `connectionStore` | 连接列表、当前激活连接、连接状态 | 否（源数据来自 Rust） |
| `queryStore` | 各 Group 的 Tab 列表、SQL 文本、执行结果 | 否（内存级） |
| `schemaCacheStore` | Schema 树展开节点、搜索关键词、选中节点 | 否 |

| `uiStore` | 主题、语言、命令面板显隐、全局 Loading | 是（localStorage） |

### 状态流示例：执行查询

```
用户点击执行
    │
    ▼
queryStore.setTabExecuting(groupId, tabId, true)
    │
    ▼
queryService.execute(sql, connectionId, limit)
    │
    ▼
Tauri IPC ──► Rust 后端
    │
    ▼
queryStore.setTabResult(groupId, tabId, result)
queryStore.setTabExecuting(groupId, tabId, false)
    │
    ▼
// Phase 1 无历史记录功能，查询结果直接展示在 Tab 中
```

---

## 7. 数据流与 IPC 设计

### 7.1 IPC 命令清单

| 命名空间 | 命令 | 输入 | 输出 |
|----------|------|------|------|
| `connection` | `list_connections` | - | `Vec<ConnectionConfig>` |
| `connection` | `save_connection` | `ConnectionConfig` | `ConnectionConfig` |
| `connection` | `delete_connection` | `id: Uuid` | `()` |
| `connection` | `test_connection` | `ConnectionConfig` | `version: String` |
| `connection` | `connect` | `id: Uuid` | `ServerInfo` |
| `connection` | `disconnect` | `id: Uuid` | `()` |
| `query` | `execute_query` | `connection_id, sql, limit` | `QueryResult` |
| `query` | `execute_update` | `connection_id, sql` | `UpdateResult` |
| `query` | `cancel_query` | `connection_id, thread_id` | `()` |
| `query` | `explain_query` | `connection_id, sql` | `ExplainResult` |
| `schema` | `get_databases` | `connection_id` | `Vec<Database>` |
| `schema` | `get_tables` | `connection_id, db` | `Vec<Table>` |
| `schema` | `get_table_details` | `connection_id, db, table` | `TableDetails` |
| `schema` | `refresh_schema` | `connection_id, db?` | `()` |
| `schema` | `search_schema` | `connection_id, keyword` | `Vec<SearchResult>` |


### 7.2 事件（前端订阅）

Tauri `Event` 用于后端主动推送到前端：

| 事件名 | 触发场景 | 载荷 |
|--------|----------|------|
| `schema:changed` | 执行 DDL 后 | `{ connection_id, database }` |
| `connection:status` | 连接状态变更 | `{ connection_id, status }` |

---

## 8. 安全设计

### 8.1 密码零明文

```
前端输入 ──► Rust 接收 ──► OS keyring (内存中不落盘)
                              │
                              ▼
                     connections.json (无 password 字段)
```

- 密码字段在 `ConnectionConfig` 中使用 `#[serde(skip_serializing)]`
- 读取配置时，通过 `keyring::get_password(service, username)` 从 OS 密钥链取回
- 日志中任何 `Debug` 输出需手动屏蔽密码字段

### 8.2 SQL 注入防护

- **后端**: 所有动态查询均使用 sqlx 参数化查询，禁止字符串拼接 SQL
- **前端**: 用户输入的 SQL 直接透传给 `execute_query` / `execute_update`，不做解析或改写（除 `EXPLAIN` 前缀追加外）

### 8.3 AG Grid 许可合规

- 仅引入 `ag-grid-community`，不安装 `ag-grid-enterprise`
- 禁用所有 Enterprise 特性：Server-Side Row Model、Row Grouping、Advanced Filter 等
- 功能开关统一在 `GridOptions` 中显式声明为 Community 级别

---

## 9. 性能策略

### 9.1 前端虚拟化性能

| 场景 | 策略 |
|------|------|
| Schema 树（万级节点） | `VirtualTree` 仅渲染视口内节点，展开/折叠仅更新可见窗口 |
| 历史记录（万级条目） | `VirtualList` + 分页加载，滚动到底部时自动加载下一页 |
| 进程列表（实时刷新） | `VirtualList` + `overscan=3`，数据更新时仅重渲染变更行（key 稳定） |
| 结果网格（百万级后端截断） | AG Grid 虚拟滚动 + 后端默认 limit=1000，前端无压力 |
| 表结构抽屉 | `LazyMount` 关闭即卸载，保持内存干净 |
| 命令面板（千级命令） | `VirtualList` 模糊搜索后虚拟渲染匹配结果 |
| 面板切换 | `LazyMount` 默认完全卸载，需要保状态的用 `keepAlive` |
| 编辑器分栏 | 关闭 Group 时所有 Tab 组件卸载，释放 CodeMirror 实例 |

### 9.2 大结果集处理

| 场景 | 策略 |
|------|------|
| 查询返回 > limit (默认 1000) | 后端截断，标记 `truncated = true`，仅传输 limit 行到前端 |
| AG Grid 渲染 | 虚拟滚动，DOM 仅渲染视口内行 |
| 导出大结果集 | 后端流式写入文件，前端下载，不走内存全量加载 |
| 前端结果存储 | 使用 Zustand 存储 JSON 数组，超过 10 万行时建议用户导出而非展示 |

### 9.3 Schema 加载优化

- Connect 成功后异步预热 Schema（不阻塞 UI）
- 树形导航采用懒加载：展开数据库节点时才请求表列表
- L1 缓存命中时，千级表展开 < 100ms

### 9.4 启动优化

- Vite 代码分割：按路由/功能懒加载组件
- Tauri 启用 `withGlobalTauri: false`，按需注入 API
- SQLite 迁移脚本版本化，仅执行未应用的迁移
- 布局状态从 localStorage 恢复，优先渲染骨架屏

---

## 10. 错误处理规范

### 10.1 Rust 后端

```rust
// src-tauri/src/error.rs

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
    #[error("未知错误: {0}")]
    Unknown(String),
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where S: serde::Serializer {
        serializer.serialize_str(self.to_string().as_ref())
    }
}
```

- Tauri command 统一返回 `Result<T, AppError>`
- 前端通过 `.catch()` 或 `try/catch` 统一处理，展示 `error.message`

### 10.2 前端错误边界

- React Error Boundary 包裹 `EditorArea` 和 `Sidebar`，防止单区域崩溃影响全局
- 查询执行错误在 Tab 内展示，不影响其他 Group/Tab

---

## 11. 国际化 (i18n)

### 命名空间设计

```
public/locales/
├── en/
│   ├── common.json       # 通用词汇 (保存、取消、删除...)
│   ├── connections.json  # 连接管理
│   ├── editor.json       # SQL 编辑器
│   ├── query.json        # 查询结果、执行
│   ├── schema.json       # Schema 浏览器
│   ├── query.json        # 查询结果
│   └── settings.json     # 设置
└── zh/  (同上结构)
```

- 后端错误消息统一返回英文，前端按 `error.code` 映射到本地化文案
- 日期时间存储 RFC3339，前端 `Intl.DateTimeFormat` 按 locale 渲染

---

## 12. 测试策略

| 层级 | 范围 | 工具 |
|------|------|------|
| 单元测试 | Rust Driver Trait 实现、缓存逻辑、工具函数 | `cargo test` |
| 集成测试 | Tauri command 端到端（内存 SQLite + sqlx test pool） | `cargo test` + `sqlx::test` |
| 前端组件测试 | React 组件渲染与交互 | Vitest + React Testing Library |
| E2E 测试 | 完整用户流程（连接 → 查询 → 导出） | Playwright / WebdriverIO |

---

## 13. 演进路线

| 阶段 | 架构变化 |
|------|----------|
| **Phase 1 (MySQL)** | 当前架构完全适用，MySQL Driver 作为 Trait 唯一实现 |
| **Phase 2 (Memcached)** | 新增 `MemcachedDriver` 实现 `DatabaseDriver`；前端新增 Key-Value 专属视图组件（轻量验证 Driver Trait 抽象） |
| **Phase 3 (Redis/ZK)** | 新增 `RedisDriver` 实现，Redis 丰富数据类型（String/Hash/List/Set/ZSet）需要更复杂的前端组件；评估是否需要新增 Trait（如 `DatabaseKeyValue`） |
| **未来 (插件系统)** | Driver 动态加载：Rust 侧支持动态库 (.so/.dll/.dylib) 注册，或 WASM 插件沙箱 |
