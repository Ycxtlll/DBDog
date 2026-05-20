# DBDog 项目开发准则

> 本文件面向所有参与 DBDog 开发的 AI Agent 与人工开发者。
> 技术栈：Tauri 2.x (Rust) + React/TypeScript

---

## 1. AI Agent 核心行为准则 (Karpathy Guidelines)

以下准则优先于一切其他规则。当其他规则与本节冲突时，以本节为准。

### 1.1 Think Before Coding

- 不要假设。如果不确定，先问清楚再动手。
- 如果有多种理解方式，列出它们让用户选择，不要默默猜测。
- 如果存在更简单的方案，必须明确提出。
- 遇到不清楚的地方，停下来，明确指出哪里不清楚，然后询问。

### 1.2 Simplicity First

- 只实现被明确要求的功能，不做任何推测性扩展。
- 不要为只使用一次的代码创建抽象。
- 不要添加未被要求的"灵活性"或"可配置性"。
- 不要为不可能发生的场景写错误处理。
- 如果写了 200 行而 50 行就能搞定，重写它。
- 自问："资深工程师会觉得这过度设计吗？" 如果是，简化。

### 1.3 Surgical Changes

- 只修改必须修改的代码。不要"顺手改进"相邻代码、注释或格式。
- 不要重构没有坏掉的东西。
- 必须匹配现有代码风格，即使你自己会写得不一样。
- 如果发现不相关的死代码，可以提及，但不要删除——除非用户要求。
- 你的变更导致的孤儿代码（无用 import / 变量 / 函数）必须清理掉。
- 检验标准：每一行变更都必须能直接追溯到用户的请求。

### 1.4 Goal-Driven Execution

- 将模糊任务转化为可验证的目标：
  - "Add validation" → "Write tests for invalid inputs, then make them pass"
  - "Fix the bug" → "Write a test that reproduces it, then make it pass"
  - "Refactor X" → "Ensure tests pass before and after"
- 多步骤任务开始前，先列出简要计划：

  ```text
  1. [Step] → verify: [check]
  2. [Step] → verify: [check]
  3. [Step] → verify: [check]
  ```

- 定义明确的成功标准后再开始编码，避免"让它能跑就行"的模糊目标。

---

## 2. 通用开发准则

### 2.1 设计原则 (SOLID)

- **单一职责 (SRP)**: 每个模块、函数、组件只做一件事。函数超过 50 行必须考虑拆分。
- **开闭原则 (OCP)**: 对扩展开放，对修改关闭。新增数据库后端时，不应修改现有 Driver 的代码。
- **里氏替换 (LSP)**: Trait/Interface 的实现必须可互相替换，不破坏调用方。
- **接口隔离 (ISP)**: 不把不相关的方法塞进同一个 Trait/Interface。Rust 侧已拆分为 `DatabaseDriver` / `DatabaseMetadata` / `DatabaseHealth`。
- **依赖倒置 (DIP)**: 高层模块依赖抽象（Trait/Interface），不依赖具体实现。

### 2.2 代码整洁

- **DRY**: 禁止复制粘贴超过 3 行的重复代码。提取为公共函数/宏/Hook。
- **KISS**: 优先简单方案。能用标准库不用第三方，能用组合不用继承。
- **显式优于隐式**: 类型标注完整，魔法值必须提取为常量/枚举，异步操作必须显式 `await`/`async`。
- **自解释命名**: 变量名即注释。禁止 `a`, `b`, `tmp`, `data1` 等无意义命名。

### 2.3 文件与模块组织

- **单一文件职责**: 一个文件只包含一个主要概念（一个 React 组件、一个 Rust 模块、一个 Trait 实现）。
- **目录深度不超过 4 层**: 过深的嵌套意味着模块边界需要重新设计。
- **公共 API 收敛**: 每个目录的 `mod.rs` / `index.ts` 是唯一的公共出口，禁止跨目录直接引用内部文件。

### 2.4 行业标准与禁止野路子

