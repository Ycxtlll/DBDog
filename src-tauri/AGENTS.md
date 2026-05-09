# 后端开发准则 (src-tauri/)

> 本文件补充 `../AGENTS.md`，针对 Rust 后端开发提供具体规范。
> 上层准则与本文件冲突时，以本文件为准。

---

## 1. 技术栈约束

- **框架**: Tauri 2.x
- **语言**: Rust 2021 Edition
- **异步**: Tokio 1.x
- **数据库**: sqlx 0.8.x（MySQL）, rusqlite（SQLite）
- **缓存**: dashmap 6.x
- **密钥链**: keyring 3.x
- **序列化**: serde + serde_json
- **错误**: thiserror + anyhow

禁止引入未在架构文档中列出的新框架。

---

## 2. Rust 编码规范

### 2.1 格式化与检查

提交前必须执行：

```bash
cargo fmt
cargo clippy --all-targets --all-features -- -D warnings
cargo test
```

- `cargo fmt` 零 diff
- `clippy` 零 warning（`-D warnings` 视为错误）
- 所有测试通过

### 2.2 命名规范

| 类型 | 规范 | 示例 |
|------|------|------|
| 结构体/枚举/Trait | `PascalCase` | `ConnectionConfig`, `AppError` |
| 函数/方法/变量/模块 | `snake_case` | `execute_query`, `pool_manager` |
| 常量 | `SCREAMING_SNAKE_CASE` | `DEFAULT_LIMIT` |
| 泛型参数 | 单大写字母或语义词 | `T`, `K`, `V`, `Ctx` |
| 类型别名 | `PascalCase` | `type ConnId = Uuid;` |
| 生命周期 | 单小写字母 | `'a`, `'conn` |

### 2.3 文档注释

所有 `pub` 级别的 API 必须有 `///` 文档注释：

```rust
/// 执行查询并返回结果集。
///
/// # Arguments
/// * `pool` - 已建立的连接池
/// * `sql` - SQL 语句（必须是 SELECT/SHOW/EXPLAIN）
/// * `limit` - 最大返回行数，超过则截断
///
/// # Returns
/// 成功时返回 `QueryResult`，包含列元数据和行数据。
///
/// # Errors
/// 当 SQL 类型不匹配或执行失败时返回 `AppError::QueryFailed`。
pub async fn execute_query(
    &self,
    pool: &MySqlPool,
    sql: &str,
    limit: u32,
) -> Result<QueryResult, AppError> {
    // ...
}
```

- 每个 `pub` 函数必须包含：用途、参数、返回值、错误条件
- 模块级文档使用 `//!`

### 2.4 Error Handling

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

---

## 3. 模块组织

### 3.1 目录规范

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

### 3.2 `mod.rs` 职责

- 声明子模块
- 重导出公共 API（`pub use self::xxx::{A, B}`）
- 模块级文档 `//!`
- 不包含具体业务逻辑

---

## 4. Trait 与接口设计

### 4.1 Driver Trait 扩展规范

新增数据库后端时：

1. 在 `drivers/` 下新建目录（如 `memcached/`）
2. 实现 `DatabaseDriver`，不实现的方法返回 `Err(AppError::NotImplemented)`
3. 如需要新增 Trait 方法，必须：
   - 提供默认实现（`default`）或标记为可选
   - 不影响现有 Driver 实现
   - 在架构文档中说明

### 4.2 向后兼容的 Trait 变更

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

---

## 5. IPC 命令设计

### 5.1 命令函数签名

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

### 5.2 新增字段的兼容性

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

### 5.3 事件推送

```rust
// 主进程主动推送到前端
app_handle.emit("schema:changed", SchemaChangedEvent { connection_id, database })?;
```

- 事件名使用 `snake_case`，冒号分隔命名空间
- 载荷必须是可序列化的结构体，禁止裸 `serde_json::Value`

---

## 6. 异步与并发

### 6.1 异步规范

- 统一使用 `async/await`，禁止混用 `block_on`
- 长时间运行的后台任务使用 `tokio::spawn`，但必须持有 `tokio::task::JoinHandle` 以便取消
- 禁止在 async 函数中调用阻塞 API（`std::fs::read`, `std::thread::sleep`）

```rust
// ✅ 正确：异步文件操作
tokio::fs::read_to_string(path).await?;

// ❌ 错误：阻塞线程
std::fs::read_to_string(path)?;
```

### 6.2 并发安全

- 共享状态使用 `DashMap` 或 `tokio::sync::RwLock`
- 优先 `DashMap`（无锁、并发度高），仅在需要复杂事务时用 `RwLock`
- 禁止裸 `unsafe` 实现并发结构

---

## 7. 测试规范

### 7.1 单元测试

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

### 7.2 集成测试

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

---

## 8. 性能规范

- 查询结果默认 `limit = 1000`，禁止无限制返回
- 大结果集使用 `sqlx::RowStream` 流式处理
- Schema 缓存使用 `DashMap` + TTL，禁止全局锁
- 连接池配置上限：`max_connections = 10`（默认）
- 异步任务必须持有 `JoinHandle`，应用关闭时优雅取消

---

## 9. 安全红线

- **禁止**在代码中硬编码密码、密钥、Token
- **禁止**在日志中输出 `ConnectionConfig` 的完整 Debug（密码字段必须手动屏蔽）
- **禁止**使用字符串拼接构造 SQL（必须使用 sqlx 参数化）
- **禁止**裸 `unwrap()` 处理用户输入或外部数据
- **禁止**在 Tauri 命令中暴露文件系统任意读写（必须通过沙箱路径）
