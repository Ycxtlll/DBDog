# Changelog

All notable changes to DBDog will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

---

## [0.3.9] — 2026-08-17

### Fixed

**安全**

- **删除连接清空所有密码（严重）** — 删除任意一个连接会把其余所有连接的 `password_hash` 一并清掉（Windows DPAPI 密文被销毁，keyring 标记被移除），导致其他连接的已保存密码静默丢失。现在 `delete()` 只剥离内存明文，保留幸存连接的凭据。
- **导出 SQL 注入** — `execute_export` 将前端传入的 database/table/排序列直接以反引号拼接进 SQL，含反引号的表名可逃逸标识符注入任意 SQL。现全部改用 `escape_mysql_identifier` 转义（与 metadata.rs 其余调用点一致）。
- **非 ASCII 密文崩溃** — DPAPI hex 解码在字节边界切 `&str`，损坏的 `password_hash` 含多字节 UTF-8 时触发 panic（影响 `list_connections` 等所有命令）。改为按字节解析并手工校验 hex 位。

**数据正确性**

- **导出丢失 BLOB 数据** — 导出解码器缺少二进制分支，BLOB/VARBINARY 列经 UTF-8 校验失败后静默写成空串。现与查询引擎一致 base64 编码输出。
- **无主键表导出静默截断/丢行** — 键集分页在排序键含 NULL 时生成 `> NULL`（匹配零行，首个批次后静默终止）；含重复行时批边界整组丢行。无主键表现改用 OFFSET 分页（慢而完整），主键表保留键集分页并对 NULL 键显式报错。
- **空字符串键值被当作 NULL** — 导出分页 WHERE 中 `''` 被引用为 `NULL`，已区分。
- **Memcached 键列表双重解码 + get/delete 错误编码** — 实测证实 metadump 只做一次百分号编码（键 `a%20b` 报告为 `a%2520b`），旧的双重解码会损坏含 `%` 的键；而 ASCII 协议的 `get`/`delete` 需要原始键（`get c%3Ad` 查不到 `c:d`），旧的发送前编码导致特殊字符键全部不可读/不可删。现为单次解码 + 原样发送，含空白/控制字符的键给出明确错误。集成测试覆盖含 `:` 键的列出→读取往返。
- **Memcached 读循环死循环** — `stats`/`metadump`/`cachedump` 四处循环不处理 EOF（`read_line` 返回空串），服务器中途断开时命令挂起并占满一个 CPU 核。现遇 EOF 即中断；`lru_crawler` 返回 `BUSY`/`FAILED`/`SERVER_ERROR` 时也正确回退到 cachedump。
- **Memcached `total_keys` 恒 ≤ 5000** — 返回了截断后的 `keys.len()` 而非真实总数，截断提示自相矛盾。已返回真实值。
- **ZooKeeper 主机名无法连接** — 连接用 `SocketAddr::from_str` 只接受字面 `IP:port`，`zookeeper.corp:2181` 之类主机名直接报"无效地址"。现经 DNS 解析后逐个尝试。
- **连接池僵死** — 池内连接失效（服务器重启/网络中断）后再次"连接"只探测旧池并报错，用户必须先手动断开。现探测失败自动丢弃旧池并重建；`PoolManager::connect` 改为替换而非 `or_insert`。
- **`USE` 污染池化连接** — 在池化连接上执行的 `USE` 在归还后残留，未显式指定库的后续查询可能落在其他标签页切换过的库上。现未指定库时重置为连接配置的默认库。
- **schema 缓存过期条目永不清理** — 过期条目只被跳过不被删除，浏览大量库/表时缓慢泄漏。现读取时淘汰。
- **`information_schema` 行数丢弃** — `TABLE_ROWS` 为 BIGINT UNSIGNED，按 `i64` 严格解码失败后静默变 `None`。改按 `u64` 解码。
- **结构搜索通配符** — 搜索关键词中的 `%`/`_` 被当作 LIKE 通配符，现转义为字面量。

**前端**

