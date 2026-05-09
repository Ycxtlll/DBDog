# DBDog 功能需求文档 (FRD)

> **版本**: 0.1.0  
> **产品**: DBDog — 跨平台数据库 GUI 工具

---

## 1. 项目概述

DBDog 是一款面向开发者和 DBA 的跨平台桌面数据库管理工具。核心目标是提供**快速、安全、美观**的数据库操作体验，支持多数据库后端扩展。

### 1.1 核心价值主张
- **极速查询**：毫秒级连接，虚拟滚动网格支撑百万级数据浏览
- **智能感知**：基于实时 Schema 的 SQL 自动补全（库/表/列 + 点号导航）
- **深度诊断**：内置 EXPLAIN 可视化、进程列表、InnoDB 状态监控
- **结构管理**：自动生成 ER 图、Schema 快照对比、迁移 SQL 生成
- **本地优先**：连接配置本地存储，密码交由 OS 密钥链，零泄漏风险

### 1.2 支持的数据库

| 数据库 | 当前状态 | 备注 |
|--------|----------|------|
| MySQL / MariaDB | 🔄 计划内 | Phase 1 |
| Memcached | 🔄 计划内 | Phase 2 |
| Redis | 🔄 计划内 | Phase 3 |
| ZooKeeper | 🔄 计划内 | Phase 3 |

---

## 2. 目标用户与场景

| 用户角色 | 典型场景 |
|----------|----------|
| **后端开发者** | 日常 CRUD、联表查询、导出数据、查看表结构 |
| **DBA** | 进程监控、慢查询分析、KILL 线程、查看 InnoDB 状态 |
| **数据分析师** | 复杂 SQL 编写、结果导出 Excel/CSV、历史回溯 |
| **全栈工程师** | 多库切换、Schema 对比、生成迁移脚本 |

---

## 3. 功能需求（Functional Requirements）

### 3.1 连接管理（Connection Management）

#### FR-CM-01 连接配置 CRUD
- 用户可创建、编辑、删除、复制数据库连接配置
- 配置字段：名称、数据库类型、主机、端口、用户名、密码、默认库、最大连接数、SSL 模式、SSL 证书路径
- 配置以 JSON 形式持久化到 Tauri App Data 目录
- 密码字段标记为 `#[serde(skip_serializing)]`，**禁止明文落盘**

#### FR-CM-02 凭据安全存储
- 密码通过 `keyring` crate 存入操作系统密钥链（Windows Credential / macOS Keychain / Linux Secret Service）
- 若密钥链不可用，前端降级为连接时弹窗提示输入密码
- 连接对象在内存中使用时解密，生命周期结束后销毁

#### FR-CM-03 连接生命周期
- **Test**: 不创建持久池，仅验证网络 + 认证 + 版本号返回
- **Connect**: 建立连接池（`PoolManager` 按 UUID 管理 `MySqlPool`），获取服务器版本，自动预热 L1 Schema 缓存
- **Disconnect**: 关闭连接池，清理该连接对应的内存缓存
- 同一连接重复 Connect 应复用已有池（幂等）

#### FR-CM-04 连接列表 UI
- 左侧面板展示已保存连接列表，显示名称、类型、主机、状态指示器
- 支持快捷连接 / 断开 / 编辑 / 删除
- 连接状态实时反馈：`disconnected` | `connecting` | `connected` | `error`

---

### 3.2 SQL 编辑器（SQL Editor）

#### FR-ED-01 多标签编辑器
- 支持多 Tab 打开查询窗口，每个 Tab 独立维护：SQL 文本、执行结果、错误信息、选中数据库
- Tab 可新建、关闭、重命名（默认以首行 SQL 摘要命名）
- 未保存内容切换 Tab 不丢失（前端状态管理）

#### FR-ED-02 CodeMirror 6 编辑器核心
- 基于 `@codemirror/lang-sql` 提供语法高亮
- 支持 Vim 模式切换（通过配置）
- 支持 SQL 格式化（`sql-formatter`），一键美化当前 Tab 内容
- 字体大小、Tab 宽度可在设置中调节

#### FR-ED-03 Schema 感知自动补全
- 补全引擎需感知当前连接的库表结构
- 支持 `database.table.column` 三级点号导航补全
- 补全词库来源：L1 内存缓存（5 分钟 TTL）+ 实时 fallback
- 当用户执行 DDL（CREATE/ALTER/DROP）后自动失效缓存并刷新补全词库

