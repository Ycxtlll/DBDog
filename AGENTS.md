# DBDog 项目开发准则

> 本文件面向所有参与 DBDog 开发的 AI Agent 与人工开发者，定义编码规范、架构原则和协作标准。

---

## 1. 项目概述

- **产品**: DBDog — 跨平台数据库 GUI 工具
- **技术栈**: Tauri 2.x (Rust) + React/TypeScript
- **架构文档**: `docs/ARCHITECTURE.md`
- **需求文档**: `docs/REQUIREMENTS.md`

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

## 4. 代码风格

### 4.1 Rust (src-tauri/)

- **格式化**: `rustfmt` 标准配置，提交前必须格式化
- **Lint**: `clippy` 全启（`#![warn(clippy::all)]`），禁止有 `clippy::warn` 的提交
- **命名**:
  - 类型/Trait: `PascalCase`
  - 函数/变量/模块: `snake_case`
  - 常量: `SCREAMING_SNAKE_CASE`
  - 泛型参数: 单个大写字母（`T`, `E`, `K`, `V`）或有意义的词（`Ctx`, `Config`）
- **IPC 序列化命名**: 所有通过 Tauri Command 返回给前端的结构体（以及前端传入的输入结构体），必须在 `derive(Serialize)` / `derive(Deserialize)` 上附加 `#[serde(rename_all = "camelCase")]`，确保 JSON 字段名与前端 TypeScript 接口的驼峰命名严格一致。禁止前后端字段命名风格不一致导致运行时 `undefined`。
- **文档**: 所有公共 API 必须有 `///` doc comment，说明用途、参数、返回值、错误条件
- **Error Handling**: 使用 `thiserror` 定义结构化错误，`anyhow` 仅用于边界/主函数。禁止裸 `unwrap()`，必须 `expect("说明原因")` 或显式处理。
- **异步**: 统一 `async/await`，禁止混用 `block_on`。Tokio runtime 由 Tauri 管理，不单独创建。
- **unsafe**: 禁止使用 `unsafe`。如确需使用，必须 PR 评审通过并在 `SAFETY` 注释中说明不变量。

### 4.2 TypeScript/React (src/)

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

---

## 5. 测试规范

### 5.1 覆盖率要求

- Rust 核心业务逻辑: ≥ 70% 行覆盖率
- TypeScript 工具函数: ≥ 60% 行覆盖率
- React 组件: 关键交互路径必须有组件测试

### 5.2 测试组织

- Rust: 单元测试写在 `#[cfg(test)] mod tests` 中，集成测试放在 `tests/` 目录
- TypeScript: 单元测试 `*.test.ts`，组件测试 `*.spec.tsx`，与源码同目录或邻近 `__tests__/` 目录
- 测试名必须描述行为: `should_return_error_when_connection_refused` 而非 `test_connection`

### 5.3 Mock 规范

- 数据库连接必须 Mock，禁止单元测试连接真实数据库
- Tauri Command 测试使用 `tauri::test` 提供的 mock builder
- 前端 HTTP/IPC 调用使用 MSW (Mock Service Worker) 或手动 mock

---

## 6. 安全规范

### 6.1 密码与凭据

- **零明文**: 密码在任何日志、配置、内存转储中不得出现明文
- Rust: `#[serde(skip_serializing)]` + OS keyring
- TypeScript: 密码字段不得进入 React state 或 localStorage，IPC 传输后立即丢弃

### 6.2 SQL 注入防护

- Rust: 所有查询使用 sqlx 参数化（`?` 占位符），禁止字符串拼接 SQL
- 前端: 用户输入直接透传，不做字符串拼接或解析（除 `EXPLAIN` 前缀外）

### 6.3 依赖安全

- 新增依赖必须经过评审，优先选择维护活跃、下载量高的库
- 定期运行 `cargo audit` 和 `npm audit`
- 禁止引入有已知 CVE 未修复的依赖

---

## 7. Git 工作流

### 7.1 分支策略

- `main`: 保护分支，仅通过 PR 合并
- `feature/xxx`: 功能分支
- `fix/xxx`: Bug 修复分支
- `docs/xxx`: 文档更新

### 7.2 Commit Message (Conventional Commits)

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

### 7.3 PR 规范

- PR 标题遵循 Commit Message 格式
- 必须关联 Issue（如有）
- 必须包含: 变更摘要、测试方式、截图（UI 变更）
- 必须通过 CI（build + test + lint）
- 需要至少 1 个 Review Approve

---

## 8. 文档要求

### 8.1 代码内文档

- 公共 API: 必须写文档注释
- 复杂算法: 必须写注释说明思路和关键步骤
- 临时方案 / TODO: 必须标注 `TODO(#issue): 说明` 或 `FIXME: 说明`

### 8.2 项目文档

- `README.md`: 项目简介、快速开始、构建方式
- `CHANGELOG.md`: 按版本记录变更，遵循 [Keep a Changelog](https://keepachangelog.com/)
- `docs/ARCHITECTURE.md`: 架构变更时必须同步更新
- `docs/REQUIREMENTS.md`: 需求变更时必须同步更新
- **规则**: 如果修改了 AGENTS.md 中提到的文档、配置或流程，必须同时更新对应的文档文件。

---

## 9. 性能规范

### 9.1 前端

- 列表 > 100 项必须使用虚拟化（`@tanstack/react-virtual`）
- 面板不可见时必须卸载（`LazyMount`），禁止 `display: none` 保留大量 DOM
- 编辑器分栏关闭时释放 CodeMirror 实例
- Zustand 订阅必须精确，禁止整个 Store 的盲目监听导致无效重渲染

### 9.2 后端

- 异步操作禁止阻塞线程（`std::thread::sleep` 在 async 函数中禁用）
- 大结果集必须流式处理，禁止一次性加载到内存
- Schema 缓存 TTL 到期后懒加载，禁止后台轮询刷新
- 连接池必须配置上限和超时，禁止无限制增长

---

## 10. AI Agent 开发守则

### 10.1 变更前必读

1. 阅读 `docs/ARCHITECTURE.md` 理解当前架构
2. 阅读 `docs/REQUIREMENTS.md` 确认需求边界
3. 阅读本文件及对应目录的 `AGENTS.md`
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
