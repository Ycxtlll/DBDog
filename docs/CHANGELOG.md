# Changelog

All notable changes to DBDog will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

---

## [0.3.14] — 2026-11-05

### Added

- **PostgreSQL 连接支持** — 新增 `postgresql` 连接类型与完整驱动（`drivers/postgres.rs`，配合新的驱动抽象层 `drivers/backend.rs`）：库/模式下的表列表、列/索引/外键/触发器浏览、建表语句查看、对象搜索、SQL 智能补全快照、查询与更新执行全部可用（sqlx 增加 `postgres` feature）。此前仅支持 MySQL 的驱动层开始按协议拆分。
- **数据库结构对比** — 在两个连接（可跨实例）的两个库之间做表结构 diff：表存在性（仅在一侧存在）、列（类型/可空/默认值/extra）、索引（列组合/唯一性）与两侧估算行数。纯 diff 报告，ALTER 语句在前端按选定基准侧生成，避免后端擅自决定改哪一边。
- **服务器信息面板** — 查看 MySQL 服务器的进程列表（可一键 KILL 进程）、全局变量与全局状态（`information_schema.processlist / global_variables / global_status`），用于排查连接占用与配置问题。
- **SQL 代码片段** — 命名保存常用 SQL 片段并在编辑器中一键插入，支持 `{{param}}` 占位符（插入时弹窗填参）；片段本地持久化，属用户内容不随连接走。
- **行数据弹窗支持右键复制** — 行数据弹窗中右键任意字段行弹出菜单：复制该字段值（NULL 复制为字面量 `NULL`）或复制整行（`列名: 值` 逐行排列）；复制成功后头部按钮闪绿提示，Esc/点击空白处关闭菜单。

### Changed

- **再次运行 SQL 时清除列过滤器** — 表浏览应用列筛选后，从编辑器再次执行 SQL 会同时清掉网格表头过滤器：此前残留的过滤器模型会在客户端继续过滤新结果，用户跑任意 SQL 时看到的是被旧条件删过的行集。过滤器自身触发的全表搜索不受影响（`execute` 增加 `fromGridFilter` 标记区分两种来源）。
- **发版不再提供便携版** — Release 构建只产出 MSI 与 NSIS 安装包，裸 `dbdog.exe` 不再作为交付物（CI 的 portable 构建矩阵项已移除）。

## [0.3.13] — 2026-10-22

### Fixed

- **MySQL 8.4 下 schema 树显示为空白** — 8.4 对 information_schema / SHOW 的标识符列在协议层带 BINARY 标志（sqlx 将其视为 VARBINARY，拒绝解码为字符串），且未加别名的列名以大写返回（`TABLE_SCHEMA`）；此前解码失败被 `unwrap_or_default` 静默吞掉，库表树出现有节点无名字的空面板。新增集中式容错解码模块 `drivers/mysql/decode.rs`：字符串解码失败回退原始字节按 UTF-8 渲染、列名大小写不敏感定位，每次降级写 `dbdog::compat` 日志（默认 warn 级，`RUST_LOG` 可调），后续未知服务器怪癖可在日志中暴露而非悄悄显示空值。库列表、表列表、表结构、索引/外键/触发器、对象搜索、SQL 补全在 8.4 上全部恢复正常。
- **SQL 编辑器无法创建触发器 / 存储过程 / 函数 / 事件** — MySQL 所有版本的服务端预处理协议均拒绝这类 DDL（ER_UNSUPPORTED_PS 1295），此前执行必然报 "This command is not supported in the prepared statement protocol yet"。现在检测到 1295 自动改用文本协议在连接池连接上重试；该回退不经过当前标签页的 `USE db` 会话状态，此类语句建议写全限定名（`库名`.`表名`）。

### Changed