- **行业标准优先**: 所有实现必须优先采用所在技术栈的社区标准、官方推荐方案或经过广泛验证的设计模式。禁止为图省事而采用临时性、非标准的权宜之计。
- **禁止野路子代码**: 严禁任何形式的"野路子"（hacky / workaround）代码行为，包括但不限于：
  - 为绕过架构限制而写的临时补丁，而非修复根本问题；
  - 使用 `as any` / `@ts-ignore` / 裸 `unwrap()` / `std::mem::transmute` 等危险操作规避类型系统或错误处理；
  - 通过字符串拼接构造 SQL、IPC 协议或文件路径；
  - 在代码中硬编码环境相关的魔法值、路径或凭据；
  - 复制粘贴代码而不提取公共抽象；
  - 用 `setTimeout` / `thread::sleep` 等延迟手段掩盖竞态条件或时序问题；
  - 在 React 渲染阶段执行副作用、直接修改 DOM 绕过 React 生命周期；
  - 绕过已定义的抽象层直接调用底层 API。
- **技术债务零容忍**: 不得以"先上线后重构"为借口提交野路子代码。所有已识别的技术债务必须在合并前解决，或经团队评审后纳入有明确截止日期的 Issue 跟踪。
- **评审红线**: Code Review 中一旦发现野路子代码，无论功能是否通过测试，一律视为阻塞性意见（Blocking Comment），必须修正后方可合并。

---

## 3. 接口兼容性

### 3.1 向后兼容 (Backward Compatibility)

- **IPC 协议**:
  - Tauri Command 的输入/输出结构一旦发布，字段只能新增（`Option<T>`），不能删除或修改类型。
  - **字段命名**: IPC 结构体的 JSON 字段名必须统一使用 camelCase。Rust 侧通过 `#[serde(rename_all = "camelCase")]` 保证；TypeScript 侧通过接口定义保证。新增 IPC 结构体时必须显式声明该属性，Code Review 时作为强制检查项。
- **配置文件**: `connections.json` 的结构变更必须提供迁移逻辑，旧配置必须能无损读取。
- **SQLite Schema**: 表结构变更通过版本化迁移脚本（`migrations/00N_xxx.sql`）管理，禁止直接修改已有迁移。
- **枚举扩展**: 新增枚举变体时，旧前端必须能安全忽略（使用 `#[serde(other)]` 或 `Option` 兜底）。

### 3.2 版本控制 (SemVer)

- 破坏性变更必须升级 **MAJOR** 版本
- 新增功能（兼容）升级 **MINOR** 版本
- Bug 修复升级 **PATCH** 版本
- 所有变更必须记录到 `CHANGELOG.md`

### 3.3 弃用策略

- 废弃的 API/字段必须保留至少一个 **MINOR** 版本周期
- 必须标注 `#[deprecated]` / `@deprecated` 并说明替代方案
- 禁止在废弃字段仍被使用的情况下直接删除

---

## 4. 前端开发规范 (src/)

### 4.1 技术栈约束

- **框架**: React 18+（函数组件 + Hooks）
- **语言**: TypeScript（`strict: true`）
- **状态**: Zustand（按领域拆分）
- **样式**: Tailwind CSS + shadcn/ui
- **虚拟化**: `@tanstack/react-virtual`（所有长列表）
- **构建**: Vite

禁止引入未在架构文档中列出的新框架（如 Redux、MobX、Emotion 等）。

### 4.2 代码风格

- **格式化**: Prettier 标准配置，提交前必须格式化
- **Lint**: ESLint + `@typescript-eslint/recommended`，禁止 `any`，禁止隐式 `null`
- **命名**:
  - 类型/接口/枚举: `PascalCase`
  - 函数/变量: `camelCase`
  - 常量: `SCREAMING_SNAKE_CASE`
  - 组件文件: `PascalCase.tsx`
  - Hook: `useXxx.ts`
- **类型严格**: `strict: true`，禁止 `@ts-ignore`，允许 `@ts-expect-error` 但必须说明原因
- **组件**:
  - 优先函数组件 + Hooks
  - Props 必须显式接口定义，禁止 `props: any`
  - 副作用必须集中在 `useEffect` 中，禁止在渲染阶段执行副作用
- **状态管理**:
  - Zustand Store 按领域拆分，禁止单 Store 超过 15 个字段
  - Store 更新必须是不可变更新（immer 可选）
  - 跨 Store 通信通过事件或 Hook 组合，禁止直接引用其他 Store

### 4.3 组件设计

#### 组件分类

