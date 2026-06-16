# DBDog

一款面向开发者和 DBA 的跨平台桌面数据库管理工具。

**快速连接 · 智能编辑 · 本地优先**

---

## 功能

- **连接管理** — 保存 MySQL 和 Memcached 连接配置，密码由操作系统密钥链安全保管（XOR 回退），一键连接/断开
- **SQL 编辑器** — 多标签编辑、语法高亮、SQL 格式化、Schema 感知自动补全（`database.table.column`）
- **智能查询** — 自动区分查询/更新语句，默认安全截断大结果集，长查询支持一键取消
- **结果网格** — 虚拟滚动支撑百万级数据浏览，列头快速筛选排序，支持导出 CSV / JSON / Excel
- **结构浏览** — 侧边栏树形导航数据库/表/列，一键查看表结构、索引、外键、触发器
- **性能诊断** — 内置 EXPLAIN 可视化（全表扫描标红、索引命中标绿）
- **命令面板** — `Ctrl+K` 唤起，模糊搜索所有操作，键盘优先
- **Memcached 支持** — 连接 Memcached 服务器（默认 `localhost:11211`），浏览全部键，模糊搜索，查看值/标志/过期时间，删除键，清空全部缓存，查看服务器统计（版本、运行时间、命中率、内存占用等）
- **国际化** — 简体中文 / English 双语言支持

## 快速开始

### 1. 创建连接

点击工具栏 **New Connection**：

**MySQL:**
- 名称：本地 MySQL
- 主机：`localhost`
- 端口：`3306`
- 用户名 / 密码
- 默认数据库（可选）

**Memcached:**
- 名称：本地 Memcached
- 主机：`localhost`
- 端口：`11211`

点击 **Test** 验证连接，点击 **Save** 保存。密码通过 OS 密钥链持久化，密钥链不可用时以 XOR 加密写入配置文件。

### 2. 执行查询

选择连接，点击 **New Query** 打开编辑器：

```sql
SELECT * FROM users WHERE created_at > '2024-01-01';
```

按 `Ctrl+Enter` 执行，`Ctrl+Shift+Enter` 执行选中部分。结果展示在下方的网格中，超出行数上限时自动截断并提示。

### 3. 浏览结构

左侧边栏展开数据库 → 表节点，右键点击表：
- **View Structure** — 查看字段、索引、外键
- **Select Top 100** — 在编辑器中生成查询语句

### 4. 诊断性能

编辑器中输入查询后，点击 **Explain** 按钮，自动执行 `EXPLAIN` 并以颜色编码展示执行计划：
- 🔴 红色 — 全表扫描（`type = ALL`）
- 🟢 绿色 — 索引有效命中
- 🟡 黄色 — 使用了临时表或文件排序

### 5. 浏览 Memcached

连接 Memcached 后，左侧边栏展开键列表，支持：
- **搜索** — 输入关键词模糊过滤键名
- **查看** — 点击键名查看值、标志位、过期时间
- **删除** — 右键删除单个键
- **Flush All** — 清空所有缓存数据
- **统计** — 查看服务器版本、运行时间、命中率、内存使用

### 6. 使用命令面板

按 `Ctrl+K`（或 `Cmd+K`）唤起命令面板，输入关键词快速执行：
- 切换连接
- 格式化 SQL
- 切换主题
- 打开设置

## 设置

通过 **Settings**（`Ctrl+,`）调整：

| 设置项 | 说明 |
|--------|------|
| 主题 | Light / Dark |
| 语言 | English / 简体中文 |
| 编辑器字体大小 | 默认 14px |
| 默认返回行数 | 默认 1000 |
| Vim 模式 | 开关 |

所有设置即时生效，无需重启。

## 安全

- 连接密码优先存入操作系统密钥链（Windows Credential Manager / macOS Keychain / Linux Secret Service），密钥链不可用时以 XOR 加密写入配置文件，防止明文泄露
- 所有 SQL 查询使用参数化语句，防止 SQL 注入
- 纯本地工具，数据不上传任何云端服务

## 运行

### 开发模式

```bash
# 安装依赖
npm install

# 启动开发模式（含热重载）
npm run tauri dev
```

### 生产构建

```bash
npm run tauri build
```

### 环境要求

- Node.js ≥ 18
- Rust ≥ 1.78
- Windows：Microsoft Visual Studio C++ Build Tools
- macOS：Xcode Command Line Tools
