# AGENTS.md

## Quick commands

| What | Command |
|------|---------|
| Frontend dev only | `npm run dev` (Vite on :1420) |
| Full Tauri dev (FE + Rust) | `npm run tauri dev` |
| Typecheck + build | `npm run build` (= `tsc && vite build`) |
| Rust typecheck | `cargo check` |
| Rust tests | `cargo test` |
| Tauri portable build | `npm run tauri build --no-bundle` |

- No lint, no formatter, no frontend tests, no CI configured.
- `tsc` is the only typecheck; `build` runs it before `vite build`.
- Rust tests include a `memcached_integration` test that requires a local Memcached on `127.0.0.1:11211`.

## Architecture

- **Tauri 2.x desktop app** — Rust backend (`src-tauri/`) + React 18/TS frontend (`src/`).
- **Path alias**: `@/*` → `./src/*` (tsconfig `paths`).

### Frontend (`src/`)

```
src/
├── main.tsx                    # React entry
├── App.tsx                     # Root: MainLayout + ToastContainer
├── layout/                     # Main shell
│   ├── MainLayout.tsx          # 3-pane: Sidebar | EditorArea | StatusBar
│   ├── Sidebar.tsx             # Conn list / Schema tree / Memcached / ZK panels
│   ├── EditorArea.tsx          # MySQL: TabBar + SqlEditor + ResultGrid; ZK/MC: viewer
│   └── StatusBar.tsx           # Connection status, timing, row count
├── components/
│   ├── editor/                 # SqlEditor.tsx (CodeMirror 6), EditorTabBar.tsx
│   ├── grid/ResultGrid.tsx     # AG Grid result display + inline cell editing
│   ├── sidebar/                # ConnectionPanel.tsx, SchemaTreePanel.tsx
│   ├── virtual/                # VirtualList.tsx, VirtualTree.tsx, LazyMount.tsx
│   ├── drawer/                 # TableStructureDrawer.tsx
│   ├── memcached/              # MemcachedPanel, MemoEntryViewer
│   ├── zookeeper/              # ZkNodeViewer
│   ├── connection/             # ConnectionFormModal.tsx
│   ├── export/                 # ExportDialog.tsx
│   ├── settings/               # SettingsModal.tsx
│   ├── command-palette/        # CommandPalette.tsx (Ctrl+K)
│   ├── ui/                     # ErrorBoundary, ToastContainer
│   └── QueryHistory.tsx
├── stores/                     # Zustand — per-domain stores
│   ├── connectionStore.ts, queryStore.ts, layoutStore.ts
│   ├── memcachedStore.ts, zookeeperStore.ts
│   ├── uiStore.ts, toastStore.ts
├── services/                   # Tauri invoke() wrappers
│   ├── connectionService.ts, queryService.ts, schemaService.ts
│   ├── memcachedService.ts, zookeeperService.ts
├── types/index.ts              # All shared TS types
├── lib/                        # i18n.ts, utils.ts, sql.ts, error.ts, export.ts
└── locales/{en,zh}/            # i18next namespaced JSON (common, editor, query, schema, memcached, zookeeper, settings, connections)
```

### Backend (`src-tauri/src/`)

```
src-tauri/src/
├── main.rs                     # Tauri entry: panic hook, state init, invoke_handler
├── lib.rs                      # Public module re-exports (for tests)
├── state.rs                    # AppState (Tauri Managed State)
├── error.rs                    # AppError enum → Serialize as string
├── utils.rs                    # XOR crypto helpers
├── commands/                   # Tauri #[command] handlers
│   ├── connection.rs, query.rs, schema.rs
│   ├── memcached.rs, zookeeper.rs, export.rs
├── connection/                 # ConnectionConfig, PoolManager (DashMap), storage, crypto
│   ├── model.rs, manager.rs, storage.rs, crypto.rs
├── drivers/                    # Database drivers
│   ├── mysql/                  # sqlx MySqlPool — implements DatabaseDriver trait
│   ├── memcached/              # Raw TCP ASCII protocol — stateless methods
│   └── zookeeper/              # Raw binary protocol client (v0.3.x)
├── query/                      # engine.rs, result.rs, cancel.rs
└── schema/                     # cache.rs (L1 DashMap), disk.rs (L2 JSON), model.rs
```

- **Frontend**: Vite 6, Tailwind CSS, Zustand stores per domain, CodeMirror 6, AG Grid Community, i18next.
- **Backend database types**: MySQL (sqlx), Memcached (raw TCP text protocol), ZooKeeper (raw binary protocol — v0.3.x, not in architecture doc).
  - MySQL connections use `DashMap<Uuid, MySqlPool>` pools.
  - Memcached and ZooKeeper use per-operation TCP connections (no pools).
- **Password storage**: OS keyring primary, XOR-encrypted fallback in `connections.json`. Password field is `#[serde(skip_serializing)]`.
- **Virtual rendering everywhere**: `VirtualList`, `VirtualTree`, `LazyMount` under `src/components/virtual/`. Drawers/modals fully unmount when closed (`LazyMount` with no `keepAlive`).
- **Frontend types** in `src/types/index.ts` — shared across services and stores.
- **IPC commands** registered in `src-tauri/src/main.rs` `generate_handler![]`.
- **i18n** uses namespaced JSON under `src/locales/{en,zh}/` with react-i18next.
- **Service layer**: `src/services/` wraps Tauri `invoke()` calls — stores never call `invoke` directly.
- **`AppState`** is Tauri managed state, created in `setup()` with the AppHandle.
- **Error type**: `AppError` enum in `src-tauri/src/error.rs` implements `Serialize` as string.

## Version bumping

When bumping the version, update these files:
- `package.json` → `"version": "X.Y.Z"`
- `src-tauri/Cargo.toml` → `version = "X.Y.Z"`
- `src-tauri/Cargo.lock` → only the `name = "dbdog"` entry's `version` line
- `docs/changelog.md`

**Do NOT use global/replaceAll on Cargo.lock.** Other crates like `tauri-winres`, `field-offset`, `fdeflate` can share version numbers with the app. Changing their versions will break `cargo build`. Only touch the `dbdog` entry.