| 类型 | 位置 | 职责 | 示例 |
|------|------|------|------|
| **Layout** | `layout/` | 页面骨架，不处理业务逻辑 | `MainLayout`, `Sidebar`, `EditorArea` |
| **Page** | `pages/` | 路由级页面，组合 Layout 和 Components | `MainPage` |
| **Feature** | `components/{feature}/` | 业务领域组件，可复用 within 领域 | `SqlEditor`, `ResultGrid` |
| **UI** | `components/ui/` | 原子级基础组件，纯展示 | `Button`, `Dialog`, `Input`（shadcn/ui） |
| **Virtual** | `components/virtual/` | 虚拟化基础设施 | `VirtualList`, `VirtualTree`, `LazyMount` |

#### 组件文件结构

```tsx
// 顺序：imports → types → component → styles（Tailwind）

import { useState } from 'react';
import type { QueryResult } from '@/types';

interface ResultGridProps {
  data: QueryResult;
  onRowClick?: (row: Record<string, unknown>) => void;
}

export function ResultGrid({ data, onRowClick }: ResultGridProps) {
  // ...
}
```

- Props 接口必须显式命名（`XxxProps`），禁止内联 `({ data }: { data: T })`
- 一个文件一个组件，文件名为组件名（`PascalCase.tsx`）
- 副作用必须用 `useEffect`，禁止在渲染阶段调用 API 或修改 DOM

#### 虚拟化强制规范

以下场景**必须**使用虚拟化，无例外：

| 场景 | 组件 | 预估阈值 |
|------|------|---------|
| Schema 树 | `VirtualTree` | > 50 个节点 |
| 历史记录列表 | `VirtualList` | > 30 条 |
| 进程列表 | `VirtualList` | > 20 条 |
| 状态变量列表 | `VirtualList` | > 50 条 |
| 命令面板结果 | `VirtualList` | 永远使用 |
| 结果网格 | AG Grid Virtual | 永远使用 |

### 4.4 状态管理

#### Store 拆分

```
stores/
├── layoutStore.ts       # 布局状态（Sidebar/Panel/Group 可见性、尺寸）
├── connectionStore.ts   # 连接数据与状态
├── queryStore.ts        # 编辑器 Tab、SQL、结果
├── schemaCacheStore.ts  # Schema 树展开、搜索、选中
├── historyStore.ts      # 历史记录、书签
└── uiStore.ts           # 主题、语言、全局 Loading
```

- 禁止新增未规划的 Store
- 禁止 Store 之间直接引用（如 `connectionStore` 直接调用 `queryStore` 的方法）
- 跨 Store 通信通过 Hook 组合或事件回调

#### Store 实现模板

```typescript
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

interface UiState {
  theme: 'light' | 'dark';
  language: 'en' | 'zh';
  setTheme: (theme: UiState['theme']) => void;
}

export const useUiStore = create<UiState>()(
  immer((set) => ({
    theme: 'light',
    language: 'en',
    setTheme: (theme) => set((state) => { state.theme = theme; }),
  }))
);
```

- 使用 `immer` 保证不可变更新
- Selector 必须精确，避免 `const state = useUiStore()` 导致全量监听

```typescript
// ✅ 正确：精确订阅
const theme = useUiStore((s) => s.theme);

// ❌ 错误：导致所有 uiStore 变更都触发重渲染
const { theme, language } = useUiStore();
```

### 4.5 Hook 规范

- 必须以 `use` 开头：`useQueryExecution`, `useVirtualList`
- 文件名为 Hook 名：`useQueryExecution.ts`
- 一个 Hook 封装一个关注点
- 禁止 Hook 内部直接调用 IPC，必须通过 `services/` 层封装
- 异步操作必须处理 loading / error / cleanup 状态

```typescript
// services/queryService.ts
export const queryService = {
  execute: (sql: string, connId: string, limit: number) =>
    invoke('execute_query', { sql, connection_id: connId, limit }),
};

// hooks/useQueryExecution.ts
export function useQueryExecution() {
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const execute = useCallback(async (sql: string, connId: string) => {
    setIsExecuting(true);
    setError(null);
    try {
      return await queryService.execute(sql, connId, 1000);
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setIsExecuting(false);
    }
  }, []);

  return { execute, isExecuting, error };
}
```

### 4.6 性能优化清单

开发完成后，自检以下项目：

