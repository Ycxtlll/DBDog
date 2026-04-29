# DBDog - Project Guidelines

## Overview
DBDog is a cross-platform database GUI tool built with Tauri 2.x + React + TypeScript (frontend) and Rust (backend). It focuses on fast SQL querying and data browsing with support for MySQL/MariaDB initially, with plans for Redis, Memcached, and ZooKeeper browsing.

## Tech Stack
- **Framework**: Tauri 2.x (Rust backend + WebView frontend)
- **Frontend**: React 19 + TypeScript 5 + Vite 7
- **State**: Zustand (lightweight, no boilerplate)
- **SQL Editor**: CodeMirror 6 with @codemirror/lang-sql
- **Data Grid**: AG Grid Community (virtual scrolling)
- **i18n**: react-i18next (EN + ZH locale files in `src/i18n/`)
- **Theming**: TailwindCSS 4 + CSS variables (`data-theme` attribute on `<html>`)
- **ER Diagrams**: @xyflow/react (React Flow)
- **Icons**: lucide-react

## Project Structure
- `src-tauri/` — Rust backend (Tauri commands, DB drivers, cache, state)
- `src/` — React frontend (components, stores, services, types, i18n)
- `src-tauri/src/db/` — Database driver abstraction (traits) + MySQL implementation
- `src-tauri/src/commands/` — Tauri IPC command handlers
- `src-tauri/src/cache/` — Schema metadata cache (L1 in-memory, L2 disk)
- `src/stores/` — Zustand stores (connection, query, schemaCache, ui)
- `src/services/` — Tauri IPC call wrappers
- `src/components/` — React components organized by feature
- `src/i18n/en/` and `src/i18n/zh/` — Translation JSON files

## Architecture Decisions
- **Driver traits**: `DatabaseDriver`, `DatabaseMetadata`, `DatabaseHealth` — implement for each DB type
- **MysqlDriver**: Single implementation for both MySQL and MariaDB (wire-compatible)
- **PoolManager**: Stores `DashMap<String, MySqlPool>` keyed by connection UUID
- **Schema cache**: L1 (DashMap + 5-min TTL) + L2 (disk JSON + 1-hour TTL)
- **Credentials**: OS keychain via `keyring` crate (never stored in plaintext)
- **Local DB**: `rusqlite` (bundled) for query history and bookmarks

## Development Commands
```bash
pnpm install          # Install frontend dependencies
pnpm tauri dev        # Start dev mode (hot reload for frontend + Rust)
pnpm tauri build      # Build production binary
cd src-tauri && cargo check  # Check Rust compilation only
```

## Code Conventions
- **Rust**: Use `thiserror` for error types, `async_trait` for trait implementations, `serde` for serialization
- **TypeScript**: Strict mode, no `any` types (use `unknown`), functional components with hooks
- **CSS**: Use CSS variables from `globals.css` for theming — never hardcode colors
- **i18n**: All user-facing strings must use `useTranslation()` — keys organized by namespace
- **Commits**: Conventional commits format (feat:, fix:, refactor:, etc.)

## Current Implementation Status
- [x] Phase 1: Foundation (connect, query, result grid, theme, i18n)
- [ ] Phase 2: Schema browsing + autocomplete
- [ ] Phase 3: History + bookmarks + formatter
- [ ] Phase 4: ER diagram + EXPLAIN visualizer
- [ ] Phase 5: Schema diff + health dashboard
- [ ] Phase 6: Export + grid enhancements
- [ ] Phase 7: Keyboard-first + polish

## Important Notes
- Always run `cargo check` after modifying Rust code
- Frontend hot reloads automatically with Vite
- The `keyring` crate may fail on systems without a keychain daemon — handle gracefully
- AG Grid Community is AGPL — acceptable for this desktop app, but do not use AG Grid Enterprise features
