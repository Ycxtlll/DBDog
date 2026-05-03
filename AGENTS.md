# DBDog — Agent Reference

> This file is written for AI coding agents. Read it before modifying any code.

## Project Overview

DBDog is a cross-platform database GUI tool built with **Tauri 2.x**. It provides fast SQL querying, schema browsing, ER diagram generation, query history/bookmarks, and health monitoring for MySQL/MariaDB. Future plans include Redis, Memcached, and ZooKeeper support.

- **Version**: 0.1.0
- **Identifier**: `com.dbdog.app`
- **License**: See `LICENSE`

## Technology Stack

| Layer | Technology |
|-------|------------|
| Framework | Tauri 2.x |
| Frontend | React 19 + TypeScript 5.8 + Vite 7 |
| Styling | TailwindCSS 4 + CSS custom properties (`globals.css`) |
| State | Zustand 5 |
| SQL Editor | CodeMirror 6 (`@codemirror/lang-sql`) |
| Data Grid | AG Grid Community |
| Diagrams | `@xyflow/react` (React Flow) |
| i18n | react-i18next (EN + ZH) |
| Icons | lucide-react |
| Backend | Rust (edition 2021) |
| Async Runtime | tokio (multi-thread) |
| MySQL Driver | sqlx 0.8 |
| Local Storage | rusqlite (bundled) |
| Schema Cache | DashMap (L1 in-memory) + disk JSON (L2) |
| Credentials | OS keychain via `keyring` crate |

## Project Structure

```
├── src/                          # React frontend
│   ├── components/               # Feature-organized React components
│   │   ├── connections/          # Connection dialog & list
│   │   ├── editor/               # SQL editor (CodeMirror) & tab panel
│   │   ├── grid/                 # Result grid (AG Grid)
│   │   ├── layout/               # AppLayout, ActivityBar, Sidebar, StatusBar
│   │   ├── sidebar/              # DatabaseTree, HistoryPanel, BookmarkPanel, SchemaSearch
│   │   ├── er/                   # ER diagram viewer (React Flow)
│   │   ├── explain/              # EXPLAIN visualizer
│   │   ├── diff/                 # Schema diff view
│   │   └── health/               # Health dashboard
│   ├── stores/                   # Zustand stores (connection, query, history, schemaCache, ui)
│   ├── services/                 # Thin wrappers around Tauri `invoke()` calls
│   ├── types/                    # TypeScript type definitions
│   ├── i18n/                     # Translation JSONs (en/, zh/)
│   ├── assets/styles/globals.css # Theme CSS variables + utility classes
│   ├── App.tsx                   # Root component (applies data-theme)
│   └── main.tsx                  # React DOM entry
├── src-tauri/                    # Rust backend
│   ├── src/
│   │   ├── main.rs               # Tokio runtime entry point
│   │   ├── lib.rs                # Tauri builder, plugin init, command registration
│   │   ├── state.rs              # AppState (pool manager, cache, config, driver, local DB)
│   │   ├── error.rs              # AppError enum (thiserror + Serialize)
│   │   ├── db/
│   │   │   ├── driver.rs         # Traits: DatabaseDriver, DatabaseMetadata, DatabaseHealth
│   │   │   ├── mysql.rs          # MySQL/MariaDB implementation
│   │   │   ├── pool.rs           # PoolManager (DashMap<String, MySqlPool>)
│   │   │   ├── local.rs          # Local SQLite DB (history, bookmarks, snapshots)
│   │   │   └── types.rs          # Shared serde types
│   │   ├── commands/             # Tauri IPC command handlers
│   │   │   ├── connection.rs
│   │   │   ├── query.rs
│   │   │   ├── schema.rs
│   │   │   ├── metadata.rs
│   │   │   ├── health.rs
│   │   │   ├── history.rs
│   │   │   └── diff.rs
│   │   ├── cache/
│   │   │   ├── l1.rs             # In-memory schema cache (DashMap, 5-min TTL)
│   │   │   └── l2.rs             # Disk cache (JSON, 1-hour TTL)
│   │   └── config/
│   │       ├── connections.rs    # ConnectionManager (keychain + JSON config)
│   │       └── app_config.rs
│   ├── migrations/001_init.sql   # SQLite schema for local DB
│   ├── Cargo.toml                # Rust dependencies
│   └── tauri.conf.json           # Tauri app config
├── package.json                  # Node.js dependencies & scripts
├── vite.config.ts                # Vite + TailwindCSS plugin
├── tsconfig.json                 # Strict TypeScript (noUnusedLocals, noUnusedParameters)
├── index.html                    # HTML entry point
└── DEVPLAN.md                    # Detailed roadmap & phase status
```

## Build & Run Commands

Prerequisites: Rust (stable), Node.js 18+, pnpm, and Tauri 2.x system dependencies.

```bash
# Install frontend dependencies
pnpm install

# Development (hot reload for frontend + Rust backend)
pnpm tauri dev

# Build production binary
pnpm tauri build

# Check Rust compilation only
cd src-tauri && cargo check

# Frontend-only dev server (Vite on port 1420)
pnpm dev

# Frontend-only production build
pnpm build
```