- [ ] 新增列表组件是否使用了虚拟化？
- [ ] 新增面板/弹窗是否在关闭时完全卸载？
- [ ] Zustand 订阅是否使用了精确 Selector？
- [ ] `useEffect` 是否有完整的依赖数组？
- [ ] 大对象（如查询结果）是否通过 `useMemo` / `useCallback` 避免不必要的重计算？
- [ ] 图片/图标是否使用了懒加载？
- [ ] 主题切换是否避免了全局重渲染？

### 4.7 接口兼容性（前端视角）

- IPC 调用输入/输出类型必须与 Rust 侧严格对应
- 新增 IPC 字段必须标记为可选（`?: T`），保证旧版 Rust 兼容
- 废弃的 IPC 调用必须保留至少一个版本周期，并添加 `@deprecated` JSDoc
- 配置文件格式变更必须提供向后兼容的读取逻辑

---

## 5. 后端开发规范 (src-tauri/)

### 5.1 技术栈约束

- **框架**: Tauri 2.x
- **语言**: Rust 2021 Edition
- **异步**: Tokio 1.x
- **数据库**: sqlx 0.8.x（MySQL）, rusqlite（SQLite）
- **缓存**: dashmap 6.x
- **密钥链**: keyring 3.x
- **序列化**: serde + serde_json
- **错误**: thiserror + anyhow

禁止引入未在架构文档中列出的新框架。

### 5.2 代码风格

- **格式化**: `rustfmt` 标准配置，提交前必须格式化
- **Lint**: `clippy` 全启（`#![warn(clippy::all)]`），禁止有 `clippy::warn` 的提交
- **命名**:
  - 类型/Trait: `PascalCase`
  - 函数/变量/模块: `snake_case`
  - 常量: `SCREAMING_SNAKE_CASE`
  - 泛型参数: 单个大写字母（`T`, `E`, `K`, `V`）或有意义的词（`Ctx`, `Config`）
  - 类型别名: `PascalCase`
  - 生命周期: 单小写字母（`'a`, `'conn`）
- **IPC 序列化命名**: 所有通过 Tauri Command 返回给前端的结构体（以及前端传入的输入结构体），必须在 `derive(Serialize)` / `derive(Deserialize)` 上附加 `#[serde(rename_all = "camelCase")]`，确保 JSON 字段名与前端 TypeScript 接口的驼峰命名严格一致。
- **文档**: 所有公共 API 必须有 `///` doc comment，说明用途、参数、返回值、错误条件
- **异步**: 统一 `async/await`，禁止混用 `block_on`。Tokio runtime 由 Tauri 管理，不单独创建。
- **unsafe**: 禁止使用 `unsafe`。如确需使用，必须 PR 评审通过并在 `SAFETY` 注释中说明不变量。

### 5.3 模块组织

```
src/
├── main.rs              # 入口，禁止包含业务逻辑
├── lib.rs               # 模块导出（供测试和外部使用）
├── error.rs             # 全局错误类型 AppError
├── state.rs             # Tauri Managed State (AppState)
├── commands/            # IPC 命令处理器
│   ├── mod.rs           # 命令注册
│   ├── connection.rs    # 连接相关命令
│   ├── query.rs         # 查询相关命令
│   ├── schema.rs        # Schema 相关命令
│   ├── health.rs        # 健康监控命令
│   └── history.rs       # 历史与书签命令
├── drivers/             # 数据库驱动抽象与实现
│   ├── mod.rs           # Trait 定义
│   └── mysql/           # MySQL 实现
│       ├── driver.rs
│       ├── metadata.rs
│       └── health.rs
├── connection/          # 连接管理核心
│   ├── manager.rs
│   ├── model.rs
│   └── storage.rs
├── schema/              # Schema 缓存系统
│   ├── cache.rs
│   ├── disk.rs
│   └── model.rs
├── query/               # 查询执行引擎
│   ├── engine.rs
│   ├── result.rs
│   └── cancel.rs
└── persistence/         # 本地持久化
    ├── db.rs
    ├── history.rs
    └── bookmark.rs
```

- 新增模块必须在上级 `mod.rs` 中显式 `pub mod`
- 禁止跨目录直接引用内部文件（如 `use crate::drivers::mysql::driver::private_fn`）
- `mod.rs` 职责：声明子模块、重导出公共 API、模块级文档 `//!`，不包含具体业务逻辑

