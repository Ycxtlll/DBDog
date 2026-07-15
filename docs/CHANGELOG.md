# Changelog

All notable changes to DBDog will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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
