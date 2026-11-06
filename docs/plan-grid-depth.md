# DBDog 数据交互深化计划（Grid Depth）

> 起草：2026-11-06 · 状态：实施中
>
> 背景：用户反馈"数据库交互易用性差"。结论：不做广度（不再铺新数据库/新面板/新弹窗），
> 把深度全部砸在用户 90% 时间停留的表面——**网格 + 行 + 变更**。
> 版本节奏：0.x patch 递增，每个里程碑可发一版（M1→0.3.15，M2→0.3.16，M3→0.3.17，M4→0.3.18）。

## 0. 设计原则

1. **鼠标优先**——用 GUI 就是为了少敲键盘；键盘只做加速（Ctrl+C、Enter、方向键），不做依赖。
2. **所见即所查**——每个网格交互（右键筛选/排序/圈选）都生成可见、可编辑、可回车重跑的 SQL；GUI 教 SQL 而不是藏 SQL。
3. **可回溯**——改数据必须有undo/回滚/审计路径；敢在生产库上点鼠标是最高易用性。
4. **AG Grid Community 约束内工作**——无范围选区、无集合筛选（set filter）、无状态栏组件，以下方案均给出社区版替代。

## 0.5 架构原则（硬约束）

**算法落入 Rust，TS 只管 UI。** 凡是承载语义或数据的算法——SQL 守卫与生成、关系推断、
值验证、变更集 diff、回滚语句生成——全部放 `src-tauri/src/`（Rust 侧），前端只负责渲染状态、
转发用户事件、格式化剪贴板/显示文本。理由：单线程 Rust 计算不被 UI 阻塞，逻辑可被
`cargo test` 覆盖，未来 dbdog-mcp 类无 GUI 入口直接复用同一套核心。

**迁移清单**（现有 TS 侧算法，随里程碑下沉，前端改为调 Tauri command）：

| TS 现状（src/lib/sql.ts / queryStore） | 去向 |
|------|------|
| `limitGuardSql`（LIMIT 包裹） | Rust `query/guard.rs` |
| `hasTopLevelWhere`（无 WHERE DML 拦截判定） | Rust `query/guard.rs` |
| `buildTableSearchSql` / `buildFilterColumnCondition`（筛选→SQL） | Rust `query/gen.rs` |
| M2 关系分析器（候选生成/值验证/匹配） | **新建即 Rust**：`src-tauri/src/relationships/`，TS 零算法 |
| M4 变更集 diff 与回滚生成 | Rust `query/changeset.rs`（现 rollback 生成在 TS，一并下沉） |

留在 TS 的（纯 UI 格式化）：剪贴板文本（TSV/JSON 字符串拼装）、显示格式化（NULL 斜体、
相对时间、截断）、AG Grid 过滤模型的数据结构转换。

## M1 网格活化与复制体验（0.3.15）

### 1.1 复制体系（复制不好用的工具不可能易用）

| 交互 | 行为 |
|------|------|
| Ctrl+C（聚焦单元格） | 复制该单元格原始值 |
| 右键单元格 → 复制值 | 原始值（NULL 复制字面量 `NULL`） |
| 右键单元格 → 复制为 JSON | 值可 JSON.parse 时格式化复制，否则置灰 |
| 右键单元格 → 复制整行 | `列名: 值` 逐行（行数据弹窗同款格式） |
| 右键 → 复制整行 JSON | 整行对象格式化 JSON |
| 右键 → 复制为 INSERT | `INSERT INTO db.table (...) VALUES (...);` 单行 |
| 多选行 → 右键 | 复制 N 行 TSV（贴 Excel）/ N 行 JSON / N 条 INSERT |
| 大值单元格（TEXT/JSON） | 网格内截断显示，点开侧边抽屉：CodeMirror 高亮 + 格式化按钮 + 完整复制（只读，编辑在 M3） |

### 1.2 右键即筛选（所见即所查第一刀）

- 按此值筛选（`=`）/ 排除此值（`≠`）——按列数据类型生成 text/number 过滤模型，走既有
  `handleFilterChanged → buildTableSearchSql → searchTable` 全表搜索管道，SQL 同步编辑器
- 筛选空值（`blank`）/ 排除空值（`notBlank`）——沿用 AG Grid 语义（NULL 或空串），与列筛选弹窗行为一致
- 值追踪（IN 多选行筛选）依赖筛选 chips（1.4），随 chips 一起落地

### 1.3 服务端真排序（消灭假排序）

- 表头点击排序在**浏览模式**下改为服务端 `ORDER BY` 重新查页（现客户端排序只排 50 行，翻页即乱，误导性强）
- `buildTableSelect` 增加 `sort` 参数：排序列优先、主键列殿后保证翻页稳定；任意 SQL 结果集维持客户端排序
- 抽出 `browseStateSelectSql(browse)` 统一生成浏览 SELECT——`showBrowsePager` 与 `handleFilterChanged`
  的 `plainBrowse` 判定改为调用它，消除三处重复拼接
- 单列排序（取 AG Grid 排序状态第一项），排序状态存入 `tableBrowse`，翻页保持