### 5.4 Error Handling

```rust
// ✅ 正确：使用 thiserror 定义结构化错误
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("数据库连接失败: {0}")]
    ConnectionFailed(String),
    #[error("SQL 执行错误: {0}")]
    QueryFailed(String),
}

// ✅ 正确：anyhow 仅用于边界/主函数
fn main() -> anyhow::Result<()> {
    // ...
}

// ✅ 正确：unwrap 必须带说明
let config = load_config().expect("connections.json 必须存在且格式正确");

// ❌ 错误：裸 unwrap
let config = load_config().unwrap();

// ❌ 错误：map_err 丢失上下文
pool.acquire().await.map_err(|e| AppError::ConnectionFailed(e.to_string()))?;

// ✅ 正确：保留原始错误上下文
pool.acquire().await.map_err(|e| AppError::ConnectionFailed(format!("无法获取连接: {e}")))?;
```

### 5.5 Trait 与接口设计

#### Driver Trait 扩展规范

新增数据库后端时：

1. 在 `drivers/` 下新建目录（如 `memcached/`）
2. 实现 `DatabaseDriver`，不实现的方法返回 `Err(AppError::NotImplemented)`
3. 如需要新增 Trait 方法，必须：
   - 提供默认实现（`default`）或标记为可选
   - 不影响现有 Driver 实现
   - 在架构文档中说明

#### 向后兼容的 Trait 变更

```rust
// ✅ 正确：新增方法时提供默认实现
#[async_trait]
pub trait DatabaseDriver: Send + Sync {
    // 已有方法...

    /// 检查连接是否存活（Phase 2 新增）。
    /// 默认实现：执行 SELECT 1。
    async fn ping(&self, pool: &Pool) -> Result<(), AppError> {
        self.execute_query(pool, "SELECT 1", 1).await?;
        Ok(())
    }
}
```

### 5.6 IPC 命令设计

#### 命令函数签名

```rust
#[tauri::command]
pub async fn execute_query(
    state: tauri::State<'_, AppState>,
    connection_id: Uuid,
    sql: String,
    limit: Option<u32>,
) -> Result<QueryResult, AppError> {
    // ...
}
```

- 参数使用具体类型（`Uuid`, `String`, `Option<T>`），禁止裸 `&str` 传递复杂数据
- 返回值统一为 `Result<T, AppError>`
- `AppError` 已实现 `Serialize`，Tauri 会自动序列化到前端

#### 新增字段的兼容性

```rust
// ✅ 正确：新增可选字段
#[derive(Debug, Clone, serde::Deserialize)]
pub struct ConnectionConfig {
    pub id: Uuid,
    pub name: String,
    // Phase 2 新增，可选，旧配置兼容
    pub timeout_secs: Option<u32>,
}

// ❌ 错误：新增必填字段，破坏旧配置
pub struct ConnectionConfig {
    pub id: Uuid,
    pub name: String,
    pub timeout_secs: u32,  // 旧配置没有此字段，反序列化失败
}
```

#### 事件推送

```rust
// 主进程主动推送到前端
app_handle.emit("schema:changed", SchemaChangedEvent { connection_id, database })?;
```

- 事件名使用 `snake_case`，冒号分隔命名空间
- 载荷必须是可序列化的结构体，禁止裸 `serde_json::Value`

### 5.7 异步与并发

- 统一使用 `async/await`，禁止混用 `block_on`
- 长时间运行的后台任务使用 `tokio::spawn`，但必须持有 `tokio::task::JoinHandle` 以便取消
- 禁止在 async 函数中调用阻塞 API（`std::fs::read`, `std::thread::sleep`）

```rust
// ✅ 正确：异步文件操作
tokio::fs::read_to_string(path).await?;

// ❌ 错误：阻塞线程
std::fs::read_to_string(path)?;
```

- 共享状态使用 `DashMap` 或 `tokio::sync::RwLock`
- 优先 `DashMap`（无锁、并发度高），仅在需要复杂事务时用 `RwLock`
- 禁止裸 `unsafe` 实现并发结构

### 5.8 测试规范

