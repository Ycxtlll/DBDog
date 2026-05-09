# 前端开发准则 (src/)

> 本文件补充 `../AGENTS.md`，针对前端 React/TypeScript 开发提供具体规范。
> 上层准则与本文件冲突时，以本文件为准。

---

## 1. 技术栈约束

- **框架**: React 18+（函数组件 + Hooks）
- **语言**: TypeScript（`strict: true`）
- **状态**: Zustand（按领域拆分）
- **样式**: Tailwind CSS + shadcn/ui
- **虚拟化**: `@tanstack/react-virtual`（所有长列表）
- **构建**: Vite

禁止引入未在架构文档中列出的新框架（如 Redux、MobX、Emotion 等）。

---

## 2. 组件设计规范

### 2.1 组件分类

| 类型 | 位置 | 职责 | 示例 |
|------|------|------|------|
| **Layout** | `layout/` | 页面骨架，不处理业务逻辑 | `Workbench`, `Sidebar`, `EditorArea` |
| **Page** | `pages/` | 路由级页面，组合 Layout 和 Components | `MainLayout` |
| **Feature** | `components/{feature}/` | 业务领域组件，可复用 within 领域 | `SqlEditor`, `ResultGrid` |
| **UI** | `components/ui/` | 原子级基础组件，纯展示 | `Button`, `Dialog`, `Input`（shadcn/ui） |
| **Virtual** | `components/virtual/` | 虚拟化基础设施 | `VirtualList`, `VirtualTree`, `LazyMount` |

### 2.2 组件文件结构

```tsx
// 顺序：imports → types → component → styles（Tailwind）

import { useState } from 'react';
import type { QueryResult } from '@/types';

interface ResultGridProps {
  data: QueryResult;
  onRowClick?: (row: Record<string, unknown>) => void;
}

export function ResultGrid({ data, onRowClick }: ResultGridProps) {
  // ...
}
```

- Props 接口必须显式命名（`XxxProps`），禁止内联 `({ data }: { data: T })`
- 一个文件一个组件，文件名为组件名（`PascalCase.tsx`）
- 副作用必须用 `useEffect`，禁止在渲染阶段调用 API 或修改 DOM

### 2.3 虚拟化强制规范

以下场景**必须**使用虚拟化，无例外：

| 场景 | 组件 | 预估阈值 |
|------|------|---------|
| Schema 树 | `VirtualTree` | > 50 个节点 |
| 历史记录列表 | `VirtualList` | > 30 条 |
| 进程列表 | `VirtualList` | > 20 条 |
| 状态变量列表 | `VirtualList` | > 50 条 |
| 命令面板结果 | `VirtualList` | 永远使用 |
| 结果网格 | AG Grid Virtual | 永远使用 |

---

## 3. 状态管理规范

### 3.1 Store 拆分

```
stores/
├── workbenchStore.ts    # 布局状态（Sidebar/Panel/Group 可见性、尺寸）
├── connectionStore.ts   # 连接数据与状态
├── queryStore.ts        # 编辑器 Tab、SQL、结果
├── schemaCacheStore.ts  # Schema 树展开、搜索、选中
├── historyStore.ts      # 历史记录、书签
└── uiStore.ts           # 主题、语言、全局 Loading
```

- 禁止新增未规划的 Store
- 禁止 Store 之间直接引用（如 `connectionStore` 直接调用 `queryStore` 的方法）
- 跨 Store 通信通过 Hook 组合或事件回调

### 3.2 Store 实现模板

```typescript
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

interface UiState {
  theme: 'light' | 'dark';
  language: 'en' | 'zh';
  setTheme: (theme: UiState['theme']) => void;
}

export const useUiStore = create<UiState>()(
  immer((set) => ({
    theme: 'light',
    language: 'en',
    setTheme: (theme) => set((state) => { state.theme = theme; }),
  }))
);
```

- 使用 `immer` 保证不可变更新
- Selector 必须精确，避免 `const state = useUiStore()` 导致全量监听

```typescript
// ✅ 正确：精确订阅
const theme = useUiStore((s) => s.theme);

// ❌ 错误：导致所有 uiStore 变更都触发重渲染
const { theme, language } = useUiStore();
```

---

## 4. Hook 规范

### 4.1 自定义 Hook 命名

- 必须以 `use` 开头：`useQueryExecution`, `useVirtualList`
- 文件名为 Hook 名：`useQueryExecution.ts`

### 4.2 Hook 职责

- 一个 Hook 封装一个关注点
- 禁止 Hook 内部直接调用 IPC，必须通过 `services/` 层封装
- 异步操作必须处理 loading / error / cleanup 状态

```typescript
// services/queryService.ts
export const queryService = {
  execute: (sql: string, connId: string, limit: number) =>
    invoke('execute_query', { sql, connection_id: connId, limit }),
};

// hooks/useQueryExecution.ts
export function useQueryExecution() {
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const execute = useCallback(async (sql: string, connId: string) => {
    setIsExecuting(true);
    setError(null);
    try {
      return await queryService.execute(sql, connId, 1000);
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setIsExecuting(false);
    }
  }, []);

  return { execute, isExecuting, error };
}
```

---

## 5. 性能优化清单

开发完成后，自检以下项目：

- [ ] 新增列表组件是否使用了虚拟化？
- [ ] 新增面板/弹窗是否在关闭时完全卸载？
- [ ] Zustand 订阅是否使用了精确 Selector？
- [ ] `useEffect` 是否有完整的依赖数组？
- [ ] 大对象（如查询结果）是否通过 `useMemo` / `useCallback` 避免不必要的重计算？
- [ ] 图片/图标是否使用了懒加载？
- [ ] 主题切换是否避免了全局重渲染？

---

## 6. 接口兼容性（前端视角）

- IPC 调用输入/输出类型必须与 Rust 侧严格对应
- 新增 IPC 字段必须标记为可选（`?: T`），保证旧版 Rust 兼容
- 废弃的 IPC 调用必须保留至少一个版本周期，并添加 `@deprecated` JSDoc
- 配置文件格式变更必须提供向后兼容的读取逻辑