### Vite Dev Server
- Port: `1420` (strict)
- HMR port: `1421` (when `TAURI_DEV_HOST` is set)
- Watches `src/` but ignores `src-tauri/`

## Code Style Guidelines

### TypeScript / React
- **Strict mode** enabled; no `any` types (prefer `unknown`).
- Use functional components with hooks.
- All user-facing strings must go through `useTranslation()` from `react-i18next`.
- i18n keys are organized by namespace: `common`, `connections`, `editor`, `query`, `settings`.
- Theme via CSS variables in `globals.css` — **never hardcode colors**.
- Zustand stores are in `src/stores/`; each store is a single file.
- Tauri IPC calls are wrapped in `src/services/`; never call `invoke()` directly from components.

### Rust
- Error types: use `thiserror` (`error.rs` is the canonical example).
- Async traits: use `async_trait`.
- Serialization: use `serde` + `serde_json`.
- The crate library name is `dbdog_lib`; `main.rs` only creates the tokio runtime and calls `dbdog_lib::run()`.
- Command handlers take `tauri::State<'_, AppState>` to access shared state.
- DDL statements in `execute_update` automatically invalidate the in-memory schema cache.

### CSS / Theming
- Themes are toggled by setting `data-theme="light" | "dark"` on `<html>`.
- All colors, shadows, and radii are CSS custom properties defined in `globals.css`.
- TailwindCSS v4 is used via `@tailwindcss/vite` plugin; custom utility classes (`.btn`, `.card`, `.input`, etc.) are also defined in `globals.css`.

## Testing Strategy

> **Current state**: The project does not yet contain automated tests (no `*.test.ts`, `*.spec.ts`, or `#[cfg(test)]` blocks). Testing is currently manual via `pnpm tauri dev`.

When adding tests:
- Rust unit tests should be placed in the same file under `#[cfg(test)]` modules.
- Frontend component tests would typically use a framework like Vitest + React Testing Library.

## Security Considerations

- **Passwords are never stored in plaintext**. The `keyring` crate stores credentials in the OS keychain. `ConnectionConfig` marks `password` with `#[serde(skip_serializing)]`.
- The `keyring` crate may fail on systems without a keychain daemon — the connection dialog handles this gracefully (falls back to prompt).
- **AG Grid Community is AGPL**. This is acceptable for a desktop application, but **do not use AG Grid Enterprise features**.
- The Tauri `csp` field in `tauri.conf.json` is currently `null`. If third-party resources are ever loaded, configure a strict CSP.

## Key Architecture Decisions

1. **Driver Traits**: `DatabaseDriver`, `DatabaseMetadata`, `DatabaseHealth` traits in `db/driver.rs` allow future database backends. `MysqlDriver` currently serves both MySQL and MariaDB.
2. **PoolManager**: Holds `DashMap<String, MySqlPool>` keyed by connection UUID. Pools are created on first connect and closed on disconnect.
3. **Schema Cache Two-Tier**:
   - L1: in-memory `DashMap` with 5-minute TTL.
   - L2: disk JSON file with 1-hour TTL.
   - On connect, `disk_cache.warm_up_l1()` hydrates the memory cache.
   - On DDL (`ALTER`, `CREATE`, `DROP`, etc.), the cache is invalidated.
4. **Local SQLite DB**: `rusqlite` (bundled) stores query history, bookmarks, and schema snapshots. Migrations live in `src-tauri/migrations/001_init.sql`.
5. **IPC Pattern**: Frontend calls service functions → services call `invoke('command_name')` → Rust command handlers in `src-tauri/src/commands/` operate on `AppState`.

## Important Notes for Agents

- Always run `cargo check` (or `cargo clippy`) after modifying Rust code.
- Frontend hot-reloads automatically via Vite; Rust changes require a restart of `pnpm tauri dev`.
- Connection config JSON is stored in the Tauri app data directory; the local SQLite DB (`dbdog.db`) and disk cache (`schema_cache.json`) also live there.
- When adding new Tauri commands:
  1. Add the handler function in the appropriate `src-tauri/src/commands/*.rs` file.
  2. Register it in `src-tauri/src/lib.rs` inside `tauri::generate_handler![...]`.
  3. Add a wrapper in `src/services/` if the frontend needs to call it.
- When adding new i18n strings, add them to **both** `src/i18n/en/` and `src/i18n/zh/` files under the correct namespace.
- The project uses **Conventional Commits** (`feat:`, `fix:`, `refactor:`, etc.).

## External Documentation

- [Tauri 2.x Docs](https://tauri.app/)
- [sqlx QueryBuilder & MySQL](https://docs.rs/sqlx/)
- [AG Grid Community](https://www.ag-grid.com/)
- [CodeMirror 6](https://codemirror.net/)
- [React Flow / xyflow](https://xyflow.com/)