#### 单元测试

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_return_error_when_limit_is_zero() {
        let engine = QueryEngine::new();
        let result = engine.validate_limit(0);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().to_string(), "limit 必须大于 0");
    }
}
```

- 测试函数名描述行为：`should_xxx_when_yyy`
- 每个测试独立，不依赖执行顺序
- 使用 `sqlx::test` 进行数据库集成测试

#### 集成测试

放在 `tests/` 目录，测试完整业务流程：

```rust
// tests/connection_test.rs
#[tokio::test]
async fn should_connect_and_fetch_version() {
    let app = create_test_app().await;
    let result = connection_commands::test_connection(
        app.state(),
        test_config(),
    ).await;
    assert!(result.is_ok());
    assert!(result.unwrap().contains("8.0"));
}
```

### 5.9 性能规范

- 查询结果默认 `limit = 1000`，禁止无限制返回
- 大结果集使用 `sqlx::RowStream` 流式处理
- Schema 缓存使用 `DashMap` + TTL，禁止全局锁
- 连接池配置上限：`max_connections = 10`（默认）
- 异步任务必须持有 `JoinHandle`，应用关闭时优雅取消

### 5.10 安全红线

- **禁止**在代码中硬编码密码、密钥、Token
- **禁止**在日志中输出 `ConnectionConfig` 的完整 Debug（密码字段必须手动屏蔽）
- **禁止**使用字符串拼接构造 SQL（必须使用 sqlx 参数化）
- **禁止**裸 `unwrap()` 处理用户输入或外部数据
- **禁止**在 Tauri 命令中暴露文件系统任意读写（必须通过沙箱路径）

---

## 6. 测试规范 (通用)

### 6.1 覆盖率要求

- Rust 核心业务逻辑: ≥ 70% 行覆盖率
- TypeScript 工具函数: ≥ 60% 行覆盖率
- React 组件: 关键交互路径必须有组件测试

### 6.2 测试组织

- Rust: 单元测试写在 `#[cfg(test)] mod tests` 中，集成测试放在 `tests/` 目录
- TypeScript: 单元测试 `*.test.ts`，组件测试 `*.spec.tsx`，与源码同目录或邻近 `__tests__/` 目录
- 测试名必须描述行为: `should_return_error_when_connection_refused` 而非 `test_connection`

### 6.3 Mock 规范

- 数据库连接必须 Mock，禁止单元测试连接真实数据库
- Tauri Command 测试使用 `tauri::test` 提供的 mock builder
- 前端 HTTP/IPC 调用使用 MSW (Mock Service Worker) 或手动 mock

---

## 7. 安全规范

### 7.1 密码与凭据

- **零明文**: 密码在任何日志、配置、内存转储中不得出现明文
- Rust: `#[serde(skip_serializing)]` + OS keyring
- TypeScript: 密码字段不得进入 React state 或 localStorage，IPC 传输后立即丢弃

### 7.2 SQL 注入防护

- Rust: 所有查询使用 sqlx 参数化（`?` 占位符），禁止字符串拼接 SQL
- 前端: 用户输入直接透传，不做字符串拼接或解析（除 `EXPLAIN` 前缀外）

### 7.3 依赖安全

- 新增依赖必须经过评审，优先选择维护活跃、下载量高的库
- 定期运行 `cargo audit` 和 `npm audit`
- 禁止引入有已知 CVE 未修复的依赖

---

## 8. Git 工作流

### 8.1 分支策略

- `main`: 保护分支，仅通过 PR 合并
- `feature/xxx`: 功能分支
- `fix/xxx`: Bug 修复分支
- `docs/xxx`: 文档更新

### 8.2 Commit Message (Conventional Commits)

```
<type>(<scope>): <subject>

<body>

<footer>
```

- **type**: `feat` | `fix` | `docs` | `style` | `refactor` | `test` | `chore` | `perf`
- **scope**: `rust` | `frontend` | `connection` | `query` | `schema` | `health` | `docs`
- **subject**: 不超过 50 字符，小写开头，不加句号
- **body**: 说明变更动机和与之前行为的对比
- **footer**: `BREAKING CHANGE:` 或 `Closes #123`

示例:
```
feat(rust/connection): add connection pool manager with DashMap

Use DashMap<Uuid, MySqlPool> for concurrent-safe pool storage.
Idempotent connect ensures no duplicate pools for same UUID.

Closes #45
```

### 8.3 PR 规范