#### FR-ED-04 查询执行控制
- **执行选中 / 执行全部**：对 `SELECT/SHOW/EXPLAIN` 走 `execute_query`，对 `INSERT/UPDATE/DELETE/DDL` 走 `execute_update`
- **结果截断**：默认限制返回行数（可配置，默认如 1000），超限时标记 `truncated = true`
- **执行计时**：前端展示执行耗时（精确到毫秒）
- **取消查询**：长查询支持中断（`KILL QUERY` 机制），前端展示取消状态

#### FR-ED-05 EXPLAIN 可视化
- 一键在查询前追加 `EXPLAIN` 并执行
- 结果以表格 + 颜色编码形式展示（如全表扫描标红、索引命中标绿）
- 提供 `ExplainVisualizer` 组件独立渲染

---

### 3.3 结果网格（Result Grid）

#### FR-RG-01 AG Grid 数据展示
- 使用 AG Grid Community 渲染查询结果
- 虚拟滚动支撑百万级行不卡顿
- 列宽自适应 + 手动拖拽调整
- 列头显示字段类型提示（hover 时）

#### FR-RG-02 数据导出
- 支持导出当前结果为 **CSV / JSON / Excel (xlsx)**
- 导出时保留当前筛选排序状态（AG Grid 原生支持）
- 导出大结果集时应流式写入，避免前端内存溢出

#### FR-RG-03 筛选与排序
- 列头快速筛选（文本 / 数字 / 日期范围）
- 多列组合排序
- 一键清除所有筛选条件

---

### 3.4 数据库结构浏览（Schema Browser）

#### FR-SB-01 树形导航
- 侧边栏树形结构展示：`连接 > 数据库 > 表/视图/触发器`
- 表节点右键菜单：查看结构、查看 CREATE SQL、复制名称、在编辑器中 SELECT
- 视图节点：列出视图名称，支持查看定义（未来）

#### FR-SB-02 Schema 搜索
- 全局搜索框支持按关键词跨库搜索表、列、视图、触发器
- 搜索结果展示：所在库、对象类型、对象名、匹配字段
- 点击结果可直接定位到树节点或打开编辑器

#### FR-SB-03 表结构详情
- 展示字段列表：名称、序号、类型、可空、主键、自增、默认值、注释
- 展示索引列表：名称、列、是否唯一、是否主键、索引类型
- 展示外键列表：名称、本表列、引用表、引用列、级联规则
- 展示触发器列表：名称、事件、时机、语句摘要
- 展示 `CREATE TABLE` 原始 SQL（通过 `SHOW CREATE TABLE` 获取）

#### FR-SB-04 Schema 缓存策略
- **L1（内存）**: `DashMap` 存储，TTL 5 分钟，进程级共享
- **L2（磁盘）**: JSON 文件，TTL 1 小时，位于 App Data 目录
- **预热**: Connect 成功后自动将 L2 加载到 L1
- **失效**: 执行 DDL 或用户手动刷新时，按连接 / 按库精确失效
- 用户可主动触发 `refresh_schema` 强制刷新

---

### 3.5 数据工具（Data Tools）

#### FR-DT-01 数据生成器（Data Generator）
- 针对选中表，按列类型规则批量生成模拟数据（Mock Data）
- 支持自定义生成行数、覆盖/追加模式
- 内置规则：整数自增、随机字符串、邮箱、UUID、日期范围、枚举值等
- 生成预览后执行 INSERT

#### FR-DT-02 表结构查看（Table Structure）
- 快速弹窗/侧边栏展示单表结构，作为编辑器旁的速查面板
- 与主 Schema 浏览器数据同源，走缓存

---

### 3.6 命令面板（Command Palette）

#### FR-CP-01 快捷键唤起
- `Ctrl+K`（或 `Cmd+K`）唤起命令面板
- 支持模糊搜索所有可执行动作：
  - 连接切换、新建查询、打开设置、切换主题、格式化 SQL、导出结果等
- 键盘优先：上下箭头选择、Enter 执行、Esc 关闭

---

### 3.7 设置与个性化（Settings）

#### FR-ST-01 外观设置
- **主题切换**：Light / Dark，通过 `data-theme` 属性作用于 `<html>`
- **语言切换**：English / 简体中文（`react-i18next`，浏览器语言自动检测）
- **字体大小**：编辑器与结果网格联动调整

#### FR-ST-02 编辑器设置
- Tab 宽度（2 / 4 / 8）
- 默认查询返回行数上限
- Vim 模式开关
- 自动补全开关

