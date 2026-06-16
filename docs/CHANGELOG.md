# Changelog

All notable changes to DBDog will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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
