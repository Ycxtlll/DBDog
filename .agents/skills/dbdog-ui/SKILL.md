---
name: dbdog-ui
description: DBDog (Tauri + React 18 + Tailwind) 的 UI 设计语言与组件约定：主题 token、自绘组件（Checkbox/EmptyState）、弹窗规范（动画 + useModalFocus 焦点管理）、表单控件样式配方、中英双语 i18n 要求。凡是给 DBDog 新增或修改任何 UI——弹窗、表格、侧栏、表单、空状态、右键菜单、分页——都先读这个技能，即使没明说"UI"。
---

# DBDog UI 设计语言

项目**没有组件库**（无 radix/headlessui），全部手写组件 + Tailwind。写 UI 前先看
`src/components/ui/` 里是否已有可复用组件，有就用，不要再造。

## 主题 token

`src/index.css` 用 shadcn 风格 HSL 变量定义 GitHub Light / GitHub Dark 两套主题
（`[data-theme='dark']`）。**永远用语义类**（`bg-background`、`bg-card`、`text-foreground`、
`text-muted-foreground`、`border-border`、`bg-primary`、`text-destructive`、`bg-muted`、
`bg-accent`），不写 `bg-white`、`text-gray-500` 之类的硬编码颜色——两套主题都要能自动成立。

## 常用样式配方

**圆角档位（全项目统一，不要混用 4px 裸 `rounded`）：**
- `rounded-lg`（8px）：弹窗面板、右键菜单、浮层面板
- `rounded-md`（6px）：按钮、输入框、select、表格容器、小信息块、toast
- `rounded-full`：圆片图标底、圆点、胶囊
- 历史上的裸 `rounded`（4px）已全部迁移为 `rounded-md`；新代码不要写裸 `rounded`

- 密集区文字 `text-xs`，常规 `text-sm`；主操作按钮 `bg-primary text-primary-foreground hover:bg-primary/90`
- 输入框：`bg-background border border-border rounded-md px-1.5 py-1 text-xs outline-none hover:border-primary/50 focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors`
- 图标一律 lucide，行内 14px（工具条 12–16px），颜色 `text-muted-foreground`，右键菜单每项都要配图标 + `flex items-center gap-2`
- 信息条/分页条：`px-3 py-1 text-xs border-b（或 border-t） border-border bg-muted`
- 右键菜单：`fixed z-[60] min-w-[1xx] py-1 bg-card border border-border rounded-lg shadow-xl animate-menu-in`

## 共享组件（src/components/ui/）

- `Checkbox`：自绘复选框（保留隐藏原生 input），带可选 children 文字。**任何地方都不要写原生 `<input type="checkbox">`**。选中态用 `group-has-[:checked]`，需要 Tailwind ≥3.4（当前 3.4.17）。
- `EmptyState`：图标圆片 + 标题 + 描述 + 主操作按钮，`compact` 变体给侧栏。不要写"一行灰字"式的空状态。
- `ErrorBoundary`、`ToastContainer`（toast 自带滑入动画，样式在 index.css）。

## 弹窗规范

统一外壳（参照 ConnectionFormModal）：

```tsx
const panelRef = useRef<HTMLDivElement>(null);
useModalFocus(panelRef, { active: open, onEscape: onClose }); // src/lib/useModalFocus.ts
const show = useDelayedUnmount(open);                         // src/lib/useDelayedUnmount.ts
const closing = show && !open;
if (!show) return null;

<div className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 ${closing ? "animate-overlay-out" : "animate-overlay-in"}`}>
  <div ref={panelRef} className={`w-[480px] ... rounded-lg shadow-2xl animate-modal-in`}>
```

- **必须**接 `useModalFocus`：自动聚焦第一个输入框、Tab 循环、Esc 关闭。
  常驻挂载、靠返回 null 隐藏的弹窗（如 store 驱动的）**必须传 `active: open`**，
  否则 effect 只在挂载时跑一次、面板还不存在，焦点管理永远不会激活
- **必须**接 `useDelayedUnmount` 做对称退出动画（关闭后停留 160ms 播 `animate-overlay-out`/`animate-modal-out`）；
  父组件改成传 `open` prop 而不是条件挂载，并把「打开时重置内部状态 / 关闭期间要渲染的数据」
  处理好（参照 CellDetailModal 的 snapshotRef、ConnectionFormModal 的 open 重置 effect）
- Esc 有特殊逻辑时（如未保存先确认、运行中禁关）把自己的回调传给 `onEscape`，
  **不要**再叠加自己的 `window.addEventListener("keydown")`——会双重触发
- 动画类都在 index.css：入场 `animate-overlay-in`(150ms)/`animate-modal-in`(180ms)/`animate-menu-in`(150ms)，
  退出 `animate-overlay-out`/`animate-modal-out`(150ms)；`prefers-reduced-motion` 下全部禁用
- 全局滚动条已在 index.css 统一（细、圆角、跟随主题），**不要**在组件里再写滚动条样式

## 骨架屏与空状态

- 加载态一律用 `src/components/ui/Skeleton.tsx` 的 `Skeleton`（色块）/ `SkeletonTable`
  （网格/表单表格）/ `SkeletonLines`（侧栏、抽屉），**不要**写「加载中...」文字行
- 空状态一律用 `src/components/ui/EmptyState.tsx`（图标圆片 + 标题 + 描述 + 主操作按钮，
  `compact` 变体给侧栏）

## i18n（硬性要求）

`src/locales/{en,zh}/<namespace>.json`，react-i18next 按命名空间取用
（`useTranslation("query")`、`t("common:xxx")`）。**每个新键必须中英同时加**，
漏一边用户就会看到裸 key。组件里不写死中文/英文文案。

## AG Grid / CodeMirror

- AG Grid 用 quartz 主题，颜色经 index.css 里的 `--ag-*` 变量接主题 token；
  浏览模式（`tab.tableBrowse`）关闭内置 `pagination`（分页条在 BrowsePagination）
- CodeMirror 主题按 `resolvedTheme` 选 vscodeDark/vscodeLight（参照 SqlEditor）；
  结构抽屉里只读 SQL 预览同理

## 其他约定

- SQL 拼接一律用 `src/lib/sql.ts` 的 `escapeMysqlIdentifier` 等 helper，禁止手写反引号拼接
- 服务层：组件/store 不直接调 `invoke`，一律走 `src/services/*`
- 大列表用 `src/components/virtual/` 下的 VirtualList/VirtualTree
- 验证手段：`npm run build`（tsc 是唯一类型检查，无 lint 无测试）；
  视觉验证可 `npm run dev` 后用浏览器开 `http://localhost:2000`（vite.config 固定 2000 端口，
  纯浏览器里 Tauri `invoke` 会报错 toast，属预期，外壳/弹窗仍可看）