#### FR-ST-03 连接与性能设置
- 连接超时时间（秒）
- Schema 缓存 TTL（秒）
- 最大连接池大小（默认覆盖）

---

## 4. 非功能需求（Non-Functional Requirements）

### 4.1 性能
- **冷启动**：应用窗口在 2 秒内可交互
- **查询执行**：简单 `SELECT 1` 往返延迟 < 100ms（局域网）
- **大结果集**：10 万行以内渲染不卡顿；超过上限时自动截断并提示
- **Schema 加载**：千级表的数据库，树形导航首次展开 < 500ms（走缓存）

### 4.2 安全
- **密码零明文**：禁止以任何形式在日志、配置文件、LocalStorage 中记录明文密码
- **SQL 注入防护**：所有后端查询使用 sqlx 参数化查询；前端输入仅用于 `execute_query` 透传时由用户自行负责
- **AG Grid 许可合规**：仅使用 Community 功能，禁用 Enterprise 特性（菜单、行分组、服务端聚合等）
- **CSP 策略**：若未来加载外部资源，需在 `tauri.conf.json` 配置严格 CSP；当前为 `null` 仅限本地 bundle

### 4.3 可靠性
- **连接池容错**：网络闪断后，下次查询自动重连或明确报错（不静默失败）
- **DDL 缓存一致性**：执行 `ALTER/CREATE/DROP/RENAME/TRUNCATE` 后自动使对应连接的 Schema 缓存失效
- **本地数据库迁移**：SQLite 表结构通过 `migrations/001_init.sql` 管理，应用启动时自动应用

### 4.4 可扩展性
- **Driver Trait 架构**：`DatabaseDriver` / `DatabaseMetadata` / `DatabaseHealth` 三个异步 trait 定义了统一的扩展接口
- 新增数据库后端仅需：
  1. 实现上述 trait
  2. 在 `AppState` 中注册新 driver
  3. 前端连接对话框增加新类型选项
- **状态管理解耦**：Zustand 按领域拆分 store（connection / query / history / schemaCache / ui）

### 4.5 国际化（i18n）
- 所有用户可见字符串通过 `useTranslation()` 走命名空间：`common`, `connections`, `editor`, `query`, `settings`
- 当前支持 **en** 与 **zh**，后续新增语言仅需补充 JSON 翻译文件
- 日期时间统一 RFC3339 存储，前端按 locale 格式化

---

## 5. 验收标准（Acceptance Criteria）

### 5.1 连接模块
- [ ] 创建 5 个不同 MySQL 实例连接，Test 均返回成功提示
- [ ] 密码在 `connections.json` 中不出现明文；OS 密钥链可检索到对应条目
- [ ] 断网后点击 Connect，3 秒内返回明确错误提示
- [ ] 重复 Connect 同一配置，连接池不重复创建

### 5.2 编辑器模块
- [ ] 输入 `SELECT * FROM ` 后，自动补全列表包含当前库所有表名
- [ ] 输入 `db_name.table_name.` 后，自动补全该表所有列名
- [ ] 执行 `SELECT * FROM large_table`（100 万行），默认仅返回前 1000 行，界面标注 truncated
- [ ] 执行 `UPDATE` 后，网格展示 `rows_affected` 和执行时间
- [ ] 长查询点击 Cancel 后，后端 `KILL QUERY` 成功，前端状态变为 cancelled

### 5.3 Schema 浏览模块
- [ ] 千表数据库 Connect 后，侧边栏树在 1 秒内可展开数据库节点
- [ ] 执行 `ALTER TABLE ... ADD COLUMN` 后，树节点展开该表可看到新列（不走缓存旧值）
- [ ] Schema Search 输入列名，可跨表搜索并定位到对应表结构

### 5.4 国际化
- [ ] 切换语言后，所有 UI 文本即时更新，无需重启
- [ ] 切换主题后，编辑器、网格、图表色彩同步适配

---

## 6. 路线图（Roadmap）

| 阶段 | 目标 | 关键交付 |
|------|------|----------|
| **Phase 1** | MySQL/MariaDB 核心功能 | 连接、查询、网格、Schema 树、EXPLAIN、数据工具、命令面板、设置 |
| **Phase 2** | 多数据库扩展 | Memcached 连接与 Key-Value 浏览；连接框架抽象验证 |
| **Phase 3** | 高级与生态 | Redis（String/Hash/List/Set/ZSet/ZooKeeper；数据导入；团队协作（云端连接共享）；插件系统 |