- **执行按钮永久卡死** — 空 SQL 点击执行时 `execute()` 的早退路径不清 `isExecuting`，标签页转圈、按钮永久禁用且无法恢复。所有早退并入 `try/finally`。
- **快捷键与文档不符** — 实现 `Ctrl/Cmd+Enter`（有选区执行选中，无选区执行全部）、`Ctrl/Cmd+Shift+Enter`（执行选中）、`Ctrl/Cmd+Shift+F`（格式化），并改用 `Mod-` 前缀支持 macOS。
- **EXPLAIN 破坏编辑器内容** — 点击 Explain 会把 `EXPLAIN ` 前缀写回编辑器（连点两次产生 `EXPLAIN EXPLAIN`）。改为瞬时查询，不落盘到编辑器。
- **单元格保存后编辑功能失效** — 行弹窗 `saving` 成功后不重置，保存一次后 Save/NULL/Delete 全部禁用。改用 `finally` 重置。
- **断开后 UI 仍操作死连接** — `disconnect` 不清 `activeId` 与过期 serverInfo。已清理。
- **网格刷新执行错查询** — 单元格保存/删行后重跑的是编辑器当前内容（可能已被改成别的脚本）。现记录产生结果集的 `executedSql`/`executedLimit` 并按其刷新。
- **系统主题不跟随 OS 切换** — `theme: "system"` 只在启动时解析一次。现监听 `prefers-color-scheme` 变化并实时应用到编辑器/网格。
- **SQL 拆分忽略注释** — `-- `、`#`、块注释中的分号会错误切断语句（与函数声明矛盾）。已正确跳过。
- **ZK 树深层节点无法展开** — 预加载 3 层之外 Frontier 节点显示箭头但展开为空。现首次展开时懒加载一层并合并进树。
- **错误信息无处查看** — 查询失败仅有 5 秒 toast，结果区空白。现结果区持久显示错误详情。
- **`window.confirm` 在 Tauri 不可靠** — 删除连接/删行/删除 Key/Flush All 等破坏性操作改用 `@tauri-apps/plugin-dialog` 原生确认。
- **导出弹窗可中途关闭** — 运行中点 X 会隐藏唯一取消入口、导出失控。运行中禁用关闭按钮；"取消导出"不再顺带关闭弹窗。
- **命令面板不可键盘操作** — 补 ↑/↓/Enter 导航；执行命令补上丢失的 `defaultLimit` 设置；改用实时 store 状态避免过期快照。
- **设置弹窗 X 失效** — 点击 X 图标时 `e.target` 判断失败。已修复并补 Escape/背景关闭。
- **Toast 丢弃 title** — `showError(msg, title)` 的 title 从未渲染。
- **保存/启动失败无反馈** — 连接表单保存、启动加载配置等 await 均无 catch，失败时静默。已补错误提示。
- **编辑保存的连接无法"测试"** — 表单留空密码时后端用存储密码补全后再测试。

### Added

- **清除已保存密码** — 编辑连接时可选"清除已保存的密码"（后端语义：空字符串=清除，缺省=保留）。
- **导出弹窗 i18n** — 新增 `export` 命名空间，中英完整。
- **行弹窗/结果网格/结构树右键菜单 i18n** — 此前硬编码中文/英文混杂（AG Grid 分页文案、查看行数据、删除行、导出数据等），并补齐缺失的 `memcached:errorHint` 键。
- **主键列缺失守卫** — 编辑/删行前校验当前结果包含全部主键列，防止在非表数据上生成错误 WHERE。
- **标识符转义（前端）** — 行内编辑生成的 UPDATE/DELETE、SHOW KEYS、SELECT 均转义反引号。

### Changed

- **ZK 会话关闭发送 close opcode（-11）** — 服务器立即释放会话而非等待超时；关闭失败仅在操作成功时报出。
- **mntr 空响应报错** — 4lw 白名单未放开时明确提示，而非显示伪造的 "unknown" 统计。
- **修复 `memcached_integration` 集成测试** — `group` 字段加入后测试从未编译通过（`cargo test` 一直失败），已补字段并修正 `total_keys` 断言语义。

---

## [0.3.8] — 2026-07-24

### Fixed

- **窗口关闭 bug** — 修复从右往左选中文字拖到任意窗口边缘（或拖到头）导致窗口关闭的问题。根因是 WebView2 将文字选中误解为拖拽操作。通过全局 CSS `-webkit-user-drag: none` 和 `dragstart` 事件拦截双重修复。

### Changed

- **新建连接表单优化** — host 和 username 不再预填值，`localhost` / `root` 仅作为 placeholder 提示，避免意外使用默认值覆盖用户意图。

---

## [0.3.7] — 2026-07-15

### Added

- **SQL 编辑器选中执行** — 选中代码后通过以下方式仅执行选中部分：
  - 点击播放按钮（有选区时按钮高亮提示「执行选中的SQL」）
  - 右键菜单 → 「执行选中」
  - 快捷键 `Ctrl-Enter`（覆盖默认换行行为，无选区时无操作）
- **SQL 编辑器右键菜单** — 拦截系统默认右键菜单，提供完整功能菜单：执行选中、剪切、复制、粘贴、格式化、全选

### Changed