- **CSV 导出不再对 latin1 / 二进制标记的文本列导出空单元格** — 无法按 UTF-8 解码的文本值改为有损字节渲染（与查询网格的显示策略一致），只有真正的二进制列才走 base64。
- **新增 MySQL 变体兼容矩阵测试** `src-tauri/tests/mysql_compat.rs`（可选执行，不设环境变量自动跳过）— 自动建临时库并实测 5.7 / 8.0 / 8.4 / 9 / MariaDB 11 的全部元数据路径、查询网格解码与 DDL 回退，本次修复已在五个版本上全部通过；回归命令见测试文件头注释。

## [0.3.12] — 2026-10-13

### Added

- **表浏览列筛选升级为全表搜索** — 结果网格的列头筛选不再只作用于当前已加载的行（此前一页只有 50 行，命中的行不在页内就等于搜不到）：点 Apply 后把筛选条件翻译成 `SELECT * FROM 库.表 WHERE …` 直接对全表执行，生成的 SQL 同步到上方编辑器、可继续改写（执行时仍走无 LIMIT 保护包裹，默认 1000 行）。支持文本 contains/notContains/equals/notEqual/startsWith/endsWith/blank/notBlank、数字比较与区间、日期按天粒度（`>= 'd' AND < 次日`，DATE 与 DATETIME 列同一写法均命中整天），多列 AND 组合、同列双条件 AND/OR，标识符与字符串统一走转义 helper。筛选弹窗新增 Apply/Reset 按钮——条件显式应用后才触发，避免逐键打全表查询；清空筛选时若当前结果正来自生成的搜索 SQL，自动回到第 1 页分页浏览并恢复分页条。任意 SQL 的结果集（JOIN 等）列筛选保持客户端过滤不变，标签页标题保持表名不被 SQL 片段覆盖。

## [0.3.11] — 2026-09-28

### Added

- **表数据服务端分页浏览** — 点击结构树中的表不再固定 `LIMIT 1000`，进入分页浏览模式：每页 50/100/200/500/1000 行可选（默认 50），总行数由后台 `COUNT(*)` 提供（不阻塞首屏数据），支持首页/上一页/下一页/末页与页码直接跳转；有主键的表自动按主键排序保证翻页顺序稳定。翻页时 SQL 编辑器同步显示当前页查询，执行自定义 SQL 后分页条自动隐藏，再次点表即恢复。单元格改值/删行的内联编辑在翻页后依然可用。后端零改动，每次仅传输一页数据。
- **可视化表结构设计器** — 结构抽屉头部按钮或表右键菜单「设计表」打开：字段（名称/类型/长度/无符号/非空/默认值/自增/主键/注释，支持增删与上下调序）与二级索引（增/改/删）可视化编辑，实时 diff 生成单条多子句 `ALTER TABLE` 并附 SQL 预览，带字段名重复/为空、自增列必须为主键、索引名为空等前端校验；应用后自动刷新 schema 缓存并联动刷新左侧树与结构抽屉，未保存关闭有确认。后端 `Column` 新增 `extra` 字段（`serde(default)` 兼容旧 L2 缓存），`ON UPDATE current_timestamp()`、表达式默认值等属性改表时不再被静默丢弃；ALTER 子句顺序经过边界测试（新增列在前、列重定义先于 `DROP PRIMARY KEY`、删列在最后，避免隐式收缩约束导致报错），主键列自动强制 `NOT NULL`。
- **SQL 智能补全** — 关键字（MySQL 方言、大写）+ 库名/表名/列名自动补全：`USE ` 后补库名；`FROM ` 后按当前库直接补表名（取值链：标签页选中库 → 连接默认库 → 单库服务器自动采用）；`db.` / `table.` 前缀感知补全。schema 快照一次 `information_schema.columns` 查询拉全量，前端 5 分钟 TTL 缓存，DDL 变更（可视化设计器或编辑器直接执行 DDL）后自动失效重拉，拉取失败静默降级为纯关键字。设置中的「自动补全」开关首次真正接线（关闭后无任何弹层）。
- **语句级执行** — Ctrl/Cmd+Enter 无选区时执行**光标所在语句**（有选区仍执行选区），Ctrl/Cmd+Shift+Enter 执行全部；工具栏执行按钮同语义。新增 `statementRangeAt` 状态机定位语句边界，正确跳过字符串/行注释/块注释内的分号并剥除结尾分号。
- **无 LIMIT 查询保护** — 无 LIMIT 的 SELECT/WITH 执行前自动包裹 `SELECT * FROM (…) LIMIT N`（默认 1000，取设置的默认行数），由 MySQL 服务端即停而非客户端事后截断；网格自动刷新路径同样防护。自带 LIMIT、`FOR UPDATE/SHARE` 锁语句跳过包裹；被截断时信息栏显示「已截断」。
- **无 WHERE 写入拦截** — UPDATE/DELETE 无顶层 WHERE 条件时弹原生确认框，取消则终止执行并在历史记录留痕。`hasTopLevelWhere` 状态机判定，字符串/注释/子查询内的 WHERE 不计入，避免误放行与误拦截。
- **侧栏拖拽调宽与快捷键** — 分隔条可拖拽调整侧栏宽度（200–500px，持久化），点击收起/展开，Ctrl/Cmd+B 全局切换；3px 位移阈值区分点击与拖拽。
- **命令面板升级** — 每条命令配语义图标，实际接线的快捷键以胶囊展示（Ctrl+Enter / Ctrl+Shift+F / Ctrl+B）。
- **空状态全面组件化** — 新增 EmptyState / Skeleton / WelcomeGuide 组件：无标签页时编辑区显示引导面板（操作指引 + 快捷键教育 + 新建查询入口）；空编辑器显示 placeholder 提示；已有保存连接时空状态引导「从左侧选择连接」而非新建；结构树/表设计器/结构抽屉/Memcached 列表与详情的加载态全部换为骨架屏。
- **弹窗体系升级** — 统一外壳：进出对称动画（150–180ms，`prefers-reduced-motion` 下禁用）、`useModalFocus` 焦点管理（自动聚焦首个输入框、Tab 循环、Esc 统一关闭，常驻挂载弹窗需传 `active`）、`useDelayedUnmount` 延迟卸载。全量替换为 `open` prop 模式并处理重置与退出期间数据快照。
- **表右键菜单图标** — 表右键菜单各项统一配图标，风格与树节点一致。

