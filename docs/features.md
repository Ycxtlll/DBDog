# 功能说明

## MySQL

- **SQL 编辑器** — 多标签编辑、CodeMirror 6 语法高亮、SQL 格式化（Ctrl/Cmd+Shift+F）
- **查询执行** — Ctrl/Cmd+Enter 有选区时执行选中、无选区时执行全部；Ctrl/Cmd+Shift+Enter 执行选中，自动区分查询/更新语句
- **结果网格** — AG Grid 虚拟滚动，列头筛选排序，单击单元格打开行数据弹窗编辑（自动生成 UPDATE）
- **表结构浏览** — 侧边栏树形导航（数据库→表→列），Columns3 图标查看字段/索引/外键/触发器/DDL
- **DDL 高亮** — CREATE TABLE 语句以 CodeMirror SQL 语法高亮展示
- **Explain** — 编辑器 Explain 按钮，执行计划可视化
- **二进制数据显示** — BINARY / VARBINARY / BLOB 列中的有效 UTF-8 内容按文本显示，非 UTF-8 字节使用 Base64 兜底

## Memcached

- **连接** — 支持标准 Memcached TCP 端口（默认 11211）
- **Key 浏览** — 虚拟列表浏览所有 key，搜索过滤
- **查看** — 点击 key 名在右侧面板查看 value、flags、expiration、size
- **删除** — 单个 key 删除、Flush All 清空全部
- **统计** — 服务器版本、items、内存、连接数、uptime

## ZooKeeper

- **连接** — 自实现 ZK 协议客户端（无 mio 依赖），支持 Windows/macOS/Linux
- **树浏览** — 递归加载 znode 树，虚拟树组件支持百万级节点
- **节点查看** — 点击节点名在右侧面板查看 data、stat 信息
- **Server 统计** — `mntr` 4LW 获取 mode、version、znode count 等信息
- **只读** — 不支持创建/删除/修改 znode

## 通用

- **连接管理** — 保存 MySQL / Memcached / ZooKeeper 连接配置
- **密码安全** — Windows DPAPI / macOS Keychain / Linux Secret Service 加密存储
- **暗色/亮色主题** — 跟随系统或手动切换
- **国际化** — 简体中文 / English
- **命令面板** — Ctrl+K 快速搜索操作
- **版本信息** — 设置弹窗底部显示当前应用版本
