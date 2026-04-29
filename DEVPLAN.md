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

## Phase 2: Schema Browsing + Autocomplete
- [ ] Database tree sidebar with lazy-load expand
- [ ] Right-click context menus on tree (SELECT *, DESCRIBE, Copy name)
- [ ] L1 metadata cache integration in tree loading
- [ ] Enhanced SQL autocomplete: dot notation (db.table.column)
- [ ] Schema fuzzy search panel (Fuse.js)
- [ ] L2 disk cache for schema persistence across restarts

## Phase 3: History + Bookmarks + Formatter
- [ ] Local SQLite for query history (rusqlite bundled)
- [ ] Auto-log every query: SQL, connection, database, duration, rows, timestamp
- [ ] Searchable history panel with date filter
- [ ] Click to replay (opens new tab with SQL)
- [ ] Bookmark CRUD: name, folder, tags, `:param` placeholders
- [ ] Placeholder dialog: fill values before execution
- [ ] SQL formatter via sql-formatter (Ctrl+Shift+F)

## Phase 4: ER Diagram + EXPLAIN Visualizer
- [ ] FK introspection for bulk schema (all tables in a database)
- [ ] ER diagram with React Flow: table nodes, FK edges
- [ ] Auto-layout via Dagre/ELK
- [ ] Interactive: drag, zoom, pan, click node for table detail
- [ ] Export ER diagram as PNG
- [ ] EXPLAIN FORMAT=JSON parsing
- [ ] Color-coded visual EXPLAIN tree (green/yellow/red)
- [ ] Toggle between visual and tabular EXPLAIN view

## Phase 5: Schema Diff + Health Dashboard
- [ ] Schema snapshot: full database schema capture
- [ ] Diff algorithm: tables/columns/indexes/FKs added/removed/modified
- [ ] Side-by-side or unified diff UI
- [ ] Migration SQL generation (ALTER TABLE statements)
- [ ] Health dashboard: key metrics cards (connections, QPS, slow queries)
- [ ] Process list with kill button
- [ ] Server variables: searchable, edit-in-place for dynamic vars
- [ ] InnoDB status: parsed lock/buffer display
- [ ] Auto-refresh toggle (5s/10s/30s)

## Phase 6: Export + Grid Enhancements
- [ ] Rust-side streaming export (CSV/JSON/SQL INSERT)
- [ ] Frontend-side Excel export via SheetJS
- [ ] Export UI: format picker, file save dialog, progress indicator
- [ ] Excel-like column filters on grid (text/number/set)
- [ ] Copy/paste from grid as TSV (for Excel) or JSON
- [ ] Column virtualization for wide tables

## Phase 7: Keyboard-First + Polish
- [ ] Cmd+K command palette (Fuse.js over all actions)
- [ ] Vim mode for editor (@replit/codemirror-vim)
- [ ] Split tab editing (side-by-side SQL editors)
- [ ] Comprehensive keyboard shortcuts
- [ ] L2 disk cache: warm L1 from L2 on startup
- [ ] Window state persistence (size, position, sidebar width)
- [ ] Loading skeletons, empty states, error boundaries
- [ ] Connection auto-reconnect with exponential backoff
- [ ] Custom title bar for frameless window (optional)

## Future: NoSQL Browsing
- [ ] Redis: key browser (SCAN-based), value viewer (string/list/hash/set/zset)
- [ ] Memcached: key listing, get/set operations
- [ ] ZooKeeper: tree browser, node data viewer
- [ ] KeyValueBrowser trait implementation
- [ ] Connection type selector in connection dialog