### 1.4 筛选 chips 常驻栏（筛选不再静默）

- 生效中的每个筛选条件渲染为一枚可删除 chip（网格上方信息条），hover 显示对应 SQL 片段
- chips = AG Grid 过滤模型 + 扩展筛选（IN 多选行等无法用内置模型表达的）合并渲染
- 删除 chip → 重算过滤模型 → 自动重新搜索；"清空全部"一键回到纯浏览

### 1.5 选区统计条（性价比之王）

- 选中 N 行（复选框多选）时底部显示：行数 + 每数值列 count/sum/avg/min/max、每列 distinct/null 计数
- 纯前端对已加载页计算，零查询成本

### 1.6 NULL 与空串分离显示

- NULL 显示为斜体灰 `NULL`（现状）；空串显示为 `''` 标记（现与 NULL 无法区分，且编辑清空会被吞成 NULL——彻底修复在 M3，M1 先做显示区分）

## M2 逻辑外键关系分析器（0.3.16）

现代 MySQL 设计普遍不建物理外键（关联靠业务层维护），读 `information_schema` 的 FK 跳转在真实库上基本不亮。
**做深 = 推断逻辑关联，把业务代码里的隐性知识显式化成一张可导航的关系图。**
按 0.5 节硬约束：分析器整体为 Rust 模块 `src-tauri/src/relationships/`（解析导入清单、
候选生成、值验证 SQL 生成、置信度合并、裁决存储读写），前端只拿到现成的关系图渲染。

### 2.1 关系来源（置信度从高到低）

1. **用户裁决**——右键"确认关联 / 否决 / 改指向"，按连接持久化（本地 JSON），永久生效
2. **导入关系清单**——解析 `表.列 -> 表.列 [LEFT|RIGHT]?` 格式的文本清单（团队常维护此文档），
   `[LEFT]/[RIGHT]` 作为关联展开时的 JOIN 类型提示；导入内容视同裁决
3. **声明 FK**——`information_schema.KEY_COLUMN_USAGE`，存在即直接采用（老库兼容）
4. **自动推断**——命名/类型启发 + 值验证（见 2.2）

### 2.2 推断算法

- **候选生成**：列名模式（`fk_*`、`*_id`、`*_no`、`*_code`、驼峰 `UserId` 等，大小写不敏感），
  剥 `t_` 表前缀、单复数变体（`fk_Product → t_products`）、类型相容过滤，排除主键自身
- **值验证**：样本直接取**网格已加载页**的非空值（零额外查询），对候选父表发
  `SELECT COUNT(*) FROM parent WHERE pk IN (样本)`（主键索引，开销可忽略）；
  命中率 ≥ 80% 判为逻辑关联
- **成本控制**：按"正在浏览的表"后台触发，不扫全库；结果进 schema 两级缓存，DDL 失效复用补全快照的失效钩子

### 2.3 交互

- 关联值渲染为链接（声明的实线、推断的虚线+"推断"徽章），点击跳转父表对应行，面包屑跳回
- **反向引用安全网**：行右键"查看引用它的行"；删除行前若被引用则列出引用表并要求确认
- bitanswer 库为验收基准（`docs/relationships-bitanswer.txt`，约 110 条）：导入清单即全兼容；
  同时实测纯推断的命中率与值验证的召回率，反哺阈值调优

### 2.4 bitanswer 清单暴露的解析要点（已核实）

- 大小写混乱：`fk_snid` / `fk_SnId` / `fk_snId` 同指一列——表/列匹配一律大小写不敏感，SQL 生成用 schema 真实名
- 单复数：`fk_Product → t_products.productID`、`fk_snmachineid → t_snmachine.snMachineId`
- **命名陷阱（必须靠值验证/裁决）**：`t_businessidentityprovider.fk_Business -> t_products.productID`
  （列名指向 business，实际引用 products）；`t_featuregroupitems.uid -> t_productfeatures.featureId`
  （无 fk_ 前缀，命名启发完全失效）——这两类正是"值验证 + 用户裁决"存在的理由

## M3 行文档化（0.3.17）

- 行详情从表单变文档：JSON 列用树/CodeMirror 编辑（格式化 + 语法校验），TEXT 多行编辑
- **NULL / 空串分离控件**：两个明确动作，修复"清空即 SET NULL"的正确性 bug
- 时间戳 hover 多时区换算；无主键表给真实出路（唯一索引 fallback 或明示只读原因）
- 行 diff：钉住任意两行并排对比，差异高亮（复用结构对比的交互语言）

## M4 信任三件套（0.3.18）

- **变更集**：网格改动（改值/删行/加行）先进 staging，底部常驻"待应用 N 处修改"，展开是完整 SQL diff，
  单事务应用，一键回滚——地基已备（回滚 INSERT/UPDATE 生成、query history 均在）
- **网格 Ctrl+Z**：撤销最近一次已应用改动（复用回滚语句生成）
- **连接级只读开关**：连接配置新增 `readOnly`，查询引擎层拒绝 DML——安全开关本身就是易用性