- PR 标题遵循 Commit Message 格式
- 必须关联 Issue（如有）
- 必须包含: 变更摘要、测试方式、截图（UI 变更）
- 必须通过 CI（build + test + lint）
- 需要至少 1 个 Review Approve

---

## 9. 文档要求

### 9.1 代码内文档

- 公共 API: 必须写文档注释
- 复杂算法: 必须写注释说明思路和关键步骤
- 临时方案 / TODO: 必须标注 `TODO(#issue): 说明` 或 `FIXME: 说明`

### 9.2 项目文档

- `README.md`: 项目简介、快速开始、构建方式
- `CHANGELOG.md`: 按版本记录变更，遵循 [Keep a Changelog](https://keepachangelog.com/)
- `docs/ARCHITECTURE.md`: 架构变更时必须同步更新
- `docs/REQUIREMENTS.md`: 需求变更时必须同步更新
- **规则**: 如果修改了本文档中提到的文档、配置或流程，必须同时更新对应的文档文件。

---

## 10. AI Agent 开发守则

### 10.1 变更前必读

1. 阅读 `docs/ARCHITECTURE.md` 理解当前架构
2. 阅读 `docs/REQUIREMENTS.md` 确认需求边界
3. 阅读本文档的全部内容
4. 遵循现有代码风格，不引入新的风格冲突

### 10.2 变更后必做

1. 运行格式化（`cargo fmt` / `prettier --write`）
2. 运行 Lint（`cargo clippy` / `eslint`）
3. 运行相关测试（`cargo test` / `npm test`）
4. 更新受影响的文档（README、CHANGELOG、架构图）
5. 检查是否破坏向后兼容

### 10.3 禁止事项

- 禁止在不理解现有架构的情况下大规模重构
- 禁止引入未在架构文档中规划的新技术栈
- 禁止删除或修改已有测试而不提供替代方案
- 禁止在 PR 中混用多种代码风格
- 禁止提交包含密码、密钥、个人信息的内容

---

## 11. Agent 角色定义

### 11.1 UI/UE Agent（`agent:ui-ue`）

**定位**：专门负责 UI 布局美化与用户体验（UE）优化的设计型 Agent。
**核心原则**：只出方案，不写代码。所有实现交由开发 Agent 执行。

#### 职责范围

| 类别 | 具体职责 |
|------|---------|
| **布局美化** | 调整组件间距、对齐方式、视觉层级；优化配色、字体、圆角、阴影等视觉细节；提出 Tailwind CSS / shadcn/ui 的样式改进方案。 |
| **交互优化** | 优化用户操作流程，减少点击步骤；设计更直观的反馈机制（加载、空态、错误提示）；完善键盘快捷键和焦点管理方案。 |
| **一致性审查** | 检查全局设计 token（颜色、间距、字体）使用是否一致；审查不同功能模块的 UI 风格统一性。 |
| **响应式/适配** | 提出不同窗口尺寸下的布局适配方案；优化面板折叠、侧边栏收缩等交互细节。 |

#### 工作模式

1. **接收需求**：从产品经理或其他 Agent 获取 UE 改进需求（如"连接面板太拥挤"、"缺乏空态提示"）。
2. **分析现状**：通过查看现有组件代码和运行截图，分析当前 UI/UE 的问题点。
3. **产出方案**：以 Markdown 文档形式输出设计方案，必须包含：
   - **问题描述**：当前存在的 UI/UE 问题
   - **设计目标**：改进后要达到的效果
   - **具体改动清单**：逐条列出建议修改的组件、样式属性、交互逻辑
   - **参考/截图**：如有必要，提供示意图或参考设计链接
   - **验收标准**：如何确认改动符合预期
4. **提交评审**：将方案提交给团队评审（或人工确认）。
5. **移交开发**：方案通过后，创建任务分配给 Frontend Agent 或对应开发 Agent 实施。

#### 禁止事项

- **禁止直接修改代码**：UI/UE Agent 不得执行任何文件写操作（`WriteFile`、`StrReplaceFile` 等）。
- **禁止绕过方案直接要求改动**：即使是微小的样式调整，也必须先形成书面方案再移交。
- **禁止引入未评审的设计系统变更**：新增全局颜色、字体、组件规范必须经过评审并同步到设计文档。
