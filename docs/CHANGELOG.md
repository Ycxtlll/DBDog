# Changelog

All notable changes to DBDog will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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