### Changed

- **UI 一致性与现代化** — 全局细滚动条跟随主题；圆角统一为三档制（lg 面板 / md 控件 / full 圆片），清除全部 4px 裸圆角与孤立 12px；AG Grid 换贴 token 皮肤（32px 密集行、安静表头、浮层卡片同应用风格）；新增自绘 `Checkbox` 组件（主题色填充 + 对勾动画，保留隐藏原生 input 的键盘与语义）替换全部原生复选框；设置弹窗按钮不换行、主题/语言选中态统一；ZK/MC/QueryHistory 等次要区域样式对齐。

### Fixed

- **补全 schema 静默失效** — @uiw/react-codemirror 在 `basicSetup`/`onChange` prop 引用变化时对整个 EditorState 做全量 reconfigure，会重置 compartment 回挂载内容——首次敲键即把已加载的表结构打回纯关键字。通过 prop 稳定化（memo/useCallback）与 compartment 当前内容自愈（ref 种子）修复。
- **行数据弹窗焦点管理失效** — 转常驻挂载时漏传 `active: open`，焦点陷阱与自动聚焦从未激活。已修复（同类问题也出现在设置/命令面板/表设计器，一并治理）。

## [0.3.10] — 2026-09-01

### Added

- **设置中显示版本号** — 设置弹窗底部显示当前应用版本，便于确认安装版本。

### Changed

- **UTF-8 二进制内容可读化** — `BINARY` / `VARBINARY` / `BLOB` 系列列中的有效 UTF-8 内容在结果网格和 CSV 导出中按原文展示；非 UTF-8 二进制继续使用 Base64，非 UTF-8 文本列改用有损 UTF-8 回退而非静默显示 `NULL`。

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