- 删除 `Ctrl-Shift-Enter` 快捷键，统一为 `Ctrl-Enter` 执行选中
- 播放按钮与右键菜单统一联动选区状态

---

## [0.3.6] — 2026-07-09

### Added

- **行数据 Form 弹窗** — 点击结果表格中任意单元格，打开整行数据的全列表单视图。支持点击任意列值进入内联编辑，提供「Set NULL」和「保存」操作。
- **弹窗内删除行** — 编辑弹窗底部新增「删除行」按钮，确认后删除当前查看的整行数据。
- **右键菜单（结果表格）** — 在查询结果表格上右键，弹出「查看行数据」和「删除行」菜单项，拦截系统默认右键菜单。
- **右键菜单（Schema 树）** — 在 Schema 树的表名上右键，弹出「查看数据」「查看结构」「导出数据」菜单项。
- **CSV 导出（弹窗+进度+取消）** — Schema 树右键菜单「导出数据」打开导出弹窗，支持选择保存位置、实时进度条、随时取消。后端使用 keyset 分页（`WHERE pk > ? ORDER BY pk LIMIT 5000`）逐批写盘，不累积内存，支持从 449k+ 行大表导出。

### Changed

- **Schema 树交互优化** — 移除表节点上的小眼睛（查看数据）图标，表操作统一迁移到右键菜单；保留栏结构按钮。
- **VirtualTree** — 新增 `onNodeContextMenu` 回调 prop，支持节点右键事件。

---

## [0.3.5] — 2026-07-03

### Fixed

- **MySQL 8.0 兼容性修复** — 修复 MySQL 8.0 下列和索引信息无法读取的问题。`fetch_columns` 改用 `SHOW FULL COLUMNS`，`fetch_indexes` 改用 `SHOW INDEX`，避免 sqlx 0.8 对 `information_schema` 中 `BIGINT UNSIGNED` 列的类型解码错误。

### Changed

- **Schema 树交互优化** — 左侧目录栏进入表级别后不再展开列子节点；点击表名直接执行 `SELECT * FROM table LIMIT 1000`，无需再点击小眼睛图标。
- **README 重构** — README 切换为英文版作为默认，中文版移至 `docs/README.zh.md`，增加中英文跳转链接。

---

## [0.3.4] — 2026-06-17

### Added

- **连接分组** — 支持自动分组与手动分组：
  - 自动分组：同类型连接（MySQL / Memcached / ZooKeeper）自动归入对应组别
  - 手动分组：连接配置新增 `group` 字段，可自定义分组名称
  - 侧边栏显示可折叠分组，默认全部展开，点击组头切换收起/展开
  - 每组显示连接数量角标
- 单元格编辑生成的 UPDATE 语句自动写入查询历史记录

### Changed

- **通知组件重构** — Toast 改为左下角显示，实色背景 + 左侧 3px 颜色条（绿/红/蓝），新增入场动画

---

## [0.3.3] — 2026-06-16

### Added

- **ZooKeeper 支持** — 自实现 ZK 协议客户端，支持树浏览、节点查看、Server 统计
- 连接面板状态指示器（绿/黄/红/灰 圆点）

### Changed

- 侧边栏视图按连接类型自动切换（MySQL→Schema、Memcached→Key列表、ZooKeeper→树）

---

## [0.2.0] — 2026-06-16

### Added

- **Memcached 支持** — 新增 Memcached 数据库驱动，支持以下操作：
  - 连接测试与服务器信息查看（版本、运行时间、内存用量等）
  - 遍历所有 Key（使用 `lru_crawler metadump`，回退到 `stats cachedump`）
  - 按 Key 模糊搜索（`list_keys` 命令内置过滤）
  - 查看指定 Item 的值与元数据（flags、大小）
  - 删除指定 Item
  - 清空全部缓存（`flush_all`）
- 默认连接地址 `localhost:11211`
- `ServerInfo.connectionId` 对 Memcached 连接显示为 `host:port`

### Changed

- `ConnectionConfig.db_type` 枚举新增 `memcached` 变体
- `test_connection` / `connect` 命令按 `DatabaseType` 分发到对应驱动
- MySQL 连接逻辑提取为内部 `connect_mysql` 函数，不影响公开 API

---

## [0.1.0] — 2026-05-15

### Added

- **MySQL 支持** — 连接管理、查询执行、Schema 浏览
- SQL 编辑器（CodeMirror 6，语法高亮、格式化）
- 虚拟滚动结果网格（AG Grid）
- 命令面板（`Ctrl+K`）
- 连接配置持久化 + OS 密钥链密码存储
- i18n（简体中文 / English）
- 深色/浅色主题