## M5 后置池（按反馈排期）

值追踪（一个值在全库足迹，演示必杀但成本高）· 关联展开浏览（行内联显示子表相关行）·
视图保存（命名筛选+排序集合）· 标签页状态恢复 · EXPLAIN 可视化（下一个深度候选支点）

## 风险与控制

| 风险 | 控制 |
|------|------|
| 值验证打到生产库 | 只发主键 IN 探测（索引点查），样本≤50，随浏览触发，结果缓存 |
| 推断误判 | 80% 命中率阈值 + 类型相容 + 用户否决优先于一切自动结论 |
| 表名大小写（Linux 服务器敏感） | 匹配大小写不敏感，SQL 生成一律用 schema 返回的真实表名 |
| AG Grid Community 功能缺失 | 见第 0 节替代方案；不引企业版授权 |

## 进度日志（新会话从这里续）

- **2026-11-06** 计划立项：完成讨论收敛（深度三支点 + 逻辑外键推断修正 + bitanswer 验收基准），
  计划文档与本清单入库；`docs/relationships-bitanswer.txt` 为 M2 验收基准（约 110 条，含
  命名陷阱案例）。0.3.14 已发布（安装包only 构建逻辑已切换）。
- **2026-11-06** M1 编码开始。已完成：`src/lib/sql.ts` 增加 `buildTableSelect` 的 sort 参数、
  `browseStateSelectSql`（统一浏览 SELECT 生成，替代 ResultGrid 三处手拼比较）、
  `buildInsertStatements`（复制为 INSERT / M4 变更集复用，纯 UI 复制用途留 TS）。
- **M1 待续**（下一批）：`types/index.ts` TableBrowseState 加 `sort` 字段 →
  `queryStore` 的 `browsePage` 带排序 + 新增 `browseSort` 动作 → ResultGrid
  `onSortChanged` 接服务端排序（`showBrowsePager`/`plainBrowse` 判定改用
  `browseStateSelectSql`）→ 右键菜单重构（复制块：值/JSON/整行/整行JSON/INSERT；
  快捷筛选块：=、≠、空值、非空——走既有 `setFilterModel → handleFilterChanged →
  searchTable` 管道；菜单从"仅浏览模式"放开为任意结果集可用）→ NULL 斜体 +
  空串 `''` 标记渲染 → Ctrl+C 复制聚焦单元格 → i18n 中英键 → build 验证提交。
  注意两个交互约束：多选行（复选框）与"点单元格开详情"冲突，与筛选 chips、
  选区统计条同批设计；快捷筛选对任意 SQL 结果集退化为客户端过滤（与现状一致）。
- **2026-11-06 M1 第一批完成（commit dcdac6d）**：服务端真排序上线（浏览模式表头点击
  → `ORDER BY` 重查第 1 页，排序状态存 `tableBrowse.sort`，翻页保持；排序会退出筛选搜索；
  任意 SQL 结果保持客户端排序）；右键菜单重构（任意结果集可用）：复制块（值/为 JSON/
  整行/整行 JSON/为 INSERT——INSERT 仅浏览模式）+ 快捷筛选块（按此值 =、排除 ≠、
  只看空值、只看非空值，按列类型生成 text/number/date 过滤模型，走既有全表搜索管道，
  非 plain-browse 时退化为客户端过滤）+ 查看行数据（聚焦右键列）/删除行；Ctrl+C 复制
  聚焦单元格；NULL 斜体、空串显示 `''`（此前不可区分）。
- **M1 第二批待做**：筛选 chips 常驻栏 + IN 多选行筛选（设计约束：多选行复选框与
  "点单元格开详情"冲突，需一起设计，倾向加复选框选择列 + 点击行为不变）+ 选区统计条
  （选中行/当前页 count/sum/avg/distinct/null）；chips 需在 `tableBrowse` 增加结构化
  筛选状态（现只有 filterSql 字符串）。
- **2026-11-06 M2 核心完成**：Rust `relationships/` 模块（model/parse/infer/store，
  9 个单测覆盖 bitanswer 格式解析与候选生成）+ `commands/relationships.rs` 四命令
  （get/import/adjudicate/infer）已注册；前端 `relationshipService` + ResultGrid 集成：
  FK 列渲染 Link2 图标（悬停显示置信度）→ 点击拉取父行进行详情弹窗；浏览页加载时
  自动采样（≤50 值/列，取自已加载页零额外查询）跑推断（每列 ≤4 候选、全局 ≤60 探测、
  命中率 ≥80% 成链）；右键"查看 {{table}} 中引用此行"（声明的反向引用，子查询 200 行
  走本 tab 执行）；推断链接右键可 确认/否决（按连接持久化到
  `relationships/<connectionId>.json`）。**待做**：关系清单导入 UI（命令已就绪）、
  推断候选（<80%）展示与手动改指向、bitanswer 库实测命中率、chips/统计条（M1 二批）。
- **架构提醒**：新算法一律 Rust 优先（见 0.5 节），TS 迁移清单随里程碑执行。
