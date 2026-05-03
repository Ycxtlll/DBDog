# DBDog Development Plan

## Phase 1: Foundation (COMPLETED)
- [x] Scaffold Tauri 2.x + React + TypeScript project
- [x] Rust backend: types, error, driver traits, MySQL driver, pool manager, state
- [x] Rust IPC commands: connection, query, schema, metadata, health
- [x] React frontend: theme (light/dark), i18n (EN/ZH), layout shell
- [x] Connection management: dialog, list, connect/disconnect with keychain
- [x] SQL editor with CodeMirror 6 + schema-aware autocomplete
- [x] Result grid with AG Grid + virtual scrolling
- [x] Editor panel: tabs, toolbar (run/format), status bar

## Phase 2: Schema Browsing + Autocomplete (COMPLETED)
- [x] Database tree sidebar with lazy-load expand
- [x] Right-click context menus on tree (SELECT *, DESCRIBE, Copy name)
- [x] L1 metadata cache integration in tree loading
- [x] Enhanced SQL autocomplete: dot notation (db.table.column)
- [x] Schema fuzzy search panel
- [x] L2 disk cache for schema persistence across restarts

## Phase 3: History + Bookmarks + Formatter (COMPLETED)
- [x] Local SQLite for query history (rusqlite bundled)
- [x] Auto-log every query: SQL, connection, database, duration, rows, timestamp
- [x] Searchable history panel
- [x] Click to replay (opens new tab with SQL)
- [x] Bookmark CRUD: name, folder, tags
- [x] SQL formatter via sql-formatter (Ctrl+Shift+F)

## Phase 4: ER Diagram + EXPLAIN Visualizer (COMPLETED)
- [x] FK introspection for bulk schema (all tables in a database)
- [x] ER diagram with React Flow: table nodes, FK edges
- [x] Interactive: drag, zoom, pan
- [x] EXPLAIN visualizer with color coding

## Phase 5: Schema Diff + Health Dashboard (COMPLETED)
- [x] Schema snapshot: full database schema capture
- [x] Diff algorithm: tables/columns/indexes/FKs added/removed/modified
- [x] Side-by-side or unified diff UI (basic)
- [x] Migration SQL generation (ALTER TABLE statements)
- [x] Health dashboard: process list with kill button
- [x] Server variables and status variables display
- [x] Auto-refresh every 5 seconds

## Phase 6: Export + Grid Enhancements (COMPLETED)
- [x] Rust-side streaming export (CSV/JSON/SQL INSERT)
- [x] Frontend-side Excel export via SheetJS
- [x] Export UI: format picker, file save dialog, progress indicator
- [x] Excel-like column filters on grid (text/number/set)
- [x] Copy/paste from grid as TSV (for Excel) or JSON
- [x] Column virtualization for wide tables

## Phase 7: Keyboard-first + Polish (IN PROGRESS)

- [x] UI layout optimization: spacing, margins, fonts, button alignment
- [x] Connection management usability improvements
  - Double-click to connect/disconnect connections
  - Auto-connect after saving new connection
  - Smart focus management in connection dialog
- [x] Database tree usability enhancements
  - Double-click table to generate SELECT * query
  - Drag-and-drop tables/columns to SQL editor
  - Double-click database to expand/collapse
- [x] Comprehensive keyboard shortcuts
  - Ctrl+Enter: Run query
  - Ctrl+N: New tab
  - Ctrl+W: Close tab
  - Ctrl+S: Save connection (in dialog)
  - Ctrl+Shift+F: Format SQL
- [x] Internationalization improvements (fix mixed language issues)
- [ ] Cmd+K command palette (Fuse.js)
- [ ] Vim mode for editor (@replit/codemirror-vim)
- [ ] Split tab editing (side-by-side SQL editors)
- [ ] Window state persistence (size, position, sidebar width)
- [ ] Loading skeletons, empty states, error boundaries
- [ ] Connection auto-reconnect with exponential backoff

## Future: NoSQL Browsing
- [ ] Redis: key browser (SCAN-based), value viewer (string/list/hash/set/zset)
- [ ] Memcached: key listing, get/set operations
- [ ] ZooKeeper: tree browser, node data viewer
- [ ] KeyValueBrowser trait implementation
- [ ] Connection type selector in connection dialog
